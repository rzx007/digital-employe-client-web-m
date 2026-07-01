# browserctl 命令参考

`browserctl` 是数字员工内嵌浏览器的命令行入口。它连接 Electron 主进程的本地 bridge：`http://127.0.0.1:34555`。

## 输出格式

所有命令默认输出 JSON：

```json
{
  "ok": true,
  "data": {}
}
```

失败时：

```json
{
  "ok": false,
  "error": "BROWSER_UNAVAILABLE",
  "code": "BROWSER_UNAVAILABLE"
}
```

常见错误码：

| code | 含义 |
|------|------|
| `BRIDGE_CONNECT_FAILED` | 无法连接 Electron bridge |
| `BRIDGE_TIMEOUT` | 请求超时（默认 60s，`BROWSER_RUNTIME_TIMEOUT_MS` 可调） |
| `BROWSER_UNAVAILABLE` | 内嵌浏览器实例不可用 |
| `BROWSER_VIEWPORT_NOT_READY` | 右栏视口尚未完成布局 |
| `ELEMENT_NOT_FOUND` | 元素引用或选择器未找到 |
| `OPTION_NOT_FOUND` | `select` 下拉项按 value/label 都未匹配到 |
| `NOT_CHECKABLE` | `check`/`uncheck` 目标非 checkbox/radio，无法勾选 |
| `FILE_NOT_FOUND` | `upload` 给定的文件路径不存在 |
| `USER_CANCELLED` | 用户取消确认 |
| `TIMEOUT` | 操作超时（含 `wait` 超时） |
| `EVAL_ERROR` | `eval` JS 执行异常 |
| `EMPTY_SCREENSHOT` | 截图数据为空 |
| `WRITE_FAILED` | 截图写盘失败 |
| `MISSING_CONVERSATION_ID` | `open-artifact` 缺会话标识（shell 未注入 `CONVERSATION_ID`） |
| `CANNOT_RESOLVE_PATH` | `open-artifact` 给纯文件名但 `$ARTIFACTS_DIR` 未注入；改用绝对路径，或在产物目录 cwd 下。会话目录外的文件由后端 404（先复制进产物目录再打开） |

## ⚠️ 关键约定：不要把 `health` 当门禁

`browserctl health` 的 `browser_available` 字段表示**此刻内嵌浏览器实例是否已存在**，
而**不是**「浏览器能否使用」。内嵌浏览器是惰性创建的：只有 `open` / `navigate` 才会
创建它，`health` 自己**永远不会**创建。

因此存在一个完全正常、并非故障的情况：

- 当任务**由组长/总管派单**（离屏后台会话）或用户停在别的会话时，浏览器尚未创建，
  `health` 会如实返回 `browser_available: false`、`url: ""`。
- 此时**直接 `browserctl open <url>` 即可**——`open` 会走离屏兜底分支创建浏览器并完成
  导航（视图保持不可见，用户切回该会话时自动摊开）。

**绝对不要**因为 `health` 返回 `browser_available: false` 就判定浏览器不可用、转去用
Python/requests 抓页面。那是误判：`open` 仍会成功。只有当 `open` / `navigate` 本身返回
`ok:false`（如 `BROWSER_UNAVAILABLE`、`BRIDGE_CONNECT_FAILED`）时才说明浏览器真的不可用。

> 正确流程：**直接 `open`** →（按需 `wait`）→ `snapshot` / `extract-text`。
> `health` 仅用于排查 bridge 连通性，**不是**使用浏览器前的必经检查。

## 命令

