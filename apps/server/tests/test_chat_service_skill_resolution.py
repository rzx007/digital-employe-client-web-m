import os
import tempfile
import unittest
from pathlib import Path
import json

from src.service.chat_service import ChatService


class ResolveEmployeeSkillsDirTest(unittest.TestCase):
    def test_prefers_local_employee_skills(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            original_cwd = Path.cwd()
            try:
                os.chdir(tmp_dir)
                fallback_dir = Path(tmp_dir) / "local-employees" / "测试员工" / "skills"
                fallback_dir.mkdir(parents=True)

                result = ChatService.resolve_employee_skills_dir(
                    skills_payload='[{"skills_dir":"D:\\\\project\\\\test\\\\employees\\\\employees\\\\测试员工\\\\skills"}]',
                    employee_name="测试员工",
                    employee_code="ceshi",
                )

                self.assertEqual(result, str(fallback_dir.parent))
            finally:
                os.chdir(original_cwd)

    def test_falls_back_to_payload_path_when_local_missing(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            original_cwd = Path.cwd()
            try:
                os.chdir(tmp_dir)
                skills_dir = Path(tmp_dir) / "skills"
                skills_dir.mkdir()

                result = ChatService.resolve_employee_skills_dir(
                    skills_payload=f'[{{"skills_dir":"{skills_dir}"}}]',
                    employee_name="测试员工",
                    employee_code="ceshi",
                )

                self.assertEqual(result, tmp_dir)
            finally:
                os.chdir(original_cwd)

    def test_uses_local_employee_code_when_name_dir_missing(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            original_cwd = Path.cwd()
            try:
                os.chdir(tmp_dir)
                fallback_dir = Path(tmp_dir) / "local-employees" / "ceshi" / "skills"
                fallback_dir.mkdir(parents=True)

                result = ChatService.resolve_employee_skills_dir(
                    skills_payload='[{"skills_dir":"D:\\\\project\\\\test\\\\employees\\\\employees\\\\测试员工\\\\skills"}]',
                    employee_name="测试员工",
                    employee_code="ceshi",
                )

                self.assertEqual(result, str(fallback_dir.parent))
            finally:
                os.chdir(original_cwd)

    def test_materializes_embedded_skill_files_from_metadata(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            original_cwd = Path.cwd()
            try:
                os.chdir(tmp_dir)
                employee_dir = Path(tmp_dir) / "local-employees" / "测试员工"
                skill_dir = employee_dir / "skills" / "hot-news"
                skill_dir.mkdir(parents=True)
                (skill_dir / "SKILL.md").write_text("# hot-news\n", encoding="utf-8")
                (employee_dir / "metadata.json").write_text(
                    json.dumps(
                        {
                            "skills": [
                                {
                                    "skillName": "hot-news",
                                    "skillContent": json.dumps(
                                        {
                                            "SKILL.md": "# hot-news\n",
                                            "scripts/hot_news.py": "print('ok')\n",
                                            "references/platforms.md": "# platforms\n",
                                        },
                                        ensure_ascii=False,
                                    ),
                                }
                            ]
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )

                result = ChatService.resolve_employee_skills_dir(
                    skills_payload="[]",
                    employee_name="测试员工",
                    employee_code="ceshi",
                )

                self.assertEqual(result, str(employee_dir))
                self.assertTrue((skill_dir / "scripts" / "hot_news.py").is_file())
                self.assertTrue((skill_dir / "references" / "platforms.md").is_file())
            finally:
                os.chdir(original_cwd)


if __name__ == "__main__":
    unittest.main()
