# Client Skill Import API

面向外部客户端：上传技能包创建技能，以及获取技能目录列表供上传前选择目录。鉴权与 [Client Skill Export API](./client-skill-export-api.md) 一致，仅使用请求头 `token` 解析用户，不依赖客户端 IP。

主数据写入由 **agent-interface** 完成；本服务将 multipart 请求转发至上游，详见下方「上游契约」。

---

## 1. 获取技能目录列表

### Endpoint

`GET /api/v1/client/skills/directories`

### Headers

| 名称 | 必填 | 说明 |
|------|------|------|
| token | 是 | 登录态 token，用于解析用户 |

### Query Parameters

| 名称 | 类型 | 默认 | 说明 |
|------|------|------|------|
| flat | boolean | true | `true`：扁平列表 `{ id, name, parentId }[]`，便于下拉；`false`：与内部 `/api/v1/skills/directory/tree` 相同的树形结构 |

### Success Example（flat=true）

```json
{
  "code": 1,
  "msg": "操作成功",
  "data": [
    { "id": 1, "name": "基础能力", "parentId": 0 },
    { "id": 2, "name": "业务技能", "parentId": 1 }
  ]
}
```

数据来源与内部目录树接口一致（调用 agent-interface `/aios/skill/directory/tree`）。

---

## 2. 上传技能包导入（创建技能）

### Endpoint

`POST /api/v1/client/skills/import`

### Headers

| 名称 | 必填 | 说明 |
|------|------|------|
| token | 是 | 登录态 token |

### Body

`multipart/form-data`

| 字段 | 必填 | 说明 |
|------|------|------|
| file | 是 | 技能包文件（通常为 zip） |
| directoryId | 是 | 目标目录 ID（来自 `/directories` 返回的 `id`） |
| displayNameZh | 否 | 技能中文展示名；对应 `data_service_ai.aios_skill.display_name_zh`，由客户端自选展示文案 |

### Success Example

上游返回结构以 agent-interface 为准；本服务在成功时将 `data` 置于统一信封内：

```json
{
  "code": 1,
  "msg": "操作成功",
  "data": {}
}
```

### Failure Examples

- 上传超过大小限制：`code` 为 `0`，`msg` 包含「大小」提示。
- 上游校验失败：`code` 为 `0`，`msg` 为上游错误或转发错误摘要。

---

## 3. 校验 skillName 是否重复

### Endpoint

`POST /api/v1/client/skills/name/exists`

### Headers

| 名称 | 必填 | 说明 |
|------|------|------|
| token | 是 | 登录态 token |

### Body（JSON）

```json
{
  "skillName": "order_query"
}
```

规则：全局范围、精确匹配。服务端对齐字段语义 `skill_name`（API 入参名保持 `skillName`），并兼容上游返回 `skillName` / `skill_name` 两种字段。

### Success Example

```json
{
  "code": 1,
  "msg": "操作成功",
  "data": {
    "exists": true
  }
}
```

---

## 配置说明

| 环境变量 | 说明 | 默认 |
|----------|------|------|
| AGENT_INTERFACE_BASE_URL | agent-interface 根地址 | `http://localhost:9100` |
| AGENT_INTERFACE_SKILL_IMPORT_PATH | 技能包导入接口 path（不含域名） | `/aios/skill/import/package` |
| CLIENT_SKILL_IMPORT_MAX_BYTES | 单文件最大字节数 | `52428800`（50MB） |

若上游实际路径不同，仅需修改 `AGENT_INTERFACE_SKILL_IMPORT_PATH`，无需改代码。

---

## 上游契约（BFF 转发约定）

本服务向以下地址发起 **POST**（`AGENT_INTERFACE_BASE_URL` + `AGENT_INTERFACE_SKILL_IMPORT_PATH`）：

- **Content-Type**: `multipart/form-data`
- **表单字段**
  - `file`：文件流，与客户端 `file` 对应
  - `directoryId`：字符串形式的目录 ID
  - `displayNameZh`：可选；中文展示名，写入上游后与库表 `aios_skill.display_name_zh` 一致
  - `uploadedByUserId`：当前 token 解析出的用户 ID（供审计）

上游响应若使用与本项目一致的信封（`code`、`msg`、`data`），则 `code != 1` 时本服务返回失败；HTTP 4xx/5xx 也会映射为失败。

---

## 相关代码

| 路径 | 说明 |
|------|------|
| `src/api/v1/skills/skills.py` | `client_router` 路由 `/directories`、`/import`、`/name/exists` |
| `src/services/agent_interface_service.py` | `flatten_skill_directory_tree`、`import_skill_package`、`skill_name_exists` |
| `src/utils/http_client.py` | `create_agent_interface_upload_http_client`（长超时上传） |
