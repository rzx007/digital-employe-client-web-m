from dataclasses import dataclass
from src.core.config import is_offline_mode

@dataclass(frozen=True)
class RuntimeCapabilities:
    remote_login: bool           # login/register/dept/password 转发
    remote_model_sync: bool      # ConfigKvService.sync_model_provider_from_remote
    remote_skills: bool          # SkillService / skill 远程路由
    remote_mcp: bool
    remote_performance: bool
    dispatch_order_sync: bool
    oauth: bool
    feishu_platform: bool        # feishu_api + feishu_*_service
    skill_rating_upload: bool
    mcp_task_execution: bool       # 调度器内远程 MCP 调用

def get_capabilities() -> RuntimeCapabilities:
    """
    获取运行时能力配置
    
    根据当前是否处于离线模式，返回对应的运行时能力配置。
    离线模式下所有远程功能均禁用，在线模式下全部启用。
    
    Returns:
        RuntimeCapabilities: 运行时能力配置对象，包含以下能力开关：
            - remote_login: 远程登录/注册/部门/密码转发功能
            - remote_model_sync: 远程模型提供者同步功能
            - remote_skills: 远程技能服务路由功能
            - remote_mcp: 远程MCP功能
            - remote_performance: 远程性能监控功能
            - dispatch_order_sync: 调度订单同步功能
            - oauth: OAuth认证功能
            - feishu_platform: 飞书平台集成功能
            - skill_rating_upload: 技能评分上传功能
            - mcp_task_execution: MCP任务执行功能
    """
    if is_offline_mode():
        return RuntimeCapabilities(*(False,) * 10)
    return RuntimeCapabilities(*(True,) * 10)
