# browser-runtime 复盘与后续计划

> 最后更新：2026-06-03  
> 目录索引：[README.md](./README.md) ｜ 能力待办：[capability-gaps.md](./capability-gaps.md)  
> 关联调研：[agent-browser-research.md](./agent-browser-research.md)  
> 架构入口：[apps/web/electron/features/browser/README.md](../../apps/web/electron/features/browser/README.md)

---

## 1. 目标回顾

将内嵌浏览器能力从 **Python LangChain `browser_*` 工具** 迁出，改为：

- **Electron** 持有唯一 runtime（`WebContentsView` + CDP + HTTP bridge `127.0.0.1:34555`）
- **`browser-runtime` 基础 Skill** 教 Agent 工作流（学 agent-browser 形态，不引入 agent-browser）
- **`packages/browserctl`** 作为 CLI 客户端（私有 workspace 包，不发布 npm）
- **员工分配 Skill** 决定是否具备浏览器能力

---

## 2. 已完成（Phase 0 / MVP）

| 项 | 状态 | 说明 |
|----|------|------|
| agent-browser 调研 | 完成 | [agent-browser-research.md](./agent-browser-research.md) |
| Electron `/internal/browser/health` | 完成 | GET，返回 bridge 与内嵌实例状态 |
| 响应 envelope | 完成 | `{ ok, data, error, code }`，`reply()` 统一规范化 |
| `packages/browserctl` | 完成 | MVP：`health/open/navigate/snapshot/click/fill/get url/title/extract-text/screenshot` |
| `build-in-skills/browser-runtime` | 完成 | SKILL + reference + embedded-panel + examples |
| 删除 Python 浏览器层 | 完成 | `browser_tool`、`BrowserRuntimeClient`、`http_routes`、测试、API 注册 |
| Agent 注册清理 | 完成 | `employee.py` / `orchestrator/agent.py` 移除 `create_browser_tools()` |
| 示例业务 Skill 文案 | 完成 | `baidu-search`、`oa-overtime` 改为 `browserctl` + 依赖 `browser-runtime` |
| 文档局部更新 | 部分 | electron README、PRD 顶部「当前实现」注记 |

### 2.1 当前调用链

```
员工 Agent（已分配 browser-runtime + 业务 Skill）
  → shell_execute
  → browserctl（需可解析路径，见下文缺口）
  → HTTP 127.0.0.1:34555
  → browser-http-bridge.ts
  → window-controller + browser-debugger-controller
```

### 2.2 开发环境如何跑 browserctl

**不要**指望全局命令 `browserctl`（未发布 npm、未全局 link）。

任选其一：

```powershell
# 仓库根目录
pnpm --filter @workspace/browserctl browserctl health --pretty

# 或绝对路径（最稳，适合 shell_execute）
node "D:\code\company\digital-employe-client-web-main\packages\browserctl\src\index.js" health --pretty
```

前置：**Electron 桌面端已启动**（`pnpm dev:app`），否则 `BRIDGE_CONNECT_FAILED`。

---

## 3. 已知缺口与风险

> **2026-06-03 代码复核后的优先级修订**
>
> 通读 `browser-http-bridge.ts`、`packages/browserctl/src/index.js`、`skill_shell_backend.py`、`shell_execute_tool.py` 后，对原计划做如下修订：
>
> 1. **P0 实现可不改 Python**：`SkillAwareShellBackend(inherit_env=True)` 会把 Electron 主进程 env 透传到每次 `shell_execute` 子进程，故 Electron 启动 Python 前注入 `BROWSERCTL_PATH` / `PATH` 即可，无需 Python 侧改动（详见 3.1）。
> 2. **新增缺陷级项（高于性能）**：`screenshot` 走 stdout 返回 base64，会撑爆并截断 Agent 上下文，且 LLM 无法读 base64 → 应落盘返路径（详见 3.5）。
> 3. **`snapshot --text` 由 P2 提到 P1**：紧凑 a11y 文本直接决定 token 成本与选对 `@eN` 的成功率，比性能更影响「真跑通」。
> 4. **`rpc --stdio` 建议移除**：`shell_execute` 每次调用是独立短命子进程，跨 tool call 无常驻 stdin；真正的常驻 daemon 已是 Electron HTTP bridge，CLI 再开 daemon 是重复造轮子（详见 3.2）。
> 5. **性能整体降级**：node 冷启动约 100ms，相对 LLM 每轮数秒往返可忽略；`batch` 仅对固定多步序列有限有用，不必优先。

