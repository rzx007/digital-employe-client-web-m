# browserctl 对齐 agent-browser 命令集（第一轮）— Design Spec

> **关联**：实施计划见 `docs/superpowers/plans/2026-06-30-browserctl-align-agent-browser.md`（随后由 writing-plans 产出）。
> **参考实现**：[vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)（Rust CLI，已读 `cli/src/native/{actions,interaction,element,screenshot,network}.rs`）。
> **分支**：`feat/browserctl-align-agent-browser`。

---

## 1. 目标与范围

把 `browserctl` 命令集向 agent-browser 对齐，补齐高频交互/等待/感知能力，保证命令质量以 agent-browser 实现为参考。**不引入 agent-browser 本体**，runtime 仍绑自有 Electron 内嵌浏览器 + 独立 daemon。

### 第一轮范围（4 个 batch）
1. **交互批**：`hover / dblclick / focus / type / check / uncheck / drag / upload`（8 条）+ 顺带把现有 `fill` 升级为 `Input.insertText`。
2. **wait 增强批**：`wait --url / --load networkidle / --fn / --state hidden`（4 条）。
3. **snapshot 过滤批**：`-c compact / -d N depth / -s sel scope`（3 条）。
4. **screenshot --annotate**：CSS overlay 注入法。

### 暂缓（不在本轮）
`batch` / `rpc --stdio`（Phase 2，性能优化）、sessions、auth vault、video、pdf、`--allowed-domains`、npm publish、多会话 `--session`。

### 非目标
- 不替换内嵌浏览器为独立 Chrome（agent-browser 默认自起 Chrome，我们不学这点）。
- 不改 HITL 机制：`--confirm` 仍只 `click`/`fill` 保留，新交互命令不加 `--confirm`（与 agent-browser 一致——它只有全局 `--confirm-actions`，无逐命令 confirm）。

---

## 2. 架构与改动落点

每条新命令 = 4 处同步：

| 层 | 文件 | 改动 |
|---|---|---|
| CDP 实现 | `packages/browser-sdk/src/controller.ts` | 加方法 |
| HTTP 路由 | `packages/browser-sdk/src/bridge.ts` | 加 `POST /<cmd>` 路由 |
| CLI 分发 | `packages/browserctl/src/index.js` | 加命令分支 + help 文本 + flag 解析 |
| 文档 | `apps/server/build-in-skills/browser-runtime/reference.md` + `SKILL.md` + `packages/browserctl/README.md` + `packages/browserctl-cli/README.md` | 命令清单与说明 |

**复用关系**：`packages/browserctl/src/index.js` 的 `run(argv, baseUrl?)` 被 Electron 内嵌 browserctl（`packages/browserctl/bin`）和 `browserctl-cli`（tsup 内联）共用。新命令加在 controller+bridge 后，两端自动都拿到，**零重复实现**。

**宿主差异**：bridge 持有 `Host`（Electron 走 HITL/产物路径/会话；独立 daemon `StandaloneHost` 自动放行）。新交互命令不涉及 confirm，所以两端行为一致。

---

## 3. Batch 1 — 交互命令（8 条 + fill 升级）

实现以 agent-browser `cli/src/native/interaction.rs` / `element.rs` 为参考。`ref|sel` 解析复用现有 `resolveNode`（`@eN` 走 refCache + `DOM.resolveNode`；CSS selector 走 `Runtime.evaluate` + `document.querySelector`）。

### 3.1 fill 升级为 `Input.insertText`（行为变更，重点回归）
**现状**：`controller.fill` 逐字符 `Input.dispatchKeyEvent {type:"char"}`。
**新法**（对齐 agent-browser `interaction::fill`）：
1. `resolveNode` → `DOM.resolveNode` 取 objectId
2. `Runtime.callFunctionOn("function(){ this.focus(); }")`
3. 清空：`Runtime.callFunctionOn("function(){ this.select && this.select(); this.value=''; this.dispatchEvent(new Event('input',{bubbles:true})); }")`（保留现有 `clearElement` 的 React/Vue setter 思路也可，但简化为 agent-browser 版本）
4. `Input.insertText({ text })` 一次性插入

