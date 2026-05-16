"""Session-scoped conversation history offload for summarization middleware."""

from __future__ import annotations

from deepagents.middleware.summarization import SummarizationMiddleware


class ConversationSummarizationMiddleware(SummarizationMiddleware):
    """Summarization middleware that can write a fixed `history.md` per session."""

    use_session_history_file: bool = False

    def _get_history_path(self) -> str:
        if self.use_session_history_file:
            return f"{self._history_path_prefix}/history.md"
        return super()._get_history_path()
