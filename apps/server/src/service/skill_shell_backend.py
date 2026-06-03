import asyncio
import logging
import os
import re
import shlex
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Callable

from deepagents.backends import LocalShellBackend
from deepagents.backends.protocol import EditResult, ExecuteResponse, ReadResult

from src.service.agent.basic_file_backend import basic_file_edit, basic_file_read
from src.service.agent.path_access.virtual_paths import map_virtual_token

logger = logging.getLogger(__name__)


def _truncation_notice(limit_desc: str) -> str:
    """可纠偏的截断提示：告诉模型输出被截断了、以及如何拿到剩余内容，
    避免模型误以为结果到此为止（参考 Anthropic「工具报错/截断应给可执行的纠正方向」）。"""
    return (
        f"\n\n[输出已截断（{limit_desc}）。这不是完整结果；如需更多，请缩小命令范围"
        "或分页（如 head/tail/grep/sed -n），或先把结果写入文件再用 read_file 分段查看。]"
    )


# 常见命令失败 → 可纠偏建议（给可执行方向，而非把裸 stderr/堆栈丢回模型瞎试）。
# 依据 Anthropic《Writing tools for agents》：工具报错应 steering。
_ERROR_HINTS: list = [
    (
        re.compile(r"ModuleNotFoundError: No module named ['\"]([\w.]+)['\"]"),
        lambda m: (
            f"缺少 Python 库 {m.group(1)}。先 `pip install {m.group(1).split('.')[0]}` "
            "再重试；离线环境装不了则改用标准库等价实现。"
        ),
    ),
    (
        re.compile(r"(No such file or directory|FileNotFoundError|系统找不到指定的)"),
        lambda m: (
            "文件/路径不存在。先用 ls 或 read_file 确认真实路径"
            "（注意 /artifacts/ 等虚拟前缀的物理映射），再重试。"
        ),
    ),
    (
        re.compile(r"(command not found|不是内部或外部命令|未找到命令)"),
        lambda m: "命令不存在或未安装。换用已有的等价工具，或先确认该命令在当前环境可用。",
    ),
    (
        re.compile(r"(SyntaxError|IndentationError)"),
        lambda m: "代码语法/缩进错误。按报错行号修正后重试，不要原样重跑。",
    ),
    (
        re.compile(r"(Permission denied|拒绝访问|PermissionError)"),
        lambda m: "权限不足。改写到 /artifacts/ 产物目录，勿写系统或只读路径。",
    ),
]


def _steer_on_error(output: str) -> str:
    """命令失败时按常见错误模式追加一句可执行建议；无匹配返回空串。"""
    for pattern, hint in _ERROR_HINTS:
        match = pattern.search(output)
        if match:
            return f"\n[建议] {hint(match)}"
    return ""


