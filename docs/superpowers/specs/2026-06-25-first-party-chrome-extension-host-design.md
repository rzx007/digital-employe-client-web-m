# 第一方 Chrome 扩展宿主 · 设计

> 状态:设计已与用户对齐,待 spec 评审 + 用户通读 → writing-plans
> 日期:2026-06-25

## 背景与目标

`apps/web/electron/chrome-plugin/demo-plugin` 是一个**真 Chrome MV3 扩展**(网页操作录制/回放、采集 JSON+WebM),目前只能通过 dev 环境的临时测试宿主(`CHROME_EXT_DEMO=1` → `chrome-plugin/chrome-ext-tester.ts`)加载,把扩展打到独立 `BrowserWindow` 上手测。

用户要把它**工程化**:像浏览器那样,在应用里有一个正式的「插件入口」。

### 范围(已与用户确认)

- **第一方扩展宿主**:只跑「自家出品的几个 MV3 扩展」,有统一入口 + 管理;**不**开放安装任意第三方扩展。
- **运行面**:扩展作用在**应用内置浏览器**(`features/browser`,`persist:browser-panel` session)浏览的网页上。
- **入口形态**:内置浏览器工具栏的**拼图图标**(最浏览器原生)。
- **架构路线**:**B 自建轻量宿主**(零新依赖,仿 `features/extension/` 结构)。明确**不**用 `electron-chrome-extensions` 库——其能力(多 tab、action API、右键菜单、第三方扩展)在本范围用不上,代价是引依赖 + 改造娇贵的 `window-controller.ts`。将来若要支持任意第三方扩展再评估路线 A。

### 与现有「插件」系统的关系

本特性与现有自研插件系统(`features/extension/`,manifest 为 `digital-employee.extension.json`,设置页 `extensions-settings.tsx`)是**两套独立机制**,不复用、不耦合。本特性走 Electron 原生 `session.loadExtension()`。

## 关键约束(来自代码勘探)

1. **内置浏览器是 `WebContentsView`**(`window-controller.ts`),嵌在主窗 `contentView`,session = `session.fromPartition("persist:browser-panel")`,`sandbox:true / contextIsolation:true`。扩展必须加载进**这个 session**,content script 才会注入被浏览的页面。
2. **原生层遮挡**:`WebContentsView` 在原生合成层,会**盖住所有 React 弹窗**(现有「关闭确认框」靠临时 `browser.hide()` 绕开,见 `browser-panel.tsx`)。因此拼图图标的**列表与 popup 不能用 React 渲染**,必须是原生窗/视图叠在浏览器之上。但工具栏本身(`data-browser-viewport` 上方)**不**被遮挡。
3. **Electron 扩展支持是"尽力而为"**:仅支持加载解压目录(非 .crx);仅持久 session;实测 Electron 41 缺 `chrome.tabCapture`、`chrome.webNavigation`、`tabs.captureVisibleTab`;`offscreen.createDocument`、`tabs.query/get`、`scripting`、`storage.local` 可用。
4. **后台 SW 顶层崩点**:demo-plugin 后台在**模块顶层**就 `chrome.webNavigation.onCompleted.addListener(...)`,API 缺失→SW 求值即崩→`onMessage` 不注册→popup「点了没反应」。这是必须由垫片先解决的根因。

## 架构

### 模块结构 `electron/features/chrome-ext/`(仿 `features/extension/`)

