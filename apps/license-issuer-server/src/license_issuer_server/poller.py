"""轮询编排：拉已通过实例 → 出码 → 评论回写。无公网入口，纯出站。"""

from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)


def poll_once(approval, issuer, private_key_path, default_expires, window_ms) -> int:
    """处理一轮。返回本轮成功出码数。单条失败不阻塞其它。"""
    start_ms, end_ms = window_ms
    issued = 0
    try:
        codes = approval.list_instances(start_ms, end_ms)
    except Exception as exc:  # noqa: BLE001
        logger.warning("列实例失败，跳过本轮: %s", exc)
        return 0

    for code in codes:
        try:
            inst = approval.get_instance(code)
            if inst.status != "APPROVED":
                continue
            if not inst.device_code:
                logger.info("实例 %s 无设备码，跳过", code)
                continue
            if approval.has_license_comment(code, inst.user_id):
                continue
            expires = inst.expires or default_expires
            result = issuer.issue(inst.device_code, expires, private_key_path)
            approval.write_license_comment(code, inst.user_id, result.license_code)
            issued += 1
            logger.info("实例 %s 已出码并回写评论", code)
        except Exception as exc:  # noqa: BLE001
            logger.warning("实例 %s 处理失败，跳过: %s", code, exc)
            continue
    return issued


def _now_ms() -> int:
    return int(time.time() * 1000)


def run_forever(approval, issuer, private_key_path, default_expires,
                interval: int, lookback_ms: int = 7 * 24 * 3600 * 1000) -> None:
    """常驻轮询。窗口 = [now-lookback, now]。异常不崩，sleep 后续跑。"""
    logger.info("轮询器启动，间隔 %ss", interval)
    while True:
        try:
            now = _now_ms()
            n = poll_once(approval, issuer, private_key_path, default_expires,
                          (now - lookback_ms, now))
            if n:
                logger.info("本轮出码 %d 个", n)
        except Exception as exc:  # noqa: BLE001
            logger.warning("轮询循环异常（已捕获）: %s", exc)
        time.sleep(interval)
