# browser-runtime 能力差距与待办

> **已过时（2026-06-03）** — 多数项已在 Batch 1 / 高频命令 / iframe / Batch 5 P1 中完成。  
> **当前权威对照**：[browserctl-vs-agent-browser-gap.md](./browserctl-vs-agent-browser-gap.md)

> 最后更新：2026-06-03  
> 对照 agent-browser / playwright 一脉的 a11y-tree 浏览器自动化能力，列出当前 `browserctl` **尚缺**、且对企业系统表单操作有实际影响的功能。按必要性排序（不逐字对照 agent-browser 命令名）。  
> 现状已对照 [`browser-debugger-controller.ts`](../../apps/web/electron/features/browser/browser-debugger-controller.ts) 实际实现确认。

## 🔴 高优先（直接影响基本成功率）

| 缺失 | 为什么必要 | 现状 |
|---|---|---|
| **键盘按键 `press`（Enter/Tab/Esc/组合键）** | 大量搜索框/表单靠回车提交，没有"确认"按钮可点；Tab 切字段 | `fill` 只能输入文本，发不了 Enter |
| **`scroll` / scrollIntoView** | `click` 用元素中心坐标派发鼠标事件（`DOM.getBoxModel` → `Input.dispatchMouseEvent`）。**元素滚出视口时坐标失效，点击落空**。长表单/长列表必踩 | 完全没有，且这是当前 click 的隐性 bug |
| **下拉选择 `select`** | 原生 `<select>` 用坐标点击行为不可靠；企业表单大量下拉 | 没有，只能 click 硬碰 |
| **读元素值 `get value/attribute/html`** | 验证"填进去了吗""当前选中项是什么""链接 href" | 只有整页 `extract-text` 和 snapshot，读不到单元素属性 |

## 🟡 中优先（特定场景必需）

| 缺失 | 场景 |
|---|---|
| **文件上传 `upload`**（`DOM.setFileInputFiles`） | OA/CRM 传附件、传图 |
| **新窗口 / 多 tab** | 当前 `setWindowOpenHandler` 把新窗口 **deny**（[`window-controller.ts`](../../apps/web/electron/features/browser/window-controller.ts)），点"在新标签打开"的链接会丢；且全局单 WebContents、单 `default` session |
| **原生弹窗 `dialog`（alert/confirm/prompt）** | JS 弹窗会**阻塞页面**，没处理会卡死流程 |
| **`eval` 执行任意 JS** | 逃生舱：a11y 抓不到的怪控件、读隐藏状态时兜底 |
| **iframe 内操作** | `Accessibility.getFullAXTree` 默认只主 frame，**嵌 iframe 的企业系统里元素 snapshot 不到** |

## 🟢 低优先 / 可选

`hover`（悬停菜单）、`back/forward/reload`（CLI 没暴露，store 层有 refresh）、`networkidle`（已知暂缓）、cookies 读写（持久 partition 已覆盖登录态，基本不需要）、`pdf` 导出。

## 推荐执行顺序

**🔴 四项性价比最高**——不做就会在真实企业系统里频繁失败，建议打包成一组（一轮 TDD + 测试）：

1. **`press`（尤其 Enter/Tab）** — 改动最小、收益最大，`Input.dispatchKeyEvent` 现成（`fill` 里已用了 char/keydown）
2. **`scroll` + click 前自动 scrollIntoView** — 同时修掉 click 的视口外 bug，建议合并做
3. **`select`** — 下拉
4. **`get value/attribute`** — 验证类读取

🟡 里 **iframe** 和 **新窗口/多 tab** 是结构性的（涉及 frame 路由、多 WebContents），工作量大，建议等真实系统暴露需求再做。**dialog 处理**小而重要，可顺手。

## 已知可绕过的现状

a11y snapshot 修复后（见 [roadmap 3.8](./browser-runtime-roadmap.md)），`@eN` 主路已通；缺失上述能力时，Agent 仍可用 `extract-text` + CSS 选择器兜底（如 `baidu-search` 的硬编码 selector）。对 a11y 退化或结构特殊的已知系统，业务 Skill 写好 CSS 选择器是确定性更高的替代。
