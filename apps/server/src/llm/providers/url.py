"""OpenAI-compatible base URL normalization."""

from __future__ import annotations

from urllib.parse import urlparse, urlunparse


from urllib.parse import urlparse, urlunparse

def normalize_openai_base_url(url: str) -> str:
    """
    规范化OpenAI基础URL格式
    
    该函数会执行以下操作：
    1. 去除URL首尾空白字符并移除末尾斜杠
    2. 如果URL没有协议前缀，自动添加https://
    3. 如果URL没有有意义的路径（空路径或根路径），则添加/v1路径
    4. 确保路径以斜杠开头
    
    Args:
        url (str): 待规范化的基础URL字符串
        
    Returns:
        str: 规范化后的URL字符串，确保有正确的协议、路径格式
        
    Raises:
        ValueError: 当输入的url为空或只包含空白字符时抛出异常
    """
    # 将输入转换为字符串并去除首尾空白字符，如果输入为空则使用空字符串
    raw = str(url or "").strip()
    if not raw:
        raise ValueError("base_url 不能为空")
    
    # 如果URL没有HTTP或HTTPS协议前缀，则自动添加https://协议
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"

    # 解析URL各个组成部分，获取路径部分并去除末尾斜杠
    parsed = urlparse(raw)
    path = (parsed.path or "").rstrip("/")

    # 根据路径情况决定最终路径：空路径或根路径时设置为/v1，否则确保以斜杠开头
    if not path or path == "/":
        path = "/v1"
    elif not path.startswith("/"):
        path = f"/{path}"

    # 重新组装URL，保持原有的协议、网络位置和其他组件，替换处理后的路径
    return urlunparse(
        (
            parsed.scheme or "https",
            parsed.netloc,
            path,
            parsed.params,
            parsed.query,
            parsed.fragment,
        )
    )
