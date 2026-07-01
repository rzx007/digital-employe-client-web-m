# 总管对话支持 Slash Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让总管（curator）主对话的斜杠菜单并存两类命令——总管固定技能（后端列表）与一组前端快捷指令模板——复用现有共享的 Lexical 输入框链路。

**Architecture:** 后端新增一个只读接口列出 `orchestrator_skills/` 固定技能，并放开 stream 接口对 curator 的 `skill` 注入；前端把「技能（走 skill 参数）」与「快捷指令（走前端 prompt 模板注入正文）」两组合并喂给已有的 slash-command 插件，靠 `SlashCommandItem.kind` 区分行为与菜单分组。

**Tech Stack:** Python FastAPI + SQLAlchemy（apps/server，pytest/uv）；React 19 + TanStack Query + Lexical（apps/web，vitest）。

**Spec:** [docs/superpowers/specs/2026-06-22-orchestrator-slash-commands-design.md](../specs/2026-06-22-orchestrator-slash-commands-design.md)

---

## File Structure

**后端（apps/server）**
- 新建 `src/service/orchestrator_skill_catalog.py` — 列出 `orchestrator_skills/` 的 `{name, description}`。
- 修改 `src/service/chat_service.py` — 抽出纯函数 `build_skill_question`，替换内联条件（去掉 curator 排除）。
- 修改 `src/schemas/conversation.py` — 新增 `OrchestratorSkillRead`。
- 修改 `src/api/chat_api.py` — 新增 `GET /chat/orchestrator/skills`。
- 新建测试 `tests/test_skill_question_injection.py`、`tests/test_orchestrator_skill_catalog.py`。

**前端（apps/web）**
- 修改 `src/components/lexical-editor/slash-command-plugin.tsx` — `SlashCommandItem`/`SlashCommandOption` 加 `kind`/`prompt`；菜单按 kind 分组。
- 新建 `src/api/orchestrator.ts` — `fetchOrchestratorSkills`。
- 新建 `src/components/chat/curator/curator-slash-commands.tsx` — 快捷指令常量 + 合并/发送两个纯函数。
- 修改 `src/components/chat/curator/curator-view.tsx` — 拉技能、合并命令、发送分支。
- 新建测试 `src/components/chat/curator/curator-slash-commands.test.tsx`。

**任务顺序**：先后端（1→2），后前端（3→4→5→6）。后端两任务互相独立，前端 3/4 独立、5 依赖 3+4。

---

## Task 1: 后端 — skill 注入纯函数 + 放开 curator

**Files:**
- Modify: `apps/server/src/service/chat_service.py`（内联条件在 `765-768` 行附近）
- Test: `apps/server/tests/test_skill_question_injection.py`

- [ ] **Step 1: 写失败测试**

创建 `apps/server/tests/test_skill_question_injection.py`：

```python
from src.service.chat_service import build_skill_question


def test_no_skill_returns_question_unchanged():
    assert build_skill_question("", "今天几号") == "今天几号"
    assert build_skill_question(None, "今天几号") == "今天几号"


def test_with_skill_prefixes_question():
    # 不再区分 curator/employee：只要给了技能名就注入
    assert (
        build_skill_question("find-skills", "帮我找个技能")
        == "请使用find-skills技能回答这个问题：帮我找个技能"
    )
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_skill_question_injection.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_skill_question'`

- [ ] **Step 3: 实现纯函数并接入**

在 `apps/server/src/service/chat_service.py` 顶部（模块级，类定义之前的工具区）新增：

```python
def build_skill_question(skill_name: str | None, question: str) -> str:
    """显式指定技能时给问题加「请使用X技能…」前缀；无技能则原样返回。

    与员工对齐：curator 也注入（总管 agent 已把 orchestrator_skills 加载为可用技能）。
    """
    if skill_name:
        return f"请使用{skill_name}技能回答这个问题：{question}"
    return question
```

把 `765-768` 行的内联条件：

```python
            skill_question = question
            if skill_name and target_type != "curator":
                skill_question = f"请使用{skill_name}技能回答这个问题：{question}"
```

替换为：

```python
            skill_question = build_skill_question(skill_name, question)
```

> 注意：紧随其后的「员工技能预路由软提示」分支（`target_type == "employee" and ... and not skill_name`）保持不变——curator 不参与自动预路由，只在显式选技能时注入。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_skill_question_injection.py -v`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/service/chat_service.py apps/server/tests/test_skill_question_injection.py
git commit -m "feat(orchestrator): 放开 curator 的 skill 注入 + 抽 build_skill_question 纯函数"
```

