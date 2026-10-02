#!/usr/bin/env bash
# codiel:run のコスト計測の題材を開始状態に戻す。
# 計画書 harness-docs/plans/2026-10-02-codiel-run-cost-plan.md の「計測の開始状態」に従う。
set -euo pipefail

bench="${BENCH_DIR:-$HOME/codiel-cost-bench}"
start_commit="${START_COMMIT:-0f23d8d}"

cd "$bench"
git checkout -q main
git reset -q --hard "$start_commit"
# run ブランチを消す(main 以外)
git for-each-ref --format='%(refname:short)' refs/heads | grep -vx main | xargs -r git branch -q -D
# 追跡外のファイルを消す。node_modules は残す
git clean -q -fdx -e node_modules
# codiel の初期化が作る空のディレクトリは git に載らないので作り直す
mkdir -p .codiel/runs .codiel/reports
# Raguel の記録(この題材の projectId のもの)を消す
rm -rf "$HOME"/.raguel/cases/codiel-cost-bench-* "$HOME"/.raguel/precedents/codiel-cost-bench-*

printf '開始状態に戻しました: %s @ %s\n' "$bench" "$(git rev-parse --short HEAD)"
git status --short
