# 安装包拆分 + 模型可选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 安装包拆成核心包+模型包（模型可选）；deploy.sh 自动检测模型有无（缺则跳过模型阶段、仍装数字员工）；提供拆包发布脚本与发布 SOP。

**Architecture:** ① 新增 `scripts/release/pack-installer.sh` 把完整 Installer 目录拆成两个 zip。② 改 220 真机 `deploy.sh`：`inventory()` 对模型/镜像 die→warn+`HAS_MODEL` 标志，`main()` 按标志条件跑模型阶段。③ 发布 SOP 文档。

**Tech Stack:** Bash（pack 脚本、deploy.sh）、zip/sha256sum、SSH+paramiko（220 真机验证）。

---

## 关键事实（220 真机已核实）

deploy.sh 变量（顶部）：
- `INSTALLER_DIR`（脚本所在）、`IMAGE_TAR_DIR=$INSTALLER_DIR/images`、`RT_SRC=$INSTALLER_DIR/runtime`
- `RUNTIME=/home/$DE_USER/BobanStaff`、`MODELS_DIR=$RUNTIME/models`
- `COMPOSE_FILE=$MODELS_DIR/docker-compose.yml`、`MODEL_FILE=$MODELS_DIR/Hanhai-Q4.gguf`、`MMPROJ_FILE=$MODELS_DIR/mmproj-F16.gguf`
- `IMAGE_REF=ghcr.nju.edu.cn/ggml-org/llama.cpp:full-cuda13-b9294`、`HAVE_NET`（0/1）

函数：`inventory()`、`provision_runtime()`、`ensure_image()`、`stage_model()`、`stage_digital_employee()`、`finalize()`。

main() 当前调用顺序（关键片段）：
```
inventory
provision_runtime
echo; hr '─'
stage_model
echo; hr '─'
stage_digital_employee
echo; hr '─'
stage_activation
...
```

SSH 220：`DE220_PWD=<密码> python scripts/activation/_ssh.py run "..."`（host 默认 220）。
SFTP chroot 到家目录：put 用家目录相对路径。

安装包体积：runtime 23G（gguf）、images 4.2G（tar）、packages ~340M（deb+cli）、ime 29M。
packages 里有 `*.debbak*` 备份文件，**打包要排除**。

---

## File Structure

| 文件 | 责任 |
|------|------|
| `scripts/release/pack-installer.sh` | 把完整 Installer 目录拆成核心包+模型包两个 zip + SHA256 |
| `scripts/release/test-pack-installer.sh` | 用 mock 目录验证拆包正确性 |
| `docs/installer-release-sop.md` | 发布 SOP（重打 deb 后的手动步骤） |
| `10.172.246.220:.../deploy.sh` | inventory die→warn+HAS_MODEL；main 条件跑模型阶段 |
| `scripts/activation/deploy.sh.modelopt.patch.md` | 记录 deploy.sh 本次改动点（溯源） |

---

## Task 1: pack-installer.sh 拆包脚本

**Files:**
- Create: `scripts/release/pack-installer.sh`
- Test: `scripts/release/test-pack-installer.sh`

- [ ] **Step 1: 写验证脚本（用 mock 目录）**

Create `scripts/release/test-pack-installer.sh`:

