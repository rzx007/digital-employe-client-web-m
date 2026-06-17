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

## 216 实测部署记录（2026-06-17，已跑通）

签发服务已实际部署在 **10.172.246.216**（AMD x86_64 / Ubuntu 24.04），端到端验证通过
（无 token→401、带 token→出码、容器内验签「授权码有效」）。落地中踩的坑与解法：

1. **216 原无 docker** → `apt-get install docker.io docker-compose-v2 docker-buildx`
   （Ubuntu 源自带 29.x），`usermod -aG docker boban` 免 sudo。
2. **拉基础镜像超时（Docker Hub 国内不可达）** → `/etc/docker/daemon.json` 配
   `registry-mirrors`（daocloud / 1panel / rat.dev）。**写 daemon.json 用 SFTP 上传纯文件，
   别用 shell heredoc/echo 嵌套引号**——后者极易写坏 JSON 导致 dockerd 起不来。
3. **build 时容器内 DNS 解析失败** → daemon.json 加 `"dns": ["223.5.5.5","114.114.114.114"]`
   （宿主用 systemd-resolved 的 127.0.0.53，容器继承不了）。
4. **uv 报 workspace 成员解析失败** → 本地包 pyproject 的 `[tool.uv.sources]` 用了
   `workspace=true`，镜像无 workspace 根。Dockerfile 已加 `sed` 剥离该段 + 按目录装本地包
   + 清华源装第三方依赖（见当前 Dockerfile）。

部署位形：
- 镜像 `de-issuer-server:latest`（335MB）
- 密钥目录 `~/issuer-keys/`（`de-license keys generate` 生成；私钥 600/boban，公钥 644）
- 容器 `de-issuer`：`-p 8900:8900 --restart always`，私钥只读挂载 `-v ~/issuer-keys:/keys:ro`，
  `DE_LICENSE_PRIVATE_KEY=/keys/private_key.pem`，token 存 `~/issuer-keys/.api_token`（不进 git）
- **公钥**（`~/issuer-keys/public_key.pem`）需拷进客户端
  `apps/server/src/core/activation/public_key.pem` 后重打客户端，二者方为同一对。

## 运维速查（216 现网，2026-06-17）

> ⚠️ `ISSUER_API_TOKEN` 是机密，**不写进本文件**。真实值见 216 上
> `~/issuer-keys/.api_token`（umask 077，仅 boban 可读），或本地机密速查（不进 git）。

| 项 | 值 |
|----|----|
| 主机 | `bobandata-server` / `10.172.246.216`（AMD x86_64 · Ubuntu 24.04） |
| 服务地址 | `http://10.172.246.216:8900`（接口 `POST /license/issue`） |
| 容器名 | `de-issuer`（镜像 `de-issuer-server:latest` · 335MB · `--restart always`） |
| 私钥（挂载） | 宿主 `~/issuer-keys/private_key.pem`（600）→ 容器 `/keys/private_key.pem`（只读） |
| 公钥 | 宿主 `~/issuer-keys/public_key.pem`（644） |
| 默认到期 | `+90d`（`ISSUER_DEFAULT_EXPIRES`） |
| 镜像源 | daemon.json 配国内 mirror + DNS（见上节坑 2/3） |
| **公钥指纹（须与客户端内嵌一致）** | `...O77cNd6JFvLHo2lxcIK5MTqJL1ZQZa1LsTrBWwQlwBw=` |

> **关键不变量**：216 用的是**现网客户端配对的原始私钥**（公钥指纹 `...O77c...` ==
> 客户端内嵌 `apps/server/src/core/activation/public_key.pem`）。故 **216 签出的码，
> 所有已部署客户端都能验签激活，客户端无需重打。**

### 常用运维命令（在 216 上）

```bash
# 看容器状态 / 日志
docker ps --filter name=de-issuer
docker logs --tail 50 de-issuer

# 重启 / 停止 / 启动
docker restart de-issuer

# 出码（token 从本机文件读，不要写进命令历史明文）
TOKEN=$(cat ~/issuer-keys/.api_token)
curl -s -X POST http://127.0.0.1:8900/license/issue \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"device_code":"<设备码>"}' | python3 -m json.tool

# 校验当前私钥与客户端公钥是否配对（应输出 ...O77c...）
docker run --rm -v ~/issuer-keys:/keys de-issuer-server \
  de-license keys export-public --private-key /keys/private_key.pem

# 重建镜像（代码更新后）：先把三个包传到 ~/issuer-build，再
cd ~/issuer-build && docker build -f apps/license-issuer-server/Dockerfile -t de-issuer-server . \
  && docker rm -f de-issuer && docker run -d --name de-issuer --restart always -p 8900:8900 \
     -e ISSUER_API_TOKEN="$(cat ~/issuer-keys/.api_token)" \
     -e DE_LICENSE_PRIVATE_KEY=/keys/private_key.pem -e ISSUER_DEFAULT_EXPIRES=+90d \
     -v ~/issuer-keys:/keys:ro de-issuer-server
```

### 轮换 token

```bash
NEW=deiss_$(openssl rand -base64 24 | tr -d '/+=' )
umask 077; echo "$NEW" > ~/issuer-keys/.api_token
docker rm -f de-issuer && docker run -d --name de-issuer --restart always -p 8900:8900 \
  -e ISSUER_API_TOKEN="$NEW" -e DE_LICENSE_PRIVATE_KEY=/keys/private_key.pem \
  -e ISSUER_DEFAULT_EXPIRES=+90d -v ~/issuer-keys:/keys:ro de-issuer-server
```

## 不在本服务范围

- 飞书自动化（审批/轮询/回调驱动出码）—— 评估后**暂不做**，现阶段人工调 `/license/issue`。
  历史设计存档：[飞书审批轮询 spec](./superpowers/specs/2026-06-17-feishu-approval-poller-design.md)（未实施）。
- hanhai-cli / 模型层激活校验 —— roadmap。
- 激活码自动回送目标机 —— 仍人工取码放码。
