"""Regression tests for the context-overflow 400 → ContextOverflowError patch.

Guards the gap that surfaced a raw 400 to the user: a local llama.cpp / Hanhai
endpoint rejects an over-budget request with ``exceed_context_size_error``, which
the old DashScope-only marker list did not recognize, so deepagents'
summarize-and-retry fallback never fired.
"""

from __future__ import annotations

import httpx
import openai
import pytest
from langchain_core.exceptions import ContextOverflowError

import langchain_openai.chat_models.base as oai_base
from src.service import model_patch


@pytest.fixture(autouse=True)
def _install_patch():
    model_patch.apply()


def _raise_bad_request(message: str) -> None:
    """Invoke langchain's handler the way it is called in production: from within
    an ``except openai.BadRequestError`` block (the handler ends with a bare
    ``raise``)."""
    req = httpx.Request("POST", "http://localhost:12345/v1/chat/completions")
    resp = httpx.Response(400, request=req, text=message)
    err = openai.BadRequestError(message, response=resp, body=None)
    try:
        raise err
    except openai.BadRequestError as e:
        oai_base._handle_openai_bad_request(e)


def test_hanhai_overflow_mapped_to_context_overflow():
    msg = (
        "request (128758 tokens) exceeds the available context size "
        "(128000 tokens), try increasing it"
    )
    with pytest.raises(ContextOverflowError):
        _raise_bad_request(msg)


def test_exceed_context_size_error_type_mapped():
    with pytest.raises(ContextOverflowError):
        _raise_bad_request("exceed_context_size_error: n_ctx exhausted")


def test_dashscope_pattern_still_mapped():
    with pytest.raises(ContextOverflowError):
        _raise_bad_request("Range of input length should be ...")


def test_native_openai_pattern_still_mapped():
    with pytest.raises(ContextOverflowError):
        _raise_bad_request("This request failed: context_length_exceeded")


def test_unrelated_bad_request_not_mapped():
    # Must NOT be swallowed as an overflow; re-raised as the original error type.
    with pytest.raises(openai.BadRequestError):
        _raise_bad_request("some unrelated validation error")


def test_patch_is_idempotent():
    model_patch.apply()
    model_patch.apply()
    with pytest.raises(ContextOverflowError):
        _raise_bad_request("exceeds the available context size")
