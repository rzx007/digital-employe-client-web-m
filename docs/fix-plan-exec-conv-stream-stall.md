# 修复方案：执行会话流式输出"假结束"（停住、需重进才更新）

> 状态：待评审，**尚未动手**
> 适用场景：从群协作图 / 工作台点进成员"执行会话"，流式输出到中途停住、"看不出在干活"，后台仍在跑，必须切走再切回才看到完整内容。

---

## 一、现象

- 进入正在执行的成员会话，逐字输出到某段文字（如 "let me also check if react-dom is available"）后 **UI 停住**。
- 底部"正在生成"指示器消失，输入框恢复可发送态（蓝色 ↩）。
- 后台 turn **仍在执行**，但后续内容不再实时出现。
- **切走再切回**该会话（重新拉 DB 快照）后，完整内容才出现。

---

## 二、根因（已逐层坐实）

### 后端：正常 ✅
- assistant 消息 `stream_state` 在整个 turn 期间（含 shell 命令执行间隙）**一直是 `"streaming"`**，直到 turn 真正结束才置 `completed`/`error`。
  - 开始置 streaming：`chat_service.py:902`、`group_room_service.py:570/917/1011`
  - 终态写入：`stream_registry.py:239/342/2117`（仅在 turn 结束时由调用方传入终态）
  - 无任何写入点会在工具执行间隙降级 streamState。
- resume 端点按 `stream_state IN ("streaming","queued")` 找可续流：`chat_service.py:979`，后端续流通路是通的。

### 前端：真正的 bug ❌

**核心缺口** — `langchain-chat-transport.ts:800-819`（`processResponseStream` 的读取循环）：

```ts
while (true) {
  const { done, value } = await reader.read()
  if (done) break           // ← SSE 连接断开 = done=true，但 turn 未必结束
  ...
}
...
enqueueFinish(controller, state)   // ← 一律当作正常 finish
controller.close()
```

SSE 流**自然结束但未收到 `[DONE]`**（服务端连接被中间层/超时掐断，而 turn 仍在跑）时，transport **无法区分"`[DONE]` 正常终止"与"连接中途断开"**，一律 `enqueueFinish` + `close()`：

1. `useChat.status` → `ready`、`onFinish` 触发 → 指示器消失、输入框恢复 → UI "假结束"。
2. **断开后不自动重连** → 后端继续产出的 chunk 到不了当前页面 → 必须重进拉 DB。

**已有但不够用的机制**：`shouldAttemptResume` 已支持最多 3 次 resume 重试（退避 `[0,500,1500]ms`，见 `lib/chat/session/resume-decision.ts`）。但这套重试只覆盖"resume 请求本身连不上"，**不覆盖"连上后流到一半断了"**——因为流断时被当成了正常 finish，根本不会触发重试。

**佐证**：`chat-improvement-suggestions.md` 的 R3（"6 ref 隐式状态机，断流重连易竞态"）与 P3 待补测试第 3 条（"断流重连：reconnectToStream 与 sendMessages 并发"）已点名此处为已知薄弱环节。

---

## 三、修复方案（B 根治 + C 兜底 + A 显示，分层）

### B. 区分"流正常终止"与"中途断开"，断开则自动续流（根治）

**B-1 transport 区分终止原因**
在 `processResponseStream` 中跟踪是否见过权威终止信号（`[DONE]` / `stream_ended` / `interrupted` / `error` / `no_stream`）。
- `reader.read()` 返回 `done` 时，若**已见**权威终止 → 正常 `enqueueFinish` + `close()`（现状）。
- 若**未见**权威终止（= 连接被掐断、turn 可能未完）→ **不发 finish**，而是 `controller.error()` 抛一个**可识别的"流中断"错误**（如 `StreamDisconnectedError`，复用现有 `isBenignStreamAbortError` 之外的新标记），交给上层重连。

> 关键：finish 与 error 的语义必须分开。现状把两者合并是 bug 之源。

