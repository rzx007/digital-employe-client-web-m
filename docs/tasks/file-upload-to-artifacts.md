# 文件上传功能：上传到对话 uploads 目录

## 概述

实现文件上传功能，用户在聊天界面中选择文件后立即上传到对应对话的 `uploads/` 目录，上传完成后点发送消息（附带文件路径），AI agent 通过 `read_file` 工具读取文件内容。

**当前阶段（A 方案）**：仅支持文本类文件，暂不支持 PDF/DOCX/XLSX 等二进制文档。

## 实现状态：✅ 已完成

---

## 整体流程

```
用户选择文件 → 立即上传到 /uploads/ 目录（per-file 状态反馈）
       │
       ▼
用户输入消息 → 点发送（仅发消息 + 已上传路径列表）
       │
       ▼
LangChainChatTransport → 将文件路径拼接到 prompt
       │
       ▼
Agent prompt 中包含 [上传的文件]: /uploads/xxx
       │
       ▼
Agent 调用 read_file("/uploads/xxx") 读取内容
```

---

## 方案总结

### 后端（apps/server）

| 模块 | 改动 |
|------|------|
| `src/schemas/resource.py` | 新增 `ResourceUploadResult` schema（name/path/size） |
| `src/service/resource_service.py` | `upload_file()` 方法：白名单校验、同名加序号、路径安全校验；`_ALLOWED_PREFIXES` 新增 `/uploads/`；`list_resources` 扫描 `uploads/` 目录 |
| `src/api/chat_api.py` | `POST /chat/conversations/{id}/resources/upload` 端点 |
| `src/service/agent.py` | `CompositeBackend` routes 注册 `/uploads/` 路由，agent 可通过 `read_file` 读取上传文件 |

### 前端（apps/web）

| 模块 | 改动 |
|------|------|
| `api/types.ts` | `ResourceUploadResult` 类型、`ResourceList` 新增 `uploads` 字段 |
| `api/conversation.ts` | `uploadConversationFile()` API 函数 |
| `hooks/use-chat-queries.ts` | `useUploadFileMutation()` hook |
| `components/chat-prompt-input.tsx` | `ChatPromptInputAttachments`（选择即上传、per-file 状态）；`ChatPromptInput` 新增 `conversationId`/`onAttachmentsChange` props |
| `components/chat/chat-panel.tsx` | 透传 `conversationId`/`onAttachmentsChange` |
| `components/chat/chat-conversation-view.tsx` | `doSend` 用 `uploadedPathsRef`（不再发送时上传） |
| `components/chat/chat-draft-view.tsx` | `doSend` 创建会话后用 `uploadDraftFiles()` 上传 |
| `components/chat/curator/curator-view.tsx` | `doSend` 用 `uploadedPathsRef` |
| `lib/chat/langchain-chat-transport.ts` | `getFilePathsFromBody()` 将文件路径拼接到 prompt |
| `components/artifact/artifact-panel.tsx` | 文件树新增 `uploads/` 目录渲染 |
| `packages/ui/.../prompt-input.tsx` | `matchesAccept` 修复（支持 `.ext` 扩展名匹配） |

---

## 文件存储路径

```
~/.digital-employee/conversations/
  └── <conversation_id>/
      ├── artifacts/              ← agent 生成的文件（已有）
      ├── uploads/                ← 【新增】用户上传的文件
      │   ├── report.csv
      │   ├── config.json
      │   └── script.py
      └── skills-draft/           ← 技能草稿（已有）
```

**虚拟路径前缀**: `/uploads/`（在 `resource_service.py` 的 `_ALLOWED_PREFIXES` 和 `agent.py` 的 `CompositeBackend` routes 中均已注册）

---

## 文件类型白名单

### 允许的扩展名

| 类别 | 扩展名 |
|------|--------|
| 文本 | `.txt`, `.md`, `.csv`, `.tsv`, `.json`, `.xml`, `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.conf`, `.log`, `.env` |
| 代码 | `.py`, `.js`, `.ts`, `.tsx`, `.jsx`, `.html`, `.css`, `.scss`, `.less`, `.vue`, `.svelte`, `.java`, `.go`, `.rs`, `.c`, `.cpp`, `.h`, `.hpp`, `.cs`, `.rb`, `.php`, `.swift`, `.kt`, `.scala`, `.sh`, `.bash`, `.zsh`, `.sql`, `.r`, `.m` |
| 配置 | `.dockerfile`, `.gitignore`, `.editorconfig`, `.eslintrc`, `.prettierrc`, `.makefile`, `.cmake` |
| 图片 | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp` |
| 数据 | `.geojson`, `.jsonl`, `.ndjson` |

### 排除的扩展名

`.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.bz2`, `.xz`, `.exe`, `.dll`, `.so`, `.dylib`, `.msi`, `.dmg`, `.iso`, `.bin`, `.dat`, `.db`, `.sqlite`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`, `.mp3`, `.mp4`, `.avi`, `.mov`, `.wmv`, `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.rtf`, `.odt`, `.ods`, `.odp`

### 文件大小限制

- 单文件最大 **200MB**
- 单次消息最多附件 **10 个**

---

## 关键设计决策

1. **上传与发送分离**：选择文件立即上传，点发送仅发消息（附带已上传路径），避免发送时等待上传
2. **同名文件处理**：自动加序号（`report.csv` → `report_1.csv`），不覆盖
3. **agent 路由注册**：`agent.py` 的 `CompositeBackend` 必须注册 `/uploads/` 路由，否则 agent 的 `read_file` 找不到文件
4. **`matchesAccept` 修复**：扩展名以 `.` 开头时用 `f.name.endsWith(pattern)` 匹配（不仅匹配 MIME type）

---

## 后续扩展（B 方案）

支持 PDF/DOCX/XLSX 时：安装 `markitdown`，上传时自动转换为 Markdown。

---

## 涉及文件汇总

| 文件路径 | 改动内容 |
|---------|---------|
| `apps/server/src/schemas/resource.py` | `ResourceUploadResult` schema、`ResourceList` 新增 `uploads` |
| `apps/server/src/service/resource_service.py` | `upload_file()`、`_ALLOWED_PREFIXES`、`ALLOWED_UPLOAD_EXTENSIONS` |
| `apps/server/src/service/agent.py` | `CompositeBackend` routes 注册 `/uploads/` |
| `apps/server/src/api/chat_api.py` | `POST .../resources/upload` 端点 |
| `apps/web/src/api/types.ts` | `ResourceUploadResult`、`ResourceList`（含 `uploads`） |
| `apps/web/src/api/conversation.ts` | `uploadConversationFile()` |
| `apps/web/src/hooks/use-chat-queries.ts` | `useUploadFileMutation()` |
| `apps/web/src/components/chat-prompt-input.tsx` | 附件上传组件、状态反馈 |
| `apps/web/src/components/chat/chat-panel.tsx` | 透传 props |
| `apps/web/src/components/chat/chat-conversation-view.tsx` | `doSend` 改用 `uploadedPathsRef` |
| `apps/web/src/components/chat/chat-draft-view.tsx` | `doSend` 创建会话后上传 |
| `apps/web/src/components/chat/curator/curator-view.tsx` | `doSend` 改用 `uploadedPathsRef` |
| `apps/web/src/lib/chat/langchain-chat-transport.ts` | `getFilePathsFromBody()` |
| `apps/web/src/components/artifact/artifact-panel.tsx` | `uploads/` 目录渲染 |
| `packages/ui/src/components/ai-elements/prompt-input.tsx` | `matchesAccept` 修复 |
