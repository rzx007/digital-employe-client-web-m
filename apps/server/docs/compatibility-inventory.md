# 迁移与兼容逻辑清单

本文档汇总当前代码库中的**迁移 / 兼容 / 遗留路径**，便于在合适时机统一移除。  
维护约定：新增临时兼容逻辑时，请在本文件登记；移除时在对应条目打 `[x]` 并注明版本。

**最后更新**：2026-05-26（LLM 多供应商注册表 + 四键退役）

---

## 移除策略（建议顺序）

1. **确认无老数据**：抽样用户 `config_kvs`、SQLite 表结构、localStorage
2. **先 LLM 四键迁移链**（本节 §1）— 影响面最清晰
3. **再 Settings 命名 / factory 硬编码默认**（§2）
4. **DB `init_db` ensure_column** 仅在新装环境验证后可删对应段（§4）
5. **前端 localStorage / 消息格式**（§5–§6）需配合版本说明
6. **远程 API 字段双读**（§7）需确认上游已统一

---

## §1 LLM 配置（`LLM_REGISTRY` ← 四键）

### 1.1 真相源 vs 遗留

| 状态 | 说明 |
|------|------|
| **真相源** | `config_kvs.LLM_REGISTRY`（JSON） |
| **遗留 KV（只读迁移，运行时不再使用）** | `LLM_PROVIDER`、`BASE_URL`、`OPENAI_API_KEY`、`DEEPAGENT_MODEL` |
| **DB 四键** | 迁移后**不删除**行，仅不再读写 |

### 1.2 代码位置

| 文件 | 符号 / 逻辑 | 作用 | 移除条件 |
|------|-------------|------|----------|
| [`src/llm/registry.py`](../src/llm/registry.py) | `LEGACY_KEYS` | 四键名常量 | 无库内四键、无迁移需求 |
| 同上 | `_read_legacy_kv()` | 从 DB 读四键 | 同上 |
| 同上 | `_migrate_from_legacy()` | 四键 → 单条 `LlmRegistry` | 同上 |
| 同上 | `load_registry()` 分支 2 | 无合法 registry 时触发迁移并 `save_registry` | 同上；或改为启动失败提示 |
| 同上 | `default_registry_seed()` | 新装 dashscope 默认 registry 结构 | 可保留为 seed 唯一来源 |
| [`src/core/config.py`](../src/core/config.py) | `resolve_active_from_kv()` | 从 `LLM_REGISTRY` 解析 active → Settings | registry 必填后可内联 |
| 同上 | `llm_provider` 空时 `resolve_provider_id(base_url)` | 从 URL 推断供应商 | active 必含 provider 后可删 |
| [`src/server.py`](../src/server.py) | 启动顺序 | `bootstrap_from_json` → **`load_registry`** → `cache_clear` → `model_patch` | 调整 bootstrap 后可简化 |
| [`src/service/config_kv_service.py`](../src/service/config_kv_service.py) | `bootstrap_from_json()` | insert-only 种子；含 `LLM_REGISTRY` | 新装流程稳定后可改 |
| [`config-kv.init.json`](../config-kv.init.json) | `LLM_REGISTRY` 字符串 | 新库默认 registry | 保留或改为代码生成 |
| [`apps/web/py-server/config-kv.init.json`](../../web/py-server/config-kv.init.json) | 同上（Electron 打包副本） | 与 server 种子同步 | 同上 |

### 1.3 已知启动顺序问题（未修，记录在案）

```
bootstrap_from_json   ← 若 LLM_REGISTRY 缺失，先插入 init 种子
load_registry         ← 已有 registry 则跳过 _migrate_from_legacy
```

**影响**：老库「仅有四键、无 LLM_REGISTRY」时，可能先被 seed 写入默认 registry，**不会**从四键迁移用户真实配置。

**彻底移除四键迁移前建议**：`load_registry` 先于 `bootstrap`，或 bootstrap 跳过 `LLM_REGISTRY` 当四键存在时。

### 1.4 运行时默认（无 active 时）

