# Codiel 👀🌿

GitHub issue の内容を取得・分析し、設計・開発・PR起票・レビューまでを一気通貫で行うオーケストレーターです。

## decition-kernel-mcp

Codiel オーケストレータ―の基幹システム。
LLM が出した回答をチェックし、機械的に PROCEED（続行）/ ASK（人に確認）/ STOP（停止）を判断するツールを提供する MCP サーバー。

## 開発手法

このプロジェクトでは、Node.js のバージョニングに Volta を推奨しています。
パッケージマネージャーは PNPM です。
リンター・フォーマッターに Biome を使用しています。

## エディターについて

Biome 拡張機能を入れた VSCode を推奨しています。
リンター・フォーマッターが効く関係で、 decision-kernel-mcp フォルダで作業するようにします。

## Claude Code での開発

MCP サーバー以外の部分を Claude Code を使って開発する場合、各種ハーネス資産と Skills 等を .claude に置くことができます。(任意)
ここで作成したファイルは .gitignore でリモートに反映されない設定にしています。

```bash
mkdir .claude
ln -s ../agents .claude/agents
ln -s ../commands .claude/commands
ln -s ../hooks .claude/hooks
ln -s ../skills .claude/skills
ln -s ../settings.json .claude/settings.json
cp harness-docs/ARCHITECTURE.example.md harness-docs/ARCHITECTURE.md
cp harness-docs/GOTCHAS.example.md harness-docs/GOTCHAS.md
cp CLAUDE.example.md CLAUDE.md
```
