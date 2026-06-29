# Boban-Staff 一体机 · 现场部署手册

> 照着做即可。每步都给"应该看到什么"。出问题看最后一节"找谁"。

## 安装介质

存放在 `10.172.246.220`（用户 `boban` / 密码 `100200`）：
`/home/boban/BobanStaff-Installer`

拷到目标机（二选一）：
```bash
# 直接拷（示例目标机 159）
scp -r boban@10.172.246.220:/home/boban/BobanStaff-Installer boban@<目标机>:/home/boban/
```
或在线下载（飞书部署手册页提供）：

| 包 | 适用 | 内容 |
|----|------|------|
| **核心包** `BobanStaff-Core-<版本>.zip`（~270M） | 只装数字员工、**不要本地模型** | hanhai-cli + 输入法 + deploy.sh + headroom 镜像（选装）。**不含数字员工 deb** |
| **模型包** `BobanStaff-Model.zip`（~27G） | 需要本地模型（配合核心包一起） | 模型 gguf + llama.cpp 镜像 |

- **只用数字员工**：下核心包 + 按"准备 第 2 步"下载数字员工 deb，解压即用。
- **要本地模型**：核心包 + 模型包都下，**解压到同一个 `BobanStaff-Installer/` 目录**。

> **核心包不含数字员工 deb**（deb 体积大、版本更新频繁，独立分发）。务必按下面"准备 第 2 步"
> 从飞书下载最新 Linux/arm64 deb 放进 `packages/`，否则数字员工装不上。

## 准备

1. 把 `BobanStaff-Installer` 整个文件夹拷到机器（U盘 → 桌面/家目录均可）。

2. **换上最新数字员工 deb**（重要——deb 版本经常更新）：
   去飞书「**数字员工版本管理**」表拿最新 **Linux/arm64** 的 deb：
   https://scnj8otdvysf.feishu.cn/wiki/Zc3XwAhsMiJPUEk7IimcHMfKnoc?table=tblhM5KRRT2i8YsP
   - 在表里找**平台=Linux、版本号最高**那条，下载其附件（形如 `BobanStaff-Linux-arm64-<最新版>.deb`）。
   - 把它放进 `BobanStaff-Installer/packages/`，**删掉该目录里旧的 `*.deb`**（避免装到旧版）。
   > deploy 会自动选 packages 里版本号最高的 deb 安装；只放最新那个最稳妥。

3. 打开"终端"，进入该文件夹：
   ```bash
   cd ~/BobanStaff-Installer
   ```

## 目录结构（解压后应看到）

**只装核心包**（不要本地模型）：
```
BobanStaff-Installer/
├── deploy.sh                  ← 安装脚本（在这里运行）
├── packages/
│   ├── BobanStaff-Offline-Linux-arm64-<版本>.deb        数字员工（← 准备第2步从飞书下载放入；核心包不自带）
│   └── hanhai-cli-linux-arm64.tar.gz                    瀚海 CLI
├── branding/                  品牌定制（选装，要做国网版等才放；见"可选：品牌版本"一节）
├── ime/                       中文输入法离线包
├── images/
│   └── headroom-arm64.tar     压缩网关镜像（选装，默认不启用）
└── runtime/
    └── docker-compose.yml     模型服务编排模板（仅模板，无模型文件）
```

**核心包 + 模型包**（要本地模型，两包解压到同一目录后）：
```
BobanStaff-Installer/
├── deploy.sh
├── packages/   ...（同上）
├── ime/        ...
├── runtime/
│   ├── docker-compose.yml
│   ├── Hanhai-Q4.gguf         ← 模型包带来（约 22G）
│   └── mmproj-F16.gguf        ← 模型包带来（视觉头）
└── images/
    └── llama-cpp-*.tar        ← 模型包带来（llama.cpp 镜像，约 4.2G）
```

**激活相关文件放哪**：
- 第 2 步拿到的 `license.code` → 放在**与 deploy.sh 同一层**（即 `BobanStaff-Installer/license.code`）。
- 激活成功后系统自动生成 `~/.boban-staff-next/data/activation.json`（不用手动管）。

> 介质里若看到 `*.bak` / `*.debbak` 等备份文件，忽略即可，不影响安装。

---

## 第 1 步：取设备码

运行：
```bash
sudo bash deploy.sh
```
输入开机密码。