```bash
browserctl health
browserctl open <url>
browserctl navigate <url>
browserctl open-artifact <文件名或真实路径>   # 打开会话产物目录里的 HTML（纯文件名按 $ARTIFACTS_DIR 解析，自动识别会话，支持相对资源），无文件卡片时用
browserctl snapshot [--max-nodes 200] [--compact|-c] [--depth N|-d N] [--scope <sel>|-s <sel>] [--tree|--interactive]   # 文本模式省 token；--interactive 仅可交互节点平铺，--tree 全量缩进树，默认 JSON；-c 裁剪 null 字段，-d 限深，-s 限定子树
browserctl click <@eN|selector> [--confirm "确认文案"]
browserctl wait --selector <css> [--state visible|hidden]  # 等元素出现/隐藏（默认超时 10s，--timeout 改）
browserctl wait --text <文本>        # 等文本出现在页面
browserctl wait --url <glob>         # 等 URL 匹配 glob（* 通配）
browserctl wait --load networkidle   # 等网络空闲（JS 启发式 + Page.lifecycleEvent）
browserctl wait --load load          # 等 window load（readyState=complete / lifecycle load）
browserctl wait --load domcontentloaded  # 等 DCL（readyState≠loading；SPA 二次渲染不重发 DCL）
browserctl eval <js>                 # 页内执行 JS，返回 { value, type }
browserctl eval --file <path>        # 从文件读 JS（多行/特殊字符）
browserctl eval --stdin              # 从管道读 JS
browserctl eval <js> --timeout 15000 # 默认 10s，Promise 不 resolve 则 TIMEOUT
browserctl wait --fn <js>            # 等 JS 表达式返回 true
browserctl wait --fn-file <path>       # 从文件读取 JS 表达式（含特殊字符时优先）
browserctl wait --fn-stdin             # 从管道读取 JS 表达式
browserctl wait --ms <毫秒>          # 固定等待（无明确目标时兜底）
browserctl fill <@eN|selector> <text>
browserctl fill <@eN|selector> --text-file <path>   # 文本含引号/&/|/空格/换行等特殊字符时优先用
browserctl fill <@eN|selector> --text-stdin          # 从管道读取文本（echo ... | browserctl fill ...）
browserctl hover <@eN|selector>                       # 鼠标悬停到元素中心（单次 mouseMoved，不点击）
browserctl dblclick <@eN|selector>                    # 双击（clickCount:2 的 pressed+released）
browserctl focus <@eN|selector>                       # 调用元素 this.focus() 获取焦点
browserctl type <@eN|selector> <text>                 # 在当前焦点处追加输入（不清空；printable 走 insertText，\n 走 keyDown+keyUp）
browserctl type <@eN|selector> --text-file <path>     # 同 fill，文本含特殊字符时优先用文件
browserctl type <@eN|selector> --text-stdin           # 同 fill，从管道读取文本
browserctl check <@eN|selector>                       # 勾选 checkbox/radio（未勾选时点击，已勾选保持；非 checkbox/radio 返回 NOT_CHECKABLE）
browserctl uncheck <@eN|selector>                     # 取消勾选 checkbox（已勾选时点击，未勾选保持；非 checkbox/radio 返回 NOT_CHECKABLE）
browserctl drag <@eN|selector> <@eN|selector>         # 从 source 元素中心拖拽到 target 元素中心（10 步插值 mouseMoved + pressed/released）
browserctl upload <@eN|selector> <file...>            # 给 <input type=file> 设置文件（多文件按位置参数顺序；文件不存在返回 FILE_NOT_FOUND）
browserctl press <key> [@eN|selector] [--ctrl|--shift|--alt|--meta]   # 按键；不带元素则发到当前焦点
browserctl scroll [@eN|selector] [--to top|bottom] [--by <px>]        # 滚动到元素/顶底/指定距离
browserctl select <@eN|selector> (<value> | --label <文本>)          # 选原生 <select> 项（value 精确匹配 / label 按文本）
browserctl get url
browserctl get title
browserctl get value <@eN|selector>    # 读元素当前值（el.value 优先，回退 value 属性），校验 fill/select
browserctl get text <@eN|selector>     # 读元素 innerText/textContent（trim）
browserctl get attr <@eN|selector> <name>    # 读元素属性（href/src/aria-* 等），不存在返回 null
browserctl is visible <@eN|selector>   # 元素存在且可见 → { result: true }；存在但 hidden → { result: false }；不存在 → ELEMENT_NOT_FOUND
browserctl is enabled <@eN|selector>   # 元素存在且未 disabled → { result: true/false }
browserctl is checked <@eN|selector>   # 可勾选 → { result: true/false }；非 checkbox/radio → NOT_CHECKABLE
browserctl find role <role> <action> [value] [--name <name>] [--exact]   # 语义定位（主 frame；不依赖 snapshot @eN）
browserctl find text|label <text> <action> [value] [--exact]
browserctl find placeholder|testid|alt|title <query> <action> [value]
browserctl find first|last <selector> <action> [value]
browserctl find nth <n> <selector> <action> [value]   # n 为 1-based
browserctl back|forward|reload
browserctl scrollintoview|scroll-into-view <@eN|selector>   # 同 scroll @eN
browserctl dialog status|accept [text]|dismiss
browserctl get-url
browserctl get-title
browserctl extract-text
browserctl screenshot [--annotate] [--out <path>]   # 截图落盘，返回 { path, bytes, annotations? }；--annotate 在图上标 @eN 红框编号
browserctl close                       # 关闭内嵌浏览器并收起右栏（任务结束释放资源）
```

