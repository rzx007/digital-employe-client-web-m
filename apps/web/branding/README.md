# 品牌资源包（白标 / 多版本）

工程人员**只需替换本目录下的图片 + 文字**，即可打造不同品牌版本（如国网版），
无需改代码。主题色 / 背景色是 app 内置预设，由用户在「设置 → 通用 → 主题色」切换，
不在本目录维护。

## 目录结构

```
branding/
  default/          # 兜底默认（出厂 BobanStaff）。任何字段/图片缺失都回退到这里
    brand.json
    logo.png
  guowang/          # 国网示例样板（复制它做新品牌）
    brand.json
    logo.png
  active/           # ← 运行时实际生效的品牌（部署时由 deploy.sh 拷入；仓库不含）
```

打包时整个 `branding/` 会被装进安装目录 `resources/branding/`（见
`electron-builder*.json5` 的 `extraResources`）。

## brand.json 字段

| 字段 | 含义 |
|------|------|
| `productName` | 产品名（菜单/Dock/about/标题栏/登录页标题） |
| `windowTitle` | 窗口标题 + 浏览器 `document.title` |
| `subtitle` | about / 欢迎页副标题 |
| `companyName` | 公司名 |
| `copyright` | 版权行，可用 `{year}` 占位（运行时替换为当前年） |
| `logos.app` | 通用 logo（about / 标题栏 / 欢迎页），相对本目录的文件名 |
| `logos.login` | 登录/注册页 logo（缺省回退 `app`） |
| `logos.splash` | 启动屏 logo（缺省回退 `app`） |
| `defaultTheme` | 可选。首次启动的默认主题色预设 id（`default`/`green`/`teal`），用户仍可改 |

> 图片支持 png/svg/jpg/webp。缺某个 logo 会逐项回退到 `app`，再回退到打包默认图，不会裂图。

## 运行时品牌目录解析顺序（先到先用）

1. 环境变量 `DE_BRANDING_DIR`（指向含 `brand.json` 的目录；本地验证 / 临时覆盖）
2. `resources/branding/active/`（部署时拷入的选定品牌）
3. `resources/branding/default/`（打包内兜底）
4. 开发态：仓库 `apps/web/branding/default/`

## 做一个新品牌版本（例：国网版）

1. 复制 `guowang/` 为新目录，或直接改 `guowang/brand.json` 的文字。
2. 把 `logo.png` 换成目标品牌 logo（保持文件名，或在 `brand.json` 里改 `logos`）。
3. **本地验证**：`DE_BRANDING_DIR=apps/web/branding/guowang pnpm --filter web dev:app`，
   确认 about / 登录 / 标题栏 / 启动屏都显示新品牌。
4. **部署**：把该品牌目录放到部署包的 `branding/` 下，重跑 `deploy.sh`
   （deploy.sh 会拷到 `resources/branding/active/`）。详见
   `scripts/activation/deploy.sh.branding.patch.md`。

后续这个目录可单独在 GitLab 工程账号下维护，与主仓库解耦。
