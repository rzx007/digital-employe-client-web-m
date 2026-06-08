from src.core.config import join_base_and_path


def test_feedback_url_joins_base_and_path():
    assert (
        join_base_and_path("https://api.example.com", "/yc/feedback")
        == "https://api.example.com/yc/feedback"
    )


def test_settings_has_feedback_url_field():
    from dataclasses import fields
    from src.core.config import Settings

    assert any(f.name == "feedback_url" for f in fields(Settings))
