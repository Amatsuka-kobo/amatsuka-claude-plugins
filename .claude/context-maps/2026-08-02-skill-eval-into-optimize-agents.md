# Context Map: スキル eval 機構を optimize-agents へ取り込む

**作成日**: 2026-08-02
**作成者**: Opus(探索統括)
**対象タスク**: skill-creator の eval・ベンチマークのループ構造を optimize-agents に取り込み、手順化・スクリプト化する。スクリプトは TS で `plugins/optimize-agents/src/` → `scripts/`。
**関連する引き継ぎ書**: `docs/handover/2026-08-02-skill-eval-into-optimize-agents.md`

---

## 1. 目的・スコープ

スキルの品質を測る機構(発火精度の trigger eval、出力契約の output eval、集計、改善ループ)を optimize-agents プラグインの資産として持つ。現在はリポジトリルートの手書き `.mjs` と task-utility 配下の専用チェッカーに散在している。

- スコープ内: 測定ツールの optimize-agents への移設・一般化、集計機構、ループ手順のスキル化
- スコープ外: eval セットのデータそのもの(測定対象プラグイン配下に置く方針で確定済み)

## 2. 現在のコードベース構造

### 2.1 関連ファイル

```
scripts/run-trigger-eval.mjs           ← 移行対象(150行, Node標準のみ)
plugins/task-utility/evals/
├── README.md                          ← 3種セットの役割・実測値
├── check-chat-output.mjs              ← chat専用ハードコード(要一般化)
├── output-evals.json                  ← prompt + 自然文 assertion
├── trigger/*.json  short/*.json  fp/*.json   ← 6スキル × 3種
plugins/optimize-agents/               ← src/ も package.json も build.ts も無い
```

### 2.2 重要なファイル

| パス | 役割 | 重要度 |
| --- | --- | --- |
| `scripts/run-trigger-eval.mjs` | 移行元。ロジックは動作確認済み | High |
| `plugins/task-utility/evals/output-evals.json` | output eval の入力契約(`skill_name` / `evals[].{id,name,prompt,expected_output,assertions[]}`) | High |
| `plugins/task-utility/evals/check-chat-output.mjs` | 一般化対象。呼び出し元は無く手動実行のみ | High |
| `plugins/task-utility/build.ts` | esbuild 設定の雛形 | Medium |
| `pnpm-workspace.yaml` | `plugins/optimize-agents` の追加が必須 | Medium |
| `CLAUDE.md:15` | 参照先の更新対象 | Medium |
| `.raphael/antibodies/ab-2026-0802-001.md` | 本文中のパス更新対象 | Medium |

## 3. 関連モジュール・データフロー

### trigger eval(実装済み・移行のみ)

引数 → SKILL.md 読取(frontmatter `name` 抽出)→ tmpdir に `.claude/skills/<name>/SKILL.md` 配置 → クエリ×runs をワーカープール(独自 `pool()`, 101-114行)で並列 → `claude -p <query> --output-format stream-json --verbose --include-partial-messages --model <model>`(cwd=tmpdir, `CLAUDECODE` 削除)→ 最初の `content_block_start` が `tool_use` の時点で判定して SIGKILL → 集計 JSON を stdout。

- 合否: `should_trigger:true` は発火率 >= 0.5、`false` は発火率 === 0
- 既定: `--runs 2 --workers 4 --model claude-opus-5 --timeout 240`
- 出力: `{skill, results[], summary{total,passed,failed,false_negatives,false_positives}}`

### output eval(**ランナーが存在しない**)

現状は `check-chat-output.mjs <outDir> <evalId>` を手で叩き `grading.json` 互換 JSON を stdout に得るだけ。
**サンドボックス構築 → with_skill/without_skill 2構成での `claude -p` 実行 → 採点 → 反復** は前セッションで全部手作業。ここが最大の欠落。

## 4. 既存の実装パターン・規約

- 9 プラグインが `src/` を持つ。`build.ts` で `esbuild.build({bundle:true, outdir:"./scripts", outExtension:{".js":".mjs"}, platform:"node", format:"esm", target:"node26"})`、`entryPoints` はオブジェクトでキー名がそのまま出力ファイル名になる
- `package.json` は `{private:true, type:"module", scripts:{build:"tsx build.ts"}}` のみ。依存はルートの devDependencies (`esbuild` / `tsx` / `vitest` / `typescript` / `@biomejs/biome`) を workspace 経由で使う
- ルート `pnpm build` = `pnpm -r build`
- テスト: vitest、`include: ["plugins/**/__test__/**/*.test.ts"]`、timeout 20s、pool=forks。既存例は tmpdir + tmp git repo を作り `runTs()` で CLI を起動して JSON 出力を検証する統合テスト形式

