#!/bin/bash
# ワークスペースのセットアップスクリプト

set -euo pipefail

cp $ORCA_ROOT_PATH/.claude/settings.local.json $ORCA_WORKTREE_PATH/.claude/settings.local.json
cp -r $ORCA_ROOT_PATH/.claude/agents $ORCA_WORKTREE_PATH/.claude/agents

pnpm install
pnpm build
