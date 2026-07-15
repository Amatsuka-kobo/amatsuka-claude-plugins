# Serena メモリの更新

- 日付: 2026-07-16
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: Serena メモリ 6 件更新 + 1 件新規追加（git 管理対象外）、README 4 ファイル修正
- 前提: CLAUDE.md、agents-with-codex.md、agents-claude-only.md、ONBOARDING.md、各 `plugins/*/.claude-plugin/plugin.json`、pnpm-workspace.yaml

---

## セッション 1: Serena メモリを現在のリポジトリに合わせて更新

# phyllis998

> serena 現在のリポジトリの内容に合うようにメモリを更新してください

# AI

既存メモリ 6 件を読んで実態と突き合わせた結果、5 件が陳腐化していたため書き換え、1 件を新規追加した（`memory_maintenance` は汎用の運用ルールなので変更なし）。

**何がズレていたか（主な 5 点）:**

1. **ビルド体系の全面移行** — 旧メモリは「ルートにビルドなし、コードは `plugins/codiel/raguel-mcp/` だけ」と記載していたが、現在はルートが pnpm workspace（`package.json` / `tsconfig.json` / `vitest.config.ts` / `biome.json`）で、4 プラグインすべてが `src/*.ts` → esbuild → `scripts/*.mjs`（git 管理）という同一構造。開発コマンドはルートから実行（`pnpm install/test/typecheck/lint/build`）、各プラグインには `build` スクリプトのみ。README に残っている「`cd plugins/basic-design && pnpm test`」のような記述は現在動作しない。

2. **プラグインが 3 → 4 個に増加** — `basic-design`（spec JSON → .drawio + HTML の基本設計図生成、0.6.0-dev）が追加されていたので、新規メモリ `basic_design/core` を起こした。

3. **エージェント運用方針の刷新** — 旧メモリの「Opus/Sonnet/Haiku で振り分け」は古く、現在は `agents-with-codex.md` の GPT Sol / Terra / Luna 体制（Fable/Opus は実装をしない、Haiku 先行レビュー、Fable アドバイザー）。

4. **テストの置き場所の移動** — colocated `foo.test.ts` から `__test__/` ディレクトリ配下に移動しており、ルートの vitest include が `plugins/**/__test__/**/*.test.ts` なので、外に置いたテストは黙って実行されない（事故りやすい落とし穴）。

5. **バンドル出力の git 管理と バージョン運用の明示化** — `scripts/*.mjs` と `raguel-mcp/dist/server.mjs` はコミット対象、`src` を触ったら `pnpm build` して同一コミットに含める、プラグイン単位でバージョンを上げる（メジャー は人間に確認）というルールを `conventions` / `task_completion` に反映した。

**そのまま残した重要事項:**

Anthropic API 非依存の不変条件（headless `claude` CLI 経由に閉じる）と、`CLAUDE.md` / `.claude/agents` が gitignore されているのは各自設定であって構成ミスではない、という点を `core` に明記した。

**メモリ参照グラフの整備:**

`core` を根に、`conventions` / `tech_stack` / `suggested_commands` / `task_completion` / モジュール別（`codiel/raguel_mcp`, `basic_design/core`）へ `mem:` 参照で辿る形に整えた。参照は「何が書いてあるか」まで記述するのが `memory_maintenance` ルール。

---

## セッション 2: README の記述誤り修正

# phyllis998

> 修正お願いします。他のプラグインのREADMEはどうなっていますか？

# AI

全プラグインの README を grep で調査し、実行不能なコマンド記述を特定。壊れていたのは basic-design だけではなく codiel にも古い記述があった。

**調査結果（README 4 件）:**

| プラグイン | 状態 |
|---|---|
| basic-design | ✗ `cd plugins/basic-design && pnpm install && pnpm test && pnpm typecheck && pnpm build` — test/typecheck は各プラグイン個別には存在せずルート専用。`pnpm --filter basic-design-generator build` が正 |
| codiel | ✗ 「Biome が効く関係で raguel-mcp フォルダで作業する」— `biome.json` はルートに移動済み。今はルート `package.json` を開いて作業するのが正 |
| task-utility | △ `pnpm test` は `cd` がないためルート実行として結果的に正しい。実行場所が曖昧な点のみ改善 |
| revelation | △ 同上。テストソースのパス記載は正確 |

**修正の委譲と実行:**

ドキュメント整備を運用方針に従い `GPT Terra` に委譲しようとしたが、モデル `claude-gpt-5-6-terra` にアクセス不可（Codex/CLIProxyAPI は任意設定で未接続）。`agents-claude-only.md` の対応表に従い、通常実装タスクの担当である `Sonnet` サブエージェントに切り替えて実行。

**修正内容（4 ファイル、README のみ。ソース・バンドルは変更なし）:**

- `plugins/basic-design/README.md` — ルート実行の手順に修正、`pnpm --filter basic-design-generator build` を追記
- `plugins/codiel/README.md` — 「biome.json はリポジトリルートにあるため、リポジトリルートを開いて作業する」に修正
- `plugins/task-utility/README.md` — 「リポジトリルートで実行する。」を明示的に追記
- `plugins/revelation/README.md` — 「(リポジトリルートで実行。ソース: …)」に修正

**最終レビュー:**

オーケストレーター（自身）が `git diff` で差分を確認。ルート `package.json` のスクリプト構成、`pnpm --filter` のワークスペース名、`biome.json` のルート配置と一致していることを検証済み。記述はすべて実態と一致。

**バージョン据え置き:**

CLAUDE.md の方針では「改修内容の大きさに応じて」バージョンを上げるが、今回は README の記述誤り修正のみでプラグインの挙動は一切変わらないため、バージョン上げは不要と判断した。

**もう 1 つ見つかった古い記述（今回は未修正）:**

`ONBOARDING.md` に、Node.js が必要な理由として「各プラグインの `.mjs` スクリプト、`node --test`、LSP のインストール…」とあるが、テストは現在 vitest。また ONBOARDING は Volta と Node のみを案内していて、`pnpm install` に一切触れていない — 新規メンバーがこの手順どおりに進めても `pnpm test` が動かせない状態。

---

注意事項: `ONBOARDING.md` の Node.js 必須理由（`node --test` → vitest に変更）と pnpm セットアップ手順の記載漏れについては、このセッションでは対応せず、ユーザーの判断を待機中。