## 5. 変更の影響範囲

### 5.1 直接

- `plugins/optimize-agents/` に `package.json` / `build.ts` / `src/` / `scripts/` を新設
- `pnpm-workspace.yaml` に `plugins/optimize-agents` 追加(忘れると `pnpm build` の対象外)
- ルート `scripts/run-trigger-eval.mjs` 削除
- `CLAUDE.md:15` の参照先更新
- 抗体 `ab-2026-0802-001` 本文のコマンド例更新(`plugins/raphael/scripts/update-antibody.mjs patch <id>` を使う)
- `plugins/optimize-agents/.claude-plugin/plugin.json`(現 `0.10.2-dev`)のバージョン繰り上げ

### 5.2 間接

- `plugins/task-utility/evals/README.md` のコマンド例
- 新規スキルを足す場合、optimize-agents の既存 4 スキル(claude-model-policy / prompt-smith / setup-gpt / with-codex-policy)との description 競合

### 5.3 避けるべき

- eval セットのデータ配置(測定対象プラグイン配下)は確定済み。動かさない
- trigger eval の判定ロジック(発火率しきい値、kill タイミング)は実測値の基準になっている。挙動を変えない

## 6. 守るべき既存契約

- **eval セット JSON**: `[{query:string, should_trigger:boolean}]`(6スキル×3種、既に 168 問ある)
- **output-evals.json**: `{skill_name, evals:[{id, name, prompt, expected_output, assertions:string[]}]}`。assertion は自然文
- **grading.json**: `{eval_id, expectations:[{text, passed, evidence}], summary:{total,passed,failed}}`。skill-creator の `aggregate_benchmark.py` もこの形を読む
- **回帰の基準値**(2026-08-02, task-utility 6スキル 168問): substantive 46/48, short 46/48, fp 69/72。移行後に同値以上であること
- output eval(chat): 新規 with 9/9 / without 4/9、追記 6/6 / 6/6

## 7. ユーザー確定事項(2026-08-02)

| 事項 | 決定 |
| --- | --- |
| スコープ | 引き継ぎ書の全 4 項目 |
| output eval のチェッカー | **プラグイン側に JS を残す**。optimize-agents は実行と集計だけを担う |
| eval の測定対象 | **skill のみ**。Agents は対象外(第1手打ち切り・subagent_type 検出の問題を回避) |
| 成果物の構成 | 3 スキル + 1 reference。下表 |

| 名前 | 種別 | 担当 |
| --- | --- | --- |
| `prompt-smith` | 既存スキル | AI 向け指示書の**本文** |
| `skill-eval` | 新規スキル | **skill の** eval 測定(trigger/output/benchmark/ループ) |
| `agent-creator` | 新規スキル | **Agent 定義**の作成・検証。本文は prompt-smith を内部参照 |
| `description-guide` | 既存 reference | 各スキルが共通で参照する description の基準 |

`plugin-dev` プラグインはこのリポジトリで無効化してよい(ユーザー判断、superpowers で開発しているため)。名前空間の衝突は考慮不要。

## 7b. 公式仕様の調査結果(2026-08-02, code.claude.com)

### frontmatter の全フィールド(このリポジトリは 4 つしか使っていない)

必須: `name` / `description`
任意: `tools` / `disallowedTools` / `model` / `permissionMode` / `maxTurns` / `skills` / `mcpServers` / `hooks` / `memory` / `background` / `effort` / `isolation` / `color` / `initialPrompt`

- `model` の既定は **`inherit`**。値は `sonnet`/`opus`/`haiku`/`fable`/完全 ID/`inherit`
- **プラグイン提供 agents は `hooks`・`mcpServers`・`permissionMode` を使えない**(セキュリティ上の理由、公式明記)。`isolation` は `worktree` のみ
- モデル解決順: `CLAUDE_CODE_SUBAGENT_MODEL` 環境変数 → 実行時 `model` → 定義の `model` → メイン会話

### 優先順位

managed settings(1) > `--agents` CLI(2) > `.claude/agents/`(3) > `~/.claude/agents/`(4) > プラグインの `agents/`(5)
プロジェクト agents は cwd から上へ walk し、v2.1.178 以降は cwd に最も近い定義が勝つ。

