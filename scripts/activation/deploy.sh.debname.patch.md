# deploy.sh / pack-installer deb 命名兼容改动记录

> 2026-06-17。修复：CI 产出的 deb 命名从 `DigitalEmployee-Offline-Linux-arm64-*.deb`
> 变为 `BobanStaff-Linux-arm64-*.deb`（飞书「数字员工版本管理」表里全是后者），
> 而 deploy.sh / pack-installer.sh 仍按旧前缀匹配 → 用户下新 deb 会被静默跳过。

## 问题
- 版本表（`tblhM5KRRT2i8YsP`）的 Linux 包：`BobanStaff-Linux-arm64-0.1.16.deb`
- deploy.sh / pack-installer.sh 匹配：`DigitalEmployee-Offline-Linux-arm64-*.deb`
- 前缀不符 → deploy 匹配不到 deb → warn 跳过（非 die），现场静默装不上数字员工。

## 改动

### 220 真机 deploy.sh（备份 `deploy.sh.bak.predebname-20260617`，改后 811 行）
1. **inventory（约 388 行）+ stage_digital_employee 检测**：deb 匹配 glob
   `DigitalEmployee-Offline-Linux-arm64-*.deb` → `*Linux-arm64-*.deb`（兼容两种前缀）。
   `$PKG_DIR` 里只有数字员工 deb，输入法 deb 在 `$IME_DIR`，不会误伤。
2. **stage_digital_employee 选包（约 464 行）**：原 `ls -1v ... | tail -1`（按文件名字符串
   排序，混前缀会选错版本，如 BobanStaff < DigitalEmployee 导致选到旧版）→ 改为
   **遍历按 `dpkg --compare-versions` 选包内 Version 最高的 deb**，与文件名前缀无关，
   并跳过 `*.debbak*`。

### pack-installer.sh（本仓库）
- deb glob 同样改 `*Linux-arm64-*.deb`。
- 选最高版改为**按提取出的版本号 `sort -V`** 比较（原 `ls -1v|tail -1` 受前缀字母干扰，
  BobanStaff- 会排在 DigitalEmployee- 前导致选错）。
- 测试新增混合命名用例（DigitalEmployee 0.1.0/0.1.1/0.1.3 + BobanStaff 0.1.16），
  验证选中 0.1.16、核心包含新命名 deb、不含旧版。PASS=14 FAIL=0。

## 验证
- 220：`bash -n` SYNTAX_OK；选包逻辑按 dpkg Version。
- pack 测试：14/14 通过（含混合命名场景）。
