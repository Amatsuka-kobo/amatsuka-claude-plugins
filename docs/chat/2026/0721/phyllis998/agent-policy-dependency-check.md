# agent-policy プラグインの依存性検査

- 日付: 2026-07-21
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `plugins/agent-policy/references/cost-discipline.md`、`plugins/agent-policy/.claude-plugin/plugin.json`(変更、コミットなし)
- 前提: plugins/agent-policy/ 配下の全ファイル(SKILL.md ×3、references ×3、setup assets テンプレート ×3、README.md、plugin.json、assets/context-map-template.md)

---

## セッション 1: 特定プラグインへの構造的依存の有無を検査

# phyllis998

> agent-policyプラグインが、特定の別プラグイン(特にSuperpowersやCodiel等のワークフロープラグイン)に依存した形式になっていないかを検査してください。

# AI

検査を実施し、特定プラグインへの構造的依存は存在しないことを確認しました。

**検査対象**: agent-policy プラグイン全12ファイル(SKILL.md ×3、references ×3、README、plugin.json、assets、テンプレート ×3)

**検査結果**:

- Superpowers: プラグイン内に言及ゼロ。skill 名の参照も一切なし。依存なし。
- Codiel: 言及はありますが、すべて「例」としての参照です。with-codex/SKILL.md:80 と claude-only/SKILL.md:69 の「役割 Agents を持つプラグインとの併用」節は「役割 Agents を持つワークフロープラグイン(**例: Codiel**)」という汎用ルールとして書かれており、判断フロー自体は「役割プロンプトを持つ Agents を検出したら担当表に照らす」という抽象条件で駆動します。Codiel がインストールされていない環境でも他の部分は完結して機能します。
- revelation: README.md:42 の「他プラグインとの棲み分け」節での説明のみ。動作依存なし。
- 内部参照の閉性: SKILL.md → `../../references/*.md`、setup → `assets/*.template.md`、guide → `assets/context-map-template.md` はすべてプラグインルート内で相対パスで閉じており、健全です。GPT テンプレートも他プラグインのスキルを指定していません。

**依存ではないが報告対象の点が 2 つあります**:

1. **リポジトリ外部参照が 1 箇所**: references/cost-discipline.md:5 が `docs/design/2026-07-21-agent-policy-cost-discipline-design.md` を「設計根拠の詳細」として参照しています。このリポジトリの docs/ 配下ファイルが参照されており、プラグインを Marketplace 経由で他プロジェクトにインストールした場合はリンク切れになります。規律本文自体は自己完結しているので動作影響はありませんが、配布物としては「(このリポジトリの)」といった注記を追加するか、参照の削除を検討する余地があります。

2. **Codiel 固有のエージェント名パターン**: `codiel-implementer-*` という具体名が例示として 3 ファイル(with-codex、claude-only、README)に埋め込まれています。依存ではありませんが、Codiel 側で命名が変わると例示が古くなる drift リスクはあります。ただし判断フロー自体は名前に依存しないため機能上は無害です。

**設計上の評価**: このプラグインの「併用」節は依存関係の良い設計例です。具体プラグイン名を**条件**にせず「役割 Agents を持つプラグイン」という**構造的特徴**を条件にしているため、Codiel 以外の同型プラグインにも適用でき、Codiel 不在でも劣化しません。

---

## セッション 2: docs/design 参照への注記追加対応

# phyllis998

> docs/design 参照の件、注記追加で対応して

# AI

セッション 1 で指摘した「リポジトリ外部参照によるリンク切れ」に対して、注記追加で対応しました。コスト規律に従い軽微な修正のため直接編集を実施しています。

**変更内容**:

1. **`plugins/agent-policy/references/cost-discipline.md:5`** — docs/design 参照に注記を追加。「開発リポジトリ amatsuka-claude-plugins 内の文書であり、プラグイン配布物には含まれないためインストール先では参照できない」と明記し、あわせて「本文書の規律は設計書を読まなくても自己完結する」と明記しました。これにより「リンク先が読めない環境でも規律の適用に支障がない」ことを、文書自身が宣言することで、配布物の自己完結性を保証しています。

2. **`plugins/agent-policy/.claude-plugin/plugin.json`** — CLAUDE.md のバージョン運用に従い、`0.3.1-dev` → `0.3.2-dev` にバージョンアップ。ドキュメント注記追加のみの軽微な変更のため、パッチバージョンを上げています。

**アプローチの評価**: 参照を削除せず注記で残す方式は「開発者向けトレーサビリティ」と「配布物の自己完結性」を両立します。設計根拠へのポインタは開発リポジトリで作業する人には有用なので、リンク切れの条件を明示するだけで十分です。

---

注意事項: codiel-implementer-* 具体名の一般化対応は未実施(機能上無害なため drift リスク低)。変更ファイルのコミットは未実施でユーザー指示待ち状態です。
