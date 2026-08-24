---
name: setup-grok
description: codex-grok-policy / with-grok-policy 運用方針で使う Grok エージェント定義を、役割を選んでプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「Grok エージェントをセットアップして」「setup-grok を実行して」等と明示的に依頼したとき、または SessionStart フックがエイリアス不一致を通知したときに必ず使用する。既存定義がある場合は差分を提示し、テンプレートに存在し得ない情報を残すかどうかを確認する。Grok 系モデルをローカルプロキシ経由で使える環境が前提。明示的な依頼があったときのみ使い、自律的には発動しない。
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *), AskUserQuestion
disallowed-tools: Write, Edit
---

# Grok エージェント セットアップウィザード

生成するのは Markdown の Agent 定義ファイルのみであり、プロキシや秘密値は一切管理しない。

`.claude/agents/` のファイルは `Write` / `Edit` で直接編集せず、必ず下記のスクリプトで書き込む。差分の確認も生成も、このスクリプトが行う。

## 非対話モード

`$ARGUMENTS` に `--yes` が含まれるときは、この節だけに従う。対話モードの手順は実施しない。

既定プリセットを既定エイリアスで生成する。次を 1 回実行する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --vendor grok --name grok --model claude-grok-4-6 --roles normal-impl,light-impl,general,explore,realtime-research,independent-review --write --merge
```

- `ok: true` のときは `target`、`action`、`kept` を報告して終了する。
- `discarded` が空でなければ、上書きした項目を列挙して報告する。
- `keptNeedsReview` が空でなければ列挙し、「旧版の同梱定義に含まれていた項目である。意図して足したものでなければ削除を検討する」と添えて報告する。
- `ok: false` のときは `error` をそのまま報告して終了する。

## 対話モードの手順

`$ARGUMENTS` に `--yes` が含まれないときは、以下を順に実施する。

### ステップ 1: 前提確認

ユーザーに次を確認する。検証コマンドは実行させず、確認方法の提示に留める。

- Claude Code を、Grok 系モデルを配信するプロキシ(例: CLIProxyAPI などの ProxyAPI サーバー)経由で起動しているか。
- そのプロキシの `/v1/models` 応答に、使用予定のモデルエイリアスが含まれているか。

前提が満たせない場合は「Grok 帯はフォールバック運用(独立レビュー省略・リアルタイム調査は Opus 代行)になります」と案内し、ユーザーが続行を求めない限り次へ進まず終了する。

### ステップ 2: 役割の選択

次を実行して、選べる役割の一覧を得る。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --list-roles
```

返った `roles` を `AskUserQuestion` の複数選択の選択肢にし、作る定義が担う役割を選ばせる。

- 選択肢は `roles` の配列順のまま並べる。
- 各選択肢のラベルは `id` にする。
- 各選択肢の説明は `label` にする。
- `source` が `project` のものには、プロジェクト固有の役割である旨を添える。
- 選択数の上限は設けない。
- 1 回のウィザードで作るのは 1 定義である。
- 複数の定義が要るときは、ユーザーに繰り返し実行するか尋ねる。

### ステップ 3: 読み取り専用性の確認

ステップ 2 で得た `kind` を見る。選ばれた役割に `readonly` と `impl` の両方が含まれるときは、次を伝えて続行するか確認する。既定は「続行しない」とする。

> 選んだ役割に読み取り専用の役割と実装役割が混在しています。生成される定義には Write / Edit が付くため、読み取り専用の担保は依頼文の制約に委ねられます。読み取り専用の定義が必要なら、読み取り役割だけを選んだ定義を別に作れます。

### ステップ 4: 名前のヒアリング

定義名を尋ねる。次を第一候補として提示し、自由に変更できるようにする。

- `grok`

### ステップ 5: モデルエイリアスのヒアリング

次の推奨を提示し、変更できるようにする。

- `claude-grok-4-6`

「これはモデル本体の ID ではなく、任意の ProxyAPI サーバーが配信するクライアント側の別名です。お使いのプロキシ設定に合わせて変更できます」と補足する。加えて次を必ず添える。

