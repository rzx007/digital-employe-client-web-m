import os
import sys
import argparse
import logging
import subprocess
from pathlib import Path
from dotenv import load_dotenv
from langchain_community.utilities import SQLDatabase
from langchain_community.agent_toolkits import SQLDatabaseToolkit
from deepagents.backends import (
    CompositeBackend, 
    StateBackend, 
    StoreBackend, 
    FilesystemBackend
)
from deepagents.backends.protocol import ExecuteResponse
from deepagents.backends.sandbox import BaseSandbox
from langchain_openai import ChatOpenAI
from langchain.tools import tool
from rich.console import Console
from rich.panel import Panel
from datetime import datetime  # 导入datetime模块
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore  # For dev; use PostgresStore for prod

from src.service.custom_graph import create_deep_agent
from src.core.config import get_settings

# Load environment variables
load_dotenv()

@tool
def run_shell_command(command: str) -> str:
    """
    Execute a shell command on Windows and return the output.
    Use this tool to run commands like python, curl, etc.
    """
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=False,  # Capture as bytes to avoid encoding issues
            timeout=30,
            cwd=os.getcwd()
        )
        
        # Decode output with error handling
        def decode_bytes(data: bytes) -> str:
            encodings_to_try = ['utf-8', 'gbk', 'cp936']  # Common Windows encodings
            for encoding in encodings_to_try:
                try:
                    return data.decode(encoding)
                except UnicodeDecodeError:
                    continue
            # If all fail, use utf-8 with replace
            return data.decode('utf-8', errors='replace')
        
        stdout = decode_bytes(result.stdout)
        stderr = decode_bytes(result.stderr)
        output = stdout
        if stderr:
            output += "\nSTDERR:\n" + stderr
        return f"Exit code: {result.returncode}\nOutput:\n{output}"
    except subprocess.TimeoutExpired:
        return "Command timed out after 30 seconds"
    except Exception as e:
        return f"Error executing command: {str(e)}"

console = Console()
logger = logging.getLogger(__name__)
_CHECKPOINTER = MemorySaver()
_STORE = InMemoryStore()


def _norm_virtual_path(path: str) -> str:
    return path.replace("\\", "/")


def _resolve_skills_root(skill_path: str) -> Path:
    raw = (skill_path or "").strip()
    if not raw:
        return Path(__file__).resolve().parent / "skills"

    p = Path(raw).resolve()
    if p.is_file() and p.name.lower() == "skill.md":
        # .../skills/<skill-name>/SKILL.md -> .../skills
        return p.parent.parent
    if p.is_dir() and p.name.lower() == "skills":
        return p
    if p.is_dir() and (p / "SKILL.md").exists():
        # .../skills/<skill-name> -> .../skills
        return p.parent
    if p.is_dir() and (p / "skills").is_dir():
        # .../<employee> -> .../<employee>/skills
        return p / "skills"
    return p


def _list_available_skills(skills_root: Path) -> list[str]:
    if not skills_root.is_dir():
        return []
    return sorted(child.name for child in skills_root.iterdir() if child.is_dir() and (child / "SKILL.md").is_file())


def _build_system_prompt(current_time: str, available_skills: list[str]) -> str:
    skills_line = ", ".join(available_skills) if available_skills else "无"
    return f"""今天的时间是{current_time}

        Skills available at /skills/. Use /memories/ for persistent context.
        我的默认环境是windows 环境 所有 你执行 命令的时候要注意windows 的规范
        当前已加载的技能名单：{skills_line}
        如果用户询问“你有没有某个技能”或“你有哪些技能”，必须严格基于当前已加载的技能名单回答，不要猜测，不要遗漏名单中的技能。
        在执行技能或者技能脚本的时候，查找技能所在的绝对路径，然后执行，不要用相对路径
         """


class PosixVirtualFilesystemBackend(FilesystemBackend):
    """Normalize virtual paths to POSIX style on Windows."""

    def ls_info(self, path: str) -> list[dict]:
        infos = super().ls_info(_norm_virtual_path(path))
        for item in infos:
            if "path" in item and isinstance(item["path"], str):
                item["path"] = _norm_virtual_path(item["path"])
        return infos

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> str:
        return super().read(_norm_virtual_path(file_path), offset=offset, limit=limit)

    def write(self, file_path: str, content: str):
        return super().write(_norm_virtual_path(file_path), content)

    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False):
        return super().edit(_norm_virtual_path(file_path), old_string, new_string, replace_all=replace_all)

    def download_files(self, paths: list[str]):
        return super().download_files([_norm_virtual_path(p) for p in paths])

    def upload_files(self, files: list[tuple[str, bytes]]):
        return super().upload_files([(_norm_virtual_path(path), content) for path, content in files])