**应该看到**：跑到"数字员工激活"阶段，屏幕显示：
```
  设备码（序列号）：XXXX-XXXX-XXXX-XXXX-XXXX
  请凭此码在飞书申请激活码。
  未发现授权码文件。粘入授权码后回车（留空跳过）：
```

➡️ 此时**直接回车跳过**（先不激活），把那行 `XXXX-XXXX-…` 设备码原样发起**飞书审批**
（审批单「数字员工激活申请」→ 填设备码 + 截至日期 → 提交）。

> 没装本地模型时，前面会看到 `⚠ 未检测到模型…将只安装数字员工`，**正常**，继续即可。

---

## 第 2 步：拿激活码

飞书审批**通过后**，系统会自动出码，**在该审批单的评论里**回写：
- 一条评论：`【激活授权码】<一长串>` + 使用说明
- 一个附件：`license.code`

拿激活码两种方式（任选）：
- **复制评论里那串激活码**，或
- **下载评论附件 `license.code`**

把它放进安装目录（和 deploy.sh 同一层），命名为 `license.code`：
```
~/BobanStaff-Installer/license.code
```
> 也可不放文件——第 3 步运行时直接把激活码粘进终端。

**应该看到**：`ls ~/BobanStaff-Installer` 里有 `license.code`、`deploy.sh`、`packages/` 等。

---

## 第 3 步：正式安装 + 激活

再次运行：
```bash
sudo bash deploy.sh
```
- 若放了 `license.code`：激活阶段显示 `» 已从文件读取授权码` → `✓ 已激活，有效期至 …`。
- 若没放文件：激活阶段提示"粘入授权码"时，把激活码粘进去回车。

**应该看到**：依次跑完各阶段，最后出现 **安装总结报告**，状态尽量都是 ✓ 成功 / • 跳过：
```
模型服务(Hanhai)   ✓ 成功      （没装模型则显示 • 跳过）
数字员工(Boban)    ✓ 成功
数字员工激活       ✓ 成功
输入法切 ibus      ✓ 成功
...
✓ 全部环节正常，无需额外处理
```
末尾提示"安装报告已保存"和"收尾步骤"。

若报告里有 ⚠ 注意 / ✗ 失败，按报告里"问题与解决建议"操作；解决不了见最后一节。

---

## 第 4 步：重启（启用中文输入法）

报告若提示需要重启，重启机器（或注销重新登录）。

**应该看到**：重新登录后，桌面右上角出现 中/英 输入法图标；用 **Super(⊞)+空格** 切到"拼音"，能打中文。

---

## 第 5 步：验收

逐项确认：
- [ ] 桌面壁纸已更换、Dock 在底部、固定栏只有 火狐 / Boban / 文件 / 终端 / 设置 五个。
- [ ] 能打中文（Super+空格 切拼音）。
- [ ] 数字员工能打开，**已激活**（不再跳激活页）。
- [ ] 若装了本地模型：`curl -s http://localhost:12345/v1/models` 返回一段 JSON（不是报错）。
      没装模型则跳过此项——改在数字员工应用内配置模型服务地址。
- [ ] 重登后自动弹出一次安装报告窗口（看一眼即可关）。

---

## 第 6 步：清理安装目录（必做）

验收没问题后，运行：
```bash
sudo bash ~/BobanStaff-Installer/deploy.sh --cleanup
```
**应该看到**：先重打印一遍安装报告，然后：
```
✓ 已清理安装目录，机密数据已移除。交付完成。
```
此后 `~/BobanStaff-Installer` 文件夹消失。

✅ 到此交付完成。

---

## 可选：品牌版本（白标 / 国网版等）

> 不需要定制品牌就**整段跳过**——不放 `branding/` 文件夹时，装出来就是出厂的「数字员工 / BobanStaff」样子。
> 需要客户端 deb 是 **0.1.30 及以上**（旧版不带品牌机制，放了也不生效）。

要做某个品牌版本（例：国网版），只改**图 + 文字**两类文件，不用改代码、不用重新打包：

1. 在安装目录放一个 `branding/` 文件夹（和 `deploy.sh` 同一层），里面放：
   ```
   BobanStaff-Installer/branding/
   ├── brand.json      品牌文字
   └── logo.png        品牌 logo（about / 登录 / 标题栏 / 启动屏都用它）
   ```
