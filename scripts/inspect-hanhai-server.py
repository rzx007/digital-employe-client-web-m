"""只读 SSH 到 hanhai 宿主机收集诊断信息。
不修改任何东西；用于辅助分析配置/资源/容器状态。
"""
import paramiko
import warnings

warnings.filterwarnings("ignore")

HOST = "10.172.246.220"
USER = "boban"
PASS = "100200"

CMDS = [
    ("docker-compose.yml", "cat /home/boban/BobanStaff/models/docker-compose.yml"),
    ("free -h", "free -h"),
    ("nvidia-smi", "nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv"),
    ("docker ps", "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'"),
    ("hanhai-server inspect cmd", "docker inspect hanhai-server --format '{{json .Config.Cmd}}' 2>/dev/null || echo 'not running'"),
    ("hanhai logs tail (last 40 lines)", "docker logs --tail 40 hanhai-server 2>&1 | head -200"),
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=15)

for label, cmd in CMDS:
    print(f"\n========== {label} ==========")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
    out = stdout.read().decode(errors="ignore")
    err = stderr.read().decode(errors="ignore")
    if out:
        print(out)
    if err.strip():
        print("[stderr]", err, end="")

client.close()