| 文件 | 职责 | 依赖 |
|------|------|------|
| `chrome-ext-registry.ts` | 发现第一方扩展(dev:`electron/chrome-plugin/<id>`;打包:`process.resourcesPath/chrome-extensions/<id>`);读 `manifest.json` 取 `name/version/icons`;返回 `ChromeExtMeta[]` | data-paths / runtime-env |
| `chrome-ext-store.ts` | electron-store 持久化每扩展 `enabled`(第一方默认 `true`) | electron-store |
| `chrome-ext-compat.ts` | 通用兼容垫片源码 + `preparePatchedExtensionDir(srcDir,id)`:拷到 userData、写 `electron-shim.js`、给 `background` 入口前插 `import"./electron-shim.js";` | fs / app |
| `chrome-ext-loader.ts` | `initChromeExtensions()`:扫描 + 恢复 enabled;`loadChromeExt(id)` / `unloadChromeExt(id)`:打补丁→`browserSession.loadExtension(dir,{allowFileAccess:true})`;`listChromeExtensions()` | registry/store/compat |
| `chrome-ext-popup.ts` | `openPopup(id, anchorRect)`:无边框 `BrowserWindow`(partition=`persist:browser-panel`),锚图标下;`closePopup()`;失焦自动关 | registry / window util |
| `popup-host.html` + `popup-host.js` | 多扩展时极简选择器(无框架,本地文件);单扩展跳过、直接载 popup | — |
| `ipc.ts` | 注册 `chromeExt:list / setEnabled / openPopup / closePopup`(主应用 SPA 可调) | loader/popup |
| `preload-bridge.ts` | `electronApi.chromeExt.*` 封装 | — |
| `README.md` | 模块说明 | — |

> `ChromeExtMeta = { id, name, version, iconDataUrl?, hasPopup, enabled }`。`id` 用 manifest 计算的扩展 id(与 `loadExtension` 返回的 `ext.id` 一致),registry 在加载后回填真实 id。

### 启动与加载流程

```
bootstrap.ts → initChromeExtensions()
  → scan registry(dev/打包路径)
  → 对每个 enabled 扩展:
       preparePatchedExtensionDir(src,id) → userData/chrome-ext/<id>-patched
       session.fromPartition("persist:browser-panel").loadExtension(patchedDir,{allowFileAccess:true})
       回填真实 ext.id
  → 转发 SW console 到主日志(排查)
```

- 在 `bootstrap.ts` 调用 `initChromeExtensions()`,早于浏览器首次打开;`session.fromPartition("persist:browser-panel")` 在此创建/获取(持久),与 `window-controller` 后续 `ensureView` 用同一 partition,顺序无关。
- 只读资源目录 → 拷到 userData 可写副本再打补丁,每次启动重拷(跟随发版更新 + 重新注入垫片)。

### 入口 UI

- `browser-panel.tsx` 工具栏在全屏/关闭按钮旁加**拼图 `Button`**(`IconPuzzle`)。仅当存在 enabled 扩展时显示。
- 点击:渲染层量图标 `getBoundingClientRect()`,经 `electronApi.chromeExt.openPopup(anchorRect)` 把 CSS 矩形发主进程。
- 主进程在图标正下方开无边框 `BrowserWindow`:
  - **单**扩展:直接 `loadURL("chrome-extension://<id>/popup.html")`。
  - **多**扩展:先载 `popup-host.html`(传 enabled 列表),用户选 → IPC 回主进程 → `win.loadURL(popup.html)`。
- 锚定换算复用 `features/browser/viewport-bounds.ts` 的 `cssViewportBoxToDipBounds` + 主窗 `getContentBounds()`。
- 失焦(`blur`)即 `close()`,模拟真 popup 行为;尺寸默认 380×560、可缩放(无法读 Chrome 的内容自适应尺寸)。

### 启用/禁用管理

- 设置页新增一节「浏览器扩展」(独立于现有「插件」页),列第一方扩展 + `Switch` 开关。
- 切换 → `chromeExt:setEnabled(id,enabled)` → store 持久化 + `loadChromeExt/unloadChromeExt`。
- v1 从简:仅开关 + 名称/版本;无安装/删除(第一方随包发布)。

### 兼容垫片(通用化)

把现 `chrome-ext-tester.ts` 的 shim 提为 `chrome-ext-compat.ts` 共享层,**每个第一方扩展加载时都套**(全部 `if(!c.xxx)` 守卫,对不需要的扩展无害):

