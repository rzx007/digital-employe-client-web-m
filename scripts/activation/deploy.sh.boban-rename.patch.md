# deploy.sh —— 应用改名 digital-employee → boban-staff 的部署适配

> 2026-06-26。背景：commit `4662f819` 把 `apps/web/package.json` 的 `name` 从
> `digital-employee` 改成 `boban-staff`，连带把 **deb 包名**也改了。两个包的文件
> 都装在 `/opt/BobanStaff/*`，老机器（已装 `digital-employee`）升级到 `boban-staff`
> 时，`dpkg -i` 会与旧包撞「文件覆盖」冲突而失败。

## 现象

220 真机（10.172.246.220）上跑 `deploy.sh` 装 0.1.28：

- 旧包 `digital-employee 0.1.16` 文件在 `/opt/BobanStaff/*`
- 新 deb 包名 `boban-staff 0.1.28`，文件**也在** `/opt/BobanStaff/*`，且 control 里
  **没有** `Replaces/Conflicts/Provides`
- `dpkg -i boban-staff.deb` → `试图覆盖 /opt/BobanStaff/...，它同时被包含于软件包
  digital-employee` → 安装失败

另外两个附带问题：

- `deploy.sh` 选完最高版 deb 后，用旧包名 `dpkg-query -W digital-employee` 查当前
  版本（没跟上改名）。
- 升级确认 `[y/N]` 默认 `n` 且仅 `[[ -t 0 ]]` 时询问 → 无人值守（无 tty）跑会直接
  **跳过升级**。

## 根治（已进仓库，首选）

`apps/web/electron-builder.json5` 与 `electron-builder.offline.json5` 顶层加 `deb`：

```json5
"deb": {
  "fpm": ["--conflicts", "digital-employee",
          "--replaces", "digital-employee",
          "--provides", "digital-employee"]
}
```

新 deb 声明 `Conflicts/Replaces/Provides: digital-employee` 后，**任何机器** `dpkg -i`
都会自动卸掉旧 `digital-employee` 再装 `boban-staff`，无需每台现场改 deploy.sh。
出新包后即可把现场补丁还原成原版（220 备份在 `deploy.sh.bak.preboban`）。

## 现场临时补丁（220，根治包发布前的兜底）

`/home/boban/BobanStaff-Installer/deploy.sh` 的 `stage_digital_employee()`，3 处：

1. **curver 双名识别**（仍需保留——deploy.sh 仍按版本号判断是否升级）：
   ```bash
   curver=$(dpkg-query -W -f '${Version}' boban-staff 2>/dev/null)
   [[ -n "$curver" ]] || curver=$(dpkg-query -W -f '${Version}' digital-employee 2>/dev/null)
   ```
2. **装前移除冲突旧包**（根治 deb 发布后此步冗余但无害，dpkg 会自动卸）：
   两处 `dpkg -i '$deb' ...` 前加
   `dpkg -s digital-employee >/dev/null 2>&1 && dpkg --remove digital-employee || apt-get remove -y digital-employee;`
3. **升级分支非交互默认升级**：`local ans="n"` → `local ans="y"`
   （有 tty 仍 `read` 询问、回车=N；无 tty 自动升级）。

验证结果：`boban-staff 0.1.28 ii` / `digital-employee 0.1.16 rc`（已移除）/
`/opt/BobanStaff` 归 boban-staff / 激活自动恢复。部署成功。

## 顺带：`record()` 的假阳性 WARN（建议一并修）

`stage_digital_employee` 升级成功仍在总结里报 **⚠ 升级异常**。根因是
`run_step ... && record … OK … || record … WARN …` 反模式 + `record()` 末行：

```bash
record() { ...; [[ -n "$f" ]] && REPORT_FIX[$k]="$f"; }
```

OK 调用不带第 4 个 `fix` 参数 → `f=""` → `[[ -n "" ]]` 为假 → `record` 返回 **1**
→ `|| record WARN` 跟着也执行、把状态盖成 WARN。**升级本身是成功的**（`run_step`
打了 `✓`，rc=0）。修法：`record()` 末尾加 `return 0`，一举修掉所有此类误报。
