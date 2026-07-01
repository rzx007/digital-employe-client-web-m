# 阶段 3：成长面板（只读员工履历卡）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。
> 上游：总管中心重构总览 阶段3；让阶段2 后端积累(profile/journal/memory/技能)在前端可见。基底 `feat/orchestrator-centric`（阶段1/2 完成）。

**Goal:** 在员工详情面板新增只读「成长履历」——展示该员工的能力画像(profile.md)、技能清单、长期记忆(AGENTS.md)、学习日志(journal)。让阶段2 的积累肉眼可见；员工降级为"可只读查看成长"的履历卡。

**Architecture:** 后端加只读端点 `GET /employees/{id}/growth/brain`(全复用现有读文件能力聚合大脑) + 前端 api/hook/`GrowthBrainSection` 组件(复用 MessageResponse 渲 markdown) 接进 `contact-detail-panel` 新 tab。纯加性、只读、不改员工编辑/任务监控。

**Tech Stack:** 后端 Python/FastAPI/pytest(uv)；前端 React/TanStack Query/vitest(pnpm)。

---

## 设计要点（实现前必读）

**员工大脑布局**（`<skill_path>/<eid>/`，brain 根 = `resolve_employee_memories_dir(eid).parent`）：
- `profile.md`(2C 生成)、`memories/AGENTS.md`、`journal/*.jsonl`(2A，**在 `<brain>/journal/` 不在 memories 下**)、`skills/<name>/SKILL.md`
- 复用：`resolve_employee_memories_dir`(paths.py:78)、`list_available_skills`(paths.py:54)、`read_text_with_encoding_fallback`(basic_file_reader.py:106)、journal 读取参考 `librarian._read_recent_journal`。

**端点响应 shape**：`{profile_md: str, skills_list: str[], memories_md: str, journal_entries: [{ts,task_name,status,duration_ms}]}`。全部只读、缺失给空。

**前端落点**：`contact-detail-panel.tsx` Tabs(现 tasks/edit 两个)加第三个 `growth`「成长履历」。employee id = `selectedContact.employee?.id`。markdown 用 `MessageResponse`(@workspace/ui ai-elements/message)。hook 模式仿 `use-schedule-monitor-queries.ts` 的 useExecutionMetrics7d。api 仿 `api/employee.ts` 的 fetchEmployeeById。

**⚠️ node_modules**：worktree 无 node_modules，前端任务前需 `pnpm install`(控制器负责，见执行说明)。前端 typecheck 用 `pnpm --filter <web包名> typecheck`；注意 packages/ui 有预存 typecheck 报错(toReversed)——只看 web 包新增文件无新错即可。

**文件结构**：
- 后端：`schemas/employee.py`(+schema)、`service/employee_service.py`(+build_employee_growth_brain)、`api/employee_api.py`(+端点)
- 前端：`api/employee.ts`(+fn+type)、`hooks/`(+hook)、`components/chat/contacts/growth-brain-section.tsx`(新)、`contact-detail-panel.tsx`(接 tab)
- 测：后端 `tests/test_employee_growth_brain.py`；前端按现有 vitest 惯例(或仅 typecheck)

---

## Task 1（后端）：build_employee_growth_brain 服务 + schema

**Files:** Modify `schemas/employee.py`(或新建)、`service/employee_service.py`；Test `tests/test_employee_growth_brain.py`

- [ ] **Step 1: 写失败测试**

```python
"""阶段3：员工成长大脑聚合。"""
import json
from pathlib import Path
from tests.conftest import add_employee


def _seed_brain(brain: Path):
    brain.mkdir(parents=True, exist_ok=True)
    (brain / "profile.md").write_text("# 能力画像\n- 擅长调研", encoding="utf-8")
    (brain / "memories").mkdir(exist_ok=True)
    (brain / "memories" / "AGENTS.md").write_text("## 用户偏好\n§简洁", encoding="utf-8")
    (brain / "skills" / "my-skill").mkdir(parents=True, exist_ok=True)
    (brain / "skills" / "my-skill" / "SKILL.md").write_text("---\nname: my-skill\n---\n", encoding="utf-8")
    jd = brain / "journal"; jd.mkdir(exist_ok=True)
    with (jd / "2026-06-15.jsonl").open("w", encoding="utf-8") as f:
        f.write(json.dumps({"ts": "t1", "task_name": "调研A", "status": "success", "duration_ms": 100}, ensure_ascii=False) + "\n")


def test_build_growth_brain(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="林晓")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(eid))
    _seed_brain(tmp_path / str(emp.id))

    brain = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    assert "调研" in brain["profile_md"]
    assert "my-skill" in brain["skills_list"]
    assert "简洁" in brain["memories_md"]
    assert brain["journal_entries"] and brain["journal_entries"][0]["task_name"] == "调研A"


def test_build_growth_brain_empty(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    emp = add_employee(db_session, workspace.id, name="新人")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(eid))
    brain = es.EmployeeService.build_employee_growth_brain(db_session, emp.id)
    assert brain == {"profile_md": "", "skills_list": [], "memories_md": "", "journal_entries": []}
```