| 文件 | 逻辑 | 说明 |
|------|------|------|
| [`src/llm/factory.py`](../src/llm/factory.py) | `DEFAULT_MODEL` / `DEFAULT_BASE_URL` | 无 registry active 时代码兜底 |
| 同上 | `_resolve_base_url()` 多级 fallback | settings → catalog profile → DEFAULT |
| [`src/api/model_api.py`](../src/api/model_api.py) | `GET /model/runtime-config` | `deepagent_model or "qwen2.5-72b-instruct"` 等硬编码 |
| [`src/service/modal_service.py`](../src/service/modal_service.py) | `settings.deepagent_model or "qwen2.5-72b-instruct"` | 同上 |

**移除条件**：强制要求 active registry，无 active 则明确报错（设置页引导配置）。

### 1.5 Settings 字段命名（非 KV 键，但源自四键时代）

`Settings` 仍使用 `deepagent_model`、`api_key`、`base_url`、`llm_provider` 字段名（[`config.py`](../src/core/config.py)），由 registry active 填充。  
可选重构：重命名为 `llm_model` 等（全库替换，非必须）。

### 1.6 远程 sync

| 文件 | 逻辑 |
|------|------|
| [`src/service/config_kv_service.py`](../src/service/config_kv_service.py) | `sync_model_provider_from_remote()` → `upsert_from_remote_sync()` 写 registry |
| [`src/llm/registry_service.py`](../src/llm/registry_service.py) | `upsert_from_remote_sync()`：远程三字段 → registry upsert + active |

不再写四键；无额外兼容层。

### 1.7 LLM 相关移除 Checklist

- [ ] `LEGACY_KEYS`、`_read_legacy_kv`、`_migrate_from_legacy`
- [ ] `load_registry` 内迁移分支
- [ ] 启动顺序：迁移优先于 bootstrap seed
- [ ] `factory.py` / `model_api` 硬编码默认模型与 URL
- [ ] （可选）清理 DB 中残留四键行：`DELETE FROM config_kvs WHERE config_key IN (...)`
- [ ] （可选）`Settings` 字段重命名

---

## §2 Config KV 双键名 / 旧路径

| 文件 | 逻辑 | 说明 |
|------|------|------|
| [`src/core/config.py`](../src/core/config.py) | `SKILL_REMOTE_LIST_PATH` **或** `SKILL_REMOTE_LIST_URL` | 技能列表路径二选一 |
| 同上 | `join_base_and_path` 用于拼远程 URL | 多处 KV 存 path、base 存 `REMOTE_API_BASE_URL` |

移除条件：统一 KV 命名并迁移数据库。

---

## §3 SQLite 表结构：`init_db()` 增量迁移

文件：[`src/db/init_db.py`](../src/db/init_db.py)

| 类型 | 说明 |
|------|------|
| `ensure_column(...)` | 大量 `ALTER TABLE ADD COLUMN`，无 Alembic |
| `_migrate_conversation_title_to_text()` | 会话标题列类型迁移 |
| `_migrate_task_id_nullable()` | task_id 可空重建表 |

**移除条件**：新装仅用最新 schema；或引入正式 migration 工具后删除 ensure 块。  
**风险**：删错会导致旧库升级失败。

---

## §4 员工目录迁移

| 文件 | 逻辑 |
|------|------|
| [`src/service/employee_service.py`](../src/service/employee_service.py) | `migrate_local_employees_to_skill_path()` |
| [`src/server.py`](../src/server.py) | 启动时 `EmployeeService.migrate_local_employees_to_skill_path` |

旧路径 `local-employees` → 技能目录布局。移除前确认无用户仍用旧目录。

---

## §5 前端 localStorage 迁移

| 文件 | 逻辑 |
|------|------|
| [`apps/web/src/components/chat/conversations/recent-conversations/persistence.ts`](../../web/src/components/chat/conversations/recent-conversations/persistence.ts) | `OLD_KEY` → workspace 分键迁移；过滤 `LEGACY_CURATOR_PRIMARY_ID` |

---

## §6 聊天 / HITL / 流式消息兼容

