# agent-policy 2 スキルの簡潔化(コンテキスト削減)

- 日付: 2026-07-25
- 参加者: phyllis998, AI (Claude Fable 5)
- 成果物: `plugins/agent-policy/skills/with-codex/SKILL.md`(100→64 行)、`plugins/agent-policy/skills/claude-only/SKILL.md`(73→49 行)、`plugins/agent-policy/README.md`(確定事実の移設先)、`plugins/agent-policy/.claude-plugin/plugin.json`(0.3.4-dev → 0.3.5-dev)。いずれも未コミット
- 前提: リポジトリ直下の `agents-with-codex.md` / `agents-claude-only.md`(簡潔さの見本として指定)

---

## セッション1: 削減候補の分析

# phyllis998

> agent-policyプラグインの2スキルの文章を、削れる部分は削って出来る限り簡潔にしたいです。
> 各スキルの文章を分析し、削れる部分を洗い出してください。
> これには余計なコンテキストを渡さないようにする意図があります。
> agents-claude-only.mdや、agents-with-codex.mdが見本となります。

# AI

見本 2 ファイル(各 22 行、指示のみ・根拠なし・重複なし)と現行 2 スキルを読み比べ、削減候補を 4 分類で提示した。既知の少数ファイルを読むだけの分析タスクのため、context-map の作成契機には該当しないと判断し直接読み比べた。

- **A. 完全な重複**: with-codex は役割分担が 3 箇所(基本原則/モデル別役割テーブル/GPT 担当節)+レビュー運用で重複。claude-only は 4 箇所(基本原則/テーブル/実装フェーズ/レビュー運用)。並列起動原則・context-map-guide 参照(3 回)も重複。テーブルの「トークン消費の目安」「備考(Chief Architect 等)」列は行動に影響しない装飾情報
- **B. 経緯・根拠の説明文**: 「確定事実(2026-07-20 実測検証済み)」ブロック(enum 制限)は経緯説明だが、結論は同梱方式の理由なので丸ごと削除は将来の誤修正リスクあり → 圧縮または README 移設を提案。「従来方針から継続」「合成ルールを一意に定める」等の動機説明も削除可
- **C. 構造統合**: with-codex の 2 つのフォールバック節は内容が重なり、かつ「GPT へ委譲しない」と「codex プラグインを使え」が別々に読めて矛盾しかねない構造 → 1 本の判断フローへの統合を提案
- **D. 残すべき**: 「Haiku レビューを GPT Luna に置き換えない」制約、事前条件 4 箇条と「列挙順に実行順の意味はない」注記、claude-only のキャッシュ注記、判断フロー内の運用詳細(frontmatter 除去・tools 明記・drift 防止)、frontmatter description(発動判定用)

削減見込みは with-codex 約 100→50 行前後、claude-only 約 73→40 行前後と提示。

## セッション2: A/B/C の適用

# phyllis998

> A/B/Cに着手お願いします。テーブル廃止でも構いません。確定事実はagent-policyプラグインのREADMEに移設し、skillからの参照は無しでお願いします。

# AI

分析済み内容の転記級作業のため、コスト規律(転記級はオーケストレーターが直接 Write)に従い委譲せず直接編集した。

- **A**: 両スキルの役割記述を見本と同形式の 1 本の箇条書き「モデル別役割」に統合。テーブル廃止(装飾列も消滅)。「レビュー運用」「実装フェーズ」節は同リストへ吸収。並列起動原則・guide 参照も各 1 箇所に集約
- **B**: 確定事実ブロックを README 新節「設計上の確定事実(dispatch 時の model 上書き制限)」へ移設。ユーザー指定どおりスキルからの参照は残さず、代わりに「dispatch 時の `model` 上書きは使わない」という指示 1 文のみをスキル本文に残した(根拠なしでも同梱方式が維持される)
- **C**: with-codex のフォールバック 2 節を 3 段階フロー(gpt-*.md → codex プラグイン `/codex:rescue --model gpt-5.6-*` → setup 案内+claude-only 担当表で一時代行)に統合。旧構成の矛盾しかねない記述も順序付きフローで一意化
- D 分類(Haiku レビュー非代替の制約、事前条件 4 箇条、キャッシュ注記、description)は無変更で維持

結果: with-codex 100→64 行、claude-only 73→49 行(2 スキル合計 106 行削除・55 行挿入)。plugin.json を 0.3.5-dev にバージョンアップ。references/・setup テンプレートに削除節名への参照が残っていないことを grep で確認済み。このプラグインに src/ はなくビルド不要。今回のセッションで失敗・やり直しはなし。

---

注意事項: 4 ファイルすべて未コミット。`git diff` に今回の作業と無関係な `.claude/settings.json` の既存変更が含まれている。frontmatter description の圧縮(D 分類)は見送りのまま。
