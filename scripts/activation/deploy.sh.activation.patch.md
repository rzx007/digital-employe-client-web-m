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