2. `brand.json` 内容（按需改文字；`{year}` 会自动替换成当年）：
   ```json
   {
     "productName": "国网数字员工",
     "windowTitle": "国网数字员工",
     "subtitle": "数字员工智能助手",
     "companyName": "国家电网",
     "copyright": "© {year} 国家电网. All rights reserved.",
     "logos": { "app": "logo.png", "login": "logo.png", "splash": "logo.png" },
     "defaultTheme": "green"
   }
   ```
   - `defaultTheme` 可选：首次启动的默认主题色（`default` 靛蓝 / `green` 国网绿 / `teal` 青蓝）。
     用户之后仍可在 **设置 → 通用 → 主题色** 自行切换。
3. 正常跑 `sudo bash deploy.sh`（装完数字员工后会自动应用品牌）。

**应该看到**：安装总结里多一行
```
品牌资源包         ✓ 成功     已应用品牌：国网数字员工
```
打开数字员工：about / 登录页 / 标题栏 / 启动屏显示「国网数字员工」「© 国家电网」，主题色为绿。

**验证 / 排查**：
```bash
cat /opt/BobanStaff/resources/branding/active/brand.json   # 应是你放的品牌内容
```
- 装出来还是「数字员工」没变 → 检查：deb 是否 ≥0.1.30；`branding/brand.json` 是否和 deploy.sh 同层；总结里"品牌资源包"那行状态。
- **还原成出厂默认**：删掉 `/opt/BobanStaff/resources/branding/active/` 整个目录，重启数字员工即可。

> 字段全量说明见客户端仓库 `apps/web/branding/README.md`；deploy.sh 的 `stage_branding` 实现见
> `scripts/activation/deploy.sh.branding.patch.md`。

---

## 出问题怎么办（对照表）

| 现象 | 怎么做 |
|------|--------|
| 第 1 步没显示设备码 | 安装介质不完整，重新拷贝整个 `BobanStaff-Installer` |
| 激活报"授权码无效（设备不符或已过期）" | 确认激活码是**本机这次设备码**签发的；换机器/换过网卡设备码会变，需重新走飞书审批 |
| 飞书审批通过了但评论里没出激活码 | 等 ≤1 分钟（轮询出码）；仍无则联系管理员看签发服务 |
| 报告里"模型服务 ✗ 失败" | 记下报告路径，把 `cat 该路径` 内容发给技术对接人 |
| 没装模型，数字员工连不上模型 | 在数字员工应用内配置模型服务地址（远程 API 或其它服务） |
| 中文还是打不出（已重启） | 再注销重登一次；仍不行联系技术对接人 |
| 放了 `branding/` 但品牌没变 | 确认 deb ≥0.1.30、`branding/brand.json` 与 deploy.sh 同层；看总结"品牌资源包"那行；详见"可选：品牌版本" |
| `--cleanup` 后还想看报告 | 报告已随安装目录删除，正常现象 |

---

## 找谁

- 授权码 / 设备码 / 飞书审批：**[管理员/审批群]**
- 安装报错 / 技术问题：**[技术对接人 + 联系方式]**

> 把方括号替换成实际联系人后再发给现场人员。

版本 v2.2（核心包不含 deb 单独下载 / headroom 压缩网关选装 / 数据目录 `.boban-staff-next` / 品牌版本选装）

---

## 附录：现场常见环境问题

### 压缩网关 headroom（选装，默认关）

核心包带了 `images/headroom-arm64.tar`，但**默认不启用**。如需启用（数据型任务可省 ~20% token，
对话类无收益）：
```bash
sudo WITH_HEADROOM=1 bash deploy.sh
```
启用后数字员工经网关透明压缩转发，**应用端点仍是 `:12345`、无需改任何应用配置**（网关接管 12345、
模型让到 12399）。不加该环境变量则数字员工直连模型，等同不装。离线机器只从上面那个 tar 载入，不联网拉取。

### VPN（headscale / tailscale）
```bash
headscale nodes register --key <NODE_KEY> --user <USERNAME>
# 网络不通时排查：
sudo tailscale down
sudo arping -I enP7s7 -c 3 10.172.246.1      # 用有线网卡 arping 网关
ping 10.172.246.<xxx>                          # ping 同网段另一台机器
sudo tailscale up
```

### Python 每次重装依赖 / 走国内源
```bash
mkdir -p ~/.config/pip
printf '[global]\nbreak-system-packages = true\nindex-url = https://mirrors.aliyun.com/pypi/simple/\ntrusted-host = mirrors.aliyun.com\n' > ~/.config/pip/pip.conf
```
