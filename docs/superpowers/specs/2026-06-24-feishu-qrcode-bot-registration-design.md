# 飞书扫码一键建机器人 设计

> 状态：设计评审中
> 日期：2026-06-24
> 分支：feat/orchestrator-centric
> 关联：[飞书 Channel 接入](2026-06-24-feishu-channel-integration-design.md)（本功能为其配置入口）

## 1. 目标

在"渠道设置"里加一个飞书区块，提供**扫码一键建机器人**：用户点"获取飞书二维码"→ 用飞书扫码授权 → 飞书自动创建 PersonalAgent 应用并回吐 `app_id`/`app_secret`/扫码人 `open_id` → 前端自动回填表单（app_id/secret + 把 open_id 追加进白名单）→ 用户点保存写入配置。免去进飞书开发者后台手动建应用、配权限、手查 open_id 填白名单。

**思路来源**：QwenPaw 的 `FeishuQRCodeAuthHandler`（飞书 OAuth 2.0 设备授权流 RFC 8628）。

## 2. 关键决策（已与用户敲定）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 范围 | 扫码流 + **最小**渠道设置面板（飞书区块）。不抄 QwenPaw 特有字段（Bot Prefix / 显示工具消息 / 思考过程 / 流式输出）。 |
| 2 | 后端结构 | 轻量通用 QR 抽象（`QRCodeAuthHandler` ABC + `FeishuQRCodeAuthHandler` + 注册表 + 两个通用端点），为后续接钉钉/企微扫码留口。 |
| 3 | 成功落库 | **回填表单、用户点保存**。扫码端点**无状态、无写副作用**，只返回凭证；落库走前端现有 `setConfigKv`。 |
| 4 | 地区 | **只做飞书国内**（`accounts.feishu.cn`）。不支持 Lark 国际、无地区选择器。 |
| 5 | 设置 tab | 叫"**渠道**"（非"飞书"），飞书是第一个区块，后续渠道同页加区块。 |
| 6 | 连线时机 | 本功能只交付"扫码拿凭证 + 存配置"；真正连上飞书收发消息，等[飞书 Channel](2026-06-24-feishu-channel-integration-design.md) 的 ws 长连接接线人工门完成后再做。 |

## 3. 架构与数据流

**飞书设备授权流（RFC 8628，无状态，三步全 POST form-urlencoded）**：
```
端点: https://accounts.feishu.cn/oauth/v1/app/registration
① action=init
   → 校验 supported_auth_methods 含 client_secret
② action=begin + archetype=PersonalAgent + auth_method=client_secret + request_user_info=open_id
   → device_code + verification_uri_complete（二维码编码此 URL，附 ?source=<PROJECT_NAME>）
③ action=poll + device_code（前端反复轮询）
   → 成功: client_id(=app_id) + client_secret(=app_secret) + user_info.open_id
```

> **关键假设（地基）**：三步设备流均为**匿名请求，不携带任何已有应用凭证**（不读、不需要 FEISHU_APP_ID/SECRET、不需要 tenant_access_token）——这正是它能"凭空建应用"的前提。此假设须在 §6 用真账号验证。

**数据流**：
```
前端点"获取飞书二维码"
  → GET /channels/feishu/qrcode
  → 后端 ①init ②begin → segno 生成 base64 PNG → 返回 {qrcode_img, poll_token=device_code}
  → 前端渲染二维码，每 ~2s 轮询 GET /channels/feishu/qrcode/status?token=device_code
       waiting → 继续；success → 拿到 {app_id, app_secret, open_id}；expired/fail → 停
用户飞书扫码 + 确认授权（飞书自动创建 PersonalAgent 应用）
  → 某次轮询 success
  → 前端自动回填 App ID / App Secret 输入框 + 把 open_id 追加进白名单输入框
  → 用户点"保存" → setConfigKv 写 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_WHITELIST_OPEN_IDS（+按需 FEISHU_CHANNEL_ENABLED）
  → config_kv 写入自动 clear_settings_cache()
```

