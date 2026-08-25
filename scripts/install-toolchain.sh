#!/bin/bash
# Volta 経由でこのワークスペースの Node.js と pnpm を導入するスクリプト
# 加えて Serena が使う uv、AI 用ツールが使う python3-full、GitHub 操作用の gh CLI も導入する

set -euo pipefail

if command -v volta >/dev/null 2>&1; then
  echo "Volta はすでに導入されています。"
else
  echo "Volta を導入します。"
  curl https://get.volta.sh | bash
fi

export VOLTA_HOME="${VOLTA_HOME:-$HOME/.volta}"
export PATH="$VOLTA_HOME/bin:$PATH"

if ! command -v volta >/dev/null 2>&1; then
  echo "Volta が見つかりません。シェルを再起動してから再実行してください。" >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

node_version="$(node --version)"
pnpm_version="$(pnpm --version)"

# uv (Serena MCP が使う Python ツールランナー)
if command -v uv >/dev/null 2>&1; then
  echo "uv はすでに導入されています。"
else
  echo "uv を導入します。"
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

export PATH="$HOME/.local/bin:$PATH"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv が見つかりません。シェルを再起動してから再実行してください。" >&2
  exit 1
fi

uv_version="$(uv --version)"

# python3-full (AI 用ツール tools/ の Python スクリプトが必要とするフル環境。Debian/Ubuntu 系、sudo が必要)
if command -v apt >/dev/null 2>&1; then
  if dpkg -s python3-full >/dev/null 2>&1; then
    echo "python3-full はすでに導入されています。"
  else
    echo "python3-full を導入します(sudo 権限が必要です)。"
    sudo apt update
    sudo apt install -y python3-full
  fi
else
  echo "apt が見つからないため python3-full の導入をスキップしました。手動で Python のフル環境をご用意ください。" >&2
fi

# gh CLI (GitHub 操作用)
if command -v apt >/dev/null 2>&1; then
  if command -v gh >/dev/null 2>&1; then
    echo "gh CLI はすでに導入されています。"
  else
    echo "gh CLI を導入します(sudo 権限が必要です)。"
    (type -p wget >/dev/null || (sudo apt update && sudo apt install -y wget)) \
      && sudo mkdir -p -m 755 /etc/apt/keyrings \
      && out=$(mktemp) && wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      && cat "$out" | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
      && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
      && sudo mkdir -p -m 755 /etc/apt/sources.list.d \
      && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
      && sudo apt update \
      && sudo apt install -y gh
  fi

  if command -v gh >/dev/null 2>&1; then
    if gh auth status >/dev/null 2>&1; then
      echo "gh は既に認証済みです。"
    else
      echo "gh の認証を行います。画面の指示に従ってください。"
      gh auth login
    fi
  fi
else
  echo "apt が見つからないため gh CLI の導入をスキップしました。手動で導入・認証してください。" >&2
fi

echo "ツールチェーンの導入が完了しました: Node.js ${node_version}, pnpm ${pnpm_version}, uv ${uv_version}"
