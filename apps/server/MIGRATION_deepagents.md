# Deepagents 0.3.5 → 0.5.3 迁移报告

## 一、版本跨度概览

| 项目     | 0.3.5（旧） | 0.5.3（目标） |
| -------- | ----------- | ------------- |
| 发布日期 | 2026-01-09  | 2026-04-15    |
| 跨版本数 | —           | 20+ 个版本    |
| Python   | `>=3.11`    | `>=3.11`      |

### 依赖升级情况（已验证，无冲突）

| 包                    | 旧版本 | 新版本            |
| --------------------- | ------ | ----------------- |
| `deepagents`          | 0.3.5  | **0.5.3**         |
| `langchain`           | ~1.2.3 | **1.2.15**        |
| `langchain-core`      | —      | **1.2.28**        |
| `langchain-anthropic` | —      | **1.4.0**（新增） |
| `langchain-community` | ~0.3.0 | **0.4.1**         |
| `langchain-openai`    | ~1.0.2 | **1.1.12**        |
| `langgraph`           | ~1.0.6 | **1.1.6**         |

## 二、0.5.3 向后兼容性

0.5.3 内置了向后兼容桥接，旧方法名（`ls_info`/`grep_raw`/`glob_info`）仍可工作但触发 `DeprecationWarning`，将在 v0.7 移除。

## 三、实际改动文件

### 1. `src/service/custom_graph.py` — 删除

完全复制了 0.3.5 的 `deepagents/graph.py`，唯一差异是注释掉了 `SubAgentMiddleware`。
0.5.3 的 `create_deep_agent` 原生支持 `subagents=[]`（自动注入 general-purpose subagent，不影响主 agent 聊天功能）。

### 2. `src/service/agent.py` — 主要改动

#### 2a. Import 变更

```python
# 旧
from src.service.custom_graph import create_deep_agent
# 新
from deepagents import create_deep_agent
```

#### 2b. `PosixVirtualFilesystemBackend` 方法名迁移

0.5.3 的 `FilesystemBackend` 方法返回新的 Result 类型：

- `ls_info()` → `ls()` 返回 `LsResult`
- `read()` 返回 `ReadResult`（而非 `str`）
- `write()` 返回 `WriteResult`
- `edit()` 返回 `EditResult`

当前 `PosixVirtualFilesystemBackend` 只做路径标准化后透传 `super()`，所以直接调用 `super().ls()` 等新方法名即可，返回值自动是新类型。

#### 2c. `WindowsShellBackend` — 不改

只实现了 `execute()`/`upload_files()`/`download_files()`/`id`，没有重写被改名的方法。

#### 2d. `WindowsCompatibleCompositeBackend` — 构造函数适配

```python
# 旧
def __init__(self, shell_backend, default: StateBackend, routes):
    super().__init__(default=shell_backend, routes=routes)

# 新 — StateBackend() 无参数
def __init__(self, shell_backend, default, routes):
    super().__init__(default=shell_backend, routes=routes)
```

#### 2e. `get_agent()` — 去掉 factory lambda

```python
# 旧
def make_backend(runtime):
    return WindowsCompatibleCompositeBackend(
        shell_backend=shell_backend,
        default=StateBackend(runtime),
        routes={"/memories/": StoreBackend(runtime), ...}
    )
agent = create_deep_agent(..., backend=make_backend)

# 新
backend = WindowsCompatibleCompositeBackend(
    shell_backend=shell_backend,
    default=StateBackend(),
    routes={"/memories/": StoreBackend(), "/skills/": skills_fs, "/agent/": agent_fs}
)
agent = create_deep_agent(..., backend=backend)
```

### 3. `src/service/chat_service.py` — 不改

`create_deep_agent`、`CompositeBackend`、`FilesystemBackend`、`create_file_data` 全部向后兼容。

### 4. `pyproject.toml` — 已由 `uv add` 更新

## 四、迁移结果

- ✅ 依赖已安装（`uv add deepagents==0.5.3`），无冲突
- ✅ 删除 `custom_graph.py`
- ✅ `agent.py` 迁移到新 API
- ✅ `chat_service.py` 无需改动
- ✅ 业务逻辑完整保留：Windows 路径标准化、Windows 编码兼容、技能加载、内存持久化