### 交互命令详解（Batch 1 新增）

下列 8 条命令与 `agent-browser` 对齐，均接收 `ref_or_selector`（`@eN` 引用或 CSS 选择器），返回统一 envelope `{ ok: true, data: {...} }` 或 `{ ok: false, error, code }`。

| 命令 | 语法 | 参数 | 返回 data | 错误码 |
|------|------|------|-----------|--------|
| `hover` | `browserctl hover <ref_or_selector>` | `ref_or_selector` | `{}` | `ELEMENT_NOT_FOUND` / `BROWSER_UNAVAILABLE` |
| `dblclick` | `browserctl dblclick <ref_or_selector>` | `ref_or_selector` | `{}` | 同上 |
| `focus` | `browserctl focus <ref_or_selector>` | `ref_or_selector` | `{}` | 同上 |
| `type` | `browserctl type <ref_or_selector> <text>` | `ref_or_selector`, `text` | `{}` | 同上 |
| `check` | `browserctl check <ref_or_selector>` | `ref_or_selector` | `{ checked: true/false }` | `NOT_CHECKABLE` / `ELEMENT_NOT_FOUND` |
| `uncheck` | `browserctl uncheck <ref_or_selector>` | `ref_or_selector` | `{ checked: false }` | `NOT_CHECKABLE` / `ELEMENT_NOT_FOUND` |
| `drag` | `browserctl drag <source> <target>` | `source`, `target`（均为 `@eN`/选择器） | `{}` | `ELEMENT_NOT_FOUND` |
| `upload` | `browserctl upload <ref_or_selector> <file...>` | `ref_or_selector`, `files`（路径数组） | `{ uploaded: number }` | `FILE_NOT_FOUND` / `ELEMENT_NOT_FOUND` |

返回示例：

```json
{ "ok": true, "data": {} }
{ "ok": false, "error": "file not found: <path>", "code": "FILE_NOT_FOUND" }
```

> `type` 与 `fill` 区别：`fill` 先清空再输入；`type` 在当前焦点处追加，不清空。两者文本参数均支持 `--text-file` / `--text-stdin`。
>
> `fill` 输入段已改用 CDP `Input.insertText` 一次性注入（保留 `clearElement` 原型 setter 清空步骤，非破坏性），避免逐字符 `dispatchKeyEvent` 在中文/复合输入场景下的丢字问题。

### 元素读值与状态断言（Batch 5.2）

