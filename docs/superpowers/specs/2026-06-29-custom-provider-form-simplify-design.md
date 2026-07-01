# 自定义供应商表单精简 — 设计文档

日期：2026-06-29

## 背景与问题

`apps/web/src/components/settings/add-provider-dialog.tsx` 的「自定义供应商」步骤在用户添加一个模型前要求填写 6 项：供应商 ID、显示名称、API 地址、API Key、模型 ID、模型显示名称。用户反馈「冗余且别扭」。

根因：
- **供应商 ID 与显示名称重复**：用户既要手编机器用 slug（`my-provider`），又要起人看的名字。对自定义 OpenAI 兼容端点而言，slug 仅是内部唯一 key，不该让用户操心。
- **模型行两列**：每个模型都带「显示名称」列，90% 情况为噪音。
- **模型录入笨重**：带边框灰盒 + 「添加/移除」工具条，使填单/多模型都显得像在管理表格。

真正必填的仅 **API 地址 + 至少一个模型 ID**，其余可自动推导或降级为可选。

典型用法：**同一端点常配多个模型**（用户确认）。因此保留多模型能力，但把噪音砍掉。

## 目标

- 必填项从 6 降到 2：API 地址 + 至少一个模型 ID。
- 供应商 ID 不再向用户暴露，自动生成。
- 显示名称变为可选，不填则用域名兜底。
- 模型行单列（仅 model-id + 删除）。
- 支持批量粘贴：逗号/换行分隔的模型串自动拆成多行。

非目标（YAGNI）：
- 不做模型「显示名称」录入。后端字段保留兼容，前端不再采集，传 null。
- 预设（preset）步骤不动。
- 不改后端 `add_custom_provider` 的入参签名（仍接收 provider_id/display_name/base_url/models）。

## 方案概述

改动集中在前端单文件 `add-provider-dialog.tsx` 的 `custom` 分支与其提交逻辑。后端不改——前端在提交前自动算出 provider_id 与 display_name 即可满足现有 `/model/providers` 契约（`provider_id`、`display_name`、`base_url`、`models` 必填）。

### 1. 字段精简

custom 步骤的可见字段，按顺序：

| 字段 | 必填 | 说明 |
|------|------|------|
| API 地址 | 是 | `https://api.example.com/v1`，沿用现有校验 |
| API Key（可选） | 否 | 沿用现有 PasswordInput |
| 显示名称（可选） | 否 | 不填则自动用域名 |
| 模型 | 是（≥1） | 单列 model-id，可增删，支持批量粘贴 |

删除「供应商 ID」字段与「显示名称」原必填态，删除模型行的「显示名称」列。

### 2. 供应商 ID 自动生成（前端）

提交时由前端推导 `provider_id`，不再让用户输入：

1. 取「显示名称」（若空，取 API 地址的 host，如 `api.example.com`）作为来源串。
2. slugify：转小写，非 `[a-z0-9]` 折成 `-`，去首尾 `-`。
3. 满足后端 `CUSTOM_ID_PATTERN`（须小写字母开头）：若结果不以小写字母开头，前缀 `p-`；若 slug 为空，回退 `provider`。
4. 去重：若 slug 已存在于当前 registry（前端持有 `availableCatalogIds` 之外还需已接入列表——见下「依赖」），追加 `-2`、`-3` … 直到唯一。

> 唯一性最终由后端 `_ensure_unique_provider_id` 兜底（409）。前端去重是为体验，避免常见撞名直接报错。

### 3. 显示名称兜底

- 用户填了 → 用用户的。
- 没填 → 用 API 地址 host（`new URL(customUrl).host`）。host 解析失败（地址还没填全）则用 `自定义供应商`。
- 提交校验从「ID/名称/地址都必填」改为「仅 API 地址必填 + ≥1 模型」。

### 4. 模型列表精简为单列

- 每行一个 `model-id` 输入框 + 末尾删除按钮（仅 >1 行时可删）。
- 去掉外层带边框灰盒，改为轻量纵向列表。
- 底部「+ 添加模型」按钮。
- 提交时 `models` 映射为 `{ id }`（display_name 传 null）。

### 5. 批量粘贴拆分

- 在任一 model-id 输入框粘贴时（`onPaste`），若粘贴文本含逗号、换行或多个空白分隔的多个 token：
  - 阻止默认粘贴，按 `/[\n,]+/`（兼顾中英文逗号 `,，`）拆分、trim、去空、去重。
  - 第一个 token 填入当前行（替换当前值），其余追加为新行。
  - 与已存在的模型行整体去重。
- 单 token 粘贴走默认行为（正常填入）。

### 6. 状态清理

`custom` 分支不再使用 `customId`、不再要求 `customName`。`customId` 状态与其 reset 移除；`customName` 保留（现在是可选）。模型行不再写 `display_name`，新增行用 `{ id: "" }`。

## 数据流

1. 用户在 custom 步骤填 API 地址（必填）、可选 API Key/显示名称、≥1 模型 ID。
2. 点「添加并设为当前」→ `handleSubmitCustom`：
   - 校验：`customUrl` 非空 + 至少一个非空 model-id，否则 toast。
   - `display_name = customName.trim() || hostFromUrl(customUrl) || "自定义供应商"`。
   - `provider_id = uniqueSlug(display_name 或 host, 已用 id 集合)`。
   - `models = 去重后的 [{ id }]`。
   - 调 `addLlmProvider({ source: "custom", provider_id, display_name, base_url: customUrl, api_key, models, set_as_active: true })`。
3. 后端 `add_custom_provider` 照旧；成功则 `onAdded` + 关闭。

「测试连接」（`handleTestCustom`）逻辑不变，仍只需 base_url + 第一个 model。

## 依赖

- 前端去重需知道「已接入的 provider id」。当前组件只拿到 `availableCatalogIds`（未接入的预设）。已接入列表来自父组件的 registry（`onAdded` 回灌的 `LlmRegistry.providers`）。
  - **决定**：给 `AddProviderDialog` 新增可选 prop `existingProviderIds: string[]`，由父组件传入当前 registry 里所有 provider id。父组件已持有 registry，传入成本低。若父组件暂未传，前端去重退化为「不查重，直接交后端 409 兜底」——不破坏功能。

## 错误处理

- API 地址为空 / 无有效模型：前端 toast，不发请求（同现状风格）。
- slug 撞名：前端先尝试 `-N` 去重；万一仍撞（并发等），后端 409，错误经现有 catch toast 出来。
- URL host 解析失败：兜底 `自定义供应商`，不阻断提交（地址本身的合法性由后端 `_normalize_base_url` 校验并报错）。

## 测试

手动验证（Electron / 3399）：
1. 只填 API 地址 + 一个模型 → 能成功添加，列表显示名为域名。
2. 填了显示名称 → 用显示名称；provider 列表 id 为其 slug。
3. 在模型框粘贴 `gpt-4o, gpt-4o-mini\nqwen-max` → 拆成 3 行、去重。
4. 重复添加同名两次 → 第二个 id 自动 `-2`，不报 409。
5. 测试连接照常工作。

（本仓库该组件无既有单测；slug/拆分纯函数可抽出便于将来加测，但本期不强制。）

## 改动文件

- `apps/web/src/components/settings/add-provider-dialog.tsx`（主要）
- 调用 `AddProviderDialog` 的父组件：传入 `existingProviderIds`（次要、可选增强）。
