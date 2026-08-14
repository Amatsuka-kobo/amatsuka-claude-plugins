#!/bin/bash
# ワークスペースのセットアップスクリプト

set -euo pipefail

pnpm install
pnpm build

claude -p "/agent-policy:setup-gpt --yes"
claude -p "/agent-policy:setup-grok --yes"
