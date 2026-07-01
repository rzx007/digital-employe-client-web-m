# browserctl 对齐 agent-browser 命令集（第二轮 / Batch 5 P1）— Design Spec

> **关联**：第一轮 spec 见 `docs/superpowers/specs/2026-06-30-browserctl-align-agent-browser-design.md`（已合入 `dev`）。实施计划由 writing-plans 随后产出。
> **参考实现**：[vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) README + `cli/src/native/{element,actions,navigation,dialog,batch}.rs`（语义对齐，不引入本体）。
> **分支**：`feat/browserctl-batch5-p1`。
> **修订**：2026-07-01 文档审核反馈已并入（batch 收益、find objectId 路径、dialog/scrollintoview 细节、错误码接线等）。

---

## 1. 目标与范围

补齐第一轮后 **P1 高频缺口**：Agent 兜底执行 JS、元素状态断言、语义定位、浏览器导航与弹窗、等待/load 补全、多命令 batch。runtime 仍绑 Electron 内嵌浏览器 + 独立 daemon，四层同步（controller → bridge → CLI → 文档）。

### 第二轮范围（5 个 batch）

| Batch | 内容 | 新增命令 / 能力 |
|-------|------|----------------|
| **5.1** | JS 执行 + wait load 补全 | `eval`；`wait --load load\|domcontentloaded` |
| **5.2** | 元素读值 + 状态断言 | `get text`；`is visible\|enabled\|checked` |
| **5.3** | 语义定位 | `find role\|text\|label\|placeholder\|alt\|title\|testid\|first\|last\|nth` |
| **5.4** | 导航 + 弹窗 + 滚动 | `back` `forward` `reload`；`dialog accept\|dismiss\|status`；`scrollintoview` |
| **5.5** | 批量执行 | `batch`（argument 模式 + stdin JSON） |

**5.3 体量说明**：10 种 strategy × 8 种 action，实现时可拆 **两个 commit**（不拆 batch 编号）以降低 review 风险：

- **5.3a**：`find first\|last\|nth\|testid\|placeholder` + 全 action（selector 系，逻辑较直）
- **5.3b**：`find role\|text\|label\|alt\|title` + 全 action（DOM/文本匹配较重）

### 仍暂缓（不在 Batch 5）

`get html|count|box|styles`、`find` 之外的 keyboard/mouse、`tab`/`frame`、`cookies`/`network`、`pdf`/`video`、`sessions`/`auth vault`、`--allowed-domains`、`mcp`/`rpc --stdio`（stdio 模式单独 Phase）、`read` HTTP 拉取、`snapshot --urls`。

### 非目标

- 不替换内嵌浏览器架构；不做 `--new-tab` / 多 tab。
- `--confirm` 仍仅 `click`/`fill`；`find … click` 不加 confirm（与 agent-browser 一致，敏感 click 仍走显式 `browserctl click @eN --confirm`）。
- `eval` / `wait --fn` 不做沙箱（与 agent-browser 一致）；Skill 文档强调仅用于受信页面逻辑。

---

## 2. 架构与改动落点

与第一轮相同，每条新命令四层同步：

| 层 | 文件 |
|---|---|
| CDP 实现 | `packages/browser-sdk/src/controller.ts` |
| HTTP 路由 | `packages/browser-sdk/src/bridge.ts` |
| CLI 分发 | `packages/browserctl/src/index.js` |
| 文档 | `apps/server/build-in-skills/browser-runtime/{reference.md,SKILL.md,examples.md}` + `packages/browserctl/README.md` + `packages/browserctl-cli/README.md` |

**batch 特例（5.5）**：CLI 层循环调用 `run(argv, baseUrl)`，**不必**新增 bridge 路由。

- **实际收益**：一次 Node/shell 进程顺序跑多条子命令，省 **进程启动与 quoting**；每条子命令仍经 `postAction` → **HTTP bridge**（与分开执行次数相同）。
- Electron Agent 经 `shell_execute` 调 `browserctl batch …` 时，仍是 **N 次 HTTP**，不是单次 CDP 批处理。
- 若未来 daemon 远程化且需合并往返，再考虑 `POST /batch`（本轮不做）。

