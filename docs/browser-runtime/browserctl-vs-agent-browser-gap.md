# browserctl 与 agent-browser 能力对照

> 最后更新：2026-07-01  
> 对照对象：[vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)（Rust CLI + Rust Daemon + CDP）  
> 我方实现：`packages/browserctl` + `@workspace/browser-sdk` + Electron HTTP bridge（`:34555`）+ 独立 `browserctl-cli`  
> 关联： [agent-browser-research.md](./agent-browser-research.md) · [browser-runtime-roadmap.md](./browser-runtime-roadmap.md) · [reference.md](../../apps/server/build-in-skills/browser-runtime/reference.md)

---

## 1. 结论摘要

**Agent 日常自动化主路径（`open → snapshot @eN → click/fill → wait → re-snapshot`）已基本对齐。**

Batch 1（交互/等待/snapshot 过滤/annotate）、Batch 5 P1（eval/find/is/dialog/batch/导航）、高频命令（press/scroll/select/get）、同源 iframe snapshot 均已落地。与 agent-browser 的主要差距集中在：

1. **读 DOM 细节**（`get html/count/box/styles`）— Batch 6 候选  
2. **多 tab / 新窗口** — Electron 结构性限制  
3. **Network / Debug / Diff / PDF** — agent-browser 产品化工具链  
4. **Skills 动态下发 / MCP / 安全策略 / 观测 dashboard** — 生态层，非必须照搬  

---

## 2. 已对齐能力

| 类别 | browserctl 命令 | 备注 |
|------|-----------------|------|
| 感知 | `snapshot`（`-c/-d/-s`、`--tree`、`--interactive`） | a11y tree + `@eN` |
| 感知 | `screenshot [--annotate] [--out]` | annotate 用 `captureBeyondViewport` |
| 交互 | `click/fill/hover/dblclick/focus/type/check/uncheck/drag/upload` | `fill` 用 `insertText` 输入段 |
| 键盘/滚动 | `press`、`scroll`、`scrollintoview` | click 前自动 scrollIntoView |
| 表单 | `select` | value / `--label` |
| 等待 | `wait --selector/text/url/load(fn)/--ms` | 含 `networkidle` |
| 读值/断言 | `get url/title/value/text/html/count/box/styles/attr`、`is visible/enabled/checked` | |
| 整页文本 | `extract-text` | 页内 DOM 提取 |
| 语义定位 | `find` positional + flag 模式 | 主 frame only |
| 导航 | `open/navigate`、`back/forward/reload` | |
| 弹窗 | `dialog status/accept/dismiss` | alert/beforeunload 自动 accept |
| 逃生舱 | `eval` | 无 `-b` base64，用 `--file`/`--stdin` |
| 批处理 | `batch [--bail] [--json]` | 省 shell spawn，**仍逐条 HTTP** |
| iframe | snapshot 同源 iframe 拼 `@eN` | 跨源 OOPIF 静默跳过 |
| 独立 CLI | `browserctl-cli`（npm 全局包 + daemon） | 脱离 Electron 的 CI/脚本场景 |

---

## 3. 仍缺 — 建议优先（Batch 6 / 企业场景）

| 缺口 | agent-browser | browserctl 现状 | 影响 |
|------|---------------|-----------------|------|
| **`get html/count/box/styles`** | `get html/count/box/styles <sel>` | ✅ Batch 6 已合入 | — |
| **`get cdp-url`** | 调试用 | 无 | DevTools 外挂 |
| **点击遮挡检测** | 被 banner/modal 挡住时 early fail + 提示覆盖元素 | 无 | 误点、难排查 |
| **全页截图 `--full`** | `screenshot --full` | 普通 screenshot 仅视口 | 长页取证不完整 |
| **`find` 跨 iframe** | `frame <sel>` 切换后 find | `find` 仅主 frame；iframe 内靠 `@eN` | a11y 抓不全的 iframe 无法用 find |
| **多 tab / 新窗口** | `tab new/switch/close`、`click --new-tab` | 单 WebContents；[`window-controller.ts`](../../apps/web/electron/features/browser/window-controller.ts) `setWindowOpenHandler` → **deny** | 「新标签打开」链接丢目标页 |
| **跨源 OOPIF 操作** | `Target.attachToTarget` + frame 切换 | snapshot/find/annotate 均跳过 | 少数跨域 iframe 不可操作 |

**推荐 Batch 6 顺序：**

1. ~~`get html/count/box/styles`~~ ✅ 已合入  
2. 点击遮挡检测  
3. `screenshot --full`  
4. 多 tab（结构性，需 bridge session + 多 WebContents 设计）  
5. `frame` 显式切换 / find 跨 iframe / OOPIF attach  

Spec 占位：`docs/superpowers/specs/2026-07-01-browserctl-batch5-p1-design.md` §9 已列 Batch 6 候选。

---

## 4. 仍缺 — 中优先（特定场景）