---

## Task 2: 后端 — 总管技能目录列表接口

**Files:**
- Create: `apps/server/src/service/orchestrator_skill_catalog.py`
- Modify: `apps/server/src/schemas/conversation.py`（追加 schema）
- Modify: `apps/server/src/api/chat_api.py`（追加路由 + import）
- Test: `apps/server/tests/test_orchestrator_skill_catalog.py`

- [ ] **Step 1: 写失败测试**

创建 `apps/server/tests/test_orchestrator_skill_catalog.py`：

```python
def test_empty_dir_returns_empty(tmp_path):
    from src.service.orchestrator_skill_catalog import list_orchestrator_skills

    assert list_orchestrator_skills(tmp_path) == []


def test_reads_name_and_description(tmp_path):
    from src.service.orchestrator_skill_catalog import list_orchestrator_skills

    alpha = tmp_path / "alpha"
    alpha.mkdir()
    (alpha / "SKILL.md").write_text(
        "---\nname: alpha\ndescription: 阿尔法技能\n---\n正文\n", encoding="utf-8"
    )
    # 无 frontmatter → 描述降级为空串
    beta = tmp_path / "beta"
    beta.mkdir()
    (beta / "SKILL.md").write_text("没有 frontmatter 的正文\n", encoding="utf-8")
    # 没有 SKILL.md 的目录被忽略
    (tmp_path / "not-a-skill").mkdir()

    out = {d["name"]: d["description"] for d in list_orchestrator_skills(tmp_path)}
    assert out == {"alpha": "阿尔法技能", "beta": ""}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_skill_catalog.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.service.orchestrator_skill_catalog'`

- [ ] **Step 3: 实现 catalog 模块**

创建 `apps/server/src/service/orchestrator_skill_catalog.py`：

```python
from __future__ import annotations

from pathlib import Path

from src.service.agent.paths import (
    list_available_skills,
    resolve_orchestrator_skills_root,
)
from src.service.local_skill_service import LocalSkillService


def list_orchestrator_skills(skills_root: Path | None = None) -> list[dict]:
    """列出总管固定技能目录（orchestrator_skills/）的 name + description。

    仅含有 SKILL.md 的子目录入选（list_available_skills 已过滤）。
    描述读 SKILL.md frontmatter，解析失败降级为空串。
    """
    root = skills_root or resolve_orchestrator_skills_root()
    items: list[dict] = []
    for name in list_available_skills(root):
        skill_md = root / name / "SKILL.md"
        try:
            description = LocalSkillService._extract_description_from_skill_md(skill_md)
        except Exception:  # noqa: BLE001 - 单个技能解析失败不致命
            description = ""
        items.append({"name": name, "description": description or ""})
    return items
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_skill_catalog.py -v`
Expected: PASS（2 passed）

- [ ] **Step 5: 加 schema**

在 `apps/server/src/schemas/conversation.py` 末尾追加（与文件内其它 `BaseModel` 风格一致）：

```python
class OrchestratorSkillRead(BaseModel):
    """总管固定技能（供主对话斜杠菜单）。"""

    name: str
    description: str = ""
```

> 若该文件未导入 `BaseModel`，复用文件顶部既有的 `from pydantic import BaseModel`（已存在，`StreamConversationRequest` 等都用它）。

- [ ] **Step 6: 加路由**

在 `apps/server/src/api/chat_api.py` 的 import 区追加：

```python
from src.schemas.conversation import OrchestratorSkillRead  # 并入既有 conversation import 块
from src.service.orchestrator_skill_catalog import list_orchestrator_skills
```

在 `router = APIRouter(...)` 之后、其它 `@router.get` 旁新增端点：

```python
@router.get(
    "/chat/orchestrator/skills",
    response_model=ListResponse[OrchestratorSkillRead],
)
def list_orchestrator_skills_endpoint() -> ListResponse[OrchestratorSkillRead]:
    """列出总管固定技能（orchestrator_skills/），供主对话斜杠菜单使用。"""
    items = list_orchestrator_skills()
    return ListResponse(data=[OrchestratorSkillRead(**it) for it in items])
```

> `ListResponse` 在该文件已从 `src.models.response` 导入（见 `list_conversations`）。该接口工作区无关（固定目录），无需 workspace/auth 参数。

- [ ] **Step 7: 跑后端全量确认无回归**

