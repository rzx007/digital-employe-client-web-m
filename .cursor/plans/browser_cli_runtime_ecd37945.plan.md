---
name: Browser CLI Runtime
overview: "Phase 0/MVP 已完成：browser-runtime Skill + packages/browserctl + 去 Python。2026-06-03 复核修订：P0 可调用性用 Electron 注入 env（inherit_env=True 透传，无需改 Python）；新增 screenshot 落盘缺陷修复（先于性能）；snapshot --text 提到 P1；rpc --stdio 不适配 shell_execute 模型，建议移除，性能整体降级。"
todos:
  - id: inventory
    content: 梳理并冻结 browser action、payload、错误码与 envelope
    status: completed
  - id: runtime-api
    content: Electron bridge /health + 统一 { ok, data, error, code }
    status: completed
  - id: cli-mvp
    content: packages/browserctl MVP（health/open/snapshot/click/fill/...）
    status: completed
  - id: browser-skill
    content: build-in-skills/browser-runtime 四件套文档
    status: completed
  - id: remove-python
    content: 删除 Python browser 层并移除 create_browser_tools
    status: completed
  - id: migrate-business-skills
    content: baidu-search、oa-overtime 文案改为 browserctl
    status: completed
  - id: docs-research
    content: docs/agent-browser-research.md + roadmap 复盘
    status: completed
  - id: cli-invoke
    content: "P0(代码完成): Electron 注入 BROWSERCTL_PATH + 前置 bin 到 PATH（wrapper browserctl.cmd/browserctl），Skill 文档改裸命令；待桌面端 E2E"
    status: completed
  - id: e2e-baidu
    content: "P0: 员工挂 browser-runtime+baidu-search 端到端验收（含 --confirm）"
    status: pending
  - id: load-stability
    content: "稳定性(已完成): navigate 等 readyState=complete + 新增 browserctl wait --selector/--text/--ms，Skill 工作流改为操作后先 wait 再 snapshot；networkidle 暂未做"
    status: completed
  - id: screenshot-fix
    content: "缺陷(已完成): screenshot 由 CLI 落盘到产物目录(cwd)返 {path,bytes}，bridge 仍回 base64 但不入 Agent 上下文"
    status: completed
  - id: snapshot-text
    content: "P1(已完成): snapshot --tree(全量缩进树)/--interactive(仅可交互平铺) 紧凑文本，纯 CLI 端格式化省 token；注意 --text 已被 wait 占用故用 --tree"
    status: completed
  - id: cli-timeout
    content: "小修(已完成): browserctl 请求加 socket timeout(默认 60s, env 可调)，区分 BRIDGE_TIMEOUT / BRIDGE_CONNECT_FAILED"
    status: completed
  - id: cli-perf
    content: "降级: batch 按需；rpc --stdio 不适配 shell_execute 短命子进程模型，建议移除"
    status: pending
  - id: cli-enhance
    content: "P2(已完成): browserctl close(bridge case + browser:request-close 事件 + renderer reset 收起右栏)、CLI node --test 单测(14 项)接入 turbo test、packages/browserctl README 三场景表"
    status: completed
  - id: electron-bundle
    content: "P3(已完成,安装包已验证): electron-builder(+offline) extraResources 加 ../../packages/browserctl→resources/browserctl；BROWSERCTL_NODE=process.execPath + wrapper ELECTRON_RUN_AS_NODE=1 复用 Electron 自带 node(免装 node)；打包安装版实测正常"
    status: completed
  - id: prd-revision
    content: "P3(已完成): embedded-browser-panel-prd.md 顶部加权威实现现状导读 + 2.1/2.5/3/4/9.1 内联标注废弃(Python @tool/FastAPI 方案)，保留问题动机/HITL/风险作历史；不全文重写"
    status: completed
  - id: default-skill-seed
    content: "P3(已决策-不做): 用户决定不默认分配。browser-runtime 在内置技能库可见、按需手动给员工挂载；浏览器能力按需开启更保守"
    status: completed
isProject: false
---

# browser-runtime 复盘与后续计划

> 仓库内详细版：[docs/browser-runtime/browser-runtime-roadmap.md](docs/browser-runtime/browser-runtime-roadmap.md)

## 复盘摘要（2026-06-03）

### 已交付

