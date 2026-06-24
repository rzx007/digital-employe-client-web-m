# 工作台助手 + 资源池 — 前端实现计划（Plan 2 / 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台页面：①右侧对话面板从「固定总管」升级为「工作台成员切换器」（N 选一，总管不在）；②新增独立「资源池」面板（区别于现有 ArtifactPanel）+ 上传 + 拖入网格钉看板；③workbench-config 加 `members` 持久化；④主聊天派单后工作台右上角弹 toast 引导切到目标员工。

**Architecture:** 复用现有 `addHtmlArtifactBlock` 钉看板链路（[artifact-panel.tsx:349](../../../apps/web/src/components/artifact/artifact-panel.tsx#L349) 的 `pinHtmlToWorkbench`）；切换器复用 `CuratorView`（员工对话同样能用它，它接受任意 `contact`）；资源池走 Plan 1 的 `/workbench-resources/*` API。`members` 存进现有 `workbench-config-global` localStorage 桶。

**Tech Stack:** React 19 / TanStack Query / TanStack Router / Zustand / Tailwind v4 / shadcn-ui。

---

## 关键前置事实（实现者必读）

- **依赖 Plan 1 已合入**（`/workbench-resources/*` API、工作台助手种子员工存在）。
- **现有 `resources` 面板 ≠ 资源池**：[workbench-content-split.tsx:378-399](../../../apps/web/src/components/workbench/workbench-content-split.tsx#L378) 的 `resources` 面板挂的是 `ArtifactPanel`（当前会话文件浏览器）。**资源池是新概念**，不要改 ArtifactPanel；新增一个独立面板/入口（见 Task 4 决策）。
- **钉看板链路**（资源池拖入网格要复用）：[artifact-panel.tsx:349-359](../../../apps/web/src/components/artifact/artifact-panel.tsx#L349)：
  ```ts
  const config = loadWorkbenchConfig(GLOBAL_WORKBENCH_ID) ?? initializeWorkbenchConfig(GLOBAL_WORKBENCH_ID)
  addHtmlArtifactBlock(config, { conversationId, resourcePath: path, pinnedAt: Date.now() }, title)
  emitWorkbenchConfigChanged()
  ```
- **CuratorView 接受任意 contact**：[curator-view.tsx:247-281](../../../apps/web/src/components/chat/curator/curator-view.tsx#L247) 签名收 `contact?: ChatViewContact` + `conversationId`。切到员工时传员工 contact 即可复用——不需要单独的 EmployeeView。
- **workbench-config**：[workbench-config.ts](../../../apps/web/src/lib/workbench/workbench-config.ts)，桶 key `workbench-config-global`（[L15 GLOBAL_WORKBENCH_ID](../../../apps/web/src/lib/workbench/workbench-config.ts#L15)）。`WorkbenchConfig` 在 [types/workbench.ts](../../../apps/web/src/types/workbench.ts)。
- **运行检查**：`pnpm typecheck --filter=web`、`pnpm lint --filter=web`、前端单测 `pnpm --filter web test <file>`（先确认仓库前端测试命令：`grep -n '"test"' apps/web/package.json`）。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/web/src/types/workbench.ts` | `WorkbenchConfig` 加 `members` | 改 |
| `apps/web/src/lib/workbench/workbench-config.ts` | 读写/校验/默认 `members` + `setMembers` | 改 |
| `apps/web/src/api/workbench-resources.ts` | 资源池 API client | 新增 |
| `apps/web/src/hooks/use-workbench-resources.ts` | 资源池 Query hooks | 新增 |
| `apps/web/src/components/workbench/workbench-resource-pool.tsx` | 资源池面板（列表/上传/拖拽源） | 新增 |
| `apps/web/src/components/workbench/workbench-chat-switcher.tsx` | 成员切换器（含邀请入口） | 新增 |
| `apps/web/src/components/workbench/workbench-invite-member-dialog.tsx` | 邀请员工弹窗 | 新增 |
| `apps/web/src/lib/workbench/pin-html-to-workbench.ts` | 抽出复用的钉看板函数 | 新增（抽取） |
| `apps/web/src/components/artifact/artifact-panel.tsx` | 改用抽出的钉函数（去重） | 改 |
| `apps/web/src/components/workbench/workbench-content-split.tsx` | 接入切换器 + 资源池面板 + toast | 改 |

---

## Task 1: workbench-config 加 `members` 字段

**Files:**
- Modify: `apps/web/src/types/workbench.ts`
- Modify: `apps/web/src/lib/workbench/workbench-config.ts`
- Test: `apps/web/src/lib/workbench/workbench-config.test.ts`（已存在，追加用例）

- [ ] **Step 1: 写失败测试**

在 [workbench-config.test.ts](../../../apps/web/src/lib/workbench/workbench-config.test.ts) 追加：

```ts
import { getMembers, setMembers } from "./workbench-config"

describe("workbench members", () => {
  beforeEach(() => localStorage.clear())

  it("缺省 members 读为空数组", () => {
    expect(getMembers("global")).toEqual([])
  })

  it("setMembers 写入后可读出", () => {
    setMembers("global", [3, 7])
    expect(getMembers("global")).toEqual([3, 7])
  })

  it("旧 config（无 members）loadWorkbenchConfig 仍合法、members 默认 []", () => {
    // 写一份没有 members 的合法 config
    localStorage.setItem(
      "workbench-config-global",
      JSON.stringify({ employeeId: "global", blocks: [], lastModified: 1 }),
    )
    expect(getMembers("global")).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web test workbench-config`
Expected: FAIL — `getMembers is not exported`

- [ ] **Step 3: 加字段 + 读写函数**

在 [types/workbench.ts](../../../apps/web/src/types/workbench.ts) 的 `WorkbenchConfig` 接口加：

```ts
export interface WorkbenchConfig {
  employeeId: string
  blocks: WorkbenchBlock[]
  lastModified: number
  /** 被邀请进工作台的员工 id（切换器据此列出）。缺省视为 []。 */
  members?: number[]
}
```

在 [workbench-config.ts](../../../apps/web/src/lib/workbench/workbench-config.ts) 加（`isValidConfig` 不强制 members，缺省即可）：

```ts
export function getMembers(employeeId: string): number[] {
  const cfg = loadWorkbenchConfig(employeeId)
  return Array.isArray(cfg?.members) ? cfg!.members : []
}

export function setMembers(employeeId: string, members: number[]): void {
  const cfg =
    loadWorkbenchConfig(employeeId) ?? initializeWorkbenchConfig(employeeId)
  saveWorkbenchConfig({ ...cfg, members, lastModified: Date.now() })
  emitWorkbenchConfigChanged()
}
```

> `isValidConfig`（[workbench-config.ts:41](../../../apps/web/src/lib/workbench/workbench-config.ts#L41)）**不要**加 members 必填校验——旧 config 没有该字段，加必填会触发重置。members 是可选叠加字段。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter web test workbench-config`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/workbench.ts apps/web/src/lib/workbench/workbench-config.ts apps/web/src/lib/workbench/workbench-config.test.ts
git commit -m "feat(workbench): workbench-config 加 members 字段(getMembers/setMembers)"
```

---

## Task 2: 抽取「钉 HTML 到工作台」为复用函数

资源池拖入网格、artifact-panel 右键钉，应共用一个函数（DRY）。

**Files:**
- Create: `apps/web/src/lib/workbench/pin-html-to-workbench.ts`
- Modify: `apps/web/src/components/artifact/artifact-panel.tsx:349-360`
- Test: `apps/web/src/lib/workbench/pin-html-to-workbench.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/lib/workbench/pin-html-to-workbench.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { pinHtmlToWorkbench } from "./pin-html-to-workbench"
import { loadWorkbenchConfig } from "./workbench-config"

describe("pinHtmlToWorkbench", () => {
  beforeEach(() => localStorage.clear())

  it("钉一个 html 后 config 里出现对应 block", () => {
    pinHtmlToWorkbench({ conversationId: 5, path: "/abs/sales.html", name: "sales.html" })
    const cfg = loadWorkbenchConfig("global")
    expect(cfg?.blocks.length).toBe(1)
    expect(cfg?.blocks[0].title).toBe("sales")
    expect(cfg?.blocks[0].htmlRef.resourcePath).toBe("/abs/sales.html")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter web test pin-html-to-workbench`
Expected: FAIL — module not found

- [ ] **Step 3: 抽出函数**

新建 `apps/web/src/lib/workbench/pin-html-to-workbench.ts`（把 [artifact-panel.tsx:349-359](../../../apps/web/src/components/artifact/artifact-panel.tsx#L349) `pinHtmlToWorkbench` 逻辑搬出来）：

```ts
import {
  addHtmlArtifactBlock,
  emitWorkbenchConfigChanged,
  GLOBAL_WORKBENCH_ID,
  initializeWorkbenchConfig,
  loadWorkbenchConfig,
} from "./workbench-config"

/** 把一个 HTML 产物钉到全局工作台网格。资源面板右键 / 资源池拖入共用此函数。 */
export function pinHtmlToWorkbench(args: {
  conversationId: string | number
  path: string
  name: string
}): void {
  const { conversationId, path, name } = args
  const config =
    loadWorkbenchConfig(GLOBAL_WORKBENCH_ID) ??
    initializeWorkbenchConfig(GLOBAL_WORKBENCH_ID)
  const title = name.replace(/\.html?$/i, "")
  addHtmlArtifactBlock(
    config,
    { conversationId, resourcePath: path, pinnedAt: Date.now() },
    title,
  )
  emitWorkbenchConfigChanged()
}
```

改 [artifact-panel.tsx](../../../apps/web/src/components/artifact/artifact-panel.tsx)：删掉本地 `pinHtmlToWorkbench`（约 349-360 行）和它对 `addHtmlArtifactBlock`/`initializeWorkbenchConfig`/`loadWorkbenchConfig`/`GLOBAL_WORKBENCH_ID`/`emitWorkbenchConfigChanged` 的 import（若其它地方还用到则保留用到的），改成 `import { pinHtmlToWorkbench } from "@/lib/workbench/pin-html-to-workbench"`。调用点签名从 `pinHtmlToWorkbench(conversationId, entry.path, entry.name)` 改为 `pinHtmlToWorkbench({ conversationId, path: entry.path, name: entry.name })`（[artifact-panel.tsx:720](../../../apps/web/src/components/artifact/artifact-panel.tsx#L720)）。

- [ ] **Step 4: 跑测试 + typecheck**

Run: `pnpm --filter web test pin-html-to-workbench`
Expected: PASS

Run: `pnpm typecheck --filter=web`
Expected: 无新增类型错误

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workbench/pin-html-to-workbench.ts apps/web/src/lib/workbench/pin-html-to-workbench.test.ts apps/web/src/components/artifact/artifact-panel.tsx
git commit -m "refactor(workbench): 抽出 pinHtmlToWorkbench 复用函数(资源面板+资源池共用)"
```

---

## Task 3: 资源池 API client + Query hooks

**Files:**
- Create: `apps/web/src/api/workbench-resources.ts`
- Create: `apps/web/src/hooks/use-workbench-resources.ts`
- Test: `apps/web/src/api/workbench-resources.test.ts`（若仓库有 API 单测惯例；否则跳测试，靠 typecheck）

- [ ] **Step 0: 先看仓库 API client 惯例**

Run: `cat apps/web/src/api/recent-contacts.ts`
Run: `grep -n "export" apps/web/src/lib/request.ts | head`
照搬它的 request 封装（GET/POST/DELETE 怎么调、baseURL、错误处理、`getActiveWorkspaceId` 用法）。

- [ ] **Step 1: 写 API client**

新建 `apps/web/src/api/workbench-resources.ts`（用仓库的 `request` helper，签名照 recent-contacts.ts 实际写法对齐）：

```ts
import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"

export interface WorkbenchResource {
  id: number
  workspace_id: number
  source: "employee_artifact" | "upload"
  src_path: string
  title: string
  added_by: string | null
  created_at: string
}

export async function listWorkbenchResources(): Promise<WorkbenchResource[]> {
  const res = await request.get("/workbench-resources/list", {
    params: { workspace_id: getActiveWorkspaceId() },
  })
  return res.data?.data ?? []
}

export async function addWorkbenchResource(args: {
  src_path: string
  title?: string
}): Promise<WorkbenchResource> {
  const res = await request.post("/workbench-resources/add", {
    workspace_id: getActiveWorkspaceId(),
    ...args,
  })
  return res.data?.data
}

export async function uploadWorkbenchResource(
  file: File,
  title?: string,
): Promise<WorkbenchResource> {
  const form = new FormData()
  form.append("workspace_id", String(getActiveWorkspaceId()))
  form.append("file", file)
  if (title) form.append("title", title)
  const res = await request.post("/workbench-resources/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  })
  return res.data?.data
}

export async function deleteWorkbenchResource(id: number): Promise<void> {
  await request.delete(`/workbench-resources/${id}`, {
    params: { workspace_id: getActiveWorkspaceId() },
  })
}
```

> ⚠️ `request` 的真实 API（是 axios 实例？自封装 fetch？`.get(url, {params})` 还是 `.get(url, params)`？响应是 `res.data.data` 还是 `res.data`？）必须照 recent-contacts.ts 核对，上面是按常见 axios 约定写的占位，**落地前对齐**。

- [ ] **Step 2: 写 Query hooks**

新建 `apps/web/src/hooks/use-workbench-resources.ts`：

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  addWorkbenchResource,
  deleteWorkbenchResource,
  listWorkbenchResources,
  uploadWorkbenchResource,
  type WorkbenchResource,
} from "@/api/workbench-resources"
import { getActiveWorkspaceId } from "@/lib/workspace-id"

const key = () => ["workbench-resources", getActiveWorkspaceId()] as const

export function useWorkbenchResources() {
  return useQuery<WorkbenchResource[]>({
    queryKey: key(),
    queryFn: listWorkbenchResources,
  })
}

export function useAddWorkbenchResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: addWorkbenchResource,
    onSuccess: () => qc.invalidateQueries({ queryKey: key() }),
  })
}

export function useUploadWorkbenchResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { file: File; title?: string }) =>
      uploadWorkbenchResource(args.file, args.title),
    onSuccess: () => qc.invalidateQueries({ queryKey: key() }),
  })
}

export function useDeleteWorkbenchResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteWorkbenchResource,
    onSuccess: () => qc.invalidateQueries({ queryKey: key() }),
  })
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck --filter=web`
Expected: 无新增类型错误

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/workbench-resources.ts apps/web/src/hooks/use-workbench-resources.ts
git commit -m "feat(workbench): 资源池 API client + TanStack Query hooks"
```

---

## Task 4: 资源池面板组件（列表/上传/拖拽源）

**Files:**
- Create: `apps/web/src/components/workbench/workbench-resource-pool.tsx`
- Test: 组件渲染单测（若仓库有组件测试惯例；否则靠手动 + typecheck）

- [ ] **Step 1: 写组件**

新建 `apps/web/src/components/workbench/workbench-resource-pool.tsx`：

```tsx
import { useRef } from "react"
import { toast } from "sonner"
import {
  useWorkbenchResources,
  useUploadWorkbenchResource,
  useDeleteWorkbenchResource,
} from "@/hooks/use-workbench-resources"
import type { WorkbenchResource } from "@/api/workbench-resources"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/** 资源池面板：用户精选的 HTML 看板库。卡片可拖到网格钉看板。 */
export function WorkbenchResourcePool({
  className,
  onClose,
}: {
  className?: string
  onClose?: () => void
}) {
  const { data: resources = [], isLoading } = useWorkbenchResources()
  const upload = useUploadWorkbenchResource()
  const del = useDeleteWorkbenchResource()
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = (file: File) => {
    if (!/\.html?$/i.test(file.name)) {
      toast.error("只接受 .html 文件")
      return
    }
    upload.mutate(
      { file },
      {
        onSuccess: () => toast.success(`已上传：${file.name}`),
        onError: (e) => toast.error(`上传失败：${String(e)}`),
      },
    )
  }

  const onDragStart = (e: React.DragEvent, r: WorkbenchResource) => {
    // 拖拽载荷：网格 drop 区据此钉看板（见 Task 6）
    e.dataTransfer.setData(
      "application/x-workbench-resource",
      JSON.stringify({ src_path: r.src_path, title: r.title, source: r.source }),
    )
  }

  return (
    <div className={cn("flex h-full flex-col gap-2 p-2", className)}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">资源池</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => fileRef.current?.click()}
        >
          上传 HTML
        </Button>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleUpload(f)
            e.target.value = ""
          }}
        />
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">加载中…</div>
      ) : resources.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          资源池为空。做完看板后从资源面板「加入资源池」，或上传 HTML。
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-auto">
          {resources.map((r) => (
            <div
              key={r.id}
              draggable
              onDragStart={(e) => onDragStart(e, r)}
              className="group flex cursor-grab items-center gap-2 rounded border bg-card p-2 text-xs"
            >
              <span className="truncate">{r.title}</span>
              <span className="ml-auto rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {r.source === "upload" ? "上传" : "助手"}
              </span>
              <button
                className="opacity-0 group-hover:opacity-100"
                onClick={() =>
                  del.mutate(r.id, {
                    onSuccess: () => toast.success("已移除"),
                  })
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

> `toast` 来自 `sonner`（仓库已用，见 [artifact-panel.tsx:721](../../../apps/web/src/components/artifact/artifact-panel.tsx#L721)）。`Button`/`cn` import 路径照仓库现有组件。

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck --filter=web && pnpm lint --filter=web`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workbench/workbench-resource-pool.tsx
git commit -m "feat(workbench): 资源池面板组件(列表/上传/拖拽源/删除)"
```

---

## Task 5: 「邀请员工到工作台」弹窗 + 成员切换器

**Files:**
- Create: `apps/web/src/components/workbench/workbench-invite-member-dialog.tsx`
- Create: `apps/web/src/components/workbench/workbench-chat-switcher.tsx`
- Test: 切换器逻辑单测（成员增删/选中态）

- [ ] **Step 0: 先确认「员工列表 + 技能」数据来源**

仓库没有现成 `useEmployees` hook（已 grep 确认）。需要找到工作台/聊天页拿员工列表的方式：

Run: `grep -rn "type === \"employee\"\|contacts\b" apps/web/src/stores/chat-store.ts | head`
Run: `grep -rln "employees/list\|employee-list\|list_workspace_employees" apps/web/src/`

工作台已有 `contacts`（[workbench-content-split.tsx:119](../../../apps/web/src/components/workbench/workbench-content-split.tsx#L119) `useChatStore((s) => s.contacts)`）。确认 contact 对象是否带"技能列表"——若不带，邀请弹窗就列出**全部员工 contact**，让用户自行选（本期可不按技能过滤，spec 的"装了 workbench-builder"过滤作为增强；先列全部员工，工作台助手默认已是成员）。**执行期据实际 contact 结构定**：能拿到技能就过滤，拿不到就列全部 + 文案提示"需员工装有 workbench-builder 技能才能操控看板"。

- [ ] **Step 1: 写邀请弹窗**

新建 `apps/web/src/components/workbench/workbench-invite-member-dialog.tsx`：

```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"

export interface InvitableEmployee {
  id: number
  name: string
}

/** 邀请员工到工作台：勾选员工 id 加入 members。 */
export function WorkbenchInviteMemberDialog({
  open,
  onOpenChange,
  employees,
  memberIds,
  onToggle,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  employees: InvitableEmployee[]
  memberIds: number[]
  onToggle: (id: number, join: boolean) => void
}) {
  const memberSet = new Set(memberIds)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>邀请员工到工作台</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {employees.length === 0 && (
            <div className="text-xs text-muted-foreground">暂无可邀请的员工</div>
          )}
          {employees.map((e) => {
            const joined = memberSet.has(e.id)
            return (
              <div key={e.id} className="flex items-center gap-2 p-1 text-sm">
                <span>{e.name}</span>
                <Button
                  size="sm"
                  variant={joined ? "secondary" : "outline"}
                  className="ml-auto"
                  onClick={() => onToggle(e.id, !joined)}
                >
                  {joined ? "移出" : "加入"}
                </Button>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

> `Dialog` 等组件 import 路径照仓库现有用法（`grep -rn "from \"@workspace/ui/components/dialog\"" apps/web/src | head`）。

- [ ] **Step 2: 写切换器**

新建 `apps/web/src/components/workbench/workbench-chat-switcher.tsx`：

```tsx
import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  WorkbenchInviteMemberDialog,
  type InvitableEmployee,
} from "./workbench-invite-member-dialog"

export interface WorkbenchMember {
  id: number
  name: string
}

/** 工作台成员切换器：横排成员 + 邀请入口。总管不在其中。 */
export function WorkbenchChatSwitcher({
  members,
  activeId,
  onSelect,
  invitable,
  onToggleMember,
  className,
}: {
  members: WorkbenchMember[]
  activeId: number | null
  onSelect: (id: number) => void
  invitable: InvitableEmployee[]
  onToggleMember: (id: number, join: boolean) => void
  className?: string
}) {
  const [inviteOpen, setInviteOpen] = useState(false)
  return (
    <div className={cn("flex items-center gap-1 border-b p-1", className)}>
      {members.map((m) => (
        <Button
          key={m.id}
          size="sm"
          variant={m.id === activeId ? "secondary" : "ghost"}
          onClick={() => onSelect(m.id)}
        >
          {m.name}
        </Button>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="ml-auto"
        onClick={() => setInviteOpen(true)}
      >
        + 邀请员工
      </Button>
      <WorkbenchInviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        employees={invitable}
        memberIds={members.map((m) => m.id)}
        onToggle={onToggleMember}
      />
    </div>
  )
}
```

- [ ] **Step 3: 写切换器纯逻辑单测**

新建 `apps/web/src/components/workbench/workbench-chat-switcher.test.tsx`（用仓库的 React 测试栈——先 `grep -rln "@testing-library/react" apps/web/src | head` 确认有；若无则跳过本 step 的渲染测试，仅保留 typecheck）：

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WorkbenchChatSwitcher } from "./workbench-chat-switcher"

describe("WorkbenchChatSwitcher", () => {
  it("点击成员触发 onSelect", () => {
    const onSelect = vi.fn()
    render(
      <WorkbenchChatSwitcher
        members={[{ id: 1, name: "工作台助手" }]}
        activeId={null}
        onSelect={onSelect}
        invitable={[]}
        onToggleMember={() => {}}
      />,
    )
    fireEvent.click(screen.getByText("工作台助手"))
    expect(onSelect).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `pnpm --filter web test workbench-chat-switcher`（若有 RTL）
Run: `pnpm typecheck --filter=web`
Expected: PASS / 无类型错误

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workbench/workbench-chat-switcher.tsx apps/web/src/components/workbench/workbench-invite-member-dialog.tsx apps/web/src/components/workbench/workbench-chat-switcher.test.tsx
git commit -m "feat(workbench): 工作台成员切换器+邀请员工弹窗(总管不在)"
```

---

## Task 6: 网格 drop 区接受资源池拖拽 → 钉看板

**Files:**
- Modify: `apps/web/src/components/workbench/draggable-workbench-grid.tsx`（或其容器）
- Test: drop handler 解析载荷的纯函数单测

- [ ] **Step 0: 读网格容器结构**

Run: `sed -n '1,80p' apps/web/src/components/workbench/draggable-workbench-grid.tsx`
确认网格最外层容器元素（挂 `onDragOver`/`onDrop` 的位置）。

- [ ] **Step 1: 写 drop 载荷解析纯函数 + 测试**

新建 `apps/web/src/lib/workbench/parse-resource-drop.ts`：

```ts
export interface DroppedResource {
  src_path: string
  title: string
  source: "employee_artifact" | "upload"
}

/** 从 dragData 解析资源池拖拽载荷；非本类型返回 null。 */
export function parseResourceDrop(raw: string | null): DroppedResource | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (typeof obj?.src_path === "string" && typeof obj?.title === "string") {
      return {
        src_path: obj.src_path,
        title: obj.title,
        source: obj.source === "upload" ? "upload" : "employee_artifact",
      }
    }
  } catch {
    /* ignore */
  }
  return null
}
```

新建 `apps/web/src/lib/workbench/parse-resource-drop.test.ts`：

```ts
import { describe, it, expect } from "vitest"
import { parseResourceDrop } from "./parse-resource-drop"

describe("parseResourceDrop", () => {
  it("解析合法载荷", () => {
    const r = parseResourceDrop(
      JSON.stringify({ src_path: "a/x.html", title: "X", source: "upload" }),
    )
    expect(r).toEqual({ src_path: "a/x.html", title: "X", source: "upload" })
  })
  it("非法载荷返回 null", () => {
    expect(parseResourceDrop("not-json")).toBeNull()
    expect(parseResourceDrop(null)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认通过**

Run: `pnpm --filter web test parse-resource-drop`
Expected: PASS

- [ ] **Step 3: 在网格容器接 onDrop**

在网格最外层容器（Step 0 确认的元素）加：

```tsx
onDragOver={(e) => {
  if (e.dataTransfer.types.includes("application/x-workbench-resource")) {
    e.preventDefault()
  }
}}
onDrop={(e) => {
  const dropped = parseResourceDrop(
    e.dataTransfer.getData("application/x-workbench-resource"),
  )
  if (!dropped) return
  e.preventDefault()
  // upload 来源 conversationId 用占位 "upload"；employee_artifact 也无具体会话，统一占位。
  pinHtmlToWorkbench({
    conversationId: dropped.source === "upload" ? "upload" : "resource",
    path: dropped.src_path,
    name: dropped.title.endsWith(".html") ? dropped.title : `${dropped.title}.html`,
  })
}}
```

import：`import { parseResourceDrop } from "@/lib/workbench/parse-resource-drop"` + `import { pinHtmlToWorkbench } from "@/lib/workbench/pin-html-to-workbench"`。

> ⚠️ `src_path` 是相对 workspace.root_path 的相对路径。`WorkbenchHtmlPanel` 渲染时怎么把它解析成可取 HTML 的真实路径，要确认（[workbench-html-panel.tsx](../../../apps/web/src/components/workbench/workbench-html-panel.tsx) 现在按 `htmlRef.resourcePath` 取内容的方式）。若现有渲染只认绝对路径/会话产物路径，需在此让 `path` 走得通——执行期读 `WorkbenchHtmlPanel` 取内容分支确认，必要时让 API 返回绝对路径或加一个按 workspace 相对路径取 HTML 的内容端点。**这是本计划最大的未验证点，执行期务必先验证再写 onDrop。**

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck --filter=web`
Expected: 无新增类型错误

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/workbench/parse-resource-drop.ts apps/web/src/lib/workbench/parse-resource-drop.test.ts apps/web/src/components/workbench/draggable-workbench-grid.tsx
git commit -m "feat(workbench): 网格接受资源池拖拽→钉看板"
```

---

## Task 7: 工作台右侧接入切换器（总管 → 成员）

把 [workbench-content-split.tsx](../../../apps/web/src/components/workbench/workbench-content-split.tsx) 的「固定总管面板」改成「成员切换器 + 选中成员的 CuratorView」。

**Files:**
- Modify: `apps/web/src/components/workbench/workbench-content-split.tsx`

- [ ] **Step 0: 通读现有 split 组件**

读 [workbench-content-split.tsx](../../../apps/web/src/components/workbench/workbench-content-split.tsx) 全文（108-411 行已在计划上下文）。理解：
- 现在固定渲染总管 `CuratorView`（[renderCuratorPanel](../../../apps/web/src/components/workbench/workbench-content-split.tsx#L300)）。
- `contacts` 已在手（员工/总管 contact）。

- [ ] **Step 1: 加成员选择 state + 默认工作台助手**

在组件内加：
- `const members = getMembers(GLOBAL_WORKBENCH_ID)`（用 Task 1 的函数；用一个随 `workbench-config-changed` 事件刷新的 state 包一层）。
- `const [activeMemberId, setActiveMemberId] = useState<number | null>(null)`。
- effect：`members` 为空时，从 `contacts` 找名为「工作台助手」的员工 contact，`setMembers(GLOBAL_WORKBENCH_ID, [助手id])`（补默认成员）。
- effect：`activeMemberId` 为空且 members 非空时，默认选第一个。
- `invitable`：从 `contacts` 过滤出员工类型（`type === "employee"`），映射成 `{ id, name }`。

> 取「工作台助手」id：`contacts.find(c => c.type === "employee" && c.name === "工作台助手")` —— contact 的字段名（`name`/`displayName`/`targetId`）照 `ChatViewContact` 实际结构核对。

- [ ] **Step 2: 渲染切换器 + 选中成员的 CuratorView**

在 `curator` 面板内，顶部渲染 `<WorkbenchChatSwitcher .../>`，下方渲染选中成员的对话。选中成员后，需要拿到该成员的「contact + 当前会话 id」——复用现有 curator 那套会话查询，但 contact 换成选中成员的 contact：

- 若 `activeMemberId` 指向工作台助手/普通员工：用该员工 contact 调 `useConversationsQuery(employeeContactId, employeeContact)` 拿会话列表，取/建当前会话，渲染 `<CuratorView contact={memberContact} conversationId={...} .../>`（CuratorView 接受任意 contact）。

> ⚠️ 这是本 task 的核心改造，也是前端最大改动面。现有逻辑（panel 解析、`workbenchCuratorConversationId`、`ensureCuratorConversationAndSelect`）全是 curator 专用。**执行期策略**：
> 1. 先把现有"总管"路径**保留为 activeMemberId===CURATOR 的特例**（不破坏现状）——但 spec 说总管不在切换器。折中：切换器只列 members（员工），总管路径作为"无成员时的回退/或彻底移除"。
> 2. 推荐：把 `renderCuratorPanel` 泛化为 `renderMemberPanel(memberContact, conversationId)`，员工会话复用员工聊天的会话查询/创建 hook（找 `useConversationsQuery` + 员工新建会话的现有调用点照搬）。
> 3. 因为这一步耦合深，**执行期应先读** `curator-conversation-actions.ts` / `use-create-curator-conversation.ts` / 员工聊天页如何建会话，确认员工会话的"取或建"路径，再动 split 组件。

- [ ] **Step 3: typecheck + lint + 手动**

Run: `pnpm typecheck --filter=web && pnpm lint --filter=web`
手动：进工作台 → 看到切换器（工作台助手默认在）→ 切到它能对话 → 邀请另一个员工 → 切换器多一项。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workbench/workbench-content-split.tsx
git commit -m "feat(workbench): 右侧对话面板改为成员切换器(默认工作台助手,总管不在)"
```

---

## Task 8: 资源池面板替换/并列 + 派单 toast

**Files:**
- Modify: `apps/web/src/components/workbench/workbench-content-split.tsx`

- [ ] **Step 1: resources 面板加入资源池**

现有 `resources` 面板挂 `ArtifactPanel`（文件浏览器）。资源池是新面板。**决策（spec 已定"工作台右上角资源池"）**：在 `resources` 面板里用 Tab 或并列同时给「文件」(ArtifactPanel) 和「资源池」(WorkbenchResourcePool)，或新增一个右上角独立触发的资源池抽屉。最小改动：在 resources 面板顶部加切页（"文件 / 资源池"），资源池页渲染 `<WorkbenchResourcePool/>`。

> 执行期看视觉，二选一：①resources 面板内加 Tab；②右上角加独立"资源池"按钮开抽屉。两者都只在 split 组件内接线，不影响别处。

- [ ] **Step 2: 派单 toast**

工作台页面监听"总管派单给工作台成员"事件，弹 toast 引导切到目标成员：

Run: `grep -rn "WorkspaceEventBus\|workspace-events\|task_failed\|EventSource" apps/web/src/hooks/use-workspace-events.ts`
确认前端已有的 workspace 事件订阅（[use-workspace-events.ts](../../../apps/web/src/hooks/use-workspace-events.ts)）。派单/任务开始事件若已有 type，在工作台组件订阅它：

```tsx
// 伪代码：实际事件 type 照 use-workspace-events 现有约定
useWorkspaceEvent("task_started", (ev) => {
  if (!isWorkbenchMember(ev.employee_id)) return
  toast("工作台助手开始做任务，去看？", {
    action: { label: "查看", onClick: () => setActiveMemberId(ev.employee_id) },
  })
})
```

> ⚠️ 后端是否已推"任务开始"事件、字段是什么，要核 [use-workspace-events.ts](../../../apps/web/src/hooks/use-workspace-events.ts) + 后端 `WorkspaceEventBus.push` 的事件类型。**若没有"任务开始"事件**，本 step 降级：用现有"派单完成/计划创建"事件触发 toast，或本期先不做 toast（spec 已把它列为"开放问题"，可推迟）。执行期据现有事件能力定。

- [ ] **Step 3: typecheck + 手动**

Run: `pnpm typecheck --filter=web && pnpm lint --filter=web`
手动：资源池上传 HTML → 出现在列表 → 拖到网格 → 渲染。主聊天派单 → 工作台 toast（若事件就绪）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workbench/workbench-content-split.tsx
git commit -m "feat(workbench): 资源池面板接入工作台右上角 + 派单 toast 引导切换"
```

---

## Self-Review（对 spec 逐条）

- ✅ workbench-config 加 members → Task 1
- ✅ 资源池 API client/hooks → Task 3
- ✅ 资源池面板（列表/上传/删除/拖拽源）→ Task 4
- ✅ 仅用户入池/上传 → Task 4（无 agent 路径）
- ✅ 资源池拖入网格 = 钉看板（复用 addHtmlArtifactBlock）→ Task 2（抽函数）+ Task 6（drop）
- ✅ 成员切换器（N 选一，总管不在）+ 邀请 → Task 5 + Task 7
- ✅ 默认成员=工作台助手 → Task 7 Step 1
- ✅ 派单后 toast 引导切到目标员工 → Task 8 Step 2
- ✅ 复用 CuratorView 承载员工对话 → Task 7

**高不确定点（执行期必须先验证再写，已在对应 task 标注）**：
1. **Task 7** split 组件泛化（curator-only 逻辑 → 任意员工会话的"取或建"）——最大改动面，先读 `curator-conversation-actions.ts` / 员工建会话路径。
2. **Task 6** 资源池相对路径 `src_path` 在 `WorkbenchHtmlPanel` 能否取到 HTML——可能需要后端补一个"按 workspace 相对路径取 HTML"内容端点（若是则回填 Plan 1）。
3. **Task 8** 派单"任务开始"事件是否存在——没有则 toast 降级或推迟（spec 已列为开放问题）。
4. `request` helper、`ChatViewContact` 字段、UI 组件 import 路径——执行期照仓库现有用法对齐（各 task Step 0 已要求先 grep 样板）。

---

## Execution Handoff

见会话——两份计划统一交付选择。
