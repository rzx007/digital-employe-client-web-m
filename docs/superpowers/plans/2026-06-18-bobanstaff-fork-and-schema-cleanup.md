# Fork 成独立 BobanStaff 应用 + schema 清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前分支 fork 成独立 BobanStaff 应用（身份+数据目录隔离），并借全新空库删死 DB 列 + 删 init_db 兼容/迁移垫片。

**Architecture:** 见 [设计 spec](../specs/2026-06-18-bobanstaff-fork-and-schema-cleanup-design.md)。Part A=身份/数据隔离（纯改名/路径收敛）；Part B=schema 清理（删死列 + 精简 init_db，保留 create_all/_init_fts5/_reset_orphaned_streams）。

**Tech Stack:** FastAPI+SQLAlchemy（apps/server）、Electron+electron-builder+React（apps/web）。

**验证基线（动手前确认，改后不得变差）：**
- 后端：`cd apps/server && uv run pytest -q` → **716 passed / 0 failed**。
- 前端类型：`cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | rg -c 'error'` → **79**。
- 前端单测：`cd apps/web && npx vitest run` → **1 failed / 257 passed**（既有 resolve-workbench-curator-panel）。

**全局约束：**
- **取证用 Grep 工具或 Read,不靠 Bash `rg` 的字符串输出**核对字面量 `.digital-employee`——Bash rg 会把它显示成 `.n`（渲染层假象）。命令里可用 `rg -c`（只数数）但**不要据 rg 的字符串内容判定**。
- **绝不触碰**用户并行 WIP：`apps/server/src/service/reflection_engine.py`、任何 `test_signal_critic.py`、`AGENTS.md`、`apps/server/src/service/agent/orchestrator/prompts.py`。
- 这是改名/删除/重构，非新功能；除 Task 4 的 create_all 回归外不新增测试。

---

### Task 1: 后端数据目录收敛单一常量

**Files:**
- Modify: `apps/server/src/core/config.py`（新增常量 + 6 处改引用）
- Modify: `apps/server/src/api/avatar_api.py`（`AVATAR_DIR`）
- Modify: `apps/server/src/api/employee_api.py`（`_AVATAR_DIR`）
- Modify: `apps/server/src/service/agent/workspace_paths.py`（`APP_PROJECTS_BASE` 第 33 行 + 外部隔离子目录第 44 行）

- [ ] **Step 1: 用 Grep 工具枚举全部后端站点**

用 **Grep 工具**（pattern `\.digital-employee`, path `apps/server/src`, output_mode content）列出所有命中。区分：直接 `Path.home() / ".digital-employee"` 硬编码 vs 间接经 `get_default_*` 派生。预期直接站点：config.py(6)、avatar_api、employee_api、workspace_paths(2)。`activation/storage.py`、`logging_setup.py` 应为间接（仅核对，不改）。

- [ ] **Step 2: config.py 加单一来源 + 6 处改引用**

`config.py` 顶部加：
```python
APP_DIR_NAME = "boban-staff"

def app_data_dir() -> Path:
    return Path.home() / f".{APP_DIR_NAME}"
```
把 `get_default_artifacts_path`/`get_default_sqlite_path`/`get_default_skill_path`/`get_default_builtin_skills_path`/`get_default_local_skills_path`/`get_default_logs_dir` 内的 `Path.home() / ".digital-employee"` 改为 `app_data_dir()`。注释里的 `~/.digital-employee` 同步改 `~/.boban-staff`。

- [ ] **Step 3: 直接硬编码站点改引用**

`avatar_api.py` `AVATAR_DIR`、`employee_api.py` `_AVATAR_DIR`、`workspace_paths.py` `APP_PROJECTS_BASE`(33) 改为 `from src.core.config import app_data_dir` 并用 `app_data_dir() / "..."`。`workspace_paths.py:44` 的 `return p / ".digital-employee"` 改为 `return p / f".{APP_DIR_NAME}"`（或复用 config 的常量）——这是外部目录隔离子目录，spec 已决策一并改名。

- [ ] **Step 4: 核对残留 + 跑后端基线**

Grep 工具确认 `apps/server/src` 无残留 `.digital-employee` 字面量（注释也改）。
Run: `cd apps/server && uv run pytest -q 2>&1 | tail -3` → 必须 **716 passed / 0 failed**。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/config.py apps/server/src/api/avatar_api.py apps/server/src/api/employee_api.py apps/server/src/service/agent/workspace_paths.py
git commit -m "$(printf 'refactor(config): 后端数据目录 ~/.digital-employee → ~/.boban-staff(收敛单一常量)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Electron 数据目录 + 身份改名

**Files:**
- Modify: `apps/web/electron/core/data-paths.ts`（`getDataDir()` 字面量+注释）
- Modify: `apps/web/electron-builder.json5`（appId）
- Modify: `apps/web/electron-builder.offline.json5`（appId + 三平台 artifactName）
- Modify: `apps/web/electron/main/index.ts`（`setAppUserModelId`）
- Modify: `apps/web/package.json`（cosmetic：description/homepage/author）