- 架构切换：Python `browser_*` → **`browser-runtime` Skill + `shell_execute` + `browserctl` → `127.0.0.1:34555`**
- [`packages/browserctl`](packages/browserctl) 私有 workspace CLI（**不发布 npm**）
- [`apps/server/build-in-skills/browser-runtime/`](apps/server/build-in-skills/browser-runtime/)
- Electron bridge：`/internal/browser/health`、响应 envelope
- 删除 `browser_tool`、`browser_runtime_client`、`http_routes` 等
- 调研文档：[docs/browser-runtime/agent-browser-research.md](docs/browser-runtime/agent-browser-research.md)

### 关键认知

1. **`127.0.0.1:34555`** 是 Electron 主进程内嵌浏览器的本地 HTTP API，不是独立 Chrome。
2. **全局 `browserctl` 命令当前不存在**；开发用 `pnpm --filter @workspace/browserctl browserctl ...` 或 `node packages/browserctl/src/index.js`。
3. **Agent 真跑通的阻塞项**是 shell 里如何稳定找到 browserctl（Phase A），不是 bridge 本身。
4. **可调用性无需改 Python**：`SkillAwareShellBackend(inherit_env=True)` 把 Electron 主进程 env 透传到每次 `shell_execute` 子进程，注入 `BROWSERCTL_PATH`/`PATH` 即可。
5. **`rpc --stdio` 不适配**：`shell_execute` 每次是独立短命子进程，无跨 tool call 常驻 stdin；常驻 daemon 已是 Electron HTTP bridge。

### 未完成 / 风险（2026-06-03 复核修订）

| 优先级 | 项 |
|--------|-----|
| P0 | browserctl 可调用性（Electron 注入 env + Skill 命令示例） |
| P0 | 端到端验收（百度搜索，含 `--confirm`） |
| 缺陷 | `screenshot` base64 经 stdout 撑爆 Agent 上下文 → 落盘返路径 |
| P1 | `snapshot --text` / `--interactive`（从 P2 提级） |
| 小修 | CLI 客户端无 socket timeout |
| 降级 | `batch` 按需；`rpc --stdio` 建议移除 |
| P2 | `close`、CLI 单测、README |
| P3 | Electron 安装包内置 CLI、PRD 全文更新 |

---

## 后续计划

### Phase A — browserctl 可调用性（下一步，首选 env 注入）

1. **首选**：Electron spawn Python 前，往子进程 env 注入 `BROWSERCTL_PATH`（dev=`packages/browserctl/src/index.js`，打包=`resources/browserctl/...`）+ 把含 `browserctl.cmd` 的 wrapper 目录 prepend 到 `PATH`。`inherit_env=True` 会透传，无需改 Python。
2. 更新 `browser-runtime/SKILL.md`、`reference.md`：主路径用 `node "%BROWSERCTL_PATH%" ...`（或裸 `browserctl`），`pnpm --filter` 退为开发备用。
3. E2E：员工分配 `browser-runtime` + `baidu-search`，`pnpm dev:app` 下对话验证（含 `--confirm`）。

### 缺陷修复（先于性能）— screenshot 落盘

`screenshot` 改为写产物目录返路径（`browser-http-bridge.ts:395` 现回 base64，经 stdout 撑爆 Agent 上下文）。

### Phase B — 性能（降级）

- `browserctl batch`：仅固定多步序列有限有用，按需再做。
- ~~`browserctl rpc --stdio`~~：不适配 `shell_execute` 短命子进程模型，**建议移除**。
- CLI 客户端补 socket timeout。

### Phase C — 能力增强

- **snapshot `--text` / `--interactive`（已提至 P1）**：紧凑 a11y 文本树。
- `browserctl close` 与 bridge 对齐
- CLI mock 单测
- 关注单 session 并发（bridge 仅认 `default`，两路操作会静默互踩）

### Phase D — 打包与文档

- 安装目录附带 browserctl
- [embedded-browser-panel-prd.md](docs/browser-runtime/embedded-browser-panel-prd.md) 架构章节修订

---

## 验收清单（更新）

- [x] 无 Python browser 工具与 FastAPI browser 路由
- [x] `browser-runtime` 内置技能目录存在
- [x] 示例 Skill 文案已改为 browserctl
- [x] `health` 在 Electron 运行时可连通
- [ ] Agent `shell_execute` 无需手写仓库绝对路径即可调用 browserctl（Electron 注入 env）
- [ ] 百度搜索 E2E 通过
- [ ] HITL `--confirm` E2E 验证
- [ ] `screenshot` 落盘返路径，不再把 base64 打进 Agent 上下文
- [ ] `snapshot --text` 紧凑文本可用
- [ ] CLI 客户端有 socket timeout
- [ ] ~~`rpc --stdio`~~ 已移除决策（仅 `batch` 按需）