class SkillAwareShellBackend(LocalShellBackend):
    """执行前将虚拟技能路径映射为真实物理路径。"""

    def __init__(
        self,
        *,
        root_dir: str,
        skills_root: Path,
        draft_root: Path | None,
        memories_root: Path | None = None,
        uploads_root: Path | None = None,
        virtual_mode: bool = True,
        inherit_env: bool = True,
        timeout: int = 30,
        max_output_bytes: int = 100_000,
    ):
        super().__init__(
            root_dir=root_dir,
            virtual_mode=virtual_mode,
            inherit_env=inherit_env,
            timeout=timeout,
            max_output_bytes=max_output_bytes,
        )
        self._artifacts_dir = Path(root_dir).resolve()
        self._skills_root = skills_root.resolve()
        self._draft_root = draft_root.resolve() if draft_root is not None else None
        self._memories_root = (
            memories_root.resolve() if memories_root is not None else None
        )
        self._uploads_root = (
            uploads_root.resolve() if uploads_root is not None else None
        )
        if os.name == "nt":
            self._env.setdefault("PYTHONUTF8", "1")
            self._env.setdefault("PYTHONIOENCODING", "utf-8")

    @property
    def artifacts_dir(self) -> Path:
        return self._artifacts_dir

    def format_shell_output(self, response: ExecuteResponse) -> str:
        output = (response.output or " ").rstrip()
        if response.exit_code != 0:
            return output + "\n"
        footer = (
            f"\n\n[shell 工作目录: {self.cwd}]\n"
            f"[会话产物目录（write_file 用 /artifacts/…）: {self._artifacts_dir}]\n"
            "[说明: shell 默认 cwd 即产物目录；运行外部脚本若 save 到其他绝对路径，"
            "请到该路径验证，勿仅用 listdir('.') 判断失败]"
        )
        return output + footer

    def read(
        self,
        file_path: str,
        offset: int = 0,
        limit: int = 2000,
    ) -> ReadResult:
        """PDF/Office 走文本提取，与 /uploads/、/artifacts/ 路由一致。"""
        return basic_file_read(self, file_path, offset=offset, limit=limit)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        """纯文本 edit：读时编码回退，写回统一 UTF-8。"""
        return basic_file_edit(
            self,
            file_path,
            old_string,
            new_string,
            replace_all=replace_all,
        )

    def _map_virtual_token(self, token: str) -> str:
        return map_virtual_token(
            token,
            skills_root=self._skills_root,
            draft_root=self._draft_root,
            memories_root=self._memories_root,
            artifacts_root=self._artifacts_dir,
            uploads_root=self._uploads_root,
        )

    def _extract_python_c_code(self, command: str) -> str | None:
        """从 `python -c '...'` / `python -u -c "..."` 提取代码体。"""
        stripped = command.strip()
        match = re.match(
            r"python(?:\s+-u)?\s+-c\s+(?P<q>['\"])(?P<code>[\s\S]*)(?P=q)\s*$",
            stripped,
            re.IGNORECASE,
        )
        if match:
            return match.group("code")
        return None

    def _materialize_multiline_python_c(self, command: str) -> str:
        """Windows cmd 无法可靠执行多行 python -c；落盘为临时 .py 再运行。"""
        if os.name != "nt" or "\n" not in command:
            return command
        if "python" not in command.lower() or "-c" not in command.lower():
            return command

        code = self._extract_python_c_code(command)
        if not code:
            logger.warning(
                "[shell] multiline python -c detected but failed to extract code; "
                "command may silently fail on Windows cmd"
            )
            return command

        script_path = self.cwd / f"_agent_exec_{uuid.uuid4().hex[:8]}.py"
        script_path.write_text(code, encoding="utf-8", newline="\n")
        logger.info("[shell] materialized multiline python -c to %s", script_path)
        return f'python -u "{script_path}"'

    def _prepare_shell_command(self, command: str) -> str:
        command = self._materialize_multiline_python_c(command)
        return self._rewrite_command_virtual_paths(command)

    def _rewrite_command_virtual_paths(self, command: str) -> str:
        # 始终 rewrite /skills/ 等虚拟前缀为物理路径：这是 shell 命令映射的产品逻辑，
        # 与 LocalShellBackend.virtual_mode（控制 cwd / 沙箱）无关，物理模式下同样需要。
        try:
            parts = shlex.split(command, posix=False)
        except ValueError:
            return command

        changed = False
        for i, part in enumerate(parts):
            quote = ""
            raw = part
            if len(part) >= 2 and part[0] == part[-1] and part[0] in {"'", '"'}:
                quote = part[0]
                raw = part[1:-1]
            mapped = self._map_virtual_token(raw)
            if mapped != raw:
                parts[i] = f"{quote}{mapped}{quote}" if quote else mapped
                changed = True

        if not changed:
            return command
        return subprocess.list2cmdline(parts)

    def _get_stream_writer(self) -> Callable[[dict], None]:
        try:
            from langgraph.config import get_stream_writer
            writer = get_stream_writer()
            if writer is None:
                logger.warning("[shell] get_stream_writer() returned None")
            return writer
        except Exception as e:
            logger.warning("[shell] get_stream_writer() failed: %s", e)
            return lambda _: None

    async def aexecute(
        self,
        command: str,
        *,
        timeout: int | None = None,
        tool_call_id: str | None = None,
    ):
        rewritten = self._prepare_shell_command(command)
        effective_timeout = timeout if timeout is not None else self._default_timeout
        if effective_timeout <= 0:
            raise ValueError(f"timeout must be positive, got {effective_timeout}")

        stream_writer = self._get_stream_writer()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        # 取消信号：async 侧设 Event，线程函数在 finally 中检查并杀进程
        cancel_requested = threading.Event()
        # 用容器把子进程引用从线程暴露给 async 侧，以便直接 kill
        _proc_ref: list[subprocess.Popen] = []
        # 临时文件替代 subprocess.PIPE，避免子进程启动的后代进程（如浏览器）
        # 持有 PIPE 写端句柄不释放，导致 proc.stdout 永远等不到 EOF 而挂起
        _tmp_path: str | None = None
        _POLL_SECONDS = 0.1
        _PARTIAL_EMIT_SECONDS = 0.3
        _READ_CHUNK = 65536       # 文件分块读取大小，控制内存峰值
        _MAX_TMPFILE_BYTES = 1024 * 1024  # 临时文件上限 1MB，防磁盘写满

        def _read_incremental_from_tmp(
            last_size: int,
            partial_line: bytes,
        ) -> tuple[int, bytes, list[bytes]]:
            """从临时 stdout 文件读取增量，按行切分；无换行尾部留在 partial_line。"""
            nonlocal _tmp_path
            complete_lines: list[bytes] = []
            try:
                if os.path.getsize(_tmp_path) <= last_size:
                    return last_size, partial_line, complete_lines
            except OSError:
                return last_size, partial_line, complete_lines

            try:
                with open(_tmp_path, "rb") as f:
                    f.seek(last_size)
                    while True:
                        chunk = f.read(_READ_CHUNK)
                        if not chunk:
                            break
                        last_size += len(chunk)
                        data = partial_line + chunk
                        *lines, partial_line = data.split(b"\n")
                        complete_lines.extend(lines)
            except OSError as e:
                logger.warning(
                    "[shell] tmpfile read error at offset %d: %s",
                    last_size,
                    e,
                )
            return last_size, partial_line, complete_lines

        def _emit_complete_lines(complete_lines: list[bytes]) -> None:
            for line_bytes in complete_lines:
                line = self._decode_output_bytes(line_bytes).rstrip("\r\n")
                loop.call_soon_threadsafe(queue.put_nowait, line)

        def _emit_partial_line(partial_line: bytes) -> None:
            if not partial_line:
                return
            line = self._decode_output_bytes(partial_line).rstrip("\r\n")
            if line:
                loop.call_soon_threadsafe(queue.put_nowait, line)

        def _read_lines_sync() -> int:
            nonlocal _tmp_path
            tmp = tempfile.NamedTemporaryFile(mode='wb', delete=False, suffix='.stdout')
            tmp.close()
            _tmp_path = tmp.name

            env = {**self._env, "PYTHONUNBUFFERED": "1"}
            stdout_handle = open(_tmp_path, 'ab')
            proc = subprocess.Popen(  # noqa: S602
                rewritten,
                stdout=stdout_handle,            # stdout → 临时文件，不用 PIPE
                stderr=subprocess.STDOUT,
                shell=True,
                env=env,
                cwd=str(self.cwd),
            )
            stdout_handle.close()                # 释放本进程对文件的引用
            _proc_ref.append(proc)

            try:
                last_size = 0
                partial_line = b""
                last_partial_emit = 0.0

                while True:
                    if proc.poll() is not None:
                        # 子进程已退出：务必最后再读一次 stdout 文件，避免
                        # curl -s 等无换行输出在 poll 与写盘之间的竞态丢失。
                        last_size, partial_line, complete_lines = (
                            _read_incremental_from_tmp(last_size, partial_line)
                        )
                        _emit_complete_lines(complete_lines)
                        _emit_partial_line(partial_line)
                        partial_line = b""
                        break
                    if cancel_requested.is_set():
                        break

                    time.sleep(_POLL_SECONDS)

                    last_size, partial_line, complete_lines = (
                        _read_incremental_from_tmp(last_size, partial_line)
                    )
                    if complete_lines:
                        _emit_complete_lines(complete_lines)

                    if last_size > _MAX_TMPFILE_BYTES:
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            _truncation_notice("超过 1MB").lstrip("\n"),
                        )
                        break

                    # 无换行输出（如 curl -s 单行 JSON）运行中也推送，避免 UI 长时间空白
                    now = time.monotonic()
                    if (
                        partial_line
                        and now - last_partial_emit >= _PARTIAL_EMIT_SECONDS
                    ):
                        _emit_partial_line(partial_line)
                        last_partial_emit = now

                proc.wait()
            finally:
                # 双保险：线程侧也检查取消信号，确保无论谁先触发都能清
                if cancel_requested.is_set() and proc.poll() is None:
                    proc.kill()
                    proc.wait()
                loop.call_soon_threadsafe(queue.put_nowait, None)
                try:
                    os.unlink(_tmp_path)
                except Exception:
                    logger.warning(
                        "[shell] failed to delete tmpfile %s", _tmp_path, exc_info=True
                    )
            return proc.returncode

        future = loop.run_in_executor(None, _read_lines_sync)

        lines: list[str] = []
        seq = 0
        timed_out = False
        current_output_size = 0

        _BATCH_LINES = 20
        _BATCH_SECONDS = 0.3
        _batch: list[tuple[str, int]] = []
        _last_batch_emit = time.monotonic()

        def _emit_batch():
            nonlocal _last_batch_emit
            for chunk_line, chunk_seq in _batch:
                payload: dict = {
                    "tool_name": "shell_execute",
                    "chunk": chunk_line,
                    "chunk_seq": chunk_seq,
                    "stream": "stdout",
                }
                if tool_call_id:
                    payload["tool_call_id"] = tool_call_id
                stream_writer({
                    "type": "tool_output",
                    "data": payload,
                })
            _batch.clear()
            _last_batch_emit = time.monotonic()

        # completed_normally 用于标记子进程是自行退出（收到 None），
        # 而非超时 / 取消 / 异常终止。finally 块据此决定是否杀进程。
        completed_normally = False
        try:
            while True:
                try:
                    line = await asyncio.wait_for(queue.get(), timeout=effective_timeout)
                except asyncio.TimeoutError:
                    timed_out = True
                    break
                if line is None:
                    completed_normally = True
                    break

                if current_output_size < self._max_output_bytes:
                    lines.append(line)
                    current_output_size += len(line) + 1

                seq += 1
                _batch.append((line, seq))
                now = time.monotonic()
                if len(_batch) >= _BATCH_LINES or now - _last_batch_emit >= _BATCH_SECONDS:
                    _emit_batch()

            _emit_batch()
        finally:
            # 非正常退出（超时 / 取消 / 异常）：通知线程杀子进程，避免孤儿进程
            if not completed_normally:
                cancel_requested.set()
                if _proc_ref:
                    proc = _proc_ref[0]
                    if proc.poll() is None:
                        try:
                            proc.kill()
                        except Exception:
                            pass
                try:
                    _emit_batch()
                except Exception:
                    pass
                # 等线程函数收尾（kill 后 proc.wait()），最长等 10s
                try:
                    await asyncio.wait_for(asyncio.shield(future), timeout=10)
                except Exception:
                    pass

        try:
            exit_code = await asyncio.wait_for(
                asyncio.shield(future), timeout=5,
            )
        except (asyncio.TimeoutError, Exception):
            exit_code = -1

        if timed_out:
            output = "\n".join(lines) if lines else ""
            if len(output) > self._max_output_bytes:
                output = output[: self._max_output_bytes]
                output += _truncation_notice(f"{self._max_output_bytes} 字节上限")
            return ExecuteResponse(
                output=output or " ",
                exit_code=124,
                truncated=bool(lines),
            )

        output = "\n".join(lines) if lines else " "
        truncated = False
        if len(output) > self._max_output_bytes:
            output = output[: self._max_output_bytes]
            output += _truncation_notice(f"{self._max_output_bytes} 字节上限")
            truncated = True

        if exit_code != 0:
            hint = _steer_on_error(output)
            output = f"{output.rstrip()}\n\nExit code: {exit_code}{hint}"

        return ExecuteResponse(output=output, exit_code=exit_code, truncated=truncated)

    def execute(self, command: str, *, timeout: int | None = None):
        rewritten = self._prepare_shell_command(command)
        effective_timeout = timeout if timeout is not None else self._default_timeout
        if effective_timeout <= 0:
            raise ValueError(f"timeout must be positive, got {effective_timeout}")

        try:
            # Windows 下不要用 text=True。
            # 部分技能脚本会输出 UTF-8 字节，而父进程默认按 GBK 解码，
            # 会在 subprocess 读取线程触发 UnicodeDecodeError，
            # 最终出现“exit code=0 但无输出”的假象。
            result = subprocess.run(  # noqa: S602
                rewritten,
                check=False,
                shell=True,
                capture_output=True,
                text=False,
                timeout=effective_timeout,
                env=self._env,
                cwd=str(self.cwd),
            )

            stdout = self._decode_output_bytes(result.stdout)
            stderr = self._decode_output_bytes(result.stderr)

            output_parts: list[str] = []
            if stdout:
                output_parts.append(stdout)
            if stderr:
                stderr_lines = stderr.strip().split("\n")
                output_parts.extend(f"[stderr] {line}" for line in stderr_lines if line)

            output = "\n".join(output_parts) if output_parts else " "

            truncated = False
            if len(output) > self._max_output_bytes:
                output = output[: self._max_output_bytes]
                output += _truncation_notice(f"{self._max_output_bytes} 字节上限")
                truncated = True

            if result.returncode != 0:
                hint = _steer_on_error(output)
                output = f"{output.rstrip()}\n\nExit code: {result.returncode}{hint}"

            return ExecuteResponse(
                output=output,
                exit_code=result.returncode,
                truncated=truncated,
            )
        except subprocess.TimeoutExpired:
            if timeout is not None:
                msg = (
                    f"Error: Command timed out after {effective_timeout} seconds "
                    "(custom timeout). The command may be stuck or require more time."
                )
            else:
                msg = (
                    f"Error: Command timed out after {effective_timeout} seconds. "
                    "For long-running commands, re-run using the timeout parameter."
                )
            return ExecuteResponse(output=msg, exit_code=124, truncated=False)
        except Exception as exc:
            return ExecuteResponse(
                output=f"Error executing command ({type(exc).__name__}): {exc}",
                exit_code=1,
                truncated=False,
            )

    @staticmethod
    def _decode_output_bytes(data: bytes) -> str:
        if not data:
            return ""
        # 优先 utf-8，保证跨平台脚本输出一致；
        # 再回退到常见 Windows 编码，兼容老工具。
        for encoding in ("utf-8", "gbk", "cp936"):
            try:
                return data.decode(encoding)
            except UnicodeDecodeError:
                continue
        return data.decode("utf-8", errors="replace")
