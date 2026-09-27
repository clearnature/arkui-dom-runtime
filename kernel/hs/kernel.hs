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
    f '"'  = "\\\""
    f '\\' = "\\\\"
    f '\n' = "\\n"
    f c    = [c]

-- 扫 "key":"<value>" 的字符串值（不处理转义，样例级——与仓颉 jsonStr 同边界）。
-- 必须在 src 中滑动搜索（key 在对象中间，不是开头——首版只匹配头部全 Nothing）。
jsonStr :: String -> String -> Maybe String
jsonStr src key = search ('"' : key ++ "\":\"") src
  where
    search pat xs = case dropPrefix pat xs of
      Just rest -> Just (takeWhile (/= '"') rest)
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
  | m == "add"    = return $ do
      a <- jsonInt p "a"; b <- jsonInt p "b"
      Just $ "{\"sum\":" ++ show (a + b) ++ "}"
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
kernel_init _cfg = do resetReg; writeIORef gErr ""; return 0

kernel_shutdown :: IO CInt
kernel_shutdown = resetReg >> return 0

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
