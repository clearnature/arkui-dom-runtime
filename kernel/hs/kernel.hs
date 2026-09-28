{-# LANGUAGE ForeignFunctionInterface #-}
-- =====================================================================================
-- kernel/hs/kernel.hs — Haskell (GHC) 内核：kernel_abi.h 契约 + trha 数据模型（R114）
--
-- 数据面语义对齐 /home/yanli/work/trha（Haskell 微内核 agent harness）：
--   · Agent 记录   —— src/Core/Agent/Types.hs:64-69  Agent{state, inbox}
--   · 状态机       —— src/Core/Agent/StateMachine.hs:30-36  transition 五分支+自环
--     （Idle | Processing StepId | WaitingForTool ToolCallId | Completed Result | Error）
--   · 邮箱         —— TQueue 无界 FIFO（trha agentInbox 同构），poll 排空读
--   · 注册表       —— src/API/Server.hs:975 的 Map 范式（本实现 IORef+Map：宿主
--                     kernel_call 由 Electron 主进程 IPC 串行进入，单线程写入无竞态；
--                     trha 用 TVar 是因其 HTTP 多线程入口，两者语义等价于串行化点）
--   · 消息载荷     —— 对齐 LLM/Adapter/Types.hs 的 content 语义（本内核不碰 role，
--                     role 归上层会话；wire 键 role/content 在宿主侧拼装）
--
-- 方法面 = 仓颉内核可测子集（echo/add/fib/error + agent spawn/list/send/poll/kill）
--          + trha 扩展两件（agent.transition / agent.state）。形状与 kernel_abi.h
--          一致 → 同一份 C 契约测试可对本内核跑（同契约多实现的实证）。
--
-- 构建（见 build.sh）：
--   ghc -package-env=- -shared -fPIC -dynamic -O2 kernel.hs -o libkernel_hs.so
--   （-package-env=- 必须：本机全局环境带 ollama/req 等无关包会全量链入；
--     -dynamic 必须：inplace GHC 静态包非 PIC，链共享对象报 R_X86_64_32S）
--
-- 加载（宿主方案 A，探针实测）：
--   dlopen(libHSrts-*.so, LAZY|GLOBAL) → dlopen(libHSghc-internal-*.so, NOW|GLOBAL)
--   → hs_init(NULL,NULL) → dlopen(libkernel_hs.so) → dlsym 直调
--   循环引用裁决：ghc-internal 的 stg_* 是【数据符号】（dlopen 即解析，LAZY 无效）、
--   RTS 的 init_ghc_hs_iface 是【函数符号】（可挂起）→ 必须 RTS 先 LAZY。
-- =====================================================================================
module Kernel () where

import Foreign.C.Types
import Foreign.C.String
import Foreign.Ptr
import Foreign.Marshal.Alloc (free)
import Data.Int (Int64)
import Data.IORef
import System.IO.Unsafe (unsafePerformIO)
import qualified Data.Map.Strict as M
import Control.Concurrent.STM
import Control.Concurrent (forkIO)
import Control.Exception (evaluate)
import GHC.Conc (setNumCapabilities, getNumCapabilities)
import GHC.Clock (getMonotonicTimeNSec)
import Data.Maybe (fromMaybe)

-- ── 作业面（R115：forkIO 真线程——GHC 独有优势，宿主零驱动） ──────────────────────
-- 状态与仓颉对齐（坑 105 纪律：每个读取方显式认领）：
--   0=pending 2=claimed(in-flight) 1=done 3=cancelled
-- GHC 差异：不需要 kernel_pending/drain_entry/宿主泵（RTS 自跑）——forkIO 即起。
data Job = Job
  { jbState :: IORef Int
  , jbKind  :: String
  , jbN     :: Int
  , jbText  :: String
  , jbValue :: IORef Int64
  , jbOut   :: IORef String
  , jbStart :: IORef Integer          -- getMonotonicTimeNSec（ns）
  , jbEnd   :: IORef Integer
  }

{-# NOINLINE gJobs #-}
gJobs :: IORef (M.Map Int Job)
gJobs = unsafePerformIO (newIORef M.empty)

{-# NOINLINE gNextJob #-}
gNextJob :: IORef Int
gNextJob = unsafePerformIO (newIORef 0)

{-# NOINLINE gDoneOrder #-}
gDoneOrder :: IORef [Int]              -- 完成序（timings 遍历序）
gDoneOrder = unsafePerformIO (newIORef [])

{-# NOINLINE gCapsAtInit #-}
gCapsAtInit :: IORef Int                -- setNumCapabilities 后的当场快照（诊断）
gCapsAtInit = unsafePerformIO (newIORef 0)

resetJobs :: IO ()
resetJobs = do
  writeIORef gJobs M.empty
  writeIORef gNextJob 0
  writeIORef gDoneOrder []

-- ── trha 数据模型（Types.hs + StateMachine.hs 语义） ──────────────────────────────

data AgentState
  = AIdle
  | AProcessing String               -- StepId
  | AWaitingForTool String           -- ToolCallId
  | ACompleted String                -- Result.resultText（Result.tokens 不进 kernel 面）
  | AError String
  deriving (Eq, Show)

data Agent = Agent
  { agName  :: String
  , agState :: IORef AgentState      -- trha: TVar（串行进入点下 IORef 等价）
  , agBox   :: TQueue String         -- trha: TQueue Message 的 content 半边（邮箱 FIFO）
  , agCount :: IORef Int             -- 邮箱未读数（TQueue 无 length API，配额独立计数）
  }

-- 注册表：(按 id 的表, spawn 序, 下一 id)
data Reg = Reg (M.Map Int Agent) [Int] Int

{-# NOINLINE gReg #-}
gReg :: IORef Reg
gReg = unsafePerformIO (newIORef (Reg M.empty [] 0))

-- trha transition（StateMachine.hs:30-36）：五分支 + 非法转移自环 + Error 任意态可入。
-- 差异：step/call id 做成真参数（trha 源是占位字面量 "step-1"/"call-1"）。
data Cmd
  = CmdStart String                 -- StepId（缺省 step-1）
  | CmdToolCall String String       -- ToolCallId, tool 名
  | CmdToolResult String            -- 结果载荷
  | CmdComplete String              -- Result.text
  | CmdError String
  deriving (Eq, Show)

transition :: AgentState -> Cmd -> AgentState
transition AIdle (CmdStart s)              = AProcessing s
transition (AProcessing _) (CmdToolCall c _) = AWaitingForTool c
transition (AWaitingForTool _) (CmdToolResult _) = AProcessing "step-2"
transition (AProcessing _) (CmdComplete t)  = ACompleted t
transition _ (CmdError e)                  = AError e
transition s _                             = s                  -- 非法转移保持原态

stateJson :: AgentState -> String
stateJson AIdle                 = "{\"state\":\"Idle\"}"
stateJson (AProcessing s)       = "{\"state\":\"Processing\",\"step\":\"" ++ esc s ++ "\"}"
stateJson (AWaitingForTool c)   = "{\"state\":\"WaitingForTool\",\"callId\":\"" ++ esc c ++ "\"}"
stateJson (ACompleted t)        = "{\"state\":\"Completed\",\"text\":\"" ++ esc t ++ "\"}"
stateJson (AError e)            = "{\"state\":\"Error\",\"error\":\"" ++ esc e ++ "\"}"

-- ── JSON 轻量工具（手工，无 aeson 依赖——对齐仓颉内核的手写风格） ────────────────

esc :: String -> String
esc = concatMap f
  where
    f '"'     = "\\\""
    f '\\'    = "\\\\"
    f '\n'    = "\\n"
    f '\SOH' = "\\u0001"      -- 消息分隔符转义（对齐仓颉 jsonEsc——互通前提）
    f c       = [c]

-- R127：ASCII 大写（upper 用；a-z 区间映射，非 ASCII 原样——与仓颉 kernel.cj upper 同语义）
toUpperU :: Char -> Char
toUpperU ch = if ch >= 'a' && ch <= 'z' then toEnum (fromEnum ch - 32) else ch

-- 扫 "key":"<value>" 的字符串值（不处理转义，样例级——与仓颉 jsonStr 同边界）。
-- 必须在 src 中滑动搜索（key 在对象中间，不是开头——首版只匹配头部全 Nothing）。
jsonStr :: String -> String -> Maybe String
jsonStr src key = search ('"' : key ++ "\":") src   -- pat 不含值开引号——pStr 要吃它
  where
    search pat xs = case dropPrefix pat xs of
      Just rest -> case pStr (dropWhile (== ' ') rest) of
        Just (v, _) -> Just v             -- 不解转义，带\\\"引号 截成 带\\——R115 抓到）
        Nothing     -> Just (takeWhile (/= '"') rest)
      Nothing   -> case xs of
        []     -> Nothing
        (_:ys) -> search pat ys
    dropPrefix [] ys       = Just ys
    dropPrefix (p:ps) (y:ys) | p == y    = dropPrefix ps ys
                             | otherwise = Nothing
    dropPrefix _ []        = Nothing

-- 扫 "key":<int>（同样滑动搜索）
jsonInt :: String -> String -> Maybe Int
jsonInt src key = search ('"' : key ++ "\":") src
  where
    search pat xs = case dropPrefix pat xs of
      Just rest -> parseInt rest
      Nothing   -> case xs of
        []     -> Nothing
        (_:ys) -> search pat ys
    dropPrefix [] ys       = Just ys
    dropPrefix (p:ps) (y:ys) | p == y    = dropPrefix ps ys
                             | otherwise = Nothing
    dropPrefix _ []        = Nothing
    parseInt xs =
      let (neg, ds) = case xs of ('-':r) -> (True, r); r -> (False, r)
          digits = takeWhile (\c -> c >= '0' && c <= '9') ds
      in if null digits then Nothing
         else Just (read (if neg then '-' : digits else digits) :: Int)

-- ── 注册表操作（串行进入点，纯 IORef 修改） ───────────────────────────────────────

withReg :: (Reg -> (a, Reg)) -> IO a
withReg f = atomicModifyIORef' gReg (\r -> let (a, r') = f r in (r', a))

-- 构造必须在 IO 里做（newIORef/newTQueueIO）：曾把 unsafePerformIO 内联在函数体，
-- 被 GHC CSE 提升成全程序共享 IORef——所有 Agent 抢同一个状态（实测 alice 的
-- Completed 泄进 bob）。Haskell mutable-state 铁律：分配在 IO 中，绝不靠 unsafePerformIO 惰性。
newAgent :: String -> IO Agent
newAgent nm = do
  st <- newIORef AIdle
  bx <- newTQueueIO
  ct <- newIORef 0
  return (Agent nm st bx ct)

-- 决定名字再入册（缺省名 agent-<id> 需要 id 先行）。两步原子修改：串行进入点下无竞态。
spawnAgent :: Maybe String -> IO (Int, String)
spawnAgent mnm = do
  i <- atomicModifyIORef' gReg $ \(Reg m order nid) ->
    let i' = nid + 1 in (Reg m order i', i')
  let nm = case mnm of Just n | not (null n) -> n; _ -> "agent-" ++ show i
  a <- newAgent nm
  atomicModifyIORef' gReg $ \(Reg m order nid) -> (Reg (M.insert i a m) (order ++ [i]) nid, ())
  return (i, nm)

lookupAgent :: Int -> IO (Maybe Agent)
lookupAgent i = do
  Reg m _ _ <- readIORef gReg
  return (M.lookup i m)

killAgent :: Int -> IO (Maybe String)
killAgent i = withReg $ \(Reg m order nid) ->
  case M.lookup i m of
    Nothing -> (Nothing, Reg m order nid)
    Just a  -> (Just (agName a), Reg (M.delete i m) (filter (/= i) order) nid)

agentList :: IO [(Int, String)]
agentList = do
  Reg m order _ <- readIORef gReg
  return [ (i, maybe "?" agName (M.lookup i m)) | i <- order ]

resetReg :: IO ()
resetReg = writeIORef gReg (Reg M.empty [] 0)

-- ── 响应构造 ─────────────────────────────────────────────────────────────────────

doneList :: [(Int, String)] -> String
doneList xs =
  "{\"count\":" ++ show (length xs)
  ++ ",\"agents\":[" ++ intercalate' [ "{\"id\":" ++ show i
     ++ ",\"name\":\"" ++ esc n ++ "\",\"state\":\"idle\"}" | (i, n) <- xs ] ++ "]}"
  where
    intercalate' [] = ""
    intercalate' ys = foldr1 (\a b -> a ++ "," ++ b) ys   -- foldr1 空列表会崩（首版实测）

-- 邮箱排空（poll 语义：读即清——tryReadTQueue 循环）
drainBox :: TQueue String -> IO [String]
drainBox q = do
  x <- atomically (tryReadTQueue q)
  case x of
    Nothing -> return []
    Just v  -> do rest <- drainBox q; return (v : rest)

-- ── kernel_call 分派 ─────────────────────────────────────────────────────────────

dispatch :: String -> String -> IO (Maybe String)
dispatch m p
  | m == "echo"   = return (Just p)
  | m == "add"    = case (jsonInt p "a", jsonInt p "b") of
      -- 缺参文案与仓颉内核对齐（cjk.html 双内核共用同一断言；R127）
      (Just a, Just b) -> return $ Just $ "{\"sum\":" ++ show (a + b) ++ "}"
      _ -> do setErr "add: params need integer fields a and b"; return Nothing
  -- R127：upper 与仓颉内核契约面对齐（cjk.html ⑥；ASCII 逐字节大写）
  | m == "upper"  = return $ do
      t <- jsonStr p "text"
      Just $ "{\"text\":\"" ++ map toUpperU t ++ "\"}"

  | m == "fib"    = return $ case jsonInt p "n" of
      Just n | n >= 0 && n <= 40 -> Just $ "{\"result\":" ++ show (fibN n) ++ "}"
             | otherwise         -> Nothing
      Nothing -> Nothing
  | m == "error"  = do setErr "error: forced failure for testing"; return Nothing
  | m == "agent.spawn" = do
      (i, nm) <- spawnAgent (jsonStr p "name")
      return (Just $ "{\"id\":" ++ show i ++ ",\"name\":\"" ++ esc nm
                      ++ "\",\"state\":\"idle\"}")
  | m == "agent.list" = do
      lst <- agentList
      return (Just (doneList lst))
  | m == "agent.send" = do
      let mid = jsonInt p "id"; txt = jsonStr p "text"
      case (mid, txt) of
        (Just i, Just t) -> do
          ma <- lookupAgent i
          case ma of
            Just a -> do
              atomically (writeTQueue (agBox a) t)
              modifyIORef' (agCount a) (+ 1)
              n <- readIORef (agCount a)
              return (Just $ "{\"queued\":" ++ show n ++ "}")
            Nothing -> setErr ("agent.send: no agent id=" ++ show i) >> return Nothing
        _ -> setErr "agent.send: params need integer id and string text" >> return Nothing
  | m == "agent.poll" = do
      case jsonInt p "id" of
        Just i -> do
          ma <- lookupAgent i
          case ma of
            Just a -> do
              msgs <- drainBox (agBox a)
              writeIORef (agCount a) 0
              let js = concat [ (if k > 0 then "," else "")
                              ++ "\"" ++ esc v ++ "\"" | (k, v) <- zip [(0::Int)..] msgs ]
              return (Just $ "{\"messages\":[" ++ js ++ "],\"drained\":"
                              ++ show (length msgs) ++ "}")
            Nothing -> setErr ("agent.poll: no agent id=" ++ show i) >> return Nothing
        Nothing -> setErr "agent.poll: params need integer id" >> return Nothing
  | m == "agent.kill" = do
      case jsonInt p "id" of
        Just i -> do
          r <- killAgent i
          case r of
            Just nm -> return (Just $ "{\"killed\":\"" ++ esc nm ++ "\"}")
            Nothing -> setErr ("agent.kill: no agent id=" ++ show i) >> return Nothing
        Nothing -> setErr "agent.kill: params need integer id" >> return Nothing
  -- ── trha 扩展：状态机驱动 ───────────────────────────────────────────────────────
  | m == "agent.transition" = do
      case (jsonInt p "id", jsonStr p "cmd") of
        (Just i, Just cmdStr) -> do
          ma <- lookupAgent i
          case ma of
            Nothing -> setErr ("agent.transition: no agent id=" ++ show i) >> return Nothing
            Just a -> do
              let cmd = parseCmd cmdStr p
              case cmd of
                Nothing -> setErr ("agent.transition: unknown cmd=" ++ cmdStr) >> return Nothing
                Just c -> do
                  old <- readIORef (agState a)
                  let new = transition old c
                  writeIORef (agState a) new
                  return (Just $ "{\"before\":" ++ stateJson old
                                 ++ ",\"after\":" ++ stateJson new ++ "}")
        _ -> setErr "agent.transition: params need integer id and string cmd" >> return Nothing
  | m == "agent.state" = do
      case jsonInt p "id" of
        Just i -> do
          ma <- lookupAgent i
          case ma of
            Just a -> do s <- readIORef (agState a); return (Just (stateJson s))
            Nothing -> setErr ("agent.state: no agent id=" ++ show i) >> return Nothing
        Nothing -> setErr "agent.state: params need integer id" >> return Nothing

  -- ── 作业面（R115：forkIO 真线程，宿主零驱动——GHC 与仓颉泵模型的关键差异） ────
  | m == "agent.submit" = do
      case (jsonInt p "id", jsonStr p "kind") of
        (Just aid, Just kind) -> do
          ma <- lookupAgent aid
          case ma of
            Nothing -> setErr ("agent.submit: no agent id=" ++ show aid) >> return Nothing
            Just _ | kind /= "fib" && kind /= "echo" ->
              setErr ("agent.submit: kind must be fib or echo, got " ++ kind) >> return Nothing
            Just _ -> do
              let n = fromMaybe 0 (jsonInt p "n")
                  t = fromMaybe "" (jsonStr p "text")
              if kind == "fib" && (n < 0 || n > 40) then do
                setErr ("agent.submit: n out of range [0,40], got " ++ show n)
                return Nothing
              else do
                st <- newIORef 0
                val <- newIORef 0
                out <- newIORef ""
                stt <- newIORef 0
                en <- newIORef 0
                let j = Job st kind n t val out stt en
                jid <- atomicModifyIORef' gNextJob (\i -> (i + 1, i + 1))
                atomicModifyIORef' gJobs (\m -> (M.insert jid j m, ()))
                _ <- forkIO $ do
                  -- 协作取消：worker 领取时 CAS 0→2；已 3(cancelled) 则放弃
                  -- （与仓颉出队语义等价——GHC 无队列，靠状态 CAS）
                  claimed <- atomicModifyIORef' st (\s -> if s == 0 then (2, True) else (s, False))
                  if not claimed then return () else do
                    t0 <- getMonotonicTimeNSec
                    writeIORef stt (toInteger t0)
                    if kind == "fib" then do
                      -- 惰性坑：writeIORef val (fibN n) 写入 thunk，fib 会推迟到
                      -- result 查询时才算（时间戳窗只剩 1µs 的实测根因）——evaluate 强制
                      v <- evaluate (fromIntegral (fibN n) :: Int64)
                      writeIORef val v
                    else writeIORef out t
                    t1 <- getMonotonicTimeNSec
                    writeIORef en (toInteger t1)
                    writeIORef st 1
                    atomicModifyIORef' gDoneOrder (\o -> (o ++ [jid], ()))
                return (Just $ "{\"jobId\":" ++ show jid ++ ",\"state\":\"pending\"}")
        _ -> setErr "agent.submit: params need integer id and string kind" >> return Nothing
  | m == "agent.result" = do
      case jsonInt p "jobId" of
        Just jid -> do
          jm <- readIORef gJobs
          case M.lookup jid jm of
            Nothing -> setErr ("agent.result: no job id=" ++ show jid) >> return Nothing
            Just j -> do
              s <- readIORef (jbState j)
              case s of
                1 -> do   -- done（state==1 显式认领，坑 105 纪律）
                  if jbKind j == "fib" then do
                    v <- readIORef (jbValue j)
                    return (Just $ "{\"state\":\"done\",\"value\":" ++ show v ++ "}")
                  else do
                    o <- readIORef (jbOut j)
                    return (Just $ "{\"state\":\"done\",\"text\":\"" ++ esc o ++ "\"}")
                3 -> return (Just "{\"state\":\"cancelled\"}")
                _ -> return (Just "{\"state\":\"pending\"}")   -- 0 pending / 2 in-flight
        Nothing -> setErr "agent.result: params need integer jobId" >> return Nothing
  | m == "agent.cancel" = do
      case jsonInt p "jobId" of
        Just jid -> do
          jm <- readIORef gJobs
          case M.lookup jid jm of
            Nothing -> setErr ("agent.cancel: no job id=" ++ show jid) >> return Nothing
            Just j -> do
              won <- atomicModifyIORef' (jbState j) $ \s ->
                if s == 0 then (3, True) else (s, False)
              if won then return (Just "{\"cancelled\":\"pending\"}") else do
                s <- readIORef (jbState j)
                case s of
                  3 -> return (Just "{\"cancelled\":\"pending\"}")   -- 幂等
                  1 -> return (Just "{\"cancelled\":\"none\",\"state\":\"done\"}")
                  _ -> return (Just "{\"cancelled\":\"none\",\"state\":\"in-flight\"}")
        Nothing -> setErr "agent.cancel: params need integer jobId" >> return Nothing
  | m == "agent.timings" = do
      order <- readIORef gDoneOrder
      jm <- readIORef gJobs
      entries <- mapM (\jid -> case M.lookup jid jm of
        Just j -> do a <- readIORef (jbStart j); b <- readIORef (jbEnd j)
                     return ("[" ++ show a ++ "," ++ show b ++ "]")
        Nothing -> return "[0,0]") order
      return (Just $ "{\"n\":" ++ show (length order) ++ ",\"t\":["
                      ++ concat (zipWith (\k e -> (if k > (0::Int) then "," else "") ++ e)
                                        [(0::Int)..] entries) ++ "]}")

  -- 可观测：当前能力数（诊断 setNumCapabilities 是否生效——C/node 差异定位）
  | m == "sys.caps" = do
      c <- getNumCapabilities
      a <- readIORef gCapsAtInit
      return (Just $ "{\"now\":" ++ show c ++ ",\"atInit\":" ++ show a ++ "}")

  -- ── 状态快照（R115：与仓颉 sys.snapshot 同格式——跨语言互通断言） ──────────────
  | m == "sys.snapshot" = do
      Reg regMap order nid <- readIORef gReg
      entries <- mapM (\i -> case M.lookup i regMap of
        Just a -> do
          msgs <- peekBox (agBox a)
          return ("[" ++ show i ++ ",\"" ++ esc (agName a) ++ "\",\""
                   ++ esc (joinSOH msgs) ++ "\"]")
        Nothing -> return "") order
      let body = concat (zipWith (\k e -> (if k > (0::Int) then "," else "") ++ e)
                                 [(0::Int)..] entries)
      return (Just $ "{\"v\":1,\"nextId\":" ++ show nid
                      ++ ",\"n\":" ++ show (length order) ++ ",\"a\":[" ++ body ++ "]}")
  | m == "sys.restore" = do
      case (jsonInt p "v", jsonInt p "nextId", jsonInt p "n") of
        (Just 1, Just nid, Just n) -> do
          parsed <- parseSnapshotEntries p n
          case parsed of
            Nothing -> do setErr "sys.restore: malformed snapshot"; return Nothing
            Just es -> do
              agents <- mapM (\(i, nm, box) -> do
                a <- newAgent nm
                let msgs = splitSOH box
                atomically (mapM_ (writeTQueue (agBox a)) msgs)
                writeIORef (agCount a) (length msgs)
                return (i, a)) es
              writeIORef gReg (Reg (M.fromList agents) (map fst agents) nid)
              return (Just $ "{\"restored\":" ++ show (length es) ++ "}")
        _ -> do setErr ("sys.restore: bad snapshot (v="
                        ++ show (fromMaybe 0 (jsonInt p "v")) ++ ")")
                return Nothing

  | otherwise = do setErr ("unknown method: " ++ m); return Nothing
  where
    fibN n = if n <= 1 then n else fibN (n - 1) + fibN (n - 2)
    containsKey src k = case jsonStr src k of Just _ -> True; Nothing -> False

parseCmd :: String -> String -> Maybe Cmd
parseCmd c p
  | c == "start"      = Just (CmdStart (maybe "step-1" id (jsonStr p "step")))
  | c == "toolCall"   = Just (CmdToolCall (maybe "call-1" id (jsonStr p "callId"))
                                             (maybe "" id (jsonStr p "tool")))
  | c == "toolResult" = Just (CmdToolResult (maybe "" id (jsonStr p "result")))
  | c == "complete"   = Just (CmdComplete (maybe "" id (jsonStr p "text")))
  | c == "error"      = Just (CmdError (maybe "" id (jsonStr p "error")))
  | otherwise         = Nothing

-- ── 快照/邮箱辅助（R115） ─────────────────────────────────────────────────────────

-- 邮箱只读视图：flush 后原样写回（STM 原子，snapshot 不消费消息）
peekBox :: TQueue String -> IO [String]
peekBox q = atomically $ do
  xs <- flushTQueue q
  mapM_ (writeTQueue q) xs
  return xs

-- 消息以 SOH(\x01) 分隔（与仓颉 jsonEsc 同约定：emit 转义 \" \\ SOH）
joinSOH :: [String] -> String
joinSOH [] = ""
joinSOH xs = foldr1 (\a b -> a ++ "\SOH" ++ b) xs

splitSOH :: String -> [String]
splitSOH s =
  let (h, t) = break (== '\SOH') s
  in if null t then (if null s then [] else [s]) else h : splitSOH (drop 1 t)

-- 定位式解析 snapshot 固定形状：..."a":[[id,"name","box"],...]
-- 先找 "a":[，逐条解析 entry（带 \" \\ \u0001 转义），n 条收尾
parseSnapshotEntries :: String -> Int -> IO (Maybe [(Int, String, String)])
parseSnapshotEntries src n = do
  case breakOn "\"a\":[" src of
    Nothing -> return Nothing
    Just rest0 -> go rest0 n []   -- breakOn 已吞掉 pat（"a":[），rest0 首字符就是 entry 的 [
  where
    go s 0 acc = return (Just (reverse acc))
    go s k acc = case pEntry (dropWhile (== ' ') s) of
      Just (i, nm, box, s') ->
        let acc' = (i, nm, box) : acc
            s''  = dropWhile (== ' ') s'
        in if k == 1 then return (Just (reverse acc'))
           else case s'' of
             (',':r) -> go r (k - 1) acc'
             _       -> return Nothing
      Nothing -> return Nothing

-- 子串搜索（含则返回其后缀）
breakOn :: String -> String -> Maybe String
breakOn pat xs = case xs of
  [] -> Nothing
  _  | take (length pat) xs == pat -> Just (drop (length pat) xs)
     | otherwise -> breakOn pat (drop 1 xs)

-- entry: [123,"name","box"] → (id, name, box, 剩余)
pEntry :: String -> Maybe (Int, String, String, String)
pEntry ('[':s0) = do
  (i, s1) <- pInt s0
  s2 <- pChar ',' s1
  (nm, s3) <- pStr s2
  s4 <- pChar ',' s3
  (box, s5) <- pStr s4
  s6 <- pChar ']' s5
  return (i, nm, box, s6)
pEntry _ = Nothing

pChar :: Char -> String -> Maybe String
pChar c s = case dropWhile (== ' ') s of
  (x:xs) | x == c -> Just xs
  _               -> Nothing

pInt :: String -> Maybe (Int, String)
pInt s0 =
  let s = dropWhile (== ' ') s0
      (neg, ds) = case s of ('-':r) -> (True, r); r -> (False, r)
      digits = takeWhile (\c -> c >= '0' && c <= '9') ds
  in if null digits then Nothing
     else Just (read (if neg then '-' : digits else digits),
                drop (length digits) ds)

-- 带转义的字符串值（snapshot 自产集：\" \\ \u0001 → SOH；宽松回落）
pStr :: String -> Maybe (String, String)
pStr s0 = case dropWhile (== ' ') s0 of
  ('"':s1) -> Just (go s1 "")
  _        -> Nothing
  where
    go [] _ = ("", "")                      -- 失配兜底（外层 pChar ']' 会失败）
    go ('"':r) acc = (reverse acc, r)
    go ('\\':c:r) acc = case c of
      '"'  -> go r ('"':acc)
      '\\' -> go r ('\\':acc)
      'n'  -> go r ('\n':acc)
      'u'  | take 4 r == "0001" -> go (drop 4 r) ('\SOH':acc)   -- \u0001 → SOH
           | otherwise -> go (drop 4 r) acc
      other -> go r (other:acc)
    go (c:r) acc = go r (c:acc)


-- ── 错误缓冲（g_last_error 语义：下次调用前可读，读出由内核接管生命周期） ─────────

{-# NOINLINE gErr #-}
gErr :: IORef String
gErr = unsafePerformIO (newIORef "")

setErr :: String -> IO ()
setErr = writeIORef gErr

-- typed 直调（R112 双轨：同仓颉/纯 C 同名同签名）
kernel_add :: Int64 -> Int64 -> IO Int64
kernel_add a b = return (a + b)

kernel_echo :: CString -> IO CString
kernel_echo cIn = peekCString cIn >>= newCString

-- 契约版本 v1.1（六核心 + typed；无调度符号——GHC RTS 自带线程，无泵契约）
kernel_abi_version :: IO CInt
kernel_abi_version = return 10001

-- C ABI 六核心（名字即 c 符号名，foreign export 原样导出）
kernel_init :: CString -> IO CInt
kernel_init _cfg = do
    -- 真并行能力数（-threaded 只启用能力系统；shared lib 的 -with-rtsopts 无效、
    -- hs_init 带 -N argv 在嵌入宿主下段错误——本 API 是安全路径）
    setNumCapabilities 8
    c <- getNumCapabilities
    writeIORef gCapsAtInit c
    resetReg; resetJobs; writeIORef gErr ""; return 0

kernel_shutdown :: IO CInt
kernel_shutdown = resetReg >> resetJobs >> return 0

kernel_ping :: IO CInt
kernel_ping = return 0

kernel_call :: CString -> CString -> IO CString
kernel_call cMethod cParams = do
  m <- peekCString cMethod
  p <- peekCString cParams
  r <- dispatch m p
  case r of
    Just s  -> newCString s            -- malloc 分配 → 宿主 kernel_free 释放（契约）
    Nothing -> return nullPtr

kernel_free :: Ptr () -> IO ()
kernel_free ptr = if ptr == nullPtr then return () else free (castPtr ptr)

kernel_last_error :: IO CString
kernel_last_error = do
  e <- readIORef gErr
  newCString e                        -- 内核分配，宿主读出即用不长期持有

foreign export ccall kernel_init       :: CString -> IO CInt
foreign export ccall kernel_shutdown   :: IO CInt
foreign export ccall kernel_ping       :: IO CInt
foreign export ccall kernel_call       :: CString -> CString -> IO CString
foreign export ccall kernel_free       :: Ptr () -> IO ()
foreign export ccall kernel_last_error :: IO CString
foreign export ccall kernel_add        :: Int64 -> Int64 -> IO Int64
foreign export ccall kernel_echo       :: CString -> IO CString
foreign export ccall kernel_abi_version:: IO CInt