**find 前置重构（5.3 必做）**：现有 `click`/`fill`/`runOnElement` 均依赖 `resolveNode(@eN|selector)`；`find` 命中元素**不在 refCache** 且无稳定 selector。5.3 实施前须在 controller 抽取：

```ts
locateInMainFrame(strategy, query, opts) → { objectId, center: {x,y} } | null
runOnObjectId(objectId, funcBody, returnByValue?)
clickAt(x, y)                    // 从 click() 抽出坐标点击
fillOnObjectId(objectId, text)   // focus + clearElement + insertText
typeOnObjectId(objectId, text)
// … hover/focus/check 等同理走 objectId 或 clickAt
```

**禁止**假设 find 结果能转成 `@eN` 再走现有 ref 路径。

**dialog 基础设施**：复用 Batch 2 的 `addMessageListener`。首次 attach 或 controller 构造时确保 `Page.enable`。注册 `Page.javascriptDialogOpening` 分发，维护 `pendingDialog: { type, message } | null`。对 `alert`/`beforeunload` 在事件回调内**同步**发 `Page.handleJavaScriptDialog { accept: true }`（否则后续 CDP 命令会阻塞）。

**错误码接线（必做，全 batch 适用）**：

- controller 新方法返回 `{ ok: false }` 时**必须显式带 `code`**。
- `bridge.ts` 的 `errorCode()` 映射表同步新增 Batch 5 错误码（defense-in-depth，见 §8.2）。
- `reference.md` 错误码表同步。

---

## 3. Batch 5.1 — eval + wait load 补全

### 3.1 `eval <js>`

对齐 agent-browser `eval`（页内 `Runtime.evaluate`）：

```bash
browserctl eval <js> [--timeout 10000]
browserctl eval --file <path> [--timeout 10000]
browserctl eval --stdin [--timeout 10000]
```

优先级：`--file` > `--stdin` > 位置参数。`--timeout` 默认 10_000ms，CLI 可透传 `BROWSER_RUNTIME_TIMEOUT_MS` 作上限参考。

**controller `evaluateJs(js, timeoutMs)`**：

1. `Runtime.evaluate { expression: js, returnByValue: true, awaitPromise: true }`（整体受 timeout 约束；Promise 永不 resolve → `TIMEOUT`）
2. 成功 → `{ ok: true, data: { value: result.result?.value ?? null, type: result.result?.type } }`
3. 异常 → `{ ok: false, error: exceptionDetails.text, code: "EVAL_ERROR" }`

不做 base64 模式（`-b`）—— `--file`/`--stdin` 已覆盖 shell 转义。

### 3.2 `wait --load load | domcontentloaded`

扩展现有 `wait --load networkidle`（Batch 2 已实现）：

| load 值 | 实现 |
|---------|------|
| `load` | `Page.enable` → 探针 `document.readyState === 'complete'`，否则监听 `Page.lifecycleEvent { name: 'load' }`（`addMessageListener` + `try/finally` disposer）→ 超时 `TIMEOUT` |
| `domcontentloaded` | 探针 `document.readyState !== 'loading'`，否则监听 `lifecycleEvent { name: 'DOMContentLoaded' }` |
| `networkidle` | 保持现有 `waitForNetworkIdle` |

bridge `wait` 分支：`load === 'load'` → `waitForLoadEvent('load')`；`load === 'domcontentloaded'` → `waitForLoadEvent('DOMContentLoaded')`。

CLI guard：`--load` 接受 `load|domcontentloaded|networkidle`，非法值 → `CLI_USAGE_ERROR`。

**已知限制**：`domcontentloaded` 探针在 `interactive`/`complete` 时会短路成功；SPA 客户端二次渲染**不会**重发 DCL 事件——与 agent-browser 同类启发式一致，**不能**当作严格的「仅首次 DCL」门禁。文档注明。