**风险**：`insertText` 对受控组件的兼容性需回归（现有 `clearElement` 用原型 setter 是为 React 友好；新法 `this.value=''` 直接赋值 + input 事件，React 18+ 已能识别。spec 实现阶段需在真实 React 页面验证，若受控组件失效则保留原型 setter 清空 + insertText 输入的组合）。

### 3.2 `type <ref|sel> <text>`（不清空）
对齐 `interaction::type_text`：
1. resolveNode → objectId
2. `callFunctionOn("function(){ this.focus(); }")`
3. **不清空**
4. `type_text_into_active_context`：逐字符——printable 走 `Input.insertText({text: ch})`；`\n\r\t` 走 `keyDown`+`keyUp`（用现有 `resolveKey`）

### 3.3 `hover <ref|sel>`
对齐 `interaction::hover`：`scrollIntoView` → `getBbox` center → 单次 `Input.dispatchMouseEvent {type:"mouseMoved", x, y}`（无插值）。

### 3.4 `dblclick <ref|sel>`
对齐 `interaction::dblclick`：复用 `click` 流程，`clickCount: 2`（pressed + released 都传 2）。

### 3.5 `focus <ref|sel>`
`resolveNode` → `DOM.resolveNode` → `Runtime.callFunctionOn("function(){ this.focus(); }")`。

### 3.6 `check` / `uncheck <ref|sel>`（三步法，对齐 agent-browser）
**不**用 `el.checked = true`。流程：
1. 读 `isChecked`（对齐 `element::is_element_checked` 四级回退）：
   - native `<input type=checkbox|radio>` → `el.checked`
   - ARIA role ∈ `[checkbox,radio,switch,menuitemcheckbox,menuitemradio,option,treeitem]` → `aria-checked === "true"`
   - `closest('label')?.control` → `ctrl.checked`
   - `querySelector('input[type=checkbox],input[type=radio]')` → `input.checked`
2. 若状态不符期望：`click`（坐标点击）
3. 再读 `isChecked`，若仍不符 → JS-click 兜底：`callFunctionOn` 执行 `.click()`，带 label 重定向（同 is_element_checked 的 label 解析逻辑）
4. 仍不符 → `ok:false, code:"NOT_CHECKABLE"`

### 3.7 `drag <ref|sel> <ref|sel>`（source, target）
对齐 `actions::handle_drag`：
1. resolveNode source center `(sx,sy)`、target center `(tx,ty)`
2. `mouseMoved{sx,sy}` → `mousePressed{sx,sy,button:left,buttons:1,clickCount:1}`
3. **10 步插值**：`for i in 1..=10: cx=sx+(tx-sx)*i/10, cy=sy+(ty-sy)*i/10; mouseMoved{cx,cy,button:left,buttons:1}; sleep 10ms`
4. `mouseReleased{tx,ty,button:left,buttons:0,clickCount:1}`

### 3.8 `upload <ref|sel> <file...>`
对齐 agent-browser `upload_files`（CDP `DOM.setFileInputFiles`）：
1. resolveNode 取 backendNodeId
2. 校验文件路径存在（不存在 → `ok:false, code:"FILE_NOT_FOUND"`）
3. `DOM.setFileInputFiles { files: [absPath...], backendNodeId }`
4. 返回 `{ uploaded: N }`

> 路径语义：文件路径须是 **Chrome/Electron 进程本机可访问**的绝对路径。Electron 内嵌场景即用户机器；独立 daemon 场景即跑 daemon 的机器（与 CLI 同机时一致；未来 daemon 远程化需改为传文件内容，本轮不做）。

### Batch 1 新增错误码
`FILE_NOT_FOUND`（upload）、`NOT_CHECKABLE`（check/uncheck 目标非可勾选项且 JS-click 兜底失败）。复用 `ELEMENT_NOT_FOUND` / `TIMEOUT`。

---

## 4. Batch 2 — wait 增强（4 条）

