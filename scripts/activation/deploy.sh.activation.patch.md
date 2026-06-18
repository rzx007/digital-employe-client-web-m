# deploy.sh 激活阶段整合补丁说明

把本仓库 `scripts/activation/deploy-activation.sh` 的激活函数库内联进交付机一体机安装器
`deploy.sh`，新增「数字员工激活」阶段（设备码生成 / 双通道取授权码 / 校验 / 落位
`activation.json` / 报告）。

## 目标机器与路径

- 主机：220（`10.172.246.220`，用户 `boban`）
- 安装器：`/home/boban/BobanStaff-Installer/deploy.sh`
- 行数：633 → 781（+148：内联库 145 行 + main 调用 2 行 + status_label 1 行）

## 备份

落位前已备份原始脚本（请勿删除）：

- `/home/boban/BobanStaff-Installer/deploy.sh.bak.preactivation-20260616`

激活态文件早前已备份（请勿删除，整个改动绝不触碰真实 activation.json）：

- `/home/boban/.digital-employee/data/activation.json.bak-plan`

## 三处改动点

1. **内联激活库**（改动 A）
   在 `preflight()` 之后、`verify_sums()`（`# 校验目录内 SHA256SUMS` 注释那行）**之前**，
   插入整段激活函数库：`de_compute_device_code` / `de_format_device_code` /
   `de_parse_license` / `de_now_iso` / `de_data_dir` / `de_write_activation_json` /
   `DE_LICENSE_FILE_CANDIDATES` 数组 / `de_read_license_from_file` /
   `de_license_valid_for_device` / `stage_activation`。
   选这个位置：顶部 `PKG_DIR` / `INSTALLER_DIR` 已定义，数组求值时变量已就绪。

2. **main() 调用**（改动 B）
   在 `main()` 中 `stage_digital_employee` 之后插入：

   ```bash
   stage_digital_employee
   echo; hr '─'
   stage_activation        # 新增
   echo; hr '─'            # 新增
   stage_hanhai_cli
   ```

3. **status_label 报告标签**（改动 C）
   在 `status_label()` 的 `digital_employee)` case 之后加：

   ```bash
   activation) echo "数字员工激活";;
   ```

## 内联时为何去掉「降级桩」6 行

源文件 `deploy-activation.sh` 开头有一段独立运行降级桩（`type record ... || ...` 到
`: "${DE_USER:=$(id -un)}"`），用于该脚本被单独 `source` 测试时补齐 `record/say/ok/
warn/info/DE_USER`。内联进 `deploy.sh` 后这些都已由 deploy.sh 自身提供，桩多余；尤其
真机上 `info` 会被系统 texinfo 抢占，桩里的 `type info ... ||` 会误判而有害。故内联时
连同 shebang 一并去掉。

## 落位流程（已执行并验证）

1. 拉取真机 deploy.sh（633 行）。
2. 备份为 `deploy.sh.bak.preactivation-20260616`。
3. 本地三处编辑。
4. 推回临时文件 `~/de-deploy.new.sh`，`bash -n` 语法检查 → SYNTAX_OK。
   （注意：Windows 编辑会引入 CRLF，推送前必须转成 LF，否则 `bash -n` 报
   `$'{\r'` 语法错。）
5. 幂等演练：`source` 去掉末行 `main "$@"` 的脚本 → 调 `init_ui` → `stage_activation`。
   机器已激活 → 命中 SKIP 分支，输出「已激活（设备码 3E56-77F8-E917-9E20-7A30）」，
   不写文件。
6. 落位覆盖 `deploy.sh`（781 行），`bash -n` 再校验 → OK。

## 已知现象：activation.json 的 last_seen_at 会自行变化

真机上数字员工本体在后台**持续心跳更新** `activation.json` 的 `last_seen_at`
（实测约每 20s 一次，即便不跑任何命令也在动）。所以与 `activation.json.bak-plan`
逐字节 diff **不会**相等——但差异**只**在 `last_seen_at`。

集成关键字段 `device_code` / `license_code` / `expires_at` / `activated_at` 与备份
**逐字节一致**，证明本 Task 的演练/落位**未触碰**真实激活态。`stage_activation` 的
SKIP 分支本就不写文件；若误写，`de_write_activation_json` 会一并改写 `activated_at`，
而它未变。

