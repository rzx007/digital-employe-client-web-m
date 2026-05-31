# Doc Co-Authoring Workflow

三步协作流程用于撰写技术方案、标书、可行性报告、长报告等长文档。

## 概览

| 阶段 | 内容 | 使用工具 |
|------|------|----------|
| 1. 需求收集 | 收集背景、读者、格式、约束 | `submit_clarifying_questions` |
| 2. 大纲确认与分章写作 | 大纲审批、逐章起草、迭代精修 | `submit_document_plan`, `write_file`, `edit_file` |
| 3. 读者测试 | 验证文档对新读者的可用性 | 自测 + `edit_file` 修复 |

## 核心规则

- **单次任务**：澄清门 + 方案门各 interrupt **一次**；方案 approve 后直接写章节 — **禁止**再次 `submit_document_plan`
- **仅当 reject** 并附修订反馈后，才可修改 outline 重新 submit
- 每次任务使用独立子目录 `/artifacts/<doc-slug>/`（slug 由 title 生成，kebab-case）
- 章节文件：`/artifacts/<doc-slug>/chapter-N-标题.md`
- 最终合并：`/artifacts/<doc-slug>/完整版.md`
- **禁止**方案确认前 write_file 到 `/artifacts/`
- **禁止**单文件一次塞入超长正文；须分章写入
- **禁止**在聊天正文粘贴完整章节内容

## 阶段 1：需求收集

### 1a. 主动提供协作流程

检测到写作任务时，先问用户要不要走结构化流程（见 AGENTS.md 中三步流程选项）。

### 1b. 初始澄清

调用 `submit_clarifying_questions`（context=`long_document`），收集：
1. 文档类型
2. 目标读者
3. 期望的阅读效果
4. 模板或格式要求
5. 截止日期/页数限制
6. 项目/问题背景
7. 为何不用替代方案
8. 利益相关方关注点
9. 技术架构/依赖
10. 参考资料

### 1c. 追问

如仍有明显信息缺口，可再次 `submit_clarifying_questions` 追问 5-10 题。

**退出条件**：能围绕 edge case 和 trade-off 提问，说明基础信息已够。

## 阶段 2：大纲确认与分章写作

### 2a. 提交方案

`submit_document_plan(title, outline, planned_artifacts)`

- `title` → 自动生成 `<doc-slug>`
- `outline` — Markdown 结构化大纲
- `planned_artifacts` — JSON 字符串数组，如 `'["/artifacts/tech-proposal/chapter-01-背景.md","/artifacts/tech-proposal/完整版.md"]'`

### 2b. 逐章写作

对每章：
1. 对话中简短问是否有特需内容
2. Brainstorm 5-15 个要点
3. 用户筛选
4. `write_file` 起草
5. 用户反馈 → `edit_file` 精修
6. 3 轮无实质更改后收尾

### 2c. 合并

所有章节完成后，通读检查一致性、重复、矛盾，合并为 `完整版.md`。

## 阶段 3：读者测试

1. 预测 5-10 个读者问题
2. 自测：每个问题能否从文档中找到答案？
3. 修复 gap → `edit_file`
4. 交付虚拟路径给用户