```bash
#!/usr/bin/env bash
# 用 mock Installer 目录验证 pack-installer.sh 拆包正确。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PACK="$HERE/pack-installer.sh"
PASS=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (exp=$2 act=$3)"; FAIL=$((FAIL+1)); fi; }

WORK="$(mktemp -d)"; INST="$WORK/BobanStaff-Installer"; OUT="$WORK/dist"
mkdir -p "$INST/packages" "$INST/images" "$INST/runtime" "$INST/ime"
echo "#!/bin/bash" > "$INST/deploy.sh"
# 占位文件（小，仅验证归类）
head -c 100 /dev/zero > "$INST/packages/DigitalEmployee-Offline-Linux-arm64-0.1.3.deb"
head -c 100 /dev/zero > "$INST/packages/DigitalEmployee-Offline-Linux-arm64-0.1.0.debbak2"
head -c 100 /dev/zero > "$INST/packages/hanhai-cli-linux-arm64.tar.gz"
head -c 100 /dev/zero > "$INST/ime/x.deb"
echo "compose" > "$INST/runtime/docker-compose.yml"
head -c 100 /dev/zero > "$INST/runtime/Hanhai-Q4.gguf"
head -c 100 /dev/zero > "$INST/runtime/mmproj-F16.gguf"
head -c 100 /dev/zero > "$INST/images/llama.tar"

bash "$PACK" "$INST" "$OUT" >/dev/null 2>&1

CORE="$(ls "$OUT"/BobanStaff-Core-*.zip 2>/dev/null | head -1)"
MODEL="$OUT/BobanStaff-Model.zip"
check "core zip exists (版本号)" "BobanStaff-Core-0.1.3.zip" "$(basename "$CORE" 2>/dev/null)"
check "model zip exists" "yes" "$([[ -f "$MODEL" ]] && echo yes || echo no)"

corelist="$(unzip -Z1 "$CORE" 2>/dev/null)"
check "core 含 deploy.sh"   "yes" "$(echo "$corelist" | grep -q '(^|/)deploy.sh$' && echo yes || echo no)"
check "core 含 deb"         "yes" "$(echo "$corelist" | grep -q '0.1.3.deb$' && echo yes || echo no)"
check "core 含 compose"     "yes" "$(echo "$corelist" | grep -q 'docker-compose.yml$' && echo yes || echo no)"
check "core 不含 gguf"      "no"  "$(echo "$corelist" | grep -q '.gguf$' && echo yes || echo no)"
check "core 不含 images tar" "no" "$(echo "$corelist" | grep -q 'images/.*tar$' && echo yes || echo no)"
check "core 排除 debbak"    "no"  "$(echo "$corelist" | grep -q 'debbak' && echo yes || echo no)"

modellist="$(unzip -Z1 "$MODEL" 2>/dev/null)"
check "model 含 gguf"       "yes" "$(echo "$modellist" | grep -q 'Hanhai-Q4.gguf$' && echo yes || echo no)"
check "model 含 images tar" "yes" "$(echo "$modellist" | grep -q 'images/.*tar$' && echo yes || echo no)"
check "model 不含 deb"      "no"  "$(echo "$modellist" | grep -q '.deb$' && echo yes || echo no)"
check "core SHA256SUMS"     "yes" "$([[ -f "$OUT/BobanStaff-Core-0.1.3.zip.sha256" ]] && echo yes || echo no)"

rm -rf "$WORK"
echo "----"; echo "PASS=$PASS FAIL=$FAIL"; [[ $FAIL -eq 0 ]]
```

- [ ] **Step 2: 跑确认失败**

Run: `bash scripts/release/test-pack-installer.sh`
Expected: FAIL（pack-installer.sh 不存在，报错或大量 FAIL）。

- [ ] **Step 3: 实现 pack-installer.sh**

Create `scripts/release/pack-installer.sh`:

```bash
#!/usr/bin/env bash
# 把完整 BobanStaff-Installer 目录拆成 核心包 + 模型包 两个 zip。
# 用法: pack-installer.sh <installer_dir> [out_dir=./dist]
set -uo pipefail

INST="${1:?用法: pack-installer.sh <installer_dir> [out_dir]}"
OUT="${2:-./dist}"
INST="$(cd "$INST" && pwd)"

[[ -f "$INST/deploy.sh" ]] || { echo "✗ 缺 deploy.sh: $INST" >&2; exit 1; }
[[ -d "$INST/packages" ]]  || { echo "✗ 缺 packages/" >&2; exit 1; }

# 版本号：取 packages 里最高版本的数字员工 deb（排除 debbak）
deb="$(ls -1v "$INST"/packages/DigitalEmployee-Offline-Linux-arm64-*.deb 2>/dev/null \
        | grep -vE 'debbak' | tail -1)"
[[ -n "$deb" ]] || { echo "✗ packages/ 无数字员工 .deb" >&2; exit 1; }
ver="$(basename "$deb" | sed -E 's/.*-([0-9]+\.[0-9]+\.[0-9]+)\.deb/\1/')"

mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
core="$OUT/BobanStaff-Core-${ver}.zip"
model="$OUT/BobanStaff-Model.zip"
rm -f "$core" "$model"

cd "$INST"

echo "» 打核心包 $core ..."
# 核心：deploy.sh + packages(排除 debbak) + ime + runtime 下仅 compose；不含 gguf/images
zip -q -r "$core" deploy.sh ime \
  -x '*.debbak*' >/dev/null 2>&1 || true
zip -q "$core" deploy.sh >/dev/null
# packages 排除 debbak
find packages -type f ! -name '*.debbak*' -print0 | xargs -0 zip -q "$core"
# ime
[[ -d ime ]] && find ime -type f -print0 | xargs -0 zip -q "$core" 2>/dev/null || true
# runtime 仅 compose（docker-compose.yml*，不含 gguf）
find runtime -maxdepth 1 -type f -name 'docker-compose.yml*' -print0 | xargs -0 zip -q "$core" 2>/dev/null || true

echo "» 打模型包 $model ..."
# 模型：runtime/*.gguf + images/*.tar
find runtime -maxdepth 1 -type f -name '*.gguf' -print0 | xargs -0 zip -q "$model" 2>/dev/null || true
[[ -d images ]] && find images -type f -name '*.tar' -print0 | xargs -0 zip -q "$model" 2>/dev/null || true

# 校验和
( cd "$OUT" && sha256sum "$(basename "$core")" > "$(basename "$core").sha256" )
[[ -f "$model" ]] && ( cd "$OUT" && sha256sum "$(basename "$model")" > "$(basename "$model").sha256" )

echo "✓ 完成 (版本 $ver)"
echo "  核心包: $core  ($(du -h "$core" | cut -f1))"
[[ -f "$model" ]] && echo "  模型包: $model  ($(du -h "$model" | cut -f1))"
```

