---
name: change-spec-html
description: >-
  Generates one concise HTML change-spec for engineering batches: rules,
  problem/fix registry with priority and severity, verify commands, todos.
  Use when the user asks for 开发规范, 变更明细, 提示词治理文档, change registry,
  or wants a single HTML deliverable (not multiple verbose docs).
argument-hint: "[scope or title]"
user-invocable: true
---

# Change Spec HTML（单页精简版）

产出**一份**自包含 HTML，不要拆成「完成清单 + 问答整理 + 变更明细」三份。

## 原则

- **一页读完**：目标 ~150–250 行 HTML，表格为主，少卡片少重复
- **四块结构**：§1 规范 · §2 变更表 · §3 验收 · §4 待办
- **关键代码**放 `<details>` 折叠，默认不展开
- 不写「四份源文档关系」、长黑话表、重复验证章节

## 输出

- 路径：`docs/<主题>.html`（例：`docs/提示词治理.html`）
- 可选打包：`docs/<主题>.zip` 只含该 HTML

```powershell
Compress-Archive -Path "docs/提示词治理.html" -DestinationPath "docs/提示词治理.zip" -Force
```

## 工作流

1. `git diff --stat` + 读关键改动文件
2. §1：8 条以内 numbered list（做什么，一句）
3. §2：一张表 — ID | 问题 | 位置 | 改法 | P | 严重 | 态
4. §3：验收命令 + L2 报告表（若有）
5. §4：待办 bullet，≤5 条
6. 用户要 zip 时打包单文件

## §2 列定义

| 列 | 要求 |
|----|------|
| 问题 | 现象，一行 |
| 位置 | 文件路径，可换行 |
| 改法 | 动词开头，一行 |
| P | P0–P3 pill |
| 严重 | 严重/高/中/低 pill |
| 态 | ✅ ⏸ ✖ |

P0=阻塞/崩溃 · P1=核心回归 · P2=优化/波动 · P3=DX/不做

## 样式

复用 `docs/提示词治理.html` 的内联 CSS（紧凑 table + kpi 行 + pill）。

## 检查

- [ ] 仅一个 HTML 文件
- [ ] 无姊妹文档链接依赖
- [ ] GOV 行对应真实路径
- [ ] 评估数字来自实际 report

## 参考

- `docs/提示词治理.html` — 标准样例
