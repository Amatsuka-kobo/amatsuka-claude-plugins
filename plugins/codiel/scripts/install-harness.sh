#!/usr/bin/env bash
# 対象プロジェクトに Codiel ハーネスの機械的資産(.codiel/ ディレクトリと GOTCHAS.md 雛形)を配置する。
# ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml は initializing-harness スキル(/codiel:init)が
# 対話インタビューで生成するため、このスクリプトでは扱わない。
# 使い方: bash <plugin-root>/scripts/install-harness.sh [対象プロジェクトルート(既定: カレント)]
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$(pwd)}"

copy_if_absent() { # $1=src $2=dest
  if [ -e "$2" ]; then echo "skip(既存): $2"; else mkdir -p "$(dirname "$2")"; cp "$1" "$2"; echo "created: $2"; fi
}

copy_if_absent "$PLUGIN_ROOT/docs/GOTCHAS.example.md" "$TARGET/docs/GOTCHAS.md"
mkdir -p "$TARGET/.codiel/specs" "$TARGET/.codiel/runs" "$TARGET/.codiel/reports"
echo "done."
