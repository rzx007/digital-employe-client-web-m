# 激活证书中立化 · 多程序共享设计

> 日期：2026-06-16
> 目标：把激活证书提到中立位置，固化「跨语言自验」契约，为多程序共享激活铺路。

## 1. 背景与问题

当前激活体系只锁**数字员工**一个组件（`apps/server`）：它填码 → `verify_license` 验签 →
写 `~/.digital-employee/data/activation.json`。其余两个程序无任何激活逻辑：

- **模型服务 / llama.cpp**：原版 C++ 二进制，不改源码，无法内建校验。
- **hanhai-cli**：Node 程序，可做校验但本期不做。

要点澄清：**激活证书是「数据」不是「服务」**。证书已被私钥签名，任何持公钥的程序都能
**独立验真伪**（Ed25519 非对称签名的本质）。所以多程序共享激活 = 「各自读同一张证书、
各自用同一把公钥验签」，**不需要任何运行时服务互相校验**，离线天然成立。

## 2. 本期范围（YAGNI）

**本期只做一件事**：把证书从数字员工私有目录提到中立目录 `~/BobanStaff/activation/`，
并把「如何读证书并自验」固化成一份**跨语言契约文档**。

| 程序 | 本期 |
|------|------|
| 数字员工（Python） | ✅ 改证书路径 + 老证书平滑迁移 + env 覆盖口 |
| hanhai-cli（Node） | ❌ 不做（将来按契约写 Node 验签，成本低） |
| 模型 / llama.cpp（C++） | ❌ 不做（不改源码做不到，将来考虑守卫/补丁） |

**明确不做**：Node 验签库、模型层守卫进程、飞书在线签发。均列入 roadmap。

## 3. 激活证书契约（Activation Certificate Contract）

本期真正的交付物之一。任何语言的程序照此即可自验，无需读数字员工源码。

| 项 | 约定 |
|----|------|
| 证书路径 | `~/BobanStaff/activation/activation.json`（`~` = 用户主目录，跨平台展开） |
| 证书格式 | `ActivationRecord` 字段：`device_code` / `license_code` / `expires_at` / `activated_at` / `last_seen_at` |
| 公钥 | 同一把 Ed25519 公钥（与 `apps/server/src/core/activation/public_key.pem` 同一把），各程序**内嵌** |
| 授权码格式 | `base64url(payload).base64url(signature)`，payload = `{d, exp, iat, v}` |
| 校验三步 | ① 公钥验签 → ② 证书 `device_code` == 本机实算设备码 → ③ 未过期 |
| 设备码算法 | `SHA256(MAC地址 \| 机器GUID)` 取前 20 位 hex 大写（三方必须**等价实现**） |
| 机器 ID 来源 | Win：注册表 `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`；macOS：`IOPlatformUUID`；Linux：`/etc/machine-id` |
| 路径覆盖 | 可选环境变量 `BOBAN_LICENSE_DIR` 覆盖目录；未设则用默认 |
| 角色 | 数字员工 = **唯一写入方**（激活入口）；其他程序 = **只读消费者** |

> 设备码算法是跨语言一致性的最大风险点：Node/C++ 复刻时 MAC 取值、拼接顺序、
> 截断长度、大小写必须与 Python 完全一致，否则 `device_mismatch`。契约文档须给出
> 逐字节示例（输入 → 中间值 → 输出）供对拍。

## 4. 本期代码改动（只动数字员工）

集中在一个 IO 点 + 一次平滑迁移。

### 4.1 改证书路径（核心）

[`apps/server/src/core/activation/storage.py`](../../../apps/server/src/core/activation/storage.py)
现有 `_data_dir()` 返回 sqlite 同目录（`~/.digital-employee/data/`）。

改为：证书目录 = `BOBAN_LICENSE_DIR`（若设）否则 `~/BobanStaff/activation/`。
storage 是唯一 IO 点，service 层（`activation_service.py`）无需改动。

### 4.2 老证书平滑迁移

已激活老用户证书在旧路径（`~/.digital-employee/data/activation.json`）。

`read_record()` 逻辑：
1. 读新路径 → 命中即返回。
2. 新路径无 → 回退读旧路径。
3. 旧路径命中 → **搬迁**：写到新路径 + 删旧路径，返回该记录。
4. 都无 → `None`（未激活）。

效果：老用户重启即无感迁移，不需重新激活。

### 4.3 路径环境变量覆盖

新增可选 `BOBAN_LICENSE_DIR`，未设用默认 `~/BobanStaff/activation/`。
供部署/测试统一指定，也是将来 hanhai-cli 接入时共认的同一 env。

### 4.4 文档同步

- 写出本契约的独立文档（或本 spec 第 3 节即为契约源）。
- 更新 [`docs/activation-flow-current.md`](../../activation-flow-current.md) 的证书路径
  与「多程序共享」一节。

## 5. 测试

迁移逻辑必须有测试（用临时目录 + monkeypatch HOME/`BOBAN_LICENSE_DIR`）：

- 旧路径有证书、新路径无 → 读后搬到新路径，旧路径已删，记录内容不变。
- 新路径已有证书 → 直接用新的，**不动**旧路径。
- 两者都无 → 返回 `None`（未激活）。
- `BOBAN_LICENSE_DIR` 设置时 → 证书读写都落到该目录。
- 迁移后 `get_status()` 仍判定为已激活（端到端：搬迁不破坏验签链）。

## 6. Roadmap（本期不做，记录方向）

- **hanhai-cli 接入**：Node 用内置 `crypto`（原生支持 Ed25519）复刻契约校验，内嵌同一公钥，
  启动时读 `~/BobanStaff/activation/activation.json` 自验，过了才干活。纯只读。
- **模型 / llama.cpp**：原版二进制不改源码 → 方案 B（前置守卫进程，激活通过才拉起 llama-server）
  或编译期打补丁。择期评估。
- **飞书在线签发**：`apps/license-issuer-server`（已在 `activate-code` 分支，未合主干）对接，
  人填设备码 → 飞书调签发服务出码 → 填回。与本期解耦。

## 7. 风险

- **设备码跨语言不一致** → 本期只动 Python，风险被推迟到 hanhai-cli 接入期；契约文档须给对拍样例先行规避。
- **中立目录写权限** → `~/BobanStaff/` 在用户目录下，写权限无虞；若将来改 ProgramData 才需处理权限。
- **迁移竞态** → 数字员工是唯一写入方，单进程内迁移，无并发写冲突。