扩展现有 `controller.waitFor` 轮询 + 新增 networkidle 事件路径。CLI flag 在现有 `wait (--selector|--text|--ms)` 基础上加 `--url / --load / --fn / --state`。

### 4.1 `wait --url <pattern>`
轮询 `Runtime.evaluate("window.location.href")`，glob 匹配（`*`→`.*`，全匹配；`?`→`.`）。超时 `TIMEOUT`。

### 4.2 `wait --load networkidle`
**事件路径**（需 controller 加事件多路复用基础设施，见 §4.5）：
1. `Page.enable` + `Network.enable`
2. 注册临时监听器，等 `Page.lifecycleEvent` 且 `params.name === "networkIdle"`
3. 命中 → `ok:true`；超时 → `TIMEOUT`
4. 移除监听器

### 4.3 `wait --fn <js>`
轮询 `Runtime.evaluate(<js>, returnByValue:true)`，`result.value === true` 即满足。超时 `TIMEOUT`。JS 表达式由调用方负责，不做沙箱（与 agent-browser `wait_for_function` 一致）。

### 4.4 `wait <sel> --state hidden`
扩展现有 `--selector` 路径：`state` 默认 `visible`（现有行为：`document.querySelector` 命中即满足）。新增 `hidden`：命中 null，或元素 `getComputedStyle().display==="none"` 或 `visibility==="hidden"` 即满足。

### 4.5 controller 事件多路复用（唯一基础设施改动）
**问题**：`Transport.on("message", cb)` 是单回调。若 `waitForNetworkIdle` 直接 `transport.on` 会覆盖他人。
**方案**：`BrowserController` 构造时注册一个总 `transport.on("message", dispatcher)`，`dispatcher` 维护 `Set<(method, params) => void>`。新增 `addMessageListener(pred, cb)` / 移除。`waitForNetworkIdle` 临时加一个监听、命中后移除。
**风险**：Electron 与独立 daemon 的 transport 都已实现 `on("message", ...)` 转发 CDP 事件（已确认 `electron-transport.ts` 与 `chrome-transport.ts`）。无并发（bridge 串行处理 HTTP 请求），监听器生命周期清晰。

---

## 5. Batch 3 — snapshot 过滤（3 条）

`packages/browser-sdk/src/ax-tree.ts` 的 `buildRefs` 输出侧增强；CLI flag 映射到 `snapshot` 命令。

| flag | 实现 |
|---|---|
| `-c` / `--compact` | 输出精简：每 ref 一行 `@eN  role  name`，省略无文字/无 role 名的叶子冗余；JSON 模式下保留结构但裁剪空字段 |
| `-d N` / `--depth N` | ax-tree 遍历限深 N（从 RootWebArea 起） |
| `-s sel` / `--scope sel` | 主 frame 用 `DOM.querySelector` 定位子树根 backendNodeId → `Accessibility.getChildAXTree` 或对该子树跑 `getFullAXTree` + 过滤；取不到子树回退整树 |

`--max-nodes` 保留，与 `-c/-d/-s` 可组合。iframe 子树仍按现有逻辑收集（`-s` 仅作用于主 frame）。

---

## 6. Batch 4 — screenshot --annotate

`browserctl screenshot [--annotate] [--out <path>]`。对齐 agent-browser `screenshot::take_screenshot` 的 annotate 分支。