### 3.1 P0：`browserctl` 对 Agent 不可直接调用

| 问题 | 影响 |
|------|------|
| `browserctl` 不在 PATH | `shell_execute` 写裸命令会失败 |
| `shell_execute` cwd 为会话产物目录 | 无法假设在 monorepo 根执行 `pnpm --filter` |
| Skill 仍写 `browserctl open ...` | LLM 易照抄失败命令 |
| 未打包进 Electron 安装目录 | 正式安装版无 CLI |

**短期 workaround**：Skill / 业务 Skill 中写死 `node <repo>/packages/browserctl/src/index.js ...`（每台机器路径不同，不可交付）。

**推荐交付方案（无需改 Python）**：

`SkillAwareShellBackend` 以 `inherit_env=True` 初始化（`skill_shell_backend.py:36`），执行时用 `env=self._env` 起子进程（`skill_shell_backend.py:259` / `:445`）。因此 **Electron 主进程在 spawn Python backend 之前往自身 `process.env` 写入的变量，会自动透传到每次 `shell_execute`**。据此：

1. Electron 启动 Python 时注入：
   - `BROWSERCTL_PATH` = browserctl 入口绝对路径（dev: `packages/browserctl/src/index.js`；打包: `resources/browserctl/...`）
   - 含 `browserctl.cmd` / `browserctl` 的 wrapper 目录 prepend 到子进程 `PATH`
2. `SKILL.md` 主路径改为 `node "%BROWSERCTL_PATH%" ...`（或裸 `browserctl ...`），`pnpm --filter` 退为开发备用。

dev 与打包共用同一写法，无机器相关硬编码，Phase A.1 + A.4 一并解决。

### 3.2 P1→降级：性能（含架构纠正）

每步 `node index.js` 冷启动（约 100ms）+ HTTP 往返。**复核结论**：

- 冷启动相对 LLM 每轮数秒往返可忽略，性能不是「真跑通」的瓶颈。
- **`rpc --stdio` 不适配执行模型**：`shell_execute` 每次调用都是独立短命子进程（`shell_execute_tool.py:72` → backend Popen/run），tool call 之间没有常驻 stdin 管道；而真正常驻的 daemon 已经是 Electron 的 HTTP bridge，CLI 再造一个 daemon 属重复。**建议从计划移除。**
- `batch`（一次 `shell_execute` 内执行固定多步，如 `fill+fill+click`）有限有用，但 Agent 通常需先看 snapshot 再决定 `@eN`，可批场景有限，**按需再做**。

CLI 客户端另有一处小缺陷：`requestJson` 未设 socket timeout（`packages/browserctl/src/index.js:66`），bridge 卡住时会挂到 `shell_execute` 30s 超时才被 kill；应加 `req.setTimeout` 返回 `BRIDGE_TIMEOUT`。

### 3.3 P2：CLI / bridge 能力

| 未做 | 说明 |
|------|------|
| `browserctl close` | bridge 无对应 action；UI 关闭走 IPC |
| `snapshot --text`（**提至 P1**） | 仅 JSON refs，无 agent-browser 式紧凑文本树；直接影响 token 成本与选对 `@eN` 成功率 |
| `snapshot --interactive`（**提至 P1**） | 未过滤可交互节点 |
| CLI 单测 | 无 mock bridge 测试 |
| 内置技能默认分配 | `browser-runtime` 需人工给员工挂载 |

### 3.4 P3：文档与 PRD

[embedded-browser-panel-prd.md](./embedded-browser-panel-prd.md) 正文仍大量描述 Python `browser_*` / `BrowserRuntimeClient`，与实现已分叉，需专项修订或标注「历史章节」。

### 3.5 缺陷：`screenshot` base64 经 stdout 返回（高优先，先于性能）