class WindowsShellBackend(BaseSandbox):
    """Windows-compatible shell backend that properly handles encoding issues."""

    def __init__(self, base_dir: str | None = None):
        super().__init__()
        self.base_dir = Path(base_dir).resolve() if base_dir else Path.cwd()

    def _resolve_relative_paths(self, command: str) -> str:
        import shlex

        try:
            parts = shlex.split(command, posix=False)
        except ValueError:
            return command

        if not parts:
            return command

        updated = False
        for i, token in enumerate(parts):
            quote = ''
            if (token.startswith('"') and token.endswith('"')) or (token.startswith("'") and token.endswith("'")):
                quote = token[0]
                stripped = token[1:-1]
            else:
                stripped = token

            # Skip command and option tokens
            if stripped.startswith('-'):
                continue

            try:
                path_obj = Path(stripped)
            except Exception:
                continue

            # Handle slash-leading virtual paths (e.g. /skills/xxx)
            if stripped.startswith('/') or stripped.startswith('\\'):
                virtual_path = stripped.lstrip('/\\')
                candidate = self.base_dir / virtual_path
            else:
                if path_obj.is_absolute():
                    # Keep real absolute paths unchanged (Windows/Cygwin style)
                    continue
                candidate = self.base_dir / stripped

            if candidate.exists():
                resolved = str(candidate)
                if quote:
                    resolved = f"{quote}{resolved}{quote}"
                parts[i] = resolved
                updated = True

        if updated:
            return subprocess.list2cmdline(parts)
        return command

    def execute(self, command: str) -> ExecuteResponse:
        """Execute a command with proper Windows encoding handling."""
        import subprocess
        import locale

        try:
            # Resolve relative paths in command to base_dir path
            command = self._resolve_relative_paths(command)

            # Run command and capture output as bytes to avoid encoding issues
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=False,  # Capture as bytes
                timeout=30,
                cwd=str(self.base_dir)
            )
            
            # Decode stdout and stderr with error handling
            encodings_to_try = ['utf-8', locale.getpreferredencoding(False)]
            
            def decode_bytes(data: bytes) -> str:
                for encoding in encodings_to_try:
                    try:
                        return data.decode(encoding)
                    except UnicodeDecodeError:
                        continue
                # If all encodings fail, use utf-8 with replace
                return data.decode('utf-8', errors='replace')
            
            stdout = decode_bytes(result.stdout)
            stderr = decode_bytes(result.stderr)
            output = stdout + stderr
            
            return ExecuteResponse(
                output=output,
                exit_code=result.returncode,
                truncated=False
            )
            
        except subprocess.TimeoutExpired:
            return ExecuteResponse(
                output="Command timed out after 30 seconds",
                exit_code=-1,
                truncated=False
            )
        except Exception as e:
            return ExecuteResponse(
                output=f"Error executing command: {str(e)}",
                exit_code=-1,
                truncated=False
            )

    @property
    def id(self) -> str:
        """Unique identifier for this backend."""
        return "windows_shell_backend"

    def upload_files(self, files: list[tuple[str, bytes]]):
        """Upload files - not supported in local shell backend."""
        from deepagents.backends.protocol import FileUploadResponse
        return [FileUploadResponse(path=path, error="file_not_found") for path, _ in files]

    def download_files(self, paths: list[str]):
        """Download files - not supported in local shell backend."""
        from deepagents.backends.protocol import FileDownloadResponse
        return [FileDownloadResponse(path=path, error="file_not_found") for path in paths]


class WindowsCompatibleCompositeBackend(CompositeBackend, BaseSandbox):
    def __init__(self, shell_backend: WindowsShellBackend, default: StateBackend, routes: dict[str, FilesystemBackend]):
        # Create a hybrid default that supports both file ops and execution
        self.shell_backend = shell_backend
        self.state_backend = default

        # Use shell_backend as default to pass execution support check
        super().__init__(default=shell_backend, routes=routes)

    def _get_backend_and_key(self, path: str):
        """Override routing to use state_backend for file operations."""
        # Check if path matches any route first
        for route_prefix, backend in self.sorted_routes:
            if path.startswith(route_prefix):
                stripped_key = path[len(route_prefix):]
                if not stripped_key.startswith("/"):
                    stripped_key = "/" + stripped_key
                return backend, stripped_key

                # For file operations, use state_backend instead of shell_backend
        return self.state_backend, path

    def execute(self, command: str) -> ExecuteResponse:
        return self.shell_backend.execute(command)

    @property
    def id(self) -> str:
        return f"windows_composite_{self.shell_backend.id}"