> 注：核心 zip 先写 deploy.sh 再追加 packages/ime/runtime；`zip` 追加同名归档即累加条目。

- [ ] **Step 4: 跑确认通过**

Run: `bash scripts/release/test-pack-installer.sh`
Expected: 全部 PASS，`FAIL=0`。

> 若本机无 `zip`/`unzip`：在 git-bash 里通常自带；若缺，改在 220 真机跑此测试（put 两个脚本到家目录后 `bash test-pack-installer.sh`）。

- [ ] **Step 5: Commit**

```bash
git add scripts/release/pack-installer.sh scripts/release/test-pack-installer.sh
git commit -m "feat(release): 安装包拆分脚本（核心包+模型包）+ 验证"
```

---

## Task 2: deploy.sh —— inventory die→warn + HAS_MODEL 标志

**Files:**
- Modify: `10.172.246.220:/home/boban/BobanStaff-Installer/deploy.sh`（inventory 函数）

- [ ] **Step 1: 拉取并备份 220 deploy.sh**

Run:
```bash
DE220_PWD=<密码> python scripts/activation/_ssh.py run "cp -a /home/boban/BobanStaff-Installer/deploy.sh /home/boban/BobanStaff-Installer/deploy.sh.bak.premodelopt-20260617 && cat /home/boban/BobanStaff-Installer/deploy.sh" > /tmp/deploy.modelopt.sh
wc -l /tmp/deploy.modelopt.sh
```
Expected: 约 782 行（含已落地的激活阶段），备份成功。

- [ ] **Step 2: 改 inventory() —— 模型/镜像 die→warn + HAS_MODEL**

在本地 /tmp/deploy.modelopt.sh 中，`inventory()` 现有这两段（die）：
```bash
  [[ -f "$MODEL_FILE" || -f "$RT_SRC/Hanhai-Q4.gguf" ]] \
    || die "缺少模型 Hanhai-Q4.gguf" "放到 BobanStaff-Installer/runtime/ 或 ~/BobanStaff/models/"
```
和镜像那段：
```bash
  if docker image inspect "$IMAGE_REF" >/dev/null 2>&1; then IMG_SRC="已加载";
  elif ls "$IMAGE_TAR_DIR"/*.tar >/dev/null 2>&1; then IMG_SRC="离线tar";
  elif [[ $HAVE_NET == 1 ]]; then IMG_SRC="联网pull";
  else die "无可用镜像来源" "请提供 images/*.tar 或联网"; fi
  ok "镜像来源: $IMG_SRC"
```

把这两段整体替换为（模型与镜像合并判定 HAS_MODEL）：
```bash
  # 模型可选：有 gguf + 可用镜像来源 → 装模型；否则跳过模型阶段，仅装数字员工
  HAS_MODEL=1
  if [[ ! -f "$MODEL_FILE" && ! -f "$RT_SRC/Hanhai-Q4.gguf" ]]; then
    HAS_MODEL=0
    warn "未检测到模型 Hanhai-Q4.gguf（未下载模型包）"
  fi
  if docker image inspect "$IMAGE_REF" >/dev/null 2>&1; then IMG_SRC="已加载";
  elif ls "$IMAGE_TAR_DIR"/*.tar >/dev/null 2>&1; then IMG_SRC="离线tar";
  elif [[ $HAVE_NET == 1 ]]; then IMG_SRC="联网pull";
  else IMG_SRC=""; fi
  if [[ -z "$IMG_SRC" ]]; then
    HAS_MODEL=0
    warn "无可用模型镜像来源（未下载模型包且无离线 tar/联网）"
  else
    ok "镜像来源: $IMG_SRC"
  fi
  if [[ "$HAS_MODEL" == 0 ]]; then
    warn "将只安装数字员工，跳过本地模型服务；装好后请在数字员工应用内配置模型服务地址"
    record model SKIP "未提供模型包，跳过模型服务"
  fi
```

