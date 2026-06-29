# 品牌元素包 / 白标化设计

> 2026-06-29。目标：让工程人员**只替换 png + 文字文件**就能打造不同品牌版本（如「国网版」数字员工），
> 无需改代码、无需重新打包；主题色 / 背景色做成 app 内置预设由终端用户在设置里切换。

## 背景与现状

品牌标识当前**散落硬编码**在 ~32 个文件里（`BobanStaff` / `数字员工` / `Bobandata`），无单一真源：

- `apps/web/index.html` — `<title>BobanStaff</title>`、favicon `/logo.png`
- `apps/web/src/components/settings/about-settings.tsx` — `BobanStaff`、`数字员工智能助手`、`© {year} Bobandata`
- `apps/web/electron/main/app-product.ts` — `APP_DISPLAY_NAME = "数字员工"`
- 窗口标题 / splash / 登录注册页 / 招募页 / curator 欢迎语 / titlebar 等

主题：CSS 变量驱动（`--primary`/`--background`/`--sidebar` …，明/暗两套）在
`packages/ui/src/styles/globals.css`。Logo：`apps/web/public/logo.{png,svg}`、
`apps/web/src/assets/logo.{png,svg}`、`build/icon.ico`。

部署：真实 `deploy.sh` 在目标服务器（`/home/boban/BobanStaff-Installer/deploy.sh`），仓库只留补丁说明。
deb 装进 `/opt/BobanStaff/`，asar 打包（`asar:true`），但 `extraResources` 在 asar 外、可直接覆盖。

## 决策（已与需求方确认）

1. **生效方式**：品牌包只含 **PNG/SVG + 文字**（不碰 CSS）。**运行时**由 Electron 主进程从外置文件夹加载，
   工程人员替换文件即切换，免重打包。
2. **可定制范围**：Logo/图标、文字、主题色、背景色。
3. **主题色 / 背景色**：做成 **app 内置预设**，终端用户在「设置」里切换（运行时写 CSS 变量并持久化），
   **不进文件包**。
4. **资产传输**：主进程读图 → base64 data URL，经 preload/IPC 传给 renderer（方案 ①，最简、零协议/CSP 改动）。
5. **安装包标识**（`productName`/`appId`/deb 包名/`.ico`）保持通用 `BobanStaff`，**本期不做**「国网版独立 exe/deb」
   （属打包期变量，列为后续可选）。

## 总体架构：两套互相独立的机制

| 部分 | 内容 | 机制 | 谁改 |
|------|------|------|------|
| **A. 品牌资源包** | Logo/图标 + 文字（产品名/窗口标题/副标题/公司名/版权） | 运行时主进程从外置文件夹加载 | 工程人员替换文件 |
| **B. 主题/背景色** | `--primary` 品牌色 + 背景/底色（明/暗） | 内置预设，设置页切换，写 CSS 变量 + 持久化 | 终端用户 |

---

## A. 品牌资源包（运行时可热替换）

### 目录约定

- 仓库内：
  - `apps/web/branding/default/` — 现 BobanStaff 资源 + `brand.json`，作**兜底默认**（打进 bundle）。
  - `apps/web/branding/guowang/` — 国网示例（参考样板，证明换包可行）。
- 打包：经 `extraResources` 把 `branding/` 落到安装目录 `resources/branding/`（在 asar 外，可覆盖）。
- 运行时解析顺序（主进程，先到先用）：
  1. 环境变量 `DE_BRANDING_DIR`（指向任意品牌目录，测试 / 临时覆盖用）
  2. `<resourcesPath>/branding/active/`（deploy.sh 把选定品牌拷到这里）
  3. 内置 `default/`（兜底；缺文件逐项回退到此）

### `brand.json` 结构

```jsonc
{
  "productName": "国网数字员工",        // 菜单/Dock/about 主名（对齐 APP_DISPLAY_NAME 语义）
  "windowTitle": "国网数字员工",        // 主窗口标题 + document.title
  "subtitle": "数字员工智能助手",        // about 副标题
  "companyName": "国家电网",
  "copyright": "© {year} 国家电网. All rights reserved.", // {year} 运行时替换为当前年
  "logos": {
    "app": "logo.png",                  // about / 通用
    "login": "login-logo.png",          // 登录/注册页（缺省回退 app）
    "splash": "splash.png"              // 启动屏（缺省回退 app）
  }
}
```

- 缺字段 / 缺图：逐项回退到 `default/` 对应项（不是整包回退），保证永不空白。
- `brand.json` 解析失败：整体回退 default，并 `warn` 记日志。

### 加载与暴露

- **主进程**（`electron/`）：新增 `brand-config.ts`
  - `resolveBrandingDir()` 按上面顺序定位目录。
  - `loadBrand()` 读 `brand.json`（带 schema 校验 + 逐项 default 合并），把 `logos.*` 读成 base64 data URL。
  - 结果是一个纯数据对象 `ResolvedBrand { productName, windowTitle, subtitle, companyName, copyright, logos: {app,login,splash}(data URL) }`。
  - 在创建窗口前调用：用于设置 `BrowserWindow` 标题、`app.setName` / `APP_DISPLAY_NAME` 取值、splash 图。
