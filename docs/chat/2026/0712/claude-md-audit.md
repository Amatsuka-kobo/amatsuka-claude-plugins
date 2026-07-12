# CLAUDE.md 監査

- 日付: 2026-07-12
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: `CLAUDE.md`（修正）、`plugins/task-utility/.claude-plugin/plugin.json`（ディレクトリ統一）
- 前提: CLAUDE.md（監査対象）、claude-md-management:claude-md-improver スキル

---

## セッション1: CLAUDE.md 品質監査と Issue 特定

# phyllis998

> CLAUDE.mdの監査を行ってください

# AI

**何をしたか**：claude-md-improver スキルを用いて、ルート `CLAUDE.md` 全体を対象に監査を実施。記載内容をコードベースと実地検証し、品質スコアを算出。

**監査結果**：
- **スコア: 76/100（Grade B）**
- **評価の観点**：
  - Commands/workflows: 16/20（raguel-mcp の `pnpm build/test/typecheck` と `node --test` のパスは実在・正確。ただしバージョン更新ワークフローのパスが誤り）
  - Architecture clarity: 12/20（各プラグインの内部構造マップが無く「README/DESIGN 参照」に委譲。3プラグイン構成の索引が薄い）
  - Non-obvious patterns: 14/15（Codiel/Raguel の API 不使用制約が理由・参照付きで秀逸。GPT 不在時のフォールバック表も good）
  - Conciseness: 14/15（密度が高く冗長さは無い）
  - Currency: 9/15（後述のパス不整合・バージョン表記の抜けで減点）
  - Actionability: 11/15（コマンドはコピペ可。ただしバージョン更新指示が実行不能なパスを指す）

**特定した Issue**：

1. **[High] 「プラグインのアップデート」節の `.claude-plugins/plugin.json` パスが実在しない**
   - ルートに `.claude-plugins/` ディレクトリは存在しない。バージョンは**各プラグインごと**に独立した manifest に存在する。
   - 実体：
     - `plugins/codiel/.claude-plugin/plugin.json` → `1.0.0-alpha.3`（単数形 `.claude-plugin`）
     - `plugins/revelation/.claude-plugin/plugin.json` → `1.1.0-dev`（単数形）
     - `plugins/task-utility/.claude-plugins/plugin.json` → `1.2.0-dev`（複数形 `.claude-plugins`。このプラグインのみ）
   - 現在の CLAUDE.md は「per-plugin である」旨も、ディレクトリ名が揺れている旨も書いていない。未来のセッションは `plugins/<name>/.claude-plugin/plugin.json` と `.claude-plugins`（複数形）のどちらを対象にすべきか特定できず、汎用パスを検索してもエラーとなる。

2. **[Medium・リポジトリ構造側の問題] ディレクトリ名の不統一**
   - task-utility だけが `.claude-plugins`（複数形）。codiel/revelation は `.claude-plugin`（単数形）。
   - Issue ① の根本原因だが、CLAUDE.md 側では「揺れがある」と明記して回避し、リポジトリ構造自体の是正要否はユーザー判断に委ねる提案。

3. **[Low] バージョン表記の未網羅**
   - CLAUDE.md では「`n1.n2.n3 / alpha.n4`」の形式を規定しているが、実体は `-alpha.3` と `-dev` サフィックスの2系統が混在。規約説明に `-dev` が欠落。

**提案する修正（CLAUDE.md への追記/修正）**：

```diff
 ## プラグインのアップデート

-プラグインの改修を行った場合、その内容の大きさに応じて `.claude-plugins/plugin.json` のバージョンを上げるようにしてください。
-ただし自動で行うのはマイナーバージョン(n1.n2.n3 / alpha.n4 の n2以降)のアップデートのみで、変更の多さからメジャーバージョン(n1)を上げる判断をした場合は、人間に必ず確認するようにしてください。
+プラグインの改修を行った場合、その内容の大きさに応じて、**改修した該当プラグインの** `plugin.json` のバージョンを上げるようにしてください。バージョンは各プラグインごとに独立しており、置き場所のディレクトリ名が揺れている点に注意:
+
+| プラグイン | manifest パス |
+| --- | --- |
+| codiel | `plugins/codiel/.claude-plugin/plugin.json` |
+| revelation | `plugins/revelation/.claude-plugin/plugin.json` |
+| task-utility | `plugins/task-utility/.claude-plugins/plugin.json`(※このプラグインのみ複数形 `.claude-plugins`) |
+
+バージョンは `n1.n2.n3`、またはプレリリース時は `n1.n2.n3-alpha.n4` / `n1.n2.n3-dev` の形式。自動で行うのはマイナーバージョン(n2 以降 / プレリリース番号)のアップデートのみで、変更の多さからメジャーバージョン(n1)を上げる判断をした場合は、人間に必ず確認するようにしてください。
```

この修正で Issue ① と ③ が解消し、Currency/Actionability が回復する（概算 84/100・A- 寄りの B）。

**ユーザーへの確認事項**（回答待ち）：
1. 上記 diff を CLAUDE.md に適用してよいか？（Issue ① ③ の修正）
2. Issue ② のディレクトリ名不統一（task-utility だけ `.claude-plugins` 複数形）について、CLAUDE.md では注記に留めた。これを根本から `.claude-plugin`（単数）に揃える**リポジトリ構造側の是正**も別途行うべきか、それとも現状維持で注記のみとするか？

---

## セッション2: 是正実施

# phyllis998

> 1. 適用してよいです。
> 2. リポジトリ構造ごと是正お願いします。

# AI

**何をしたか**：Issue ① ③ の CLAUDE.md 修正と、Issue ② のリポジトリ構造統一（`git mv` による複数形ディレクトリ単数形化）を実施。最後に整合性の最終検証を行った。

**実施内容**：

1. **複数形ディレクトリ検証**：task-utility の `.claude-plugins/` 直下に `plugin.json` のみ存在、単数形ディレクトリ `.claude-plugin/` との衝突なし。コード上で `.claude-plugins` への参照は無く（残るは `docs/` 配下の過去の設計記録・チャット記録のみで、歴史文書として改変対象外）、安全に統一可能と判断。

2. **ディレクトリ統一（git mv）**：`git mv plugins/task-utility/.claude-plugins plugins/task-utility/.claude-plugin` を実行。3プラグイン（codiel/revelation/task-utility）すべてが `.claude-plugin`（単数形）に統一。

3. **CLAUDE.md 修正**：提案の diff を適用。「プラグインのアップデート」節を以下の内容に変更：
   - `plugins/<plugin>/.claude-plugin/plugin.json`（per-plugin パス）を明記
   - バージョン形式に `n1.n2.n3-dev` を追記（提案の `alpha.n4` と `dev` 両形式を記載）
   - 実体との齟齬解消により、Currency/Actionability が回復

4. **最終検証**：3つの manifest パスすべて単数形に統一、`.claude-plugins`（複数）への参照がコード上に無いことを確認。CLAUDE.md の記載と実装が一致。

**スコア変化**：76/100（B）→ 概算 **86/100（B+〜A-）**。Currency と Actionability が回復。

**未対応（別タスク）**：アーキテクチャマップの薄さ（Medium）は今回は手を付けず。3プラグイン構成の索引追加をご希望であれば別途対応可能。

---

注意事項：コミットはまだ実施していません（`M CLAUDE.md` と `R`(git mv) がステージング待ち）。成果物をコミットするか、ひとまず未コミット状態で保留するかはユーザー判断にお任せします。
