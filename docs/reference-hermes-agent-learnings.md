# 参考分析：Hermes Agent 有哪些值得借鉴

> 对 Nous Research 的 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 代码库的分析，对照本项目（数字员工/总管系统）找可借鉴点。
> Hermes = 单用户「自进化个人 AI 代理」；我们 = 多员工「总管编排团队」。主题高度重叠（学习闭环/技能/记忆/cron/上下文文件/MCP），差异处是借鉴富矿。
> 文件路径均指 Hermes 仓库（`D:\code\personal-project\hermes-agent`）。

---

## 一、我们已经对齐 / 不落后的（先确认）

- **信号闸门学习闭环**：我们 journal→reflection(信号 critic)→librarian 复盘→profile 回喂，与 Hermes background_review fork + curator 同philosophy（后台异步、不占主流程）。
- **候选不自动转正**：我们 promote_skills 只造候选、人采纳才转正；Hermes curator「绝不删除、最多归档」，都遵循「自动产出 + 保守生效」。
- **延迟工具目录**：我们有 ToolSearch（deferred tools）；Hermes 有 tool_search/tool_describe 动态目录——同款「零 footprint 工具发现」。
- **提示词缓存意识**：我们把名册/快照移出可缓存前缀、稳定前缀 + 易变段分离；Hermes 三层（stable/context/volatile）+「缓存神圣」同理。
- **MCP 集成、定时任务、上下文文件(AGENTS.md)**：双方都有。

---

## 二、🔴 高价值借鉴（正好补我们已知短板）

### A. 技能「在使用中自我改进」——补我们「promote 只造、不改」的盲区
**Hermes 怎么做**（`agent/background_review.py::_SKILL_REVIEW_PROMPT`）：每轮结束后 fork 一个**受限工具集**（仅 memory+skill_manage）的后台 agent，按一套「技能更新优先级」决策：
1. **先 patch 本轮加载过、却被发现错/缺/过时的技能**（它正在用 → 最该修）；
2. 再 patch 已有「伞形/类级」技能；
3. 再加 `references/<topic>.md` 支撑文件；
4. 都不匹配才新建（且名字必须**类级**，禁止 `fix-X/debug-Y` 这种 session 专属）。
**关键**：① **用户纠正/不满是一等技能信号**（"别这么啰嗦"→直接写进技能，不只进记忆）；② 技能携带「**对这个用户怎么做**」的偏好，不只是通用 SOP。

**对照我们**：`promote_skills` 只在「重复≥3 成功」时**新建候选**，**从不 patch 已有技能**，也没把「用户纠正/返工」喂进技能层（我们 reflection 只写 memory）。
**建议**：给学习闭环加一条「**技能修订**」路径——当某员工带着一个已有技能干活、却被返工/纠正时，提炼成对**那个技能**的 patch 候选（而非只写 memory）。这把「越用越强」从"造新技能"扩到"老技能越用越准"。对应我们 backlog 里延后的「用户纠正信号」。

### B. 技能/员工生命周期 curator——落地我们延后的「防膨胀」
**Hermes 怎么做**（`agent/curator.py`）：状态机 `ACTIVE→STALE(30天闲置)→ARCHIVED(90天闲置)`，**绝不删除**、pinned 技能豁免、按 use/view/patch 计数驱动，**仅闲置时**后台跑（不占用户）。

**对照我们**：方法论 §2.2 写了「定期复盘退休/合并闲置专才与技能」防膨胀，但**未实现**——技能/员工只增不减，画像/候选会越堆越多。
**建议**：给 librarian 加一个保守的生命周期 curator——闲置技能/员工标 stale→archived（绝不删、可恢复、pinned 豁免），近重复候选合并。正好治我们 #2 残留的「近义 slug 近重复候选」。

### C. shell 硬底线黑名单 + 命令归一化——补我们 P1-A「员工 HITL-off 无闸」的安全短板
**Hermes 怎么做**（`tools/approval.py`）：
- **三层**：`HARDLINE_PATTERNS`（rm -rf /、mkfs、dd、fork bomb…**永不执行，即便 YOLO**）→ smart（LLM 评风险）→ manual（逐条审批）；
- **检测前归一化**（`_normalize_command_for_detection`：剥 ANSI、Unicode NFC、展开路径、去反斜杠）防混淆绕过；
- **YOLO 在模块加载时冻结**，防进程内 skill 改 env 绕审批；
- **信任模型直白**：进程内启发式**不是安全边界**，OS 隔离（容器/SSH）才是。

**对照我们**：我们 destructive_hitl 只管**总管自己的 delete_* 工具**；**被派员工 `enable_hitl=False` 跑 shell，没有任何底线**（我在复盘 C 类标过这个真实风险）。P1-A 自动执行的「破坏性词」判定也**没做归一化**（易被 `r\m -rf` 之类绕过）。
**建议**（高性价比）：① 加一条**代码级 hardline shell 黑名单**，对**所有**员工（含 HITL-off）生效，作为最后底线；② 给 confirmation_policy 的破坏性词检测加**命令归一化**再匹配。这两条不依赖模型遵从、改动小，直接堵 P1-A 的安全洞。

