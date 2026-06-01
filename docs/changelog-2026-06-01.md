# 版本变更与召测操作手册（2026-06-01）

> 汇总近 9 次提交的功能变更，标注对应修改文件，供手动回归测试使用。

---

## 1. 员工跨会话记忆工具

**提交**: `86e5b1b` | 后端 + 前端

### 改动前后对比

| 维度    | 改动前                                      | 改动后                                                    |
| ----- | ---------------------------------------- | ------------------------------------------------------ |
| 记忆持久化 | `/memories/AGENTS.md` 已跨会话存储             | 不变                                                     |
| 自动加载  | 每次会话已注入上下文                               | 不变                                                     |
| 写入方式  | `edit_file("/memories/AGENTS.md")` 字符串匹配 | 新增 `remember_memory` 结构化工具                             |
| 编码处理  | `FilesystemBackend`                      | 曾改为 `EncodingAwareFilesystemBackend`（**已回退**，读写已有编码回退） |
| 权限    | 无限制                                      | 禁止写 `/memories/AGENTS.md`，强制走 `remember_memory`        |

> **说明**：跨会话记忆原本就存在。新增专用工具替代 `edit_file` 字符串匹配，减少文件格式变化导致的写入失败。

| 测试项    | 操作步骤                          | 预期结果                        |
| ------ | ----------------------------- | --------------------------- |
| 员工记忆写入 | 与员工对话，要求其记住某信息（如"记住我来自北京"）    | 员工成功调用 `remember_memory` 工具 |
| 员工记忆读取 | 新开一个会话，问员工"你记得我是谁吗"           | 员工从上个会话的记忆中读取到信息            |
| 记忆权限保护 | 尝试让员工修改 `/memories/AGENTS.md` | 被拒绝，须用 `remember_memory` 工具 |

**修改文件**:

- `apps/server/src/service/agent/employee.py`
- `apps/server/src/service/agent/memory_file.py`
- `apps/server/src/service/agent/remember_memory_tool.py`
- `apps/server/src/service/agent/paths.py`
- `apps/server/src/service/agent/prompts.py`

---

## 2. 办公文档在线预览（docx / xlsx）

**提交**: `86e5b1b` | 前端

### 改动前后对比

| 维度       | 改动前        | 改动后                                      |
| -------- | ---------- | ---------------------------------------- |
| Word 预览  | 产物卡片仅可下载文件 | 嵌入渲染 docx 内容                             |
| Excel 预览 | 产物卡片仅可下载文件 | 嵌入渲染 xlsx 表格                             |
| 渲染方式     | —          | `docx-preview` + `xlsx` 库，React.lazy 懒加载 |

| 测试项      | 操作步骤                 | 预期结果           |
| -------- | -------------------- | -------------- |
| Word 预览  | 员工生成 .docx 文件产物，点击预览 | 渲染展示文档内容，非直接下载 |
| Excel 预览 | 员工生成 .xlsx 文件产物，点击预览 | 渲染展示表格内容       |
| 编码兼容     | docx 含中文/特殊字符        | 正常显示不出现乱码      |

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

### 改动前后对比

| 维度          | 改动前                                | 改动后                           |
| ----------- | ---------------------------------- | ----------------------------- |
| 停止触发        | `session.onStreamStopped()` 调用时机偏早 | 调整到正确的取消流程后触发                 |
| 消息同步        | 停止后刷新页面，部分已流消息丢失                   | DB refetch 后保留已累积部分，同步元数据     |
| 中断工具调用      | 工具执行中被中断后输出丢失                      | 中断前已捕获的工具输出正确回写               |
| Shell 无换行输出 | 无换行符时输出可能卡住                        | 实时推送                          |
| 模型配置覆盖      | 远程登录后模型配置可能覆盖本地选择                  | 新增 `model_sync_policy`，本地设置优先 |

| 测试项         | 操作步骤               | 预期结果              |
| ----------- | ------------------ | ----------------- |
| 对话流停止       | 员工执行中点击停止按钮        | 对话正确触发停止，不残留工具调用  |
| 消息同步        | 停止后刷新页面，确认消息完整     | 已流出的消息保留，中断前后状态正确 |
| 中断工具调用      | 工具执行中被中断           | 工具调用输出不被丢失，同步回显示  |
| Shell 输出实时性 | 员工运行 shell 命令且无换行符 | 输出正确实时推送，不卡住      |

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

### 改动前后对比

| 维度      | 改动前     | 改动后                             |
| ------- | ------- | ------------------------------- |
| 员工→总管返回 | 无导航返回功能 | 新增 `CuratorReturnBar` 组件，点击返回总管 |
| 执行报告卡片  | 仅全宽模式   | 新增紧凑模式                          |
| 执行摘要    | —       | 总管视图中展示执行摘要，时间戳正确映射             |

