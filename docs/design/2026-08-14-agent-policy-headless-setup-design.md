# setup-gpt / setup-grok の headless 実行 設計

## 背景と目的

`agent-policy:setup-gpt` / `agent-policy:setup-grok` は現在すべてのステップが人間の応答を前提としており、`claude -p`(headless)では完走できない。新規プロジェクトのブートストラップを 1 コマンドで済ませたい。

## 真因

`AskUserQuestion` による上書き確認(ステップ 3)は症状の一つにすぎない。ステップ 1(前提確認)・ステップ 2(エイリアス確認)も「ユーザーに確認する」で停止する設計で、SKILL.md には確認を省く条件が一切書かれていない。**非対話パスが存在しないこと**が真因である。

起動口そのものは既に成立している。公式ドキュメントの確認結果は次のとおり。

| 論点 | 確認結果 |
| --- | --- |
| `-p` でのスキル起動 | 成立する。`/skill-name` をプロンプト文字列に含めると展開される |
| 引数の受け取り | `$ARGUMENTS` / `$ARGUMENTS[N]` / `$N` で参照できる。本文に `$ARGUMENTS` が無い場合は末尾に `ARGUMENTS: <value>` が付くだけ |
| `allowed-tools` frontmatter | `-p` でも、ワークスペースを信頼していないフォルダでも適用される。スキルを起動したターンの間だけ有効 |
| `${CLAUDE_PLUGIN_ROOT}` | プラグインスキルの本文と `allowed-tools` の Bash ルールの双方で置換される。両者を同一パスにすれば権限プロンプトが出ない |
| `AskUserQuestion` | `dontAsk` では allow ルールに合致しても拒否される |

## 要件

- `claude -p` から起動でき、ユーザー確認を一切行わない。
- モデルエイリアスは規定値を使う。
- 既存ファイルは全て上書きする。
- 対話モードの既存の振る舞いは維持する。

## 方針

生成処理の実体を TypeScript スクリプトへ移し、対話モードと非対話モードの双方がそれを呼ぶ。

採用理由は 2 つ。

1. **逐語再現の保証** — テンプレートは合計 13.5KB(GPT 3 本)/ 10.7KB(Grok 2 本)。LLM の Read/Write で往復させると 1 行の欠落が検知されないまま定義ファイルへ混入しうる。`readFile` → 置換 → `writeFile` なら構造的に起こらない。
2. **リポジトリ規約** — 「プラグインが実行するスクリプトは TypeScript で書く」に合致する。

副次的に、1 回あたり約 8k トークン(GPT)の入出力が消える。

非対話パスの入口は**既存スキルに `--yes` 引数を足す形**とする(スキル名を増やさない)。決定性を仕様レベルで保証する手段(`disallowed-tools: AskUserQuestion`、`` !`command` `` 注入)は frontmatter 固定で条件分岐できず、対話モードと同居できないため採らない。代わりに次の 3 点で遵守失敗の余地を狭める。

- `allowed-tools` で対象スクリプトの Bash 実行だけを事前承認する。
- 非対話分岐を本文の冒頭に置き、`$ARGUMENTS` を明示参照する。
- 分岐後にモデルが行う作業を「事前承認済みの Bash を 1 回叩き、返った JSON を報告する」だけに切り詰める。

決定性が要る CI 向けには、`claude` を介さない node 直実行を README に併記する。

## 構成

```
plugins/agent-policy/
  package.json                     agent-policy-scripts / private / type: module
  build.ts                         esbuild(prefetch と同型)
  src/
    setup-agents.ts                生成スクリプト本体
    testing/run-ts.ts              tsx 経由実行ヘルパ(既存プラグインからの複製)
    __test__/setup-agents.test.ts  vitest
  scripts/
    setup-agents.mjs               バンドル出力(git 管理)
```

`pnpm-workspace.yaml` の `packages` に `plugins/agent-policy` を追記する(手動列挙のため、追記しなければ `pnpm build` の対象にならない)。`vitest.config.ts` と `tsconfig.json` は既に `plugins/*/src/**` を含むため追記不要。

GPT と Grok で 1 本のスクリプトに統合する。差分はプロファイル定義(テンプレート所在・既定エイリアス)のみで、読み取り・置換・書き込み・出力先解決はすべて共通のため、2 本に分けると同じロジックが二重化する。

### 配置の制約

