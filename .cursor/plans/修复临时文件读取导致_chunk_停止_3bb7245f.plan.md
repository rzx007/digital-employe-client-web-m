---
name: 修复临时文件读取导致 chunk 停止
overview: 加固 `aexecute` 中临时文件读取逻辑，防止文件读取异常导致 last_size 不更新、循环空转、chunk 停止输出。
todos:
  - id: "1"
    content: last_size 改为在 f.read() 后立即累加，移除 f.tell() 依赖
    status: completed
  - id: "2"
    content: 在 open() 前加 os.path.getsize 预检，无新数据时跳过
    status: completed
  - id: "3"
    content: 验证 Python 语法正确性
    status: completed
isProject: false
---

## 修改文件

[apps/server/src/service/skill_shell_backend.py](apps/server/src/service/skill_shell_backend.py) — `_read_lines_sync` 内部（第 139-196 行）

## 修改内容

### 1. `last_size` 立即更新（核心修复）

当前问题：`last_size = f.tell()` 在第 166 行，位于 `while True` 内层读取循环**之后**、`with` 块**内部**。如果内层循环中间 `_decode_output_bytes` 或 `queue.put_nowait` 抛异常，`last_size` 不会更新，下次读取从旧偏移开始，可能重复或越界。

修复：在内层 `while True` 中，每次成功 `f.read()` 后立即累加 `last_size`，不依赖 `f.tell()`：

```python
# 修改前
while True:
    chunk = f.read(_READ_CHUNK)
    if not chunk:
        break
    data = partial_line + chunk
    *complete_lines, partial_line = data.split(b'\n')
    for line_bytes in complete_lines:
        line = self._decode_output_bytes(line_bytes).rstrip("\r\n")
        loop.call_soon_threadsafe(queue.put_nowait, line)
last_size = f.tell()

# 修改后
while True:
    chunk = f.read(_READ_CHUNK)
    if not chunk:
        break
    last_size += len(chunk)  # 立即更新偏移量
    data = partial_line + chunk
    *complete_lines, partial_line = data.split(b'\n')
    for line_bytes in complete_lines:
        line = self._decode_output_bytes(line_bytes).rstrip("\r\n")
        loop.call_soon_threadsafe(queue.put_nowait, line)
# last_size 已在内层循环中更新，不再需要 f.tell()
```

### 2. 用 `os.path.getsize` 预检，减少无效 open

在打开文件前先检查文件大小是否增长，没有新数据就跳过 `open()`，减少 Windows 文件共享冲突概率：

```python
time.sleep(_POLL_SECONDS)

# 预检：文件是否有新数据
try:
    if os.path.getsize(_tmp_path) <= last_size:
        read_fail_count = 0
        continue
except OSError:
    pass

# 读取临时文件尾部增量
try:
    ...
```

## 不做的事

- 不改用 PIPE 替代临时文件（原始注释说明了 PIPE 会被子进程后代持有的问题）
- 不加文件锁（会增加复杂度且 Windows 文件锁语义复杂）
- 不重建临时文件（过于复杂，投入产出比不高）