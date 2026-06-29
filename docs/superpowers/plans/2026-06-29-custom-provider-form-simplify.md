# 自定义供应商表单精简 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「自定义供应商」表单从 6 个必填字段精简到 2 个（API 地址 + ≥1 模型 ID），供应商 ID 自动生成、显示名称可选、模型行单列、支持批量粘贴拆分。

**Architecture:** 改动集中在前端单文件 `add-provider-dialog.tsx`。后端 `/model/providers` 契约不变——前端在提交前自动从显示名称（或域名）slugify 出 `provider_id`、用域名兜底 `display_name`。新增两个纯函数（slug 生成 + 模型串拆分）便于复用与将来加测。父组件 `models-settings.tsx` 多传一个可选 prop 供前端查重。

**Tech Stack:** React 19 + TypeScript（apps/web）、shadcn/ui 组件、sonner toast。无既有单测框架接入该组件，纯函数以独立导出形式落地。

---

## File Structure

- `apps/web/src/components/settings/add-provider-dialog.tsx`（修改）：
  - 新增纯函数 `slugifyProviderId(source: string): string`、`uniqueProviderId(source: string, taken: string[]): string`、`hostFromUrl(url: string): string`、`splitModelIds(raw: string): string[]`（导出，便于复用/测试）。
  - custom 步骤 JSX：删除「供应商 ID」字段、模型行「显示名称」列、外层灰盒；显示名称降为可选。
  - `handleSubmitCustom`：改校验 + 自动推导 provider_id/display_name。
  - 模型输入框加 `onPaste` 批量拆分。
  - 移除 `customId` 状态及其 reset。
  - 新增可选 prop `existingProviderIds?: string[]`。
- `apps/web/src/components/settings/models-settings.tsx`（修改）：给 `<AddProviderDialog>` 传 `existingProviderIds={registry?.providers.map((p) => p.id) ?? []}`。

每个 Task 自成可提交单元。

---

## Task 1: 新增纯函数（slug / host / 模型拆分）

**Files:**
- Modify: `apps/web/src/components/settings/add-provider-dialog.tsx`（在 `PasswordInput` 之后、`AddProviderDialog` 之前插入导出函数）

后端约束（来自 `apps/server/src/llm/registry_service.py:38-50`）：provider id 须 `^[a-z][a-z0-9_-]*$`，小写字母开头。拆分需兼顾中英文逗号 `,，` 与换行。

- [ ] **Step 1: 写入纯函数实现**

在文件中 `PasswordInput` 组件定义之后插入：

```typescript
export function slugifyProviderId(source: string): string {
  const slug = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!slug) return "provider"
  // 后端要求小写字母开头
  return /^[a-z]/.test(slug) ? slug : `p-${slug}`
}

export function uniqueProviderId(source: string, taken: string[]): string {
  const base = slugifyProviderId(source)
  const set = new Set(taken.map((t) => t.toLowerCase()))
  if (!set.has(base)) return base
  let i = 2
  while (set.has(`${base}-${i}`)) i += 1
  return `${base}-${i}`
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url.trim()).host
  } catch {
    return ""
  }
}

export function splitModelIds(raw: string): string[] {
  return raw
    .split(/[\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
```

- [ ] **Step 2: 类型检查通过**