`src/setup-agents.ts` と `scripts/setup-agents.mjs` は、それぞれ `src/` 直下・`scripts/` 直下に置く。プラグインルートを `dirname(import.meta.url)/..` で求めるため、ネストするとこの前提が崩れる(`plugins/chat-history/src/hooks/check-chat-recorded.ts` はネストした結果 `basename === "scripts" ? ".." : "../.."` の分岐を持つ)。本スクリプトはその分岐を持たせず、配置制約で解決する。

## CLI 契約

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --profile <gpt|grok> [options]
```

| オプション | 意味 |
| --- | --- |
| `--profile gpt\|grok` | 必須。生成するプロファイル |
| `--check` | 書き込まず現状のみ報告する |
| `--overwrite` | 既存ファイルを上書きする。無指定時は既存を `skipped` にする |
| `--agents <csv>` | 対象を絞る。既定は全件 |
| `--alias <name>=<alias>` | エイリアスを個別に上書きする。繰り返し指定可 |
| `--dir <path>` | 出力先ルートを明示する。既定は git root、git 管理外なら cwd |

### エージェント名

`--agents` と `--alias` の `<name>` は、テンプレートの frontmatter `name` の値をそのまま使う。プロファイルごとの有効値は次のとおり。

- gpt: `gpt-sol` / `gpt-terra` / `gpt-luna`
- grok: `grok-researcher` / `grok-implementer`

出力ファイル名も同じ値から決める(`<name>.md`)。スクリプト側にエージェント名の表を持たせず、テンプレートを読んで決定する。

### 既定エイリアス

| プロファイル | エージェント | 既定エイリアス |
| --- | --- | --- |
| gpt | gpt-sol | `claude-gpt-5-6-sol` |
| gpt | gpt-terra | `claude-gpt-5-6-terra` |
| gpt | gpt-luna | `claude-gpt-5-6-luna` |
| grok | grok-researcher | `claude-grok-4-5` |
| grok | grok-implementer | `claude-grok-4-5` |

### 置換

各テンプレートのプレースホルダは 4 行目 `model: {{MODEL_ALIAS}}` の 1 箇所のみ(5 本すべてで確認済み)。それ以外は逐語で出力する。

### 出力

stdout に JSON 1 行。既存 CLI(`list-antibodies` 等)の `ok` 契約に揃える。

```json
{
  "ok": true,
  "profile": "gpt",
  "outDir": "/abs/path/.claude/agents",
  "agents": [
    {
      "name": "gpt-sol",
      "alias": "claude-gpt-5-6-sol",
      "path": ".claude/agents/gpt-sol.md",
      "exists": true,
      "upToDate": false,
      "action": "written"
    }
  ]
}
```

- `action` は `written` / `skipped` / `checked` のいずれか。
- `upToDate` は「**書き込み前の**既存内容が、今回生成する内容とバイト単位で一致するか」。既存ファイルが無いときは `false`。`--check` でも書き込み時でも同じ意味で返す。
- これが「既存定義が現行テンプレートと食い違うか」の判定そのものであり、対話モードで LLM に既存ファイルを読ませずに済ませる。

失敗時は `{"ok": false, "error": "..."}` を stdout に出し、exit 1。

書き込みはエージェント単位で逐次行い、途中で失敗しても既に書いたファイルのロールバックはしない。どこまで書けたかは `agents[].action` で判別できる。

### パス解決

- **テンプレート** — `dirname(fileURLToPath(import.meta.url))/..` をプラグインルートとする。`CLAUDE_PLUGIN_ROOT` が設定されていればそちらを優先する。公式ドキュメントは同変数の export 先を hook / MCP / LSP サブプロセスと書いており、Bash 経由の node に必ず入る保証はないため、`import.meta.url` 側を本命の経路とする。
- **出力先** — `--dir` 未指定時は cwd から `git rev-parse --show-toplevel` を試み、成功すればその直下。git が未導入の場合や git 管理外の場合を含め、失敗したときは cwd 直下の `.claude/agents/`。無ければ作成する。

## SKILL.md の変更

両スキル共通。

### frontmatter

```yaml
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *)
```

本文に書く実行コマンドと同一パスにすることで、権限プロンプトを出さずに実行できる。CLI 側の `--allowedTools` 指定は不要になる。

`description` も更新する。「対話ヒアリングのうえ」という現在の記述は非対話モードと矛盾するため、非対話起動が可能である旨を含める。

### 非対話モードの節を追加(本文の冒頭)

`$ARGUMENTS` に `--yes` が含まれるとき、ステップ 1〜4 を実施せず、次だけを行う。

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --profile <gpt|grok> --overwrite` を 1 回実行する。
2. 返った JSON を報告して終了する。

