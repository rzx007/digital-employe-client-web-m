import json
import logging
import re
import time
from typing import Any
from src.schemas.employee import EmployeeProfile
from src.service.modal_service import ModelService
from src.service.local_skill_service import LocalSkillService

logger = logging.getLogger(__name__)

# 招聘匹配：全量技能 + 每条 ≤20 字摘要进 LLM（约 100 技能 <1000 token）
RECRUIT_SUMMARY_MAX_CHARS = 20


class EmployeeGenerationService:
    """员工生成服务类 - 使用AI模型生成员工信息"""

    @staticmethod
    async def get_available_skills(
        token: str | None = None,
        workspace_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """
        获取可用技能列表（仅本地：builtin + 指定 workspace 目录下的技能）。
        招聘/候选人生成不再拉取远程技能市场，避免多余请求并与员工配置一致。
        """
        try:
            _ = token  # 保留签名，便于调用方统一传参
            local_skills = LocalSkillService.list_local_skills(workspace_id)
            local_skill_items: list[dict[str, Any]] = []
            for item in local_skills:
                local_id = item.get("localId")
                if local_id is None:
                    continue
                description = (item.get("description") or "").strip()
                skill_name = str(item.get("skillName") or "")
                zh_raw = item.get("displayNameZh")
                display_zh = (
                    zh_raw.strip()
                    if isinstance(zh_raw, str) and zh_raw.strip()
                    else skill_name
                )
                recruit_summary = (item.get("recruitSummary") or "").strip()
                if not recruit_summary:
                    recruit_summary = LocalSkillService.build_recruit_summary(
                        description, skill_name, RECRUIT_SUMMARY_MAX_CHARS
                    )
                local_skill_items.append(
                    {
                        "id": local_id,
                        "skillName": skill_name,
                        "displayNameZh": display_zh,
                        "description": description,
                        "recruitSummary": recruit_summary,
                        "directoryId": None,
                        "directoryName": "本地技能",
                    }
                )

            logger.info(
                "招聘生成获取到技能数量: workspace_id=%s, local=%s",
                workspace_id,
                len(local_skill_items),
            )
            return local_skill_items
        except Exception as e:
            logger.error("获取技能列表失败: %s", e, exc_info=True)
            return []


    @staticmethod
    def _extract_skill_ids(
        profile: dict[str, Any], skills_list: list[dict[str, Any]]
    ) -> list[int]:
        """
        从模型输出中提取技能ID，兼容 skills/skill_ids/capabilities 历史字段
        """
        raw_ids = (
            profile.get("skill_ids")
            or profile.get("skills")
            or profile.get("capabilities")
            or []
        )
        valid_skill_ids = {str(skill.get("id")) for skill in skills_list if skill.get("id")}

        normalized_ids: list[int] = []
        for raw_id in raw_ids:
            raw_id_str = str(raw_id)
            if raw_id_str in valid_skill_ids:
                normalized_ids.append(int(raw_id_str))
        return normalized_ids


    @staticmethod
    def _skills_for_recruit_prompt(
        skills_list: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """全量技能清单：id + 名称 + ≤20 字摘要，供 LLM 一次性匹配。"""
        compact: list[dict[str, Any]] = []
        for skill in skills_list:
            summary = str(skill.get("recruitSummary") or "").strip()
            if not summary:
                summary = LocalSkillService.build_recruit_summary(
                    str(skill.get("description") or ""),
                    str(skill.get("skillName") or ""),
                    RECRUIT_SUMMARY_MAX_CHARS,
                )
            compact.append(
                {
                    "id": skill.get("id"),
                    "name": skill.get("skillName"),
                    "sum": summary[:RECRUIT_SUMMARY_MAX_CHARS],
                }
            )
        return compact

    @staticmethod
    def _build_default_profiles(
        count: int, name_prefix: str, description: str
    ) -> list[EmployeeProfile]:
        profiles = []
        for i in range(count):
            profiles.append(
                EmployeeProfile(name=f"{name_prefix} {i+1}", description=description)
            )
        return profiles

    @staticmethod
    def _resolve_profile_name(raw_name: object, fallback_index: int) -> str:
        name = str(raw_name or "").strip()
        if name and name not in ("暂无匹配", "无匹配", "未匹配"):
            return name
        return f"待命名员工 {fallback_index}"

    @staticmethod
    async def _generate_profiles_without_skills(
        user_request: str, count: int
    ) -> list[EmployeeProfile]:
        """技能库为空时，仅根据用户需求生成无技能员工档案。"""
        logger.info(
            "无技能库兜底生成: request=%s, count=%s",
            user_request[:80],
            count,
        )
        prompt = f"""
        根据以下用户需求，生成{count}个不同的数字员工候选人信息（当前技能库为空，不要编造 skill_ids）：

        用户需求：{user_request}

        规则：
        1. 每个员工须有合理的岗位名称（2-6 字中文或「XX助手」风格），禁止「暂无匹配」等占位名。
        2. description 须写清岗位职责与适用场景，并说明录用后可在员工设置中分配技能。
        3. skill_ids 必须为空数组 []。

        请返回 JSON 数组，每项包含：name、description、skill_ids（固定为 []）。
        """
        result = await ModelService.call_model(prompt, {})
        if not result or result.get("code") != 1:
            return EmployeeGenerationService._build_default_profiles(
                count,
                "候选员工",
                "根据需求生成的数字员工，录用后可在员工设置中分配技能。",
            )
        result_content = result.get("data")
        return EmployeeGenerationService._parse_skill_profiles(
            result_content if isinstance(result_content, str) else str(result_content),
            [],
            count,
        )

    @staticmethod
    async def _generate_profiles_from_skills(
        user_request: str, skills_list: list[dict[str, Any]], count: int
    ) -> list[EmployeeProfile]:
        logger.info(
            f"开始生成员工档案: request={user_request[:80]}, count={count}, skills={len(skills_list)}"
        )

        compact_skills = EmployeeGenerationService._skills_for_recruit_prompt(
            skills_list
        )
        prompt_chars = len(json.dumps(compact_skills, ensure_ascii=False))
        logger.info(
            "招聘全量技能进模: count=%s, prompt_json_chars=%s",
            len(compact_skills),
            prompt_chars,
        )

        prompt = f"""
        根据以下用户需求，从提供的技能列表中选择最匹配的技能组合，生成{count}个不同的员工信息：

        用户需求：{user_request}

        可用技能列表（共{len(compact_skills)}项，sum为20字以内能力摘要）：{json.dumps(compact_skills, ensure_ascii=False, separators=(",", ":"))}

        规则：
        1. 只能从「可用技能列表」中选择 skill_ids，必须使用列表中的 id 字段。
        2. 若没有技能与用户需求明显相关，必须返回 skill_ids 为空数组 []，不要强行匹配不相关技能。
        3. 若 skill_ids 非空，员工姓名应与所选技能/岗位相关；若 skill_ids 为空，仍须根据用户需求生成合理的岗位名称（如「数据分析师」「法务助手」），禁止「暂无匹配」等占位名。
        4. skill_ids 为空时，description 须写清岗位职责，并说明当前技能库暂无匹配、录用后可手动分配技能。

        请返回JSON格式的员工信息数组，每个员工包含以下字段：
        - name: 员工名称
        - description: 员工描述
        - skill_ids: 关联的技能ID集合（数组格式，包含具体的ID数字或字符串）
        """

        _model_started = time.perf_counter()
        result = await ModelService.call_model(prompt, {})
        logger.info(
            "员工生成模型调用耗时 %.3fs，返回摘要: type=%s, code=%s (count=%s)",
            time.perf_counter() - _model_started,
            type(result).__name__,
            result.get("code") if isinstance(result, dict) else None,
            count,
        )

        if not result or result.get("code") != 1:
            logger.info("员工生成模型调用失败，返回内容: %s", result)
            return EmployeeGenerationService._build_default_profiles(
                count, "AI生成员工", "由AI生成的虚拟员工"
            )

        result_content = result.get("data")
        content_preview = (
            result_content[:300]
            if isinstance(result_content, str)
            else str(result_content)[:300]
        )
        logger.info(f"员工生成模型内容摘要: {content_preview}")

        _parse_started = time.perf_counter()
        parsed = EmployeeGenerationService._parse_skill_profiles(
            result_content, skills_list, count
        )
        logger.info(
            "_parse_skill_profiles 处理耗时 %.3fs (count=%s)",
            time.perf_counter() - _parse_started,
            count,
        )
        return parsed

    @staticmethod
    def _parse_skill_profiles(
        result_content: str, skills_list: list[dict[str, Any]], count: int
    ) -> list[EmployeeProfile]:
        try:
            start_idx = result_content.find("[")
            end_idx = result_content.rfind("]") + 1
            if start_idx != -1 and end_idx != 0:
                profiles_data = json.loads(result_content[start_idx:end_idx])
            else:
                profiles_data = json.loads(result_content)

            profiles = []
            for idx, profile in enumerate(profiles_data, start=1):
                skill_ids = EmployeeGenerationService._extract_skill_ids(
                    profile, skills_list
                )
                matched_skills = [
                    skill for skill in skills_list if skill.get("id") in skill_ids
                ]
                name = EmployeeGenerationService._resolve_profile_name(
                    profile.get("name"), idx
                )
                description = (
                    str(profile.get("description") or "").strip()
                    or "根据需求生成的数字员工，录用后可在员工设置中分配技能。"
                )
                logger.info(
                    "员工生成解析结果: name=%s, skill_ids=%s",
                    name,
                    skill_ids,
                )
                if not skill_ids:
                    logger.info("员工生成未匹配到技能: profile=%s", profile)
                profiles.append(
                    EmployeeProfile(
                        name=name,
                        description=description,
                        skill_ids=skill_ids,
                        skills_list=matched_skills,
                    )
                )
            return profiles
        except json.JSONDecodeError as exc:
            logger.error(
                "员工生成 JSON 解析失败: %s", exc, exc_info=True
            )
            json_match = re.search(r"\[.*\]", result_content, re.DOTALL)
            if json_match:
                try:
                    return EmployeeGenerationService._parse_skill_profiles(
                        json_match.group(), skills_list, count
                    )
                except json.JSONDecodeError as exc2:
                    logger.error(
                        "员工生成二次 JSON 解析失败: %s", exc2, exc_info=True
                    )
            logger.info(
                "员工生成模型返回无法解析为JSON数组: %s",
                result_content[:300],
            )
            return EmployeeGenerationService._build_default_profiles(
                count,
                "候选员工",
                result_content[:200] + "..." if len(result_content) > 200 else result_content,
            )
    

    @staticmethod
    async def generate_employee_profiles_async(
        user_request: str, skills_list: list[dict[str, Any]], count: int = 1
    ) -> list[EmployeeProfile]:
        """
        使用AI模型异步生成多个员工档案，优先 skills，必要时回退到 MCP 能力
        """

        try:
            _gen_started = time.perf_counter()
            profiles = await EmployeeGenerationService._generate_profiles_from_skills(
                user_request, skills_list, count
            )
            logger.info(
                "_generate_profiles_from_skills 处理耗时 %.3fs (count=%s)",
                time.perf_counter() - _gen_started,
                count,
            )
            if any(profile.skill_ids for profile in profiles):
                return profiles

            return profiles

        except Exception as e:
            logger.error("生成员工档案异常: %s", e, exc_info=True)
            profiles = []
            for i in range(count):
                profiles.append(EmployeeProfile(
                    name=f"默认员工 {i+1}",
                    description="生成失败，请检查输入或重试",
                    skill_ids=[],
                    skills_list=[],
                ))
            return profiles

    @staticmethod
    async def convert_employee_profiles_to_employee_create(
        profiles: list[EmployeeProfile], skills_list: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        将EmployeeProfile转换为可以用于创建员工的数据格式
        """
        converted_profiles = []

        for profile in profiles:
            converted_profile = {
                'employee_name': profile.name,
                'capability_desc': profile.description,
                'status': 1,
                'detail_page_url': None,
                'skill_ids': profile.skill_ids,
                'skills': profile.skills_list,
                'shift_schedule': None,
                'tasks': []
            }
            converted_profiles.append(converted_profile)

        return converted_profiles

    @staticmethod
    async def generate_profiles_for_recruitment(
        user_request: str,
        count: int = 1,
        token: str | None = None,
        workspace_id: int | None = None,
    ) -> tuple[list[EmployeeProfile], list[dict[str, Any]]]:
        """招聘候选人生成（总管 Tool 与 /generate-employees 共用）。"""
        skills = await EmployeeGenerationService.get_available_skills(
            token=token, workspace_id=workspace_id
        )
        if skills:
            profiles = await EmployeeGenerationService.generate_employee_profiles_async(
                user_request, skills, count
            )
        else:
            profiles = await EmployeeGenerationService._generate_profiles_without_skills(
                user_request, count
            )
        return profiles, skills

    @staticmethod
    async def generate_candidates_for_orchestrator(
        user_request: str,
        count: int = 1,
        token: str | None = None,
        workspace_id: int | None = None,
    ) -> tuple[list[EmployeeProfile], list[dict[str, Any]]]:
        """为总管招聘 Tool 生成候选人（复用招聘页同一套技能匹配逻辑）。"""
        return await EmployeeGenerationService.generate_profiles_for_recruitment(
            user_request, count, token=token, workspace_id=workspace_id
        )
