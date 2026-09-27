#!/usr/bin/env bash
# 対象プロジェクトに Codiel ハーネスの機械的資産(.codiel/ ディレクトリと config.json)を配置する。
# ARCHITECTURE / CLAUDE.md / raguel.config.yaml は initializing-harness スキル(/codiel:init)が
# 生成するため、このスクリプトでは扱わない。
# 使い方: bash <plugin-root>/scripts/install-harness.sh [対象プロジェクトルート(既定: カレント)]
set -euo pipefail
TARGET="${1:-$(pwd)}"

mkdir -p "$TARGET/.codiel/runs" "$TARGET/.codiel/reports"
echo "created: $TARGET/.codiel/{runs,reports}"

CONFIG="$TARGET/.codiel/config.json"
if [ ! -f "$CONFIG" ]; then
  printf '{\n  "testsDir": "docs/tests"\n}\n' > "$CONFIG"
  echo "created: $CONFIG"
else
  echo "kept: $CONFIG"
fi

echo "done."