| 区域 | 文件 | 说明 |
|------|------|------|
| HITL | [`docs/hitl-architecture.md`](hitl-architecture.md) | 不再使用 `extra_meta.interrupt_payload` |
| 消息模型 | [`src/models/conversation.py`](../src/models/conversation.py) | `chunk_json` 标记 Deprecated |
| 解析 | [`src/service/message_parts_extractor.py`](../src/service/message_parts_extractor.py) | 兼容 `__type__` 工具格式 |
| 解析 | [`src/service/chat_service.py`](../src/service/chat_service.py) | skills 路径多候选 fallback |
| 员工生成 | [`src/service/employee_generation_service.py`](../src/service/employee_generation_service.py) | `skills/skill_ids/capabilities` 历史字段 |
| 技能 API | [`src/api/skill_api.py`](../src/api/skill_api.py) | `skill_content` 双字段名 |
| 前端 SSE | [`apps/web/src/lib/chat/langchain-stream-parser.ts`](../../web/src/lib/chat/langchain-stream-parser.ts) 等 | tool_call index fallback |
| 可视化 | [`apps/web/src/components/workbench/data-visualizer.tsx`](../../web/src/components/workbench/data-visualizer.tsx) | 旧 chart 类型 `custom` |

详见：[`hitl-test-scenarios.md`](hitl-test-scenarios.md) P2「旧数据硬切」、[`conversation-message-flow.md`](../../web/src/lib/chat/conversation-message-flow.md)。

---

## §7 远程 API / 登录兼容

| 文件 | 逻辑 |
|------|------|
| [`src/api/login_api.py`](../src/api/login_api.py) | `_extract_token()` 多种登录响应结构；`POST /yc/login` 别名 |
| [`src/service/skill_service.py`](../src/service/skill_service.py) | 远程技能 camelCase / snake_case |
| [`src/service/modal_service.py`](../src/service/modal_service.py) | 返回「兼容历史结构」的 model 响应 |

---

## §8 供应商 / 探活兼容（长期可能保留）

| 文件 | 逻辑 | 是否临时 |
|------|------|----------|
| [`src/llm/connection.py`](../src/llm/connection.py) | 探活：`GET /models` → fallback `POST /chat/completions` | 供应商差异，可能长期需要 |
| [`src/llm/providers/catalog.py`](../src/llm/providers/catalog.py) | `resolve_provider_id(base_url)` URL 推断 | 与 registry 并存 |
| [`src/service/model_patch.py`](../src/service/model_patch.py) | DashScope 上下文超长错误 monkey-patch | DashScope 专用，非迁移 |
| [`src/llm/factory.py`](../src/llm/factory.py) | DeepSeek V4 `thinking: disabled` extra_body | LangChain 限制，非迁移 |

---

## §9 Electron / 生态兼容（产品级，非版本迁移）

| 项 | 位置 |
|----|------|
| Codex 宠物只读扫描 | `~/.codex/pets/`、[`pet-paths.ts`](../../web/electron/features/pet/pet-paths.ts) |
| Windows 路径 / 编码 | [`skill_shell_backend.py`](../src/service/skill_shell_backend.py) 等 |
| Orchestrator import 别名 | [`runtime.py`](../src/service/agent/orchestrator/runtime.py)、[`execution.py`](../src/service/agent/orchestrator/execution.py) |

---

## §10 死代码 / 待清理

| 文件 | 说明 |
|------|------|
| [`src/service/agent copy.py`](../src/service/agent%20copy.py) | 占位/旧 agent，AGENTS.md 标注不在维护范围 |
| [`src/models/orchestration_plan.py`](../src/models/orchestration_plan.py) | SQLite 无法 DROP COLUMN 的废弃列 |

---

## 附录 A：LLM 四键 → Registry 数据流（当前）

```
启动
  bootstrap_from_json (可能插入 LLM_REGISTRY 种子)
       ↓
  load_registry
       ├─ 有 LLM_REGISTRY → 直接用
       └─ 无 → _migrate_from_legacy(四键) → save_registry（四键行保留）
       ↓
  get_settings ← resolve_active_from_kv(LLM_REGISTRY only)
       ↓
  build_chat_model
```

## 附录 B：相关文档

- [多供应商注册表计划](../../.cursor/plans/多供应商注册表_805cf5e3.plan.md)（历史）
- [AGENTS.md](../../AGENTS.md) § 多供应商 LLM
- [resumable-stream-architecture.md](resumable-stream-architecture.md)
- [hitl-architecture.md](hitl-architecture.md)
