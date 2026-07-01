from unittest.mock import patch

from src.core.runtime_capabilities import get_capabilities


def test_remote_feedback_enabled_online():
    with patch("src.core.runtime_capabilities.is_offline_mode", return_value=False):
        assert get_capabilities().remote_feedback is True


def test_remote_feedback_disabled_offline():
    with patch("src.core.runtime_capabilities.is_offline_mode", return_value=True):
        assert get_capabilities().remote_feedback is False