- [ ] **Step 1: 枚举 electron 数据目录 + 旧 appId 站点**

Grep 工具：pattern `\.digital-employee`（path `apps/web/electron`）+ pattern `com\.digital-employee-m\.app`（path `apps/web`）。确认 data-paths.ts 是唯一数据目录字面量源（其余 electron 文件经 `getDataDir()` 派生，如 pet-paths.ts 已是）；列出所有旧 appId 站点（预期 builder x2 + main/index.ts）。

- [ ] **Step 2: 数据目录字面量**

`data-paths.ts` `getDataDir()`：`.digital-employee` → `.boban-staff`，注释里 `~/.digital-employee` → `~/.boban-staff`。若 Step 1 发现 electron 内其它硬编码数据目录的文件，一并收敛为走 `getDataDir()`。

- [ ] **Step 3: 身份改名**

- `electron-builder.json5`：`appId` → `com.boban-staff.app`（productName 维持 BobanStaff）。
- `electron-builder.offline.json5`：`appId` → `com.boban-staff.app`；三平台 `artifactName` 的 `DigitalEmployee-Offline-*` → `BobanStaff-Offline-*`。
- `main/index.ts`：`setAppUserModelId("com.digital-employee-m.app")` → `com.boban-staff.app`。
- `package.json`：`description`/`homepage`/`author` 对齐 BobanStaff 品牌；**保留** `name: "digital-employee"` 与 `version: "0.1.22"`。

- [ ] **Step 4: 核对残留 + tsc**

Grep 工具确认 `apps/web` 无残留 `com.digital-employee-m.app`；electron 数据目录字面量仅 data-paths.ts 一处 `.boban-staff`。
Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | rg -c 'error'` → ≤ **79**。
（electron 主进程 TS 用 `apps/web/tsconfig.node.json` 或 electron 自己的 tsc；若 app config 不覆盖 electron/，另跑 `npx tsc -p tsconfig.node.json --noEmit` 确认 electron 改动不引入类型错——以仓库实际 electron typecheck 命令为准，若无则跳过并说明。）

- [ ] **Step 5: Commit**

```bash
git add apps/web/electron/core/data-paths.ts apps/web/electron-builder.json5 apps/web/electron-builder.offline.json5 apps/web/electron/main/index.ts apps/web/package.json
git commit -m "$(printf 'refactor(electron): 独立身份(appId com.boban-staff.app)+数据目录 ~/.boban-staff\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: 删死列(sender_id/sender_label/chunk_json)——model+DTO+前端

**Files:**
- Modify: `apps/server/src/models/conversation.py`（删 3 个 mapped_column）
- Modify: `apps/server/src/schemas/conversation.py`（摘 chunk_json DTO 字段）
- Modify: `apps/web/src/api/types.ts`（`ChatMessageDto.chunk_json?`）
- Modify: `apps/web/src/lib/chat/chat-mappers.ts`（`chunkJson: msg.chunk_json`）
- Modify: `apps/web/src/types/chat.ts`（`Message.chunkJson?`）

- [ ] **Step 1: 全量定位**

Grep 工具：`sender_id|sender_label|chunk_json|chunkJson`（path `apps/server/src` 与 `apps/web/src`）。确认后端写入/读取处仅剩 model + DTO（sender 的 Batch C 已清，只剩 model 列 + init_db；chunk_json 在 model + DTO）；前端 chunk_json 在上述 3 文件。**若发现 tsx 渲染真消费 `chunkJson` → 报告 DONE_WITH_CONCERNS 并贴出，不要硬删那条渲染。**

- [ ] **Step 2: 后端删列 + DTO**

`models/conversation.py`：删 `sender_id`/`sender_label`/`chunk_json` 三个 mapped_column（保留注释清爽）。`schemas/conversation.py`：删 `chunk_json` DTO 字段（sender_* 已无）。**不要动 init_db**（Task 4 处理）。

- [ ] **Step 3: 前端摘 chunk_json**

`api/types.ts` 删 `chunk_json?`；`chat-mappers.ts` 删 `chunkJson: msg.chunk_json` 赋值（若 `Message` 不再有 chunkJson 字段，此行整删）；`types/chat.ts` 删 `Message.chunkJson?`。

- [ ] **Step 4: 基线**