`screenshot` action 在 bridge 返回 base64（`browser-http-bridge.ts:395`），CLI 直接打到 stdout。而 `shell_execute` 的输出会整段进 Agent 上下文，并在 `_max_output_bytes` 处截断。整页截图 base64 数百 KB → 撑爆上下文 + 被截断 + LLM 无法读 base64。

**建议**：screenshot 落盘到会话产物目录，CLI 仅返回文件路径（或默认不回 Agent，只在右栏 UI 显示）。

### 3.6 单 session 并发风险

`ensureBrowserSession` 写死只认 `"default"`（`browser-http-bridge.ts:109`），全局仅一个 WebContents。两个会话/员工同时操作会静默互相覆盖。MVP 可接受，但建议 navigate/health 时给「忙碌中」提示，避免两路静默踩踏。

### 3.7 已修复：HITL 确认弹窗被内嵌浏览器遮挡（2026-06，已验证）

**现象**：`click --confirm` 的 React `AlertDialog` 被内嵌浏览器挡住，看不到、点不到。

**根因（两层）**：
1. 内嵌浏览器是 Electron 原生 `WebContentsView`，合成层永远盖在 React DOM 之上，`z-index` 无效。
2. 更关键：确认请求到达 renderer 时，`browser-confirmation-host.tsx` 的 `onConfirmationRequest` 调 `openBrowser()` → `controller.open()` → `setVisible(true)` **重新显示视图**，抵消 main 的 hide（附带重置 `pendingLoadUrl` 还会重载当前页）。

**修复**：
- `browser-http-bridge.ts` click 确认分支：确认期间 `getBrowserController().hide()` 让出层级、`finally` 中 `show()` 恢复（`wasVisible` 守卫 + try/finally）。
- `browser-confirmation-host.tsx`：移除 `onConfirmationRequest` 里的 `openBrowser()`（确认弹窗自带截图预览，无需浏览器面板）。

**第三层（残留路径发作，已根治）**：`syncBounds`→`applyViewportLayout` 在确认期间确实会 `setVisible(true)` 抵消单点 hide（BrowserPanel 周期性发 syncBounds）。穷举 `window-controller` 所有 `setVisible(true)` 调用点（`applyViewportLayout` / `show` / `prepareViewportForBridge`），在 controller 加 `visibilitySuppressed` 锁：`setVisibilitySuppressed(true)` 期间 `applyViewportLayout` 与 `show` 都被拦（`prepareViewportForBridge` 是 navigate 路径，与确认不并发，未拦）。bridge 确认分支改用该锁替代 hide/show。这是 defense-in-depth，不再是逐个堵路径。

### 3.8 已修复（已验证）：a11y snapshot 整树为空 /「@eN 从未真正工作过」

**现象**：纯 SPA（ACTUS/Vue 后台）上 `snapshot`/`--interactive`/`--tree` 全空，只返回 `RootWebArea`；Agent 退回 `extract-text` + CSS 选择器。

**真根因（诊断踩了几坑才定位）**：`buildRefs` 构建 `nodeMap` 时按 `typeof nodeId === "number"` 判断，但 **CDP 的 `AXNode.nodeId` / `childIds` 是 string**，导致 nodeMap **恒空**、子节点无法遍历，refs 永远只有 root。铁证：诊断字段 `rawNodes=5549`（树是满的）但 `rootChildCount=1` 且 refs 只有 root。**`@eN` 机制其实从未工作过**——之前百度"通过"是因 `baidu-search` 用 CSS 选择器 `#kw`/`#su`，掩盖了此 bug。

**修复链（三处叠加才完整）**：
1. `Accessibility.enable` + enable 后轮询（确保 a11y 树真的建起来，`rawNodes` 即证据）
2. `ignored` 节点穿透（自身不暴露但继续遍历子节点，否则整棵子树被剪）
3. **`nodeId`/`childIds` 当 string 处理**（让 nodeMap 非空、遍历进子树）— 真正的修复

**工程化**：`buildRefs` 提取为纯函数 `ax-tree.ts`（无 Electron 依赖），加 `ax-tree.test.ts`（node:test + tsx，5 项回归，锁住 string nodeId / ignored 穿透 / mask / 截断）；apps/web 加 `test` 脚本并入 turbo test。

