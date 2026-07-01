---
name: lark-shared
version: 1.0.0
description: "飞书/Lark CLI 共享基础：全新环境需先安装 Node.js/npm 与全局 @larksuite/cli；应用配置初始化、认证登录（auth login）、身份切换（--as user/bot）、权限与 scope 管理、Permission denied 错误处理、安全规则。当用户需要第一次配置(`lark-cli config init`)、使用登录授权(`lark-cli auth login`)、遇到权限不足、切换 user/bot 身份、配置 scope、或首次使用 lark-cli 时触发。"
---

# lark-cli 共享规则

本技能指导你如何通过lark-cli操作飞书资源, 以及有哪些注意事项。

## 环境准备 / 首次安装

全新电脑上，`lark-cli` 来自 npm 全局包 `@larksuite/cli`，需先具备 **Node.js**（建议安装官方 **LTS**）与 **npm**（随 Node 安装）。

**安装 CLI（仅首次或换机时）：**

```bash
npm install -g @larksuite/cli
```

**国内镜像（访问 registry.npmjs.org 慢或超时时）**：单次安装可走 npmmirror，不改变全局 npm 配置：

```bash
npm install -g @larksuite/cli --registry=https://registry.npmmirror.com
```

若希望本机所有 `npm install` 默认走镜像，可执行（按需，会影响全局默认 registry）：

```bash
npm config set registry https://registry.npmmirror.com
```

恢复官方源：`npm config delete registry`。

**与「更新检查」的分工**：本命令用于**首次安装**；已安装后的版本升级见下文「更新检查」中的 `npm update -g @larksuite/cli`。

**安装后校验：**

```bash
lark-cli --version
```

若提示找不到命令，检查全局可执行目录是否在 `PATH` 中：

- **Windows**：常见原因是 npm 全局 bin 未加入 PATH。可用 `npm prefix -g` 查看前缀，确保其下的目录（如 `...\node_modules\.bin` 或 npm 文档所述的全局 bin 路径）已在系统环境变量中；安装 Node 时建议勾选将 Node 加入 PATH。
- **macOS / Linux**：若使用自定义 `prefix`，需把 `$(npm prefix -g)/bin` 加入 shell 的 `PATH`。

**关于 `npx skills add larksuite/cli`**：若使用飞书 CLI 自带的 Skills 安装流程，可在 CLI 可用后按需执行（与「更新检查」中的组合命令一致）。**不要**与本仓库内嵌的 Markdown 技能（如 `apps/server/build-in-skills/`）混为一谈：后者由本应用 Agent 加载，不等同于 `npx skills` 安装的包。

## 配置初始化

完成环境准备后，首次使用需运行 `lark-cli config init` 完成应用配置。

当你帮用户初始化配置时，使用background方式使用下面的命令发起配置应用流程，启动后读取输出，从中提取授权链接并发给用户：

```bash
# 发起配置（该命令会阻塞直到用户打开链接并完成操作或过期）
lark-cli config init --new
```

## 认证

### 身份类型

两种身份类型，通过 `--as` 切换：

| 身份 | 标识 | 获取方式 | 适用场景 |
|------|------|---------|---------|
| user 用户身份 | `--as user` | `lark-cli auth login` 等 | 访问用户自己的资源（日历、云空间等） |
| bot 应用身份 | `--as bot` | 自动，只需 appId + appSecret | 应用级操作,访问bot自己的资源 |

### 身份选择原则

输出的 `[identity: bot/user]` 代表当前身份。bot 与 user 表现差异很大，需确认身份符合目标需求：

- **Bot 看不到用户资源**：无法访问用户的日历、云空间文档、邮箱等个人资源。例如 `--as bot` 查日程返回 bot 自己的（空）日历
- **Bot 无法代表用户操作**：发消息以应用名义发送，创建文档归属 bot
- **Bot 权限**：只需在飞书开发者后台开通 scope，无需 `auth login`
- **User 权限**：后台开通 scope + 用户通过 `auth login` 授权，两层都要满足

### 权限不足处理

遇到权限相关错误时，**根据当前身份类型采取不同解决方案**。

错误响应中包含关键信息：

- `permission_violations`：列出缺失的 scope (N选1)
- `console_url`：飞书开发者后台的权限配置链接
- `hint`：建议的修复命令

#### Bot 身份（`--as bot`）

将错误中的 `console_url` 提供给用户，引导去后台开通 scope。**禁止**对 bot 执行 `auth login`。

#### User 身份（`--as user`）

```bash
lark-cli auth login --domain <domain>           # 按业务域授权
lark-cli auth login --scope "<missing_scope>"   # 按具体 scope 授权（推荐,符合最小权限原则）
```

**规则**：auth login 必须指定范围（`--domain` 或 `--scope`）。多次 login 的 scope 会累积（增量授权）。

#### Agent 代理发起认证（推荐）

当你作为 AI agent 需要帮用户完成认证时，优先使用 split-flow，避免在同一轮对话中阻塞等待用户授权：

```bash
# 发起授权（立即返回 device_code 和 verification_url）
lark-cli auth login --scope "calendar:calendar:readonly" --no-wait --json
```

