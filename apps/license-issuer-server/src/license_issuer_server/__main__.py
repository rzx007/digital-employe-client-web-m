"""uvicorn 启动入口：python -m license_issuer_server"""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.getenv("ISSUER_HOST", "0.0.0.0")
    port = int(os.getenv("ISSUER_PORT", "8900"))
    uvicorn.run("license_issuer_server.app:app", host=host, port=port)


if __name__ == "__main__":
    main()