Run: `cd apps/server && uv run pytest tests/test_orchestrator_skill_catalog.py tests/test_skill_question_injection.py -v`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add apps/server/src/service/orchestrator_skill_catalog.py apps/server/src/schemas/conversation.py apps/server/src/api/chat_api.py apps/server/tests/test_orchestrator_skill_catalog.py
git commit -m "feat(orchestrator): 新增 GET /chat/orchestrator/skills 列出总管固定技能"
```

---

## Task 3: 前端 — SlashCommandItem 加 kind/prompt + 菜单分组

**Files:**
- Modify: `apps/web/src/components/lexical-editor/slash-command-plugin.tsx`

> 本任务为渲染/类型改动，校验靠 `pnpm typecheck` + 后续手动冒烟；纯逻辑（合并/发送）在 Task 4 单测。

- [ ] **Step 1: 扩展 `SlashCommandItem` 接口**

`apps/web/src/components/lexical-editor/slash-command-plugin.tsx:25-31`，加两个可选字段（向后兼容——员工不传即旧行为）：

```ts
export interface SlashCommandItem {
  id: string
  title: string
  icon: React.ReactElement
  description: string
  keywords: string[]
  kind?: "skill" | "shortcut" // 默认按 skill 处理
  prompt?: string // 仅 shortcut：选中后注入正文的模板
}
```

- [ ] **Step 2: `SlashCommandOption` 透传 kind/prompt**

同文件 `33-50` 行的类，加字段并在构造器复制：

```ts
class SlashCommandOption extends MenuOption {
  id: string
  title: string
  icon: React.ReactElement
  description: string
  keywords: Array<string>
  kind?: "skill" | "shortcut"
  prompt?: string
  onSelect: (queryString: string) => void

  constructor(item: SlashCommandItem, onSelect: (queryString: string) => void) {
    super(item.title)
    this.id = item.id
    this.title = item.title
    this.icon = item.icon
    this.description = item.description
    this.keywords = item.keywords
    this.kind = item.kind
    this.prompt = item.prompt
    this.onSelect = onSelect.bind(this)
  }
}
```

- [ ] **Step 3: `FloatingMenu` 按 kind 分组**

把 `FloatingMenu` 里 `<Command><CommandList>…</CommandList></Command>`（`102-138` 行）中**单个** `<CommandGroup heading="技能">` 替换为「快捷指令组（若有）+ 技能组」两组，渲染时保留原始 flat 索引以维持键盘高亮/选择：

```tsx
      <Command>
        <CommandList>
          {(() => {
            const indexed = options.map((option, i) => ({ option, i }))
            const shortcuts = indexed.filter((x) => x.option.kind === "shortcut")
            const skills = indexed.filter((x) => x.option.kind !== "shortcut")
            const renderItem = (option: SlashCommandOption, i: number) => (
              <CommandItem
                key={option.key}
                onSelect={() => {
                  setHighlightedIndex(i)
                  selectOptionAndCleanUp(option)
                }}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-sm p-2 hover:bg-accent hover:text-accent-foreground",
                  selectedIndex === i && "bg-accent text-accent-foreground"
                )}
                onMouseEnter={() => {
                  setHighlightedIndex(i)
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                }}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                  {option.icon}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm leading-none font-medium">
                    {option.title}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </div>
              </CommandItem>
            )
            return (
              <>
                {shortcuts.length > 0 && (
                  <CommandGroup heading="快捷指令">
                    {shortcuts.map(({ option, i }) => renderItem(option, i))}
                  </CommandGroup>
                )}
                {skills.length > 0 && (
                  <CommandGroup heading="技能">
                    {skills.map(({ option, i }) => renderItem(option, i))}
                  </CommandGroup>
                )}
              </>
            )
          })()}
        </CommandList>
      </Command>
```

> 约定：调用方保证 `commands` 数组顺序为「快捷指令在前、技能在后」（见 Task 4 `buildCuratorSlashCommands`），从而渲染顺序 = flat 索引顺序，键盘上下选与 `selectedIndex` 对齐。员工对话无 shortcut → 只渲染「技能」组，与改动前完全一致（heading 仍为「技能」）。

- [ ] **Step 4: 类型检查**

Run: `pnpm typecheck`
Expected: 通过（无新增类型错误）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/lexical-editor/slash-command-plugin.tsx
git commit -m "feat(slash): SlashCommandItem 加 kind/prompt + 菜单按 kind 分组(快捷指令/技能)"
```

