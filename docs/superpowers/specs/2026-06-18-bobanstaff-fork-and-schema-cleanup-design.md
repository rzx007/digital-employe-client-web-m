# Fork 成独立 BobanStaff 应用 + schema 清理 — 设计 spec

- 日期：2026-06-18
- 分支：feat/orchestrator-centric（已正式独立于 dev，不再回合）
- 关联：[2026-06-16-deadcode-batch-c-contract-layer.md](../plans/2026-06-16-deadcode-batch-c-contract-layer.md)（Batch C 缓下的 DB 列 DROP，本 spec 接手）

## 1. 背景与动机

当前分支已独立于 dev 分支，可当作**新项目**。用户决策三条：
1. Electron 变成独立应用（**仅独立身份 + 构建解耦**，留在 monorepo，代码结构不动，最小改动）。
2. 数据目录不再公用 `~/.digital-employee`，改 `~/.boban-staff`。
3. 继续清死代码，**包括 DB 列**，以及 **init_db 里的迁移/兼容代码**。

核心逻辑链：**先建立独立身份 + 私有数据目录（= 全新空库）→ 这才使"删死列 + 删整套 init_db 兼容垫片"安全**。新库由 `Base.metadata.create_all()` 从 models 一步建全，没有任何历史库需要升级，故所有 `ensure_column` 垫片成为纯死重。两部分一起交付。

## 2. 目标 / 非目标

### 目标
- 新 app 与 dev 产品线**身份、数据双隔离**，两套安装可共存、数据互不污染。
- 数据目录字面量收敛成**单一来源**（后端一处、Electron 一处），杜绝散落硬编码。
- 删死 DB 列（`sender_id`/`sender_label`/`chunk_json`）+ 删整套 init_db 兼容/迁移垫片，schema 由 models 单一定义。

### 非目标
- **不**把 apps/web 抽出 monorepo（保留 turbo/pnpm workspace、`@workspace/ui`、与 server 同仓）。
- **不**迁移老用户数据（干净切断；旧 `~/.digital-employee` 留给旧 app）。
- **不**改 `package.json` 内部 `name`（保 `digital-employee`，避免 `pnpm --filter`/turbo 引用断裂）、**不**改 version（保 `0.1.22`，免自动更新源错乱）。
- **不**改派发/编排/前端业务逻辑。

## 3. 设计

### Part A — 独立身份 & 数据隔离

#### A1. 数据目录 `~/.digital-employee` → `~/.boban-staff`，收敛单一常量
- **后端单一来源**：`apps/server/src/core/config.py` 新增（`APP_DIR_NAME = "boban-staff"` + `def app_data_dir() -> Path: return Path.home() / f".{APP_DIR_NAME}"`）。
  - `config.py` 自身 6 处直改引用它：`get_default_artifacts_path` / `get_default_sqlite_path` / `get_default_skill_path` / `get_default_builtin_skills_path` / `get_default_local_skills_path` / `get_default_logs_dir`。
  - **直接硬编码站点**（需各自改引用 `app_data_dir()`）：`apps/server/src/api/avatar_api.py`（`AVATAR_DIR`）、`apps/server/src/api/employee_api.py`（`_AVATAR_DIR`）、`apps/server/src/service/agent/workspace_paths.py`（`APP_PROJECTS_BASE`，第 33 行）。
  - **间接派生站点（无需直改，改 config.py 自动生效）**：`activation/storage.py`（经 `get_default_sqlite_path()`）、`logging_setup.py`（经 `get_default_logs_dir()`）。实现期仅核对其确为间接、不含独立硬编码即可。
  - 实现期对剩余 `.digital-employee` 做一次全仓 Grep 工具扫描兜底。
- **`workspace_paths.py` 第 44 行需单独决策（非数据目录）**：`return p / ".digital-employee"` 是当用户选**外部源码目录**作工作空间时、在该目录下建的**隔离子目录**（防污染用户文件树），与应用数据目录性质不同。决策：**也改为 `.boban-staff`**——新项目数据库全新、不存在历史外部工作空间需识别，新 app 自建的外部工作空间应使用新品牌隔离目录，语义一致。（不是漏网的数据目录，是有意一并改名。）
- **Electron**：`apps/web/electron/core/data-paths.ts` 的 `getDataDir()` 改字面量 + 注释；其余 electron 文件（`features/pet/pet-paths.ts` 已经过 `getDataDir()` 派生 ✔、extension 路径、`features/logs/log-exporter.ts` 等）核对都经 `getDataDir()` 派生，不各自硬编码。
- **注意取证手段**：Bash `rg` 对字面量 `.digital-employee` 的**显示输出会被串改成 `.n`**（已实测，是渲染层假象，非真文件）。实现期一律用 **Grep 工具或 Read** 核对字面量，不靠 Bash grep 的字符串输出判定。
- **无数据迁移**：新 app 首启即在 `~/.boban-staff` 全新起库。

