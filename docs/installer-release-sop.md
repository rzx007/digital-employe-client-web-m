# 安装包发布 SOP（deb 更新后）

> 数字员工 deb 重新打包后，更新核心包并同步飞书。安装包拆成核心包 + 模型包，模型可选。

## 何时触发
数字员工 deb 重新打包后（核心包要更新）；或模型 gguf/镜像变更（模型包要更新，少见）。

## 步骤

1. **放新 deb**：把新 `DigitalEmployee-Offline-Linux-arm64-<ver>.deb` 放进
   `BobanStaff-Installer/packages/`，删除/移走旧版与 `*.debbak*`。

2. **拆包**：
   ```bash
   bash scripts/release/pack-installer.sh /path/to/BobanStaff-Installer ./dist
   ```
   产出：
   - `dist/BobanStaff-Core-<ver>.zip`（~360M）+ `.sha256`
   - `dist/BobanStaff-Model.zip`（~27G）+ `.sha256`

3. **上传飞书**：
   - **核心包**：每次重打 deb 都要传 `BobanStaff-Core-<ver>.zip`。
   - **模型包**：仅当模型 gguf/镜像变了才传 `BobanStaff-Model.zip`（一般不变，可一直复用旧的）。

4. **更新 wiki**（手动）：把核心包下载链接、版本号改到最新。
   > wiki 自动更新见 roadmap（待应用开通 wiki/docx 权限 + 把应用加为该 wiki 协作者，验证可读写后做）。

## 用户下载指引（建议写进 wiki）

- **只用数字员工（不要本地模型）**：只下**核心包** → 解压得 `BobanStaff-Installer/` →
  `sudo bash deploy.sh`。deploy 检测到无模型会跳过模型服务、只装数字员工；
  装完在数字员工应用内配置模型服务地址。
- **要本地模型**：核心包 + 模型包都下 → **解压到同一个 `BobanStaff-Installer/` 目录**
  （模型包补进 `runtime/` 和 `images/`）→ `sudo bash deploy.sh`（自动检测并安装模型）。

## 完整性校验
```bash
sha256sum -c BobanStaff-Core-<ver>.zip.sha256
sha256sum -c BobanStaff-Model.zip.sha256
```

## 相关
- 设计：`docs/superpowers/specs/2026-06-17-installer-split-model-optional-design.md`
- 拆包脚本：`scripts/release/pack-installer.sh`
- deploy 模型可选改动：`scripts/activation/deploy.sh.modelopt.patch.md`