### Batch 5.1 错误码

`EVAL_ERROR`（JS 执行异常）。复用 `TIMEOUT`、`BROWSER_UNAVAILABLE`。

---

## 4. Batch 5.2 — get text + is *

### 4.1 `get text <ref|sel>`

```bash
browserctl get text <@eN|selector>
```

**controller `getText(refOrSelector)`**：复用 `runOnElement`：

```js
return (el.innerText ?? el.textContent ?? '').trim();
```

返回 `{ ok: true, data: { text: string } }`；元素不存在 → `ELEMENT_NOT_FOUND`。

CLI：扩展 `get` 子命令，`get text` 与现有 `get value|attr|url|title` 并列。

### 4.2 `is visible | enabled | checked <ref|sel>`

```bash
browserctl is visible <@eN|selector>
browserctl is enabled <@eN|selector>
browserctl is checked <@eN|selector>
```

| 子命令 | 判定逻辑（页内 JS，`runOnElement`） |
|--------|-------------------------------------|
| `visible` | `getComputedStyle` 非 `display:none`/`visibility:hidden` && `getBoundingClientRect()` 的 `width>0 && height>0` |
| `enabled` | `!el.disabled` && `el.getAttribute('aria-disabled') !== 'true'` |
| `checked` | 复用现有私有 `isChecked()` 四级回退；返回 `null`（非可勾选）→ `{ ok: false, code: "NOT_CHECKABLE" }` |

**三态语义**（元素须先被 `runOnElement` 解析到，否则统一 `ELEMENT_NOT_FOUND`）：

| 情况 | 返回 |
|------|------|
| 元素不存在 | `{ ok: false, code: "ELEMENT_NOT_FOUND" }` |
| 存在，条件为真 | `{ ok: true, data: { result: true } }` |
| 存在，条件为假 | `{ ok: true, data: { result: false } }` |

`checked` 额外：`isChecked()` 为 `null` → `NOT_CHECKABLE`（非 true/false 三态）。

---

## 5. Batch 5.3 — find 语义定位

### 5.1 CLI 语法

```bash
browserctl find role <role> <action> [value] [--name <accessibleName>] [--exact]
browserctl find text <text> <action> [value] [--exact]
browserctl find label <label> <action> [value] [--exact]
browserctl find placeholder <ph> <action> [value]
browserctl find alt <text> <action>
browserctl find title <text> <action>
browserctl find testid <id> <action> [value]
browserctl find first <selector> <action> [value]
browserctl find last <selector> <action> [value]
browserctl find nth <n> <selector> <action> [value]
```

**action**：`click` | `fill` | `type` | `hover` | `focus` | `check` | `uncheck` | `text`（**不含** `select`）

- `fill`/`type` 需要 `value`（或 `--text-file`/`--text-stdin`，复用 fill 解析）
- `text` action → locate 后 `runOnObjectId` 读 innerText，返回 `{ text }`
- 其他 action → 经 §2 objectId 路径委托，**不强制先 snapshot**

**选项**：

- `--name`：仅 `find role`；accessible name 过滤（默认 contains）
- `--exact`：
  - `find role --name`：name **全匹配**（默认 contains）
  - `find text` / `find label`：文本 **全匹配**（默认 substring）

**`find nth`**：`<n>` 为 **1-based**（与 agent-browser 一致，`nth 2` = 第二个匹配）。

### 5.2 定位实现

各 strategy 在 `locateInMainFrame(strategy, query, opts)` 中实现（页内 JS，单次 `Runtime.evaluate` 返回 `{ objectId }` 或失败；objectId 由 `Runtime.evaluate` 返回的 `result.objectId` 取得）：