Run: `cd apps/server && uv run pytest -q 2>&1 | tail -3` → **716 passed / 0 failed**（若有测试 fixture 插入这三列致失败，按列已删更新 fixture）。
Run: `cd apps/web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | rg -c 'error'` → ≤ **79**。
Grep 工具确认前后端 src 无残留 `sender_id`/`sender_label`/`chunk_json`/`chunkJson`（init_db 里的 sender/stream_chunks 建列留给 Task 4）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/models/conversation.py apps/server/src/schemas/conversation.py apps/web/src/api/types.ts apps/web/src/lib/chat/chat-mappers.ts apps/web/src/types/chat.ts
git commit -m "$(printf 'refactor(schema): 删死 DB 列 sender_id/sender_label/chunk_json(model+DTO+前端)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: 精简 init_db——删兼容/迁移垫片,保留 create_all/_init_fts5/_reset_orphaned_streams

**Files:**
- Modify: `apps/server/src/db/init_db.py`
- Test: `apps/server/tests/`（加一条 create_all 新库回归，若现有未覆盖）

- [ ] **Step 1: 安全前提——逐列核对 model 声明（先验证再删）**

读 `init_db.py` 全文。对**每个** `ensure_column(table, col, ...)`，用 Grep 工具/Read 确认该 `col` 已在对应 model 声明（评审已抽查 rework_count/qa_accepted_at/user_id/message_parts/sender_* 均在 model）。
- 全部已在 model → 可安全删整层。
- 若有"只在 ensure_column、model 未声明"的漂移列 → **先把该列补进对应 model**，再删 shim。报告里列出核对结论（全覆盖 / 哪些需补）。
`stream_chunks` 预期不在 model（新库本就不建它）→ 删其 ensure_column 行即可。

- [ ] **Step 2: 删除迁移/回填，保留必需逻辑**

按 spec §3 B2：
- **删**：所有 `ensure_column(...)` + `ensure_column` 辅助函数；employees 手写 ALTER 段；`_migrate_conversation_title_to_text`（调用+定义）；`_migrate_task_id_nullable`（调用+定义）；`_migrate_employee_unique_key`（调用+定义）；`backfill_user_id` 调用；`backfill_orchestrator_conversation_links` 调用；随之失效的 import。
- **保留**：`Base.metadata.create_all(bind=get_engine())`；`_init_fts5(engine)`（调用+定义）；`_reset_orphaned_streams(engine)`（调用+定义）。
- 清理 `inspect`/`text` 等仅被已删代码用到的 import；保留被 fts5/reset 用到的。

- [ ] **Step 3: create_all 新库回归**

确认/新增一条测试：在全新（临时/内存）库上仅经 `init_db()`（现仅 create_all+fts5+reset）建库后，关键表与列齐备（抽查 employees.is_curator、employee_tasks.rework_count、task_execution_logs.qa_accepted_at、conversations.user_id、conversation_messages.message_parts）、FTS5 搜索表存在、基本读写通。若现有 conftest/测试已覆盖（测试库走 init_db）则确认其仍绿即可，不重复造。

- [ ] **Step 4: 基线 + 必需逻辑未误删**

Run: `cd apps/server && uv run pytest -q 2>&1 | tail -3` → **716 passed（或 +新增回归）/ 0 failed**。
Grep 工具确认 init_db.py 仍含 `_init_fts5` 与 `_reset_orphaned_streams` 的定义与调用；已无 `ensure_column`、`_migrate_`、`backfill_` 调用。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/init_db.py apps/server/tests/
git commit -m "$(printf 'refactor(db): 删 init_db 兼容/迁移垫片(保留 create_all/fts5/流复位)\n\n新项目=新库,无历史库可升,ensure_column 整层成死重;表重建迁移与回填\n对新库空跑亦删。create_all 从 models 一步建全 schema。\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: 集成收尾——全量基线 + 残留 grep

- [ ] **Step 1: 全量三连基线**

```bash
cd apps/server && uv run pytest -q 2>&1 | tail -3
cd ../web && npx tsc -p tsconfig.app.json --noEmit 2>&1 | rg -c 'error'
npx vitest run 2>&1 | tail -5
```
Expected: 后端 0 failed、tsc ≤79、vitest failed ≤1（仅既有 curator-panel）。

- [ ] **Step 2: 残留 grep（全用 Grep 工具）**

- `.digital-employee`：全仓应**零**残留（含注释；workspace_paths:44 已改名）。
- `com.digital-employee-m.app`：全仓零残留。
- `sender_id`/`sender_label`/`chunk_json`/`chunkJson`/`stream_chunks`：src 内零残留（init_db 已删建列）。
- `boban-staff`：后端单一来源(config.py) + electron 单一来源(data-paths.ts) 各一处；`BobanStaff` 在两份 builder 配置。

- [ ] **Step 3: electron-builder 配置可解析（轻量冒烟）**

`cd apps/web && npx electron-builder --help >/dev/null 2>&1 && echo OK` 或对两份 json5 做 JSON5 解析校验（不必真打包）。确认 appId/artifactName 改动未破坏配置结构。

- [ ] **Step 4: 收尾确认**

报告：三基线数值、四组 grep 结论、init_db 最终行数、保留逻辑（fts5/reset）确认。无产物则本任务无 commit。
