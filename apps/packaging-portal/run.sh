#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONUNBUFFERED=1
exec ./venv/bin/uvicorn packaging_portal.main:app --host 0.0.0.0 --port "${PORT:-8090}"