注意：`HAS_MODEL` 需在 inventory 里设置且对 main 可见。deploy.sh 用全局变量（函数内直接赋值即全局，bash 默认行为），OK。若 inventory 之前 compose 那段仍 die（compose 在核心包，缺它仍应 die），保留不动。

- [ ] **Step 3: 改 main() —— 模型阶段条件执行**

把 main() 中：
```bash
  inventory
  provision_runtime
  echo; hr '─'
  stage_model
  echo; hr '─'
  stage_digital_employee
```
改为：
```bash
  inventory
  if [[ "${HAS_MODEL:-1}" == 1 ]]; then
    provision_runtime
    echo; hr '─'
    stage_model
    echo; hr '─'
  fi
  stage_digital_employee
```

- [ ] **Step 4: 改 finalize() —— 无模型时加提示**

在 finalize() 里 print_report 之后、收尾提示区，加一段（找到 finalize 中 `say "  模型 API : ...` 或收尾 say 区域，紧随其后插入）：
```bash
  if [[ "${HAS_MODEL:-1}" == 0 ]]; then
    say "  ${YEL}注意${NC}：本机未安装本地模型，请在数字员工应用内配置模型服务地址。"
  fi
```
若 finalize 里没有合适锚点，插在 `ok "安装报告已保存..."` 之前即可。

- [ ] **Step 5: 推回 220 临时文件做语法检查**

Run:
```bash
DE220_PWD=<密码> python scripts/activation/_ssh.py put /tmp/deploy.modelopt.sh de-deploy.modelopt.sh
DE220_PWD=<密码> python scripts/activation/_ssh.py run "bash -n ~/de-deploy.modelopt.sh && echo SYNTAX_OK"
```
Expected: `SYNTAX_OK`。

> 注意 CRLF：本地编辑可能引入 CRLF，`bash -n` 报 `$'\r'` 时先在 220 上 `sed -i 's/\r$//' ~/de-deploy.modelopt.sh` 再检查。

- [ ] **Step 6: 无模型演练（关键回归）**

机器当前**有模型**。临时验证「无模型」分支：用环境覆盖让模型文件“看不到”——直接 source 测函数不现实（main 末尾会执行），改用一个**临时 INSTALLER 目录**只放 deploy.sh + 空 packages，跑 inventory 看 HAS_MODEL：
```bash
DE220_PWD=<密码> python scripts/activation/_ssh.py run '
set -e
T=/tmp/nomodel-test; rm -rf "$T"; mkdir -p "$T/packages" "$T/runtime"
cp ~/de-deploy.modelopt.sh "$T/deploy.sh"
echo "compose" > "$T/runtime/docker-compose.yml"
# 跑到 inventory 即可：用 bash 截取——source 前半（到 main 之前）较脆，
# 改为整跑但在 preflight 前注入：直接调用 inventory 后打印 HAS_MODEL
cd "$T"
# 抽取函数定义（去掉末行 main "$@"）后手动调
sed "$ d" deploy.sh > deploy.lib.sh
source deploy.lib.sh 2>/dev/null
INSTALLER_DIR="$T"; IMAGE_TAR_DIR="$T/images"; RT_SRC="$T/runtime"
MODELS_DIR="$T/models"; MODEL_FILE="$T/models/Hanhai-Q4.gguf"; COMPOSE_FILE="$T/runtime/docker-compose.yml"
HAVE_NET=0
init_ui 2>/dev/null
inventory 2>&1 | tail -5
echo "HAS_MODEL=$HAS_MODEL"
rm -rf "$T"
'
```
Expected: 输出含「未检测到模型」「将只安装数字员工」+ `HAS_MODEL=0`。
（若 source 因 set -u/颜色变量报错，先 `init_ui`；本步只验 inventory 的 HAS_MODEL 判定。）

- [ ] **Step 7: 正式落位 + 备份说明**

Run:
```bash
DE220_PWD=<密码> python scripts/activation/_ssh.py run "cp ~/de-deploy.modelopt.sh /home/boban/BobanStaff-Installer/deploy.sh && bash -n /home/boban/BobanStaff-Installer/deploy.sh && echo DEPLOYED && wc -l /home/boban/BobanStaff-Installer/deploy.sh"
```
Create `scripts/activation/deploy.sh.modelopt.patch.md`：记录改动点（inventory die→warn+HAS_MODEL、main 条件跑模型、finalize 提示）、备份名 `deploy.sh.bak.premodelopt-20260617`、220 路径。