---

## Task 4: 前端 — 总管技能 API + 命令合并/发送纯函数（含单测）

**Files:**
- Create: `apps/web/src/api/orchestrator.ts`
- Create: `apps/web/src/components/chat/curator/curator-slash-commands.tsx`
- Test: `apps/web/src/components/chat/curator/curator-slash-commands.test.tsx`

- [ ] **Step 1: 新增 API 客户端**

创建 `apps/web/src/api/orchestrator.ts`：

```ts
import { request } from "@/lib/request"
import type { ApiResponse } from "./types"

export interface OrchestratorSkill {
  name: string
  description: string
}

export async function fetchOrchestratorSkills(): Promise<OrchestratorSkill[]> {
  const res = await request<ApiResponse<OrchestratorSkill[]>>(
    "/chat/orchestrator/skills"
  )
  return Array.isArray(res?.data) ? res.data : []
}
```

- [ ] **Step 2: 写失败测试**

创建 `apps/web/src/components/chat/curator/curator-slash-commands.test.tsx`：

```tsx
import { describe, expect, it } from "vitest"
import {
  CURATOR_SHORTCUTS,
  buildCuratorSlashCommands,
  resolveCuratorSend,
} from "./curator-slash-commands"

describe("buildCuratorSlashCommands", () => {
  it("快捷指令在前、技能在后", () => {
    const out = buildCuratorSlashCommands([
      { name: "find-skills", description: "找技能" },
    ])
    const head = out.slice(0, CURATOR_SHORTCUTS.length)
    expect(head.every((c) => c.kind === "shortcut")).toBe(true)
    expect(out[out.length - 1]).toMatchObject({
      kind: "skill",
      title: "find-skills",
    })
  })

  it("技能为空时只剩快捷指令", () => {
    expect(buildCuratorSlashCommands([])).toHaveLength(CURATOR_SHORTCUTS.length)
  })
})

describe("resolveCuratorSend", () => {
  it("快捷指令：模板进正文、skill 为空", () => {
    const sc = CURATOR_SHORTCUTS[0]
    expect(resolveCuratorSend(sc, "")).toEqual({ text: sc.prompt, skill: "" })
    expect(resolveCuratorSend(sc, "补充")).toEqual({
      text: `${sc.prompt}\n补充`,
      skill: "",
    })
  })

  it("技能：skill 取 title、正文不变", () => {
    const item = buildCuratorSlashCommands([
      { name: "find-skills", description: "" },
    ]).find((c) => c.kind === "skill")!
    expect(resolveCuratorSend(item, "帮我找")).toEqual({
      text: "帮我找",
      skill: "find-skills",
    })
  })

  it("无命令：原样透传", () => {
    expect(resolveCuratorSend(undefined, "你好")).toEqual({
      text: "你好",
      skill: "",
    })
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm --filter web test:unit src/components/chat/curator/curator-slash-commands.test.tsx`
Expected: FAIL — 模块不存在

- [ ] **Step 4: 实现常量 + 两个纯函数**

创建 `apps/web/src/components/chat/curator/curator-slash-commands.tsx`：