- [ ] **Step 2: 跑测试确认失败** `cd apps/server && uv run pytest tests/test_employee_growth_brain.py -v`

- [ ] **Step 3: 实现**

`employee_service.py` 加模块级 helper + 静态方法（先读该文件确认 EmployeeService 类与 import 风格）：
```python
def _growth_brain_root_for(employee_id: int) -> Path:
    from src.service.agent.paths import resolve_employee_memories_dir
    return resolve_employee_memories_dir(employee_id=employee_id).parent


# 在 EmployeeService 类内：
@staticmethod
def build_employee_growth_brain(db: Session, employee_id: int) -> dict:
    """聚合员工大脑(profile/技能/记忆/journal)只读展示数据。缺失给空。容错。"""
    from src.service.agent.paths import list_available_skills
    from src.service.basic_file_reader import read_text_with_encoding_fallback
    import json as _json

    brain = _growth_brain_root_for(employee_id)
    def _read(p: Path) -> str:
        try:
            return read_text_with_encoding_fallback(p) if p.is_file() else ""
        except Exception:
            return ""
    profile_md = _read(brain / "profile.md")
    memories_md = _read(brain / "memories" / "AGENTS.md")
    skills_dir = brain / "skills"
    try:
        skills_list = list_available_skills(skills_dir) if skills_dir.is_dir() else []
    except Exception:
        skills_list = []
    journal_entries: list[dict] = []
    jdir = brain / "journal"
    if jdir.is_dir():
        for fp in sorted(jdir.glob("*.jsonl")):
            try:
                for line in fp.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = _json.loads(line)
                    except ValueError:
                        continue
                    journal_entries.append({
                        "ts": e.get("ts", ""),
                        "task_name": e.get("task_name", ""),
                        "status": e.get("status", ""),
                        "duration_ms": e.get("duration_ms"),
                    })
            except OSError:
                continue
    journal_entries = journal_entries[-30:]  # 最近 30 条
    return {
        "profile_md": profile_md,
        "skills_list": skills_list,
        "memories_md": memories_md,
        "journal_entries": journal_entries,
    }
```

schema(`schemas/employee.py` 加，仿现有 EmployeeRead 风格)：
```python
class EmployeeGrowthJournalEntry(BaseModel):
    ts: str
    task_name: str
    status: str
    duration_ms: int | None = None


class EmployeeGrowthBrainRead(BaseModel):
    profile_md: str
    skills_list: list[str]
    memories_md: str
    journal_entries: list[EmployeeGrowthJournalEntry]
```

- [ ] **Step 4: 跑测试通过** `cd apps/server && uv run pytest tests/test_employee_growth_brain.py -v`
- [ ] **Step 5: 提交** `git commit -m "feat(growth): build_employee_growth_brain 聚合员工大脑只读数据 + schema"`

---

## Task 2（后端）：GET /employees/{id}/growth/brain 端点

**Files:** Modify `api/employee_api.py`；Test `tests/test_employee_growth_brain.py`

- [ ] **Step 1: 写失败测试**（service 已测，端点轻量；优先用项目现有 TestClient/路由测试惯例——先读 conftest 看有无 client fixture/现有 api 测试样板，照搬。若无 client，测"路由函数直调返回 ResponseBase"亦可）

```python
def test_growth_brain_endpoint(db_session, workspace, monkeypatch, tmp_path):
    from src.service import employee_service as es
    from src.api import employee_api
    emp = add_employee(db_session, workspace.id, name="林晓")
    monkeypatch.setattr(es, "_growth_brain_root_for", lambda eid: tmp_path / str(emp.id))
    _seed_brain(tmp_path / str(emp.id))
    # 直调路由函数（避开 TestClient 依赖装配复杂度）
    resp = employee_api.get_employee_growth_brain(emp.id, db=db_session)
    assert resp.data.profile_md and "调研" in resp.data.profile_md
    assert "my-skill" in resp.data.skills_list
```

> 以实际 employee_api 的依赖签名为准(get_db Depends 等)；直调时 db= 显式传 db_session。若现有 api 测试都走 TestClient，则照那个写。

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**（先读 employee_api.py 现有端点签名/router 前缀，照搬模式）