拿到 `verification_url` 后，将它原样作为本轮最终消息发给用户，并结束本轮/交还控制权。不要在同一轮中展示 URL 后立刻执行 `--device-code` 阻塞轮询；在不透传中间输出的 agent harness 里，这会导致用户永远看不到 URL。

用户回复已完成授权后，再在后续步骤执行：

```bash
lark-cli auth login --device-code <device_code>
```

**Split-Flow 完整步骤**：

**第一步：发起授权（当前轮）**

1. 执行 `lark-cli auth login --scope "xxx" --no-wait --json`（必须加 `--no-wait --json`）
2. 从 JSON 输出中提取 `verification_url` 和 `device_code`
3. 生成二维码：`lark-cli auth qrcode <verification_url> --output "xxx"`
4. 将 URL 和二维码展示给用户（先 URL，后二维码）
5. **结束本轮对话前，必须明确告知用户**："请完成授权后，回来告诉我已授权完成，我会帮你完成后续步骤"

**第二步：完成授权（后续轮）**

1. 等待用户回复"已完成授权"
2. **由你（AI agent）亲自执行**：`lark-cli auth login --device-code <device_code>`
3. 此命令会轮询授权状态并完成登录
4. 如果返回授权成功，流程结束

**关键规则**：

- **你必须亲自执行 `--device-code` 命令**，不要指示用户自行执行
- **不要在同一轮中展示 URL 后立刻执行 `--device-code`**，这会导致用户看不到 URL
- **禁止缓存 `verification_url` 或 `device_code`**：每次需要授权时，必须重新执行 `lark-cli auth login --no-wait --json` 生成新的链接。不要将授权链接和 device code 存入上下文供后续复用

## 更新检查

lark-cli 命令执行后，如果检测到新版本，JSON 输出中会包含 `_notice.update` 字段（含 `message`、`command` 等）。

**当你在输出中看到 `_notice.update` 时，完成用户当前请求后，主动提议帮用户更新**：

1. 告知用户当前版本和最新版本号
2. 提议执行更新（CLI 和 Skills 需要同时更新）：

   ```bash
   npm update -g @larksuite/cli && npx skills add larksuite/cli -g -y
   ```

   国内网络：`npm update` 可追加 `--registry=https://registry.npmmirror.com`。`npx skills` 仍按当前 npm registry 拉取依赖；若未改全局 `registry`，可在**同一条命令前**为整段设置环境变量（Unix：`npm_config_registry=https://registry.npmmirror.com`；Windows PowerShell：`$env:npm_config_registry='https://registry.npmmirror.com'`）再执行，或先执行上文「国内镜像」中的 `npm config set registry`。

3. 更新完成后提醒用户：**退出并重新打开 AI Agent**以加载最新 Skills

**规则**：不要静默忽略更新提示。即使当前任务与更新无关，也应在完成用户请求后补充告知。

## 安全规则

- **禁止输出密钥**（appSecret、accessToken）到终端明文。
- **写入/删除操作前必须确认用户意图**。
- 用 `--dry-run` 预览危险请求。

## 高风险操作的审批协议（exit 10）

lark-cli 对高风险写操作（`risk: "high-risk-write"`）有强制确认门禁。当你不带 `--yes` 调用这类命令时，CLI 会退出码 `10`、并在 stderr 返回如下结构化 envelope：

```json
{
  "ok": false,
  "error": {
    "type": "confirmation_required",
    "message": "drive +delete requires confirmation",
    "hint": "add --yes to confirm",
    "risk": {
      "level": "high-risk-write",
      "action": "drive +delete"
    }
  }
}
```

**遇到这种情况，不要当普通错误放弃。** 按以下流程处理：

1. **识别**：看到子进程 exit code = `10` 且 stderr JSON 里 `error.type == "confirmation_required"`
2. **向用户确认**：把 `error.risk.action` 和关键参数展示给用户，明确告知"这是高风险操作"，等待用户显式同意
3. **用户同意** → 在你**原始 argv 的末尾追加 `--yes`** 后重试
4. **用户拒绝** → 终止流程，不要擅自改写参数或跳过门禁

**绝对不允许**：

- 看到 exit 10 就默认加 `--yes` 静默重试（这等于禁用门禁）
- 把 `confirmation_required` 当网络错误/权限错误处理
- 在用户没明确同意的前提下追加 `--yes` 重试
- 用 `sh -c` 等 shell 方式拼接命令重试——用 `exec.Command(argv...)` 参数数组形式，避免 shell 解析把用户参数当作语法

提前预判：想先让用户 review 危险操作的具体请求，调用时加 `--dry-run`——它不触发门禁，会打印完整请求详情（URL / body / params），你可以把这个预览给用户看过再去真正执行。

### 如何识别一条命令是高风险

- shortcut：`lark-cli <service> +<cmd> --help` 顶部会显示 `Risk: high-risk-write`
- service 命令：`lark-cli schema <service>.<resource>.<method> --format json` 的返回值里 `"risk": "high-risk-write"`
