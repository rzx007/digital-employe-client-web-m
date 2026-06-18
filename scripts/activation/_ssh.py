#!/usr/bin/env python3
"""在 220 真机执行命令/传文件（验证用）。用法见 __main__。"""
import os, sys, paramiko

HOST = os.environ.get("DE220_HOST", "10.172.246.220")
USER = os.environ.get("DE220_USER", "boban")
PWD = os.environ.get("DE220_PWD")
if not PWD:
    sys.stderr.write("缺少 SSH 密码：请设置环境变量 DE220_PWD\n")
    sys.exit(2)

def _client():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PWD, timeout=15,
              allow_agent=False, look_for_keys=False)
    return c

def run(cmd):
    c = _client()
    _, o, e = c.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    code = o.channel.recv_exit_status()
    c.close()
    return code, out, err

def put(local, remote):
    c = _client(); s = c.open_sftp()
    s.put(local, remote); s.close(); c.close()

if __name__ == "__main__":
    if sys.argv[1] == "run":
        code, out, err = run(sys.argv[2])
        sys.stdout.write(out)
        if err.strip(): sys.stderr.write(err)
        sys.exit(code)
    elif sys.argv[1] == "put":
        put(sys.argv[2], sys.argv[3]); print("PUT_OK")
