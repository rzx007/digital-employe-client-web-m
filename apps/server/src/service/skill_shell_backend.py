import asyncio
import os
import shlex
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable

from deepagents.backends import LocalShellBackend
from deepagents.backends.protocol import ExecuteResponse


class SkillAwareShellBackend(LocalShellBackend):
    """执行前将虚拟技能路径映射为真实物理路径。"""

    def __init__(
        self,
        *,
        root_dir: str,
        skills_root: Path,
        draft_root: Path | None,
        virtual_mode: bool = True,
        inherit_env: bool = True,
        timeout: int = 30,
    ):
        super().__init__(
            root_dir=root_dir,
            virtual_mode=virtual_mode,
            inherit_env=inherit_env,
            timeout=timeout,
        )
        self._skills_root = skills_root.resolve()
        self._draft_root = draft_root.resolve() if draft_root is not None else None

    def _map_virtual_token(self, token: str) -> str:
        normalized = token.replace("\\", "/")
        if normalized == "/skills":
            return str(self._skills_root)
        if normalized.startswith("/skills/"):
            suffix = normalized[len("/skills/") :]
            return str((self._skills_root / suffix).resolve())
        if self._draft_root is None:
            return token
        if normalized == "/skills-draft":
            return str(self._draft_root)
        if normalized.startswith("/skills-draft/"):
            suffix = normalized[len("/skills-draft/") :]
            return str((self._draft_root / suffix).resolve())
        return token

    def _rewrite_command_virtual_paths(self, command: str) -> str:
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
            return get_stream_writer()
        except Exception:
            return lambda _: None

    async def aexecute(self, command: str, *, timeout: int | None = None):
        rewritten = self._rewrite_command_virtual_paths(command)
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
        _POLL_SECONDS = 0.5
        _READ_CHUNK = 65536       # 文件分块读取大小，控制内存峰值
        _MAX_TMPFILE_BYTES = 1024 * 1024  # 临时文件上限 1MB，防磁盘写满

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
                partial_line = b''
                file_truncated = False

                while True:
                    if proc.poll() is not None:   # 子进程已退出
                        break
                    if cancel_requested.is_set():  # 外部取消
                        break

                    time.sleep(_POLL_SECONDS)

                    # 读取临时文件尾部增量（分块读，64KB / chunk）
                    try:
                        with open(_tmp_path, 'rb') as f:
                            f.seek(last_size)
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
                            if last_size > _MAX_TMPFILE_BYTES:
                                file_truncated = True
                                break
                    except Exception:
                        continue

                    if file_truncated:
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            "... Output truncated (超过 1MB)",
                        )
                        break

                # flush 末尾不完整行
                if partial_line:
                    line = self._decode_output_bytes(partial_line).rstrip("\r\n")
                    loop.call_soon_threadsafe(queue.put_nowait, line)
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
                    pass
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
                stream_writer({
                    "type": "tool_output",
                    "data": {
                        "tool_name": "execute",
                        "chunk": chunk_line,
                        "chunk_seq": chunk_seq,
                        "stream": "stdout",
                    },
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
                output += f"\n\n... Output truncated at {self._max_output_bytes} bytes."
            return ExecuteResponse(
                output=output or " ",
                exit_code=124,
                truncated=bool(lines),
            )

        output = "\n".join(lines) if lines else " "
        truncated = False
        if len(output) > self._max_output_bytes:
            output = output[: self._max_output_bytes]
            output += f"\n\n... Output truncated at {self._max_output_bytes} bytes."
            truncated = True

        if exit_code != 0:
            output = f"{output.rstrip()}\n\nExit code: {exit_code}"

        return ExecuteResponse(output=output, exit_code=exit_code, truncated=truncated)

    def execute(self, command: str, *, timeout: int | None = None):
        rewritten = self._rewrite_command_virtual_paths(command)
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
                output += (
                    f"\n\n... Output truncated at {self._max_output_bytes} bytes."
                )
                truncated = True

            if result.returncode != 0:
                output = f"{output.rstrip()}\n\nExit code: {result.returncode}"

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
