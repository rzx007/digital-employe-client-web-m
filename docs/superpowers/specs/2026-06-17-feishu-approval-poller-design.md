# 飞书审批轮询出码设计（Feishu Approval Poller）

> 日期：2026-06-17
> 目标：在签发服务里加一个后台轮询器，把「飞书审批通过 → 签发授权码 → 回写审批单」自动化。
> 关联：[飞书签发运维流程](../../activation-issuance-feishu-flow.md) ·
> [deploy 激活阶段](./2026-06-16-deploy-activation-stage-design.md)

## 1. 背景

激活链路里「飞书 → 出授权码」此前是空的：签发服务 `license-issuer-server`
（`POST /license/issue`，已合入本分支）能凭设备码出码，但「谁来调它」没接。
本期补这一环——用**飞书审批 + 轮询**驱动自动出码。

**网络约束（决定方案）**：签发服务那台机器**能出站访问 `open.feishu.cn`**，但
**给不了公网入口**（飞书无法反向回调）。故排除「订阅审批回调（webhook）」，
采用**轮询**：签发服务主动出站拉审批实例，飞书不反连。

## 2. 架构与边界

新增一个**后台轮询器**，长在 `apps/license-issuer-server` 里（它既持私钥能出码、
又能出站够到飞书）。客户端 / deploy / actus 全不动。

**闭环分工：**

| 阶段 | 谁做 | 状态 |
|------|------|------|
| 跑 deploy 拿设备码 | 人 | ✅ 已上线（stage_activation 打印设备码） |
| 飞书发起审批（填设备码） | 人 | 飞书侧配置 |
| 审批人批准 | 人 | 人工把关 |
| **拉审批实例 → 出码 → 回写** | **轮询器** | 🟡 本期新建 |
| 从飞书取回授权码 → 放进目标机 | 人 | ✅ 已上线（deploy 双通道注入） |
| App 启动验签激活 | 数字员工 | ✅ 已有 |

**关键**：不需要公网入口，轮询器主动出站调飞书 OpenAPI。

## 3. 飞书审批 OpenAPI（已核实）

- token：tenant_access_token。复用仓库现有 `FeishuTokenService.get_tenant_access_token()`。
  - ⚠️ 该服务在 `apps/server`，签发服务**不应**反向依赖客户端后端。本期在签发服务内
    **自包含**一个极简 token 获取（`POST /open-apis/auth/v3/tenant_access_token/internal`
    用 app_id/app_secret 换 token，带缓存与过期刷新），不跨 app 复用代码。
- 拉实例列表：`GET /open-apis/approval/v4/instances`，参数 `approval_code` + 分页；
  按需用状态过滤，最终只处理 `APPROVED`（已通过）的实例。
- 取实例详情：`GET /open-apis/approval/v4/instances/{instance_id}`，返回 `status`、
  发起人、**表单控件值**（设备码在某个 form 控件里，按字段名/控件 id 取）。
- 回写授权码：给该审批实例**加评论**
  （`POST /open-apis/approval/v4/instances/{instance_id}/comments`，或等价评论接口），
  评论正文含授权码 + 到期。评论同时充当「已出码」标记（见防重）。
- 权限：应用需「查看原生审批实例」+「评论审批实例」权限。

> 接口以官方文档为准：
> https://open.feishu.cn/document/server-docs/approval-v4/instance/get
> https://open.feishu.cn/document/server-docs/approval-v4/instance/list

## 4. 组件（apps/license-issuer-server/src/license_issuer_server/）

各文件单一职责、可独立测试：

- `feishu_token.py`
  - `FeishuToken(app_id, app_secret)`：`get() -> str`，内部缓存 + 过期前刷新。
- `feishu_approval.py`（飞书审批客户端，依赖 `feishu_token`）
  - `list_approved_instances(approval_code) -> list[str]`：返回已通过实例的 instance_id。
  - `get_device_code(instance_id) -> str | None`：从表单控件取设备码（按配置的字段名）。
  - `has_license_comment(instance_id) -> bool`：该实例是否已有「授权码」评论（防重）。
  - `write_license_comment(instance_id, license_code, expires_at) -> None`：回写。
- `poller.py`（编排循环）
  - `poll_once() -> int`：拉已通过实例 → 跳过已出码的 → 取设备码 →
    `IssueService().issue(device_code, expires, private_key_path)` →
    `write_license_comment(...)`；返回本轮出码数。
  - `run_forever(interval)`：循环调 `poll_once`，异常捕获不崩、sleep 后续跑。