| 测试项      | 操作步骤             | 预期结果           |
| -------- | ---------------- | -------------- |
| 返回总管     | 从员工对话，点击导航栏返回按钮  | 跳回总管会话，不丢失上下文  |
| 执行报告紧凑模式 | 查看总管中员工的执行报告卡片   | 紧凑模式正确显示，信息完整  |
| 执行摘要     | 总管视图中展示多个员工的执行摘要 | 摘要内容正确，时间戳映射无误 |

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

### 改动前后对比

| 维度      | 改动前       | 改动后                                       |
| ------- | --------- | ----------------------------------------- |
| PPTX 预览 | 产物仅可下载    | 嵌入渲染幻灯片，可翻页                               |
| 旧版 PPT  | 不支持       | `LegacyPptArtifactRenderer` 兜底            |
| 性能      | 所有渲染器同步加载 | `pptx-artifact-renderer` 用 React.lazy 懒加载 |

| 测试项       | 操作步骤                | 预期结果                |
| --------- | ------------------- | ------------------- |
| PPTX 预览   | 员工生成 .pptx 产物，点击预览  | 幻灯片渲染展示，可翻页浏览       |
| 旧版 PPT 预览 | 员工生成 .ppt 产物，点击预览   | 旧版格式也能预览            |
| 懒加载       | 页面首次加载时 PPT 渲染组件不阻塞 | React.lazy 生效，非首屏渲染 |

**修改文件**:

- `apps/web/src/components/chat/artifact-content/pptx-artifact-renderer.tsx`
- `apps/web/src/components/chat/artifact-content/legacy-ppt-artifact-renderer.tsx`
- `apps/web/src/components/chat/artifact-content/resolve-renderer.ts`
- `apps/web/src/components/chat/artifact-content/artifact-renderer-view.tsx`

---

## 6. 员工任务执行消息回传流程

**提交**: `e539674` | 文档

> 纯文档提交，无代码变更。新增 `docs/orchestrator-employee-message-flow.md` 说明总管→员工的消息回传链路（7 阶段流程），同时更新了 `docs/group-chat-design.md` 增加编排复用和任务执行模式说明。

**修改文件**:

- `docs/orchestrator-employee-message-flow.md`
- `docs/group-chat-design.md`

---

## 7. 联系人详情查看

**提交**: `5dc64d4` | 前端

### 改动前后对比

| 维度          | 改动前           | 改动后                                 |
| ----------- | ------------- | ----------------------------------- |
| 联系人点击行为     | 点击联系人直接切换选中对话 | `selectContactForDetail` 仅查看详情不切换会话 |
| ContactItem | 固定点击行为        | 新增 `clickAction` 属性区分选择/详情          |

| 测试项   | 操作步骤               | 预期结果            |
| ----- | ------------------ | --------------- |
| 联系人详情 | 在联系人面板点击某个联系人（非选中） | 弹出联系人详情，不切换当前对话 |

**修改文件**:

- `apps/web/src/components/chat/contacts/contact-item.tsx`
- `apps/web/src/components/chat/contacts/contacts-panel.tsx`
- `apps/web/src/lib/chat/conversation-selection/apply.ts`

---

## 8. 工作台重构：添加区块对话框与技能来源标识

**提交**: `6beb561` | 后端 + 前端

### 改动前后对比

| 维度     | 改动前                      | 改动后                                 |
| ------ | ------------------------ | ----------------------------------- |
| 技能来源标识 | 统一显示为 "remote" / "local" | 明确 "local" / "builtin" 分类和 UI 标签色   |
| 图片理解   | AI 无法解析图片内容              | 新增 `vision.py`，图片经 base64 多模态传给 LLM |
| 编排确认策略 | 简单任务可能自动确认               | 所有计划必须用户手动确认                        |
| 排班日历   | 无                        | 新增 `WorkbenchShiftCalendarSheet`    |
| 会话选择   | 全局和工作台共用状态               | 分离为独立状态，各自维护                        |

| 测试项    | 操作步骤              | 预期结果                            |
| ------ | ----------------- | ------------------------------- |
| 技能来源标识 | 工作台添加区块对话框，查看技能列表 | 内置技能显示 "builtin"，本地技能显示 "local" |
| 图片发送   | 聊天中发送图片文件         | AI 正确读取并理解图片内容                  |
| 编排策略   | 总管生成编排计划          | 所有计划必须手动确认才能执行                  |
| 工作台日历  | 工作台中查看排班日历        | 日历 Sheet 正确展示                   |

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

### 改动前后对比

