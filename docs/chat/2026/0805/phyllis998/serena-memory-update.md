# Serena メモリのアップデート

- 日付: 2026-08-05
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: Serena メモリの更新（9 件 → 13 件）、新規記憶 1 件 `plugin-split-stale-ids`
- 前提: なし

---

## セッション1: Serena メモリのアップデート

# phyllis998

> serena メモリをアップデートしてください

# AI

**何をしたか**
Serena MCP を使用してメモリを読み取り・検証し、リポジトリの実況に合わせて更新。プラグイン構成の変更（`task-utility` → `gh-utility`+`chat-history`、`optimize-agents` → `agent-policy`+`prompt-smith`）を反映し、メモリを 9 件から 13 件に拡張。更新中にコード内の既存不整合を 4 件発見して記録。

**決定と理由**
CLAUDE.md の「後に来た衝突指示が優先」という原則により、出力スタイルの指示が「エージェント運用方針のスキル化」に優先。自身で全トランスクリプト範囲を探索・照合することとした。

**更新内訳**
- **既存メモリ 9 件を現況へ追随**
  - `core`: プラグイン 5 → 11 に、`_types`/mdbase を追記
  - `conventions`: references/docs/README の三分割、runtime-state ディレクトリ節、doc-only プラグインの例外を追記
  - `tech_stack`: workspace メンバー 10 件へ、Node 26(ビルド)vs 22(利用者)の区別、mdbase を追記
  - `suggested_commands`: パッケージ名一覧を更新、mdbase-lsp が `pnpm test` 外にあることを明記
  - `task_completion`: package.json 同期・README 反映・mdbase チェックを手順に追加
  - `basic_design/core`, `codiel/raguel_mcp`, `pitcrew/core`: 各バージョン追随 + 差分追記
- **新規メモリ 4 件を作成**
  - `agent_policy/core`: agent-policy + prompt-smith、担当表、dispatch 時 model 上書き enum 制約、コスト規律
  - `chat_history/core`: Stop フック → background recorder 構造、INDEX 契約
  - `raphael/core`: 感染 → 抗体 → PreToolUse 注入の動作、設定キー、fail-open
  - `guidepost/core`: ツアー生成 → ビューア → 質問注入ループ、at-most-once
- **自動メモリ側**: 6 件を現況に合わせ、新規 1 件 `plugin-split-stale-ids` を追加

**照合中に発見した既存不整合**（記録完了、修正は別途）
- **機能に影響（優先度高）**: 
  - `plugins/chat-history/skills/recall/SKILL.md:41` / `plugins/chat-history/skills/resume/SKILL.md:38` が存在しない `task-utility:chat-reader` を dispatch
  - `plugins/revelation/src/remind-skill.ts:31` の `SKIP_AGENT_TYPES` が旧 id のままで recorder を除外できていない
- **移行判断が要る**: 状態ファイル `~/.claude/task-utility/chat-recorder/`、フック通知プレフィックス `[task-utility]` のままでユーザーの記録状態が切れる可能性
- **文書のみ**: `chat-history`/`gh-utility` README の `task-utility` 記載、ルート README の重複、ONBOARDING.md・CLAUDE.example.md が旧参照

---

注意事項: コード修正は未実施。今回はメモリ化のみ。機能影響の 2 件から着手するとよい。

## セッション1: Serena メモリのアップデート

# phyllis998

> serena メモリをアップデートしてください

# AI

**何をしたか**
Serena MCP を使用してメモリを読み取り・検証し、リポジトリの実況に合わせて更新。プラグイン構成の変更（`task-utility` → `gh-utility`+`chat-history`、`optimize-agents` → `agent-policy`+`prompt-smith`）を反映し、メモリを 9 件から 13 件に拡張。更新中にコード内の既存不整合を 4 件発見して記録。

**決定と理由**
CLAUDE.md の「後に来た衝突指示が優先」という原則により、出力スタイルの指示が「エージェント運用方針のスキル化」に優先。自身で全トランスクリプト範囲を探索・照合することとした。

**更新内訳**
- **既存メモリ 9 件を現況へ追随**
  - `core`: プラグイン 5 → 11 に、`_types`/mdbase を追記
  - `conventions`: references/docs/README の三分割、runtime-state ディレクトリ節、doc-only プラグインの例外を追記
  - `tech_stack`: workspace メンバー 10 件へ、Node 26(ビルド)vs 22(利用者)の区別、mdbase を追記
  - `suggested_commands`: パッケージ名一覧を更新、mdbase-lsp が `pnpm test` 外にあることを明記
  - `task_completion`: package.json 同期・README 反映・mdbase チェックを手順に追加
  - `basic_design/core`, `codiel/raguel_mcp`, `pitcrew/core`: 各バージョン追随 + 差分追記
