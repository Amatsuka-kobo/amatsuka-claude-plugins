# prompt-smith

prompt-smith は、エージェントに渡すプロンプトを無駄なく理解しやすい形へ設計・改善・最適化する Claude Code プラグインです。AI が読む指示書、スキル・コマンド定義、Agent 定義を、それぞれの担当スキルで扱います。

## 提供するスキル

| スキル | 担当範囲 | 使い分け |
| --- | --- | --- |
| `prompt-smith` | CLAUDE.md、SKILL.md、コマンド定義、output style、メモリ、`references/` の AI 向け指示書を新規作成・評価・整理する | 既存の指示書本文を削る、曖昧な規則を判断基準へ置き換える、評価する場合に使う。SKILL.md・コマンド定義の description は扱わない。 |
| `skill-creator` | スキルとコマンド定義の作成、構造・同梱物・description の改善、eval セット作成、発火測定を行う | 新しいスキルまたはコマンドを作る、既存のスキル構造や description を改善・測定する場合に使う。指示書本文だけを整える場合は `prompt-smith` を使う。 |
| `agent-creator` | Agent 定義(subagent)の新規作成、frontmatter と本文の検証・修正を行う | `.claude/agents/` または `plugins/*/agents/` の Agent 定義を作成・点検する場合に使う。 |

## `skill-creator` のスクリプト

`skill-creator` は、同梱の Node.js スクリプトで description の発火測定と改善ループを実行します。測定・改善を行う `run-trigger-eval.mjs`、`improve-description.mjs`、`run-loop.mjs` には、PATH 上で実行できる `claude` CLI が必要です。`generate-report.mjs` は `run-loop.mjs` が内部から呼び出すレポート生成モジュールです。

| スクリプト | 用途 | CLI 引数 |
| --- | --- | --- |
| `scripts/run-trigger-eval.mjs` | 対象スキルを一時ディレクトリのプロジェクトスキルとして登録し、eval セットの各 query で Skill ツールが発火したかを測定する | 必須: `--skill-path <スキルディレクトリ>`、`--eval-set <eval セットJSON>`。任意: `--description <description>`、`--out <結果JSON>`、`--runs-per-query <回数>`、`--num-workers <並列数>`、`--timeout <秒>`、`--trigger-threshold <閾値>`、`--model <model-id>`、`--verbose`。 |
| `scripts/improve-description.mjs` | eval の失敗結果を基に、対象スキルの description 改善案を 1 回生成する | 必須: `--eval-results <結果JSON>`、`--skill-path <スキルディレクトリ>`、`--model <model-id>`。任意: `--history <履歴JSON>`、`--timeout <秒>`、`--verbose`、`--log-dir <ログディレクトリ>`、`--iteration <反復番号>`。 |
| `scripts/run-loop.mjs` | eval セットを学習用と holdout 用に分け、発火測定と description 改善を反復し、最良の description と結果を JSON で出力する | 必須: `--eval-set <eval セットJSON>`、`--skill-path <スキルディレクトリ>`、`--model <model-id>`。任意: `--description <description>`、`--num-workers <並列数>`、`--timeout <秒>`、`--improve-timeout <秒>`、`--max-iterations <回数>`、`--runs-per-query <回数>`、`--trigger-threshold <閾値>`、`--holdout <比率>`、`--verbose`、`--report <auto\|none\|出力HTMLパス>`、`--results-dir <結果ディレクトリ>`。 |
| `scripts/generate-report.mjs` | 改善ループの結果から HTML レポートを生成する | 単独実行用の CLI 引数はない。`run-loop.mjs` から呼び出すため、直接実行しない。 |

`--skill-path` には `SKILL.md` 自体ではなく、そのファイルを含むスキルディレクトリを指定します。

## eval セット

eval セットは `evals/` に置きます。現在は `evals/prompt-smith.json`、`evals/skill-creator.json`、`evals/agent-creator.json` があり、各ファイルは 20 件の query で構成されています。各要素は、スキルを発火させるべきかを表す `should_trigger` を含む JSON object です。

```json
[
  { "query": "ユーザーが実際に打ちそうな依頼文", "should_trigger": true },
  { "query": "近いが別の対応が要る依頼文", "should_trigger": false }
]
```

`query` は文字列、`should_trigger` は boolean です。同一の `query` は重複させません。

## 公式プラグインとの併用

このプラグインの `skill-creator` は、Anthropic 公式の `skill-creator` プラグインと同名です。両方を有効にすると、同名スキルへの発火が分かれるため、どちらか一方だけを有効にしてください。

## ライセンスと移植元

本プラグインには、Anthropic, PBC の公式 `skill-creator` Claude Code プラグインを TypeScript に移植したコードが含まれます。移植部分は Apache License 2.0 に従います。ライセンス本文は [LICENSE](LICENSE)、著作権表示、移植元と移植時の変更点は [NOTICE](NOTICE) を参照してください。
