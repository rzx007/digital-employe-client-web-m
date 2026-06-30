# 打包门户

Web 界面管理 **216** 上的品牌资源，触发 **gitlab.bobandata.com** 的 Windows CI，在 **win-builder** 上产出 Setup.exe。

## 三端架构

```mermaid
flowchart LR
  Portal["打包门户<br/>216:8090"]
  Assets["packaging-assets<br/>216 GitLab :8929"]
  CI["digital-employee-client<br/>gitlab.bobandata.com"]
  Win["win-builder<br/>Windows 构建机"]

  Portal -->|上传 brand/logo/icon| Assets
  Portal -->|Pipeline Trigger| CI
  CI -->|Deploy Token clone| Assets
  CI -->|build:windows:branded| Win
```

| 角色 | 地址 | 说明 |
|------|------|------|
| 资源库 | http://10.172.246.216:8929/boban-staff/packaging-assets | 仅品牌资源，216 内网 GitLab |
| 主仓库 CI | https://gitlab.bobandata.com/llm/digital-employee-client | 项目 id **664**，打 exe |
| 打包门户 | http://10.172.246.216:8090 | 上传资源 + 触发 CI + 打包记录 |
| Windows 构建 | GitLab Runner `win-builder` | 现有为 **yaoji** 账户；**212** 可注册为同 tag Runner |

> **跨 GitLab 拉资源**：bobandata 的 Runner **不能**用 `CI_JOB_TOKEN` 访问 216。门户触发时会把带 **Deploy Token** 的 `BRAND_ASSETS_REPO` 传给 CI（见 `configure-packaging-portal-dual-gitlab.py`）。

## CI 触发方式对比

| 触发方式 | Job | stage | 行为 |
|----------|-----|-------|------|
| 推 `vX.Y.Z` tag | `build:windows` 等 | build | 自动（release 含 mac/linux） |
| dev 分支网页 Run pipeline | `build:windows:manual` | build | **手动 Play** |
| **打包门户** Trigger API | `build:windows:branded` | **package** | **自动**，仅 Windows 品牌在线包 |

`build:windows:branded` 使用 `only: triggers`，与 dev push / 普通网页 pipeline 隔离，不需要点 Play。

## 前置条件

1. 主仓库 **dev** 已包含 `build:windows:branded` job（见 `.gitlab-ci.yml`）— **需 push 到 bobandata**
2. bobandata 项目已配置 **Pipeline Trigger**（门户配置脚本会自动创建）
3. win-builder Runner 在线，且能访问 **216:8929**（拉 packaging-assets）
4. 216 上 `packaging-assets` 已有 `projects/guowang/` 等目录

## 一键配置（双 GitLab）

```powershell
$env:CI_GITLAB_USER = "wangliang"
$env:CI_GITLAB_PASSWORD = "..."   # 勿提交 git
python scripts/configure-packaging-portal-dual-gitlab.py
```

写入 216 `~/packaging-portal/.env`：

- `ASSETS_GITLAB_*` → 216 资源库
- `CI_GITLAB_*` + `GITLAB_TRIGGER_TOKEN` → bobandata CI
- `BRAND_ASSETS_REPO` → 含 Deploy Token 的 clone URL（给 win-builder 用）

## 手动触发（本机脚本）

```powershell
$env:GITLAB_TRIGGER_TOKEN = "..."   # bobandata Pipeline Trigger
$env:BRAND_ASSETS_REPO = "http://deploy-user:token@10.172.246.216:8929/boban-staff/packaging-assets.git"

pwsh -File scripts/ci/trigger-branded-build.ps1 -BrandProject guowang -GitRef dev
```

等价于门户「开始打包」。

## 212 Windows 服务器

212（`boban` / 内网）**当前未开 SSH**。若要作为构建机：

1. 安装 [GitLab Runner](https://docs.gitlab.com/runner/install/windows.html)（shell executor）
2. 注册到 **gitlab.bobandata.com**，tag 填 `win-builder`
3. 参考 `scripts/ci/setup-win-runner-yaoji.ps1` 与 `.gitlab-ci.yml` 注释
4. 确认 212 能 `git clone` 216:8929 的资源库 URL

若继续用现有 yaoji 构建机，212 可暂不参与，只要 Runner 能访问 216 即可。

## 216 门户部署（venv，无 Docker 镜像加速）

```bash
python scripts/deploy-packaging-portal-216.py --mode venv
```

门户监听 **8090**（8080 已被占用）。

## 触发变量

| 变量 | 来源 | 示例 |
|------|------|------|
| `BRAND_PROJECT` | 门户 | `guowang` |
| `BRAND_ASSETS_REPO` | 门户 `.env` | `http://user:token@10.172.246.216:8929/boban-staff/packaging-assets.git` |
| `BRAND_ASSETS_REF` | 门户 | `main` |

## 取安装包

CI artifacts 不含 exe（GitLab 413 限制）。成功后到 **win-builder** 本机：

`apps/web/release/BobanStaff-<slug>-Windows-*-Setup.exe`

## 相关文件

| 路径 | 说明 |
|------|------|
| `scripts/ci/prepare-branded-build.ps1` | 拉资源、注入 branding/active |
| `scripts/ci/build-windows.ps1` | `-BrandProject` 入口 |
| `scripts/ci/trigger-branded-build.ps1` | 本机手动触发 |
| `scripts/configure-packaging-portal-dual-gitlab.py` | 双 GitLab 门户配置 |
| `.gitlab-ci.yml` → `build:windows:branded` | 品牌 Windows 在线包 job |