- **preload**：暴露 `window.brand: ResolvedBrand`（同步注入，启动即有，避免首帧闪 BobanStaff）。
  - 也提供 IPC `brand:get` 作为兜底。
- **renderer**：新增 `useBrand()` hook + `BrandProvider`
  - Electron 下读 `window.brand`；非 Electron（web/dev）读打进 bundle 的 `default/brand.json` + import 的默认图。
  - `copyright` 里的 `{year}` 在渲染时替换为 `new Date().getFullYear()`。

### 重构（去硬编码）

把散落的硬编码改成读 `useBrand()`（renderer）/ `ResolvedBrand`（主进程）。涉及（按类别，非穷举）：

- renderer：`about-settings.tsx`、`login.tsx`、`register.tsx`、`recruitment-page.tsx`、
  `app-titlebar.tsx`、`curator-empty-welcome.tsx` 等含品牌字样处。
- 图片引用：`import logo from "@/assets/logo.png"` → 改读 `useBrand().logos.app`。
- 主进程：`app-product.ts`（`APP_DISPLAY_NAME` 改为从 brand 取）、窗口标题、splash 窗口。
- `index.html`：`<title>` 留通用占位，启动后由 renderer 设 `document.title = brand.windowTitle`；
  主进程 `BrowserWindow` 直接用 brand 标题。

> 范围控制：只替换**品牌字样**（产品名/公司名/版权/副标题/logo）。功能性文案（按钮、提示）不动。

### Web / dev 兜底

非 Electron 环境无主进程：`useBrand()` 直接用打进 bundle 的 `branding/default/brand.json` + 默认图 import。

### 安装包标识（本期不动）

`electron-builder.json5` 的 `productName`/`appId`/deb `--conflicts/--replaces/--provides`/`build/icon.ico`
为打包期、运行时改不了，保持现状通用 `BobanStaff`。产物本身不带「国网」字样，只 app 内显示随包变。
如需「国网版.exe / 独立 deb 包名」→ 另设打包期 BRAND 变量，**列为后续可选，不在本期**。

---

## B. 主题色 / 背景色切换器（运行时用户可选）

### 预设

- `globals.css` 增加预设覆盖块，按 `data-brand-theme` 属性切换，每套含明 + 暗：
  ```css
  :root[data-brand-theme="green"] { --primary: …; --sidebar-primary: …; }
  :root[data-brand-theme="green"].dark { --primary: …; … }
  ```
- 内置 2–3 套：`default`（现靛蓝）、`green`（国网绿）、可再加一套。
- 覆盖键集中在品牌相关变量：`--primary`、`--primary-foreground`、`--sidebar-primary`、必要时 `--ring`；
  背景套覆盖 `--background`、`--sidebar`、`--card`（明/暗）。其余灰阶/chart 不动，避免污染。

### 设置 UI

- 「设置 → 外观」加「主题色 / 背景」选择（预设卡片或下拉 + 色块预览）。
- 切换即写 `document.documentElement.dataset.brandTheme`。

### 持久化

- 存 `localStorage`（key 如 `brand-theme`），启动时（main.tsx / 入口）尽早套用，避免闪烁。
- 可选同步 config-kv（与现有设置存储一致），本期以 localStorage 为准。

### 与品牌包的关系

主题预设的**默认值**可由 `brand.json` 指定一个 `defaultTheme` 字段（可选）：国网包默认就是绿，
用户仍可在设置里改。无该字段则用 `default`。

---

## deploy.sh 集成

- 部署目录新增 `branding/` 文件夹：放 png/svg + `brand.json`（工程人员在此替换）。
- `deploy.sh` 增加一步（写进 `scripts/activation/` 的补丁说明，与现有 patch.md 风格一致）：
  把 `branding/` 覆盖到安装目录 `<install>/resources/branding/active/`。
- 配套文档《如何做一个新品牌版本》：替换 png + 改 `brand.json` 文字 → 重跑 `deploy.sh`。
- 该 `branding/` 目录后续可单独在 GitLab 工程账号下维护（与本仓库解耦）。

---

## 测试

- `brand-config`：解析顺序（env > active > default）、逐项回退、`brand.json` 损坏回退、`{year}` 替换。
- 图片 → data URL 读取；缺图回退。
- `useBrand()`：Electron（读 `window.brand`）与 web（读 bundle default）两路。
- 主题切换：`data-brand-theme` 写入、localStorage 持久化、启动套用。
- 重构回归：默认包下界面与现状一致（无品牌字样漏改 / 无图裂）。

## 非目标（YAGNI）

- 打包期「国网版」独立安装包标识（exe 名 / deb 包名 / appId / .ico）。
- 主题色任意取色器（只给固定预设）。
- 品牌包远程下发 / 在线热更新（只走本地文件 + deploy.sh）。
- 多语言品牌文案。