校验整性（忽略 last_seen_at）：

```bash
python3 -c "
import json
a=json.load(open('/home/boban/.digital-employee/data/activation.json'))
b=json.load(open('/home/boban/.digital-employee/data/activation.json.bak-plan'))
keys=['device_code','license_code','expires_at','activated_at']
print('INTEGRITY_IDENTICAL' if all(a[k]==b[k] for k in keys) else 'DIFF')
"
```

## 后续维护：lib 改动后必须重新内联

本仓库 `deploy-activation.sh` 是真源；现场 `deploy.sh` 是其内联副本。
任何对 lib 函数（特别是 `de_read_license_from_file` / `de_license_valid_for_device` /
`stage_activation`）的修改，都必须按上面「三处改动点」流程重新内联进
`/home/boban/BobanStaff-Installer/deploy.sh`，否则现场 deploy 跑的还是旧版。

### 2026-06-18 修复：双行 activation.md（设备码 + 授权码）兼容

- 现象：现场 `packages/activation.md` 实际是「第一行设备码 / 第二行授权码」两行格式，
  旧 `de_read_license_from_file` 用 `awk 'NF{print;exit}'` 取首行非空 → 取到设备码当
  授权码送进 base64URL 解码 → `json.loads` 报 `'utf-8' codec can't decode byte 0xdc`，
  然后被笼统兜底成「授权码无效（设备不符或已过期）」，误导现场。
- 修复（仓库已落）：
  - `de_extract_license_token` 用 `awk match(...)` 抓第一段 `base64URL.base64URL`，
    跳过设备码行、注释、Markdown 包装、UTF-8 BOM、CRLF。
  - `stage_activation` 拆开「格式错」与「设备/有效期不符」两种 warn/record。
  - `test-deploy-activation.sh` 加 5 条回归用例（含本 bug 复现），220 真机 14/14 PASS。
- 下次出 installer 包前：按本文档「三处改动点」把改后的 lib 重新内联进 `deploy.sh`。

### 2026-06-18 清理：废弃 packages/activation.md

- `packages/activation.md` 是历史模板，现场手册早已改用 `INSTALLER_DIR/license.code`（与 deploy.sh
  同层）。废弃动作（仓库已落）：
  - `scripts/release/pack-installer.sh` 打核心包时显式 `! -name 'activation.md'`，不再随包流转。
  - `DE_LICENSE_FILE_CANDIDATES` 移除 `${PKG_DIR}/activation.md`；候选 1 改为
    `${INSTALLER_DIR}/license.code`（与 [`docs/field-deployment-manual.md`](../../docs/field-deployment-manual.md)
    对齐），`${INSTALLER_DIR}/activation.code` 作为历史兼容降至候选 2。
  - `docs/field-deployment-manual.md` 目录树移除 `activation.md ...（参考）` 一行。
- 220 真机已 `rm packages/activation.md`，并确认 `~/BobanStaff/activation/license.code`
  仍在候选 3 处可被读到（当前 license 当天到期，需后续换长期码）。

### 2026-06-18 修复：sudo 下 `$HOME=/root` 导致候选 3 / activation.json 全部指错

- 现象：飞书签发模板让装机员把附件 `license.code` 放到 `~/BobanStaff/activation/license.code`，
  装机员通常 `sudo bash deploy.sh` 跑安装 → `$HOME` 变成 `/root` → 候选 3 的
  `${HOME}/BobanStaff/activation/license.code` 被解算成 `/root/BobanStaff/activation/license.code`，
  装机员明明放对了路径，deploy 还是报「未发现授权码文件」。`de_data_dir` 也同样错位
  （`activation.json` 会被写到 `/root/.digital-employee/data/`，而 App 跑在真用户下从
  `/home/<user>/.digital-employee/data/` 读，永远见不到刚写的激活态）。
- 修复（仓库已落）：
  - 新增 `de_caller_home`：sudo 下回查 `SUDO_USER` 的 passwd 家目录，否则降级 `$HOME`。
  - `de_data_dir` 与候选 3 都改用 `de_caller_home`，根本上修掉 sudo 错位。
  - `test-deploy-activation.sh` 加 3 条用例：sudo 下解 SUDO_USER 家、无 sudo 走 $HOME、
    候选 3 在 sudo 下指向真用户家（220 真机 17/17 PASS）。