> 既定エイリアスは Grok 4.6 に合わせた `claude-grok-4-6` です。プロキシ設定にこの別名がまだ無い場合は、プロキシ側へ追加するか、4.5 を使い続けるなら `claude-grok-4-5` を指定してください。

### ステップ 6: 既存確認と差分提示

次で現状を取得する。`<roles>` は選んだ役割 ID のカンマ区切り。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --vendor grok --name <name> --model <alias> --roles <roles> --check
```

- `exists: false` なら確認を挟まずステップ 7 へ進む。
- `identical: true` なら「変更はありません」と報告して終了する。
- それ以外は差分を提示し、`AskUserQuestion` で方針を選ばせる。

差分の提示では次を区別して見せる。

**テンプレートに存在し得ない情報**(利用者が足したもの。既定では残す)
- `frontmatter.toolsOnlyInExisting` — 既存にしかない tools
- `frontmatter.keysOnlyInExisting` — 既存にしかない frontmatter キー
- `body.sectionsOnlyInExisting` — 既存にしかない節

**値が違うもの**(既定ではテンプレート側を採る。残したいなら個別に選ぶ)
- `frontmatter.changed` — 共通キーの値の違い
- `preambleChanged` — 冒頭宣言の書き換え
- `body.sectionsChanged` — 節の中身の違い

選択肢は次の 4 つとする。

1. **保持マージ(推奨)** — テンプレートに存在し得ない情報を残し、それ以外はテンプレート側で更新する
2. **項目を選んで保持** — 上に加えて、`changed` / `preambleChanged` / `sectionsChanged` のうち残すものを個別に選ぶ
3. **完全上書き** — 既存を捨ててテンプレートどおりに書く
4. **スキップ** — 書き込まない

差分の提示には次を必ず添える。

> 節の中身の一部改変は節単位でしか検出できません。既存の節へ 1 行足しただけの変更は、その節の保持を選ばない限り消えます。見出しに属さないテキストの追記と本文中の HTML コメントも検出できません。

`--check` の `roles.mixedKinds` が `true` で、ステップ 3 の確認を経ていないときは、書き込む前にステップ 3 へ戻る。

### ステップ 7: 生成

選んだ方針に応じて、次のコマンド指定を使う。

| 選択 | コマンド |
| --- | --- |
| 保持マージ(推奨) | `--write --merge` |
| 項目を選んで保持 | `--write --merge` に、残す項目ごとの `--keep key:<name>` / `--keep section:<heading>` / `--keep preamble` を足す |
| 完全上書き | `--write` |
| スキップ | 実行しない |

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" --vendor grok --name <name> --model <alias> --roles <roles> --write [--merge] [--keep ...]
```

- `action` と `kept` を報告する。
- `discarded` が空でなければ、「テンプレート側で上書きした項目」として列挙して報告する。
- `keptNeedsReview` が空でなければ列挙し、「旧版の同梱定義に含まれていた項目である。意図して足したものでなければ削除を検討する」と添えて報告する。

### ステップ 8: 後処理案内

- 生成したファイルのパスを報告する。
- `.claude/agents/` を git 追跡対象にするか gitignore するかはプロジェクト判断であることを案内する。
- Claude Code は `.claude/agents/` の変更を読み直す。ディレクトリを新しく作った初回だけ再起動が要ることを添える。
- 読み取り専用の作業(独立レビュー・探索実働)を tools レベルで担保したい場合は、読み取り役割だけを選んだ定義を別に作れることを案内する。
- CLAUDE.md への追記文例を提示する。自動では書き込まない。
  > - GPT 定義があれば最初に必ず `agent-policy:codex-grok-policy` スキルを使用し、無ければ `agent-policy:with-grok-policy` スキルを使用して、この規律に従う。
- GPT も併用するなら `agent-policy:setup-gpt` の実行を案内し、その場合の方針名は `agent-policy:codex-grok-policy` になることを添える。