- [ ] **Step 8: 清理 + Commit**

Run: `DE220_PWD=<密码> python scripts/activation/_ssh.py run "rm -f ~/de-deploy.modelopt.sh ~/deploy.lib.sh"`
```bash
git add scripts/activation/deploy.sh.modelopt.patch.md
git commit -m "feat(deploy): 模型自动可选（缺模型 die→warn+跳过，仅装数字员工）220 已落位"
```

---

## Task 3: 发布 SOP 文档

**Files:**
- Create: `docs/installer-release-sop.md`

- [ ] **Step 1: 写 SOP**

Create `docs/installer-release-sop.md`：

```markdown
# 安装包发布 SOP（deb 更新后）

## 何时触发
数字员工 deb 重新打包后，需更新核心包并同步飞书。

## 步骤

1. **放新 deb**：把新 `DigitalEmployee-Offline-Linux-arm64-<ver>.deb` 放进
   `BobanStaff-Installer/packages/`，删除/移走旧版与 `*.debbak*`。

2. **拆包**：
   \`\`\`bash
   bash scripts/release/pack-installer.sh /path/to/BobanStaff-Installer ./dist
   \`\`\`
   产出：`dist/BobanStaff-Core-<ver>.zip`（+ `.sha256`）、`dist/BobanStaff-Model.zip`（+ `.sha256`）。

3. **上传飞书**：
   - **核心包**：每次重打 deb 都要传 `BobanStaff-Core-<ver>.zip`。
   - **模型包**：仅当模型 gguf/镜像变了才传 `BobanStaff-Model.zip`（一般不变）。

4. **更新 wiki**（手动）：把核心包下载链接、版本号改到最新。
   wiki 自动更新见 roadmap（待应用 wiki 权限+协作者配好）。

## 用户下载指引（写进 wiki）
- 只用数字员工（不要本地模型）：只下**核心包**，解压后 `sudo bash deploy.sh`。
  装完在数字员工应用内配置模型服务地址。
- 要本地模型：核心包 + 模型包都下，**解压到同一个 `BobanStaff-Installer/` 目录**，
  再 `sudo bash deploy.sh`（自动检测到模型并安装）。

## 校验
下载后可对 `.sha256` 校验完整性：`sha256sum -c BobanStaff-Core-<ver>.zip.sha256`。
```

- [ ] **Step 2: Commit**

```bash
git add docs/installer-release-sop.md
git commit -m "docs(release): 安装包发布 SOP（拆包/上传飞书/更新wiki）"
```

---

## Self-Review

**Spec 覆盖：**
- 拆两个 zip（spec §3）→ Task 1（pack-installer.sh）✓
- 版本号从 deb 提取、排除 debbak（spec §3/§5）→ Task 1 实现 + 测试断言 ✓
- inventory die→warn+HAS_MODEL（spec §4.1）→ Task 2 Step 2 ✓
- main 条件跑模型阶段（spec §4.2）→ Task 2 Step 3 ✓
- finalize 无模型提示（spec §4.3）→ Task 2 Step 4 ✓
- 发布脚本（spec §5）→ Task 1 ✓
- 发布 SOP（spec §6）→ Task 3 ✓
- 测试：pack mock 验证 + deploy 无模型演练（spec §7）→ Task 1 Step 4 + Task 2 Step 6 ✓
- wiki 自动更新（spec §8 roadmap）→ 不实现，SOP 注明 ✓

**占位符扫描：** 无 TBD；每步含完整代码/命令与预期。✓

**命名一致性：** `pack-installer.sh <installer_dir> [out_dir]`、产物 `BobanStaff-Core-<ver>.zip`/
`BobanStaff-Model.zip`、`HAS_MODEL` 标志 —— 跨 Task 与 spec 一致。✓

**执行者注意：**
- Task 2 改 220 真机交付脚本：先备份、bash -n、无模型演练、确认 SYNTAX_OK 再正式落位。
- CRLF：本地编辑 deploy.sh 推 220 前若 `bash -n` 报 `\r`，先 `sed -i 's/\r$//'`。
- 机器当前有模型；Task 2 Step 6 用临时空目录验「无模型」分支，不破坏真实模型。
- 本机无 zip/unzip 时，Task 1 测试改在 220 跑。
