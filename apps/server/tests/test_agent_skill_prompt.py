import unittest
import tempfile
from pathlib import Path

from src.service.agent import WindowsShellBackend, _build_system_prompt, _list_available_skills


class AgentSkillPromptTest(unittest.TestCase):
    def test_lists_available_skills_from_skills_root(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            skills_root = Path(tmp_dir)
            (skills_root / "lark-im").mkdir()
            (skills_root / "lark-im" / "SKILL.md").write_text("# lark-im\n", encoding="utf-8")
            (skills_root / "echo-test-skill").mkdir()
            (skills_root / "echo-test-skill" / "SKILL.md").write_text("# echo\n", encoding="utf-8")
            (skills_root / "not-a-skill").mkdir()

            result = _list_available_skills(skills_root)

            self.assertEqual(result, ["echo-test-skill", "lark-im"])

    def test_system_prompt_embeds_loaded_skills_and_rule(self):
        prompt = _build_system_prompt("2026-04-01 10:30:00", ["echo-test-skill", "lark-im"])

        self.assertIn("当前已加载的技能名单：echo-test-skill, lark-im", prompt)
        self.assertIn("必须严格基于当前已加载的技能名单回答", prompt)

    def test_shell_backend_rewrites_virtual_skills_absolute_path(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            employee_dir = Path(tmp_dir) / "测试员工"
            script_path = employee_dir / "skills" / "hot-news" / "scripts" / "hot_news.py"
            script_path.parent.mkdir(parents=True)
            script_path.write_text("print('ok')\n", encoding="utf-8")

            backend = WindowsShellBackend(base_dir=str(employee_dir))

            command = backend._resolve_relative_paths("python /skills/hot-news/scripts/hot_news.py --type weibo")

            self.assertIn(str(script_path), command)


if __name__ == "__main__":
    unittest.main()