### 流程
1. 取 refCache（无则先 `snapshot()`）
2. 对每个 ref：`DOM.resolveNode{backendNodeId}` → objectId → `Runtime.callFunctionOn("function(){ const r=this.getBoundingClientRect(); return {x,y,width,height}; }")`，过滤 `width>0 && height>0`
3. 按 ref number 排序
4. 注入 overlay（`Runtime.evaluate`）：
```js
(() => {
  const items = <JSON>; const id = "__browserctl_annotations__";
  document.getElementById(id)?.remove();
  const sx = window.scrollX||0, sy = window.scrollY||0;
  const c = document.createElement('div');
  c.id = id; c.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647';
  for (const it of items) {
    const dx = it.x+sx, dy = it.y+sy;
    const b = document.createElement('div');
    b.style.cssText = `position:absolute;left:${dx}px;top:${dy}px;width:${it.width}px;height:${it.height}px;border:2px solid rgba(255,0,0,0.8);box-sizing:border-box;pointer-events:none;`;
    const l = document.createElement('div');
    l.textContent = String(it.number);
    l.style.cssText = `position:absolute;top:${dy<14?'2px':'-14px'};left:-2px;background:rgba(255,0,0,0.9);color:#fff;font:bold 11px/14px monospace;padding:0 4px;border-radius:2px;white-space:nowrap;`;
    b.appendChild(l); c.appendChild(b);
  }
  document.documentElement.appendChild(c); return true;
})()
```
5. `Page.captureScreenshot{format:png}` 拿 base64
6. `Runtime.evaluate("document.getElementById('__browserctl_annotations__')?.remove()")` 移除 overlay
7. 落盘（`--out` 或会话产物目录）+ 返回 `{ path, bytes, annotations:[{ref,number,role,name?,box}] }`

`annotations` JSON 随返回一起给调用方，方便 Agent 对照 @eN 与截图。零 Node 侧图像处理、零新依赖。Electron 与独立 daemon 通用。

---

## 7. 横切

### 7.1 测试
- `packages/browser-sdk/test/controller.test.ts`：每批加 mock-transport 单测（仿现有 13 个模式），覆盖新方法的关键路径（hover 派发 mouseMoved、drag 10 步、check 三步法的 is_checked 回退、annotate overlay 注入/移除调用序列、wait --fn/--state hidden 轮询）。
- `packages/browserctl/test/index.test.js`：加 CLI 分发测试（新命令解析 → 调对应 bridge 路由）。
- 每批末回归：`cd packages/browser-sdk && npx tsx --test test/*.test.ts`、`cd packages/browserctl-daemon && npx tsx --test test/chrome-transport.test.ts test/standalone-host.test.ts`。
- fill 升级为 insertText：单独在真实页面（baidu 搜索框）手动冒烟，确认受控组件不失效。

### 7.2 错误码
新增：`FILE_NOT_FOUND`、`NOT_CHECKABLE`。复用：`ELEMENT_NOT_FOUND`、`TIMEOUT`、`BROWSER_UNAVAILABLE` 等。`reference.md` 错误码表同步。

### 7.3 文档同步
每个 batch 的 commit 必须同步更新 `browser-runtime/reference.md`（命令清单 + 错误码表）、`SKILL.md`（命令清单）、`packages/browserctl/README.md`、`packages/browserctl-cli/README.md`。`examples.md` 按需补新命令用例。

### 7.4 分支与提交
- 分支：`feat/browserctl-align-agent-browser`
- 4 个 batch = 4 个 commit，每个自包含可回归（controller+bridge+CLI+文档+测试一起）
- commit message 前缀 `feat(browserctl):` / `feat(browser-sdk):`（按主要改动面）
- 最终 `superpowers:finishing-a-development-branch` 合回 dev
- 子代理执行时只 `git add` 自己明确列出的文件，禁止 `git add .`/`-A`

### 7.5 与 agent-browser 的差异（保留产品差异）
- 无 `--new-tab`（内嵌浏览器单视口，不开新 tab；独立 daemon 暂不实现多 tab）
- 无 `--session`（暂缓）
- `--confirm` 仍仅 click/fill
- upload 路径是本机绝对路径（agent-browser 同；未来 daemon 远程化再改）

---

## 8. 验收标准
- 4 个 batch 全部落地，4 处同步无遗漏
- `browser-sdk` + `browserctl-daemon` 回归全绿
- `browserctl --help` 列出全部新命令
- 真实页面冒烟：baidu 搜索框 `fill`/`type`/`hover`/`dblclick`/`check`/`screenshot --annotate` 跑通；`wait --load networkidle` 在慢页面生效
- `reference.md` 与 `--help` 一致
