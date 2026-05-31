---
name: find-skills
description: 帮助用户从 SkillsMP 技能仓库发现并安装 Agent 技能。当用户问「有没有 XX 技能」「怎么写标书/做测试」「找个技能」「扩展能力」时使用。在线模式优先引导 https://skillsmp.com/search ，离线模式使用内置技能或 ZIP 导入。
---

# Find Skills — 技能发现与安装

帮助用户从 **SkillsMP 技能仓库**（https://skillsmp.com/search）发现、预览并安装技能。

## 何时使用

- 用户问「怎么做 X」，X 可能有现成技能
- 「找个 XX 技能」「有没有能 XX 的技能」
- 用户想扩展数字员工能力
- 当前 `list_workspace_skills` 没有合适技能，且无对应数字员工

## 技能仓库

**在线模式（默认）：**

- 浏览地址：**https://skillsmp.com/search**
- 客户端：**左侧「技能」→「远程技能」** 可分类浏览、一键安装
- 总管工具：`search_market_skills` → `get_market_skill_detail` → `install_market_skill`

**离线模式：**

- 使用 `list_builtin_skills` + `install_builtin_skill` 安装内置技能
- 或在客户端「技能」页 **导入 ZIP**

## 推荐流程

### 1. 理解需求

识别：领域（标书/测试/设计…）、具体任务、是否常见到仓库已有技能。

### 2. 查已有能力

```
list_workspace_skills          # 工作区已安装
list_workspace_employees       # 是否已有员工自带技能
```

### 3. 搜索仓库（在线）

```
search_market_skills("关键词")
```

同时给用户仓库链接：https://skillsmp.com/search

若 API 无结果，仍建议用户去网站浏览分类。

### 4. 预览再装（必须）

**不要仅凭搜索结果就推荐安装。** 先：

```
get_market_skill_detail(skill_slug)
```

向用户展示：名称、描述、SKILL.md 预览（前 40 行）。`skill_slug` 为字符串，例如 `openclaw-openclaw-agents-skills-control-ui-e2e-skill-md`。

### 5. 向用户呈现选项

示例：

```
在 SkillsMP 找到「pptx」技能（slug=author-repo-...），用于创建和编辑 PowerPoint。
仓库详情：https://skillsmp.com/search

要我预览 SKILL.md 内容吗？确认后可以帮你安装到本机。
```

### 6. 安装

用户确认后：

```
install_market_skill(skill_slug)
```

安装时会通过 SkillsMP 的 `github-contents` 代理（与网站「Download Zip」同源）拉取 GitHub 技能文件；失败时回退直连 GitHub API。

安装位置：`~/.digital-employee/local-skills/<workspace_id>/<skill_name>/`

**说明：** 按**工作空间**隔离，同机同工作空间共享；不是按登录用户个人目录。

### 7. 分配给员工

```
list_workspace_skills           # 获取 localId（负整数）
update_employee(employee_id, skill_ids="[<localId>]")
```

## 内置技能（兜底）

仓库无合适结果时：

```
list_builtin_skills("关键词")
install_builtin_skill("skill-name")
```

## 禁止事项

- **不要**搜索或安装 GitHub / skills.sh 等外网仓库
- **不要**跳过预览直接安装
- **不要**编造 skill_slug 或 localId

## 找不到技能时

1. 说明仓库暂无匹配项，给出 https://skillsmp.com/search 自行浏览
2. 提供总管/员工直接协助完成任务的选项
3. 离线模式建议 ZIP 导入或内置技能
