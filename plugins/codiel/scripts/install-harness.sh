#!/usr/bin/env bash
# 対象プロジェクトに Codiel ハーネスの機械的資産(.codiel/ ディレクトリと config.json)を配置する。
# config.json の raguel・.gitignore・.claude/rules/codiel.md・CLAUDE.md の ## Codiel は
# initializing-harness スキル(/codiel:init)が書くため、このスクリプトでは扱わない。
# 使い方: bash <plugin-root>/scripts/install-harness.sh [対象プロジェクトルート(既定: カレント)]
set -euo pipefail
TARGET="${1:-$(pwd)}"

mkdir -p "$TARGET/.codiel/runs" "$TARGET/.codiel/reports"
echo "created: $TARGET/.codiel/{runs,reports}"

CONFIG="$TARGET/.codiel/config.json"
if [ ! -f "$CONFIG" ]; then
  printf '{\n  "testsDir": "docs/codiel/tests",\n  "runsDir": "docs/codiel/runs"\n}\n' > "$CONFIG"
  echo "created: $CONFIG"
else
  echo "kept: $CONFIG"
fi

echo "done."