Run: `pnpm typecheck --filter=web`
Expected: PASS（新函数不依赖其他改动，应无报错）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings/add-provider-dialog.tsx
git commit -m "feat(settings): add slug/host/model-split helpers for custom provider"
```

---

## Task 2: 父组件传入 existingProviderIds

**Files:**
- Modify: `apps/web/src/components/settings/add-provider-dialog.tsx`（props 类型加可选字段）
- Modify: `apps/web/src/components/settings/models-settings.tsx:406-411`

- [ ] **Step 1: 给 AddProviderDialog props 加可选字段**

在 `AddProviderDialog` 的参数解构与类型中加入 `existingProviderIds`。改动签名：

```typescript
export function AddProviderDialog({
  open,
  onOpenChange,
  availableCatalogIds,
  existingProviderIds = [],
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableCatalogIds: string[]
  existingProviderIds?: string[]
  onAdded: (registry: LlmRegistry) => void
}) {
```

- [ ] **Step 2: 父组件传入已接入 provider id**

把 `models-settings.tsx:406-411` 的 `<AddProviderDialog>` 改为：

```tsx
      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        availableCatalogIds={availableQuery.data ?? []}
        existingProviderIds={registry?.providers.map((p) => p.id) ?? []}
        onAdded={handleRegistryChange}
      />
```

> 注：`registry` 是 `models-settings.tsx:192` 的 `const registry = registryQuery.data`，类型 `LlmRegistry | undefined`，故用 `?.` 与 `?? []`。

- [ ] **Step 3: 类型检查通过**

Run: `pnpm typecheck --filter=web`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/settings/add-provider-dialog.tsx apps/web/src/components/settings/models-settings.tsx
git commit -m "feat(settings): pass existingProviderIds into AddProviderDialog"
```

---

## Task 3: custom 步骤 JSX 精简（删 ID、显示名称可选、模型单列）

**Files:**
- Modify: `apps/web/src/components/settings/add-provider-dialog.tsx`（`step === "custom"` 分支，原 330-417 行）

- [ ] **Step 1: 替换 custom 分支 JSX**

把整个 `{step === "custom" && ( ... )}` 块替换为以下内容（字段顺序：API 地址 → API Key → 显示名称(可选) → 模型；模型行单列 + onPaste 批量拆分；去掉灰盒与「供应商 ID」）：

```tsx
          {step === "custom" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>API 地址</Label>
                <Input
                  className="font-mono text-sm"
                  placeholder="https://api.example.com/v1"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>API Key（可选）</Label>
                <PasswordInput
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>显示名称（可选）</Label>
                <Input
                  placeholder="留空则用域名"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>模型</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setModels((prev) => [...prev, { id: "" }])}
                  >
                    <IconPlus className="size-3.5" />
                    添加模型
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  {models.map((model, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        className="font-mono text-sm"
                        placeholder="model-id"
                        value={model.id}
                        onPaste={(e) => handleModelPaste(e, index)}
                        onChange={(e) =>
                          updateModelRow(index, "id", e.target.value)
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 text-muted-foreground"
                        disabled={models.length <= 1}
                        onClick={() =>
                          setModels((prev) => prev.filter((_, i) => i !== index))
                        }
                      >
                        <IconX className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  可一次粘贴多个，用逗号或换行分隔
                </p>
              </div>
            </div>
          )}
```

- [ ] **Step 2: 补 IconX 导入**

把第 2 行的导入改为同时引入 `IconX`：

```typescript
import { IconChevronRight, IconPlus, IconX } from "@tabler/icons-react"
```

- [ ] **Step 3: 类型检查（预期此处会报 handleModelPaste 未定义）**

Run: `pnpm typecheck --filter=web`
Expected: FAIL，报 `handleModelPaste` 未定义 —— 由 Task 4 补上。先不提交。

---

## Task 4: handleModelPaste 批量拆分逻辑

**Files:**
- Modify: `apps/web/src/components/settings/add-provider-dialog.tsx`（在 `updateModelRow` 附近新增 handler）

- [ ] **Step 1: 新增 handleModelPaste**

在 `updateModelRow` 函数定义之后插入：

```typescript
  const handleModelPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    index: number
  ) => {
    const text = e.clipboardData.getData("text")
    const ids = splitModelIds(text)
    // 单个 token 走默认粘贴
    if (ids.length <= 1) return
    e.preventDefault()
    setModels((prev) => {
      const next = [...prev]
      // 第一个填入当前行，其余追加
      next[index] = { ...next[index], id: ids[0] }
      for (const id of ids.slice(1)) next.push({ id })
      // 去重（按 trim 后的 id），保留首次出现，丢弃空 id
      const seen = new Set<string>()
      return next.filter((m) => {
        const mid = m.id.trim()
        if (!mid) return true // 保留用户手动留空的占位行不在此处删；空行最终提交时过滤
        if (seen.has(mid)) return false
        seen.add(mid)
        return true
      })
    })
  }
```

- [ ] **Step 2: 类型检查通过**

Run: `pnpm typecheck --filter=web`
Expected: PASS（Task 3 的 `handleModelPaste` 引用此时已定义）

- [ ] **Step 3: Commit（Task 3 + 4 合并提交，因二者互相依赖）**

```bash
git add apps/web/src/components/settings/add-provider-dialog.tsx
git commit -m "feat(settings): single-column model rows + paste-to-split for custom provider"
```

---

## Task 5: handleSubmitCustom 自动推导 + 校验精简

**Files:**
- Modify: `apps/web/src/components/settings/add-provider-dialog.tsx`（`handleSubmitCustom`，原 177-211 行）

- [ ] **Step 1: 替换 handleSubmitCustom**

把整个 `handleSubmitCustom` 函数替换为：

```typescript
  const handleSubmitCustom = async () => {
    if (!customUrl.trim()) {
      toast.error("请填写 API 地址")
      return
    }
    const normalized = models
      .map((m) => ({ id: m.id.trim() }))
      .filter((m) => m.id)
    if (normalized.length === 0) {
      toast.error("至少需要一个模型")
      return
    }
    const host = hostFromUrl(customUrl)
    const displayName = customName.trim() || host || "自定义供应商"
    const providerId = uniqueProviderId(
      customName.trim() || host || "provider",
      existingProviderIds
    )
    setSubmitting(true)
    try {
      const next = await addLlmProvider({
        source: "custom",
        provider_id: providerId,
        display_name: displayName,
        base_url: customUrl.trim(),
        api_key: customApiKey.trim(),
        models: normalized,
        set_as_active: true,
      })
      onAdded(next)
      toast.success("已添加自定义供应商")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败")
    } finally {
      setSubmitting(false)
    }
  }
```

> 注：`models` 提交时只取 `{ id }`，不再传 `display_name`（后端字段保留兼容，传 undefined 即 null）。

- [ ] **Step 2: 类型检查通过**

Run: `pnpm typecheck --filter=web`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings/add-provider-dialog.tsx
git commit -m "feat(settings): auto-derive provider id/name on custom submit"
```

---

## Task 6: 清理 customId 状态与 reset

**Files:**
- Modify: `apps/web/src/components/settings/add-provider-dialog.tsx`（state 声明 60 行、reset effect 67-82 行、custom 入口 setModels 处）

- [ ] **Step 1: 删除 customId 状态声明**

删除这一行（原第 60 行）：

```typescript
  const [customId, setCustomId] = React.useState("")
```

- [ ] **Step 2: 删除 reset effect 中的 customId 清理**

在 `React.useEffect`（open 变化）的 `if (!open)` 块里删除：

```typescript
      setCustomId("")
```

- [ ] **Step 3: 确认 custom 入口初始化模型行不带 display_name**

把「自定义供应商」入口按钮的 onClick（原 275-278 行）确认/改为：

```tsx
                onClick={() => {
                  setModels([{ id: "" }])
                  setStep("custom")
                }}
```

- [ ] **Step 4: 类型检查通过（确认无 customId 残留引用）**

Run: `pnpm typecheck --filter=web`
Expected: PASS（若报 `customId` 未定义，说明仍有残留引用，搜索 `customId` 全部清除）

- [ ] **Step 5: Lint + format**

Run: `pnpm lint --filter=web && pnpm format`
Expected: PASS，无 add-provider-dialog 相关报错

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/settings/add-provider-dialog.tsx
git commit -m "refactor(settings): drop unused customId state from add-provider dialog"
```

---

## Task 7: 手动验证

**Files:** 无（运行时验证）

- [ ] **Step 1: 启动 Electron 桌面开发**

Run: `pnpm --filter web dev:app`
（或浏览器模式 `pnpm dev` 看 3399）

- [ ] **Step 2: 逐项验证**

打开 设置 → 模型 → 添加供应商 → 自定义供应商，验证：

1. 只填 API 地址 `https://api.example.com/v1` + 一个模型 `gpt-4o` → 能添加成功，列表里显示名为 `api.example.com`。
2. 填了显示名称「我的端点」→ 列表显示名用「我的端点」。
3. 在模型框粘贴 `gpt-4o, gpt-4o-mini\nqwen-max` → 自动拆成 3 行、去重。
4. 重复添加两个都不填显示名、同域名的供应商 → 第二个能加成功（id 自动 `-2`，不报 409）。
5. 「测试连接」仍正常工作（填了 base_url + 至少一个模型时）。

- [ ] **Step 3: 验证通过后无需提交（纯验证）**

若发现问题，回到对应 Task 修复并重新提交。

---

## Self-Review 记录

- **Spec 覆盖**：必填 6→2（T3/T5）、删供应商 ID（T3/T6）、显示名称可选+域名兜底（T3/T5）、模型单列（T3）、批量粘贴（T1/T4）、provider_id 自动生成+去重（T1/T5）、existingProviderIds 依赖（T2）、测试连接不变（未改 `handleTestCustom`）。全部有对应 Task。
- **占位符扫描**：无 TBD/TODO，每个代码步骤含完整代码。
- **类型一致性**：`slugifyProviderId`/`uniqueProviderId`/`hostFromUrl`/`splitModelIds`/`handleModelPaste` 命名跨 Task 一致；`existingProviderIds` 在 T2 定义、T5 使用；`models` 元素统一为 `{ id }`（`RegistryModelInput.display_name` 可选，省略合法）。
- **后端不变**：`handleTestCustom`、`handleSubmitPreset`、preset 分支均未触及。