- 现场 220 上 deploy.sh 仍是旧内联版，临时绕过：
  `sudo -E bash ~/BobanStaff-Installer/deploy.sh`（保留 `$HOME`）或
  `sudo HOME=/home/boban bash ~/BobanStaff-Installer/deploy.sh`。下次出 installer 包要把
  改后的 lib 重新内联进 `deploy.sh`。
- **2026-06-18 已重新内联进 220 deploy.sh**（811→873 行），备份
  `deploy.sh.bak.preinline-20260618-102321` / `deploy.sh.bak.prewarn-*`。sudo 模拟
  （HOME=/root + SUDO_USER=boban）e2e 通过；裸 `sudo bash deploy.sh` 现已可直接激活。

### 2026-06-18 增强：覆盖已有激活时给出告知（只加提示，不改判定）

- 背景：用户反馈「重激活要先删 activation.json，没有任何覆盖提示，容易把长效激活
  降级成临时码」。决策＝**只加提示、不改控制流**（保持现有删 json 重激活的流程）。
- 改动（`stage_activation` 写入前）：
  - 若已存在 activation.json：打印 `⚠ 即将覆盖已有激活：当前到期 X → 新授权码到期 Y`。
  - 若新码到期更早：追加 `⚠ 新授权码到期更早（降级）…` 提醒。
  - 若新码 ≤24h 到期：`⚠ 新授权码即将到期…可能是临时码`。
  - 全部为告知，不读取确认、不阻塞，非交互装机不受影响。
- 已随上面同一次内联落到 220 deploy.sh；降级分支与覆盖分支均 e2e 验证打印正确。

### 2026-06-18 增强 2：幂等跳过时也比对磁盘 license.code 并告知

- 背景：上一条「覆盖提示」活在写入路径里，而**已有效激活时 `stage_activation` 顶部幂等分支
  直接 return**，根本到不了写入路径——用户把 license.code 换成更短的码重跑，脚本静默跳过、
  毫无反馈，误以为「提示没生效」。
- 决策＝**跳过时也比对并告知**（仍跳过、保护当前有效激活不被降级，只多打一行）：
  - 幂等分支 return 前，读磁盘 license.code（`de_read_license_from_file`）解出到期日，
    与 activation.json 的 `expires_at` 比对；不一致则 `⚠ 磁盘授权码到期 X 与当前激活 Y
    不一致；已保持当前激活不变`，并提示「删 activation.json 后重跑可切换」。
  - 不改跳过决策：activation.json 不被覆盖（e2e 验证后仍为 2027-07-01）。
- 已重新内联进 220 deploy.sh（→883 行），备份 `deploy.sh.bak.preskipnote-*`；
  真实场景（活 2027-07-01 + 盘 6-18）e2e 通过：打印不一致告知且不降级。

### 2026-06-18 简化：覆盖确认收敛为单个 y/N（取代上面两条增强）

- 用户反馈「太复杂，简单点直接 y/n 问我要不要覆盖」。`stage_activation` 重写，
  删掉「即将覆盖 / 降级 / ≤24h / 跳过比对告知」全部分支，统一成一条 y/N 确认：
  - 取码（文件优先；已有效激活时不再弹粘贴提示）→ 解析校验。
  - **仅当**「当前已是有效激活」且「新码到期 ≠ 当前」时才询问：
    ```
    当前已激活，有效期至 X。
    新授权码有效期至 Y。
    是否用新授权码覆盖当前激活？[y/N]
    ```
    - `y/Y` → 覆盖；其它/回车 → 保持当前，不覆盖。
  - 同码（到期相同）→ 静默「已激活」，不弹窗（装机重跑不打扰）。
  - **非交互（无 TTY）**→ 不覆盖，保持当前有效激活，提示「删 activation.json 后重跑
    或在交互终端运行」（绝不在无人值守下把长效码降级）。
  - 无当前有效激活（首次/已过期/设备不符）→ 直接写入，无需确认。
- 已重新内联进 220 deploy.sh（→870 行），备份 `deploy.sh.bak.preyn-*`。
- e2e 全场景验证（PTY 模拟终端）：同码不弹窗 / `n` 保持 2027-07-01 / `y` 覆盖 /
  非交互保持 —— 均符合预期，真实 activation.json 全程零误触。