**B-2 上层捕获中断 → 触发 resume**
`chat-conversation-view.tsx` 的 `useChat.onError` 已有分支：
```ts
onError: (chatError) => {
  if (isBenignStreamAbortError(chatError)) { onRetryResumeRef.current(); return }
  toast.error(...)
}
```
新增分支：识别 B-1 抛出的"流中断"错误 → 调 `retryResumeIfNeeded()`（它会校验 DB 仍是 streaming 才续，并走已有的 3 次退避重试）。
- 注意 `retryResumeIfNeeded` 当前要求 `streamState==="streaming"`（`use-conversation-session.ts:340`）——执行会话场景 DB 此刻确为 streaming，条件成立。
- resume 计数器按 `lastAssistantId` 累加；turn 未变时多次断开会吃同一配额。**需评估**是否在"成功收到新 chunk 后"重置该 assistant 的 resume 计数（否则一个长 turn 多次断开会耗尽 3 次配额）。→ 见风险 R-1。

### C. 兜底轮询（SSE 始终续不上时的保险）

在 `chat-conversation-view.tsx` 或 `use-conversation-session.ts` 增一个**仅执行会话生效**的轻量轮询：
- 条件：`isGroupDeepLinkExecutionView` 为真 **且** 本地 `status` 已非 streaming **且** DB 最后一条 assistant 仍 `streamState==="streaming"`。
- 行为：每 N 秒（如 3~5s）`queryClient.invalidateQueries(messages key)` 拉一次 DB；DB 转终态即停止轮询。
- 价值：即便 B 的 SSE 续不上，内容也能"近实时"补全，不再需要手动重进。
- 复用已有 `scheduleMessagesRefetch`（`use-conversation-session.ts:209`）的防抖 invalidate 思路，避免风暴。

### A. 显示止血（顺带，低成本）

`ChatStreamingIndicator` / `showStreamingIndicator` 当前只看本地 `status`。增补：当 **DB 仍 streaming 但本地 status 掉了** 时仍显示"执行中…"。
- 数据已有：`storedAssistantStreamState` 已传入 `chat-panel.tsx`（:204/228）。
- 改 `showStreamingIndicator` 条件或 `useStreamingHint`，把"DB streaming"也算作应显示进度的状态。
- 即便不做 B/C，A 也能让 UI 不再"假装结束"。

---

## 四、改动文件清单

| 层 | 文件 | 改动 |
|----|------|------|
| B-1 | `lib/chat/langchain-chat-transport.ts` | 跟踪权威终止信号；未终止即断开时抛可识别中断错误而非 finish |
| B-1 | `lib/chat/stream-abort.ts` | 新增"流中断"错误类型 / 判定（与 benign abort 区分） |
| B-2 | `components/chat/views/chat-conversation-view.tsx` | `onError` 增中断分支 → `retryResumeIfNeeded` |
| B-2 | `hooks/use-conversation-session.ts` | 评估 resume 计数在"收到新 chunk 后"重置（R-1） |
| C | `components/chat/views/chat-conversation-view.tsx` 或 `use-conversation-session.ts` | 执行会话兜底轮询 |
| A | `components/chat/panel/chat-streaming-indicator.tsx` + `chat-panel.tsx` | DB streaming 时仍显示进度 |

---

## 五、风险点

- **R-1 resume 配额耗尽**：长 turn 多次断开会吃光 3 次重试。需在"resume 成功并收到新 chunk"后重置该 assistant 计数，否则 B 治标不治本。**这是本方案最需要谨慎处理的一点。**
- **R-2 误把正常 finish 当中断**：必须确保所有权威终止信号（`[DONE]`/`stream_ended`/`interrupted`/`error`/`no_stream`）都被正确识别为"已终止"，否则正常结束的会话会被反复 resume。需对照 `flushEvent` 的全部终止分支逐一核对。
- **R-3 竞态**：resume 与切会话、与 `sendMessages`、与 HITL 审批交叉。现有 `_reconnectAbort` / `cancelReconnect` 已处理部分；改动需保证不破坏（对照 `chat-improvement-suggestions.md` P3 第 3 条）。
- **R-4 双重渲染**：B（SSE 续流）与 C（轮询拉 DB）可能同时补同一段内容。需确保 `pickMessageDisplaySource` / hydrate 的去重逻辑能消解（composer vs DB 同 turn patch，已有 `patchComposerFromStoredWhenSameTurn`）。

