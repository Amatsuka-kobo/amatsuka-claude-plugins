#!/usr/bin/env bash

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
flag_path="${project_root}/.claude/delegation-gate.direct"
now="$(date +%s)"

case "${1:-}" in
  on)
    mkdir -p "${project_root}/.claude"
    touch "${flag_path}"
    expires_at="$((now + 7200))"
    printf '直接編集の一時解除を有効にしました。失効時刻: %s\n' "$(date -d "@${expires_at}" '+%Y-%m-%d %H:%M:%S %Z')"
    ;;
  off)
    rm -f "${flag_path}"
    printf '直接編集の一時解除を終了しました。\n'
    ;;
  status)
    if [[ ! -e "${flag_path}" ]]; then
      printf '直接編集の一時解除は無効です。\n'
      exit 0
    fi

    modified_at="$(stat -c %Y "${flag_path}")"
    age="$((now - modified_at))"
    if ((age >= 0 && age <= 7200)); then
      remaining_minutes="$(((7200 - age + 59) / 60))"
      printf '直接編集の一時解除は有効です。残り時間: %s分\n' "${remaining_minutes}"
    else
      printf '直接編集の一時解除は失効済みです。\n'
    fi
    ;;
  *)
    printf '使い方: bash scripts/direct-edit.sh on|off|status\n' >&2
    exit 1
    ;;
esac