| 命令 | 语法 | 返回 data | 错误码 |
|------|------|-----------|--------|
| `get text` | `browserctl get text <ref_or_selector>` | `{ text: string }` | `ELEMENT_NOT_FOUND` |
| `is visible` | `browserctl is visible <ref_or_selector>` | `{ result: boolean }` | `ELEMENT_NOT_FOUND` |
| `is enabled` | `browserctl is enabled <ref_or_selector>` | `{ result: boolean }` | `ELEMENT_NOT_FOUND` |
| `is checked` | `browserctl is checked <ref_or_selector>` | `{ result: boolean }` | `NOT_CHECKABLE` / `ELEMENT_NOT_FOUND` |

**`is` 三态语义**（元素须先被 `runOnElement` 解析到）：

| 情况 | 返回 |
|------|------|
| 元素不存在 | `{ ok: false, code: "ELEMENT_NOT_FOUND" }` |
| 存在，条件为真 | `{ ok: true, data: { result: true } }` |
| 存在，条件为假 | `{ ok: true, data: { result: false } }` |

`checked` 额外：非 checkbox/radio → `{ ok: false, code: "NOT_CHECKABLE" }`（不是 true/false 三态）。

### 语义定位 find（Batch 5.3）

无需先 `snapshot`；在主 frame 内定位后直接走 objectId 路径（**不**转成 `@eN`）。

| strategy | 示例 | 说明 |
|----------|------|------|
| `first`/`last`/`nth` | `find first #kw click` | CSS `querySelector(All)`；`nth` 为 **1-based** |
| `testid` | `find testid submit-btn click` | `[data-testid]` 精确匹配 |
| `placeholder` | `find placeholder 关键词 fill "text"` | placeholder contains（忽略大小写） |
| `role` | `find role button click --name 百度一下` | 隐式 role + `--name` contains；`--exact` 全匹配 |
| `text`/`label` | `find text 登录 click` | 最小包含元素 / label→control；`--exact` 全匹配 |
| `alt`/`title` | `find title 帮助 hover` | 属性 contains |

**action**：`click` \| `fill` \| `type` \| `hover` \| `focus` \| `check` \| `uncheck` \| `text`（不含 `select`）。`fill`/`type` 支持 `--text-file`/`--text-stdin`。

失败：`ELEMENT_NOT_FOUND`（未匹配）、`NOT_CHECKABLE`、`EVAL_ERROR`（定位 JS 异常）。

### 导航与弹窗（Batch 5.4）

| 命令 | 说明 |
|------|------|
| `back` / `forward` / `reload` | CDP 历史导航 + `waitForLoadComplete`；返回 `{ url, title }`（经 `getUrl`/`getTitle` 读取） |
| `scrollintoview` | 同 `scroll @eN`；元素不存在 → `ELEMENT_NOT_FOUND` |
| `dialog status` | `{ pending, type?, message? }` |
| `dialog accept [text]` | 处理 pending confirm/prompt；无 pending → `DIALOG_NOT_PENDING` |
| `dialog dismiss` | 拒绝 confirm/prompt |

`alert`/`beforeunload` 在 CDP 事件中**自动 accept**；`confirm`/`prompt` 置 pending。任意 action 响应若有 pending dialog，附加 top-level `warning`（不改 `ok`）。

### batch（Batch 5.5，CLI-only）

```bash
browserctl batch "get url" "snapshot --interactive"
browserctl batch --bail "open https://example.com" "click @e1"
echo '[["get","url"],["wait","--load","domcontentloaded"]]' | browserctl batch --json
```

同 Node 进程顺序执行；每条子命令仍独立 HTTP 调 bridge。`--bail` 首条失败即停；不可嵌套 `batch`。

> `screenshot --annotate`：先取 refCache（无则自动 `snapshot`），对每个 `@eN` 取 `getBoundingClientRect`，注入 `__browserctl_annotations__` 红框 overlay → `Page.captureScreenshot{captureBeyondViewport:true}` → 移除 overlay。返回 `{ path, bytes, annotations:[{ref,number,role,name?,box:{x,y,width,height}}] }`。**OOPIF 跨源 iframe 的 @eN 不参与 annotate**（主 session 上 `DOM.resolveNode` 会失败，静默跳过）。