---

## 六、验证计划

1. **复现**：群/工作台进一个长执行会话（如 PPT 生成，含多次 shell 调用），观察是否还"假结束"。
2. **B 生效**：DevTools Network 看 SSE 断开后是否自动发起 `/stream/resume`；内容是否实时续上。
3. **C 兜底**：人为阻断 resume（如临时让 resume 返回 no_stream），确认轮询仍能补全。
4. **不回归**：正常单聊会话发送→完成，确认不被误 resume、不重复内容、status 正确收尾。
5. **自动化**：补 `chat-improvement-suggestions.md` P3 第 3 条待补测试——断流重连集成测试。

---

## 七、建议落地顺序

1. **先 A**（显示止血，1 处条件，零风险）——立刻让"看不出在干活"消失。
2. **再 C**（兜底轮询，中低风险）——保证内容最终一定补全。
3. **最后 B**（根治，中风险）——恢复真正的实时续流；重点攻 R-1/R-2。

> A+C 即可解决你描述的 90% 体感问题（不再假结束、内容自动补全），B 让它回到"真正实时"。

---

## 八、2026-06-07 排查记录：「总管跑着跑着不回话」

> 现象（用户原话）：不是工具卡死，**过一段时间总管助手就不对话了**，卡死的流/进程不断堆积。

### 8.1 证据链（按 `~/.digital-employee/logs/app.log` 实测）

- **线程层全空闲**：stall-watchdog dump 的「全线程栈」里，`asyncio_0~11` / `AnyIO worker` / `db-write_0` 栈尾全是 `queue.py:171 get`（等活干），**没有任何线程卡在 shell/文件/skill I/O**。→ 排除线程池死锁。
- **卡点在事件循环的 model 协程**：conv=511（已吐 5830 事件后卡住）协程链 =
  `model → arun_with_retry → RunnableCallable.ainvoke → TodoListMiddleware.awrap_model_call → SkillsMiddleware.awrap_model_call → …`，最深停在 `_runnable.py:501 ainvoke`，`wait_for=<Future pending>`。即**协程永久挂在等模型响应上**。
- **summarization 在栈里但非元凶**：`summarization.py:1086 awrap_model_call` 出现在链里，但那是 langchain 自带 `SummarizationMiddleware` 的常驻 wrap（我方 `_middleware=[]` 只去掉了自建那份），不是卡点本身。
- **502 / 连接错误是噪音**：当日 `chat/completions` 201 次请求中 8 次 502 + 5 次 `APIConnectionError`，但**报错的 turn 能正常以 `status=error` 收尾**（conv=499）；真正「不回话」的是**不报错、无 terminal event 的静默挂起**。用户确认：演示端模型不会断、不是 502。

### 8.2 关键结论：「慢」与「真死」在协程栈上无法区分

两者都停在 `ainvoke` 等 model 响应的 Future 上，长得一模一样。这就是问题本质：
- 砍小判死阈值 → 误杀「慢但正常」的公司（有些公司模型就是慢，需要 ~900s）。
- 保持大阈值 → 真死的拖到默认 **900s** 才回收，用户早已重发/放弃。

### 8.3 已排除的方向（验证过，都不是根因）

| # | 方向 | 排除依据 |
|---|------|---------|
| 1 | 工具 / shell 卡死 | 线程全空闲，卡在事件循环协程 |
| 2 | 共享默认线程池死锁（shell `run_in_executor(None,…)` 占满，skill `to_thread` 抢不到） | dump 里 worker 全闲在 `queue.get()`，池没满 |
| 3 | SkillsMiddleware.before_agent 每 turn 重扫 backend（`event_count=0` 那批） | 是另一类卡死，非本次主诉求 |
| 4 | 模型端 502 / 连接断 | 演示端模型不断；报错能收尾；栈无 httpx 错误帧 |
| 5 | HTTP keepalive / 砍阈值 | 会误杀慢公司；且本机有代理（`HTTP_PROXY=127.0.0.1:10808`）会让 langchain 的 keepalive transport 被 bypass，现场未必生效 |

