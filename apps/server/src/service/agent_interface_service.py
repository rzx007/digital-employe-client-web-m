from src.core.config import get_settings
import logging
from src.utils.http_client import create_agent_interface_http_client

logger = logging.getLogger(__name__)
settings = get_settings()

class AgentInterfaceService:
    """Agent Interface集成服务，用于调用agent-interface的Skills接口"""

    def __init__(self):
        self.base_url = settings.agent_interface_base_url
        self.skill_prefix = "/aios/skill"

    async def get_skill_list(
        self, directory_id: int | None = None, status: int | None = None
    ) -> list[dict]:
        """
        获取技能列表

        Args:
            directory_id: 可选，目录ID，用于筛选特定目录下的技能
            status: 可选，状态筛选: 1=启用, 0=禁用

        Returns:
            List[Dict]: 技能列表
        """
        try:
            url = f"{self.base_url}{self.skill_prefix}/list"
            params = {}
            if directory_id is not None:
                params["directoryId"] = directory_id

            async with create_agent_interface_http_client() as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
                if isinstance(data, dict) and "data" in data:
                    inner_data = data.get("data")
                    if isinstance(inner_data, list):
                        skills = inner_data
                    elif isinstance(inner_data, dict) and "data" in inner_data:
                        skills = inner_data.get("data", [])
                    else:
                        skills = []
                elif isinstance(data, list):
                    skills = data
                else:
                    skills = []
                if status is not None:
                    skills = [s for s in skills if s.get("status") == status]
                return skills
        except Exception as e:
            logger.error(f"获取技能列表失败: {str(e)}")
            return []

    async def get_available_skills(self, status: int | None = None) -> list[dict]:
        """
        获取所有可选skills（用于展示给用户选择）

        Args:
            status: 可选，状态筛选: 1=启用, 0=禁用

        Returns:
            List[Dict]: 简化字段的技能列表（id, skillName, description, directoryId, directoryName）
        """
        skills = await self.get_skill_list(status=status)
        available = []
        for skill in skills:
            available.append(
                {
                    "id": skill.get("id"),
                    "skillName": skill.get("skillName"),
                    "description": skill.get("description"),
                    "directoryId": skill.get("directoryId"),
                    "directoryName": skill.get("directoryName"),
                }
            )
        return available

    async def get_skill_detail(self, skill_id: int) -> dict | None:
        """
        获取技能详情

        Args:
            skill_id: 技能ID

        Returns:
            Optional[Dict]: 技能详情
        """
        try:
            url = f"{self.base_url}{self.skill_prefix}/get"
            async with create_agent_interface_http_client() as client:
                response = await client.get(url, params={"id": skill_id})
                response.raise_for_status()
                data = response.json()
                if isinstance(data, dict) and "data" in data:
                    return data["data"]
                return data
        except Exception as e:
            logger.error(f"获取技能详情失败: {str(e)}")
            return None

    async def get_skill_function_format(self, skill_id: int) -> dict | None:
        """
        获取技能的Function Calling格式

        Args:
            skill_id: 技能ID

        Returns:
            Optional[Dict]: Function Calling格式数据
        """
        try:

            url = f"{self.base_url}{self.skill_prefix}/function/format"
            async with create_agent_interface_http_client() as client:
                response = await client.get(url, params={"id": skill_id})
                response.raise_for_status()
                data = response.json()
                if isinstance(data, dict) and "data" in data:
                    return data["data"]
                return data
        except Exception as e:
            logger.error(f"获取技能Function Calling格式失败: {str(e)}")
            return None

    async def get_skill_function_format_batch(self, skill_ids: list[int]) -> list[dict]:
        """
        批量获取技能的Function Calling格式

        Args:
            skill_ids: 技能ID列表

        Returns:
            List[Dict]: Function Calling格式数据列表
        """
        try:
            url = f"{self.base_url}{self.skill_prefix}/function/format/batch"
            async with create_agent_interface_http_client() as client:
                response = await client.post(url, json=skill_ids)
                response.raise_for_status()
                data = response.json()
                if isinstance(data, dict) and "data" in data:
                    return data["data"]
                return data if isinstance(data, list) else []
        except Exception as e:
            logger.error(f"批量获取技能Function Calling格式失败: {str(e)}")
            return []

    async def get_directory_tree(self) -> list[dict]:
        """
        获取技能目录树

        Returns:
            List[Dict]: 目录树结构
        """
        try:
            url = f"{self.base_url}{self.skill_prefix}/directory/tree"
            async with create_agent_interface_http_client() as client:
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()
                if isinstance(data, dict) and "data" in data:
                    return data["data"]
                return data if isinstance(data, list) else []
        except Exception as e:
            logger.error(f"获取技能目录树失败: {str(e)}")
            return []

    async def download_skill_zip(self, skill_id: int) -> bytes | None:
        """
        下载单个技能的ZIP包

        Args:
            skill_id: 技能ID

        Returns:
            Optional[bytes]: ZIP文件字节流，下载失败返回None
        """
        try:
            url = f"{self.base_url}{self.skill_prefix}/export/single/{skill_id}"
            async with create_agent_interface_http_client() as client:
                response = await client.get(url)
                response.raise_for_status()
                return response.content
        except Exception as e:
            logger.error(f"下载技能ZIP失败(skill_id={skill_id}): {str(e)}")
            return None


agent_interface_service = AgentInterfaceService()
