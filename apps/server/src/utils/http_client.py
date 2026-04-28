import httpx


def create_http_client(
    timeout_connect: float = 10.0,
    timeout_read: float = 600.0,
    timeout_write: float = 30.0,
    timeout_pool: float = 5.0,
):
    """
    创建带有标准超时配置的HTTP客户端

    Args:
        timeout_connect: 连接超时时间（秒）
        timeout_read: 读取超时时间（秒）
        timeout_write: 写入超时时间（秒）
        timeout_pool: 连接池超时时间（秒）

    Returns:
        httpx.AsyncClient: 配置好超时参数的HTTP客户端
    """
    return httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=timeout_connect,
            read=timeout_read,
            write=timeout_write,
            pool=timeout_pool,
        )
    )


def create_mcp_http_client():
    """
    创建用于MCP服务的专用HTTP客户端

    Returns:
        httpx.AsyncClient: 专为MCP服务配置的HTTP客户端
    """
    return create_http_client(
        timeout_connect=10.0, timeout_read=600.0, timeout_write=30.0, timeout_pool=5.0
    )


def create_agent_interface_http_client():
    """
    创建用于Agent Interface服务的专用HTTP客户端（Skills模块）

    Returns:
        httpx.AsyncClient: 专为Agent Interface服务配置的HTTP客户端
    """
    return create_http_client(
        timeout_connect=10.0, timeout_read=30.0, timeout_write=30.0, timeout_pool=5.0
    )


def create_agent_interface_upload_http_client():
    """
    创建用于Agent Interface文件上传的专用HTTP客户端

    Returns:
        httpx.AsyncClient: 适配大文件上传和较长处理时延
    """
    return create_http_client(
        timeout_connect=10.0, timeout_read=300.0, timeout_write=120.0, timeout_pool=30.0
    )
