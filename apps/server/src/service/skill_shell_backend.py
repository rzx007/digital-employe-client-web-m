import asyncio
import logging
import os
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Callable

from deepagents.backends import LocalShellBackend
from deepagents.backends.protocol import (
    EditResult,
    ExecuteResponse,
    ReadResult,
    WriteResult,
)

from src.service.agent.basic_file_backend import (
    basic_file_edit,
    basic_file_read,
    basic_file_write,
)

logger = logging.getLogger(__name__)


def _kill_process_tree(proc: subprocess.Popen) -> None:
    """杀整棵进程树（Windows 用 taskkill /T，Unix 用 killpg）。

    shell=True + CREATE_NEW_PROCESS_GROUP 时 proc.kill() 只杀 cmd.exe 组长，
    python.exe 等子孙被孤儿化、永不退出，_read_lines_sync 线程卡在 proc.wait()
    把 asyncio 默认线程池耗尽 → 后续所有 shell_execute 排队永不执行。
    """
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            try:
                proc.send_signal(signal.CTRL_BREAK_EVENT)
            except Exception:
                pass
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    capture_output=True,
                    timeout=10,
                )
            except Exception:
                pass
            try:
                proc.kill()
            except Exception:
                pass
        else:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                proc.kill()
    except Exception:
        logger.warning("[shell] _kill_process_tree failed for pid=%s", proc.pid, exc_info=True)


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
            "文件或可执行文件不存在。"
            "① 读写文件路径有误：先 ls 或 read_file 确认；路径用 $ARTIFACTS_DIR/$UPLOADS_DIR/$WORKSPACE_DIR 等环境变量（无虚拟前缀）。"
            "② Python subprocess 找不到可执行文件（Windows 常见）：Windows 的 subprocess 不走 PATHEXT，"
            "找不到 .cmd/.bat 包装的命令（如 lark-cli）；"
            "改用 shell_execute 直接执行命令，或改写成 subprocess.run(['cmd','/c','命令',...])。"
        ),
    ),
    (
        re.compile(r"(command not found|不是内部或外部命令|未找到命令)"),
        lambda m: "命令不存在或未安装。换用已有的等价工具，或先确认该命令在当前环境可用。",
    ),
    (
        re.compile(
            r"(Cannot find module ['\"]([^'\"]+)['\"]|MODULE_NOT_FOUND)"
        ),
        lambda m: (
            f"缺少 Node 模块 {m.group(2)}。" if m.lastindex and m.group(2)
            else "缺少 Node 模块。"
        ) + (
            "本环境已把全局 node_modules 注入 NODE_PATH，请用全局安装 "
            "`npm install -g <pkg>` 后直接重跑脚本即可解析；"
            "**切勿**在产物目录 `npm install <pkg>`（会刷出大量 node_modules 文件）。"
        ),
    ),
    (
        re.compile(r"(SyntaxError|IndentationError)"),
        lambda m: "代码语法/缩进错误。按报错行号修正后重试，不要原样重跑。",
    ),
    (
        re.compile(r"(Permission denied|拒绝访问|PermissionError)"),
        lambda m: "权限不足。改写到产物目录（$ARTIFACTS_DIR），勿写系统或只读路径。",
    ),
]


def _steer_on_error(output: str) -> str:
    """命令失败时按常见错误模式追加一句可执行建议；无匹配返回空串。"""
    for pattern, hint in _ERROR_HINTS:
        match = pattern.search(output)
        if match:
            return f"\n[建议] {hint(match)}"
    return ""


# 进程级缓存全局 npm root，避免每次构建 backend 都 spawn 一次 `npm root -g`。
# None=未探测；""=探测过但失败/无 npm。
_GLOBAL_NPM_ROOT: str | None = None