**关联**：iframe 内文档 a11y 不在主树，是另一类问题（未触发，待需要时做）。

### 3.9 已查明（非 bug）：screenshot 需视觉模型才能被 Agent 看到

**现象**：Agent `read` 落盘的 `browser-screenshot-*.png` 返回"无法查看截图"。

**查明**：vision 链路完整——`basic_file_read` 读图返回 base64 → `compatible_filesystem_middleware.handle_compatible_read_result` 生成 `image` content block → `sanitize_messages_for_openai_compatible` 按 `active_model_supports_vision()` 决定：模型支持则转 `image_url` 发出，不支持则降级为文本提示「当前模型不支持图片理解，请切换视觉模型」。

`active_model_supports_vision()`（`llm/vision.py`）基于 `settings.deepagent_model` **名称正则**判断（白名单：`qwen-vl` / `glm-4v` / `gpt-4o` / `claude-3.x` / `gemini-*-pro|flash` / 含 `vision` 等）。

**结论**：截图看不了 = 当前员工配的是非视觉模型。**解决：把该员工模型切到视觉模型**（如 `qwen-vl-max`）。无需改代码；链路本身正确且含友好降级。

### 3.10 已修复：fill 追加拼接（多次 fill 内容串成乱码）

**现象**：某登录页（`/web/digital/#/kanban`）账号/密码经常错。实测是 `fill` **追加模式**——每次 fill 在原内容后拼接，多次调用后变成 `Aab1b2a3d4m5i6nbba…`。

**根因**：`fill` 原实现是 click → **Ctrl+A 全选** → 逐字符输入，依赖"全选后输入替换选中"。该页输入框（受控/自定义组件）对 Ctrl+A 不响应、或输入不替换选中，于是每次 fill 都追加。

**修复**（`browser-debugger-controller.ts`）：用 JS 可靠清空替代 Ctrl+A——通过原型 `value` setter 置空并派发 `input` 事件（React/Vue 受控友好）；`@eN` 走 `DOM.resolveNode`+`callFunctionOn`，selector 走 `Runtime.evaluate`；清空失败不阻断输入。

**待验证**：在该页对同一输入框连续 `fill` 两次，确认第二次是覆盖而非追加。

---

## 4. 验收对照

| 标准 | 状态 |
|------|------|
| 无 `create_browser_tools` / `BrowserRuntimeClient` / FastAPI browser router | 通过 |
| `browser-runtime` 在 build-in-skills 可分配 | 通过（需产品侧给员工挂技能） |
| `baidu-search` / `oa-overtime` 用 browserctl 描述 | 通过（命令形式仍待 P0 修正） |
| `browserctl health` 在 Electron 运行时 ok | 通过（`browser_available` 可为 false 直到 open） |
| HITL `--confirm` 触发桌面确认 | 未在本轮 E2E 验证（bridge 逻辑保留） |
| `rpc --stdio` / `batch` 无冷启动退化 | 未做 |

---

## 5. 后续计划（推荐顺序）

> **修订后推荐顺序（2026-06-03）**
>
> 1. P0：可调用性（Electron 注入 env，见 3.1） + 百度搜索 E2E（含 `--confirm`）
> 2. 缺陷：`screenshot` 落盘返路径（见 3.5）
> 3. P1：`snapshot --text` / `--interactive` 紧凑文本（见 3.3，已从 P2 提级）
> 4. 小修：CLI 客户端加 socket timeout（见 3.2）
> 5. 性能（`batch`）按需；`rpc --stdio` 建议移除（见 3.2）
> 6. 其余（`close`、单测、打包、PRD 修订）维持原 Phase C/D 顺序

### Phase A — browserctl 可调用性（P0，阻塞 Agent 真跑通）

**目标**：Agent `shell_execute` 无需手写仓库绝对路径即可调用。

可选方案（可组合）：

1. **仓库脚本** `scripts/browserctl.ps1` / `scripts/browserctl.sh`  
   - 内部 `node %REPO%/packages/browserctl/src/index.js %*`  
   - Skill 写：`powershell -File "<repo>/scripts/browserctl.ps1" health`

