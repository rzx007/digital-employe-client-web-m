# browser-runtime 文档

数字员工内嵌浏览器自动化（`browser-runtime` Skill + `packages/browserctl` CLI + Electron HTTP bridge）的设计、调研与待办文档集中目录。

## 当前有效

| 文档 | 内容 |
|------|------|
| [browser-runtime-roadmap.md](./browser-runtime-roadmap.md) | **主文档**：复盘、已知缺口、已修复记录（3.7 确认框遮挡 / 3.8 a11y snapshot）、后续计划 |
| [capability-gaps.md](./capability-gaps.md) | **待办**：对照 agent-browser 的能力差距（press/scroll/select/get/upload/iframe…）与推荐顺序 |
| [agent-browser-research.md](./agent-browser-research.md) | agent-browser 范式调研（CDP + a11y tree + `@eN`） |

## 历史 / 背景（含已废弃方案）

| 文档 | 说明 |
|------|------|
| [embedded-browser-panel-prd.md](./embedded-browser-panel-prd.md) | 原始 PRD。顶部有「实现现状」导读；正文的 Python `browser_*` @tool / FastAPI 方案**未采用**，仅作设计背景 |
| embedded-browser-phase1~4-implementation.md | 早期分阶段实现文档（基于原 Python 方案，历史参考） |

## 权威实现入口

- Skill：[`apps/server/build-in-skills/browser-runtime/`](../../apps/server/build-in-skills/browser-runtime/)（SKILL / reference / examples）
- CLI：[`packages/browserctl/`](../../packages/browserctl/)（含 README）
- bridge / CDP：[`apps/web/electron/features/browser/`](../../apps/web/electron/features/browser/)
- env 注入（打包内置 CLI）：[`apps/web/electron/features/backend/backend-process.ts`](../../apps/web/electron/features/backend/backend-process.ts)
