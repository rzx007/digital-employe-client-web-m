"""回滚 hanhai docker-compose 到调优前的备份并重启容器。"""
import paramiko
import warnings
import time

warnings.filterwarnings("ignore")

HOST = "10.172.246.220"
USER = "boban"
PASS = "100200"
COMPOSE_PATH = "/home/boban/BobanStaff/models/docker-compose.yml"
BACKUP_PATH = "/home/boban/BobanStaff/models/docker-compose.yml.bak-20260602-165829"


def run(client, cmd, *, timeout=30, label=None):
    if label:
        print(f"\n>>> {label}")
        print(f"    $ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="ignore")
    err = stderr.read().decode(errors="ignore")
    rc = stdout.channel.recv_exit_status()
    if out.rstrip():
        print(out.rstrip())
    if err.rstrip():
        print(f"[stderr] {err.rstrip()}")
    if rc != 0:
        print(f"[exit] {rc}")
    return rc, out, err


client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=15)

# 1) 确认备份存在
rc, _, _ = run(
    client,
    f"test -f {BACKUP_PATH} && echo OK || echo MISSING",
    label="确认备份存在",
)

# 2) 当前值
run(
    client,
    f"grep -E '^\\s*(-np|-c)\\s' {COMPOSE_PATH}",
    label="回滚前 -np / -c 当前值",
)

# 3) 把当前文件再保存一份（万一你后面又想试新参数）
ts = time.strftime("%Y%m%d-%H%M%S")
run(
    client,
    f"cp {COMPOSE_PATH} {COMPOSE_PATH}.tuned-{ts}",
    label=f"保存当前(已调优)版本到 {COMPOSE_PATH}.tuned-{ts}",
)

# 4) 恢复备份
run(
    client,
    f"cp {BACKUP_PATH} {COMPOSE_PATH}",
    label="恢复备份",
)

# 5) 验证恢复后的值
run(
    client,
    f"grep -E '^\\s*(-np|-c)\\s' {COMPOSE_PATH}",
    label="回滚后 -np / -c 值",
)

# 6) 重启容器
run(
    client,
    f"cd /home/boban/BobanStaff/models && docker compose down hanhai-llm",
    label="docker compose down",
    timeout=60,
)
run(
    client,
    f"cd /home/boban/BobanStaff/models && docker compose up -d hanhai-llm",
    label="docker compose up -d",
    timeout=120,
)

# 7) 等就绪
print("\n>>> 等待 hanhai-server 就绪...")
ready = False
for i in range(30):
    rc, status, _ = run(
        client,
        "docker inspect hanhai-server --format '{{.State.Status}}' 2>/dev/null",
        timeout=10,
    )
    if "running" in status:
        rc2, http, _ = run(
            client,
            "curl -s -o /dev/null -w '%{http_code}' http://localhost:12345/v1/models 2>&1 || true",
            timeout=10,
        )
        if "200" in http or "401" in http:
            print(f"\n[OK] HTTP {http.strip()}")
            ready = True
            break
    time.sleep(2)
if not ready:
    print("\n[WARN] timed out, check docker logs hanhai-server")

run(
    client,
    "docker logs --tail 10 hanhai-server 2>&1",
    label="启动日志",
)

client.close()
print("\n=== 回滚完成 ===")
