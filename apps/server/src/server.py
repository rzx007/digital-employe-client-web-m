import os as _os

# 关闭 langsmith tracing（本应用不用，省掉每次模型调用的 trace 开销/后台上报）。
# 必须在任何 langchain/langsmith/langgraph 导入之前设置。
# 注意：不要设 LANGCHAIN_CALLBACKS_BACKGROUND=false —— 实测它会破坏 langgraph 流式
# token 投递与「流结束信号」（表现为只出几个 token 后卡到 60s 超时才收尾、tok 几乎不出）。
_os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")
_os.environ.setdefault("LANGSMITH_TRACING", "false")
_os.environ.setdefault("LANGCHAIN_TRACING", "false")

from src.core.logging_setup import setup_logging

setup_logging()

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from src.service.agent.path_access import install as install_agent_path_access
from src.service.agent.compatible_filesystem_middleware import (
    install_compatible_filesystem_middleware,
)

install_compatible_filesystem_middleware()
install_agent_path_access()

from src.service.agent.memory_middleware_patch import install_safe_memory_decode

install_safe_memory_decode()

import logging
import re
import asyncio

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import aiosqlite

from src.api import api_router
from src.db.init_db import init_db
from src.db.session import get_session_local
from src.service.employee_service import EmployeeService
from src.service.config_kv_service import ConfigKvService
from src.service.task_scheduler_service import TaskSchedulerService
from src.service.task_service import TaskService
from src.service.workspace_service import WorkspaceService
from src.service.local_skill_service import LocalSkillService
from src.service.agent import init_checkpointer
from src.core.config import get_settings, resolve_sqlite_path
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


def _parse_feishu_whitelist(raw: str | None) -> set[str]:
    """支持逗号分隔或 JSON 数组字符串。"""
    if not raw:
        return set()
    raw = raw.strip()
    if raw.startswith("["):
        import json
        try:
            return {str(x).strip() for x in json.loads(raw) if str(x).strip()}
        except Exception:
            pass
    return {p.strip() for p in raw.split(",") if p.strip()}