后端扫码端点**只代理飞书设备流、返回凭证，不碰 config_kvs**。

## 4. 组件与文件

### 后端（2 新文件 + 1 依赖 + 接线）

**`apps/server/src/service/channel/qrcode_auth.py`（新）**
- `QRCodeAuthHandler`(ABC)：`async fetch_qrcode(request) -> QRCodeResult(scan_url, poll_token)`；`async poll_status(token, request) -> PollResult(status, credentials)`。
- `FeishuQRCodeAuthHandler`：三步设备流（httpx）。`poll_status` 归一化飞书返回为 `waiting/success/expired/fail`。
- `generate_qrcode_image(scan_url) -> str`：segno → base64 PNG。
- `QRCODE_AUTH_HANDLERS: dict[str, QRCodeAuthHandler] = {"feishu": FeishuQRCodeAuthHandler()}`。

**`apps/server/src/api/channel_qrcode_api.py`（新）**
- `GET /channels/{channel}/qrcode` → 查注册表，`handler.fetch_qrcode(request)` → `generate_qrcode_image` → `{qrcode_img, poll_token}`。未知 channel → 404。
- `GET /channels/{channel}/qrcode/status?token=...` → `handler.poll_status(token, request)` → `{status, credentials}`。
- 整 router `Depends(require_capability("feishu_platform"))`（能力门关 → 503，前端用 capability 预判隐藏入口，503 仅作兜底）。
- **router 注册点**：`apps/server/src/api/__init__.py` 的 `include_router` 集中处（**不是 server.py**）。
- `?source=<PROJECT_NAME>`：`PROJECT_NAME` 后端无现成常量，**直接写死一个产品标识字符串**（如 `"DigitalEmployee"`），定义在 `qrcode_auth.py` 顶部。
- `device_code` 短期凭证、低敏感，放 query 可接受；端点用 GET 便于轮询。

**依赖**：`segno`（纯 Python 二维码库，现无）→ `uv add segno`。

### 前端（1 API + 1 面板 + 渠道 tab 接线）

> ⚠️ 前端设置组件实际在 `apps/web/src/components/settings/`（`general-settings.tsx`/`settings-page.tsx`/`settings-sidebar.tsx`/`settings-types.ts`），`routes/settings.tsx` 只是路由壳。

**`apps/web/src/api/feishu-channel.ts`（新）**：`fetchQrcode("feishu")`、`pollQrcodeStatus("feishu", token)`，走现有 `request`，status 入参用 `request` 的 `params` 选项（`{ params: { token } }`，对齐现有 `conversation.ts` 约定），不手拼 URL。

**`apps/web/src/components/settings/channels-settings.tsx`（新，仿 `general-settings.tsx`）**：渠道 tab 容器，内含 `feishu-section.tsx`（飞书区块）。

**渠道 tab 接线（4 处改动，B1/M2/M5——别低估）**：
1. `settings-types.ts`：`SettingsTab` 联合类型加 `"channels"`；`SETTINGS_TABS` 数组加一项 `{ id: "channels", label: "渠道", capability: "feishu_platform" }`。
2. `settings-sidebar.tsx:14`：现有过滤写死 `!tab.capability || (tab.capability === "remote_login" && canAccount)`——必须**改成通用**：先把各 tab.capability 用 `useCapability` 解析成布尔（hook 不能在 filter 里调，先在组件体内解析好再过滤），`!tab.capability || capMap[tab.capability]`。确认前端 `Capabilities` 类型（`runtime-types.ts`）含 `feishu_platform`，没有则补。
3. `settings-page.tsx`：加 `activeTab === "channels"` 的渲染分支（注意现有 `canAccount` 硬编码分支同源，照其范式加）。
4. 验证："渠道" tab 在 `feishu_platform` 开时可见、关时隐藏。

### 最小面板字段（飞书区块）

