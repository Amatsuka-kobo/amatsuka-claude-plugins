#!/usr/bin/env bash
# 基準のブランチ(既定は main)から差分のあるプラグインと、それに依存するプラグインのテストだけを実行する。
# コミット前の変更も差分に含める。ルートの設定ファイルに差分があるときは、全プラグインのテストを実行する。
# 使い方: scripts/test-changed.sh [基準のブランチ]
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"
base="${1:-main}"

# ルートの設定ファイルは pnpm の依存グラフに載らないので、ここで見る
root_config='^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json|biome\.json|vitest\.config\.ts)$'
if git diff --name-only "$(git merge-base "${base}" HEAD)" | grep -Eq "${root_config}"; then
  echo "ルートの設定ファイルに差分があるため、全プラグインのテストを実行します"
  exec pnpm exec vitest run
fi

mapfile -t dirs < <(
  pnpm --filter "...[${base}]" ls --depth -1 --json |
    node -e 'for (const p of JSON.parse(require("fs").readFileSync(0, "utf8"))) console.log(p.path)'
)
if [ "${#dirs[@]}" -eq 0 ]; then
  echo "${base} から差分のあるプラグインはありません"
  exit 0
fi
printf 'テストするプラグイン: %s\n' "${dirs[*]#"${project_root}/"}"
exec pnpm exec vitest run "${dirs[@]}"