| 维度        | 改动前     | 改动后                                                |
| --------- | ------- | -------------------------------------------------- |
| 技能发现      | 无       | 通过 `search_market_skills` 搜索 SkillsMP 仓库           |
| 技能安装      | 仅本地导入   | 新增 `install_market_skill` 在线安装                     |
| 内置技能      | 无       | 新增 `list_builtin_skills` + `install_builtin_skill` |
| 长文档协作     | 无规范流程   | 新增 `doc-coauthoring` skill：需求收集→大纲→分章→合并           |
| 技能分配      | 仅本地技能   | 本地 + 远程混合分配                                        |
| MCP 管理    | 支持 MCP  | **移除** MCP 相关功能，简化员工管理                             |
| agent 提示词 | 无技能决策规则 | 新增优先级决策树、意图锚定、技能路径规则                               |

| 测试项    | 操作步骤                   | 预期结果                              |
| ------ | ---------------------- | --------------------------------- |
| 技能发现   | 对总管说"帮我找一个能处理 PDF 的技能" | 调用 `find-skills` 工具，从 SkillsMP 搜索 |
| 技能安装   | 确认安装某个技能               | 成功安装并可用                           |
| 长文档协作  | 要求总管写一份技术方案            | 遵循三步协作流程（需求收集 → 大纲 → 分章）          |
| 员工技能分配 | 给员工分配本地技能 + 远程技能       | 混合分配生效，员工能正常调用                    |

**修改文件**（关键）:

- `apps/server/src/service/skillsmp_service.py`（新增，610 行 — SkillsMP 仓库集成）
- `apps/server/src/service/agent/orchestrator/tools/`（重构：单文件 → 4 类子包，详见第 10 节）
- `apps/server/src/service/agent/orchestrator/prompts.py`
- `apps/server/src/service/agent/orchestrator/runtime.py`
- `apps/server/src/service/employee_service.py`
- `apps/server/src/service/agent/AGENTS.md`
- `.agents/skills/doc-coauthoring/SKILL.md`（新增 — 长文档协作 skill）

---

## 10. 总管工具按职能域重组

**提交**: 未单独提交（与第 1 节 `86e5b1b` import 修复同期合入） | 后端

### 改动前后对比

| 维度        | 改动前（812 行单文件 + 2 个旁路）                                                 | 改动后（4 类子包，21 个工具全量 re-export）                                                                  |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 文件分布     | `tools.py`（812 行单文件）、`employee_tools.py`、`recruitment_tools.py` 三处分散 | `tools/` 包，4 类子模块按"员工 / 计划 / 任务 / 技能"划分                                                          |
| 内聚性      | 员工 CRUD、招聘、技能市场、内置技能混在 3 个不同命名空间                                  | 同一职能域的工具放同一文件（招聘录用与员工 CRUD 同在 `tools/employees.py`）                                                |
| 文档概览     | 无统一 docstring                                                              | 每个子模块顶部 docstring 简述职责；`__init__.py` 列出全量符号                                                     |
| 公共导入路径   | `from ...tools import X`、`from ...employee_tools import X` 混用        | 统一 `from ...tools import X`（21 个工具 + 2 个 helper 全部走 `__init__.py` re-export）                       |
| `@tool` 装饰 | 全部保留                                                                      | 全部保留                                                                                       |
| 函数签名/工具名  | —                                                                     | **零变更**（保持 LangGraph checkpointer 兼容）                                                              |
| 测试        | 11 个 `test_employee_tools.py` + 4 个其他测试 mock 旧路径                          | 路径全部更新到 `tools.employees` / `tools.skills`（`tests/test_employee_tools.py`、`tests/conftest.py`） |

### 子模块职责

| 文件 | 工具 | 来源 |
|------|------|------|
| `tools/employees.py` | `list_workspace_employees` / `get_employee` / `update_employee` / `delete_employee` / `recruit_employee` / `hire_employee` / `hire_employees` | 原 `tools/employees.py` + `employee_tools.py` + `recruitment_tools.py` |
| `tools/plans.py` | `create_orchestration_plan` / `confirm_orchestration_plan` / `cancel_plan` | 原 `tools/plans.py` |
| `tools/tasks.py` | `list_tasks` / `update_task` / `delete_task` / `delete_tasks_batch` | 原 `tools/tasks.py` |
| `tools/skills.py` | `list_workspace_skills` / `get_workspace_skill_detail` / `list_builtin_skills` / `install_builtin_skill` / `search_market_skills` / `get_market_skill_detail` / `install_market_skill` | 原 `tools/builtin_skills.py` + `tools/market_skills.py` + `employee_tools.py` 工作区技能部分 |
| `tools/_helpers.py` | `parse_orchestration_task_list` / `resolve_conv_id` / `reset_market_detail_count` / `take_market_detail_slot` / `SKILL_MARKET_URL` / `MARKET_SKILL_SEARCH_LIMIT` / `MARKET_SKILL_DETAIL_MAX` | 原 `tools/_helpers.py`（不变） |