> `snapshot` 会自动遍历同源 iframe：iframe 内的元素也会出现在 `@eN` 列表里，可直接 `click`/`fill`/`select`/`get`/`scroll`。跨源 iframe（不同域，走独立进程）会被静默跳过、不影响主页面。**iframe 内只能用 `@eN` 定位，CSS 选择器不跨 frame**（选择器只在主文档生效），优先用 `@eN`。

> `screenshot` 默认写到当前会话产物目录 `browser-screenshot-<时间戳>.png`，或用 `--out` 指定路径。stdout 不含 base64；返回文件路径后，如需让模型查看可再 `read` 该图片。

## 调用方式

桌面端（`pnpm dev:app` 或打包版）启动时，Electron 会向后端进程注入环境，使 `browserctl` 直接在 `shell_execute` 的 PATH 中可用——**主路径就是裸命令** `browserctl <子命令>`。

注入内容（见 `apps/web/electron/features/backend/backend-process.ts`）：

- `PATH` 前置 `packages/browserctl/bin`（含 `browserctl.cmd` / `browserctl` wrapper）→ **主路径就是裸命令 `browserctl <子命令>`，跨平台一致，优先用它**
- `BROWSERCTL_PATH` 指向 CLI 入口绝对路径，**仅供人工排查，勿作为默认命令模板**（环境变量引用语法分平台，Agent 照抄易错）：
  - Windows cmd：`node "%BROWSERCTL_PATH%" health`
  - macOS / Linux：`node "$BROWSERCTL_PATH" health`

> 命令带空格参数时务必加引号，例如 `browserctl fill @e4 "数字 员工"`；wrapper 以 `%*` / `"$@"` 原样透传。

仅当脱离桌面端单独调试 CLI 时，在仓库内用 pnpm workspace 调用：

```bash
pnpm --filter @workspace/browserctl browserctl health
```

## 独立后端（开发 / CI，可选）

`browserctl` 的命令逻辑已抽成与宿主无关的 SDK（`@workspace/browser-sdk`），除桌面端 Electron 内嵌浏览器外，**同一套命令也能驱动一个独立的 Chrome/Edge**——用于脱离桌面端的自动化（CI、批处理、本地调试 OA 流程）。**数字员工员工日常用桌面端裸命令即可，无需关心这一节。**

启动独立 daemon（它会 launch 一个持久 profile 的 Chrome/Edge，并在 bridge 端口监听）：

```bash
# 默认 chrome、有头、端口 34555、持久 profile 在 ~/.browserctl/profile-chrome
node packages/browserctl-daemon/src/index.ts --browser chrome
# 选项：--browser edge | --headless | --port 34556 | --user-data-dir <path> | --executable <path>
# 连接已在调试端口运行的浏览器（不 launch）：--cdp <port>
```

再把 CLI 指向该 daemon（端口与 daemon 一致），命令完全一样：

```bash
BROWSER_RUNTIME_BRIDGE_URL=http://127.0.0.1:34555 browserctl open https://oa.example.com
BROWSER_RUNTIME_BRIDGE_URL=http://127.0.0.1:34555 browserctl snapshot --interactive
```

与桌面端的差异：

- `--confirm` 敏感动作在独立后端**自动放行 + 审计日志**（无人值守，无确认 UI）；
- 无右栏可视化 / 会话归属 / `open-artifact`（桌面端专属，独立模式 `open-artifact` 返回 404）；
- 登录态靠**持久 profile** 复用：首次在该 profile 登录一次（如 OA 的 SSO），cookie 存进 `--user-data-dir`，之后无人值守自动化直接复用，不用重登。

## 元素引用

`browserctl snapshot` 返回来自可访问性树的 `@eN` 引用。页面跳转、刷新、弹窗、表单联动后引用可能失效，需要重新 snapshot。

优先使用 `@eN`，选择器仅在稳定页面结构中使用。