| strategy | 定位逻辑 |
|----------|----------|
| `role` | `[role=X]` + 隐式 role 简化表（button→`<button>`, link→`<a[href]>`…）；`--name` 用 `innerText/aria-label/aria-labelledby/title` |
| `text` | 取**最小**包含文本的可见元素（TreeWalker / XPath）；`--exact` 用 normalize-space 全匹配 |
| `label` | 遍历 `label` 匹配文本 → `label.control` 或 `for` 关联的 input |
| `placeholder` | `input[placeholder], textarea[placeholder]` contains |
| `alt` | `[alt]` contains |
| `title` | `[title]` contains |
| `testid` | `[data-testid="…"]` **精确** |
| `first`/`last`/`nth` | `querySelectorAll` + 索引（nth 1-based） |

命中后按 action 走 §2 objectId 路径。**iframe**：仅**主 frame**；iframe 内仍靠 snapshot `@eN`。

### 5.3 find 返回 envelope

| action | data |
|--------|------|
| `click`/`hover`/`focus`/… | `{}` 或 action 特有（`check` → `{ checked }`） |
| `text` | `{ text: string }` |
| `fill`/`type` | `{}` |

失败：`ELEMENT_NOT_FOUND`（未匹配）、`NOT_CHECKABLE`、`EVAL_ERROR`（定位 JS 异常）。

---

## 6. Batch 5.4 — 导航 + 弹窗 + scrollintoview

### 6.1 `back` | `forward` | `reload`

```bash
browserctl back
browserctl forward
browserctl reload
```

| 命令 | CDP | 后续 |
|------|-----|------|
| `back` | `Page.goBack` | `waitForLoadComplete(30_000)` |
| `forward` | `Page.goForward` | 同上 |
| `reload` | `Page.reload` | 同上 |

成功后返回 `{ ok: true, data: { url, title } }`，其中 **`url`/`title` 必须经现有 `getUrl()` / `getTitle()` 读取当前页**（不要返回 navigate 式的入参 url）。历史栈为空时 CDP 可能 noop——仍读当前 url/title，`ok: true`。

### 6.2 `dialog accept [text]` | `dialog dismiss` | `dialog status`

**自动策略**（对齐 agent-browser 默认）：

- `alert` / `beforeunload`：`javascriptDialogOpening` 回调内**同步** `Page.handleJavaScriptDialog { accept: true }`，不置 pending
- `confirm` / `prompt`：**不**自动处理 → 设 `pendingDialog`

**显式命令**：

- `dialog status` → `{ pending: boolean, type?, message? }`
- `dialog accept [text]` → `handleJavaScriptDialog { accept: true, promptText? }`；无 pending → `{ ok: false, code: "DIALOG_NOT_PENDING" }`
- `dialog dismiss` → `{ accept: false }`；无 pending → `DIALOG_NOT_PENDING`

**bridge 必做**：任意 action 响应若 `pendingDialog != null`，附加 top-level `warning: "JavaScript dialog pending: <type> — <message>"`（**不**改为 `ok:false`，与 agent-browser 一致）。

### 6.3 `scrollintoview <ref|sel>`

将现有 `scrollIntoView` 改为返回 `CdpResult`（**行为变更**：selector 找不到时不再静默）：

```bash
browserctl scrollintoview <@eN|selector>
browserctl scroll-into-view <@eN|selector>   # 别名
```

- 成功 → `{ ok: true }`
- 元素不存在 → `ELEMENT_NOT_FOUND`

**与现有命令关系**：`browserctl scroll @eN` 内部已调同一 `scrollIntoView`——重构后两者错误语义一致。文档写：`scroll @eN` ≡ `scrollintoview @eN`；窗口滚动仍用 `scroll --to` / `--by`。

---

## 7. Batch 5.5 — batch

### 7.1 CLI 语法

```bash
browserctl batch "open https://example.com" "snapshot --interactive" "click @e1"
browserctl batch --bail "open ..." "click @e1" "screenshot --annotate"

echo '[["open","https://example.com"],["snapshot","--interactive"],["wait","--selector","#app"]]' \
  | browserctl batch --json
```

**行为**：

