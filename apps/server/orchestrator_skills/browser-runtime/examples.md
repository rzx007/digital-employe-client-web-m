# browser-runtime 组合示例

## 百度搜索

```bash
browserctl health
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