> 注：判死机制其实**早已存在**（`_auto_kill_no_content_seconds` → `task._asyncio_task.cancel()`），但默认阈值 **900s** 过大，整个日志期间**触发 0 次**——卡死流全靠用户手动重发被动清理。这是「机制有、阈值离谱」而非「缺机制」。

### 8.4 本次实际改动：回退 Windows SelectorEventLoop → 默认 Proactor

用户决定先**排除事件循环变量**做对比。原先为规避「Proactor 在连接重置洪流后 `WinError 10054`、整进程连不上模型」而强制了 SelectorEventLoop，分布在**三处**，已全部回退：

SelectorEventLoop 共在 **4 处**协同设置（这是个坑——分散在 server 源码 + 两个启动入口 + 工厂文件）：

| 文件 | 回退内容 | 入口性质 |
|------|---------|---------|
| `apps/web/electron/features/backend/backend-process.ts` | 删 `--loop src.uvicorn_selector_loop:loop_factory` 两行参数 | **dev 真正入口**（Electron 拉起 `uvicorn src.server:app`） |
| `apps/server/start.py` | 删 `set_event_loop_policy(...)`；`uvicorn.run` 去掉 `loop="none"` | **prod 入口**（PyInstaller 打包成 backend.exe） |
| `apps/server/src/server.py` | 删 import 时 policy 块 + 未用 `import sys`；lifespan「危险:仍是 Proactor」告警改中性 | import 副作用 |
| `apps/server/src/uvicorn_selector_loop.py` | 删除（回退后无引用） | uvicorn `--loop` 工厂 |

**两个关键坑**：
1. **dev 与 prod 是不同入口**：dev 走 Electron `backend-process.ts` 的 `uvicorn ... --loop <工厂>`；prod 走 `backend.exe`（即 `start.py`）。只改一个会另一个不一致。
2. **先删工厂文件 → dev 崩溃**：第一次只删了 `.py`/`start.py`，漏了 ts 里以字符串传的 `--loop`，后端启动即 `Error loading custom loop setup function. Could not import module "src.uvicorn_selector_loop"` → `code 1` 退出。补删 ts 的 `--loop` 后才好。**教训：搜 `--loop` / 工厂时必须连 `.ts/.js` 字符串引用一起搜。**

验证：dev 命令 `uv run uvicorn src.server:app` 启动成功，日志确认 `事件循环 = ProactorEventLoop`。`dist-electron/main/index.js` 里的旧 `--loop` 是编译产物，下次 build 会从改好的 ts 重新生成。

**复发观察**：若回 Proactor 后「满屏 `_call_connection_lost` WinError 10054、curl 同机能连但应用连不上」复现，即坐实 Proactor 是元凶。确认当前循环类型：
```
grep "事件循环 =" ~/.digital-employee/logs/app.log | tail -1
```

### 8.5 中途仍开放（被 8.6 推翻/解决）

- **前端「假结束」**（本文档第二~七节的 A/B/C）：后端慢但活着、前端 SSE 断了当正常 finish 不重连 —— 解释「切走再切回就有了」那一半现象，仍未动。
- ~~若要区分慢 vs 真死，唯一可靠路径是连接健康探测~~ —— 被 8.6 用户澄清推翻：不需要探测连接，「chunk 间隔」就是充分判据。

### 8.6 真正根因 + 落地方案（用户两条关键澄清后定案）

**用户澄清 1（区分慢 vs 死）**：正常生成是 **token 一直在返回**（总时长可能 >900s，但 chunk 之间从不空到 180s）；**180s 没有任何 chunk = 一定挂了**。
→ 于是「慢 vs 死」根本不需要连接探测：**chunk 间隔本身就是判据**。8.2 的悲观结论作废。

