# raphael 抗体の質の改善 実装セッション起動プロンプト

以下を /goal コマンドの入力として使う。

---

raphael プラグインの「抗体の質の改善」(A 検知の質 / B1 trigger 精度 / B2 効果フィードバック / B3 汎用性ゲート / B4 stats 分離 / C 既存抗体の棚卸し)を実装する。

## 入力文書

- 設計書(正本): `harness-docs/design/2026-09-08-raphael-antibody-quality-design.md`
- 実装計画書(正本): `harness-docs/plans/2026-09-08-raphael-antibody-quality-implementation.md`
- context-map: `.claude/context-maps/2026-09-08-raphael-antibody-quality.md`
- 現行の設計文書(追随対象): `plugins/raphael/DESIGN.md`

設計書と実装計画書は、設計書・実装計画書のレビュー帯と独立レビュー帯の 2 段レビューを経て改訂され、ユーザーの承認を得た確定版である。設計書(第 3 版)§1.4 の裁定 #1〜#15 と §1.5 の裁定 R1〜R12(広さ検査の既定閾値は 10%)を前提とし、設計判断を問い返さない。設計書と実装または実データが食い違う事実を発見したときだけ、実装を止めてユーザーへ報告する。

## 進め方

1. セッションに注入された agent-policy の運用方針スキルを最初に読み、その規律(担当表・並列 dispatch・レビュー手順)に従う。
2. 最新の `git status` と HEAD を確認し、`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の baseline を記録して実装計画書 §7 に書き込む。本改修と無関係な未コミット変更・未追跡ファイル(会話記録、`cliproxyapi.config.example.yaml`、`.raphael/antibodies/` の既存 dirty)は revert・削除・上書きしない。
3. 実装計画書 §2 の WBS をステップ 1 から 13 まで直列に進める。並列 dispatch は行わない(裁定 R8)。各ステップは 1 コミット単位とし、完了時点で lint / typecheck / test が通ることを確認してから次へ進む。
4. テストを先に書いてから実装する(設計書 §9、実装計画書の各ステップのテスト表)。テストは一時ディレクトリで行い、`.raphael/` の実データは実機検証まで触らない。
5. AI が読む指示書(`agents/antibody-synthesizer.md` / `commands/review.md` / `skills/raphael/SKILL.md`)の改修は、`prompt-smith:prompt-smith` スキルをロードした担当に行わせる。
6. 実装計画書 §6 の実機検証(検証 0〜3)を最後に行い、結果を報告する。検証 2 では `commands.jsonl` の一意コマンド数を記録する(設計書 §12 N7)。

## 制約

- バージョンは `0.1.1-dev` → `0.2.0-dev`。`plugin.json` と `package.json` を揃える。
- `plugins/raphael/scripts/` は手で編集しない。`src/` を変更して `pnpm run build` で再生成し、差分を同じコミットに含める。
- `.raphael/antibodies/` は CLI(`update-antibody.mjs`)経由でのみ変更する。`migrate-stats` と `audit` は実機検証の手順に従う。
- Anthropic API クライアントを追加しない。`ANTHROPIC_API_KEY` を前提にしない。LLM 処理は synthesizer サブエージェントに閉じる。
- hook のフェイルオープン(例外時 stdout なし、セッションを止めない)と 15 秒 timeout を維持する。広さ検査を PreToolUse に足さない。
- metatron の GOTCHAS との棲み分け(一般則 → 抗体、リポジトリ限定 → GOTCHAS)は変更しない。raphael の指示層に他プラグイン名を書かない。
- 新設ファイル `.raphael/stats.json` と `.raphael/commands.jsonl` を `.gitignore` へ追記する(ステップ 1)。

## Done 条件(実装計画書 §5 と同一)

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `src/` を変更したすべてのコミットに `scripts/` の差分がある。
- `plugin.json` と `package.json` がともに `0.2.0-dev`。
- ルート `README.md` の raphael 節、`plugins/raphael/README.md`、`plugins/raphael/DESIGN.md`(`node26` 誤記の修正を含む)に反映済み。
- Serena メモリ `raphael/core` が本改修と食い違わない。
- `harness-docs/ARCHITECTURE.md` への影響有無を確認済み。影響があれば `/metatron:update` で追随済み。
- 実装計画書 §6 の実機検証 0〜3 がすべて成功し、`migrate-stats` 後に `git status` で抗体ファイルが dirty にならないことを確認済み。
