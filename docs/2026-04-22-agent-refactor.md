# Agent Backend 重构 & 资源管理器开发日志

## 一、背景

原 `agent.py` 使用了大量自定义 Backend 类（`WindowsCompatibleCompositeBackend`、`WindowsShellBackend`、`PosixVirtualFilesystemBackend`），deepagents 0.5.3 已内置 Windows 兼容支持，无需再自定义。同时 `/memories/` 使用 `StoreBackend`（InMemoryStore），重启丢失且不跟员工走。

## 二、已完成工作

### 2.1 后端 Agent 重构

#### 改动文件：`apps/server/src/service/agent.py`

**删除的代码（约 200 行）：**

- `PosixVirtualFilesystemBackend` — Windows 路径兼容层，deepagents 已处理
- `WindowsShellBackend` — Windows 编码兼容层，deepagents 已处理
- `WindowsCompatibleCompositeBackend` — 自定义 CompositeBackend，用原生的替代
- `run_shell_command` tool — 与 `LocalShellBackend.execute()` 重复
- `_norm_virtual_path()` — 不再需要
- `_STORE`（InMemoryStore）— `/memories/` 改为文件系统存储
- `import os, subprocess, sys, argparse` 等无用 import

**核心改动：**

| 虚拟路径 | 改动前 | 改动后 |
|----------|--------|--------|
| `/memories/` | `StoreBackend()`（InMemoryStore，重启丢失） | `FilesystemBackend` → `<employee_root>/memories/`（按员工隔离，持久化） |
| `/skills/` | `PosixVirtualFilesystemBackend`（可读写） | `FilesystemBackend`（只读，permissions deny write） |
| `/agent/` | `PosixVirtualFilesystemBackend` | `FilesystemBackend`（只读，permissions deny write） |
| `/artifacts/` | 仅 `conversation_id && root_path` 时挂载 | **始终挂载**：聊天→会话级，定时任务→员工级，兜底→`base_dir/artifacts/` |
| `/skills-draft/` | 不存在 | **新增**：仅会话场景挂载，`<root_path>/conversations/<id>/skills-draft/`（可读写，支持技能创建和调试） |
| default | `LocalShellBackend(root_dir=skills_root.parent)` | `LocalShellBackend(root_dir=artifacts_dir)` |

**新增能力：**

- `permissions` 参数：禁止写入 `/skills/**` 和 `/agent/**`
- 双源技能加载：`skills=["/skills/", "/skills-draft/"]`，同名技能草稿覆盖正式版
- `infer_artifact_type()` 新增 `"skill-draft"` 类型
- `_build_system_prompt()` 新增草稿技能创建/调试指引

**最终目录结构：**

```plaintext
<root_path>/conversations/<conversation_id>/
├── artifacts/          # /artifacts/ — 会话产物（可读写）
└── skills-draft/       # /skills-draft/ — 草稿技能（可读写，立即生效）

<employee_root>/                    # e.g. ~/.digital-employee/employees-skills/42/
├── skills/                          # /skills/ — 正式技能（只读）
├── memories/                        # /memories/ — 员工记忆（可读写）
└── artifacts/                       # /artifacts/ — 定时任务场景产物

src/service/                         # /agent/ — AGENTS.md（只读）
```

#### 改动文件：`apps/server/src/service/chat_service.py`

- `get_agent()` 调用增加 `employee_id=employee.id` 参数

#### 改动文件：`apps/server/src/service/task_scheduler_service.py`

- `_execute_task_call` 中 `get_agent()` 增加 `employee_id=employee.id`

#### 改动文件：`apps/server/src/api/workspace_api.py`

- `get_agent()` 调用增加 `employee_id=employee.id`

### 2.2 后端资源浏览 API

#### 新增文件：`apps/server/src/schemas/resource.py`

```python
class ResourceEntry(BaseModel):
    name: str
    path: str
    entry_type: str          # "file" | "directory"
    artifact_type: str | None
    size: int
    modified_at: float | None
    children: list[ResourceEntry] | None

class ResourceList(BaseModel):
    artifacts: list[ResourceEntry]
    skills_draft: list[ResourceEntry]

class ResourceContent(BaseModel):
    path: str
    content: str
    artifact_type: str
    language: str | None
```

#### 新增文件：`apps/server/src/service/resource_service.py`

- `ResourceService.list_resources(root_path, conversation_id)` — 扫描 artifacts/ 和 skills-draft/ 目录
- `ResourceService.read_content(root_path, conversation_id, path)` — 读取单个文件内容，含路径遍历防护
- skills-draft 目录结构：第一层子目录识别为技能目录（artifact_type="skill-draft"），支持嵌套展开

#### 改动文件：`apps/server/src/api/chat_api.py`

