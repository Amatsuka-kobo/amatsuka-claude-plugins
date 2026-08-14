# chat 自動記録の毎ターン化 設計

日付: 2026-07-08
対象: `plugins/task-utility`(Stop フック `check-chat-recorded.mjs` / `skills/chat/SKILL.md`)

## 背景と目的

現在の Stop フックは「ユーザー発言 3 ターン以上・未記録」のときだけ chat-recorder への記録委譲を差し戻す。このため短いセッションは記録されず、また一度記録された後の会話は自動では追記されない。これを「1 ターン目から記録し、以降も毎ターン追記して常に最新化する」形に変更する。

あわせて調査で判明した潜在バグを修正する: Claude Code 2.1.204 ではサブエージェントのトランスクリプトが別ファイルに保存され、メイントランスクリプトに `isSidechain` エントリが残らない。そのため chat-recorder(サブエージェント)が行った `docs/chat/` への Write は現行の `recorded` 判定で検知できず、自動記録が成功しても次の Stop で再び差し戻される(重複記録ループ)。

## 方針決定(ユーザー確認済み)

- 毎ターン追記で常に最新化する(記録開始を早めるだけの最小変更ではない)
- 軽い会話(typo 修正等)も含め全会話を記録する方針に統一し、SKILL.md の「単純な一問一答や 1 行の修正には不要」の記述を削除する

## 判定ロジック(位置比較方式)

`check-chat-recorded.mjs` はメイントランスクリプトを 1 回走査し、次の 2 つの位置(行番号)を追跡する:

- `lastUserTurn`: 最後の実質ユーザー発言。現行基準を維持 — `type === 'user'` かつ `message.content` が文字列、trim 後に空でなく `<` 始まりでなく `isMeta` でない。
- `lastRecord`: 最後の記録イベント。次のいずれか:
  - `Write`/`Edit` ツールで `file_path` に `docs/chat/`(区切り正規化後)を含む
  - `Agent` ツールで `input.subagent_type` に `chat-recorder` を含む

block 条件: ユーザー発言が 1 回以上あり、かつ `lastUserTurn > lastRecord`。

維持する挙動:

- `stop_hook_active` なら即終了(無限ループ防止)
- `CLAUDE_PROJECT_DIR`(なければ `input.cwd`)に `docs/chat/` が存在しないプロジェクトでは何もしない
- トランスクリプト不在・パース不能行はスキップして安全側(沈黙)に倒す

`MIN_USER_TURNS` 定数は削除する。

## 差し戻し文言

- chat-recorder への委譲指示(トランスクリプトパス・抽出コマンド・SKILL.md パス・成果物情報)は現行を踏襲
- 「既存の記録ファイルがあれば未記録ターンのみ追記、なければ新規作成」を明示
- 「記録に値しない会話なら見送ってよい」の逃げ道は削除(全会話記録の方針)。技術的に記録不能な場合のみ、理由をユーザーに伝えて終了できる文言を残す

## SKILL.md の更新

- description: 「単純な一問一答や 1 行の修正には不要」を削除し、「1 ターン目から毎ターン追記で記録する」方針を明記
- 本文の記録形式(`## セッション N: <要旨>` / `# <ユーザー名>` / `# AI` 見出し)は変更しない

## テスト(`check-chat-recorded.test.mjs`)

追加・置換するケース:

1. ユーザー発言 1 回・未記録 → block
2. 記録イベント後に新しいユーザー発言なし → 沈黙
3. 記録イベント後に新しいユーザー発言あり → block(追記促し)
4. `chat-recorder` への Agent ディスパッチを記録イベントとして認識 → 沈黙

維持するケース: tool_result(配列 content)をユーザー発言に数えない / `stop_hook_active` で沈黙 / `docs/chat/` 不在で沈黙 / 不正 JSON 行のスキップ。

実行: `node --test plugins/task-utility/hooks/scripts/check-chat-recorded.test.mjs`

## コスト特性(許容済み)

毎ターン終了時に「block → chat-recorder 起動 → 追記」が基本動作になる。chat-recorder は軽量モデル(Haiku)で走らせる前提(リポジトリ CLAUDE.md の方針)。

## 非スコープ

- `extract-conversation.mjs` の変更(全会話出力のままとし、追記範囲の判断は chat-recorder に委ねる)
- サブエージェント別ファイルトランスクリプトの走査
- 旧プラグインキャッシュ(`~/.claude/plugins/cache/` の v0.0.1-dev)の掃除