```tsx
import * as React from "react"
import { IconBolt, IconSparkles } from "@tabler/icons-react"

import type { OrchestratorSkill } from "@/api/orchestrator"
import type { SlashCommandItem } from "@/components/lexical-editor/slash-command-plugin"

/** 总管专属快捷指令（纯前端 prompt 模板）。最终 7 条。 */
export const CURATOR_SHORTCUTS: SlashCommandItem[] = [
  {
    id: "shortcut:progress",
    title: "查看进度",
    kind: "shortcut",
    prompt: "请汇报当前所有进行中编排计划的进度，逐项列出各子任务状态。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "汇报进行中计划与各子任务状态",
    keywords: ["进度", "progress", "jindu"],
  },
  {
    id: "shortcut:deliverables",
    title: "汇总交付物",
    kind: "shortcut",
    prompt: "请汇总当前计划已产出的全部交付物，列出文件清单与所在位置。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "列出已产出交付物与位置",
    keywords: ["交付物", "deliverable", "jiaofu"],
  },
  {
    id: "shortcut:retro",
    title: "团队复盘",
    kind: "shortcut",
    prompt:
      "请基于近期已完成的任务，复盘团队整体表现，指出做得好的与可改进的点。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "复盘团队近期表现",
    keywords: ["复盘", "retro", "fupan"],
  },
  {
    id: "shortcut:roster",
    title: "团队与能力",
    kind: "shortcut",
    prompt: "请列出当前团队成员及各自能力画像，帮我判断谁适合接下来的任务。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "查看团队名册与能力画像",
    keywords: ["名册", "团队", "roster", "mingce"],
  },
  {
    id: "shortcut:qa",
    title: "质检返工",
    kind: "shortcut",
    prompt: "请对最近完成的子任务交付物做一次质检，对不达标的安排返工。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "质检交付物并安排返工",
    keywords: ["质检", "返工", "qa", "zhijian"],
  },
  {
    id: "shortcut:gap",
    title: "缺口诊断",
    kind: "shortcut",
    prompt:
      "评估接下来的任务是否缺人或缺技能，需要就建议招人或去技能市场装技能。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "诊断人手/技能缺口并给建议",
    keywords: ["缺口", "招人", "gap", "quekou"],
  },
  {
    id: "shortcut:cancel",
    title: "取消计划",
    kind: "shortcut",
    prompt: "请取消当前进行中的编排计划。",
    icon: <IconBolt className="h-4 w-4" />,
    description: "取消进行中的编排计划",
    keywords: ["取消", "cancel", "quxiao"],
  },
]

/** 合并：快捷指令在前、总管技能在后（顺序契约见 slash-command-plugin 分组渲染）。 */
export function buildCuratorSlashCommands(
  skills: OrchestratorSkill[]
): SlashCommandItem[] {
  const skillItems: SlashCommandItem[] = skills.map((s) => ({
    id: `skill:${s.name}`,
    title: s.name,
    kind: "skill",
    icon: <IconSparkles className="h-4 w-4" />,
    description: s.description ?? "",
    keywords: [s.name.toLowerCase()],
  }))
  return [...CURATOR_SHORTCUTS, ...skillItems]
}

/** 按命令类型决定外发正文与 skill 参数。 */
export function resolveCuratorSend(
  item: SlashCommandItem | undefined,
  baseText: string
): { text: string; skill: string } {
  if (item?.kind === "shortcut") {
    return {
      text: [item.prompt, baseText].filter(Boolean).join("\n"),
      skill: "",
    }
  }
  if (item) {
    // 技能：沿用后端 skill 注入链路
    return { text: baseText, skill: item.title }
  }
  return { text: baseText, skill: "" }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm --filter web test:unit src/components/chat/curator/curator-slash-commands.test.tsx`
Expected: PASS（全部通过）

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/api/orchestrator.ts apps/web/src/components/chat/curator/curator-slash-commands.tsx apps/web/src/components/chat/curator/curator-slash-commands.test.tsx
git commit -m "feat(curator): 总管技能 API + 快捷指令常量 + 合并/发送纯函数(含单测)"
```

---

## Task 5: 前端 — 接进 curator-view（拉技能、喂菜单、发送分支）

**Files:**
- Modify: `apps/web/src/components/chat/curator/curator-view.tsx`

> 渲染/集成改动，靠 `pnpm typecheck` + 手动冒烟校验。

- [ ] **Step 1: 加 imports**

`apps/web/src/components/chat/curator/curator-view.tsx` 用**具名导入**（文件无 `import * as React`，hooks 形如 `useMemo`/`useQueryClient`）。把 `useQuery` 并入既有的 `@tanstack/react-query` import 行（当前只导了 `useQueryClient`），并确保 `useMemo` 在 `react` 的具名 import 里；再追加两行业务 import：

```ts
// 既有行：import { useQueryClient } from "@tanstack/react-query" → 改为：
import { useQuery, useQueryClient } from "@tanstack/react-query"
// 确认 react 具名 import 含 useMemo（如已有则不动）
import { fetchOrchestratorSkills } from "@/api/orchestrator"
import {
  buildCuratorSlashCommands,
  resolveCuratorSend,
} from "./curator-slash-commands"
```

- [ ] **Step 2: 拉技能 + 合并命令（memo）**

在组件内（靠近其它 `useMemo`/`useQuery`，且在 `doSend` 定义之前）新增：

```ts
  const { data: orchestratorSkills } = useQuery({
    queryKey: ["orchestrator-skills"],
    queryFn: fetchOrchestratorSkills,
    staleTime: 5 * 60 * 1000,
  })
  const curatorSlashCommands = useMemo(
    () => buildCuratorSlashCommands(orchestratorSkills ?? []),
    [orchestratorSkills]
  )
