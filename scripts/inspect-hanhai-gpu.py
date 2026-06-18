"""综合 SSH 检查 hanhai 宿主机 GPU/CPU/内存利用率。
只读；连续 5 次采样，每次间隔 2s，能看出活动模式。
"""
import os
import sys
import paramiko
import warnings

warnings.filterwarnings("ignore")

HOST = os.environ.get("HANHAI_HOST", "10.172.246.220")
USER = os.environ.get("HANHAI_USER", "boban")
PASS = os.environ.get("HANHAI_PASS")
if not PASS:
    sys.stderr.write("缺少 SSH 密码：请设置环境变量 HANHAI_PASS\n")
    sys.exit(2)

ONE_SHOT = [
    ("uname/系统", "uname -a; lsb_release -a 2>/dev/null | head -4"),
    ("CPU 信息", "lscpu | grep -E 'Model name|CPU\\(s\\)|^Architecture|MHz' | head -8"),
    ("内存总览", "free -h"),
    ("nvidia-smi 完整版", "nvidia-smi"),
    ("容器进程", "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'"),
    ("hanhai 容器配置", "docker inspect hanhai-server --format 'CPUs={{.HostConfig.NanoCpus}} Mem={{.HostConfig.Memory}} Restart={{.HostConfig.RestartPolicy.Name}}'"),
    ("hanhai 容器进程", "docker exec hanhai-server ps -eo pid,pcpu,pmem,nlwp,cmd --sort=-pcpu | head -15"),
    ("hanhai 容器线程数", "docker exec hanhai-server bash -c 'ls /proc/$(pgrep -f llama-server | head -1)/task 2>/dev/null | wc -l'"),
    ("最近 10 行 hanhai 日志", "docker logs --tail 10 hanhai-server 2>&1 | grep -E 'tg|prompt|tokens per second' | tail -10"),
]

SAMPLE_CMDS = [
    ("docker stats", "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}' hanhai-server"),
    ("GPU util/mem/power", "nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.used,memory.free,memory.total,power.draw,temperature.gpu --format=csv,noheader"),
    ("CPU top 3", "top -bn1 | head -10 | tail -5"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=15)

for label, cmd in ONE_SHOT:
    print(f"\n========== {label} ==========")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
    out = stdout.read().decode(errors="ignore")
    err = stderr.read().decode(errors="ignore")
    print(out.rstrip())
    if err.strip():
        print("[stderr]", err.rstrip())

print("\n\n========== 5 次采样 (每隔 2s) ==========")
for i in range(5):
    print(f"\n--- 采样 {i+1} ---")
    for label, cmd in SAMPLE_CMDS:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
        out = stdout.read().decode(errors="ignore").rstrip()
        print(f"[{label}] {out}")
    if i < 4:
        client.exec_command("sleep 2")
        import time
        time.sleep(2)

client.close()
