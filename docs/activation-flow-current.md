# 激活流程现状（Activation Flow）

> 本文描述**当前代码实际实现**的激活流程，截至 2026-06-16 核对。
> 关注「为什么/怎么走」；模块依赖与逐文件清单见
> [`activation-code-reference-index.md`](./activation-code-reference-index.md)。

## 一句话

数字员工软件**自己一个组件**的鉴权：启动时填激活码。基于 **Ed25519 非对称签名**
——管理员侧私钥签发、客户端内嵌公钥验签，**离线可用**，并**绑定本机设备**。
模型服务等其他组件不参与激活。

## 核心模型

| 要素 | 说明 |
|------|------|
| 算法 | Ed25519 签名（`packages/activation-core`） |
| 授权码格式 | `base64url(payload).base64url(signature)`，payload 含 `d`(设备码) / `exp`(过期) / `iat`(签发) / `v`(版本) |
| 设备绑定 | 授权码里写死设备码，验签时与本机实算设备码比对，防拷贝 |
| 私钥 | **永不进客户端**，仅管理员/签发服务持有 |
| 公钥 | 随客户端打包：`apps/server/src/core/activation/public_key.pem` |
| 持久化 | `~/.digital-employee/data/activation.json` |
| 续期 | 无单独续期逻辑，过期＝重走同一条路重新申请并填码 |

## 是否需要激活（门控判定）

单一真相在 [`policy.py:28`](../apps/server/src/core/activation/policy.py) `is_activation_enforced()`：

- `ACTIVATION_BYPASS=1`（仅开发，禁止进生产包）→ 不强制
- 否则 `is_offline_mode()` 决定 → **当前策略：仅离线包强制激活**，在线版不激活

在线版若也要激活，只改这一处。

## 端到端流程

```
管理员/签发侧                          客户端侧
────────────                          ────────

                                      启动 → resolveActivationGate()
                                        │  GET /activation/status
                                        │  强制激活 且 未激活？
                                        ▼  是 → 打开激活窗
                                      展示设备码（GET /activation/device）
                                        │  = SHA256(MAC | 机器GUID)[:20]
   ┌──────── 人工/飞书传递设备码 ◄───────┘
   ▼
sign_license(私钥, 设备码, +90d)
   │  产出授权码
   └──────── 人工/飞书回传授权码 ────────┐
                                        ▼
                                      填码激活（POST /activation/activate）
                                        │  verify_license(授权码, 公钥, 本机设备码)
                                        │   ├─ 验签
                                        │   ├─ 设备匹配
                                        │   └─ 未过期
                                        ▼  通过
                                      写 activation.json → 切到主窗
```

### 1. 启动决策

Electron 启动调 [`gate.ts:41`](../apps/web/electron/features/activation/gate.ts)
`resolveActivationGate()` → 后端 `/activation/status`：

- **强制激活 且 未激活** → 打开**激活窗**
- 否则 → 交给登录态决定 login / main
- 后端不可达 → 按「未强制」放行（不误锁），API 层有中间件兜底

### 2. 设备码

[`device.py:59`](../apps/server/src/core/activation/device.py)
`compute_local_device_code()`：

```
SHA256( MAC地址(uuid.getnode) | 机器ID )  取前 20 位 hex，大写
```

机器 ID：Windows 读注册表 `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`；
macOS 读 `IOPlatformUUID`；Linux 读 `/etc/machine-id`。
展示时格式化为 `XXXX-XXXX-…`。

### 3. 拿授权码

UI 文案（[`activation-form.tsx`](../apps/web/src/components/activation/activation-form.tsx)）：
**「请将设备码发送给管理员，获取授权码后填入下方激活」**。

管理员侧两种签发途径，私钥相同、产物一致：

- `de-license` CLI / exe（`apps/license-issuer`，管理员本机跑）
- 飞书对接的独立签发 HTTP 服务（`apps/license-issuer-server`，私钥走挂载，**严禁与客户端同包/同镜像**）

签发核心：[`license.py:95`](../packages/activation-core/src/activation_core/license.py)
`sign_license()`，默认到期 `+90d`。

