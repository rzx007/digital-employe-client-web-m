# Datetime 时区归一化（P0 根治 naive/aware 混用）设计

> 状态：设计稿，待评审 + 用户通读。**仅设计，不实现。**

## 1. 背景与问题

本仓库所有 datetime 列声明为 `DateTime(timezone=True)`，但 **SQLAlchemy 的 SQLite 方言不存储时区**——写入的 aware 时间，读回来一律 **naive**。而 `cst_now()`（`src/models/workspace.py`，`CST = timezone(timedelta(hours=8))`）产出 **CST-aware**。两者在 Python 层相遇即 `TypeError: can't compare offset-naive and offset-aware datetimes`。

**已发生的故障**：`task_scheduler_service.reload_jobs` once 分支 `plan.run_at(naive) <= now(aware)` 崩溃 → 确认定时计划时整轮 reload_jobs 抛异常 → once 任务永不注册、永不触发（用户「3分钟后提醒开会」从未执行）。已局部修复（commit 在 feat/orchestrator-centric），但这是**系统性 bug 类**的一个实例。

**证据：知识只活在零散补丁里**。代码中已有 **4 处**防御性 `.replace(tzinfo=None)` 各自处理同一冲突，从未上升为统一约束：
- `src/service/stream_registry.py:2445`、`:2585`
- `src/service/orchestration_lifecycle.py:179-181`
- `src/service/task_service.py:885-887`

`reload_jobs:141` 是唯一漏做这套动作的地方。只要没有归一化边界，新代码必然反复漏。

**关联记忆**：`sqlite-naive-datetime-gotcha`、`scheduled-recurring-orchestration-plan`。

## 2. 目标 / 非目标

**目标**
- 建立**单一归一化边界**：ORM 层所有 datetime 列读出**恒为 CST-aware**，写入时把 aware 归一到 CST、naive 视为 CST 本地时刻。
- 消除整个 naive/aware bug 类：`cst_now()` 与任何 DB datetime 的比较/相减天然成立。
- 清理现有 4 处 `.replace(tzinfo=None)` 冗余补丁。
- 无需数据迁移（库里存的本就是 CST 墙上时间）。

**非目标**
- 不改为 UTC 内部存储。
- 不改前端显示逻辑（除非审计发现序列化变更破坏现有展示）。
- 不引入第三方时区库（保持 `datetime.timezone` 固定偏移，单一地区桌面应用足够）。

## 3. 决策（已与用户敲定）
1. **归一化模型 = 读出补 CST（aware）**。`cst_now()` 保持 aware 不变。
2. **范围 = 全库所有 DateTime 列**，统一换成共享自定义类型。
3. **一并清理** 4 处旧 `.replace(tzinfo=None)` 补丁。

## 4. 设计

### 4.1 核心：`CstDateTime` TypeDecorator

新文件 `src/db/types.py`：

```python
from datetime import datetime
from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator
from src.core.cst import CST  # 见 4.2：CST 下沉到中立模块，避免循环 import

class CstDateTime(TypeDecorator):
    """SQLite 不存时区。本类型把 datetime 列归一到「CST 本地墙上时间」存储，
    读出时统一补回 CST tzinfo，使 ORM 层 datetime 恒为 CST-aware。"""
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(CST)   # aware → 归一到 CST
        return value.replace(tzinfo=None)   # impl 始终拿 naive（避免方言丢 tz 的歧义）

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=CST) if value.tzinfo is None else value.astimezone(CST)
```

- 写：aware 先 `astimezone(CST)` 再剥成 naive 交给 impl（确定性，不依赖 SQLite 方言如何处理 aware）；naive 视为 CST 本地，原样存。
- 读：naive `replace(tzinfo=CST)`；万一拿到 aware（非 SQLite 场景）`astimezone(CST)`。
- `cache_ok = True` 让 SQLAlchemy 语句缓存生效。

### 4.2 解决循环 import：CST 下沉

当前 `CST`/`cst_now` 在 `src/models/workspace.py`。若 `workspace.py` 的列改用 `CstDateTime`，则 `workspace.py → db/types.py → workspace.py` 形成环。

**方案**：把 `CST` 与 `cst_now()` 下沉到中立模块 `src/core/cst.py`，并在 `src/models/workspace.py` 顶部 **re-export**（`from src.core.cst import CST, cst_now`），保持既有 `from src.models.workspace import CST, cst_now` 的全部调用点不破。

### 4.3 全库换列

把所有 model 中的 `DateTime(timezone=True)`（含无 timezone 参数的 `DateTime`）替换为 `CstDateTime`（或 `CstDateTime()`）。涉及文件需在写计划阶段用 `grep -rn "DateTime" src/models` 全量列出，逐文件换。已知至少：`orchestration_plan.py`、`plan_run.py`、`task_execution_log.py`、`employee_task.py`、`workspace.py`、`conversation.py` 等。

### 4.3.1 ⚠️ 必改：`workspace_authorized_dir.created_at` 的 server_default（评审揪出的真 bug）

`src/models/workspace_authorized_dir.py:20-22` 的 `created_at` 用 `server_default=func.now()` → SQLite `CURRENT_TIMESTAMP` = **naive UTC、服务端 SQL 写入**，**绕过 `process_bind_param`**。若直接用 `CstDateTime` 包这列，读出会把 UTC 当 CST → **每条授权目录记录的 created_at 偏 +8 小时**。

