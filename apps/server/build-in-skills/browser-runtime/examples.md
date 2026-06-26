# browser-runtime 组合示例

## 百度搜索

```bash
browserctl open https://www.baidu.com
browserctl snapshot
browserctl fill "#kw" "数字员工"
browserctl click "#su"
browserctl wait --selector "#content_left"   # 等结果容器出现，再读取
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
browserctl wait --text "提交成功"   # 等结果反馈出现（按实际结果文案/元素调整），再读取
browserctl extract-text
```

提交、删除、付款、审批等动作必须带 `--confirm`。

## iframe 内的表单（同源子页）

很多 OA/ERP 用同源 iframe 承载子页面。`snapshot` 会自动遍历同源 iframe，iframe 内的控件直接出现在 `@eN` 列表里，照常操作——**iframe 内只能用 `@eN`，CSS 选择器不跨 frame**（选择器只在主文档生效）。

```bash
browserctl open https://erp.example.com/order
browserctl snapshot --interactive   # iframe 内的输入框/按钮/下拉也在 @eN 里
browserctl fill @e7 "ORD-20260626-001"
browserctl select @e9 --label "华东仓"
browserctl click @e12 --confirm "确认创建订单？"
browserctl wait --text "创建成功"
browserctl get value @e7            # 校验 iframe 内填写已落地
```

跨源 iframe（不同域、独立进程）会被自动跳过、不影响主页面；若必须操作跨源 iframe 内部，当前版本不支持。

## 填入含特殊字符的长文本（规避 quoting）

文本含引号、`&`、`|`、换行等会破坏命令行解析的字符时，先写入文件再用 `--text-file`：

```bash
# 先用 write_file 把内容写到产物目录，例如 body.txt（cwd 即产物目录）
browserctl fill @e5 --text-file "$ARTIFACTS_DIR/body.txt"
```

或从管道读取：

```bash
echo "包含 & 和 \"引号\" 的内容" | browserctl fill @e5 --text-stdin
```

`--text-file` / `--text-stdin` 会去掉单个尾随换行；优先级：`--text-file` > `--text-stdin` > 位置参数。
