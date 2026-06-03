---
name: oa-overtime
description: 公司 OA 系统加班申请（示例流程，需内网 OA 可访问）
automation:
  target_url: https://oa.example.com/overtime/new
  operations:
    - action: navigate
      url: https://oa.example.com/overtime/new
    - action: wait_for
      selector: "#startTime"
      timeout_ms: 10000
    - action: fill
      selector: "#startTime"
      value: "${start_time}"
    - action: fill
      selector: "#endTime"
      value: "${end_time}"
    - action: fill
      selector: "#reason"
      value: "${reason}"
    - action: select
      selector: "#overtimeType"
      value: 加班
    - action: click
      selector: "#submit"
      confirmation_required: true
      confirmation_message: 确认提交 ${start_time}-${end_time} 加班申请？
---

# OA 加班申请（示例）

## 适用场景

- 用户已在内嵌浏览器登录公司 OA
- 员工已分配 `browser-runtime` Skill
- 演示 `browserctl` 多步填表流程（实际 URL/选择器需按贵司 OA 调整）

## LLM 行为提示

1. 从用户提问提取 `start_time`、`end_time`、`reason`
2. 通过 `shell_execute` 调用 `browserctl open` 到加班申请页（或用户当前 OA 地址）
3. 按 frontmatter 选择器依次 `browserctl fill` / `browserctl click`
4. 提交前对 `#submit` 使用 `browserctl click "#submit" --confirm "确认提交加班申请？"`；用户取消则停止

## 注意

- `oa.example.com` 为占位域名；离线或无法访问时请说明并改用手动指引
- 选择器与真实 OA 不一致时，用 `browserctl snapshot` 重新定位