def get_agent(skill_path, root_path):
    checkpointer = _CHECKPOINTER
    store = _STORE  # /memories/ uses StoreBackend, requires BaseStore

    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    skills_root = _resolve_skills_root(skill_path)
    available_skills = _list_available_skills(skills_root)
    logger.warning(
        "get_agent skill_path=%s skills_root=%s available_skills=%s",
        skill_path,
        skills_root,
        available_skills,
    )
    base_dir = Path(__file__).resolve().parent
    settings = get_settings()
    model = ChatOpenAI(
        model=settings.deepagent_model or "qwen2.5-72b-instruct",
        temperature=0,
        api_key=settings.api_key,
        base_url=settings.base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )

    skills_fs = PosixVirtualFilesystemBackend(root_dir=str(skills_root), virtual_mode=True)
    agent_fs = PosixVirtualFilesystemBackend(root_dir=str(base_dir), virtual_mode=True)

    # Create shell backend for Windows compatibility
    # Prefer workspace root (root_path) then fallback to skills root
    backend_base_dir = Path(root_path).resolve() if root_path else skills_root
    shell_backend = WindowsShellBackend(base_dir=str(skills_root.parent))

    # Hybrid backend: virtual paths only for deepagents with shell support
    def make_backend(runtime):
        return WindowsCompatibleCompositeBackend(
            shell_backend=shell_backend,
            default=StateBackend(runtime),            # /notes.txt, /workspace/*
            routes={
                "/memories/": StoreBackend(runtime),  # Persistent across threads
                "/skills/": skills_fs,                # Employee skills folder
                "/agent/": agent_fs,                  # src/service folder (for AGENTS.md)
            }
        )

    agent = create_deep_agent(
        model=model,
        memory=["/agent/AGENTS.md"],
        skills=["/skills/"],
        subagents=[],
        system_prompt=_build_system_prompt(current_time, available_skills),
        store=store,
        backend=make_backend,
        checkpointer=checkpointer,
        # Add this middleware to disable general-purpose agent
        # middleware=[
        #     SubAgentMiddleware(
        #         backend=make_backend(None),
        #         subagents=[],
        #         general_purpose_agent=False
        #     )
        # ]

    )
    return agent


def main():
    """Main entry point for the SQL Deep Agent CLI"""
    parser = argparse.ArgumentParser(
        description="Text-to-SQL Deep Agent powered by LangChain DeepAgents and OpenAI GPT-4",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
    Examples:
    python agent.py "What are the top 5 best-selling artists?"
    python agent.py "Which employee generated the most revenue by country?"
    python agent.py "How many customers are from Canada?"
            """
        )
    pass
    
#     # Add command line argument for question
#     parser.add_argument(
#         "question",
#         type=str,
#         nargs='?',
#         default="""查询所有的员工信息
#         """,
#         help="Natural language question to answer using the Chinook database"
#     )
    
#     # 添加数据库URI参数
#     parser.add_argument(
#         "--db-uri",
#         type=str,
#         default=None,
#         help="Database URI to connect to, defaults to environment variable DATABASE_URI or built-in default"
#     )

#     # Parse command line argument
#     args = parser.parse_args()
    
#     # Create the agent with database URI if provided
#     agent = create_sql_deep_agent(database_uri=args.db_uri)
#     # Display the question
#     console.print(Panel(
#         f"[bold cyan]Question:[/bold cyan] {args.question}",
#         border_style="cyan"
#     ))
#     console.print()

#     # Invoke the agent with streaming to show all intermediate steps
#     console.print("[dim]Processing query with streaming...[/dim]\n")

#     try:
#         # Use stream() method to get step-by-step output
#         for chunk in agent.stream(
#             {"messages": [{"role": "user", "content": args.question}]},
#             stream_mode="messages"
#         ):
#             console.print(chunk)
#             # if isinstance(chunk, tuple) and len(chunk) >= 2:
#             #     message_chunk, metadata = chunk[0], chunk[1]
#             #     print(f"\n[metadata] {metadata}")
#             #     content = getattr(message_chunk, "content", "")
#             #     if isinstance(content, str) and content:
#             #         print(content, end="", flush=True)
#             #     elif isinstance(content, list):
#             #         for item in content:
#             #             if isinstance(item, dict) and item.get("type") == "text" and item.get("text"):
#             #                 print(item["text"], end="", flush=True)
#         # Get the final result separately to display the answer cleanly
#         # result = agent.invoke({
#         #     "messages": [{"role": "user", "content": timed_question}]
#         # })
#         #
#         # # Extract and display the final answer
#         # final_message = result["messages"][-1]
#         # answer = final_message.content if hasattr(final_message, 'content') else str(final_message)

#         # console.print(Panel(
#         #     f"[bold green]Final Answer:[/bold green]\n\n{answer}",
#         #     border_style="green"
#         # ))

#     except Exception as e:
#         console.print(Panel(
#             f"[bold red]Error:[/bold red]\n\n{str(e)}",
#             border_style="red"
#         ))
#         sys.exit(1)


if __name__ == "__main__":
    main()