### 4. 填码激活（验签 + 持久化）

`POST /activation/activate { license_code }` →
[`activation_service.py:133`](../apps/server/src/service/activation_service.py) `activate()`：

1. 加载内嵌公钥（[`keys.py`](../apps/server/src/core/activation/keys.py)：
   env `ACTIVATION_PUBLIC_KEY_PEM` > 同目录 `public_key.pem`）
2. `verify_license(授权码, 公钥, device_code=本机实算)`：验签 → 设备匹配 → 未过期
3. 通过 → 写
   [`activation.json`](../apps/server/src/core/activation/storage.py)
   （设备码 / 授权码 / 过期 / 激活时间 / last_seen）→ 返回剩余天数

## 每次启动/请求的复核

[`activation_service.py:58`](../apps/server/src/service/activation_service.py) `get_status()`：

| 情况 | reason | 结果 |
|------|--------|------|
| 没公钥 | `missing_public_key` | 未激活 |
| 没 activation.json | `not_activated` | 未激活 |
| 本机设备码 ≠ 记录 | `device_mismatch` | 未激活（拷贝到别机失效） |
| 验签失败 | `invalid` | 未激活 |
| 已过期 | `expired` | 未激活 |
| 全通过 | — | 已激活，返回剩余天数 |

附带更新 `last_seen` 检测**时钟回拨**（容忍 24h，仅告警不拦截）。

### API 兜底

中间件 [`activation_middleware.py`](../apps/server/src/middleware/activation_middleware.py)
仅在强制激活时挂载。未激活的请求除白名单外一律 **403**。白名单：
`/system/runtime`、`/activation/`、`/docs`、`/redoc`、`/openapi.json`、`/favicon.ico`。

## 过期 / 重激活

无续期逻辑。过期就重走全流程：重新拿设备码 → 申请新授权码 → 填回。
About 页（[`activation-about-section.tsx`](../apps/web/src/components/activation/activation-about-section.tsx)）
内嵌同一个 `ActivationForm` 供重激活。

## 一体机 deploy 激活（命令行通道，2026-06-16 落地）

桌面 GUI 之外，**一体机安装器** `deploy.sh` 也能完成数字员工激活，与 GUI 填码**并存**：

- `deploy.sh` 新增 `stage_activation` 阶段：用 `python3` 内联脚本**字节级复刻设备码算法**
  （`SHA256(MAC | /etc/machine-id)[:20]`，与 App 一致），算出并打印设备码。
- **双通道注入授权码**：授权码文件优先（`packages/activation.md` 等候选）→ 终端粘贴回退。
- deploy 解析授权码 payload（不验签）后直接写 `~/.digital-employee/data/activation.json`，
  App 启动时自行 `verify_license`（设备绑定 + 过期）兜底。
- **幂等**：已激活且设备匹配且未过期则跳过。
- 设计 / 计划：[deploy 激活阶段 spec](./superpowers/specs/2026-06-16-deploy-activation-stage-design.md) ·
  [实现计划](./superpowers/plans/2026-06-16-deploy-activation-stage.md)；
  激活函数库源码 [`scripts/activation/deploy-activation.sh`](../scripts/activation/deploy-activation.sh)。
- **范围**：仅激活数字员工。hanhai-cli（Node 验签）/ 模型层（守卫）仍为 roadmap。

## 铁律

- **私钥永不进客户端**；签发私钥必须与客户端内嵌 `public_key.pem` **同一对**，否则验签必失败。
- 飞书签发服务（`license-issuer-server`）**必须独立部署**，私钥走挂载、不进镜像层。
- `ACTIVATION_BYPASS` 仅供开发，禁止进生产打包。

## 相关文档

- 模块依赖 / 逐文件清单：[`activation-code-reference-index.md`](./activation-code-reference-index.md)
- 离线激活说明：[`offline-activation.md`](./offline-activation.md)
- 设计 spec：`docs/superpowers/specs/2026-06-11-feishu-license-issue-and-client-activation-design.md`
- 落地 plan：`docs/superpowers/plans/2026-06-11-feishu-license-issue-and-client-activation.md`
