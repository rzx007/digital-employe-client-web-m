# browser-runtime 组合示例

## 百度搜索

```bash
browserctl health
browserctl open https://www.baidu.com
browserctl snapshot
browserctl fill "#kw" "数字员工"
browserctl click "#su"
browserctl snapshot
```

如果选择器失效，使用 snapshot 返回的 `@eN`：

```bash
browserctl fill @e4 "数字员工"
browserctl click @e8
```

## OA 表单提交

```bash
browserctl open https://oa.example.com/overtime/new
browserctl snapshot
browserctl fill @e3 "2026-06-03 19:00"
browserctl fill @e4 "2026-06-03 21:00"
browserctl fill @e5 "项目上线支持"
browserctl click @e9 --confirm "确认提交 19:00-21:00 加班申请？"
browserctl extract-text
```

提交、删除、付款、审批等动作必须带 `--confirm`。
