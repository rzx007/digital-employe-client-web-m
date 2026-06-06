"""stream 接口并发压测：复现「请求 stream 接口卡死」。

同时向 群聊/总管/员工 多个会话发消息，记录每条流：
  HTTP 状态、首字节延迟、首条 data 延迟、事件数、是否完成 / 卡死。

用法（venv python）：
  python apps/server/scripts/stream_loadtest.py            # 默认一波 6 路并发
  python apps/server/scripts/stream_loadtest.py 34567 3    # 端口 34567，每个目标发 3 轮

鉴权 token 校验在 request_utils.py 是注释掉的，占位即可。
"""

import asyncio
import sys
import time

import httpx

BASE = f"http://127.0.0.1:{sys.argv[1] if len(sys.argv) > 1 else '34567'}"
ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 1
TOKEN = "loadtest-token"
FIRST_DATA_WARN = 30.0   # 超过这么久没首条 data 就标黄
MAX_WAIT = 80.0          # 单条流最多读这么久，避免脚本自己挂死

TARGETS = [
    (229, "curator"),
    (228, "curator"),
    (233, "group"),
    (217, "group"),
    (236, "employee"),
    (237, "employee"),
]


async def hit(client: httpx.AsyncClient, idx: int, conv_id: int, kind: str):
    tag = f"#{idx:02d} conv={conv_id}({kind})"
    t0 = time.monotonic()
    state = {"first_byte": None, "first_data": None, "events": 0, "done": False}
    body = {
        "skill": "",
        "question": f"[压测{idx}] 请用一句话简短回答：现在几点不重要，回我“收到”即可。",
        "debug_content_only": False,
        "extra_meta": {},
    }

    async def _read():
        async with client.stream(
            "POST",
            f"{BASE}/chat/conversations/{conv_id}/stream",
            json=body,
            headers={"token": TOKEN, "Content-Type": "application/json"},
        ) as resp:
            print(f"[TEST] {tag} HTTP {resp.status_code} (响应头 +{time.monotonic()-t0:.2f}s)", flush=True)
            async for line in resp.aiter_lines():
                now = time.monotonic() - t0
                if state["first_byte"] is None:
                    state["first_byte"] = now
                if not line or not line.startswith("data:"):
                    continue
                if state["first_data"] is None:
                    state["first_data"] = now
                    print(f"[TEST] {tag} 首条 data +{now:.2f}s: {line[:90]}", flush=True)
                state["events"] += 1
                if "[DONE]" in line or '"stream_ended"' in line:
                    state["done"] = True
                    return

    err = None
    try:
        await asyncio.wait_for(_read(), timeout=MAX_WAIT)
    except asyncio.TimeoutError:
        err = f"TIMEOUT(>{MAX_WAIT}s)"
    except Exception as e:  # noqa: BLE001
        err = repr(e)

    dt = time.monotonic() - t0
    if state["done"]:
        status = "DONE"
    elif state["first_data"] is None:
        status = "!! 卡死-无首数据"
    elif err and "TIMEOUT" in err:
        status = "!! 卡死-中途僵住"
    else:
        status = "PARTIAL"
    print(
        f"[TEST] {tag} => {status} total={dt:.2f}s "
        f"first_byte={state['first_byte']} first_data={state['first_data']} "
        f"events={state['events']} err={err}",
        flush=True,
    )
    return (tag, status, dt, state["first_data"], state["events"], err)


async def main():
    print(f"==== 并发压测 {BASE}  目标={len(TARGETS)}  轮数={ROUNDS}  并发={len(TARGETS)*ROUNDS} ====", flush=True)
    timeout = httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        jobs = []
        n = 0
        for r in range(ROUNDS):
            for conv_id, kind in TARGETS:
                jobs.append(hit(client, n, conv_id, kind))
                n += 1
        results = await asyncio.gather(*jobs)

    print("\n==== 汇总 ====", flush=True)
    stalled = 0
    for tag, status, dt, fd, ev, err in results:
        if "卡死" in status:
            stalled += 1
        print(f"  {tag:24s} {status:16s} total={dt:6.2f}s first_data={fd} events={ev} err={err}", flush=True)
    print(f"\n  卡死流: {stalled}/{len(results)}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