```python
@router.get("/employees/{employee_id}/growth/brain",
            response_model=ResponseBase[EmployeeGrowthBrainRead])
def get_employee_growth_brain(employee_id: int, db: Session = Depends(get_db)):
    """只读：员工成长大脑(profile/技能/记忆/journal)。"""
    brain = EmployeeService.build_employee_growth_brain(db, employee_id)
    return ResponseBase(data=brain)
```
（import EmployeeGrowthBrainRead；ResponseBase/Depends/get_db 复用现有 import。router 前缀按现有端点判断——`/employees/{id}` 已存在同前缀。）

- [ ] **Step 4: 跑测试 + 回归** `cd apps/server && uv run pytest tests/test_employee_growth_brain.py -v`；`cd apps/server && uv run pytest tests/ -k "employee"`（无新增回归）
- [ ] **Step 5: 提交** `git commit -m "feat(growth): GET /employees/{id}/growth/brain 只读端点"`

---

## ⚙️ 前端任务前置（控制器执行，非 subagent）：worktree 装依赖
执行前端任务前，控制器在 worktree 跑 `pnpm install`（一次），使前端可 typecheck/vitest。

---

## Task 3（前端）：api 函数 + 类型 + hook

**Files:** Modify `apps/web/src/api/employee.ts`(+fn+type)、新建/改 hook 文件

- [ ] **Step 1**（前端项目无强制 TDD 红灯惯例时，可先写 hook+api 再 typecheck/补测）：
  - `api/employee.ts` 加：
    ```typescript
    export interface EmployeeGrowthBrain {
      profile_md: string
      skills_list: string[]
      memories_md: string
      journal_entries: Array<{ ts: string; task_name: string; status: string; duration_ms: number | null }>
    }
    export async function fetchEmployeeGrowthBrain(employeeId: number | string, opts?: { signal?: AbortSignal }) {
      return request<ApiResponse<EmployeeGrowthBrain>>(`/employees/${employeeId}/growth/brain`,
        opts?.signal ? { signal: opts.signal } : {})
    }
    ```
    （request/ApiResponse import 仿文件现有。）
  - hook（加到 `hooks/use-schedule-monitor-queries.ts` 或新建 `hooks/use-employee-growth.ts`）：
    ```typescript
    export function useEmployeeGrowthBrain(employeeId: string | number | null) {
      return useQuery({
        queryKey: ["employee-growth-brain", employeeId],
        queryFn: async ({ signal }) => (await fetchEmployeeGrowthBrain(employeeId!, { signal })).data,
        enabled: Boolean(employeeId),
        staleTime: 60_000,
      })
    }
    ```
- [ ] **Step 2: typecheck** `pnpm --filter <web> typecheck`（web 包无新错）
- [ ] **Step 3: 提交** `git commit -m "feat(growth): 前端 fetchEmployeeGrowthBrain + useEmployeeGrowthBrain"`

---

## Task 4（前端）：GrowthBrainSection 组件

**Files:** 新建 `apps/web/src/components/chat/contacts/growth-brain-section.tsx`

- [ ] **Step 1: 实现**（卡片分区展示 profile/技能/记忆/journal，复用 Card/Badge/MessageResponse；loading/empty 处理）。参考勘探报告 E 节范例。markdown 用 `MessageResponse` from `@workspace/ui/components/ai-elements/message`。
- [ ] **Step 2: typecheck** `pnpm --filter <web> typecheck`
- [ ] **Step 3: 提交** `git commit -m "feat(growth): GrowthBrainSection 只读履历组件"`

---

## Task 5（前端）：接进 contact-detail-panel

**Files:** Modify `apps/web/src/components/chat/contacts/contact-detail-panel.tsx`

- [ ] **Step 1: 实现**：Tabs 加第三个 `growth`「成长履历」(默认或排在 tasks 前/后，体感定)，TabsContent 渲 `<GrowthBrainSection employeeId={selectedContact.employee?.id} />`。仅 employee 类型联系人显示(curator/group 不显示或显示空)。不动 edit/tasks tab。
- [ ] **Step 2: typecheck** `pnpm --filter <web> typecheck`
- [ ] **Step 3: 提交** `git commit -m "feat(growth): contact-detail-panel 接入成长履历 tab"`

---

## 收尾验证
- [ ] 后端全量：`cd apps/server && uv run pytest tests/ -q`，仅预存基线、零新增回归。
- [ ] 前端 typecheck：web 包无新增类型错误（packages/ui 预存 toReversed 错忽略）。
- [ ] 手测桩：员工详情面板「成长履历」tab → 见 profile 画像/技能/记忆/journal；新人(无积累)显示空态不报错。

## 开放问题
- O1 journal 展示条数：v1 最近 30。
- O2 历史产物(artifacts)展示：v1 先不做(资源面板已有产物视图)；后续按需在履历加"历史产物"。
- O3 curator/group 联系人是否显示成长履历：v1 仅 employee；curator 也可后续加。
</content>