#### A2. 身份改名（与 dev 产品线区分）
- `apps/web/electron-builder.json5` + `electron-builder.offline.json5`：`appId` `com.digital-employee-m.app` → `com.boban-staff.app`；`productName` 维持 `BobanStaff`（已是）。
- **offline 配置 `artifactName` 对齐**：`electron-builder.offline.json5` 三平台 artifactName 仍为 `DigitalEmployee-Offline-*`，改为 `BobanStaff-Offline-*`（与品牌一致）。其 `afterPack` 路径（`../../scripts/afterPack.js`）与主配置（`afterPack.cjs`）不同——本期**不动**，仅在打包冒烟时确认 offline 配置仍可用；若失效再单独处理。
- 主进程 `setAppUserModelId(...)`（`apps/web/electron/main/index.ts`）同步换 `com.boban-staff.app`（Windows 任务栏/通知/单例锁/自动更新身份）。
- `package.json`：改 cosmetic 元数据 `description`/`homepage`/`author` 对齐 BobanStaff；**保留** `name: "digital-employee"` 与 `version: "0.1.22"`。
- 实现期 grep 旧 appId `com.digital-employee-m.app` 全站点，确保无遗漏（preload/通知/协议注册等）。

### Part B — schema 清理（被 A1 的全新库使能）

#### B1. 从 models 删死列 + 摘前后端引用
- `apps/server/src/models/conversation.py`：删 `sender_id` / `sender_label` / `chunk_json` 三个 `mapped_column`。
- 摘 `chunk_json` 在**后端 DTO**（`apps/server/src/schemas/conversation.py`）及序列化/读取处的引用（Batch C 当时缓的就是它；`sender_id`/`sender_label` 的 DTO 引用 Batch C 已删）。
- 摘 `chunk_json` 在**前端**的 3 处（与 Batch C 删 sender 链同形）：`apps/web/src/api/types.ts`（`ChatMessageDto.chunk_json?`）、`apps/web/src/lib/chat/chat-mappers.ts`（`chunkJson: msg.chunk_json`）、`apps/web/src/types/chat.ts`（`Message.chunkJson?`）。删后确认无 tsx 渲染消费 `chunkJson`（核查后若有真消费再评估，预期无）。
- `stream_chunks` 不在 model（仅 init_db 垫片），无需动 model；其建列在 B2 随兼容层一并删除。
- 删后全仓核对（Grep 工具）：`sender_id`/`sender_label`/`chunk_json`/`chunkJson`/`stream_chunks` 在前后端 src 内无残留。

#### B2. 精简 init_db——删兼容/迁移垫片，保留新库必需逻辑
**关键：init_db.py 不止 ensure_column。** 必须分辨"对历史库的迁移/回填"（可删）与"对每次启动/新库都必需的逻辑"（保留）。逐项处置：

**删除（历史库迁移/回填，新库无意义）：**
- 所有 `ensure_column(...)` 调用 + `ensure_column` 辅助函数。
- employees 那段手写 `ALTER TABLE`（description/shift_schedule_json）。
- `_migrate_conversation_title_to_text`（调用 + 定义）——新库 model 已声明 `title` 为 `Text`，create_all 直接建 TEXT，无需迁移。
- `_migrate_task_id_nullable`、`_migrate_employee_unique_key`（表重建迁移）——新库由 model 直接建出正确约束（task_id nullable / 唯一键 `(user_id, employee_code)`）；二者均幂等早返回，新库上空跑，删调用 + 定义。
- `backfill_user_id`、`backfill_orchestrator_conversation_links` 调用——新库无数据可回填，删调用（及随之失效的 import）。

**保留（新库/每次启动都必需，非迁移）：**
- `Base.metadata.create_all(bind=get_engine())`——schema 唯一来源。
- `_init_fts5(engine)`——建全文搜索 FTS5 虚表 + trigger，用 `IF NOT EXISTS`，**新库也必须建**。误删 = 会话搜索失效。
- `_reset_orphaned_streams(engine)`——每次启动清理重启遗留的挂起流状态，是**运行时修复**不是迁移。误删 = 进程重启后流卡死 bug 复现。