### description の公式推奨

- 定義: "When Claude should delegate to this subagent"
- 発火強化: "To encourage proactive delegation, include phrases like **"use proactively"** in your subagent's description field."
- **`<example>` ブロック形式は公式ドキュメントに記述なし**(plugin-dev 独自の様式)
- 長さの推奨は公式に記述なし

### 本文(system prompt)の公式推奨

- "The body becomes the system prompt that guides the subagent's behavior."
- 設計原則: **"Design focused subagents: each subagent should excel at one specific task"**
- ツール権限: "Limit tool access: grant only necessary permissions for security and focus"
- 構成・長さの具体的推奨は公式に記述なし(実例からは 手順 → チェックリスト → 出力仕様 のパターン)
- 非 fork の subagent は会話履歴・ロード済みスキル・既読ファイルを引き継がない

### 検証手段(公式)

- `claude plugin validate <path>` / `/plugin validate <path>`。`--strict` で警告もエラー扱い(CI 推奨)。plugin.json・skill/agent/command の frontmatter・hooks.json の構文とスキーマを検査
- `/doctor` は同一ディレクトリ内の name 重複を報告し、リネーム/削除を提案
- **未確認**: `claude plugin validate` はプラグイン配下が対象。`.claude/agents/` 直下の定義を検証する公式手段があるかは不明

## 7c. 未解決事項

| # | 質問 | 影響度 | 現状の仮定 |
| --- | --- | --- | --- |
| 1 | description-guide の Agents 節の根拠をどう示すか | High | skill 側=ローカル実測 168 問、agents 側=公式ドキュメント、と出典を分けて明記 |
| 2 | `.claude/agents/` 配下の定義の検証手段 | Medium | plugin 配下は `claude plugin validate`。project 配下は自前チェックが要る可能性 |
| 3 | output eval のサンドボックスへのプラグイン持ち込み方 | High | プラグインディレクトリごと配置。`${CLAUDE_PLUGIN_ROOT}` の解決が絡むので実測が要る |
| 4 | `output-evals.json` への `checker` / `fixtures` 追加 | Medium | 後方互換で足す |

## 8. テスト戦略

- 新規 TS には vitest の統合テスト(既存 `check-issue-env.test.ts` と同形式: tmpdir + CLI 起動 + JSON 検証)
- `claude -p` を呼ぶ部分はテストで実起動させない。プロセス起動を差し替え可能にするか、パーサ部分を純関数として切り出して単体テストする
- 最終検証は §6 の実測値との回帰比較。6スキル×3セットの並列測定で 20 分程度

## 9. 依存関係・リスク・制約

- **Anthropic API 不使用が必須要件**(CLAUDE.md)。`claude -p` のサブスク認証(CLIProxyAPI 経由)に閉じる
- 外部依存は Node 標準のみで足りている。増やす理由は現状ない
- ライセンス: skill-creator は Apache 2.0。`run-trigger-eval.mjs` はコード流用なしの独立実装。`aggregate_benchmark.py` のコードを参照して移植する場合は著作権表示と変更点の記載が要る
- 測定は必ず tmpdir を cwd にする(リポジトリの `.claude/` を拾わせない)

## 10. 推奨アプローチ

1. 基盤(`package.json` / `build.ts` / workspace 登録)を先に作る
2. `run-trigger-eval` を TS 移植し、既存 168 問で回帰確認してから旧 `.mjs` を消す
3. output eval ランナー(サンドボックス構築 → 2構成実行 → 採点呼び出し)を新設。チェッカーは差し替え可能な契約にする
4. 集計は `grading.json` を読む独立スクリプトにする
5. ループ手順はスキル化し、上記スクリプトを各段で呼ぶ

## 11. 暗黙知

- **測定器を先に疑う**: description を直してもスコアが動かないときは測定系を疑い、実績のある description で対照実験する。前セッションはこれを怠り 3 イテレーション無駄にした
- **3種同時測定が必須**: 除外記述を足すと fp は改善するが substantive/short が落ちる。片側だけ見ると悪化に気づけない
- **assertion の識別力**: with_skill だけ見ても assertion が緩いのかスキルが効いているのか区別できない。2 構成の差で見る
- `check-chat-output.mjs` に自動呼び出し元が無いのは設計上の欠落であって、意図的な手動運用ではない

---

*読む深さは `plugins/optimize-agents/references/context-map-guide.md` に従う。*
