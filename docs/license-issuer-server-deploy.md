# 签发服务镜像 · 部署与发码

> 凭设备码签发激活码的 HTTP 服务（`license-issuer-server`），打成镜像独立部署。
> 本文 = 怎么 build / run / 发码。代码已在本分支、端到端验证通过（401 鉴权 + 出码 + 验签自洽）。

## 是什么

- 接口：`POST /license/issue`，持私钥用 `sign_license` 凭设备码出授权码。
- 已就绪：`apps/license-issuer-server/`（app + Dockerfile + 启动入口 + 7 测试通过）。
- 角色：激活链路里「设备码 → 授权码」的发码节点。出码后人取码 → 放目标机 → deploy 注入 → App 验签激活。

## 安全铁律

- **私钥严禁打进镜像层 / 客户端 / 安装包**，只在运行时挂载注入。
- 签发私钥必须与客户端内嵌公钥
  （`apps/server/src/core/activation/public_key.pem`）**同一对**，否则客户端验签必失败。
- 部署在你可控的服务器；`ISSUER_API_TOKEN` 用强随机值。

## 接口

`POST /license/issue`

请求头：`Authorization: Bearer <ISSUER_API_TOKEN>`

请求体：
```json
{ "device_code": "3E56-77F8-E917-9E20-7A30", "expires": "+90d" }
```
- `device_code`：目标机未激活页/`deploy` 打印的设备码（带不带分隔符均可）。
- `expires`：可选，缺省用 `ISSUER_DEFAULT_EXPIRES`（默认 `+90d`）。支持 `+90d` / `YYYY-MM-DD` / ISO。

响应：
```json
{ "code": 200, "msg": "操作成功",
  "data": {
    "license_code": "<授权码>",
    "device_code_display": "3E56-77F8-E917-9E20-7A30",
    "expires_at": "2026-09-15T...Z" } }
```
错误：401（token 缺失/无效/未配置）、400（参数非法）、500（私钥未配置）。

## 运行时环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `ISSUER_API_TOKEN` | 是 | 调用方 Bearer token |
| `DE_LICENSE_PRIVATE_KEY` | 是 | 私钥路径（指向挂载进来的私钥） |
| `ISSUER_DEFAULT_EXPIRES` | 否 | 默认到期，默认 `+90d` |
| `ISSUER_PORT` | 否 | 监听端口，默认 `8900` |
| `ISSUER_HOST` | 否 | 监听地址，默认 `0.0.0.0` |

## Docker 部署

构建（build context = 仓库根，Dockerfile 要拷 activation-core / license-issuer 两个依赖包）：
```bash
docker build -f apps/license-issuer-server/Dockerfile -t de-issuer-server .
```

运行（私钥走只读挂载，不进镜像层）：
```bash
docker run -d --name de-issuer \
  -p 8900:8900 \
  -e ISSUER_API_TOKEN=<强随机 token> \
  -e DE_LICENSE_PRIVATE_KEY=/keys/private_key.pem \
  -e ISSUER_DEFAULT_EXPIRES=+90d \
  -v /secure/host/keys:/keys:ro \
  de-issuer-server
```

> `/secure/host/keys/private_key.pem` 必须与客户端内嵌公钥同一对。
> 用 `de-license keys generate` 生成密钥对，公钥拷进
> `apps/server/src/core/activation/public_key.pem` 后重打客户端。

## 发码（调用示例）

```bash
curl -s -X POST http://<服务器>:8900/license/issue \
  -H "Authorization: Bearer <ISSUER_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"device_code":"3E56-77F8-E917-9E20-7A30"}' | python3 -m json.tool
```
取响应里的 `license_code`，发给目标机：放进 deploy 的授权码文件或终端粘贴。

## 端到端链路

```
目标机 deploy 打印设备码
   │
   ▼  人调发码（curl /license/issue）
签发服务镜像 → sign_license 出授权码
   │
   ▼  人取 license_code
目标机：放进文件 / 终端粘贴
   │
   ▼  deploy 再跑 → 写 activation.json
数字员工 App 启动 verify_license → 激活生效
```

## 不在本服务范围

- 飞书自动化（审批/轮询/回调驱动出码）—— 评估后**暂不做**，现阶段人工调 `/license/issue`。
  历史设计存档：[飞书审批轮询 spec](./superpowers/specs/2026-06-17-feishu-approval-poller-design.md)（未实施）。
- hanhai-cli / 模型层激活校验 —— roadmap。
- 激活码自动回送目标机 —— 仍人工取码放码。