| 字段 | config_kv | 控件 |
|---|---|---|
| 已启用 | `FEISHU_CHANNEL_ENABLED` | 开关 |
| App ID | `FEISHU_APP_ID` | 输入框（扫码自动回填） |
| App Secret | `FEISHU_APP_SECRET` | 密码框（扫码自动回填） |
| 白名单 open_ids | `FEISHU_WHITELIST_OPEN_IDS` | 多行/逗号输入；**前端统一存逗号分隔**（匹配后端 `_parse_feishu_whitelist` 首选路径）；追加扫码人 open_id 前 trim + 去重 |
| 获取飞书二维码 | — | 按钮 → 二维码区 + 状态文字 + 轮询 |
| 保存 | — | 逐项 `setConfigKv` |

读：进面板 `getConfigKv` 回显这 4 项。写：保存逐项 `setConfigKv`。

## 5. 错误 / 过期处理

**轮询状态机**（后端 `poll_status` 归一化 → 前端消费）：

| status | 后端判定来源 | 前端表现 |
|---|---|---|
| `waiting` | `authorization_pending` / `slow_down` / 无 error | 继续轮询（每 ~2s） |
| `success` | 返回 client_id + client_secret | 停轮询 → 回填 app_id/secret + 追加 open_id → 提示"已获取，请保存" |
| `expired` | `expired_token` / `invalid_grant` | 停轮询 → 二维码置灰 + "已过期，请重新获取" |
| `fail` | `access_denied` / 其他 error | 停轮询 → 提示失败原因 |

**前端轮询护栏**：
- 总超时（5 分钟）仍 waiting → 停轮询，按过期处理。
- 关弹窗 / 离开面板 → 清轮询定时器，防泄漏。
- 单次 status 请求失败不立即判死，连续数次失败再停。

**后端错误**：设备流任一步 httpx 失败 / 飞书返回非预期 → `HTTPException(502, detail)`，前端提示"获取二维码失败，请重试"。

**能力门两条防线**：前端用 `useCapability("feishu_platform")` **预判隐藏**渠道 tab/按钮（主路径，见 §4 接线）；端点 `require_capability` 返回 **503** 仅作后端兜底。两者实现位置不同，别混。

## 6. 已知限制 / 范围外

1. **保存后需重启生效**：channel 在 `server.py` lifespan 启动，改配置点保存**不热启动** channel，需重启应用才连上飞书。面板明确提示"保存后重启生效"。（热重载 channel 为后续。）
2. **依赖飞书 ws 接线**：`FeishuChannel.start()/stop()` 目前是骨架（待 spike 人工门填实）。扫码配好凭证后真正收发消息须等 ws 接线完成——**本功能只负责"扫码拿凭证 + 存配置"，端到端连线在 ws 接线完成后再做**。
3. **设备流端点半官方 + 凭证依赖待验**：`oauth/v1/app/registration` 是飞书半官方端点；生产前用真账号验证 ① §3 的"匿名无凭证依赖"假设是否成立（设备流不需已有 app_id/secret/tenant_token）；② 稳定性；③ PersonalAgent 应用权限范围（能否满足机器人收发消息 + 事件订阅所需 scope）。任一不成立则本功能地基受影响。

## 7. 测试

- 后端：`FeishuQRCodeAuthHandler.poll_status` 的状态归一化（mock httpx 返回各种 data → 断言 waiting/success/expired/fail）；`fetch_qrcode` 的三步编排（mock httpx）；`generate_qrcode_image` 产出 base64 PNG；端点对未知 channel 返回 404、能力门关返回 503。
- 前端：手测扫码弹窗 + 轮询 + 回填 + 保存（真账号冒烟）。

## 8. 后续（不在本设计）

- channel 热重载（保存即生效，免重启）。
- 钉钉/企微等其他渠道的扫码 handler（注册表加项）。
- 端到端真账号冒烟（待 ws 接线人工门完成后）。