---

## 三、🟠 有价值、工程量中-大

### D. Python 脚本 via RPC 调工具——「零上下文开销」的多步管道
**Hermes 怎么做**（`tools/code_execution_tool.py`）：agent 写 Python 脚本，脚本里 `from hermes_tools import web_search, read_file, terminal` 直接调工具；调用经 **UDS（本地）/ 文件-RPC（远程）** 回父进程执行，**中间结果全留在脚本里、不进消息历史**，只有脚本 stdout 返回 LLM。多步链从「N 轮 + 累积 context」压成「1 轮脚本 + 1 轮读 stdout」。env 还做了 secret 黑名单清理。
**对照我们**：员工多步靠多次工具调用（每个结果进 context）或 shell。没有「脚本无 context 成本地编排我们自己的工具」。
**建议**：值得做一个「员工脚本沙盒 + 工具 RPC」给数据类管道（查→处理→生成）省 token、省轮次。是个大特性，列入候选。

### E. FTS5 跨会话搜索——给总管/员工「翻旧账」的能力
**Hermes 怎么做**（`hermes_state.py` FTS5 + `tools/session_search_tool.py`）：SQLite FTS5（CJK 用 trigram 分词）BM25 检索历史消息，一个工具四形态（discovery/scroll/read/browse），**摘要由 agent 自己决定**（不自动摘要、省钱）。
**对照我们**：总管的再入快照只覆盖**当前计划**；没有「搜过去的委派/产出/对话」的能力。
**建议**：加一个 FTS5 会话/对话搜索工具，让总管能据历史复用过往成果、员工能查自己干过的同类活。中等价值。

### F. 沙箱化员工执行（Docker 后端）——真正的安全边界
**Hermes 怎么做**（`tools/environments/*`）：六后端统一接口（local/docker/ssh/daytona/singularity/modal），Docker 后端 `--cap-drop ALL`+精选、`no-new-privileges`、`--pids-limit`、tmpfs noexec、孤儿容器按标签回收；**容器即边界，故容器后端跳过命令审批**。
**对照我们**：桌面单机、仅 local。要根治「员工无闸跑 shell」，沙箱是真边界。但对 Electron 桌面应用是重改造。
**建议**：作为「安全加固」的可选项长期考虑；近期先用 B-C 的 hardline 底线兜。

---

## 四、🟡 细节/原则可借鉴

- **上下文压缩两招**（`agent/context_compressor.py`）：① 再压缩时**增量更新上一版摘要**（非重生成，省钱+连续性）；② **抗抖动闸**（最近两次各省<10% 就跳过，防无限压缩）。→ 可作为我们 SummarizationMiddleware 的精修。
- **cron 硬化**（`cron/scheduler.py`）：3 分钟硬中断 runaway、跨进程文件锁防重复执行、catchup 窗口、cron 会话 `skip_memory`（不污染记忆）、危险命令默认拒绝。→ 我们定时任务可借这些健壮性细节。
- **Footprint Ladder**（AGENTS.md）：加能力按**最低 footprint** 优先（扩现有码 → CLI+skill → service-gated tool → plugin → MCP → core tool 最后），保持核心工具「窄腰」。→ 一条好的设计原则，可写进我们规范。
- **上下文文件防注入**（`agent/prompt_injection_scanner.py`）：扫 AGENTS.md/规则文件里的注入模式（"忽略指令"/.env 泄露/隐形 Unicode）。→ 我们员工读用户上传/产物时可借鉴扫一遍。
- **凭据按工具粒度 + check_fn 门控 + 子进程 env 黑名单**：工具未配置就不出现在 schema；execute/MCP 子进程剥掉含 KEY/TOKEN/SECRET 的 env。→ 我们 shell/技能子进程的凭据隔离可对齐。
- **DM 配对**（`gateway/pairing.py`）：散列存码 + 速率限制 + 失败锁定 + 不可混淆字母表。→ 若我们做外部消息入口（飞书等）可借。

---

## 五、最高优先建议（若要动手）

1. ~~**C（shell hardline 底线 + 命令归一化）**~~ → ✅ **已落地**（commit `2c9ed202`）：`command_safety.py` 灾难级硬底线接入 `SkillAwareShellBackend.execute/aexecute` 单一咽喉，对所有 agent 生效、不靠模型遵从。经独立 code-review 修掉「sudo 前缀绕过」等 bypass。注：这是 floor 不是完整沙箱（F 才是）。
2. **A（技能在使用中自我改进 / 用户纠正进技能层）** — 把「越用越强」从造新技能扩到老技能越用越准，补已延后的用户纠正信号。
3. **B（技能/员工生命周期 curator）** — 落地延后的「防膨胀」，顺带治近重复候选。
4. （中长期）**D 脚本-RPC 管道**、**F 员工沙箱**、**E FTS5 跨会话搜索**。

> 这些是「值得借鉴」的方向清单，非即时待办。对照本项目复盘见 [orchestrator-optimization-retrospective.md](orchestrator-optimization-retrospective.md)；方法论见 [agent-orchestration-methodology.md](agent-orchestration-methodology.md)。
