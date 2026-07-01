#!/usr/bin/env bash
# 将 build-in-skills/browser-runtime 同步到 orchestrator_skills 镜像目录。
# 权威源：apps/server/build-in-skills/browser-runtime/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/server/build-in-skills/browser-runtime"
DST="$ROOT/apps/server/orchestrator_skills/browser-runtime"
mkdir -p "$DST"
cp -f "$SRC"/* "$DST"/
echo "Synced browser-runtime: $SRC -> $DST"