- `webNavigation`:桩出 `onCompleted/onCommitted/onDOMContentLoaded` 事件 + `getAllFrames→[]`(防 SW 顶层崩;调用处有 try/catch 回退顶层 frame)。
- `tabCapture.getMediaStreamId`:返回假 streamId(本期不做视频)。
- 拦截 `OFFSCREEN_START/STOP/RELEASE` 消息假装成功(绕过 getUserMedia);`offscreen.createDocument` no-op。
- `tabs.captureVisibleTab`:桩 undefined。
- `tabs.query({active,currentWindow})`:拿不到真实网页时回退挑 http(s) tab(修 popup 独立窗导致命中自身的问题)。

> 注入方式:拷贝副本后,给 `background.service_worker` 入口文件前插 `import"./electron-shim.js";`(ESM 导入先于模块体求值,保证垫片在顶层 `chrome.webNavigation.*` 之前生效)。

### 打包

- electron-builder `extraResources`:`electron/chrome-plugin/*`(每个第一方扩展目录)→ `resources/chrome-extensions/<id>`。
- `chrome-ext-registry.ts` 按 `app.isPackaged` 区分 dev(`APP_ROOT/electron/chrome-plugin`)与打包(`process.resourcesPath/chrome-extensions`)。

## ⚠️ 头号风险与 Phase 0 验证(必须最先做)

**Electron 原生 `chrome.tabs` 是否"看得见"内置浏览器的 `WebContentsView`?**

- tester 里 `chrome.tabs.query` 能用,是因为目标是独立 `BrowserWindow`(Electron 内建 tab 追踪认它)。
- 内置浏览器是 **`WebContentsView`**,Electron 的内建 tab 追踪**可能不认它** → 后台 `ut()`(`tabs.query`)与 `scripting.executeScript({tabId})` 失效 → 录制起不来。

**Phase 0 spike(实现第一步,定生死)**:加载一个最小扩展进 `persist:browser-panel`,在内置浏览器开一个真实网页,验证:
1. content script 是否注入(DOM 注入或 console 标记);
2. `chrome.tabs.query({active:true})` 是否返回该 `WebContentsView` 页;
3. `chrome.scripting.executeScript({target:{tabId}})` 是否命中。

**分支**:
- ✅ 全通过 → 按本设计全量实现 B。
- ❌ tabs/scripting 不认 `WebContentsView` → 退一步二选一:
  - (a)**合成 tab 桥**:主进程把内置浏览器 webContents 的 id 喂给 SW(写入 `chrome.storage` 或补丁期生成的 shim 常量),垫片把 `tabs.query/get/sendMessage/scripting` 路由到该 id;或
  - (b)回头评估路线 A——`electron-chrome-extensions` 的 `addTab` 正是把自定义 view 注册成 chrome.tabs 可见 tab 的机制,这点是它相对 B 的真实价值。

> 该 spike 结论需在进入主体实现前书面记录,并据此决定是否调整设计。

## 测试策略

- **单测**(Vitest,贴现有 electron 测试):
  - `chrome-ext-registry`:dev/打包路径解析、manifest 缺失处理;
  - `chrome-ext-store`:启停持久化默认值;
  - `viewport`/锚定:CSS 矩形 → 屏幕坐标换算;
  - `chrome-ext-compat`:垫片守卫(已存在 API 不覆盖、缺失则补;`tabs.query` 回退选 http(s))。
- **手测**:内置浏览器浏览 → 拼图 → popup → 录制 → 出 JSON(步骤齐、video 字段空为预期)。
- **Phase 0 spike** 本身即一项验证产物。

## YAGNI / 明确不做

- 不做视频录制(用户已确认);残留空 `video` 字段不清理(除非另提)。
- 不做第三方扩展安装/扩展市场/OTA。
- 不做多 tab、右键菜单、完整 action API。
- popup 不做 Chrome 式内容自适应尺寸,用固定默认尺寸。

## 迁移/收尾

- 现 `chrome-plugin/chrome-ext-tester.ts` 与 `main/index.ts` 里的 `CHROME_EXT_DEMO=1` 钩子:正式特性落地后可移除或保留为 dev 快测(实现计划里决定)。垫片逻辑迁入 `chrome-ext-compat.ts`,tester 复用或删除。