**修法**：把该列默认改成 Python 侧 `default=cst_now`（与其它表一致，经 decorator 归一），**再**换 `CstDateTime`。不可只换类型不改默认。这是全库唯一一处「naive-UTC 服务端写入」，其余无同类。

### 4.4 清理旧补丁

§1 列出的 4 处 `.replace(tzinfo=None)`：新边界生效后，列读出即 aware，这些剥 tzinfo 的动作变多余且误导。改为直接相减/比较（两侧均 aware-CST）。**注意**：清理后这些表达式必须仍正确——逐处确认两个操作数现在都来自 DB 列或 `cst_now()`（均 aware）。

### 4.5 reload_jobs:141 回归

本次 P0 落地后，先前局部修的 `run_at_aware = run_at.replace(tzinfo=CST)` 变冗余（列已 aware）。可简化回 `plan.run_at <= now`。**保留**已加的 per-plan try/except 隔离（与本 P0 正交，属调度健壮性，不动）。

## 5. 风险与必做审计

| 风险 | 说明 | 处置 |
|---|---|---|
| **R1 API 序列化变格式（范围已收窄）** | 评审确认：绝大多数响应模型用 `@field_serializer(...).strftime("%Y-%m-%d %H:%M:%S")` 剥了 tz，输出**逐字节不变**（task/conversation/employee/workspace/config_kv/performance_record 等）。**仅 2 个无 serializer 的模型**会新带 `+08:00`：`schemas/orchestration.py:49 OrchestrationPlanRead.created_at/updated_at`、`schemas/skill_rating.py:30 created_at`。前端 `new Date("...+08:00")` 解析带偏移更准、China 单机同值，显示大概率不变。 | 针对这 **2 个**模型加序列化测试 + 手测其时间显示；并断言 strftime 那批输出不变。**不必**全模型审计。 |
| **R2 naive-UTC 写入被误标（已审，仅 1 处）** | 评审确认全库无 `utcnow()`；所有 `datetime.now()` 写的是 JSON/字符串非 DB 列；唯一 naive-UTC 写 DB 列的是 §4.3.1 的 `func.now()` server_default → 已在 §4.3.1 处置。feishu 用 `datetime.now(timezone.utc)`（aware）经 bind 正确归一，安全。 | 按 §4.3.1 改 default 即闭环。 |
| **R3 列遗漏** | 漏换某列 → 该列仍 naive，局部仍可能炸。 | 计划阶段 grep 全量清单，逐一核对；加一个「随机取样列读出断言 tzinfo 非空」的集成测试兜底。 |
| **R4 APScheduler/比较点** | run_at 变 aware 后喂 `DateTrigger(timezone=CST)`、与 `cst_now()` 比较。 | aware→DateTrigger 正常；比较天然成立。加 reload_jobs once 注册的回归测试（已存在 naive 版，需保留并确认仍绿）。 |
| **R5 时钟回拨/activation** | activation_service 自带 UTC now，与 DB 列无关。 | 确认其 expires_at 不经 CstDateTime 列（是独立记录）即可，不在本次范围。 |
| **R6 裸 SQL 绕过 decorator（不变量）** | `process_bind_param/result_value` 只在 ORM 路径生效。`init_db.py:149-153` 的 `_backfill_plan_runs_for_legacy_plans` 用 `text(INSERT ... started_at/ended_at/created_at)` 直插、`config.py:247` 用裸 `sqlite3.connect` 读 config_kv，均**绕过** CstDateTime。 | 不变量：**裸 SQL 碰 *_at 列不经归一化**。评审已核对 init_db 回填为 naive→naive 往返安全（读出 naive 直接重插，不变）。spec 写明此不变量，警示后续裸 SQL 作者。 |

## 6. 测试策略
- **类型单测**：`CstDateTime` bind/result 往返——aware 进 / naive 进 / None；读出恒 aware-CST；跨 DST 无关（固定偏移）。
- **回归**：`reload_jobs` once（naive run_at）注册成功（保留现有回归测试）。
- **集成**：建一个含 datetime 列的行 → commit → 新 session 读回 → 断言 `tzinfo == CST`、与 `cst_now()` 可比较。
- **序列化**：挑 2-3 个关键响应模型（编排计划 detail、today tasks、通知）断言 datetime 字段序列化稳定且可被前端解析。
- 全后端 `uv run pytest -q` 零新增 failed（基线 1 预存 failed）。

## 7. 实施顺序（留给写计划阶段细化）
1. `src/core/cst.py` 下沉 CST/cst_now + workspace re-export（不破既有 import）。
2. `src/db/types.py` 加 `CstDateTime` + 类型单测（TDD）。
3. **先**改 `workspace_authorized_dir.created_at`：`server_default=func.now()` → `default=cst_now`（§4.3.1），**再**全库 model 列换 `CstDateTime`（分文件，小步）。
4. 集成测试（行往返断言 tzinfo==CST、可与 cst_now() 比较）+ R1 序列化测试（仅 `OrchestrationPlanRead`/`skill_rating` 两模型 + strftime 批不变）。
5. 清理 4 处旧 `.replace()` + 简化 reload_jobs:141。
6. 全量回归 + 收尾评审。

## 8. 回滚
TypeDecorator 是纯读写转换、不改存储格式（仍 naive 字符串），可随时把列换回 `DateTime` 回滚，无数据损伤。
