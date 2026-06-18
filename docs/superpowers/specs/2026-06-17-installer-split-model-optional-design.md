# 安装包拆分 + 模型可选设计

> 日期：2026-06-17
> 目标：把一体机安装包拆成「核心包」+「模型包」，模型变可选；不依赖本地模型时只下核心包（~360M，而非 27G）。
> 关联：[deploy 激活阶段](./2026-06-16-deploy-activation-stage-design.md)

## 1. 背景与痛点

当前 `BobanStaff-Installer/` 打成**一个 zip** 放飞书，体积分布（真机实测）：

| 部分 | 体积 | 是什么 |
|------|------|--------|
| `runtime/` | 23G | 模型 gguf（Hanhai-Q4 22G + mmproj 858M）|
| `images/` | 4.2G | llama.cpp docker 镜像 tar |
| `packages/` | ~340M（当前版 deb 269M + cli 71M） | 数字员工 deb + hanhai-cli |
| `ime/` | 29M | 输入法 |

**模型相关（runtime+images）= 27G，占 95%**。用户即便不依赖本地模型，也被迫下整包。

`deploy.sh` 现状（`inventory()`）：缺模型 / 缺镜像 → **die（硬失败中止）**；
而缺数字员工 deb → 仅 warn。逻辑与「模型可选」需求相反。

## 2. 方案概览

- **拆两个 zip**：核心包（必下）+ 模型包（要本地模型才下），解压到同一目录。
- **deploy.sh 自动检测**：有模型文件就装、没有就 warn 跳过（零人工开关）。
- **模型连接由用户自配**：deploy 只装数字员工；不装本地模型时，用户在数字员工应用内配模型地址。deploy 不管模型配置。
- **发布脚本**：一键把完整 Installer 目录拆成两个 zip + 校验和。
- **发布 SOP**：重打 deb 后的手动步骤（传飞书、更新 wiki）。

## 3. 打包结构

| 包 | 内容 | 体积 | 何时下 |
|----|------|------|--------|
| **核心包** `BobanStaff-Core-<ver>.zip` | `deploy.sh`、`packages/`、`ime/`、`runtime/docker-compose.yml`（仅 compose，不含 gguf）、`SHA256SUMS` | ~360M | 必下 |
| **模型包** `BobanStaff-Model.zip` | `runtime/Hanhai-Q4.gguf`、`runtime/mmproj-F16.gguf`、`images/*.tar`、`SHA256SUMS` | ~27G | 要本地模型才下 |

`<ver>` 从数字员工 deb 文件名提取（如 `DigitalEmployee-Offline-Linux-arm64-0.1.3.deb` → `0.1.3`）。
模型包不带版本号（很少变；变了覆盖即可）。

**用户用法**：
- 只要数字员工：下核心包 → 解压得 `BobanStaff-Installer/` → `sudo bash deploy.sh`
- 要本地模型：核心包 + 模型包都下 → **解压到同一个 `BobanStaff-Installer/`**
  （模型包补进 `runtime/` 和 `images/`）→ `sudo bash deploy.sh`

## 4. deploy.sh 改造

### 4.1 inventory() — 模型/镜像 die → warn + 标志位

```
检测模型：[[ -f "$MODEL_FILE" || -f "$RT_SRC/Hanhai-Q4.gguf" ]]
检测镜像：docker 已加载 / images/*.tar 存在 / 联网可 pull
两者皆备 → HAS_MODEL=1
否则     → HAS_MODEL=0，warn「未检测到模型包，将只装数字员工；
           装好后请在数字员工应用内配置模型服务地址」
```
- compose 文件仍需要（核心包含），缺它仍 die（它在核心包里，正常不会缺）。
- 数字员工 deb 判定保持（有就装）。

### 4.2 main() — 条件执行模型相关阶段

```
inventory
[[ $HAS_MODEL == 1 ]] && provision_runtime    # 落位 gguf，无模型则跳
echo; hr
[[ $HAS_MODEL == 1 ]] && stage_model          # 起 docker 模型服务，无模型则跳
echo; hr
stage_digital_employee                         # 照装
echo; hr
stage_activation                               # 照跑（激活与模型无关）
echo; hr
stage_hanhai_cli                               # 照装
... 桌面 / 输入法 照跑
```

### 4.3 报告与提示

- 报告里 model 行：HAS_MODEL=0 时显示 `• 跳过（未提供模型包）`。
- finalize 收尾提示：无模型时加一句「本机未装本地模型，请在数字员工应用内配置模型地址」。

**不改**：激活阶段、数字员工/cli/桌面/输入法安装逻辑。

## 5. 发布脚本 scripts/release/pack-installer.sh

输入：一个完整的 `BobanStaff-Installer/` 目录（含 deb/模型/镜像全部）。
输出：`dist/` 下两个 zip + 各自 SHA256SUMS。

```
pack-installer.sh <installer_dir> [out_dir=./dist]
  1. 校验 installer_dir 结构（deploy.sh / packages / runtime 在）
  2. 提取版本号：从 packages/DigitalEmployee-Offline-Linux-arm64-*.deb 取最高版本
  3. 组核心包：deploy.sh + packages/(全部) + ime/ + runtime/docker-compose.yml*
     → BobanStaff-Core-<ver>.zip（排除 *.gguf、images/*.tar、*.debbak*）
  4. 组模型包：runtime/*.gguf + images/*.tar
     → BobanStaff-Model.zip
  5. 各自生成 SHA256SUMS，打印两包体积与版本号
```
- 纯 bash + zip + sha256sum，无第三方依赖。
- 排除 `*.debbak*`（你目录里有几个 deb 备份，不该进包）。

## 6. 发布 SOP（docs/installer-release-sop.md）

重打 deb 后的完整步骤：
1. 把新 deb 放进 `BobanStaff-Installer/packages/`（删旧版/备份）。
2. 跑 `scripts/release/pack-installer.sh <installer_dir>` → 得两个 zip。
3. **核心包每次重打 deb 都要传**；模型包仅模型变了才重传。
4. 上传飞书：`BobanStaff-Core-<ver>.zip`（+ 模型包如有更新）。
5. **更新 wiki**：把核心包下载链接、版本号改到最新（手动；wiki 自动更新见 §8 roadmap）。

## 7. 测试

- `pack-installer.sh`：用一个 mock 目录（空 deb/gguf 占位文件）跑，验证：
  - 产出两个 zip、版本号提取正确、核心包**不含** gguf/images、模型包**只含** gguf/images、`*.debbak*` 被排除、SHA256SUMS 生成。
- deploy.sh 改造：在 220 真机演练
  - **有模型**：照常起模型服务（回归，确认没破坏）。
  - **无模型**（临时把 gguf/images 移走或用核心包目录）：HAS_MODEL=0，跳过模型阶段，数字员工+激活+cli 照装，不 die。
  - 测后还原 220。

## 8. Roadmap（本期不做）

- **wiki 自动更新**：发布脚本自动改飞书 wiki 的版本号/下载链接。需先给应用开通
  `wiki`/`docx` 权限 + 把应用加为该 wiki 协作者，验证可读写后再做。本期 wiki 手动更新。
- 自动上传飞书：可复用 `scripts/ci/publish-feishu.py`，本期手动传。

## 9. 待确认

- 核心包/模型包命名（`BobanStaff-Core-<ver>.zip` / `BobanStaff-Model.zip`）是否 OK。
- 模型包要不要也带版本号（本设计：不带，覆盖式）。
