#!/bin/bash
# ワークスペースのセットアップスクリプト

set -euo pipefail

pnpm install
pnpm build

# agent-policy の Agent 定義はプラグイン同梱のため、セットアップ工程は不要。
# モデルエイリアスの変更手順は plugins/agent-policy/README.md を参照。
