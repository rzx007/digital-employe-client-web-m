"""文件工具 prompt 文案：虚拟模式 vs 物理模式（三端）。

从 prompts.build_filesystem_prompt_section 抽出，便于维护与按模式切换。
"""

from __future__ import annotations

import platform

def build_file_tool_rules(
    *,
    virtual_mode: bool = False,
    artifacts_real_path: str = "",
) -> str:
    """返回「文件工具 + shell_execute」一节的文案（真实路径模式，唯一形态）。"""
    artifacts_hint = artifacts_real_path or "见上表 $ARTIFACTS_DIR"
    return f"""
        ### 文件工具（read_file / write_file / edit_file / ls）
        - **一律使用真实磁盘绝对路径**（不存在任何虚拟前缀），按系统区分：
          - Windows：`D:/space/标书/参考论文/xxx.pdf`（盘符 + `/`）
          - macOS：`/Users/you/Documents/xxx.pdf`
          - Linux：`/home/you/docs/xxx.pdf`
        - **交付给用户的成品**（报告、Word、导出数据）：写入**产物目录** `{artifacts_hint}`（也可用环境变量 `$ARTIFACTS_DIR`，shell 默认 cwd 即此目录）
        - **技能可读可改**：技能在 `$SKILLS_DIR`（草稿在 `$SKILLS_DRAFT_DIR`），可直接 read_file/edit_file 修改 SKILL.md 等
        - 用户上传附件在 `$UPLOADS_DIR`；记忆目录在 `$MEMORIES_DIR`
        - **找/复用产物（含队友的）**：项目的**共享产物区**就是 `$ARTIFACTS_DIR`（亦即 `$WORKSPACE_DIR`），全队同写同读、扁平无子目录分层；要复用旧成果先 `ls $ARTIFACTS_DIR` 再 read
        - **共享给队友/取用队友的**：直接写/读 `$ARTIFACTS_DIR` 即可（同一个共享区，不再有单独的公共区）
        - **不要**把成品写到用户资料目录（如 D:/space/标书/…、/Users/…）除非用户明确要求；否则工作台看不到
        - `.docx/.xlsx/.pptx` 等二进制：**不能**用 write_file；用 shell_execute + python（docx 等库）**save 到产物目录**（相对文件名即可，shell cwd 即该目录）
        - **Windows 禁止多行 `python -c "..."`**（cmd 会静默失败、exit 0 但不生成文件）；应先 write_file 落盘 `.py` 再 `python -u xxx.py`
        - 运行已有脚本前先看脚本里的 `save`/`output` 路径；若写死到其他目录，执行后**到该绝对路径**验证，**不要**只在 cwd 下 `listdir('.')`
        - **read_file 支持**：PDF/Office 自动提取文本；图片多模态
        - 调用 **write_file** / **edit_file** 时，JSON **须先写 `file_path`，再写 `content`（`edit_file` 为 `new_string`）**
        - **write_file 仅用于新建**（目标路径尚不存在）；**禁止**对已有文件再次 write_file（会报 already exists）
        - **重写 / 改脚本 / 整段替换**：若 read_file 已成功 → **只用 edit_file**（`old_string`=读到的完整原文，`new_string`=新全文）；**禁止**对同一路径再 write_file；**勿**删文件、**勿**换文件名
        - 口头说 rewrite 时仍须调 **edit_file**，不要误调 write_file（界面会显示「创建」且必然失败）
        - 仅当确实要保留旧版并行留档时，才 write_file 到新路径（如 xxx_v2.py）

        ### shell_execute（python、cmd 等，替代内置 execute）
        - 使用 **`shell_execute`**；默认 **cwd = 产物目录**（`{artifacts_hint}`）
        - 路径用**真实绝对路径**或环境变量（`$ARTIFACTS_DIR`/`$SKILLS_DIR`/`$UPLOADS_DIR`/`$MEMORIES_DIR`）；生成交付文件可用**相对文件名**（cwd 即产物目录）
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
        - **禁止多行** `python -c "..."`；应先 write_file 落盘 `xxx.py`（产物目录，相对文件名即可）再 python -u xxx.py
        - **Python 脚本内禁止直接 `subprocess.run(["lark-cli", ...])`**：Windows subprocess 不走 PATHEXT，找不到 `.cmd` 包装命令；改用 `shell_execute` 直接执行，或用 `subprocess.run(["cmd", "/c", "lark-cli", ...])` 过 cmd.exe 代理
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