def create_app() -> FastAPI:

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        loop = asyncio.get_running_loop()

        # 记录实际事件循环类型（Windows 已回退为默认 ProactorEventLoop）。
        logger.info("事件循环 = %s", type(loop).__name__)

        # ── 扩大 asyncio 默认线程池（根治线程饥饿）──────────────────────────
        # Python 3.12 默认 ThreadPoolExecutor 仅 min(32, cpu+4)=本机约 12 线程。
        # 全应用多处共用这个默认池：每个 workspace events SSE 的阻塞 q.get、群派活
        # handle_group_message(to_thread)、各种 run_in_executor(None,...)、以及
        # anyio 在部分操作上为 async-httpx 建连借的 worker 线程。一旦群协作并发起来
        # （多成员流 + events 流 + 汇总节点重活），12 线程被瓜分殆尽 → 表现为：
        # ① model 首包极慢甚至 pre-httpx 挂死、② 群组长/汇总节点卡住不输出、
        # ③ 汇总流占线程时总管(curator)抢不到、「停掉群聊总管才能对话」。
        # 扩到 64 给足缓冲（线程多数时间阻塞在 I/O/queue，开销极低），是对以上所有
        # 症状对症且低风险的根治。配套已做：SSE 序列化改同步、events q.get 带超时+心跳。
        from concurrent.futures import ThreadPoolExecutor as _TPE

        _default_executor = _TPE(
            max_workers=64, thread_name_prefix="asyncio-default"
        )
        loop.set_default_executor(_default_executor)
        logger.info("asyncio 默认线程池 max_workers=64（防线程饥饿）")
        # ──────────────────────────────────────────────────────────────────

        # 离线 IO 密集型初始化到线程池，避免阻塞事件循环导致前端请求挂起
        def _startup_db_init():
            # 升级迁移：从旧数据目录(.boban-staff/.digital-employee)拷激活文件到新目录，
            # 免老用户升级后重新激活。幂等、失败不抛，须在激活中间件鉴权前跑。
            from src.core.activation.storage import migrate_legacy_activation

            migrate_legacy_activation()
            init_db()
            with get_session_local()() as db:
                workspace = WorkspaceService.ensure_default_workspace(db)
                inserted = ConfigKvService.bootstrap_from_json(db)
                if inserted > 0:
                    logger.info(
                        "Initialized config_kvs from seed file (insert-only): inserted=%s",
                        inserted,
                    )
                from src.llm.registry import ensure_offline_bootstrap_active, load_registry

                load_registry(db)
                if ensure_offline_bootstrap_active(db):
                    get_settings.cache_clear()
                from src.service import model_patch

                model_patch.apply_if_needed(get_settings())
                LocalSkillService.seed_builtin_skills()
                from src.service.stream_registry import cleanup_zombie_executions

                cleaned = cleanup_zombie_executions(db)
                if cleaned > 0:
                    logger.info("Cleaned %d zombie task executions", cleaned)
                from src.service.agent.memory_file import normalize_all_memory_files

                normalized = normalize_all_memory_files()
                if normalized > 0:
                    logger.info(
                        "Normalized %d employee memory files to UTF-8", normalized
                    )
                WorkspaceService.ensure_workspace_initialized(db, workspace)

        await loop.run_in_executor(None, _startup_db_init)

        # 保存主事件循环引用，供 sync context 调度协程
        from src.service.agent.orchestrator import set_main_event_loop
        set_main_event_loop(loop)

        # 重启对账：补触发进程重启前遗漏的增量汇报（reported_at IS NULL 的终态任务）
        try:
            from src.service.agent.orchestrator.report_debouncer import (
                get_report_debouncer,
                reconcile_unreported_tasks,
            )
            with get_session_local()() as _recon_db:
                _pending_conv_ids = reconcile_unreported_tasks(_recon_db)
            _debouncer = get_report_debouncer()
            for _cid in _pending_conv_ids:
                _debouncer.notify(_cid)
            if _pending_conv_ids:
                logger.info(
                    "重启对账：补触发 %d 个总管会话的增量汇报 %s",
                    len(_pending_conv_ids),
                    _pending_conv_ids,
                )
        except Exception:
            logger.warning("重启对账失败（不影响启动）", exc_info=True)

        # 启动对账（QA 接受）：补盖进程重启前漏接受的 qa_accepted_at 并放行下游，
        # 避免"评审错过/重启 → 下游永久卡在等接受"。
        try:
            from src.service.agent.orchestrator.dependency_scheduler import (
                reconcile_accepted_downstream_all,
            )
            with get_session_local()() as _qa_db:
                _accepted = reconcile_accepted_downstream_all(_qa_db)
            if _accepted:
                logger.info("启动对账(QA接受)：补盖+放行下游 %d 条", _accepted)
        except Exception:
            logger.warning("启动对账(QA接受)失败（不影响启动）", exc_info=True)

        from src.service.stream_registry import registry as _stream_registry
        from src.service.workspace_events import WorkspaceEventBus

        def _on_task_finalized(
            conversation_id: int,
            stream_state: str,
            task_id: int,
            workspace_id: int,
            *,
            orchestrator_conversation_id: int | None = None,
            summary_message_id: int | None = None,
            execution_log_id: int | None = None,
        ) -> None:
            if (
                stream_state == "completed"
                and orchestrator_conversation_id is not None
            ):
                from src.service.context_compression_checkpoint import (
                    mark_pending_compact,
                )

                mark_pending_compact(
                    orchestrator_conversation_id,
                    "delegation_completed",
                )
            base = {
                "task_id": task_id,
                "conversation_id": conversation_id,
                "execution_log_id": execution_log_id,
                "orchestrator_conversation_id": orchestrator_conversation_id,
                "summary_message_id": summary_message_id,
            }
            if stream_state == "completed":
                WorkspaceEventBus.push(workspace_id, {
                    "type": "task_completed",
                    **base,
                })
            elif stream_state == "cancelled":
                WorkspaceEventBus.push(workspace_id, {
                    "type": "task_failed",
                    **base,
                    "error": "任务已取消",
                })
            else:
                WorkspaceEventBus.push(workspace_id, {
                    "type": "task_failed",
                    **base,
                })

            # 完成驱动调度：任务进入终态后都要驱动 DAG——
            # 成功→派发就绪后继；失败/取消→级联跳过下游（fail-fast），
            # 并让整盘在全部定局后触发汇总（不再因失败而永久僵死）。
            # interrupted 是 HITL 暂停、非终态，不驱动。
            if stream_state in ("completed", "cancelled", "failed", "timeout", "error"):
                try:
                    from src.service.agent.orchestrator.dependency_scheduler import (
                        on_employee_task_completed,
                    )
                    on_employee_task_completed(task_id, workspace_id)
                except Exception:
                    logger.warning(
                        "completion-driven scheduler failed task_id=%s",
                        task_id,
                        exc_info=True,
                    )

        _stream_registry.on_task_finalized = _on_task_finalized

        settings = get_settings()
        sqlite_path = resolve_sqlite_path(settings.sqlite_path)
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)

        await loop.run_in_executor(None, EmployeeService.migrate_local_employees_to_skill_path)

        # LangGraph checkpointer 按 settings.checkpointer_backend 选实现：
        # - file（默认）：FileCheckpointSaver，per-thread {thread_id}.jsonl 文件。
        #   群聊并发多条流时各写各的文件，根除共享单 sqlite 连接的串行瓶颈
        #   （旧 AsyncSqliteSaver 单连接每 super-step 写 110KB+ checkpoint 串行落库，
        #   是「群聊组长流第一步卡死」的疑点根因）。
        # - sqlite（回滚老路径）：独立 checkpoints.db + AsyncSqliteSaver。
        # checkpoint 为按流瞬态数据，重启丢弃无碍业务表。
        conn = None
        if settings.checkpointer_backend == "sqlite":
            checkpoint_path = sqlite_path.parent / "checkpoints.db"
            conn = await aiosqlite.connect(
                str(checkpoint_path), check_same_thread=False
            )
            await conn.execute("PRAGMA journal_mode=WAL")
            await conn.execute("PRAGMA busy_timeout=30000")
            await conn.execute("PRAGMA synchronous=NORMAL")
            await conn.execute("PRAGMA cache_size=-16000")  # ~16MB
            await conn.execute("PRAGMA wal_autocheckpoint=2000")
            await conn.commit()
            init_checkpointer(conn=conn)
            logger.info("AsyncSqliteSaver initialized (db=%s)", checkpoint_path)
        else:
            checkpoints_dir = sqlite_path.parent / "checkpoints"
            init_checkpointer(checkpoints_dir=checkpoints_dir)
            logger.info("FileCheckpointSaver initialized (dir=%s)", checkpoints_dir)

        # 启动调度器
        TaskSchedulerService.start()

        # 飞书 channel（分级护栏：缺凭证/能力关→不启动；已启用但白名单空→照常启动但全拒答）
        try:
            from src.core.config import get_settings as _get_settings
            from src.core.runtime_capabilities import get_capabilities as _get_caps
            from src.service.channel.manager import manager as _channel_manager
            from src.service.channel.feishu_channel import FeishuChannel as _FeishuChannel

            _s = _get_settings()
            if (_get_caps().feishu_platform and _s.feishu_app_id and _s.feishu_app_secret
                    and _s.feishu_channel_enabled):
                _wl = _parse_feishu_whitelist(_s.feishu_whitelist_open_ids)
                if not _wl:
                    logger.warning("飞书 channel 白名单为空，所有飞书消息将被拒答")
                _channel_manager.register(_FeishuChannel(_s.feishu_app_id, _s.feishu_app_secret, _wl))
                _channel_manager.start()
                logger.info("飞书 channel 已启动（白名单 %d 人）", len(_wl))
        except Exception:
            logger.error("飞书 channel 启动失败（不影响主程序）", exc_info=True)

        yield
        # Cancel all active streams so background tasks flush final state
        from src.service.stream_registry import registry
        _active = [cid for cid, t in registry._tasks.items() if t.is_active]
        if _active:
            logger.info("Shutting down %d active streams: %s", len(_active), _active)
            for conv_id in _active:
                registry.cancel(conv_id)
        TaskSchedulerService.shutdown()
        try:
            from src.service.channel.manager import manager as _channel_manager
            _channel_manager.stop()
        except Exception:
            logger.error("飞书 channel 停止异常", exc_info=True)
        # 仅 sqlite 后端持有 aiosqlite 连接需关闭；file 后端无连接。
        if settings.checkpointer_backend == "sqlite" and conn is not None:
            await conn.close()
            logger.info("AsyncSqliteSaver connection closed")
        
    fastapi_app = FastAPI(
        title="欢迎来到数字员工客户端",
        description="数字员工客户端",
        version="1.0.0",
        lifespan=lifespan
    )
    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    from starlette.middleware.sessions import SessionMiddleware
    fastapi_app.add_middleware(
        SessionMiddleware,
        secret_key="digital-employee-oauth-secret",
    )

    class WorkspaceHeaderMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            ws_id = request.headers.get("X-Workspace-Id")
            if ws_id:
                try:
                    ws_id_int = int(ws_id)
                except (TypeError, ValueError):
                    return await call_next(request)
                request.state.workspace_id = ws_id_int
                path = request.scope["path"]
                request.scope["path"] = re.sub(
                    r"/workspaces/\d+/",
                    f"/workspaces/{ws_id}/",
                    path,
                )
            return await call_next(request)

    fastapi_app.add_middleware(WorkspaceHeaderMiddleware)

    # 激活拦截：仅在强制激活时挂载，在线 / bypass 下零开销
    from src.core.activation.policy import is_activation_enforced

    if is_activation_enforced():
        from src.middleware.activation_middleware import ActivationMiddleware

        fastapi_app.add_middleware(ActivationMiddleware)
        logger.info("ActivationMiddleware enabled (activation enforced)")

    fastapi_app.include_router(api_router)
    return fastapi_app

app = create_app()