预期 init_db 从约 498 行瘦到约 80–120 行（保留上述三项 + 其依赖 import）。

**安全前提（实现期第一步，先验证再删 ensure_column）**：每个被 `ensure_column` 补过的列，必须已在对应 model 声明，create_all 才会为新库建它。逐列对照 models（评审已抽查 `rework_count`/`qa_accepted_at`/`user_id`/`message_parts`/`sender_*` 均在 model）：
  - 若全部已在 model（预期如此）→ 删 ensure_column 层安全。
  - 若发现"只在 ensure_column、model 未声明"的漂移列 → 先补进 model 再删 shim（否则新库缺列即崩）。

## 4. 改动面清单
- 后端（数据目录）：`config.py`（新增常量 + 6 处改引用）、`avatar_api.py`、`employee_api.py`、`workspace_paths.py`（含第 44 行外部隔离子目录）。`activation/storage.py`/`logging_setup.py` 为间接派生、随 config.py 自动生效（仅核对）。
- 后端（schema）：`models/conversation.py`（删 3 列）、`schemas/conversation.py`（摘 chunk_json）、`db/init_db.py`（删兼容/迁移垫片、保留 create_all + _init_fts5 + _reset_orphaned_streams）。
- 前端（chunk_json）：`apps/web/src/api/types.ts`、`apps/web/src/lib/chat/chat-mappers.ts`、`apps/web/src/types/chat.ts`。
- Electron（身份/数据目录）：`electron-builder.json5`、`electron-builder.offline.json5`（appId + offline artifactName）、`electron/main/index.ts`（AppUserModelId）、`electron/core/data-paths.ts`、`package.json`（cosmetic），及实现期核对的其余 electron 数据目录派生文件。

## 5. 测试 / 验证策略
- **新库 create_all 即可用（锁 B2 安全前提）**：后端 pytest 全绿（测试库走 create_all，不依赖 ensure_column）。加/确认一条回归：裸 create_all 建库后关键表/列齐备、FTS5 搜索可用、应用基本读写通。
- **FTS5 / 流复位未被误删**：确认 init_db 仍保留 `_init_fts5` 与 `_reset_orphaned_streams`；会话全文搜索相关测试（若有）仍绿。
- **死列已无**：Grep 工具确认 `sender_id`/`sender_label`/`chunk_json`/`chunkJson`/`stream_chunks` 在前后端 src 内无残留（除有意保留的注释）。
- **数据目录收敛**：Grep 工具确认全仓无残留 `.digital-employee` 字面量（后端 + electron）；新字面量 `boban-staff` 仅出现在后端/electron 各一处单一来源。
- **身份改名**：Grep 旧 appId `com.digital-employee-m.app` 无残留；两份 electron-builder 配置 artifactName 均为 `BobanStaff*`、配置可解析（dry 校验或一次打包冒烟）。
- **前端 tsc** 不变差（基线 79）。

## 6. 风险
- **误删 init_db 必需逻辑**（最高危）：`_init_fts5`（搜索）/`_reset_orphaned_streams`（流复位）不是迁移，误删会回退功能。**缓解**：B2 明确"保留清单"，逐项判定 keep/delete，不按"只留 create_all"字面执行。
- **model/schema 漂移**：某列只在 ensure_column、model 没声明 → 删 shim 后新库缺列。**缓解**：B2 第一步逐列核对 model，漂移列先补进 model。
- **`.digital-employee` grep 显示串改**：Bash rg 输出把字面量显示成 `.n`，易误判。**缓解**：一律用 Grep 工具/Read 核对，不信 Bash grep 字符串输出。
- **遗漏的身份/路径站点**：preload、协议注册、通知、pet/extension 子目录可能各自硬编码。**缓解**：实现期对旧 appId 与旧数据目录各做一次全仓 Grep 工具收尾。
- **老用户数据被"抛弃"**：这是有意的（新项目语义）；旧 app 仍用旧目录，互不影响。外部工作空间隔离子目录（workspace_paths.py:44）一并改名，新 app 自建新目录、不识别旧 app 建的旧子目录——符合干净切断。

## 7. 验收对照
- 新 app 首启在 `~/.boban-staff` 起全新库，与仍跑旧 `~/.digital-employee` 的旧 app 数据/身份互不干扰。
- init_db 仅剩 create_all；死列从 model/DTO/建列三处全消失。
- 全套后端测试在纯 create_all 新库上全绿。
