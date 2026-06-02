"""通过 SSH 在 hanhai 宿主机本地跑压测，避免从 Windows 走外网。"""
import paramiko
import warnings

warnings.filterwarnings("ignore")

HOST = "10.172.246.220"
USER = "boban"
PASS = "100200"


SCRIPT = r"""
python3 - <<'PYEOF'
import asyncio, time, json, sys
import urllib.request

BASE = "http://localhost:12345/v1"
PROMPT = "请用 200 字左右介绍你自己。"

import socket

def stream_one(idx):
    body = json.dumps({
        "model": "hanhai",
        "messages": [{"role":"user","content":PROMPT}],
        "stream": True,
        "max_tokens": 256,
    }).encode()
    req = urllib.request.Request(
        f"{BASE}/chat/completions",
        data=body,
        headers={"Authorization":"Bearer 1","Content-Type":"application/json"},
    )
    t0 = time.perf_counter()
    ttft = 0.0
    tokens = 0
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            for raw in resp:
                line = raw.decode(errors="ignore").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except Exception:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content") or ""
                if content:
                    if tokens == 0:
                        ttft = time.perf_counter() - t0
                    tokens += 1
    except Exception as e:
        return idx, 0, 0, 0, f"{type(e).__name__}: {e}"
    total = time.perf_counter() - t0
    return idx, ttft, total, tokens, None

async def main():
    for conc in [1, 2, 4]:
        loop = asyncio.get_running_loop()
        t0 = time.perf_counter()
        tasks = [loop.run_in_executor(None, stream_one, i) for i in range(conc)]
        results = await asyncio.gather(*tasks)
        wall = time.perf_counter() - t0
        print(f"\n=== concurrency={conc} wall={wall:.2f}s ===")
        ok_tokens = 0
        for idx, ttft, total, tokens, err in results:
            ok_tokens += tokens
            gen = max(total - ttft, 1e-6)
            tps = tokens / gen if tokens else 0
            if err:
                print(f"  [{idx}] FAIL {err}")
            else:
                print(f"  [{idx}] ttft={ttft:.2f}s total={total:.2f}s tokens={tokens} tps={tps:.1f}")
        print(f"  aggregate: {ok_tokens/wall:.1f} tok/s across {conc} streams")

asyncio.run(main())
PYEOF
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=15)
stdin, stdout, stderr = client.exec_command(SCRIPT, timeout=300)
print(stdout.read().decode(errors="ignore"))
err = stderr.read().decode(errors="ignore")
if err.strip():
    print("[stderr]", err)
client.close()