| 类别 | agent-browser | browserctl |
|------|---------------|------------|
| 键盘细粒度 | `keyboard type/inserttext`、`keydown/keyup` | 仅 `press` |
| HTTP 读页 | `read [url]`（markdown / llms.txt / outline） | 无；页内用 `extract-text` |
| Cookies / Storage | `cookies`、`storage local/session` | cli 靠持久 profile，无 CLI 读写 |
| State 文件 | `state save/load/list` | 无（profile ≠ state JSON） |
| Network | route/abort/mock、HAR、requests | 无 |
| PDF | `pdf <path>` | 无 |
| Diff | snapshot/screenshot/url diff | 无 |
| Debug | `console/errors/trace/profiler/highlight/inspect` | 无 |
| Browser 设置 | viewport/device/geo/offline/headers/credentials | 无 |
| Clipboard / 鼠标 | clipboard、mouse move/wheel | 无 |
| SPA 导航 | `pushstate` | 无（靠 `open`/`eval`） |
| find action | 含更多 action 变体 | 不含 `select` action |
| Screenshot 选项 | `--screenshot-format/quality/dir` | 仅 `--out` |

---

## 5. 低优先 / 刻意不做

| 类别 | agent-browser | 我方决策 |
|------|---------------|----------|
| **`rpc --stdio`** | JSONL 持久连接 | **不做**：`shell_execute` 每步独立子进程，Electron bridge 已是 daemon；见 [roadmap §3.2](./browser-runtime-roadmap.md) |
| **`batch` 性能** | 同 daemon 内多命令 | 我们只省 shell，**不省 HTTP** |
| **多 session 隔离** | `--session`、`close --all` | Electron 用 `CONVERSATION_ID` 路由面板，非完整多 tab session |
| **Skills 动态下发** | `agent-browser skills get core` | 静态 `SKILL.md` + `reference.md`；远期可考虑 `browserctl skills get` |
| **安全策略** | `--allowed-domains`、`--content-boundaries`、`--confirm-actions` | 桌面 **HITL `--confirm`**（仅 click/fill） |
| **Auth vault** | `auth save/login` 加密凭证 | cli 持久 profile + 手动登录 |
| **AI / React 专项** | `chat`、`react tree/vitals` | 无 |
| **观测** | dashboard `:4848`、`stream` WebSocket | 无 |
| **CDP 外挂** | `connect 9222`、`--auto-connect` | cli 自管 daemon，模型不同 |
| **Chrome 安装器** | `install/upgrade/doctor` | 依赖系统 Chrome/Edge |
| **连接外部 Electron** | `skills get electron` | **不需要**（内嵌 runtime） |
| **MCP server** | `agent-browser mcp` | 无；Agent 走 `shell_execute` + browserctl |

---

## 6. 产品差异（有意保留，非缺口）

| 项 | browserctl / 数字员工 | agent-browser |
|----|----------------------|---------------|
| 浏览器实例 | 主窗口 **WebContentsView** 右栏 | 独立 Chromium / 云浏览器 |
| UI | 右栏面板 + 视口 sync | headless 或 `--headed` 另窗 |
| HITL | React 确认 + bridge `requestBrowserConfirmation` | CLI `--confirm-actions` / policy |
| 调用链 | Skill → `shell_execute` → HTTP `:34555` | Shell → Rust daemon → CDP |
| 桌面专属 | `open-artifact`、`close`（收右栏） | 无 |
| eval 传参 | `--file` / `--stdin` | 另有 `-b` base64 |
| dialog | alert/beforeunload 自动 accept | 同类 + 完整 manual 流 |
| find iframe | 不支持，靠 snapshot `@eN` | `frame` 命令切换 |
| 登录态 | cli：`~/.browserctl/profile-chrome` | profile / state / auth vault 多种 |

---

## 7. 历史文档说明

[`capability-gaps.md`](./capability-gaps.md)（2026-06-03）列出的 press/scroll/select/upload/dialog/eval/iframe 等项**多数已在 Batch 1 / 高频命令 / iframe spec / Batch 5 P1 中完成**。以**本文档**为当前权威差距清单；capability-gaps 仅作历史参考。

已完成的 spec / plan：

- Batch 1：`docs/superpowers/specs/2026-06-30-browserctl-align-agent-browser-design.md`
- Batch 5 P1：`docs/superpowers/specs/2026-07-01-browserctl-batch5-p1-design.md`
- iframe：`docs/superpowers/specs/2026-06-25-browserctl-iframe-support-design.md`
- 双后端：`docs/superpowers/specs/2026-06-26-browser-sdk-dual-backend-design.md`

---

## 8. 参考链接

- agent-browser GitHub：https://github.com/vercel-labs/agent-browser  
- agent-browser 文档站：https://agent-browser.dev/  
- 我方 Skill 权威源：[`apps/server/build-in-skills/browser-runtime/`](../../apps/server/build-in-skills/browser-runtime/)  
- 独立 CLI：[`packages/browserctl-cli/README.md`](../../packages/browserctl-cli/README.md)