1. 顺序执行；每条解析为 argv，调用 `run(argv, activeBaseUrl)`（**同一 Node 进程**）
2. 每条子命令仍 **HTTP 调 bridge**（与分开执行相同次数）
3. `--bail`：首条 `ok:false` 停止 → `{ ok: false, failedAt: n, data: { results: [...] } }`
4. 默认跑完全部 → 总 `ok` = 全部成功 → `{ ok: true, data: { results: BrowserResponse[] } }`

**限制**：

- batch 内**不可**嵌套 `batch`
- 中间 `close` 后后续可能 `BROWSER_UNAVAILABLE`
- 不新增 `--session`

### 7.2 测试

- `packages/browserctl/test/index.test.js`：顺序、bail、JSON stdin、嵌套 batch 拒绝
- 无需 controller 单测（无新 CDP）

---

## 8. 横切

### 8.1 测试

| Batch | controller.test.ts | index.test.js |
|-------|-------------------|---------------|
| 5.1 | eval 成功/异常/超时；waitForLoadEvent load/DCL + 探针短路 | eval 解析；wait --load guard |
| 5.2 | getText；is 三态 + NOT_CHECKABLE | get text；is 子命令 |
| 5.3 | locate + objectId 路径；find role+name、nth 1-based、clickAt 委托 | find 参数、action、--exact |
| 5.4 | back 后 getUrl；dialog auto-accept + DIALOG_NOT_PENDING；scrollintoview 找不到 | dialog；scrollintoview |
| 5.5 | — | batch bail/json |

每 batch 末回归：`packages/browser-sdk` + `packages/browserctl` + `packages/browserctl-daemon` 全绿。

### 8.2 错误码汇总（Batch 5 新增）

| code | 场景 |
|------|------|
| `EVAL_ERROR` | eval / 定位 JS 抛错 |
| `DIALOG_NOT_PENDING` | `dialog accept/dismiss` 无待处理弹窗 |
| `NOT_CHECKABLE` | `is checked` 目标不可勾选（复用） |

`bridge.ts` `errorCode()` 须加入 `EVAL_ERROR`、`DIALOG_NOT_PENDING`（及已有 `NOT_CHECKABLE` 若尚未映射）。

### 8.3 文档

每 batch commit 同步 `reference.md`、`SKILL.md`、`examples.md`（eval 断言、find role、dialog、batch 工作流）。

### 8.4 分支与提交

- 分支：`feat/browserctl-batch5-p1`
- 5 batch = 5 commit（5.3 可 2 commit 见 §1）；前缀 `feat(browserctl):` / `feat(browser-sdk):`
- 合回 `dev` 前 `pnpm typecheck` + 相关包 test
- 子代理 `git add` 仅列明文件，禁止 `git add .`

---

## 9. 与 agent-browser 的差异（Batch 5 仍保留）

| 项 | browserctl |
|----|------------|
| `eval -b` base64 | 用 `--file`/`--stdin` 代替 |
| `find` 跨 iframe | 不支持，靠 snapshot `@eN` |
| `dialog` auto | 仅 alert/beforeunload 自动 accept |
| `batch` | 省 shell 进程，不省 HTTP；无 rpc stdio |
| `get html/count/box/styles` | Batch 6 候选 |
| HITL `--confirm` | 仍仅 click/fill |

---

## 10. 验收标准

- 5 个 batch 落地，四层（batch 为 CLI+文档三层）同步无遗漏
- `browserctl --help` 列出全部新命令
- 单测全绿；真页冒烟（可选）：baidu `eval "document.title"`、`is visible #kw`、`find role button click --name 百度一下`、`back`/`reload`、`batch` 三步骤
- `reference.md` 与 `--help` 一致
- Skill：优先 snapshot `@eN`；失效时用 `find` / `is` / `eval` 兜底

---

## 11. 状态

**APPROVED** — 审核修订已并入；可由 writing-plans 产出 `docs/superpowers/plans/2026-07-01-browserctl-batch5-p1.md`。
