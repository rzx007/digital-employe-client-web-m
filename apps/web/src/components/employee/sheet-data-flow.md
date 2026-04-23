# 状态管理

```plaintext
selectedMcpIds: number[]       // 初始 = candidate.mcp_ids
selectedSkillIds: number[]     // 初始 = candidate.skill_ids
allMcpList: McpListItem[]      // 从接口获取全量
allSkillList: SkillListItem[]  // 从接口获取全量
pickerOpen: boolean            // 控制 Dialog 开关
```

# 数据流

```pliantext
Sheet 打开 → 初始化 selectedMcpIds / selectedSkillIds from candidate
            → 并行请求 fetchMcpList() + fetchSkillList()

用户点击 + → 打开 Dialog，展示两 tab + 搜索 + 复选框
用户勾选/取消 → 更新 selectedMcpIds / selectedSkillIds
用户点 × 移除 Badge → 从对应数组中移除 id

提交 createEmployee → 使用编辑后的 selectedMcpIds / selectedSkillIds
```

## 文件

| 文件                           | 职责                                        | 行数 |
| ------------------------------ | ------------------------------------------- | ---- |
| `recruitment-page.tsx`         | 主页面：搜索、候选人列表、状态管理          | ~240 |
| `candidate-card.tsx`           | 候选人卡片：匹配分数、能力展示、折叠详情    | ~170 |
| `hire-sheet.tsx`               | 录用面板：基本信息编辑、能力配置、排班任务  | ~230 |
| `capability-picker-dialog.tsx` | 能力选择 Dialog：MCP/技能双 Tab、搜索、多选 | ~170 |
| `schedule-task-config.tsx`     | 排班和任务配置                              | ~285 |
| `task-edit-dialog.tsx`         | 任务编辑弹窗                                | ~547 |
