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
- 需员工已分配 `browser-runtime` Skill

## LLM 行为提示

1. 从用户提问提取 `{ user_query: "..." }`
2. 通过 `shell_execute` 依次调用：
   - `browserctl open https://www.baidu.com`
   - `browserctl fill "#kw" "<user_query>"`
   - `browserctl click "#su"`
3. 可选 `browserctl snapshot` 确认结果页
4. 用自然语言总结搜索结果

## 注意

- 若 `#kw` / `#su` 失效（百度改版），先 `browserctl snapshot` 再改用 `@eN` 引用
- 若 `browserctl` 不在 PATH 中，按 `browser-runtime` Skill 的开发环境命令调用