- `config.py`（扩展现有）
  - 新增 env：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_APPROVAL_CODE`、
    `FEISHU_DEVICE_CODE_FIELD`（表单里设备码控件的字段名/id）、
    `POLL_INTERVAL`（默认 60s）。沿用既有 `DE_LICENSE_PRIVATE_KEY` / `ISSUER_DEFAULT_EXPIRES`。
- `__main__.py`（扩展）
  - 现有：起 FastAPI（`/license/issue`）。新增可选启动轮询器：
    `python -m license_issuer_server poll` 跑 `run_forever`；不带参数仍只起 HTTP。
    （HTTP 与轮询解耦，可分进程/容器部署。）

### IssueService 接口（已合入，本期复用）
`IssueService().issue(device_code: str, expires: str, private_key_path: Path) -> IssueResult`
`IssueResult{device_code_display, expires_at: datetime, license_code: str}`。

## 5. 防重出码

轮询器只处理「已通过 **且** 未出码」的实例。判据 = 该审批实例**是否已有授权码评论**
（`has_license_comment`）。已有 → 跳过。这样：
- 无需本地状态文件（评论本身是幂等标记，落在飞书侧，重启/换机不丢）。
- 同一实例被轮询多轮也只出一次码。

> 评论正文用固定前缀（如 `「激活授权码」` 开头）便于 `has_license_comment` 识别。

## 6. 错误处理

- token 过期/飞书 5xx/网络抖动 → 捕获重试，不让轮询器崩溃。
- 单条实例处理失败（取不到设备码 / 出码异常 / 回写失败）→ 记日志、跳过该条，
  **不阻塞**本轮其它实例；下轮会再尝试（未回写=未出码，自然重试）。
- `poll_once` 整体异常 → `run_forever` 捕获、记日志、sleep 后继续。
- 进程级崩溃 → 靠 systemd / 容器 `restart: always` 拉起（部署职责，文档说明）。

## 7. 安全

- 私钥仍只在签发服务、运行时挂载，永不进客户端/镜像层（沿用现有铁律）。
- 飞书 app_secret 走 env，不入库、不进镜像层。
- 轮询器只读审批 + 写评论，不改审批结论；出码仅针对**已人工批准**的实例。
- 设备码绑定由签发 `sign_license` 写进授权码、最终由 App 验签兜底——
  即便轮询器误出码，错误设备的码在目标机仍会 `device_mismatch` 失效。

## 8. 测试

- `feishu_token`：mock HTTP，验证缓存命中 / 过期刷新。
- `feishu_approval`：mock 飞书响应，验证 list/get_device_code/has_license_comment/
  write_license_comment 的请求构造与解析（用官方返回样例 fixture）。
- `poller.poll_once`：mock approval 客户端 + 真实 `IssueService`（用测试密钥对），
  断言：① 已通过未出码 → 出码且回写一次；② 已出码 → 跳过（不重复）；
  ③ 取不到设备码 → 跳过不崩；④ 出码异常 → 跳过不阻塞其它。
- 端到端（可选，手动）：真审批定义 + 测试密钥，发起一单→批准→轮询→看回写评论，
  再用 deploy 注入验证 App 激活。

## 9. 部署

- 两种进程：HTTP 签发（`python -m license_issuer_server`）与轮询器
  （`python -m license_issuer_server poll`）。可同机分进程或分容器。
- 轮询器容器/服务设 `restart: always`。
- env 清单：`DE_LICENSE_PRIVATE_KEY`（挂载私钥）、`ISSUER_API_TOKEN`（HTTP 用）、
  `FEISHU_APP_ID/SECRET`、`FEISHU_APPROVAL_CODE`、`FEISHU_DEVICE_CODE_FIELD`、
  `POLL_INTERVAL`、`ISSUER_DEFAULT_EXPIRES`。
- 网络：出站可达 `open.feishu.cn`（已确认）；无需入站。

## 10. 范围外（roadmap）

- 飞书审批定义本身的搭建（字段：设备码、申请人、机器备注）——属飞书后台配置，文档给指引。
- hanhai-cli / 模型层激活校验（沿用既有 roadmap）。
- 授权码自动回送到目标机（仍人工取码放码；自动回送需目标机可被够到，超出网络约束）。

## 11. 待确认

- 回写用「评论」还是写回某个表单字段 / 审批单备注——本设计选评论（最通用、天然防重）。
- 设备码在审批表单里的承载控件类型与字段名（`FEISHU_DEVICE_CODE_FIELD` 配什么）。
