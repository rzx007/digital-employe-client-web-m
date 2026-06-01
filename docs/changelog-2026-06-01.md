# 版本变更与召测操作手册（2026-06-01）

> 汇总近 9 次提交的功能变更，标注对应修改文件，供手动回归测试使用。

---

## 1. 员工跨会话记忆工具

**提交**: `86e5b1b` | 后端 + 前端

| 测试项 | 操作步骤 | 预期结果 |
|--------|----------|----------|
| 员工记忆写入 | 与员工对话，要求其记住某信息（如"记住我来自北京"） | 员工成功调用 `remember_memory` 工具 |
| 员工记忆读取 | 新开一个会话，问员工"你记得我是谁吗" | 员工从上个会话的记忆中读取到信息 |
| 记忆权限保护 | 尝试让员工修改 `/memories/AGENTS.md` | 被禁止，不允许写入 |

**修改文件**:
- `apps/server/src/service/agent/employee.py`
- `apps/server/src/service/agent/memory_file.py`
- `apps/server/src/service/agent/memory_middleware_patch.py`
- `apps/server/src/service/agent/remember_memory_tool.py`
- `apps/server/src/service/agent/paths.py`
- `apps/server/src/service/agent/prompts.py`

---

## 2. 办公文档在线预览（docx / xlsx）

**提交**: `86e5b1b` | 前端

| 测试项 | 操作步骤 | 预期结果 |
|--------|----------|----------|
| Word 预览 | 员工生成 .docx 文件产物，点击预览 | 以渲染方式展示文档内容，不是直接下载 |
| Excel 预览 | 员工生成 .xlsx 文件产物，点击预览 | 渲染展示表格内容 |
| 编码兼容 | docx 含中文/特殊字符 | 正常显示不出现乱码 |

**修改文件**:
- `apps/web/src/components/chat/artifact-content/docx-artifact-renderer.tsx`
- `apps/web/src/components/chat/artifact-content/xlsx-artifact-renderer.tsx`
- `apps/web/src/components/chat/artifact-content/legacy-office-artifact-renderer.tsx`
- `apps/web/src/components/chat/artifact-content/office-artifact-preview.css`
- `apps/web/src/components/chat/artifact-content/artifact-renderer-view.tsx`
- `apps/web/src/components/chat/artifact-content/resolve-renderer.ts`

---

## 3. 对话流停止状态修复与消息同步

**提交**: `41f77c2` | 后端 + 前端

| 测试项 | 操作步骤 | 预期结果 |
|--------|----------|----------|
| 对话流停止 | 员工执行中点击停止按钮 | 对话正确触发停止，不残留工具调用 |
| 消息同步 | 停止后刷新页面，确认消息完整 | 已流出的消息保留，中断前后状态正确 |
| 中断工具调用 | 工具执行中被中断 | 工具调用输出不被丢失，同步回显示 |
| Shell 输出实时性 | 员工运行 shell 命令且无换行符 | 输出正确实时推送，不卡住 |

**修改文件**:
- `apps/server/src/service/message_parts_extractor.py`
- `apps/server/src/service/stream_registry.py`
- `apps/server/src/service/hitl_pending_parts.py`
- `apps/server/src/service/skill_shell_backend.py`
- `apps/web/src/hooks/use-conversation-session.ts`
- `apps/web/src/lib/chat/pick-message-display-source.ts`
- `apps/server/src/service/config_kv_service.py`

---

## 4. 总管导航返回与执行报告卡片优化

**提交**: `cde151a` | 后端 + 前端

| 测试项 | 操作步骤 | 预期结果 |
|--------|----------|----------|
| 返回总管 | 从员工对话中，点击导航栏的返回按钮 | 跳回总管会话，不丢失上下文 |
| 执行报告紧凑模式 | 查看总管中员工的执行报告卡片 | 紧凑模式正确显示，信息完整 |
| 执行摘要 | 总管视图中展示多个员工的执行摘要 | 摘要内容正确，时间戳映射无误 |

**修改文件**:
- `apps/web/src/components/chat/curator/curator-return-bar.tsx`
- `apps/web/src/lib/chat/curator-navigation.ts`
- `apps/web/src/stores/chat-store.ts`
- `apps/web/src/components/chat/message-blocks/execution-report-card.tsx`
- `apps/web/src/components/chat/curator/curator-view.tsx`
- `apps/server/src/service/orchestrator_execution_summary.py`

---

## 5. PowerPoint 文件预览