新增 2 个端点：

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/chat/conversations/{id}/resources` | 列出 artifacts + skills-draft 目录结构 |
| `GET` | `/chat/conversations/{id}/resources/content?path=...` | 读取单个文件内容 |

### 2.3 前端 ArtifactPanel 资源管理器改造

#### 改动文件列表

| 文件 | 改动 |
|------|------|
| `types/artifact.ts` | `ArtifactType` 加 `"skill-draft"`；新增 `ResourceEntry`、`ResourceList`、`ResourceContent` |
| `components/artifact/artifact-types.ts` | 同步加 `"skill-draft"` |
| `lib/chat/langchain-sse-schema.ts` | SSE schema `artifactType` enum 加 `"skill-draft"` |
| `lib/query-keys/chat.ts` | 新增 `resources`、`resourceContent` query key |
| `api/types.ts` | 新增 `ResourceEntry`、`ResourceList`、`ResourceContent` |
| `api/conversation.ts` | 新增 `fetchConversationResources()`、`fetchResourceContent()` |
| `hooks/use-chat-queries.ts` | 新增 `useConversationResourcesQuery()`、`useResourceContentQuery()` |
| `components/artifact/artifact-panel.tsx` | **重写**：左侧 FileTree（220px）+ 右侧文件预览 |
| `components/artifact/artifact-preview.tsx` | `typeIcons`/`typeLabels` 加 `skill-draft` |
| `components/chat/chat-layout.tsx` | 面板宽度 600→720px，传 `conversationId`，移除 `activeArtifact` 依赖 |

**ArtifactPanel 新布局：**

```plaintext
┌──────────────────────────────────────────────────┐
│ 资源管理器                          ▢ 📋 ⬇ ✕     │
├──────────────┬───────────────────────────────────┤
│ 📂 artifacts │  📄 report.md                     │
│   📄 a.md    │  ┌─────────────────────────────┐  │
│   🐍 b.py    │  │ # 分析报告                  │  │
│ 📂 skills..  │  │ 内容...                     │  │
│   📂 data..  │  └─────────────────────────────┘  │
│     📄 SK..  │                                   │
│     🐍 he..  │                                   │
└──────────────┴───────────────────────────────────┘
     220px                    flex-1
```

- 数据来源：`GET /resources` 获取文件树，`GET /resources/content?path=` 获取内容
- 文件树使用 `@workspace/ui/components/ai-elements/file-tree.tsx` 组件
- `skill-draft` 类型复用 `CodeRenderer` 渲染，图标使用 `IconCode`（蓝色）
- 空状态提示："暂无资源文件" / "选择文件查看内容"

## 三、数据流总览

### 聊天场景

```plaintext
用户发消息 → SSE 流
  → Agent 写 write_file("/artifacts/report.md", ...)
  → is_artifact_file() = true（不在排除列表）
  → build_artifact_event() → artifactType = "code"
  → SSE 推送到前端 → ArtifactPreview 卡片展示

用户点击 ArtifactPreview 或聊天面板资源按钮
  → ArtifactPanel 打开
  → GET /resources → 渲染 FileTree
  → 点击文件 → GET /resources/content?path=...
  → 右侧渲染文件内容
```

### 技能草稿场景

```plaintext
用户："帮我创建一个数据分析技能"
  → Agent 写 write_file("/skills-draft/data-analysis/SKILL.md", ...)
  → is_artifact_file() = true（/skills-draft/ 不在排除列表）
  → infer_artifact_type() = "skill-draft"
  → SSE 推送到前端 → ArtifactPreview 卡片展示（技能草稿标签）
  → SkillsMiddleware 自动发现新技能（双源加载，立即生效）

用户："用这个技能分析一下"
  → Agent 读取 /skills-draft/data-analysis/SKILL.md（草稿优先）
  → 按技能指引执行
```

## 四、下一步计划

### P0 — 前端资源管理器完善

- [ ] 验证 `pnpm dev` 运行时无报错，调试 FileTree 交互
- [ ] ArtifactPreview 点击后应打开 ArtifactPanel 并选中对应文件
- [ ] SSE 流中收到新 artifact 时自动刷新 FileTree（invalidate query）
- [ ] 会话切换时清空 selectedPath

### P1 — 技能草稿发布流程

- [ ] 后端：新增 `POST /chat/conversations/{id}/skills-draft/{skill_name}/publish` 端点
  - 将 `skills-draft/<skill_name>/` 内容迁移到 `<employee_root>/skills/<skill_name>/`
  - 或调用远程技能 API 发布
- [ ] 前端：资源管理器中技能草稿右键菜单增加"发布"按钮
- [ ] 前端：技能草稿增加"下载"功能（打包为 ZIP）

### P2 — 资源管理器增强

- [ ] 文件大小格式化（KB/MB）
- [ ] 修改时间显示
- [ ] 文件内容搜索（grep）
- [ ] 会话删除时清理 `skills-draft/` 目录（当前只清理 `artifacts/`）

### P3 — Checkpointer 持久化

- [ ] 将 `MemorySaver` 替换为 `SqliteSaver`，重启后保留对话上下文
- [ ] 当前 `_CHECKPOINTER` 是全局单例，定时任务每次用时间戳 thread_id，重启无影响

### P4 — 性能优化

- [ ] `get_agent()` 按 `(employee_id, conversation_id)` 缓存 agent 实例
- [ ] 资源列表 API 支持增量更新（监听文件变更事件）
