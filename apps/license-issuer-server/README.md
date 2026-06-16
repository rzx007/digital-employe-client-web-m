# Digital Employee 飞书签发服务

凭设备码签发激活码的 HTTP 服务，供飞书流程调用。

## ⚠️ 安全铁律

- **本服务内置签发私钥，严禁与客户端 / 安装包 / 镜像同包分发。**
- 必须独立部署在你可控、飞书能访问的服务器上。
- 私钥通过挂载卷 / 环境变量注入，**不得**打进镜像层或提交仓库。

## 接口

`POST /license/issue`

请求头：`Authorization: Bearer <ISSUER_API_TOKEN>`

请求体：
```json
{ "device_code": "3E56-77F8-E917-9E20-7A30", "expires": "+90d" }
```
- `device_code`：数字员工未激活页显示的设备码（带不带分隔符均可）。
- `expires`：可选，缺省用 `ISSUER_DEFAULT_EXPIRES`（默认 `+90d`）。支持 `+90d` / `YYYY-MM-DD` / ISO。

响应：
```json
{ "code": 200, "data": { "license_code": "<授权码>",
                         "device_code_display": "3E56-...", "expires_at": "2027-...Z" } }
```
错误：401（token 缺失/无效/未配置）、400（参数非法）、500（私钥未配置）。

## 本地运行

```bash
export DE_LICENSE_PRIVATE_KEY=/path/to/private_key.pem
export ISSUER_API_TOKEN=your-strong-token
cd apps/license-issuer-server
uv run python -m license_issuer_server   # 默认 0.0.0.0:8900
```

## Docker

```bash
# build context = 仓库根
docker build -f apps/license-issuer-server/Dockerfile -t de-issuer-server .
docker run -d -p 8900:8900 \
  -e ISSUER_API_TOKEN=your-strong-token \
  -e DE_LICENSE_PRIVATE_KEY=/keys/private_key.pem \
  -v /secure/host/keys:/keys:ro \
  de-issuer-server
```

## 与客户端的密钥对齐

签发用的私钥，必须与数字员工客户端内嵌的公钥
（`apps/server/src/core/activation/public_key.pem`）是同一对，否则客户端验签失败。
