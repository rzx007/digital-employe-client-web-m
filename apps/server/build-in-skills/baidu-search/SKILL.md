---
name: baidu-search
description: 在百度搜索关键词
automation:
  target_url: https://www.baidu.com
  operations:
    - action: navigate
      url: https://www.baidu.com
    - action: fill
      selector: "#kw"
      value: "${user_query}"
    - action: click
      selector: "#su"
---

# 百度搜索

## 适用场景

- 用户说「打开百度搜索 XXX」「搜一下 XXX」时启用
- 需桌面端内嵌浏览器（`browser_*` 工具）

## LLM 行为提示

1. 从用户提问提取 `{ user_query: "..." }`
2. 依次调用：
   - `browser_navigate("https://www.baidu.com")`
   - `browser_fill("#kw", user_query)`
   - `browser_click("#su")`
3. 可选 `browser_snapshot` 确认结果页
4. 用自然语言总结搜索结果

## 注意

- 若 `#kw` / `#su` 失效（百度改版），先 `browser_snapshot` 再改用 `@eN` 引用
- 执行前可先提示用户打开工具栏「浏览器」面板以便查看页面