**提交**: `196adc9` | 前端

| 测试项 | 操作步骤 | 预期结果 |
|--------|----------|----------|
| PPTX 预览 | 员工生成 .pptx 文件产物，点击预览 | 幻灯片渲染展示，可翻页浏览 |
| 旧版 PPT 预览 | 员工生成 .ppt 文件产物，点击预览 | 旧版格式也能预览 |
| 懒加载 | 页面首次加载时 PPT 渲染组件不阻塞 | React.lazy 生效，非首屏渲染 |

**修改文件**:
- `apps/web/src/components/chat/artifact-content/pptx-artifact-renderer.tsx`
- `apps/web/src/components/chat/artifact-content/legacy-ppt-artifact-renderer.tsx`
- `apps/web/src/components/chat/artifact-content/resolve-renderer.ts`
- `apps/web/src/components/chat/artifact-content/artifact-renderer-view.tsx`

---

## 6. 员工任务执行消息回传流程

**提交**: `e539674` | 文档

> 纯文档提交，无代码变更，说明员工在总管编排下执行任务的消息回传链路。

**修改文件**:
- `docs/orchestrator-employee-message-flow.md`
- `docs/group-chat-design.md`

---

## 7. 联系人详情查看

**提交**: `5dc64d4` | 前端

| 测试项 | 操作步骤 | 预期结果 |
|--------|----------|----------|
| 联系人详情 | 在联系人面板点击某个联系人（非选中） | 弹出联系人详情，不切换当前对话 |

**修改文件**:
- `apps/web/src/components/chat/contacts/contact-item.tsx`
- `apps/web/src/components/chat/contacts/contacts-panel.tsx`
- `apps/web/src/lib/chat/conversation-selection/apply.ts`

---

## 8. 工作台重构：添加区块对话框与技能来源标识

**提交**: `6beb561` | 后端 + 前端

| 测试项 | 操作步骤 | 预期结果 |
|--------|----------|----------|
| 技能来源标识 | 工作台添加区块对话框，查看技能列表 | 内置技能显示为 "builtin"，本地技能显示为 "local" |
| 图片发送 | 聊天中发送图片文件 | AI 正确读取并理解图片内容 |
| 编排策略 | 总管生成编排计划 | 所有编排计划必须用户手动确认才能执行 |
| 工作台日历 | 工作台中查看排班日历 | 日历 Sheet 正确展示 |

**修改文件**（关键）:
- `apps/web/src/components/workbench/add-block-dialog.tsx`
- `apps/web/src/components/workbench/workbench-content-split.tsx`
- `apps/web/src/components/workbench/workbench-shift-calendar-sheet.tsx`
- `apps/server/src/llm/vision.py`
- `apps/server/src/service/agent/orchestrator/confirmation_policy.py`
- `apps/server/src/service/orchestrator_execution_summary.py`
- `apps/server/src/service/employee_service.py`

---

## 9. 总管助手功能与技能管理系统

**提交**: `ef6427c` | 后端 + 前端

| 测试项 | 操作步骤 | 预期结果 |
|--------|----------|----------|
| 技能发现 | 对总管说"帮我找一个能处理 PDF 的技能" | 调用 `find-skills` 工具，从 SkillsMP 搜索 |
| 技能安装 | 确认安装某个技能 | 成功安装并可用 |
| 长文档协作 | 要求总管写一份技术方案 | 遵循三步协作流程（需求收集 → 大纲 → 分章） |
| 员工技能分配 | 给员工分配本地技能 + 远程技能 | 混合分配生效，员工能正常调用 |

**修改文件**（关键）:
- `apps/server/src/service/skillsmp_service.py`（新增，610 行 — SkillsMP 仓库集成）
- `apps/server/src/service/agent/orchestrator/tools.py`
- `apps/server/src/service/agent/orchestrator/prompts.py`
- `apps/server/src/service/agent/orchestrator/runtime.py`
- `apps/server/src/service/employee_service.py`
- `apps/server/src/service/agent/AGENTS.md`
- `.agents/skills/doc-coauthoring/SKILL.md`（新增 — 长文档协作 skill）

---

## 附：已知缺陷

| 问题 | 状态 | 说明 |
|------|------|------|
| `create_shell_execute_tool` 未定义 | **已修复** | `employee.py` 导入 `create_shell_execute_tool` 被误替换为 `remember_memory_tool`，在 `apps/server/src/service/agent/employee.py:34` 已补回 |
