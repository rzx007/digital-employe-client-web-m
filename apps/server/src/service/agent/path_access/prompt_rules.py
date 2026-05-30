"""文件工具 prompt 文案：虚拟模式 vs 物理模式（三端）。

从 prompts.build_filesystem_prompt_section 抽出，便于维护与按模式切换。
"""

from __future__ import annotations

import platform

def build_file_tool_rules(
    *,
    virtual_mode: bool,
    artifacts_real_path: str = "",
) -> str:
    """返回「文件工具 + shell_execute」一节的文案。"""
    if virtual_mode:
        return """
        ### 文件工具（read_file / write_file / edit_file / ls）
        - **一律使用虚拟路径**，例如 /artifacts/report.md、/memories/AGENTS.md
        - **read_file 支持**：纯文本/代码直读；**图片**以多模态（base64）返回；**PDF / Word(.docx) / Excel(.xlsx) / PPT(.pptx)** 自动提取为文本（legacy .doc/.xls/.ppt 请转为新格式）
        - 用户上传附件在 **/uploads/**，相关时用 read_file 读取
        - **禁止**在虚拟路径前拼接磁盘绝对路径（如 /artifacts/Users/...、/artifacts/C:/...）
        - **禁止**把上表「真实物理路径」当作 write_file 的路径（那是磁盘路径，不是虚拟路径）
        - 调用 **write_file** / **edit_file** 时，工具参数 JSON **须先写 `file_path`，再写 `content`（`edit_file` 为 `new_string`）**

        ### shell_execute（python、cmd 等，替代内置 execute）
        - 使用工具 **`shell_execute`**，不要调用已废弃的 `execute`
        - 可使用上表**真实物理路径**，或 `/skills/`、`/artifacts/` 等虚拟前缀（shell 会自动映射为物理路径）
        """

    artifacts_hint = artifacts_real_path or "见上表"
    return f"""
        ### 文件工具（read_file / write_file / edit_file / ls）
        - **读取用户本机资料**（PDF、脚本、表格等）：用**本机绝对路径**，按系统区分：
          - Windows：`D:/space/标书/参考论文/xxx.pdf`（盘符 + `/`）
          - macOS：`/Users/you/Documents/xxx.pdf`
          - Linux：`/home/you/docs/xxx.pdf`
        - **交付给用户的成品**（报告、Word、导出数据）：**必须**写入 `/artifacts/`（物理目录：`{artifacts_hint}`）
        - **不要**把成品写到用户资料目录（如 D:/space/标书/…、/Users/…）除非用户明确要求；否则工作台看不到
        - `.md/.txt/.py` 等文本：优先 `write_file("/artifacts/文件名", …)`
        - `.docx/.xlsx/.pptx` 等二进制：**不能**用 write_file；用 shell_execute + python（docx 等库）**save 到产物目录**（相对路径即可，shell cwd 即该目录）
        - **Windows 禁止多行 `python -c "..."`**（cmd 会静默失败、exit 0 但不生成文件）；应 `write_file("/artifacts/xxx.py")` 再 `python -u xxx.py`
        - 运行已有脚本前先看脚本里的 `save`/`output` 路径；若写死到其他目录，执行后**到该绝对路径**验证，**不要**只在 cwd 下 `listdir('.')`
        - **read_file 支持**：PDF/Office 自动提取文本；图片多模态
        - **禁止**把虚拟前缀与磁盘路径混拼（如 `/artifacts/Users/...`、`/artifacts/C:/...`）；本机绝对路径直接写 `D:/...` 或 `/Users/...`
        - 调用 **write_file** / **edit_file** 时，JSON **须先写 `file_path`，再写 `content`**

        ### shell_execute（python、cmd 等，替代内置 execute）
        - 使用 **`shell_execute`**；默认 **cwd = 产物目录**（`{artifacts_hint}`）
        - 引用用户资料时用**完整本机绝对路径**；生成交付文件时可用**相对文件名**（cwd 即产物目录）
        - shell 命令中的 `/artifacts/`、`/uploads/`、`/skills/` 等虚拟前缀会**自动映射**为真实物理路径，可直接写 `python /artifacts/script.py`
        """


def build_shell_environment_section() -> str:
    """按当前 OS 返回 shell_execute 环境说明（Windows / macOS / Linux）。"""
    system = platform.system()
    python_hint = "执行 Python 脚本时优先使用无缓冲模式：python -u <script.py> ..."

    if system == "Windows":
        return f"""
        当前运行环境：**Windows**。shell_execute 使用 cmd.exe，请注意 Windows 命令规范：
        - 路径参数不要额外加引号，如 python script.py（不要 python "script.py"）
        - 若命令本身需要引号（如 findstr /c:"搜索文本"），外层用单引号括起来
        - 避免混用 PowerShell cmdlet 与 cmd 语法
        - **禁止多行** `python -c "..."`；应 write_file("/artifacts/xxx.py") 再 python -u xxx.py
        - {python_hint}
        """

    if system == "Darwin":
        return f"""
        当前运行环境：**macOS**。shell_execute 使用 bash/zsh：
        - 本机绝对路径示例：`/Users/you/Documents/file.pdf`
        - 路径含空格时用引号：`python "/Users/you/my script.py"`
        - 优先 `python3`；若仅有 `python` 则沿用环境默认
        - {python_hint}
        """

    return f"""
        当前运行环境：**Linux**。shell_execute 使用 bash/sh：
        - 本机绝对路径示例：`/home/you/docs/file.pdf`
        - 路径含空格时用引号：`python "/home/you/my script.py"`
        - 优先 `python3`；若仅有 `python` 则沿用环境默认
        - {python_hint}
        """
