# path_access 剥离指南

当 deepagents 原生支持「文件工具直接读本机绝对路径」（`read_file("/Users/...")` /
`read_file("C:/...")` 无需 patch 即可工作）时，按以下步骤移除 shim 层：

1. 升级 deepagents 后验证：在 `AGENT_VIRTUAL_MODE=0` 下，直接 `read_file` 一个本机
   绝对路径，确认无需 monkey-patch 即可读取。
2. 删除 [`validate_path_shim.py`](validate_path_shim.py)。
3. 简化 [`__init__.py`](__init__.py) 的 `install()`：改为 no-op，或删除 `install()`
   并移除 [`server.py`](../../../server.py) 中的 `install_agent_path_access()` 调用。
4. 删除 [`tests/test_validate_path_shim.py`](../../../../tests/test_validate_path_shim.py)。

保留（仍是产品逻辑，与 deepagents 无关）：

- `host_paths.py` / `virtual_paths.py` — prompt 与 shell 命令 rewrite 仍依赖
- `prompt_rules.py` — 文件工具 prompt 文案
- `skill_shell_backend.py` 中对 `/skills/` 等虚拟前缀的命令 rewrite

可选：移除 `AGENT_VIRTUAL_MODE` env（桌面端永远 physical），或保留 `=1` 作 CI / 沙箱回退。

预计改动面：3 个文件删除/清空 + 1 行 server 调用，不动 agent 构建主流程。

完整架构、测试与已知限制见 [`docs/path-access-recap.md`](../../../docs/path-access-recap.md)。
