# 解耦 LLM read 超时，让软件扛长任务 设计

日期：2026-06-19
状态：设计待评审

## 背景与问题

总管/员工 agent 执行耗时命令（如递归扫盘 ~94s）→ 前端「请求出错，任务执行失败」，整轮失败、stdout 全丢。用户目标不止修这个 bug，而是**让软件能健壮地扛长任务**（像 Claude Code 一轮跑一小时以上）。

### 根因（已取证坐实）

`~/.digital-employee/logs/main.log` 实证：`[run] conv=756 agent FAILED: ,`（异常 str 为空）→ 栈底 `httpx.ReadTimeout`。即 LLM 的 httpx **read 超时（90s，`apps/server/src/llm/factory.py:137` 的 `read_timeout = min(90.0, req_timeout)`）在命令执行期间触发**：命令在跑、模型 HTTP 连接空闲 >90s，httpx 抛 ReadTimeout → 整条 `agent.astream` 被腰斩 → 走 `except Exception`（`stream_registry.py:2161`）标整轮 error。异常 str 为空 → 文案落到 `format_agent_error_for_user` 的空异常分支（`error_messages.py:20-21`）→ 泛化「任务执行失败」。

### 关键发现（调查 + hermes-agent 对照）

「靠活动看门狗、不靠固定超时」的基础设施**我们已经全建好了**：
- 四道看门狗（first_chunk 120s / chunk 180s / no_content 900s / stale 720s）都基于活动时间戳（`stream_registry.py`）。
- **工具 stdout（`tool_output`）与 30s 心跳（`tool_keepalive`）已在刷新 `touch_progress`/`touch_content`**（`stream_registry.py:1887-1888,1914,1921`）→ 长命令期间看门狗被持续喂活，本不该误杀。
- 唯一病灶：httpx `read_timeout=90s` 是 httpx 自己的「两 read 间最长等待」，与应用层「看活动」机制无关，抢在应用层看门狗前面把长命令期间的模型空窗误判成挂死。
- 「模型真挂死」（连接僵死、无任何活动）的权威判死防线是 **900s no_content watchdog**（`stream_registry.py:1744-1761`，代码注释已写明它才是权威挂死判定）——解耦 read_timeout 后它仍在。

hermes-agent 的前台执行（异步 Popen + 自旋轮询 + `activity_callback` 每 10s 心跳保活防上游超时）验证了这条路；我们已有等价实现（`aexecute` 逐行流式 + `tool_keepalive`），只缺纠正 read_timeout 这层倒挂。

## 设计决策（已与用户确认）

- 方式**丙**：解耦 httpx read_timeout，判死权完全交给应用层「看活动」看门狗。只要有活动（工具 stdout / 心跳 / 模型 chunk）就无限等；连续无活动由 900s no_content watchdog 兜底杀。
- 本期**只解 90s 误杀**这一治本点；不做 hermes 的后台句柄/`session_id`/模型 poll（另一个大特性，超出范围）。
- 「模型真挂死」回收时间从 90s 变为 900s，**保持 900s 默认不动**（长命令有活动不会踩到它；想更快回收是纯配置 `AGENT_NO_CONTENT_KILL_SECONDS`，留给后续按需调）。

## 范围

后端，三处（一处核心 + 两处兜底体感）。

### 改动 1（核心）：解耦 read_timeout

文件：`apps/server/src/llm/factory.py:132-143`

把 `read_timeout = min(90.0, req_timeout)` 改为 `read_timeout = None`（单次 read 无限等，判死交给应用层 900s no_content watchdog）。`httpx.Timeout` 里**只改 `read`**：
```python
read_timeout = None  # 读超时交给应用层活动看门狗（900s no_content）；见 stream_registry no_content watchdog
llm_timeout = httpx.Timeout(
    connect=connect_cap,   # 建连仍有限（≤12s），不放大
    read=read_timeout,     # None = 单次 read 无限等，长命令期间不被 httpx 误杀
    write=30.0,            # 写超时保留
    pool=connect_cap,      # 取连接超时保留有限
)
```
- `connect`/`write`/`pool` **不放大**——它们约束建连/上传/取连接，与「命令执行期模型空窗」无关；放大反而让真连不上时干等。仅解耦 `read`。
- `max_retries=2`（`factory.py:160`）保留。read=None 后「首包卡住」不再由 httpx read 触发，转由应用层 `first_chunk_timeout`（120s）抛错——可接受。
- 同步更新 `:132-136` 的注释（现注释说「降到 90s 让底层 HTTP 先断」，与新行为矛盾）：改为说明 read 交由应用层活动看门狗判死、挂死由 900s no_content 兜底。

