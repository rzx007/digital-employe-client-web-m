import asyncio
import shlex
import subprocess
from pathlib import Path

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

    # async def aexecute(self, command: str, *, timeout: int | None = None):
    #     rewritten = self._rewrite_command_virtual_paths(command)
    #     effective_timeout = timeout if timeout is not None else self._default_timeout
    #     if effective_timeout <= 0:
    #         raise ValueError(f"timeout must be positive, got {effective_timeout}")

    #     try:
    #         from langgraph.config import get_stream_writer
    #         stream_writer = get_stream_writer()
    #     except Exception:
    #         stream_writer = lambda _: None

    #     try:
    #         proc = await asyncio.create_subprocess_shell(
    #             rewritten,
    #             stdout=asyncio.subprocess.PIPE,
    #             stderr=asyncio.subprocess.STDOUT,
    #             shell=True,
    #             env=self._env,
    #             cwd=str(self.cwd),
    #         )

    #         lines: list[str] = []
    #         seq = 0

    #         async def _read_stdout():
    #             nonlocal seq
    #             while True:
    #                 line_bytes = await proc.stdout.readline()
    #                 if not line_bytes:
    #                     break
    #                 line = self._decode_output_bytes(line_bytes).rstrip("\r\n")
    #                 lines.append(line)
    #                 seq += 1
    #                 stream_writer({
    #                     "type": "tool_output",
    #                     "data": {
    #                         "tool_name": "execute",
    #                         "chunk": line,
    #                         "chunk_seq": seq,
    #                         "stream": "stdout",
    #                     },
    #                 })

    #         try:
    #             await asyncio.wait_for(_read_stdout(), timeout=effective_timeout)
    #         except asyncio.TimeoutError:
    #             proc.kill()
    #             await proc.wait()
    #             output = "\n".join(lines) if lines else ""
    #             if len(output) > self._max_output_bytes:
    #                 output = output[: self._max_output_bytes]
    #                 output += f"\n\n... Output truncated at {self._max_output_bytes} bytes."
    #             return ExecuteResponse(output=output or " ", exit_code=124, truncated=bool(lines))

    #         exit_code = await proc.wait()

    #         output = "\n".join(lines) if lines else " "
    #         truncated = False
    #         if len(output) > self._max_output_bytes:
    #             output = output[: self._max_output_bytes]
    #             output += f"\n\n... Output truncated at {self._max_output_bytes} bytes."
    #             truncated = True

    #         if exit_code != 0:
    #             output = f"{output.rstrip()}\n\nExit code: {exit_code}"

    #         return ExecuteResponse(output=output, exit_code=exit_code, truncated=truncated)

    #     except Exception as exc:
    #         return ExecuteResponse(
    #             output=f"Error executing command ({type(exc).__name__}): {exc}",
    #             exit_code=1,
    #             truncated=False,
    #         )

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
