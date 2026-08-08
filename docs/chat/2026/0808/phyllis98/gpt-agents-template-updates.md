# GPT エージェント定義の生成と テンプレート修正

- 日付: 2026-08-08
- 参加者: phyllis98, AI (Claude Sonnet 5)
- 成果物: `.claude/agents/gpt-sol.md`, `.claude/agents/gpt-terra.md`, `.claude/agents/gpt-luna.md`, `plugins/agent-policy/skills/setup-gpt/assets/gpt-{sol,terra,luna}.template.md`, `plugins/agent-policy/assets/context-map-template.md`, `plugins/agent-policy/skills/setup-gpt/SKILL.md`
- 前提: agent-policy プラグインの setup-gpt スキル、プラグイン分割に伴う旧 id 追随対応 (コミット 20ab62c)

---

## セッション 1: テンプレート vs 既存ファイルの比較と方針決定

# AI

(tool: AskUserQuestion / Bash — List template assets and existing agents directory / Read — 各ファイル 6 件)

GPT エージェント定義ウィザード(agent-policy:setup-gpt)を実行し、テンプレートと既存ファイルを比較検査した。

**発見した問題**:
- テンプレートの `description` フィールドが「*optimize-agents* の with-codex-policy 運用方針」と記載されていたが、既存ファイルは「*agent-policy* の with-codex 運用方針」に修正済み。直近のプラグイン分割コミット(20ab62c)で `optimize-agents` → `agent-policy` へ改名されたにもかかわらず、`assets/*.template.md` がこの改名に追従していない状態だった。
- テンプレート通りに生成すると、既に修正済みの呼称が古いものへ後退する退行が起きる。
- 一方、既存ファイルは本文の記述が厚い箇所が 3 箇所あり(gpt-sol.md の Core Responsibilities、gpt-terra.md のコマンド報告義務、gpt-luna.md の集計報告ステップ)、テンプレートはこれらの増分コンテンツがない。

**決定**:
単純な上書きではなく、テンプレートの呼称部分を修正し、既存ファイルの充実した本文部分を保持したうえで 3 ファイルを再生成することとした。テンプレートエンジンを持たない素朴な置換方式では、構造変更が本文以外の箇所に波及しても検出されないため、生成前の既存生成物との突き合わせレビューが重要な安全網になると判断した。

# phyllis98

> テンプレートのdescriptionも直すという意図でした

# AI

(tool: Write — 3 つの gpt-*.md ファイル / Bash — Search for stale references / Read — context-map-template.md / Bash — List plugins / Edit — 5 つのテンプレートおよび SKILL.md / Bash — Verify remaining references)

テンプレートの `description` フィールドも含めて修正対応を進めた。

**実施内容**:
1. gpt-sol.md, gpt-terra.md, gpt-luna.md の 3 ファイルを、既存の充実した本文内容を保持したまま frontmatter の記述を最新状態に統一して再生成。
2. `plugins/agent-policy/skills/setup-gpt/assets/` 配下の 3 つのテンプレートファイル(gpt-sol.template.md, gpt-terra.template.md, gpt-luna.template.md)の `description` フィールドを「*optimize-agents*」から「*agent-policy*」へ修正。
3. `plugins/agent-policy/assets/context-map-template.md` の `GENERATOR_PLUGIN_NAME` 参照も同じく修正。
4. `plugins/agent-policy/skills/setup-gpt/SKILL.md` の説明文中に残っていた旧プラグイン名参照を検索・修正。
5. 全修正完了後、リポジトリ全体に「optimize-agents」の残存参照がないか再検査(確認完了)。

**理由**:
ユーザーの明示的な指示「テンプレートの description も直す」に応じ、テンプレート資産がコード本体と同様に「リポジトリ改名・分割」の影響を受けること、および静的テキストのため CI・ビルドで自動検証されないため参照先プラグイン名のドリフトが見つけにくいことを踏まえ、この機会に包括的に修正することとした。

**残り**:
その他のプラグイン内の stale reference は指摘なし(検査結果)。

---

## 注意事項

`.claude/agents/` ディレクトリの Git 管理状態は、プロジェクト方針で決定される。今回の変更は既存 3 ファイルの更新として `git status` に現れる。
