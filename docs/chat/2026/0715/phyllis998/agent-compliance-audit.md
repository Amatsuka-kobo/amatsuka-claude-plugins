# エージェント運用方針の準拠監査

- 日付: 2026-07-15
- 参加者: phyllis998, AI (Claude Opus 4.8)
- 成果物: 準拠監査レポート（Finding 1-4）、Finding 1-4 修正適用（`codex/gpt-terra.md`、`codex/gpt-luna.md`）
- 前提: `CLAUDE.md`、`agents-with-codex.md`、`agents-claude-only.md`、`codex/gpt-sol.md`、`codex/gpt-terra.md`、`codex/gpt-luna.md`

---

## セッション 1: 監査実施と結果報告

# phyllis998

> 現在のエージェント運用方針に、GPT Agentsが正確に沿える形になっているかを監査してください。

# AI

**実施内容**: オーケストレーター(Opus)自身が監査を実施。revelation スキル(fable-method)で多段階調査を構造化し、方針文3ファイル(`agents-with-codex.md`、`CLAUDE.md`、`agents-claude-only.md`)と GPT エージェント定義3ファイル(`codex/gpt-sol.md`、`codex/gpt-terra.md`、`codex/gpt-luna.md`)を読み込んで定義と方針の乖離を検証。

**重要な発見**: リポジトリはエージェント役割を「方針文」と「エージェント定義(description + 本文)」の二重で管理。オーケストレーターは実ルーティング時に定義(とくに description)を参照するため、両者がズレると方針が空文化する。

**Finding 1(最重要 / 直接矛盾)**: GPT Terra が「通常のコーディング」を担当から除外している。方針(`agents-with-codex.md:1`、`CLAUDE.md`)では「通常のコーディングとそれ以外のタスク」を Terra に割り当てているが、定義(`codex/gpt-terra.md:3,9`)はコーディングを明示的に除外し、When to invoke(L13-16)もドキュメント・設定・ビルド実行・定型メンテのみ。結果、コーディング3階層(複雑/通常/軽微)のうち「通常」が **どのエージェントにも属さない空白** になる。複雑は Sol、軽微は Luna だが、通常はどこにも行き先がない状況。

**Finding 2(中)**: Luna が「軽微なコーディング」を担当に追加(`codex/gpt-luna.md:3,9,16`)し、Sol(複雑)/Luna(軽微)の二極化で方針の三分割(複雑/通常/軽微)が潰れている。Luna 単体では「軽微なコーディング ⊂ 軽いタスク」と解釈できるが、Finding 1 と組み合わさると、方針が想定する中間層が宙に浮く。

**Finding 3(軽微)**: Haiku へのフォールバック指示が with-codex 方針に根拠がない。定義(`codex/gpt-luna.md:3`、`codex/gpt-terra.md:3`)では「単発の軽量作業→Haiku」と指示するが、`agents-with-codex.md` で Haiku に与えられている役割は設計書・実装計画書のレビューのみ(L7)。これは `agents-claude-only.md:1`(Haiku=軽いタスク)の記述が with-codex 用定義に混入した形と推定。低影響だが、方針の単一情報源から外れている。

**Finding 4(軽微)**: Luna の本文(`codex/gpt-luna.md:27`)が「Glob / Grep で件数を把握」と指示するが、frontmatter の tools(L6)に Grep がない。Bash 経由の grep で代替は効くものの、指示とツール権限が不一致。

**準拠確認**: GPT Sol は方針に準拠。複雑なコーディング + アドバイザー(設計・実装計画・レビュー・実装)の担当が `agents-with-codex.md:1,12` と一致し、オーケストレーション・委譲・レビュー・調査・分析を自身の役割から明示的に除外(L9,29)している点も方針と整合。3エージェント全て API 非依存・plugin.json バージョン制約記載あり(CLAUDE.md 必須要件に整合)。

**軽微な補足**: `CLAUDE.md` のアドバイザー節は「タスクに詰まった時」(汎用)、`agents-with-codex.md:12` は「設計・計画・レビュー・実装のタスクに詰まった時」(限定)と文言が食い違い、gpt-sol.md は後者(限定版)に沿っている。

**修正提示**: Finding 1 が最重要。修正するなら Terra の description・本文・When to invoke に「通常のコーディング」を担当として戻すのが筋。Finding 1〜4 全体の修正案作成は依頼があれば実施(現時点では報告のみ、実ファイルは未変更)。

---

## セッション 2: Finding 1-4 修正実装

# phyllis998

> 1～4の修正をお願いします

# AI

**修正依頼受領**: Finding 1〜4 の修正を実施。revelation の抑制規律を確認し、修正対象は定義ファイル2つ(`codex/gpt-terra.md`、`codex/gpt-luna.md`)のみに限定。方針ファイルは正しいため触らず、準拠済みの Sol も変更対象外。

**修正方針の決定**: 修正は「定義を方針に合わせる」単一方向。Finding 1(Terra に「通常のコーディング」を戻す)が根本原因で、Finding 2(二極化)・Finding 3(Haiku フォールバック)・Finding 4(Grep 権限)は全て Finding 1 の修正で連鎖的に解消する前提で設計。

**修正の委譲**: 定義ファイルの編集は GPT Terra に委譲(revelation 規律どおり：Opus は監査・設計、Terra は正確な適用)。具体的な old/new 文字列とファイル位置を指示し、タスク化。

**修正内容(5編集)**:
1. `codex/gpt-terra.md:3` description に「通常のコーディング」を追加、Haiku 記述を除去、「複雑なコーディングは Sol、軽微なコーディングは Luna」の相互参照を追加。
2. `codex/gpt-terra.md:9` 本文に同様の役割記述を追加(Haiku 除去)。
3. `codex/gpt-terra.md` When to invoke に「通常のコーディング」項目を新規追加。
4. `codex/gpt-luna.md:3` description から Haiku 記述を除去、相互参照を修正。
5. `codex/gpt-luna.md:6` frontmatter tools に `Grep` を追加。

**検証実施**:
- `git diff` を目視し、指定5編集が正確に適用されたことを確認。
- `grep -n "Haiku" codex/gpt-terra.md codex/gpt-luna.md` を実行 → 出力なし(単発フォールバック指示が完全に除去)。
- `grep -n "Grep" codex/gpt-luna.md` を実行 → tools 行に `Grep` を確認。
- ルーティング整合チェック → 複雑(Sol)/通常(Terra)/軽微(Luna)の三階層が重複なく、3ファイル全てで一貫していることを確認。

**並行編集への対応**: 検証中に `gpt-terra.md:33` に working tree 上の追加差分(`Codiel / raguel-mcp` → `プラグイン開発`)を検出。これはセッション開始時には存在せず、修正ターン中に発生した。あなたの IDE での並行編集と判断し、restraint に従いそのまま残す。コミットはしていない(報告のみ)。

**バージョン更新対象外**: これらのファイルは `plugins/*` 外のリポジトリ直下エージェント定義のため、plugin.json のバージョン更新対象ではない。

**修正完了**: Finding 1〜4 の全修正が適用され、検証完了。定義が方針と一致する状態に復帰。

---

注意事項: Finding 1 の修正により、コーディング3階層(複雑/通常/軽微)が復活し、Finding 2 の二極化が自動的に解消。Finding 3(Haiku フォールバック)・Finding 4(Grep 権限)も同時に是正。`gpt-terra.md:33` の並行編集差分は restraint に従い保持。コミット未実施。