```

> 用具名 `useMemo`（**不要**写 `React.useMemo`——本文件无 React 命名空间导入）。

- [ ] **Step 3: 发送分支 + 空值守卫前移**

在 `doSend`（`524` 行起）里，把当前的早退守卫与发送体改造为「先算外发正文再守卫」。

现状（`526-528` 行）：

```ts
      const messageText =
        (typeof message === "string" ? message : message.text)?.trim() ?? ""
      if (!messageText || !curatorConversationId) return
```

改为（保留 `messageText` 供标题逻辑复用，新增 outbound 计算并据其守卫——快捷指令可能无补充文字、`messageText` 为空也要放行）：

```ts
      const messageText =
        (typeof message === "string" ? message : message.text)?.trim() ?? ""
      const selectedCommandItem = command
        ? curatorSlashCommands.find((c) => c.id === command.id)
        : undefined
      const { text: outboundText, skill: skillParam } = resolveCuratorSend(
        selectedCommandItem,
        messageText
      )
      if (!outboundText || !curatorConversationId) return
```

把发送体（`565-574` 行）改为用 `outboundText` / `skillParam`：

```ts
        await sendMessage(
          { text: outboundText, metadata: pendingMeta },
          {
            body: {
              conversationId: curatorConversationId,
              skill: skillParam,
              metadata: pendingMeta,
            },
          }
        )
```

> `pendingMeta.command`（`552-557` 行）保持不变，仍记录 `{id,title}`。标题逻辑继续用 `messageText`（空则不触发重命名，符合预期）。

- [ ] **Step 4: doSend 依赖补 `curatorSlashCommands`**

`doSend` 的依赖数组（`607-618` 行）追加 `curatorSlashCommands`：

```ts
    [
      curatorConversationId,
      sendMessage,
      command,
      mentions,
      session,
      conversationTitle,
      displayMessages.length,
      curatorContactId,
      contact,
      updateTitleMutation,
      curatorSlashCommands,
    ]
```

- [ ] **Step 5: 把空数组换成真实命令**

`951` 行 `slashCommands={[]}` → `slashCommands={curatorSlashCommands}`。

- [ ] **Step 6: 类型检查**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/chat/curator/curator-view.tsx
git commit -m "feat(curator): 主对话接入斜杠命令(拉技能+合并菜单+发送分支)"
```

---

## Task 6: 全量校验 + 手动冒烟 + 收尾

**Files:** 无（仅校验）

- [ ] **Step 1: 后端相关测试**

Run: `cd apps/server && uv run pytest tests/test_skill_question_injection.py tests/test_orchestrator_skill_catalog.py tests/test_curator_conv_and_auth_userlevel.py -v`
Expected: 全部 PASS

- [ ] **Step 2: 前端单测 + 类型 + lint**

Run: `pnpm --filter web test:unit src/components/chat/curator/curator-slash-commands.test.tsx && pnpm typecheck && pnpm lint --filter=web`
Expected: 全部通过

- [ ] **Step 3: 手动冒烟（REQUIRED SUB-SKILL: 用 verify / run 技能起应用）**

启动 web（`pnpm dev`）或桌面（`pnpm --filter web dev:app`）+ 后端（`pnpm dev:server`），在总管主对话验证：
- 输入 `/` → 弹出菜单，含「快捷指令」组（7 条）与「技能」组（若 `orchestrator_skills/` 非空）。
- 选「查看进度」直接回车（不补字）→ 能发出，总管收到模板正文并汇报进度（验证空文本守卫已前移）。
- 选某技能 + 补一句问题 → 发送，后端日志/回复体现「请使用X技能…」注入。
- 键盘上下键高亮跨两组连续正确。
- 切到某员工对话，`/` 菜单仍只有「技能」组、行为不变（无回归）。

- [ ] **Step 4: 终态完成处理**

跑完冒烟后，按 superpowers:finishing-a-development-branch 决定合并/PR/清理。

---

## 回归边界与不变量

- 员工对话：`SlashCommandItem` 新字段均可选、不传即旧行为；`build_skill_question` 对 employee 行为等价（原本就满足 `target_type != "curator"`）；FloatingMenu 无 shortcut 时只渲染「技能」组，heading 不变。
- 不触碰确认门 / DAG 调度 / 学习闭环（架构文档 §7 不变量）。
- 唯一对话面：快捷指令仍是用户→总管的对话输入，由总管内部用现有工具实现，不暴露内部机制。