### 改动 2（兜底）：error 文案识别 timeout 类异常

文件：`apps/server/src/service/agent/error_messages.py:17-21`

现状：`raw = str(exc)`；`httpx.ReadTimeout` 的 `str()` 为空 → 命中 `if not raw: return "任务执行失败，请稍后重试。"`，永远到不了 `:33` 的 timeout 分支。
改：在 `if not raw:` 分支内（即 str 为空时），先按**异常类型名**兜底识别 timeout 类，给可读文案。即把空分支改为：
```python
    if not raw:
        type_name = type(exc).__name__ if isinstance(exc, BaseException) else ""
        if "timeout" in type_name.lower() or "timedout" in type_name.lower():
            return f"模型 {_active_model_label()} 流式响应超时，请稍后重试。"
        return "任务执行失败，请稍后重试。"
```
（`format_agent_error_for_user` 既有签名接收 `exc: BaseException | str`，能拿到异常对象类型；解耦 read 后这条基本不再触发，但 first_chunk/no_content 等超时仍可能命中空 str，需要好文案。）

### 改动 3（兜底）：error 收尾保留已产出的 assistant 文本

文件：`apps/server/src/service/stream_registry.py:2173`

现状：error 分支 `partial_text = latest_updates_text or None`，丢掉了 `assistant_text_parts`（已产出的模型正文）。而同文件 completed/其它路径（`:2147-2148`）已用 `latest_updates_text or "".join(assistant_text_parts)`。
改：error 分支与之对齐——`partial_text = latest_updates_text or ("".join(assistant_text_parts) or None)`，让失败时已产出的正文被定格而非整轮吞掉（参考 commit 52c4ac6「终止流式优雅收尾」的精神）。
> 说明：工具 stdout（tool_output）是独立流、前端已 live 渲染，不在此 partial_text 范畴；本改动只保证 error 时已累积的 assistant 正文不丢，与既有 sibling 路径口径一致。

### 不在本期范围

- hermes 后台句柄 / `session_id` / 模型 poll/kill（background 模式）—— 另一个大特性，不做。
- `connect`/`write`/`pool` 超时——不动。
- `no_content_kill` 默认 900s——不动（纯配置可后续调）。
- 前端流式 stdout 链路——已通（日志无 `get_stream_writer() returned None`），不动。

## 数据流（修复后）

长命令执行 → 工具逐行 emit tool_output + 30s tool_keepalive → 持续刷 touch_progress/touch_content → 四道看门狗被喂活 → 模型 HTTP read 空闲不再被 httpx 90s 砍（read=None）→ astream 不被腰斩 → 流式 stdout 正常显示、命令跑到底（或用户中途停，cancel 链路已就绪）。模型真挂死（无任何活动）→ 900s no_content watchdog cancel 主协程、标 error、释放 slot。error 时已产出正文被定格、文案可读。

## 测试

后端 pytest（`cd apps/server && uv run pytest`）：
- `factory`：build chat model 后断言其 httpx timeout 的 `read is None`，`connect/write/pool` 仍为有限值（按 build_chat_model 可取到 timeout 的方式断言；若不易取，至少加测覆盖「read_timeout 计算为 None」的纯逻辑）。
- `error_messages`：`format_agent_error_for_user(httpx.ReadTimeout("..."))`（或构造一个 str 为空、类型名含 Timeout 的异常）→ 返回含「超时」的可读文案，不再是「任务执行失败」；普通空异常（类型名不含 timeout）仍返回「任务执行失败」。
- `stream_registry` error 分支 partial：构造 error 时已有 assistant_text_parts、latest_updates_text 为 None → partial_text 为 assistant 正文 join 而非 None（按现有 stream_registry 测试模式；若该分支难单测，以代码审查 + 手动验证覆盖）。
- 手动验证：用那条双重全递归扫盘命令 → 修复后流式吐 stdout、跑到底不再 ~90s 崩；断网/模型挂死场景 → ~900s 被 no_content watchdog 回收、文案可读。

## 风险

- 模型真挂死回收从 90s 变 900s（15 分钟）占 slot——长任务必要代价，已确认接受；想快是纯配置。
- read=None 让首包卡住改由 first_chunk_timeout(120s) 兜——已有该看门狗，可接受。
- 误把 connect/pool 也放大 → 明确只改 read，spec 已强调。
- error_messages 改动只在 str 为空分支加类型识别，不动既有非空分支逻辑，无回归面。
- stream_registry 改动与既有 sibling 路径（:2147-2148）口径一致，低风险。
