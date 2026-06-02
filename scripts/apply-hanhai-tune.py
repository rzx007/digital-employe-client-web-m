"""把 -np 4 -c 524288 改成 -np 2 -c 131072，备份原文件并重启容器。

只改 docker-compose.yml 里这两行；其他配置（slot-prompt-similarity、cache-ram、flash-attn 等）保持不变。
"""
import paramiko
import warnings
import time

warnings.filterwarnings("ignore")

HOST = "10.172.246.220"
USER = "boban"
PASS = "100200"
COMPOSE_PATH = "/home/boban/BobanStaff/models/docker-compose.yml"


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

ts = time.strftime("%Y%m%d-%H%M%S")
backup_path = f"{COMPOSE_PATH}.bak-{ts}"

# 1) 备份
run(
    client,
    f"cp {COMPOSE_PATH} {backup_path}",
    label=f"备份原文件到 {backup_path}",
)

# 2) 检查改动前的当前值
rc, before, _ = run(
    client,
    f"grep -E '^\\s*(-np|-c)\\s' {COMPOSE_PATH}",
    label="改动前 -np / -c 当前值",
)

# 3) 应用 sed 替换：仅匹配独立一行的 -np 4 / -c 524288，避免误伤
#    使用 #...# 分隔避免与路径冲突
run(
    client,
    f"sed -i -E 's#^(\\s*)-np\\s+4\\s*$#\\1-np 2#' {COMPOSE_PATH}",
    label="改 -np 4 -> -np 2",
)
run(
    client,
    f"sed -i -E 's#^(\\s*)-c\\s+524288\\s*$#\\1-c 131072#' {COMPOSE_PATH}",
    label="改 -c 524288 -> -c 131072",
)

# 4) 改动后值
rc, after, _ = run(
    client,
    f"grep -E '^\\s*(-np|-c)\\s' {COMPOSE_PATH}",
    label="改动后 -np / -c 当前值",
)

# 5) diff 校验
run(
    client,
    f"diff {backup_path} {COMPOSE_PATH} || true",
    label="diff（应当只有这两行变化）",
)

# 6) 询问继续：直接执行（非交互），用户已授权
print("\n>>> 重启容器...")

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

# 7) 等容器健康（最多 60s）
print("\n>>> 等待 hanhai-server 就绪...")
for i in range(30):
    rc, status, _ = run(
        client,
        "docker inspect hanhai-server --format '{{.State.Status}}' 2>/dev/null",
        timeout=10,
    )
    if "running" in status:
        # 再验证 API 端口
        rc2, http, _ = run(
            client,
            "curl -s -o /dev/null -w '%{http_code}' http://localhost:12345/v1/models 2>&1 || true",
            timeout=10,
        )
        if "200" in http or "401" in http:
            print(f"\n✅ 容器已就绪 (HTTP {http.strip()})")
            break
    time.sleep(2)
else:
    print("\n⚠️ 等待超时，请手动检查 docker logs hanhai-server")

# 8) 显示最近 15 行日志
run(
    client,
    "docker logs --tail 15 hanhai-server 2>&1",
    label="启动日志最后 15 行",
)

client.close()
print("\n=== 完成。备份：", backup_path)