2. **环境变量 `BROWSERCTL_PATH`**  
   - Electron 主进程启动时写入 `process.env` 并注入 Python `shell_execute` 的 `inherit_env`（若尚未传入）  
   - Skill 写：`node "%BROWSERCTL_PATH%" health`

3. **后端 shell 默认 PATH 增强**  
   - `SkillAwareShellBackend` 在 dev 模式追加 `packages/browserctl` 的 `bin` 或 wrapper 目录

4. **更新 Skill 文案**  
   - `browser-runtime/SKILL.md`、`reference.md`：主路径改为 wrapper / `BROWSERCTL_PATH`，`pnpm --filter` 仅作开发备用

**验收**：给员工挂 `browser-runtime` + `baidu-search`，对话「搜一下 xxx」能打开右栏并完成搜索（人工看一轮）。

---

### Phase B — CLI 性能（降级，原 P1）

> **复核后降级**：node 冷启动相对 LLM 往返可忽略；`rpc --stdio` 不适配 `shell_execute` 短命子进程模型，建议移除（见 3.2）。`batch` 仅按需。以下为原始设想，留作参考。

**目标**：对标 agent-browser `batch` / daemon。

| 任务 | 说明 |
|------|------|
| `browserctl batch` | 单次进程多命令；或 stdin JSON 数组 |
| `browserctl rpc --stdio` | JSONL 持久连接，Agent 长流程主路径 |
| Skill 推荐 | 长流程写「优先 rpc」，调试写单次命令 |

**验收**：连续 10 步 snapshot/click 总耗时明显低于 10 次独立 spawn。

---

### Phase C — CLI / bridge 增强（P2）

| 任务 | 说明 |
|------|------|
| `snapshot --text` / `--interactive`（**已提至 P1**，见修订顺序） | 紧凑 a11y 文本 + 可选仅可交互节点 |
| `browserctl close` | bridge + IPC 对齐 UI 销毁语义 |
| `packages/browserctl` README | 安装、dev、Agent 三场景命令表 |
| CLI 单测 | mock `127.0.0.1:34555` |

---

### Phase D — 打包与产品化（P3）

| 任务 | 说明 |
|------|------|
| Electron 打包附带 `browserctl`（配置就绪，待安装包验证） | electron-builder(+offline) extraResources 加 `../../packages/browserctl` → `resources/browserctl`；`BROWSERCTL_NODE=process.execPath` + wrapper `ELECTRON_RUN_AS_NODE=1` 复用 Electron 自带 node，**免装 node**。dev 已验；真实安装包需验 `from` 的 `..` 路径解析与无-node 机器 |
| ~~内置技能种子~~（已决策不做） | 用户决定不默认分配；`browser-runtime` 在内置技能库可见，按需手动给员工挂载 |
| PRD 修订 | 架构图改为 Skill + browserctl；删 Python 章节或标废弃 |

---

### Phase E — 远期（可选）

- `browserctl skills get core`（版本化 Skill 内容，学 agent-browser）
- 按对话 `session_id` 多实例（当前仅 `default`）
- 域名白名单 / action policy

---

## 6. 建议的下一步（本周）

若只选一件事：**用 3.1 的「Electron 注入 env」方案打通 P0**（注入 `BROWSERCTL_PATH` + 改 `SKILL.md` 命令示例，无需改 Python），再跑一轮「百度搜索」端到端（含 `--confirm`）。

若并行两人：

- 一人：P0 可调用性 + E2E
- 一人：`screenshot` 落盘返路径（3.5）+ `snapshot --text`（3.3）

> 不再建议投入 `rpc --stdio`（见 3.2）。

---

## 7. 文件索引

| 路径 | 职责 |
|------|------|
| `packages/browserctl/src/index.js` | CLI 入口 |
| `apps/web/electron/features/browser/browser-http-bridge.ts` | HTTP runtime |
| `apps/web/electron/features/browser/browser-debugger-controller.ts` | CDP |
| `apps/server/build-in-skills/browser-runtime/` | 基础 Skill |
| `apps/server/build-in-skills/baidu-search/` | 业务示例 |
