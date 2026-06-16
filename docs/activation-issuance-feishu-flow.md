# 激活运维流程：独立签发程序 + 飞书提交 + 放激活文件

> 日期：2026-06-16
> 范围：**梳理流程，不改代码。** 客户端验签逻辑一行不动。
> 关联：[激活流程现状](./activation-flow-current.md) ·
> 签发服务源码在 `activate-code` 分支 `apps/license-issuer-server/`（未合主干）。

## 1. 总览

激活独立成一条线，与在线业务后端（`actus-digital-employee`）**完全解耦**：

```
客户端（不动）                独立签发程序                         人工
─────────────               license-issuer-server               ────
① 显示设备码 ───设备码──►  ③ 飞书提交 → 调 POST /license/issue
                              （持私钥 sign_license 出授权码）
                                        │
                              ④ 得到激活码 ──────────────────►  ⑤ 落成激活文件
⑥ 客户端读本地证书自验签 ◄─────────────────────────────────────  放到约定位置
```

三个角色：

| 角色 | 职责 | 现状 |
|------|------|------|
| **客户端** `apps/server` | 显示设备码；读本地证书；**自验签** | ✅ 已有，不动 |
| **签发程序** `apps/license-issuer-server` | 凭设备码用**私钥**签出授权码 | ✅ 已做（在 activate-code 分支） |
| **飞书 + 人** | 收设备码、调签发、把激活文件放到客户端约定位置 | 🟡 运维流程（人工） |

`actus-digital-employee`（在线 PostgreSQL/RBAC 业务后端）**不参与**这条链路。

## 2. 签发程序接口契约（真实实现）

源码：`activate-code` 分支 `apps/license-issuer-server/`。

**接口**：`POST /license/issue`

**鉴权**：`Authorization: Bearer <ISSUER_API_TOKEN>`

**请求体**：
```json
{ "device_code": "3E56-77F8-E917-9E20-7A30", "expires": "+90d" }
```
- `device_code`：客户端未激活页显示的设备码（带不带分隔符均可）。
- `expires`：可选，缺省 `ISSUER_DEFAULT_EXPIRES`（默认 `+90d`）。支持 `+90d` / `YYYY-MM-DD` / ISO。

**响应**：
```json
{ "code": 200, "msg": "操作成功",
  "data": {
    "license_code": "<base64url(payload).base64url(signature)>",
    "device_code_display": "3E56-77F8-...",
    "expires_at": "2026-09-14T...Z"
  } }
```
错误码：401（token 缺失/无效/未配置）、400（参数非法）、500（私钥未配置）。

**部署关键环境变量**：
- `ISSUER_API_TOKEN`（必填）：调用方 Bearer token。
- `DE_LICENSE_PRIVATE_KEY`（必填）：私钥路径（指向挂载进来的私钥）。
- `ISSUER_DEFAULT_EXPIRES`（默认 `+90d`）、`ISSUER_PORT`（默认 `8900`）。

**Docker**：
```bash
docker build -f apps/license-issuer-server/Dockerfile -t de-issuer-server .
docker run -d -p 8900:8900 \
  -e ISSUER_API_TOKEN=your-strong-token \
  -e DE_LICENSE_PRIVATE_KEY=/keys/private_key.pem \
  -v /secure/host/keys:/keys:ro \
  de-issuer-server
```

## 3. 端到端步骤

1. **客户端显示设备码** — 未激活页展示，格式 `XXXX-XXXX-...`。
   设备码 = `SHA256(MAC | 机器GUID)[:20]` 大写。
2. **人提交设备码到飞书** — 飞书表单/审批，填入设备码（+ 申请人/机器备注）。
3. **飞书调签发程序** — 飞书机器人/webhook 调 `POST /license/issue`，带 Bearer token 与设备码。
4. **拿到授权码** — 响应里的 `license_code` 字符串（含到期 `expires_at`）。
5. **落成激活文件并放到约定位置**（见第 4 节衔接缺口）。
6. **客户端启动自验签** — 读本地证书 → 公钥验签 + 设备绑定 + 过期 → 通过即激活。

## 4. ⚠️ 衔接缺口：「激活文件」当前还接不上

这是本次梳理发现的**唯一硬缺口**，落地前必须解决其一。

**现状**：
- 签发程序返回的是**一个授权码字符串** `license_code`，不是文件。
- 客户端读的是 `activation.json`（结构化：`device_code` / `license_code` / `expires_at` /
  `activated_at` / `last_seen_at`），而且这个文件目前是**客户端在「填码激活」时自己写的**
  （`ActivationService.activate()` 验签通过后写盘）。
- 客户端**没有**「直接丢一个证书文件进目录就激活」的入口。

**也就是说**：你设想的「拿到激活文件 → 放到对应位置 → 客户端读到即激活」这一步，
客户端侧目前**只支持「人把授权码字符串粘进未激活页」**，不支持「放文件」。

**两条落地路径：**

- **路径甲（不改客户端，最省）**：飞书产出的就是「授权码字符串」，人**复制字符串粘进客户端未激活页**。
  本质 = 现有填码流程，飞书只是替代了「找管理员要码」。**零客户端改动**。
- **路径乙（放文件激活）**：约定目录存在授权码 → 自动读取 → 落 `activation.json` → App 启动验签。

> **进展（2026-06-16，已落地于一体机 deploy.sh）**：路径乙已在**一体机安装器**侧实现，
> 见 [deploy 激活阶段 spec](./superpowers/specs/2026-06-16-deploy-activation-stage-design.md)
> 与 [实现计划](./superpowers/plans/2026-06-16-deploy-activation-stage.md)。
> `deploy.sh` 新增 `stage_activation`：**双通道注入**——授权码文件优先
> （`packages/activation.md` 等候选）、终端粘贴回退——deploy 解析 payload 后直接写
> `~/.digital-employee/data/activation.json`，App 启动自行 `verify_license` 兜底。
> 已在 220 真机落位并通过幂等/对拍验证。
>
> **仍未做**：客户端 **GUI** 本身的「文件导入激活」入口（deploy 走的是命令行/文件，
> 不是 App GUI）；以及证书统一到中立目录 `~/BobanStaff/activation/`（见
> [中立化 spec](./superpowers/specs/2026-06-16-neutral-license-cert-multi-program-design.md)）。
> hanhai-cli / 模型层守卫仍为 roadmap。

## 5. 安全铁律

- **签发私钥严禁进客户端 / 安装包 / 镜像层**；只在签发程序运行时挂载注入。
- 签发私钥必须与客户端内嵌公钥
  （`apps/server/src/core/activation/public_key.pem`）**同一对**，否则验签必失败。
- 签发程序独立部署在你可控、飞书能访问的服务器；`ISSUER_API_TOKEN` 用强随机值。

## 6. 待你拍板的决策

1. **激活文件衔接走甲还是乙**（粘贴字符串 vs 客户端支持放文件导入）。
2. **签发程序是否合并进主干**（现仅在 `activate-code` 分支）。
3. **飞书那一步谁调签发**（飞书机器人直连 `/license/issue` / 中间加一层台账）。

确定后再分别开 spec → plan → 实施。