**用户澄清 2（"执行完没释放、随时间必然卡死"）+ 活的卡死现场**（conv=515, event_count=3）坐实**真根因**：
- 现场特征：其他接口正常、更新员工正常、**`sqlite-lock` 诊断 0 次** → **不是 DB 锁**（曾误判，已回退，见下）。
- 卡点：`model → ainvoke (_runnable.py:501)` 等 `Future pending`，**model 节点在 pre-httpx 阶段挂死**（langchain `AsyncBackgroundExecutor` 后台 task 卡住），模型请求根本没发出。
- **放大成"必然卡死"的机制**：挂死流 `is_active=True` 且 `asyncio_task` 永不 done，要等 `_agent_stall_timeout`(30min)/`stale_hard_timeout`(12min) 才被回收；而全局并发闸 `AGENT_MAX_INFLIGHT_DEFAULT` **只有 2**。**攒够 2 个挂死流 → 占满槽位 → 所有新对话被拒/排队 → 全局卡死**。这就是"执行完没释放、随时间必然卡死"。
- 另一个误判分支：[stream_registry.py] chunk 超时后「图有 pending 节点 → 续等 `20×chunk_timeout`」——挂死的 model 节点 `state.next` 恒非空 → 续等最长 ~1 小时、最后还假装 `status=completed`（用户一字未收）。

**落地改动（3 项，配套）**：

| # | 文件 | 改动 | 治什么 |
|---|------|------|--------|
| 1 | `stream_registry.py`（+`test_agent_stream_timeouts.py`） | **移除**「图有 pending→续等」整套机制（删 `_graph_has_pending_non_interrupt_work`、`MAX_PENDING_CHUNK_TIMEOUT_RETRIES`、`pending_chunk_timeouts`）；改为 **chunk 超时（180s 无任何 chunk）即判死收尾** | 挂死流快速收尾、**释放槽位**（源头） |
| 2 | `agent_runtime_policy.py` | `AGENT_MAX_INFLIGHT_DEFAULT` / `AGENT_MAX_HEAVY_DEFAULT`：**2 → 4** | 并发槽位缓冲，不被挂死流占满（症状） |
| 3 | （4 处文件，见 8.4） | 回退 SelectorEventLoop → Proactor | 排除事件循环变量 |

**为什么 180s 判死不误杀慢公司**：正常慢生成 token 持续返回、chunk 间从不空 180s（且工具执行期有 tool_output 事件），**走不到这个超时分支**；只有真挂死才会 180s 静默。**不复用** `_auto_kill_no_content_seconds`(900s)——那是留给"慢生成总时长"的，与"chunk 间隔"是两码事。

**heavy/light 澄清**：用户一度以为 heavy/light 是 output token 限制。**实际**：output token 是另一套 `small/standard/large`（`factory.resolve_output_tokens`）；heavy/light 只是并发槽位分级。而该分级在准入层**早已名存实亡**（`can_admit` 内部 `del stream_class`，只看统一总闸），仅剩 `/system/runtime` 监控展示。故"不区分 heavy/light"无需改代码，并发=4 已对所有流一视同仁。保留监控指标不动。

**两条弯路（已回退，留记录免重走）**：
- **SelectorEventLoop**：Selector/Proactor 下都会卡 → 事件循环类型非根因。已回退 Proactor 做对比。
- **SQLITE_ACCESS_LOCK 锁超时**：曾假设 DB 锁死锁，加了 `sqlite_lock(timeout+诊断)`。但现场「其他接口正常 + sqlite-lock 诊断 0 次」证明不是 DB 锁，**已 `git checkout` 回退**。

**验证（需重启后端）**：
```
grep "事件循环 =" ~/.digital-employee/logs/app.log | tail -1   # 应为 ProactorEventLoop
grep "判定流挂死" ~/.digital-employee/logs/app.log             # 挂死流是否 180s 自动收尾（治本生效）
```
重点：**多次对话后是否还"必然卡死"** —— 若 #1 生效（挂死流不再攒着占槽）+ #2 缓冲变大，该现象应消失。
