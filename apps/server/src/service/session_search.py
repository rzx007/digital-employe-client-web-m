"""会话搜索服务。

为 conversation_messages 表提供 FTS5 全文搜索能力，
agent 可通过 session_search 工具检索历史对话内容。
"""

from __future__ import annotations

import json
import logging
import re

from sqlalchemy import text

from src.db.session import get_session_local

logger = logging.getLogger(__name__)


def session_search(
    query: str,
    employee_id: int | None = None,
    limit: int = 5,
) -> str:
    """搜索历史对话内容。返回 JSON 格式的相关片段列表。"""
    if not query or len(query.strip()) < 2:
        return json.dumps(
            {"results": [], "error": "搜索词至少 2 个字符"},
            ensure_ascii=False,
        )

    db = get_session_local()()
    try:
        fts_query = _to_fts_query(query)
        sql = """
            SELECT cm.id, cm.conversation_id, cm.role, cm.content, cm.created_at, rank
            FROM conversation_messages_fts
            JOIN conversation_messages cm ON cm.id = conversation_messages_fts.rowid
            WHERE conversation_messages_fts MATCH :q
              AND cm.role = 'assistant'
              AND length(COALESCE(cm.content, '')) > 20
        """
        params: dict = {"q": fts_query}

        if employee_id is not None:
            sql += """
                AND cm.conversation_id IN (
                    SELECT id FROM conversations
                    WHERE target_type = 'employee' AND target_id = :eid
                )
            """
            params["eid"] = employee_id

        sql += " ORDER BY rank LIMIT :lim"
        params["lim"] = limit

        rows = db.execute(text(sql), params).fetchall()
        results = []
        for row in rows:
            content = (row.content or "")[:800]
            results.append(
                {
                    "conversation_id": row.conversation_id,
                    "snippet": content,
                    "time": str(row.created_at) if row.created_at else "",
                }
            )
        return json.dumps({"results": results}, ensure_ascii=False)

    except Exception as e:
        logger.error("session_search failed: %s", e, exc_info=True)
        return json.dumps({"results": [], "error": str(e)}, ensure_ascii=False)
    finally:
        db.close()


def _to_fts_query(raw: str) -> str:
    """将用户输入的查询文本转为 FTS5 查询语法，过滤特殊字符。"""
    terms = raw.strip().split()
    cleaned = [re.sub(r'[^\w\u4e00-\u9fff]', '', t) for t in terms if t]
    return " AND ".join(f'"{t}"' for t in cleaned) if cleaned else '""'
