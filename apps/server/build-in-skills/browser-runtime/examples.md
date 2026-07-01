# browser-runtime 组合示例

命令全集与错误码见 [reference.md](reference.md)；工作流原则见 [SKILL.md](SKILL.md)。

## 百度搜索

```bash
browserctl open https://www.baidu.com
browserctl snapshot --interactive
browserctl fill "#kw" "数字员工"
browserctl click "#su"
# 或语义定位（无需 snapshot @eN）：
# browserctl find role button click --name "百度一下"
browserctl wait --selector "#content_left"   # 等结果容器出现，再读取
browserctl snapshot --interactive
browserctl get value "#kw"                   # 校验 fill 已落地（也可用 @eN）
```

如果选择器失效，使用 snapshot 返回的 `@eN`：

```bash
browserctl fill @e4 "数字员工"
browserctl click @e8
browserctl wait --selector "#content_left"
browserctl get value @e4
```

慢页面 / 大页面变体：

```bash
browserctl open https://www.baidu.com
browserctl wait --load networkidle --timeout 15000
browserctl snapshot --interactive -c -d 4    # -c 裁剪 null 字段，-d 限深省 token
browserctl fill @e4 "数字员工"
browserctl click @e8
browserctl wait --selector "#content_left"
```

## OA 表单提交

```bash
browserctl open https://oa.example.com/overtime/new
browserctl snapshot --interactive
browserctl fill @e3 "2026-06-03 19:00"
browserctl fill @e4 "2026-06-03 21:00"
browserctl fill @e5 "项目上线支持"
browserctl check @e6                        # 勾选「已阅读须知」类 checkbox
browserctl click @e9 --confirm "确认提交 19:00-21:00 加班申请？"
browserctl wait --text "提交成功"           # 按实际结果文案/元素调整
browserctl get value @e5                    # 校验填写已落地
browserctl extract-text
```

提交、删除、付款、审批等动作必须带 `--confirm`。

## iframe 内的表单（同源子页）

很多 OA/ERP 用同源 iframe 承载子页面。`snapshot` 会自动遍历同源 iframe，iframe 内的控件直接出现在 `@eN` 列表里，照常操作——**iframe 内只能用 `@eN`，CSS 选择器不跨 frame**（选择器只在主文档生效）。`-s` / `--scope` 仅限定主 frame 子树，iframe 子树仍按现有逻辑收集。

```bash
browserctl open https://erp.example.com/order
browserctl snapshot --interactive
browserctl fill @e7 "ORD-20260626-001"
browserctl select @e9 --label "华东仓"
browserctl click @e12 --confirm "确认创建订单？"
browserctl wait --text "创建成功"
browserctl get value @e7
```

跨源 iframe（不同域、独立进程）会被自动跳过、不影响主页面；若必须操作跨源 iframe 内部，当前版本不支持。

## fill 与 type（清空 vs 追加）

`fill` 先清空再输入；`type` 在当前焦点处追加，不清空：

```bash
browserctl fill @e4 "完整替换内容"
browserctl focus @e4
browserctl type @e4 " 追加后缀"
browserctl get value @e4
```

## 等待变体（操作后页面异步变化）

```bash
# 等 URL 跳转（glob，* 通配）
browserctl click @e3
browserctl wait --url "https://oa.example.com/dashboard*"

# 等网络空闲（慢 SPA / 多资源页）
browserctl open https://www.taobao.com
browserctl wait --load networkidle --timeout 30000

# 等自定义 JS 条件
browserctl wait --fn "document.querySelector('.data-ready') !== null"

# 等弹窗消失
browserctl click @e9                        # 点关闭
browserctl wait --selector "#modal" --state hidden
browserctl snapshot --interactive
```

复杂 JS 条件可写文件，避免 shell 转义：

```bash
browserctl wait --fn-file "$ARTIFACTS_DIR/ready.js"
```

## 勾选与文件上传

```bash
browserctl snapshot --interactive
browserctl check @e5                        # 勾选条款
browserctl uncheck @e6                      # 取消误勾
browserctl upload @e8 ./attachment.pdf ./appendix.xlsx
browserctl click @e12 --confirm "确认上传并提交？"
browserctl wait --text "上传成功"
```

## 拖拽（排序 / 看板）

```bash
browserctl snapshot --interactive
browserctl drag @e6 @e7                     # 从 @e6 拖到 @e7
browserctl wait --ms 500
browserctl snapshot --interactive
```

## 带标注截图（HITL / 人工确认）

理解页面仍优先 `snapshot --interactive` + `extract-text`；带标注截图供人工或视觉模型对照 `@eN`：

```bash
browserctl snapshot --interactive
browserctl screenshot --annotate --out ./confirm.png
# stdout 返回 { path, bytes, annotations:[{ref,number,role,name?,box}] }
browserctl click @e8 --confirm "确认点击提交按钮？"
```

> OOPIF 跨源 iframe 的 `@eN` 不参与 annotate（主 session 无法 resolve，静默跳过）。

## 填入含特殊字符的长文本（规避 quoting）

文本含引号、`&`、`|`、换行等会破坏命令行解析的字符时，先写入文件再用 `--text-file`：

```bash
# 先用 write_file 把内容写到产物目录，例如 body.txt（cwd 即产物目录）
browserctl fill @e5 --text-file "$ARTIFACTS_DIR/body.txt"
browserctl type @e5 --text-file "$ARTIFACTS_DIR/suffix.txt"   # type 同样支持
```

或从管道读取：

```bash
echo "包含 & 和 \"引号\" 的内容" | browserctl fill @e5 --text-stdin
```

`--text-file` / `--text-stdin` 会去掉单个尾随换行；优先级：`--text-file` > `--text-stdin` > 位置参数。`wait --fn` 同理支持 `--fn-file` / `--fn-stdin`。

## find 语义定位（无需 snapshot）

固定布局页可直接定位 + 动作，省去 snapshot 往返：

```bash
browserctl open https://www.baidu.com
browserctl find role button click --name "百度一下"
browserctl find first "#kw" fill "数字员工"
browserctl wait --selector "#content_left"
browserctl get text "#content_left"
```

## eval 与 load 等待

```bash
browserctl open https://example.com
browserctl eval "document.title"
browserctl wait --load domcontentloaded
browserctl wait --load load --timeout 15000
browserctl is visible "#main"
```

## 历史导航

```bash
browserctl open https://www.baidu.com
browserctl find first "#kw" fill "test"
browserctl find role button click --name "百度一下"
browserctl wait --load networkidle
browserctl back
browserctl reload
browserctl get url
```

## JavaScript 弹窗（confirm / prompt）

`alert`/`beforeunload` 自动 accept；`confirm`/`prompt` 需显式处理：

```bash
browserctl click @e5                    # 触发 confirm
browserctl dialog status                # { pending: true, type, message? }
browserctl dialog accept                # 或 dialog dismiss
browserctl wait --ms 300
browserctl snapshot --interactive
```

## batch（少 shell 往返）

```bash
browserctl batch --bail \
  "open https://www.baidu.com" \
  "find first \"#kw\" fill \"数字员工\"" \
  "find role button click --name \"百度一下\"" \
  "wait --selector \"#content_left\"" \
  "get url"
```

`--bail`：首条 `ok:false` 即停；不可嵌套 `batch`。