次を明記する。

- `AskUserQuestion` を使ってはならない。
- エイリアスは既定値のみを使い、`--alias` は渡さない。
- `--check` は挟まない。

### ステップ 3 をスクリプト呼び出しへ置換

1. `--check` で現状を取得する。
2. 既存ファイルがあれば `AskUserQuestion` で上書き可否を確認する(ファイルごと / 一括の双方を選べる)。`upToDate: false` の既存には上書きを推奨すると添える。
3. 承認された対象だけを `--agents <csv> --overwrite` で書き込む。

テンプレートの読み込みと `{{MODEL_ALIAS}}` 置換の記述は SKILL.md から削除する(スクリプトの責務へ移るため)。

## 利用者向けドキュメント

`plugins/agent-policy/README.md` を新設する(利用者が読まなければ使えない情報のため)。

```bash
claude -p "/agent-policy:setup-gpt --yes"
claude -p "/agent-policy:setup-grok --yes"
```

併せて次を明記する。

- `--yes` を付けずに `-p` で起動すると対話パスに入り、応答待ちで止まる。
- CI など、終了コードで成否を判定したい場合は `claude` を介さず直接実行する。`claude -p` はスクリプトが失敗しても exit 0 を返しうる。

  ```bash
  node <plugin-root>/scripts/setup-agents.mjs --profile gpt --overwrite
  ```

- `--bare` は skills / plugins の自動発見をスキップする。公式ドキュメントは `--bare` を将来 `-p` の既定にすると予告しているため、その環境では `--plugin-dir` を明示するか、上の node 直実行を使う。

ルート `README.md` の agent-policy 節に headless 対応を追記する。併せて、プロファイル数が「2」のままになっている次の 2 箇所を実態(4 プロファイル)へ直す。

- `README.md` の一覧表(57 行目)
- `.claude-plugin/marketplace.json` の agent-policy の `description`(41 行目)

## テスト

`src/__test__/setup-agents.test.ts`。既存プラグインと同じく `runTs` で子プロセス実行し、exit code と stdout の JSON 契約を検証する。

- gpt / grok それぞれで全件が既定エイリアスで生成され、`model:` 行が置換されていること。
- テンプレート本文が逐語で一致すること(`model:` 行以外に差分がないこと)。
- 既存ファイルがあるとき、`--overwrite` 無しは `skipped`、有りは `written` になること。
- `--check` は書き込まないこと。既存が現行テンプレートと一致すれば `upToDate: true`、食い違えば `false` になること。
- `--agents` で対象が絞られること。
- `--alias` でエイリアスが上書きされること。
- 不正な `--profile`、不正な `--agents` の値は `ok: false` と exit 1 になること。
- `--dir` 配下に `.claude/agents/` が無ければ作成されること。

## 版数

- `plugins/agent-policy/.claude-plugin/plugin.json`: `0.5.0-dev` → `0.6.0-dev`(機能追加のためマイナー)。
- 新設する `plugins/agent-policy/package.json` の `version` も `0.6.0-dev` に揃える。

## 不採用案

| 案 | 不採用の理由 |
| --- | --- |
| SKILL.md に非対話節を追記するだけ | 変更は最小だが、テンプレートの逐語再現が LLM の Write 依存のままで、欠落が検知できない |
| 非対話専用スキルを分離し `disallowed-tools` / `` !`command` `` 注入を使う | 確認スキップが仕様レベルで保証されるが、スラッシュコマンド名が 2 つ増え、「setup-gpt を `claude -p` で」という依頼の形からずれる |
| 同一スキル内で `` !`command` `` を条件付き注入する | `$ARGUMENTS` をシェルコマンドへ埋め込む形になり、公開プラグインに注入経路を作る。置換順序も仕様に記載がない |
| `cp` + `sed` を SKILL.md に直書き | ビルド基盤は不要だが、「プラグインが実行するスクリプトは TypeScript で書く」に反し、Windows で `sed` が前提にできない |

## 残る既知の制約

- 非対話分岐は最終的に SKILL.md の記述に対するモデルの遵守に依存する。事前承認済み Bash を 1 回叩くだけに切り詰めてあるが、仕様レベルの保証ではない。決定性が要る用途では node 直実行を使う。
- `claude -p` の終了コードはスクリプトの成否を反映しない。同上。
