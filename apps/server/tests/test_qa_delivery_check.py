"""#3 QA 代码兜底：核验员工自报的二进制交付物是否真实落盘(非空)。"""
from __future__ import annotations

import json

from src.service.agent.orchestrator import qa_delivery_check
from src.service.agent.orchestrator.qa_delivery_check import (
    check_log_delivery,
    detect_missing_delivery_artifacts,
    extract_claimed_binary_files,
)


class _FakeLog:
    def __init__(self, *, run_status, conversation_id, output_json=None, run_result=""):
        self.run_status = run_status
        self.conversation_id = conversation_id
        self.output_json = output_json
        self.run_result = run_result


def test_extract_claimed_binary_files_basenames():
    text = "已生成 报告.docx 和 /artifacts/proj/演示.pptx，另附 data.xlsx。"
    got = extract_claimed_binary_files(text)
    assert got == ["报告.docx", "演示.pptx", "data.xlsx"]


def test_extract_ignores_non_binary_and_dedups():
    text = "写了 notes.md 和 报告.docx，又改了 报告.docx。"
    assert extract_claimed_binary_files(text) == ["报告.docx"]


def test_no_claim_returns_none(tmp_path):
    assert detect_missing_delivery_artifacts("已返回三平台榜单 TOP20", tmp_path) is None


def test_claimed_file_present_nonempty_ok(tmp_path):
    (tmp_path / "报告.docx").write_bytes(b"PK\x03\x04 real docx bytes")
    assert detect_missing_delivery_artifacts("已生成 报告.docx", tmp_path) is None


def test_claimed_file_missing_flags(tmp_path):
    (tmp_path / "报告.md").write_text("用 md 糊弄", encoding="utf-8")
    msg = detect_missing_delivery_artifacts("已生成 报告.docx（Word 版）", tmp_path)
    assert msg is not None
    assert "报告.docx" in msg
    assert "假交付" in msg or "核实" in msg


def test_claimed_file_empty_shell_flags(tmp_path):
    (tmp_path / "报告.docx").write_bytes(b"")  # 空壳
    msg = detect_missing_delivery_artifacts("已生成 报告.docx", tmp_path)
    assert msg is not None
    assert "报告.docx" in msg


def test_found_in_subdir_ok(tmp_path):
    sub = tmp_path / "tech-proposal"
    sub.mkdir()
    (sub / "完整版.pdf").write_bytes(b"%PDF-1.7 real")
    assert detect_missing_delivery_artifacts("终稿见 完整版.pdf", tmp_path) is None


def test_partial_missing_flags_only_missing(tmp_path):
    (tmp_path / "deck.pdf").write_bytes(b"%PDF real")
    msg = detect_missing_delivery_artifacts("交付 deck.pdf 与 slides.pptx", tmp_path)
    assert msg is not None
    assert "slides.pptx" in msg
    assert "deck.pdf" not in msg


def test_extract_claimed_files_verb_gated_nonbinary():
    from src.service.agent.orchestrator.qa_delivery_check import extract_claimed_files
    text = "已生成 report.html\n参考了 notes.md\n保存为 报告.docx"
    got = extract_claimed_files(text)
    assert "report.html" in got       # 交付动词句里的非二进制文件
    assert "报告.docx" in got          # 二进制(全文匹配)
    assert "notes.md" not in got       # 「参考」非交付动词 → 不算自报交付


def test_detect_flags_missing_html_on_verb_line(tmp_path):
    from src.service.agent.orchestrator.qa_delivery_check import detect_missing_delivery_artifacts
    (tmp_path / "占位.txt").write_text("x", encoding="utf-8")
    msg = detect_missing_delivery_artifacts("已生成 原理展示页 report.html", tmp_path)
    assert msg is not None and "report.html" in msg


def test_detect_ignores_script_ext_even_with_verb(tmp_path):
    """脚本/依赖(.py 等)即便在交付动词句里、即便已删，也不算假交付。"""
    from src.service.agent.orchestrator.qa_delivery_check import detect_missing_delivery_artifacts
    assert detect_missing_delivery_artifacts("已生成 gen.py 跑完产出结果", tmp_path) is None


def test_detect_ignores_file_without_delivery_verb(tmp_path):
    from src.service.agent.orchestrator.qa_delivery_check import detect_missing_delivery_artifacts
    # data.csv 缺失但没有交付动词 → 不误报
    assert detect_missing_delivery_artifacts("我看了下 data.csv 做了分析", tmp_path) is None


def test_check_log_delivery_flags_missing(monkeypatch, tmp_path):
    """wrapper：从 success 日志 output 取自报文件，对照解析出的产物区核验。"""
    monkeypatch.setattr(
        qa_delivery_check, "_resolve_artifacts_dir", lambda db, cid: tmp_path
    )
    (tmp_path / "报告.md").write_text("md 糊弄", encoding="utf-8")
    log = _FakeLog(
        run_status="success",
        conversation_id=64,
        output_json=json.dumps({"content": "已生成 报告.docx"}, ensure_ascii=False),
    )
    msg = check_log_delivery(object(), log)
    assert msg is not None and "报告.docx" in msg


def test_check_log_delivery_ok_when_present(monkeypatch, tmp_path):
    monkeypatch.setattr(
        qa_delivery_check, "_resolve_artifacts_dir", lambda db, cid: tmp_path
    )
    (tmp_path / "报告.docx").write_bytes(b"PK real docx")
    log = _FakeLog(
        run_status="success",
        conversation_id=64,
        output_json=json.dumps({"content": "已生成 报告.docx"}, ensure_ascii=False),
    )
    assert check_log_delivery(object(), log) is None


def test_check_log_delivery_skips_non_success(monkeypatch, tmp_path):
    monkeypatch.setattr(
        qa_delivery_check, "_resolve_artifacts_dir",
        lambda db, cid: (_ for _ in ()).throw(AssertionError("不该解析目录")),
    )
    log = _FakeLog(run_status="failed", conversation_id=64,
                   output_json=json.dumps({"content": "报告.docx"}))
    assert check_log_delivery(object(), log) is None
