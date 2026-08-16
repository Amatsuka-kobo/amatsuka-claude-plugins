#!/usr/bin/env bash
# 対象プロジェクトに Codiel ハーネスの機械的資産(.codiel/ ディレクトリ)を配置する。
# ARCHITECTURE / CLAUDE.md / raguel.config.yaml は initializing-harness スキル(/codiel:init)が
# 生成するため、このスクリプトでは扱わない。
# GOTCHAS は失敗を記録する時点で recording-gotchas スキルが台帳ごと作成するため、ここでは配置しない。
# 使い方: bash <plugin-root>/scripts/install-harness.sh [対象プロジェクトルート(既定: カレント)]
set -euo pipefail
TARGET="${1:-$(pwd)}"

mkdir -p "$TARGET/.codiel/specs" "$TARGET/.codiel/runs" "$TARGET/.codiel/reports"
echo "created: $TARGET/.codiel/{specs,runs,reports}"
echo "done."