- **新規メモリ 4 件を作成**
  - `agent_policy/core`: agent-policy + prompt-smith、担当表、dispatch 時 model 上書き enum 制約、コスト規律
  - `chat_history/core`: Stop フック → background recorder 構造、INDEX 契約
  - `raphael/core`: 感染 → 抗体 → PreToolUse 注入の動作、設定キー、fail-open
  - `guidepost/core`: ツアー生成 → ビューア → 質問注入ループ、at-most-once
- **自動メモリ側**: 6 件を現況に合わせ、新規 1 件 `plugin-split-stale-ids` を追加

**照合中に発見した既存不整合**（記録完了、修正は別途）
- **機能に影響（優先度高）**: 
  - `plugins/chat-history/skills/recall/SKILL.md:41` / `plugins/chat-history/skills/resume/SKILL.md:38` が存在しない `task-utility:chat-reader` を dispatch
  - `plugins/revelation/src/remind-skill.ts:31` の `SKIP_AGENT_TYPES` が旧 id のままで recorder を除外できていない
- **移行判断が要る**: 状態ファイル `~/.claude/task-utility/chat-recorder/`、フック通知プレフィックス `[task-utility]` のままでユーザーの記録状態が切れる可能性
- **文書のみ**: `chat-history`/`gh-utility` README の `task-utility` 記載、ルート README の重複、ONBOARDING.md・CLAUDE.example.md が旧参照

---

注意事項: コード修正は未実施。今回はメモリ化のみ。機能影響の 2 件から着手するとよい。

## セッション 1: プラグイン分割後の旧参照を修正

# phyllis998

> CLAUDE.example.md も直してください。chat-recorderのデータ移行もお願いします

# AI

**何をしたか**

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/chat-history/skills/recall/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/chat-history/skills/resume/SKILL.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/revelation/src/remind-skill.ts)

存在しない `task-utility:chat-reader` 参照（recall/resume の SKILL.md）と旧 id を含む `SKIP_AGENT_TYPES`（revelation）の 2 箇所を修正。併せて、README・ルート README・CLAUDE.example.md・ONBOARDING.md の旧 id 参照を計 10 箇所一括置換。chat-recorder のデータ移行として、`~/.claude/task-utility/chat-recorder/` の配下ファイルをプロジェクト内 `docs/chat/runtime-state/` に移行し、状態管理を永続化。

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/chat-history/skills/recall/SKILL.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/chat-history/skills/resume/SKILL.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/revelation/src/remind-skill.ts)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/revelation/src/__test__/remind-skill.test.ts)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/chat-history/README.md)

(tool: Write — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/chat-history/README.md)

(tool: Read — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/gh-utility/README.md)

(tool: Write — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/gh-utility/README.md)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/CLAUDE.example.md)

(tool: Bash — Replace optimize-agents ids in ONBOARDING.md)

(tool: Bash — Replace optimize-agents ids in agent-policy/prompt-smith SKILL.md)

(tool: Bash — Verify no stale ids remain in live md files)

(tool: Bash — Create runtime-state directory)

(tool: Bash — Migrate chat-recorder state files)

(tool: Bash — Migrate task-completion state)

(tool: Edit — /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/plugins/chat-history/README.md)

(tool: Bash — Build all plugins)

(tool: Bash — Run vitest for all tests)

(tool: Bash — Run typecheck and lint)

ビルド・テスト・型チェック・lint すべて通過。バンドル出力には新 id が反映済み。

**決定と理由**

- `SKIP_AGENT_TYPES` は置換ではなく新旧併記（Set）：旧 `task-utility` を入れたままのプロジェクトでもビルド不要・素通しを維持するため
- 後方互換テスト（`task-utility:chat-recorder` の assert 2 箇所）は意図的に保持：`hasRunningRecorder` の表記ゆれ耐性を守るため
- chat-recorder 状態ファイルの移行先を `docs/chat/runtime-state/` に統一：ユーザーの記録状態を孤立させず、プロジェクト側で引き継げるように

**却下された選択肢**

- 旧 SKIP_AGENT_TYPES を新 id で置換：既存プロジェクトで `task-utility` が残っていると recorder が除外され、記録が止まる
- 後方互換テストの削除：将来のプラグイン併用環境での誤検知防止に必要

**失敗・やり直し・誤った前提**

置換ミス 1 件を発見・修正：`plugins/prompt-smith/skills/agent-creator/SKILL.md:108` が本来 `prompt-smith:*` であるべき行を `optimize-agents:*` のまま置き換えてしまった。再読取により検出し、`prompt-smith:prompt-smith` に訂正（5db8efe にて fix-commit）。最終検証で no stale ids を確認。

---

注意事項: バージョン更新なし（前ターンで実施済み）。コミットは未実施。