def resolve_global_node_modules() -> str:
    """返回 `npm root -g`（全局 node_modules 路径），供注入 NODE_PATH。

    根因：Node 默认**不**解析全局模块——`npm install -g docx` 装到全局后，
    产物目录里的脚本 `require('docx')` 仍报 MODULE_NOT_FOUND，模型于是退而在
    产物目录本地装，刷出 node_modules。把全局 root 注入 NODE_PATH 即可让全局
    模块从任意 cwd 解析，一劳永逸。探测失败返回空串（无 npm 时静默降级）。
    """
    global _GLOBAL_NPM_ROOT
    if _GLOBAL_NPM_ROOT is not None:
        return _GLOBAL_NPM_ROOT
    try:
        result = subprocess.run(  # noqa: S603,S607
            ["npm", "root", "-g"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
            shell=(os.name == "nt"),  # Windows 上 npm 是 .cmd，需经 shell 解析
        )
        root = (result.stdout or "").strip()
        if result.returncode == 0 and root and Path(root).is_dir():
            _GLOBAL_NPM_ROOT = root
        else:
            _GLOBAL_NPM_ROOT = ""
    except Exception as e:
        logger.warning("[shell] failed to resolve global npm root: %s", e)
        _GLOBAL_NPM_ROOT = ""
    return _GLOBAL_NPM_ROOT


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
        workspace_root: Path | None = None,
        public_dir: Path | None = None,
        public_root: Path | None = None,
        conversation_id: int | str | None = None,
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
        self._workspace_root = (
            workspace_root.resolve() if workspace_root is not None else None
        )
        self._public_dir = public_dir.resolve() if public_dir is not None else None
        self._public_root = (
            public_root.resolve() if public_root is not None else None
        )
        if os.name == "nt":
            self._env.setdefault("PYTHONUTF8", "1")
            self._env.setdefault("PYTHONIOENCODING", "utf-8")
        # 注入会话 ID，供子进程（如 browserctl open-artifact）按会话定位产物
        if conversation_id is not None and str(conversation_id) != "":
            self._env["CONVERSATION_ID"] = str(conversation_id)
        # 注入产物/技能/记忆等目录的真实绝对路径，供 agent 与子进程以真实路径定位，
        # 取代已删除的虚拟前缀（/artifacts/ 等）。
        self._env["ARTIFACTS_DIR"] = str(self._artifacts_dir)
        self._env["SKILLS_DIR"] = str(self._skills_root)
        if self._memories_root is not None:
            self._env["MEMORIES_DIR"] = str(self._memories_root)
        if self._uploads_root is not None:
            self._env["UPLOADS_DIR"] = str(self._uploads_root)
        if self._draft_root is not None:
            self._env["SKILLS_DRAFT_DIR"] = str(self._draft_root)
        # 员工工作空间（读自己跨会话产物）+ 公共区（写自己子区 / 读全部）
        if self._workspace_root is not None:
            self._env["WORKSPACE_DIR"] = str(self._workspace_root)
        if self._public_dir is not None:
            self._env["PUBLIC_DIR"] = str(self._public_dir)
        if self._public_root is not None:
            self._env["PUBLIC_ROOT"] = str(self._public_root)
        self._inject_global_node_path()

    def _inject_global_node_path(self) -> None:
        """把全局 node_modules 注入 NODE_PATH，让 `npm install -g docx` 后
        产物目录里的脚本 `require('docx')` 能从全局解析，无需本地再装。
        已有 NODE_PATH 则前置追加，不覆盖用户/系统原有值。"""
        global_root = resolve_global_node_modules()
        if not global_root:
            return
        existing = self._env.get("NODE_PATH", "")
        parts = [p for p in existing.split(os.pathsep) if p]
        if global_root in parts:
            return
        parts.insert(0, global_root)
        self._env["NODE_PATH"] = os.pathsep.join(parts)
        logger.info("[shell] injected global node_modules into NODE_PATH: %s", global_root)

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

    def write(self, file_path: str, content: str) -> WriteResult:
        """写文件同名直接覆盖（不报 already exists），避免反复重建同名文件的死循环。"""
        return basic_file_write(self, file_path, content)

    def _extract_python_c_code(self, command: str) -> str | None:
        """从 `python -c '...'` 提取代码体。

        旧实现用单条正则，仅认 `python` / `python -u` 且要求引号严格闭合，遇到
        `python3 -c`、带其它 flag（`-X utf8`）、或代码体含内层同类引号时匹配失败，
        回退把多行命令原样丢给 Windows cmd → 多行静默失败 → agent 拿不到结果反复
        重试，撞 LangGraph 递归上限刷几千事件、空烧 token（实测 conv 卡 74s/2527 事件）。

        改为先用 shlex 正确拆分（能处理引号嵌套），定位首个 `-c` 并取其后一个 token
        作为代码体——这覆盖 python/python3/py + 任意中间 flag 的所有常见形态。
        shlex 失败（命令含 cmd 才认的语法）时再退回原正则兜底。
        """
        stripped = command.strip()
        try:
            tokens = shlex.split(stripped, posix=True)
        except ValueError:
            tokens = []
        for i, tok in enumerate(tokens):
            base = os.path.basename(tok).lower()
            if base in ("python", "python3", "py", "python.exe", "python3.exe"):
                for j in range(i + 1, len(tokens)):
                    if tokens[j] == "-c":
                        return tokens[j + 1] if j + 1 < len(tokens) else None
                break

        # 兜底：shlex 拆不出时用原正则（兼容 python -u -c '...'）。
        match = re.match(
            r"python\d?(?:\s+-\S+)*\s+-c\s+(?P<q>['\"])(?P<code>[\s\S]*)(?P=q)\s*$",
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
        lowered = command.lower()
        if "-c" not in lowered:
            return command
        if not any(p in lowered for p in ("python", "py ", "py\t")):
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
        # 不再做虚拟前缀 rewrite：agent 直接用真实绝对路径（或 $ARTIFACTS_DIR 等 env）。
        # 仅保留 Windows 多行 python -c 落盘（与路径虚拟化无关）。
        return self._materialize_multiline_python_c(command)

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
        allow_background: bool = False,
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
        # 超时转后台移交：async 侧 set 后，线程 finally 跳过 os.unlink，
        # 把临时输出文件留给后台注册表继续读取，避免删文件竞态
        _background_handoff = threading.Event()
        # 线程把临时文件路径与已读字节量暴露给 async 侧，移交时传给注册表
        # 跨线程快照：path/last_size 由读线程写、async 侧在超时转后台时读作注册表 read_offset。
        # ⚠️ last_size 必须在**每次** _read_incremental_from_tmp 之后同步更新，否则后台续读会重读/漏读。
        _tmp_path_holder: dict = {"path": None, "last_size": 0}
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
            _tmp_path_holder["path"] = _tmp_path

            env = {**self._env, "PYTHONUNBUFFERED": "1"}
            stdout_handle = open(_tmp_path, 'ab')
            # 独立进程组/会话：超时转后台后用 shell_kill 可整组终止，
            # 避免父进程退出留下孤儿子进程
            import sys as _sys
            _pg_kwargs = (
                {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
                if _sys.platform == "win32"
                else {"start_new_session": True}
            )
            proc = subprocess.Popen(  # noqa: S602
                rewritten,
                stdout=stdout_handle,            # stdout → 临时文件，不用 PIPE
                stderr=subprocess.STDOUT,
                shell=True,
                env=env,
                cwd=str(self.cwd),
                **_pg_kwargs,
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
                        _tmp_path_holder["last_size"] = last_size
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
                    _tmp_path_holder["last_size"] = last_size
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

                try:
                    proc.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    _kill_process_tree(proc)
                    try:
                        proc.wait(timeout=5)
                    except Exception:
                        pass
            finally:
                # 双保险：线程侧也检查取消信号，确保无论谁先触发都能清
                if cancel_requested.is_set() and proc.poll() is None:
                    _kill_process_tree(proc)
                    try:
                        proc.wait(timeout=5)
                    except Exception:
                        pass
                loop.call_soon_threadsafe(queue.put_nowait, None)
                # 已移交后台时不删临时文件——注册表还要继续读它，由注册表负责清理
                if not _background_handoff.is_set():
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

        # 心跳：子进程存活但长时间零输出（如下载、编译、静默脚本）时，每 30s 推一个
        # tool_keepalive 事件。它走 stream_writer 进 astream，同时喂活上层「chunk 间
        # 超时(180s)」与「内容级无进展判死(240s)」两个看门狗——避免正常长命令被误判为
        # 卡死而把整条流腰斩。30s 远小于两个阈值，留足余量。真正挂死（无子进程在跑）则
        # 无心跳，看门狗照常回收，僵尸流保护不受影响。
        _KEEPALIVE_SECONDS = 30
        _last_output_at = time.monotonic()

        async def _keepalive_loop():
            while True:
                await asyncio.sleep(_KEEPALIVE_SECONDS)
                if completed_normally or timed_out:
                    return
                if time.monotonic() - _last_output_at < _KEEPALIVE_SECONDS:
                    continue  # 近期有真实输出在流，无需心跳
                try:
                    payload: dict = {"tool_name": "shell_execute", "stream": "keepalive"}
                    if tool_call_id:
                        payload["tool_call_id"] = tool_call_id
                    stream_writer({"type": "tool_keepalive", "data": payload})
                except Exception:
                    pass

        _keepalive_task = asyncio.ensure_future(_keepalive_loop())

        # completed_normally 用于标记子进程是自行退出（收到 None），
        # 而非超时 / 取消 / 异常终止。finally 块据此决定是否杀进程。
        completed_normally = False
        # 超时转后台移交状态
        handed_to_background = False
        background_session_id: str | None = None
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

                _last_output_at = time.monotonic()  # 有真实输出 → 心跳让位
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
            _keepalive_task.cancel()
            # 非正常退出（超时 / 取消 / 异常）：默认通知线程杀子进程避免孤儿；
            # 但若超时且允许后台且进程仍在跑，则改为移交后台注册表（不杀）。
            if not completed_normally:
                proc = _proc_ref[0] if _proc_ref else None
                can_bg = (
                    timed_out
                    and allow_background
                    and proc is not None
                    and proc.poll() is None
                    and _tmp_path_holder.get("path")
                )
                if can_bg:
                    from src.service.shell_background_registry import (
                        get_background_shell_registry,
                    )
                    # 先 set handoff：线程 finally 据此跳过 os.unlink，保住文件；
                    # cancel_requested 保持未 set，线程不会 kill 进程
                    handed_to_background = True
                    _background_handoff.set()
                    background_session_id = (
                        get_background_shell_registry().register(
                            popen=proc,
                            tmp_path=_tmp_path_holder["path"],
                            read_offset=_tmp_path_holder.get("last_size", 0),
                            command=command,
                        )
                    )
                    try:
                        _emit_batch()
                    except Exception:
                        pass
                else:
                    cancel_requested.set()
                    if proc is not None and proc.poll() is None:
                        _kill_process_tree(proc)
                    try:
                        _emit_batch()
                    except Exception:
                        pass
                    # 等线程函数收尾（kill 后 proc.wait()），最长等 10s
                    try:
                        await asyncio.wait_for(asyncio.shield(future), timeout=10)
                    except Exception:
                        pass

        # 已移交后台：进程仍在跑（线程 finally 未触达），不能 await future 否则会阻塞。
        # 立即返回 session_id 指引，模型按需 shell_wait（等结果）/shell_poll（查一眼）/shell_kill。
        if handed_to_background:
            partial = "\n".join(lines) if lines else ""
            note = (
                f"\n[命令仍在后台运行，session_id={background_session_id}（输出不会丢失）。"
                f"要结果就用 shell_wait(session_id, N) 有节奏地等一轮（N 如 30-60s），"
                f"没完成再等一轮；shell_poll(session_id) 只查一眼，shell_kill(session_id) 终止。"
                f"判断是超大任务时调 watch_background(session_id) 登记，完成后系统会自动唤醒我回到本会话继续；"
                f"然后体面收尾，勿杀了重试。]"
            )
            return ExecuteResponse(
                output=(partial + note),
                exit_code=0,
                truncated=bool(lines),
            )

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