### 测试验证

- 36 个相关测试 100% 通过（`test_employee_tools.py` 11 + `test_create_orchestration_plan.py` 1 + `test_orchestration_task_list.py` 3 + `test_task_mutations.py` 10 + `test_skillsmp_service.py` 5 + `test_recruitment.py` 5 + `test_orchestrator_runtime_auth.py` 1）
- 全量 151 项：150 通过 / 1 预存在 Windows GBK 失败（与本次重构无关）
- 21 个 `@tool` 装饰、函数名、参数 schema、docstring **全部保持一致**，LangGraph checkpointer 兼容

### 修改文件

- `apps/server/src/service/agent/orchestrator/tools/`（重构：6 子模块 → 4 子模块；新 `skills.py` 合并 builtin + market + 工作区技能；新 `employees.py` 合并 list + CRUD + 招聘）
- `apps/server/src/service/agent/orchestrator/agent.py`（统一从 `tools` 包引入，移除 `recruitment_tools` / `employee_tools` 旧 import）
- `apps/server/tests/test_employee_tools.py`（3 处 mock 路径 + import 路径更新）
- `apps/server/tests/conftest.py`（`patched_employee_tools_db` fixture 的 mock 目标从 `employee_tools.get_session_local` 改为 `tools.employees.get_session_local`）
- 删除：`apps/server/src/service/agent/orchestrator/employee_tools.py`、`recruitment_tools.py`
- 删除：`apps/server/src/service/agent/orchestrator/tools/builtin_skills.py`、`market_skills.py`
- 同步更新：`docs/group-chat-design.md`、`docs/tool-intent-and-shell-execute-prd.md`、`apps/server/docs/orchestrator-employee-message-flow.md`、`apps/server/docs/orchestrator-employee-stream-isolation.md`、`apps/server/docs/compatibility-inventory.md` 中的旧路径引用
- 新增文档：`apps/server/docs/orchestrator-tools-layout.md`（子包架构、工具一览、跨模块依赖图、测试要点）

### 复盘结论

- **功能完整性**：21 个工具 100% 覆盖、`@tool` 装饰全部保留、函数签名/docstring 零变更。
- **零功能性 Bug**：未发现。
- **遗留清洁度问题（已修复）**：`tools/employees.py` 残留未用 `Session` import；`tests/conftest.py` 过期 docstring；`tests/test_employee_tools.py` 过期 docstring。
- **历史 plan 文件**（`.cursor/plans/*`）：未修改，保留作为当时方案记录。

---

## 总结

### 修复类（2 个）

- 41f77c2 — 对话流停止/消息同步 bugfix
- （附带的 import 误删导致两个线上问题）

### 补充改进类（6 个）

- 86e5b1b — 记忆工具（已有跨会话记忆上加专用工具）+ 文档预览（已有产物预览上加新格式）
- 196adc9 — PPT 预览（同上的产物预览扩展）
- cde151a — 导航返回 + 报告卡片紧凑模式（已有交互优化）
- 5dc64d4 — 联系人详情（已有联系人面板上加新点击行为）
- 6beb561 — 工作台重构（UI 调整 + 技能来源标识 + 图片识别）
- 工具按职能域重组（与第 1 节同期合入）— `tools.py` 单文件 → `tools/` 4 类子包（详见第 10 节）

### 新集成（1 个）

- ef6427c — SkillsMP 技能仓库搜索安装（接入外部服务，但仍是总管已有能力链的扩展）
文档（1 个）：
- e539674 — 消息回传流程文档

## 附：已知缺陷

| 问题                               | 状态      | 说明                                                                                                                                                                            |
| -------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_shell_execute_tool` 未定义  | **已修复** | `employee.py` 导入 `create_shell_execute_tool` 被误替换为 `remember_memory_tool`（`86e5b1b` 提交）。导致两个症状：① 直接员工聊天抛 500；② 总管委派静默失败（计划标为 confirmed 但员工 agent 未创建）。已在 `employee.py:34` 补回。 |
| `EncodingAwareFilesystemBackend` | **已移除** | 该 patch 用于补 MemoryMiddleware 内部 `download_files` 的编码兼容。但 `read_file` / `edit_file` 已通过 `read_text_with_encoding_fallback` + `write_text_as_utf8` 处理编码，实际无需此补丁。                |
| `tools.py` 单文件 + 旧 `employee_tools.py` / `recruitment_tools.py` 三处分散 | **已重构** | 见第 10 节：`tools/` 4 类子包，21 个工具统一从 `__init__.py` re-export，函数签名/工具名/docstring 全部保持一致（LangGraph checkpointer 兼容）。 |
