# agent-policy setup 統合 設計書

作成日: 2026-08-25
対象プラグイン: `plugins/agent-policy`
現行バージョン: `0.9.0-dev` → `0.10.0-dev`
改訂: Haiku レビューと Grok 独立レビューの指摘を反映(2026-08-25)

## 1. 背景と目的

### 1.1 出発点

当初の依頼は「Claude モデル用の setup スキルが無く、役割に応じたカスタムエージェントを定義できない」という欠落の解消であった。調査の結果、次の 2 点が判明した。

第一に、CLI 基盤は既に Claude に対応していた。`src/setup-agents.ts` の `--vendor` は `gpt | grok | claude` を受理し、`src/agents/fragments.ts` の `Vendor` 型にも `claude` があり、`src/agents/compose.ts` の `COLORS` には `claude: "blue"` が定義されている。欠けているのは指示層(スキル)だけであった。

第二に、欠落は Claude オンリー構成に限った話ではなかった。4 つの運用方針すべてにおいて、`doc-review`(Haiku)・`code-review`(Sonnet)・`advisor`(Fable / Opus)の 3 帯は Claude モデルが担当する。Claude 用の setup が無いということは、どのプロファイルを使っていてもこの 3 帯の定義を作れないということであった。

### 1.2 要件

聞き取りの過程で、依頼は次のように拡張された。

1. `setup-gpt` / `setup-grok` を廃止し、単一の `setup-agents` スキルへ統合する
2. ポリシー・モデル・役割を選択して、複数のエージェント定義を一度に生成する
3. 選択したポリシーにおいて選択したモデルが担当表上持ち得ない役割は、選択肢に出さない
4. 役割名の表示をユーザーの使用言語に合わせる
5. 生成されるエージェント定義の本文もユーザーの使用言語に合わせる
6. MCP が有効になっていることを検出したとき、許可する tools に MCP ツールを入れる

加えて、`LSP` ツールを役割定義から除去する判断が確定した(§4.3)。

### 1.3 目的

上記 6 要件を満たす `setup-agents` スキルと、それを支える実装層を構築する。担当表を実装層の正本に置くことで、要件 3 の制約を指示ではなくコードで担保する。

## 2. 現状の構造

### 2.1 レイヤー

| 層 | ファイル | 役割 |
| --- | --- | --- |
| 指示 | `skills/setup-gpt/SKILL.md`、`skills/setup-grok/SKILL.md` | 生成ウィザードの手順 |
| 指示 | `skills/{claude-model,with-codex,with-grok,codex-grok}-policy/SKILL.md` | 4 つの運用方針。担当表を散文の表として持つ |
| 参照 | `assets/roles/*.md` | 役割断片 11 件(`_common.md` + 役割 10 件)+ ベンダー別 1 件(`realtime-research.grok.md`) |
| 実装 | `src/agents/roles.ts` | 役割 ID 10 種、tools 導出、`PRESET_ASSIGNMENTS` |
| 実装 | `src/agents/presets.ts` | 同梱プリセット 4 種の手書き定義 |
| 実装 | `src/agents/fragments.ts` | 断片の読み込みと合成 |
| 実装 | `src/agents/compose.ts` | 定義ファイルの組み立て |
| 実装 | `src/setup-agents.ts` | CLI 本体 |
| 実装 | `src/hooks/session-start.ts` | 方針注入と役割マーカー走査 |

### 2.2 担当表の逆引き

4 つの方針スキルが持つ担当表を、モデルから役割への逆引きに整理すると次のようになる。この表が本設計の中心的な入力である。

| モデル | claude-model-policy | with-codex-policy | with-grok-policy | codex-grok-policy |
| --- | --- | --- | --- | --- |
| Opus | complex-impl, advisor | advisor | complex-impl, advisor | advisor |
| Sonnet | normal-impl, general, explore, realtime-research, independent-review, code-review | code-review | code-review | code-review |
| Haiku | light-impl, doc-review | doc-review | doc-review | doc-review |
| Fable | advisor | advisor | advisor | advisor |
| GPT Sol | — | complex-impl | — | complex-impl |
| GPT Terra | — | normal-impl, general, explore, realtime-research, independent-review | — | normal-impl, general |
| GPT Luna | — | light-impl | — | light-impl |
| Grok | — | — | normal-impl, light-impl, general, explore, realtime-research, independent-review | explore, realtime-research, independent-review |

### 2.3 担当表のうち RoleId を持たない帯

方針スキルの担当表には、上記 10 種の `RoleId` に対応しない行が 3 つある。

- 調査・分析
- 設計書・実装計画書(WBS)の作成
- コードベース探索統括

これらはオーケストレーター自身が担う帯であり、サブエージェント定義の対象ではない。本設計の `ASSIGNMENTS` はサブエージェント定義の生成を目的とするため、この 3 帯を含めない。網羅性テスト(§9.1)が検証するのは `RoleId` 10 種であって、担当表の全行ではない。

### 2.4 現状の問題

**問題 1: 担当表が実装層に存在しない。** 担当表は 4 本の SKILL.md に散文の表として書かれているだけである。実装層には `PRESET_ASSIGNMENTS`(役割 → プリセット名)があるが、これは GPT / Grok の帯しか持たない。`claude-model-policy` のエントリは空オブジェクトであり、コメントに「Claude 帯(model 上書きで済む帯)は載せない」と明記されている。要件 3 の制約を実装するには、Claude 帯を含む完全な担当表が要る。

**問題 2: 同梱プリセットと担当表がずれている。** `PRESETS` の `gpt-terra` は `explore` / `realtime-research` / `independent-review` を持つが、codex-grok-policy ではその 3 帯は Grok が担当する。既存テスト `presets.test.ts` の「担当表との一致」は「割り当てた役割をプリセットが持つか」という包含チェックであり、過剰申告を検出しない。`PRESETS` と `PRESET_ASSIGNMENTS` という 2 つの手書きデータがあるかぎり、この種のずれは再発する。

**問題 3: 役割断片が日本語のみである。** `assets/roles/*.md` は 11 件すべて日本語で書かれている。さらに、断片を日本語から差し替えるだけでは不十分である。`compose.ts` 自体が日本語を前提としている(§6.2 で詳述)。

**問題 4: setup スキルが 2 本に分かれている。** `setup-gpt` と `setup-grok` はほぼ同一の手順を持ち、ベンダー固有の記述だけが違う。Claude を足すと 3 本になり、重複がさらに増える。

## 3. 全体像

```
                      ┌──────────────────────────┐
                      │ src/agents/policies.ts   │  担当表の正本(新規)
                      │  ASSIGNMENTS             │
                      │  modelsFor / rolesFor    │
                      └────────┬─────────────────┘
                               │ 導出
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
      ┌───────────────┐ ┌─────────────┐ ┌──────────────┐
      │ presets.ts    │ │ CLI 検証     │ │ 選択肢の生成  │
      │ (同梱プリセット)│ │ (要件 3 の実体)│ │ (ウィザード)  │
      └───────────────┘ └─────────────┘ └──────────────┘

  断片の探索順(後勝ち)
    1. assets/roles/<lang>/                 プラグイン同梱(ja / en)
    2. .claude/agent-policy/roles/<lang>/   翻訳断片(その他言語)
    3. .claude/agent-policy/roles/          プロジェクト独自(最優先)

  MCP の付与(プラグイン既定は「付けない」。利用者が検出結果から選ぶ)
    claude mcp list → Connected / cached のサーバーだけを選択肢に出す
      → allowlist はサーバー単位 mcp__<server>(名前の実在が保証される)
      → denylist はツール単位(Claude が列挙。誤っても無害)
    前回の選択は既存定義から逆算する(専用の設定ファイルは持たない)

  ファイル書き込みの主体
    エージェント定義        → CLI のみ(スキルは Write をツールレベルで禁止)
    翻訳断片のひな形作成    → CLI(--scaffold-fragments)
    翻訳断片の中身         → スキルが Edit(**/.claude/agent-policy/roles/**) で置換
```

## 4. データモデル

### 4.1 新規ファイル `src/agents/policies.ts`

```ts
export type ModelId =
  | "opus" | "sonnet" | "haiku" | "fable"
  | "gpt-sol" | "gpt-terra" | "gpt-luna" | "grok"

export type Lang = "ja" | "en" | string

export interface ModelSpec {
  id: ModelId
  vendor: Vendor          // claude | gpt | grok
  label: string           // 担当表の表記。"Opus" / "GPT Sol"
  defaultName: string     // 既定の定義名。"claude-opus" / "gpt-sol"
  model: string           // frontmatter に書く値。"opus" / "claude-gpt-5-6-sol"
  aliasEnv?: string       // AMATSUKA_AGENT_GPT_SOL_ALIAS。Claude 帯は持たない
  color: string           // 定義の frontmatter に出力する色
}

// 担当表: ポリシー → 役割 → 担当モデル
export const ASSIGNMENTS: Record<PolicyName, Record<RoleId, ModelId[]>>

export function modelsFor(policy: PolicyName): ModelSpec[]
export function rolesFor(policy: PolicyName, model: ModelId): RoleId[]
```

### 4.2 設計上の判断

**担当モデルを配列にする。** `advisor` の担当は担当表上 `Fable / Opus` と並記されており、4 つの方針すべてで同じである。単一値の `Record<RoleId, ModelId>` にすると Fable がどの役割も担えないモデルとなり、選択肢から消えてしまう。値を配列にすることで、`rolesFor("claude-model-policy", "opus")` が `["complex-impl", "advisor"]` を、`rolesFor("claude-model-policy", "fable")` が `["advisor"]` を返せるようになる。他の 9 帯は要素 1 の配列となる。

**Claude 帯の `model` はエイリアスを使う。** Claude Code の subagent frontmatter は `sonnet` / `opus` / `haiku` / `fable` のエイリアス、フルモデル ID、`inherit` を受け付ける(公式ドキュメントで確認済み)。エイリアスを採ることで、モデル世代が上がっても定義ファイルを書き換えずに追随できる。GPT / Grok は現行どおりプロキシエイリアスを使い、環境変数による上書きも維持する。

ただし `CLAUDE_CODE_SUBAGENT_MODEL` が設定されている環境では、公式の解決順(環境変数 → 起動時の model 引数 → frontmatter → 親モデル)により frontmatter の指定ごと無効化される。GPT / Grok のプロキシエイリアスと違い Claude 本体に載る帯であるため影響が大きい。README の環境変数節でこの点に触れる。

**`aliasEnv` を optional にする。** Claude 帯にはプロキシエイリアスの概念が無い。`session-start.ts` のエイリアス不一致検出も、このフィールドの有無でそのまま分岐できる。

**`color` を `ModelSpec` に持たせる。** 現行の CLI 生成物は `composeInput` に `color` を渡しておらず、`compose.ts` の `COLORS[vendor]` にフォールバックしている。Claude 帯を setup で作ると 4 定義すべてが `blue` となり、タスクリスト上で区別できない。`ModelSpec.color` にモデルごとの値を持たせ、CLI が `composeInput` へ渡す。

公式が受け付ける色は `red` / `blue` / `green` / `yellow` / `purple` / `orange` / `pink` / `cyan` の 8 種である。ちょうど 8 モデルなので、重複させずに割り当てる。

| モデル | color |
| --- | --- |
| Opus | blue |
| Sonnet | purple |
| Haiku | pink |
| Fable | orange |
| GPT Sol | yellow |
| GPT Terra | green |
| GPT Luna | cyan |
| Grok | red |

GPT / Grok は現行の `PRESETS` の値をそのまま引き継ぐ。Claude 帯は残る 4 色を割り当てる。`magenta` は公式の一覧に無いため使わない。

**`PRESET_ASSIGNMENTS` を廃止する。** `ASSIGNMENTS` から導出できる同型物であるため、`policies.ts` に吸収する。

### 4.3 `LSP` の除去

`src/agents/roles.ts` の `tools` から `LSP` を除去する。対象は `complex-impl` / `normal-impl` / `light-impl` / `general` の 4 役割である(読み取り役割は元から持っていない)。`assets/roles/` 配下の各断片の frontmatter `tools` からも除去する。

除去の根拠は、背景で起動するサブエージェントが built-in ツールを限定セットへ削る仕様にある。公式ドキュメントは次のように述べている。

> Apart from `Agent` and `ExitPlanMode`, which follow the first filter's conditions wherever the subagent runs, a background subagent keeps every MCP tool but only these built-in tools: `Read`, `Grep`, `Glob`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `TaskStop`, `SendMessage`, and `Artifact`. Claude Code removes every other built-in tool from a background subagent, whether inherited or listed in the `tools` field, so the same definition can resolve to different tools in the foreground and the background. The removal reports no error unless it leaves the `tools` list resolving to nothing.

`LSP` は保持リストに無いため、catch-all 節によって除去される。agent-policy が起動するエージェントは並列実行が前提であり、最新の Claude Code では並列がほぼ背景実行と同義になるため、`LSP` は実質的に機能しない。しかも除去はエラーを報告しないため、定義ファイルは正しいまま能力だけが黙って減る。

現行 `roles.ts` が使用する 11 種のツールのうち、背景で落ちるのは `LSP` だけである。`Read` / `Grep` / `Glob` / `Write` / `Edit` / `Bash` / `Skill` / `WebSearch` / `WebFetch` はすべて保持リストに含まれる。`Agent` は第 2 フィルタから明示的に除外されており、深さ制限(既定 3 層)にのみ従うため背景でも保持される。したがってアドバイザー相談の仕組みは並列委譲下でも機能する。

**副作用を承知のうえで除去する。** 定義から `LSP` を外すと、前景実行・fork・`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` の環境でも `LSP` が使えなくなる。これらの経路では本来 `LSP` が生きているため、「背景で死んでいる機能の掃除」ではなく前景パスの能力削除にあたる。並列委譲を前提とする本プラグインの運用では、前景で動く場面が限られるため許容する。`LSP` が担っていた言語理解による探索は、背景でも保持される MCP(Serena のシンボルツール)が代替する(§7)。

## 5. CLI インターフェース

### 5.1 サブコマンド

| サブコマンド | 返すもの |
| --- | --- |
| `--list-policies` | 4 ポリシーの `id` / `label` |
| `--list-models --policy <p>` | そのポリシーに登場するモデル。各要素に `id` / `label` / `defaultName` / `model`(環境変数を解決済み)/ `vendor` / `color` / `roles` |
| `--list-roles --policy <p> --model-id <m> --lang <l>` | 絞り込み済みの役割。各要素に `id` / `label` / `kind` / `tools` / `source` |
| `--list-mcp` | `claude mcp list` から抽出したサーバー。各要素に `name` / `status` / `usable` |
| `--check-fragments --lang <l>` | 翻訳断片の状態(応答構造は §5.4) |
| `--scaffold-fragments --lang <l>` | 英語断片のコピーを翻訳先へ作成し、作成したパスを返す |
| `--check --policy <p> --lang <l> --models <m1,m2,...>` | 複数モデルの差分を一括取得。各要素に `mcpCurrent` を含む |
| `--check --policy <p> --lang <l> --model-id <m> --name <n> --roles <r1,r2>` | 単一定義の差分 |
| `--write ...` | `--check` と同じ引数で書き込み。`--mcp-servers` / `--mcp-deny` で MCP を渡す |

`--merge` は `--models` による一括でも使える。一括時は各ファイルへ自動 keep(テンプレートに存在し得ない情報の保持)だけを適用する。`--keep` による項目の明示指定は、対象ファイルが 1 つに定まる単一定義指定時のみ受け付ける。

### 5.2 廃止と追加

**`--vendor` を廃止する。** vendor は `ModelSpec` から導出できるため冗長である。残すと「vendor と model-id が矛盾したときどちらを採るか」という無意味な分岐を抱え続けることになる。統合によってスキル側も総取り替えになるため、呼び出し側との同時更新が効き、後方互換のための二重受理は不要である。

**`--model-id` と `--model` を分ける。** `--model-id` は担当表上のモデル識別子(`ModelId`)、`--model` は frontmatter に出力される実際の文字列である。`--model` を省略した場合は「環境変数 → `ModelSpec.model` の既定」の順で解決する。`--list-models` が返す `model` は解決後の値であり、環境変数を後から変更した場合は次回の CLI 実行時に再解決される。

**一括系を追加する。** `--check --models m1,m2,m3` は複数モデルの差分をまとめて返す。これは対話フローのステップ 5(§6.1)が依存する機能である。応答は単一指定でも要素 1 の配列を返し、スキル側の結果処理を 1 本化する。

**`--scaffold-fragments` を追加する。** 翻訳断片のひな形を CLI が作る(§6.5)。

### 5.3 検証

CLI は次の 4 つの不整合を `ok: false` で拒否する。これが要件 3「担当表上持ち得ない役割は選択できない」の実体である。指示ではなくコードで担保するため、AI が手順を逸脱しても不正な定義は書かれない。

1. `--policy` が未知である
2. `--model-id` がそのポリシーの担当表に登場しない
3. `--roles` に、`rolesFor(policy, modelId)` の範囲外かつ**組み込み役割**であるものが含まれる。不正な役割 ID を列挙して返す
4. `--lang` が `ja` / `en` 以外で、翻訳断片が欠けている。`missingFragments` を添えて返す

検証 4 は `--check` と `--write` の両方で行う。`checkFragments`(§5.4)を呼び、`missing` または `stale` が空でなければ拒否する。これを CLI 側に置かないと、スキルがステップ 2 を飛ばした場合や利用者が直接 CLI を叩いた場合に、英語見出しの定義が翻訳言語の指定のまま書かれる。§10.4 で「その他言語を英語へフォールバックする」を不採用としている以上、フォールバックさせずに止める。

**検証 3 はプロジェクト独自役割を免除する。** 現行の CLI はプロジェクト側断片(`.claude/agent-policy/roles/<独自 id>.md`)が宣言する任意の役割 ID を受け付けており、`compose.test.ts` の `triage` がその契約を固定している。独自役割は担当表に存在しないため、素朴に `rolesFor` の範囲外を拒否すると既存利用者が setup を実行できなくなる。したがって検証対象は `ROLES` に含まれる組み込み役割に限り、`loadFragments` の結果で `source: "project"` となる役割は通す。`--list-roles` も同様に、組み込み役割は `rolesFor` で絞り、独自役割は常に選択肢へ含める。

### 5.4 `--check-fragments` の応答構造

```json
{
  "ok": true,
  "lang": "de",
  "sourceDir": "<plugin>/assets/roles/en",
  "targetDir": ".claude/agent-policy/roles/de",
  "missing": ["complex-impl", "_common"],
  "stale": [{ "id": "explore", "expected": "<hash>", "actual": "<hash>" }],
  "ready": ["normal-impl", "light-impl"]
}
```

`missing` は翻訳先にファイルが無い役割、`stale` は `source-hash` が同梱英語断片と一致しない役割、`ready` は最新である役割を指す。`lang` が `ja` / `en` のときは `missing` と `stale` が常に空になり、`targetDir` は `null` を返す。

## 6. スキルの対話フローと表示言語

### 6.1 対話の流れ

スキル名は `setup-agents` とし、`setup-gpt` / `setup-grok` を置き換える。

**選択肢の個数に関する共通規則。** `AskUserQuestion` は 1 回の質問につき選択肢を **2〜4 個**しか受け付けない。上限だけでなく下限もあるため、次の規則を全ステップへ適用する。

- 候補が 0 件 — 質問せず、その旨を報告して次へ進む
- 候補が 1 件 — `AskUserQuestion` を使わず、「これを使うか」を通常の確認文で尋ねる
- 候補が 2〜4 件 — そのまま 1 回の質問にする
- 候補が 5 件以上 — 4 個ずつに分割し、複数回に分けて尋ねる。分割の基準は候補の並び順とし、各質問に「(1/2)」のような通し番号を添える

この規則が効くのはステップ 4(モデル選択。`with-codex` は最大 7 件)、ステップ 5b(役割選択。`claude-model-policy` の Sonnet は 6 件)、ステップ 5c(MCP のサーバー選択。件数の上限なし)である。

**ステップ 0: 言語判定。** 会話でユーザーが使用している言語から `lang` を決める。以降のすべてのコマンドに渡す。CLI 側に判定ロジックは持たない。会話が複数言語にまたがる場合は、直近のユーザー発話の言語を採り、判定結果をステップ 1 の冒頭でユーザーへ明示して変更の機会を与える。

**ステップ 1: ポリシー選択。** `--list-policies` の結果を単一選択で提示する。`AMATSUKA_AGENT_AUTO_INJECTION` が設定済みであれば、対応するポリシーを第一候補に置く。

**ステップ 2: 翻訳断片の準備。** `lang` が `ja` / `en` 以外のときのみ実施する。

1. `--check-fragments --lang <l>` を実行する
2. `missing` または `stale` があれば `--scaffold-fragments --lang <l>` を実行し、英語断片のコピーを翻訳先に作らせる
3. 作られた各ファイルを `Edit` で開き、本文と frontmatter の `label` / `description` を翻訳に置き換える。`id` / `kind` / `tools` / `source-lang` / `source-hash` は変更しない
4. `--check-fragments --lang <l>` を再実行し、`missing` と `stale` が空になったことを確認する

**ステップ 3: 前提確認。** GPT または Grok を含むポリシーのときのみ実施する。プロキシ経由での起動と、モデルエイリアスが `/v1/models` に含まれることを確認する。

**満たせない場合も終了しない。** 該当ベンダーのモデルをステップ 4 の選択肢から除外したうえで続行する。そのポリシーにおける Claude 帯(`doc-review` / `code-review` / `advisor` など)の定義は、プロキシの状態と無関係に生成できるためである。現行の `setup-gpt` はプロキシ不可で終了するが、その挙動を統合後に持ち込むと、プロキシ障害時に Claude 帯の定義も作れなくなり、本設計が解消しようとした欠落が再発する。除外した旨と、方針スキル側のフォールバック規定(`with-grok-policy` の「Grok が利用不可のときのフォールバック」など)を報告に含める。

**ステップ 4: モデル選択(複数)。** `--list-models --policy <p>` の結果を複数選択で提示する。既定は全モデル選択とする。各選択肢の説明にそのモデルが担える役割を出す。件数が 2〜4 に収まらないときは、冒頭の共通規則に従って分割または確認文へ切り替える。ベンダーで分割すると 1 件だけのグループができる方針(`with-grok-policy` の Grok など)は採らない。

**ステップ 5: 一括確認。** `--check --policy <p> --lang <l> --models <選んだモデル>` を 1 回実行し、モデルごとに「既定名 / `model` 値 / 役割 / 既存の状態」を一覧提示する。ここで 3 択を提示する。

1. このまま全部作る(推奨)
2. 一部を調整する。調整対象のモデルを選ばせ、そのモデルだけステップ 5b へ進む
3. 中止する

**ステップ 5b: 個別調整。** 選ばれたモデルについてのみ実施する。役割の絞り込み(`--list-roles` の結果から複数選択)、定義名、`model` 値、`kind` 混在時の警告、差分方針(保持マージ / 項目を選んで保持 / 完全上書き / スキップ)を順に決める。

**ステップ 5c: MCP の付与。** `--list-mcp` を実行し、`usable: true` のサーバーを提示する。検出が 0 件、または `--list-mcp` 自体が失敗した場合は何も聞かずに次へ進む。手順は §7.4 に従い、前回の選択の読み戻し(`--check` の `mcpCurrent`)、サーバー選択、付与先の役割、読み取り役割へ付ける場合の `disallowedTools` 確認、の順で決める。決定内容は保存せず、ステップ 6 の `--write` へ `--mcp-servers` と `--mcp-deny` で渡す。

**ステップ 6: 生成。** 既定どおりのモデルは `--write --models ... --merge` で一括生成する。調整したモデルは個別に `--write --model-id ... --keep ...` を実行する。

**ステップ 7: 報告。** 生成パス一覧、`action` / `kept` / `discarded` / `keptNeedsReview`、MCP の付与結果と再検証で落としたサーバー、選んだポリシーに対応する CLAUDE.md への追記文例、`.claude/agents/` の git 追跡がプロジェクト判断である旨、ディレクトリを新規作成した初回のみ再起動が要る旨を報告する。

**非対話モード。** `$ARGUMENTS` に `--yes` が含まれる場合、ポリシーの全モデル・全役割を既定名で一括生成する。ポリシーは `--policy` 指定 → `AMATSUKA_AGENT_AUTO_INJECTION` の順で解決し、**どちらでも決まらない場合は質問せずエラーで終了する**。非対話を宣言しながら対話へ落ちる挙動を避けるためである。`lang` が `ja` / `en` 以外で翻訳断片が未整備の場合も、翻訳には対話が要るためエラーで終了し、対話モードでの実行を案内する。

ステップ 3 を条件付きにできるのは、ポリシーを最初に聞く順序の副産物である。現行の `setup-gpt` は必ずプロキシ前提確認から入るが、統合後は Claude オンリーのポリシーを選んだ時点でその質問が消える。

### 6.2 言語対応の範囲

**断片を差し替えるだけでは要件 5 を満たさない。** `compose.ts` は日本語を前提とした箇所を 4 つ持つ。

1. `BODY_ORDER` に `## When to invoke` / `## Core Responsibilities` / `## 作業手順` がハードコードされている(`compose.ts:37-41`)。英語断片が `## Procedure` という見出しを使うと、その節は合成結果から落ちる
2. `describe()` が `` `Use this agent when ${list}を委譲するとき。詳細は本文の「When to invoke」を参照。` `` という日英混在の文を組む(`compose.ts:147-149`)。役割の連結にも読点(`、`)を使う
3. `## アドバイザーへの相談` / `## Agent tool の制約` / `## 制約` / `## Output Format` の見出しが日本語のまま `compose` 側に書かれている
4. `preamble()` が役割名を `` `「${fragment.label}」` `` と鉤括弧で包み、読点で連結する(`compose.ts:152-160`)。英語の `label` を渡しても `「Complex or critical implementation」` となり、日本語の約物が残る

4 点目は見落としやすい。英語合成の検証を「日本語文字を含まない」という正規表現で行うと、読点(U+3001)がこれに当たるため、語彙化しないとテストが落ちる。鉤括弧(U+300C / U+300D)は文字種の判定を通り抜けるため、テストだけでは検出できない。

したがって `compose.ts` に言語別の語彙を持たせる。見出しと description テンプレートに加えて、役割名の装飾と連結子も語彙に含める。

```ts
interface Vocabulary {
  bodyOrder: string[]           // 節の並び順に使う見出し
  advisorHeading: string
  agentConstraintHeading: string
  constraintHeading: string
  outputFormatHeading: string
  listSeparator: string         // 役割名の連結子。ja は "、"、en は ", "
  quote: (value: string) => string  // 役割名の装飾。ja は「」、en は二重引用符
  describe: (roles: string) => string
}

const VOCABULARIES: Record<"ja" | "en", Vocabulary>
```

`ja` / `en` 以外の言語は `en` の語彙を使う。翻訳断片の見出しも英語のままとし、翻訳するのは本文と `label` / `description` に限る。これは合成器が見出しで節を突き合わせる構造上の制約であり、ステップ 2 の手順(§6.1)にも明記する。見出しまで翻訳可能にするには語彙を翻訳断片側から読む必要があり、`_common.md` の節構成とも連動するため、本設計では採らない。

### 6.3 断片の探索順

後勝ちの 3 段構成とする。

1. 同梱 `assets/roles/<lang>/` — `lang` が `ja` / `en` のとき。それ以外は `assets/roles/en/`
2. プロジェクト翻訳 `.claude/agent-policy/roles/<lang>/` — スキルが英語から翻訳して書き込む
3. プロジェクト独自 `.claude/agent-policy/roles/` — 現行の置き場所。ユーザーが意図して置いた断片が最優先

優先順位をこの順にする理由は、翻訳が同梱断片の言語違いの写しであるのに対し、独自断片はユーザーの意図的な上書きであるためである。同じ「プロジェクト側」でも性質が異なるものを 1 つのディレクトリに混在させると、独自断片が翻訳で潰される事故が起きる。

ただしこの順序により、`lang` が `en` や翻訳言語であっても第 3 段の日本語独自断片が優先される。役割ごとに言語が混ざった定義が生成されうるため、`--list-roles` の応答で `source: "project"` かつ第 3 段由来のものには言語不一致の可能性を示すフラグを添え、ステップ 5 の一覧に表示する。

**既存断片の移動。** `assets/roles/` 直下の 11 件(`_common.md` + 役割 10 件)を `assets/roles/ja/` へ移す。ベンダー別断片 `realtime-research.grok.md` も同様に `assets/roles/ja/` へ置き、英語版 `assets/roles/en/realtime-research.grok.md` を新規に作る。

**ベンダー別断片も後勝ちの置換にする。** 現行の `loadFragments` はベンダー別断片を全ディレクトリから走査し、見つかるたびに対象へ**追記**する(`fragments.ts:126-139`)。探索対象が 1 ディレクトリだった頃はこれで正しかったが、3 段になると同じ節が複数回積まれる。`lang` が `de` のとき探索順は `[assets/roles/en, roles/de, roles/]` であり、`--scaffold-fragments` は `realtime-research.grok.md` も翻訳先へコピーするため、英語の追記と訳文の追記が両方乗る。

したがってベンダー別断片も、通常の断片と同じく後勝ちで置き換える。ある役割 ID に対するベンダー別断片は、探索順で最後に見つかったものだけを追記に使う。

移動に伴い、`assets/roles` を直接指しているコードとテストを追随させる。少なくとも `build-presets.ts:9`、`setup-agents.ts:fragmentDirs`、`presets.test.ts` / `compose.test.ts` の `PLUGIN_ROLES` 定数が対象である。

**`loadFragments` のシグネチャ変更。** 現行は `dirs: string[]` を受け、`index === 0` を plugin、それ以外を project と決め打ちしている。3 段になるとこの判定が壊れるため、`dirs: { path: string; source: "plugin" | "project" }[]` へ変える。`--list-roles` の応答に載る `source` は、ウィザードが「プロジェクト固有の役割である旨を添える」判断に使うため、意味を保ったまま拡張する。

**英語断片は書き下ろしとする。** 機械翻訳ではなく書き下ろすのは、これらが Agent のシステムプロンプト本体であり、日本語の規律文(「〜せず、差し戻す」等)を直訳すると指示として弱くなるためである。

### 6.4 翻訳断片の陳腐化検知

翻訳断片の frontmatter に 2 つのキーを持たせる。

```yaml
source-lang: en
source-hash: <翻訳元になった同梱断片のハッシュ>
```

**ハッシュの計算対象は、同梱英語断片の frontmatter を除いた本文とする。** frontmatter を含めると、`label` / `description` が翻訳で書き換わることと区別できない。また翻訳ファイル自身の `source-hash` 行を計算に含めると更新のたびに必ず不一致になるため、対象は常に翻訳元(同梱英語断片)の側である。`_common.md` とベンダー別断片も同じ規則でハッシュを持ち、検証対象に含める。

CLI は同梱断片の現在のハッシュと突き合わせ、ずれていれば `stale` として応答に含める。スキルはそれを見て再翻訳を促す。`source-hash` を持たない断片(第 3 段のプロジェクト独自断片)は検証対象外とするため、既存の利用は壊れない。

プラグイン更新で英語断片が 1 行変わっただけでも stale となり、翻訳のやり直しが頻発しうる。それでも、古い指示が黙って使われ続けるより検知できる方がよいと判断した。

### 6.5 ファイル書き込みの権限設計

**`Write` はツールレベルで禁止し、`Edit` をパスで限定する。**

```yaml
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-agents.mjs" *), Edit(**/.claude/agent-policy/roles/**), AskUserQuestion
disallowed-tools: Write
```

この形にする根拠は公式ドキュメントの次の記述にある。

> Claude Code checks file permissions against `Edit(path)` and `Read(path)` rules only. If you write a path rule for `Write`, `NotebookEdit`, `Glob`, or the legacy `MultiEdit` tool instead, Claude Code accepts the rule but never consults it, and warns at startup... Use `Edit(docs/**)` in place of `Write(docs/**)`... Claude Code doesn't warn about a tool-name rule with no path, such as a deny rule for `Write`; it matches that rule at the tool level everywhere.

`Write(path)` は照合されないため、`allowed-tools` に `Write` を足すと `.claude/agents/*.md` への書き込みまで事前承認される。`allowed-tools` は制限ではなく事前承認であり、パスで縛れない以上、エージェント定義を CLI に閉じるという既存の契約が権限レベルで崩れる。一方 `Edit(path)` は照合されるため、書き込み先を `.claude/agent-policy/roles/` 配下へ限定できる。

パスは `Edit(**/.claude/agent-policy/roles/**)` とする。公式の権限ドキュメントはアンカーの起点をルールの出どころごとに定めている(プロジェクト settings はプロジェクトルート、local settings と CLI 由来は起動時の cwd)が、**スキルの `allowed-tools` がどちらに従うかは表に載っていない**。`/` 始まりでプロジェクトルートを意味すると決め打つと、サブディレクトリから起動した場合に外れる可能性がある。`**/` 始まりならどの深さでも一致するため、アンカーの不確実性を回避できる。

**`Edit` は既存ファイルしか編集できないため、ひな形の作成を CLI が担う。** `--scaffold-fragments --lang <l>` が同梱英語断片を翻訳先へコピーし、`source-lang` と `source-hash` を書き込んだ状態で置く。スキルはその中身を `Edit` で翻訳に置き換える。ファイルを新規作成する主体が常に CLI であるという現行の契約が保たれる。

この設計では `.claude/agents/` に対して `Write` も `Edit` も届かない。翻訳断片の内容が不正であれば `source-hash` 検証が働くため、権限とは別の検証も二重の歯止めとして残る。

### 6.6 表示言語の規則

| `lang` | 選択肢に出す役割名 | 生成される定義本文 |
| --- | --- | --- |
| `ja` | `label`(担当表の日本語。「複雑または重要な実装」) | 同梱 ja 断片 + ja 語彙 |
| `en` | `id`(`complex-impl`) | 同梱 en 断片 + en 語彙 |
| その他 | 翻訳断片の frontmatter `label` | 翻訳断片 + en 語彙 |

`--list-roles` は `id` と `label` の両方を常に返し、どちらを表示に使うかは CLI が決めずスキル側が言語で選ぶ。

`en` のときのみ、選択肢の表示には `id` を使い、生成される定義には英語断片の frontmatter `label`(`Complex or critical implementation` のような自然文)を使う。ここで言う「自然文ラベル」とは frontmatter の `label` フィールドを指し、`description` や本文見出しではない。この使い分けは要件 4「英語の場合は role の通り」に従いつつ、Agent のシステムプロンプトに `complex-impl` というケバブケースが露出することを避けるためである。

## 7. MCP ツールの付与

### 7.1 前提の整理

同梱プリセットから MCP ツールが外された理由は、そのツールが利用者にとって有用である保証も、有効化されている保証も無いためである。同梱プリセットは配布物であり、利用者の MCP 構成を知らない。

存在しないツール名を `tools` に書いた場合の挙動について、実測と公式ドキュメントが食い違っている。利用者の実測では「エラーにはならないが、他の許可ツールが落ちる可能性がある」。公式は「リストのどのエントリも解決しないとき、通常は起動を拒否し未解決名を返す」とのみ述べ、部分的に無効な名前が残りの有効ツールへ与える影響には触れていない。**機序は未解明である。** どちらが正しくても安全側に落ちるよう、`tools` に書く MCP 名は実在が確認できたものだけに限る設計を採る。

一方、setup が生成するのはプロジェクト側の定義であり、その環境専用である。したがって要件 6 は「setup 生成物にだけ MCP を入れる」と読み替えられ、同梱プリセットを対象とする既存テスト 2 本(`roles.test.ts` の「tools に MCP ツールを含まない」、`presets.test.ts` の `not.toContain("mcp__")`)とは衝突しない。

**プラグインは既知サーバーの表を持たない。** `agent-policy` は役割と担当表を知る立場であって、世の中にどの MCP があり、そのどれが有用かを知る立場ではない。役割は利用者の環境から独立しているが、MCP は完全に環境依存である。したがって「どのサーバーをどの役割へ付けるか」は、検出結果から利用者が選ぶ。プラグイン側の既定は常に「付けない」である。

要件 6 の実体は「MCP を入れられるようにする」ことであって「自動で入れる」ことではない。検出して選択肢として提示した時点で要件は満たされ、何を入れるかの判断は環境を知る利用者が持つ。

**専用の設定ファイルは持たない。** 前回の選択は、生成された定義ファイル自体に既に書かれている。`agent-policy-role` マーカーと `tools` の `mcp__*` を突き合わせれば「どの役割にどのサーバーを付けたか」は逆算できるため、同じ内容を別ファイルへ保存する必要がない。設定ファイルを置くと、`.mcp.json`(Claude Code が読む MCP の接続設定)と紛らわしい名前になるうえ、定義ファイルとの二重管理が生じる。

### 7.2 検出

公式ドキュメントによれば、`tools` フィールドはサーバー単位のパターンを受け付ける。

> Both fields accept MCP server-level patterns in addition to exact tool names: `mcp__<server>` or `mcp__<server>__*` grants or removes every tool from the named server.

ツール名を機械的に取得する手段は存在しない(`claude mcp list` も `claude mcp get` もツール名を返さないことを確認済み)ため、サーバー単位の指定が実在保証と粒度を両立する唯一の現実解である。

**`claude mcp list` は設定済みサーバーを全件返し、ステータスを添える。** 当初「接続に成功したサーバーのみを返す」と想定したが、これは誤りであった。このリポジトリで `.mcp.json` に記載のある `github` が一覧に現れないのは接続失敗のためではなく、`.claude/settings.local.json` の `disabledMcpjsonServers: ["github"]` で無効化されているためである。

したがって `--list-mcp` はステータスを解釈し、`usable` フラグを付けて返す。

| ステータス | `usable` | 扱い |
| --- | --- | --- |
| `✔ Connected` | true | 選択肢に出す |
| `cached`(初回使用時に接続) | true | 選択肢に出す |
| `! Needs authentication` | false | 選択肢に出さない |
| `✘ Failed to connect` | false | 選択肢に出さない |
| `⏸ Pending approval` | false | 選択肢に出さない |
| `✘ Rejected` | false | 選択肢に出さない |

`cached` が `claude mcp list` の出力に現れるかは公式ドキュメントで確認できていない(`/mcp` と plugin manager での記載はある)。現れなければこの分岐は使われないだけで、害は無い。

なお WebSocket サーバーは `claude mcp list` に現れない。この経路のサーバーは本機能の対象外であり、必要な場合は生成後に手動で追加する旨を README に記す。

**パース仕様。** 出力には警告行(`⚠ claude.ai connectors are disabled...`)とヘルスチェックの進捗行(`Checking MCP server health…`)が混ざる。サーバー行は `<name>: <command or url> - <status>` の形をとり、`name` 自体がコロンを含みうる(`plugin:context7:context7: https://... (HTTP) - ✔ Connected`)。したがって**最初のコロンで切ってはならない**。行末から既知のステータス文字列を切り出し、残りの先頭から最初の空白までを名前として採り、末尾のコロンを除く。

サーバー名からツール名プレフィックスへの変換は、`A-Z a-z 0-9 _ -` 以外を `_` に置換する(`plugin:context7:context7` → `mcp__plugin_context7_context7`)。

**実行の堅牢性。** `claude mcp list` はヘルスチェックとして全サーバーへ接続を試みるため、時間がかかりハングしうる。`timeout` と `maxBuffer` を明示し、失敗時は例外を投げずに空の結果を返す。`claude` コマンドが無い環境でもウィザードが止まらないようにする。

**子プロセスと親セッションのずれ。** `--list-mcp` は CLI が子プロセスとして `claude mcp list` を実行する。親セッションが `--mcp-config` やコマンドライン由来の動的設定で持つサーバーが、子プロセスから見えるとは限らない。この不一致は検出できないため、選択肢の提示時に「検出したサーバー一覧」を必ず見せ、想定と違えば利用者が気づけるようにする。

### 7.3 許可の粒度

**allowlist はサーバー単位、denylist はツール単位とする。** この非対称な組み合わせが、任意のサーバーに適用できる一般的な仕組みを与える。

| | 粒度 | 名前の出どころ | 誤りの影響 |
| --- | --- | --- | --- |
| `tools`(allowlist) | サーバー単位 `mcp__<server>` | `claude mcp list` | 実害(権限が落ちる) |
| `disallowedTools`(denylist) | ツール単位 | スキル実行中の Claude のツール一覧 | 無害(存在しない名前を禁止するだけ) |

allowlist にツール名を列挙する案は §10.5 のとおり却下した。ツール一覧を機械的に取得できず、Claude が列挙すると幻覚により存在しない名前を書きうるためである。しかし **denylist ではその幻覚が無害になる**。存在しないツールを禁止しても何も起きない。したがって allowlist は粗い粒度で安全に、denylist は細かい粒度で無害に、という配分が成立する。

この配分により、プラグインは編集系ツールの一覧を持たなくてよい。どのサーバーが編集系を含むかは、そのサーバーが接続されているセッションの Claude が自身のツール一覧から判断する。Serena は読み取り系と編集系が同居する例として設計書に現れるが、特別扱いはしない。同じ手順が任意のサーバーに適用される。

**残る穴を明記する。** `explore` / `independent-review` / `code-review` は `Bash` を持つため、denylist が完全でもシェル経由の変更は防げない。MCP を付ける前と比べて書き込み経路が増える点は変わらないため、断片の制約文に「読み取り系のツールのみを使用し、ファイルを変更しない」を明記して補う。

### 7.4 対話

対話フローのステップ 5 と 6 の間に置く(§6.1)。検出されたサーバーが 0 件、または利用者が 1 つも選ばなければ、このステップは即座に終わる。

**1. 前回の選択の読み戻し。** `--check` の応答に含まれる `mcpCurrent`(既存定義から逆算した「役割 → サーバー」の対応)を既定値として使う。定義がまだ無ければ空となる。

**2. サーバー選択。** `--list-mcp` の `usable: true` を提示する。**プラグイン側の既定は「付けない」**、`mcpCurrent` があればそれを既定値とする。選択肢にはサーバー名とステータスを添える。

**3. 付与先の役割。** 選ばれたサーバーごとに、付与する役割を決める。既定は実装役割 4 種(`complex-impl` / `normal-impl` / `light-impl` / `general`)とする。読み取り役割は、利用者が明示的に選んだときだけ付く。

この場面で次を一度確認する。特定のサーバー名には紐づけない。

> 選んだサーバーが `_common.md` の制約と矛盾しないかを確認する。制約はプロジェクト側の `_common.md` で差し替えられている場合があるため、同梱の記述ではなく実際に適用される内容を見る。

**4. denylist の確認。** 読み取り役割へ付けるサーバーがある場合のみ実施する。スキル実行中の Claude が自身のツール一覧から、そのサーバーの編集・書き込み・削除系ツールを列挙し、`disallowedTools` 案として提示して確認を取る。判断基準は「そのツールが外部の状態を変えるか」であり、読み取り・検索・解析に留まるものは除外しない。

利用者は提示された一覧に追加・削除できる。列挙に漏れがあっても denylist であるため実害は無いが、漏れた編集系ツールは読み取り役割から使えてしまう。この性質を提示時に明示する。

**選択肢の個数制約。** `AskUserQuestion` は 1 回の質問につき選択肢を 2〜4 個しか受け付けない。サーバー数や役割数がこの範囲を外れるときの扱いは §6.1 の共通規則に従う。

### 7.5 読み戻しと再検証

**前回の選択は既存定義から逆算する。** `--check` は対象の定義ファイルを読み、`agent-policy-role` マーカーの役割と `tools` の `mcp__*` を突き合わせて `mcpCurrent` を組み立てる。`disallowedTools` の内容も併せて返す。

```json
{
  "mcpCurrent": {
    "servers": ["serena"],
    "denyTools": ["mcp__serena__write_memory"]
  }
}
```

サーバー名は `mcp__` プレフィックスを除いた形で返す。ツール名プレフィックスへの変換で非英数字が `_` へ潰れているため、`claude mcp list` の元の名前へ完全には戻せない。突き合わせは、検出したサーバー名を `toolPrefix` で変換した結果と比較することで行う。

**書き込むのは常に CLI が決める。** `--write` は次の順で `tools` を組み立てる。

1. 役割断片が申告する built-in ツール
2. `Agent`(許可対象の役割を含むとき)
3. `--mcp-servers` で渡されたサーバーのうち、`claude mcp list` で `usable: true` のもの

`--mcp-servers` に渡されたが `usable` でないサーバーは落とし、落としたことを `mcpDropped` として報告する。設定を書いた環境と使う環境が異なっても、存在しない名前が書き込まれない。

`--mcp-deny` で渡されたツール名は `disallowedTools` へそのまま書く。denylist は誤りが無害であるため再検証しない。

**`automaticKeep` から `mcp__` を除外する。** 現行の `automaticKeep` は既存ファイルにのみ存在する tools をすべて保持する(`setup-agents.ts:341-351`)。これを変えないと、切断済みサーバーの古い `mcp__*` が `--merge` で生き残り続ける。MCP の付与は `--mcp-servers` と再検証が決めるものであり、既存ファイルの内容を根拠に残してはならない。既存の内容は `mcpCurrent` として**提案の根拠**にのみ使う。

`needsReview` の `tools:mcp__` 判定は残す。`--keep tools:mcp__...` を利用者が明示指定した場合にのみ発火することになり、誤爆が消える。

## 8. 移行

### 8.1 既存スキルの廃止

`skills/setup-gpt/` と `skills/setup-grok/` を削除し、`skills/setup-agents/` を新設する。削除操作はクラシファイアに拒否されることがあるため、拒否された場合は絶対パスを提示してユーザーの手で実行する。

### 8.2 同梱プリセット

`PRESETS` を手書きの表から `ASSIGNMENTS` の導出へ変更する。あるモデルの役割集合を「全ポリシーでそのモデルが担う役割の和集合」として計算する。

| プリセット | 各ポリシーでの役割 | 和集合 |
| --- | --- | --- |
| `gpt-sol` | with-codex: `complex-impl` / codex-grok: `complex-impl` | 1 種 |
| `gpt-terra` | with-codex: `normal-impl`, `general`, `explore`, `realtime-research`, `independent-review` / codex-grok: `normal-impl`, `general` | 5 種 |
| `gpt-luna` | with-codex: `light-impl` / codex-grok: `light-impl` | 1 種 |
| `grok` | with-grok: `normal-impl`, `light-impl`, `general`, `explore`, `realtime-research`, `independent-review` / codex-grok: `explore`, `realtime-research`, `independent-review` | 6 種 |

結果は現在の `PRESETS` と一致する。手書きの重複が消えることで、問題 2 のずれが構造的に起きなくなる。既存テスト `presets.test.ts` の「担当表との一致」は、2 つの手書きデータがずれないよう見張るためのものであったが、片方を他方から導出すればずれようがないため、導出結果が上表と一致することを検証するテストへ置き換える。

**Claude 帯は同梱しない。** 理由は役割の和集合の広がり方が GPT / Grok と異なるためである。`gpt-terra` はどのポリシーでも役割集合がほぼ同じだが、`sonnet` は claude-model-policy で 6 役割、他の 3 ポリシーでは `code-review` のみである。和集合を同梱すると、with-codex 環境で `agent-policy:claude-sonnet` が `normal-impl` を持って見え、担当表と食い違う定義が配布物に含まれることになる。Claude 帯は setup で生成するときのみ作る。

当初依頼の「Claude モデル用の setup スキルが無い」に対する回答としては、配布物に Claude 定義が入らない点で後退して見えるが、依頼の実体は「役割に応じたカスタムエージェントを定義できること」であり、setup 経由で満たされる。

### 8.3 SessionStart フック

`session-start.ts` の `ALIASES` の `skill` を `agent-policy:setup-agents` へ変更する。`ALIASES` は GPT / Grok のみのまま維持する(Claude 帯にプロキシエイリアスの概念が無いため)。setup で生成した Claude 定義は `agent-policy-role` マーカーを持つため、`markerBlock` がそのまま拾う。

**`labelOf` を言語別ディレクトリに対応させる。** 現行は `.claude/agent-policy/roles/<id>.md` のみを参照する(`session-start.ts:146-152`)。翻訳断片を `roles/<lang>/` へ置くと、そこにしか存在しない独自役割が「未知の役割 ID」として毎セッション報告される。`roles/` 直下に加えて `roles/*/` も走査対象に含める。

**組み込み役割の表示名は日本語のままとする。** `labelOf` は既知の `RoleId` に対して `ROLES` の `label`(日本語)を返す。フックは会話言語を知り得ないため、英語ユーザーのマーカー表も日本語表記になる。これは既知の制約として README に記す。役割 ID を併記することで、言語が分からなくても対応が付くようにする。

### 8.4 方針スキル 4 本

**「実行帯の解決順」を役割ベースへ統一する。** 現行は方針ごとにベンダー別の解決順を持ち、そのステップ 2 が定義名を既定値(`.claude/agents/gpt-sol.md` など)で名指ししている。ここに 2 つの問題がある。

第一に、**名前による探索が機能しない。** setup は定義名を自由に変更できるため、既定名を前提とした探索は当たらない。ただし setup が生成する定義は `agent-policy-role` マーカーを持つため、ステップ 1(マーカーによる注入)で拾われる。結果としてステップ 2 が実際に拾えるのは「マーカーを持たず、かつ名前が既定と一致する定義」だけであり、名前の慣習に頼った推測になっている。役割マーカーがフックへ導入された時点(`72db6a2`)で役目を終えていたが、解決順の側が追随していなかった。

第二に、**3 本に Claude 帯の解決順が無い。** `with-codex-policy` / `with-grok-policy` / `codex-grok-policy` は GPT 節と Grok 節しか持たず、4 方針すべてで Claude が担当する `code-review`(Sonnet)・`doc-review`(Haiku)・`advisor`(Fable / Opus)の解決手段が書かれていない。`PRESET_ASSIGNMENTS` の `claude-model-policy` が空オブジェクトである判断と同根であり、本設計がその前提を覆す以上、ここも追随が要る。

4 本とも次の形にそろえる。登場しないベンダー帯の行は各方針で削る。

```markdown
## 実行帯の解決順

実務タスク着手前に確認し、以後はタスクごとに再判定しない。

1. SessionStart フックが役割マーカーで注入した定義があれば、その帯はそれを使う。
2. 注入が無い帯は、担当表のモデルで分岐する。
   - Claude 帯: dispatch 時の `model` 上書きで実行帯を指定して起動する。
     読み取り役割はビルトイン `Explore`、実装帯は `general-purpose` へ委譲する。
   - GPT 帯: プラグイン同梱の `agent-policy:gpt-sol` / `gpt-terra` / `gpt-luna` を使う。
   - Grok 帯: プラグイン同梱の `agent-policy:grok` を使う。
3. GPT / Grok をローカルプロキシ経由で呼び出せないときは、§フォールバック に従う。
```

この統一により次が得られる。

- 名前による探索が消え、プロジェクト定義はどんな名前でもマーカーで拾われる
- Claude 帯の解決が 4 本すべてに入る
- `setup-gpt` / `setup-grok` への言及が消える。方針スキルから setup への参照が無くなるため、スキル名の変更に追随する必要も無くなる
- 段数が 4 段から 3 段になる

失うものは、**マーカーを持たない手書きのプロジェクト定義が拾われなくなる**ことである。マーカーを 1 行足せば拾われるため、名前の一致という暗黙の合図から、マーカーという明示の合図へ寄せる変更にあたる。README の移行節に記す。

なお `claude-model-policy` に setup への言及は足さない。方針スキルの「実行帯の解決順」が担うのは「いま、どこへ委譲するか」の決定であり、環境構築の案内ではない。setup が要る状況は SessionStart フックの `setupBlock` がセッション冒頭で通知するため、状態を見られる側が担う。

**`_common.md` の相談先名を追随させる。** 現行の `_common.md` は「相談相手は `Fable` サブエージェントとし、Fable を起動できないときは `Opus` サブエージェント」と書いている。setup で `claude-fable` / `claude-opus` を生成すると、実装エージェントが探す名前と実在する定義名が食い違う。`_common.md` の記述を「担当表の『設計・計画・実装のアドバイザー』帯の定義。プロジェクトに該当する定義があればその名前で、無ければ `model` 上書きで `Fable`(不可なら `Opus`)を指定して起動する」へ改める。ja / en 両方の `_common.md` に反映する。

**`_common.md` の制約を一般則へ書き換える。** 現行の `## 制約` 節には、このリポジトリ固有の運用判断が名指しで入っている。

> - GitHub への書き込み(PR 作成・レビュー投稿)は行わず、必要ならオーケストレーターへ報告する。
> - ブラウザでの動作確認は閲覧・動作確認に限り、対象システムのデータを変更する操作は行わない。

この 2 行は 2 つの層が混ざっている。**一般則の層**は「サブエージェントが外部システムへ不可逆な副作用を出すと、オーケストレーターがそれを把握できないまま並列で他の作業が進む」というオーケストレーション構造そのものから出る規律であり、利用者を問わず成立する。**固有の層**は「GitHub の PR 作成・レビュー投稿」という具体で、GitHub を使わない利用者には当たらず、「サブエージェントに PR を作らせたい」運用を否定する根拠にもならない。`_common.md` は全利用者の生成定義に入る配布物であるため、後者が混入しているのは誤りである。

**書き換えるのは GitHub の行だけとする。** 具体名を落とし、判断基準(不可逆・外部・副作用)だけを残す。

> - 外部システムへの不可逆な副作用(公開・投稿・送信・書き込み)は行わず、必要ならオーケストレーターへ報告する。
> - ブラウザでの動作確認は閲覧・動作確認に限り、対象システムのデータを変更する操作は行わない。

GitHub への PR 作成は一般則の一例として自然に含まれ、GitLab でも Slack でも同じ規律が効く。ブラウザの行は残す。これは特定サービスの名指しではなく、ブラウザという操作手段に対する制限であり、一般則だけでは「閲覧は許すが変更は許さない」という境界が読み取れないためである。一般則の適用例として並べる形になる。

**選択可能にはしない。** これは設定項目ではなく規律の中核であり、並列委譲を安全にする前提として方針スキルの担当表と一体になっている。setup の選択肢に並べると、「サブエージェントが外部へ副作用を出す構成」が `agent-policy` の枠内にあるかのように見える。規律から外れる運用を望む利用者には既存の逃げ道がある。`fragments.ts:loadCommon` は `_common.md` を節単位で上書きするため、`.claude/agent-policy/roles/_common.md` に `## 制約` 節を書けば同梱の制約が差し替わる。「既定は安全側、逸脱は明示的に」という §7.1 の既定「付けない」と同じ考え方で揃う。

### 8.5 ドキュメント

- ルート `README.md` の「エイリアスを変更する」と「役割を選んで自分の定義を作る」を `setup-agents` 前提へ全面改稿する(ポリシー選択・モデル選択・言語・MCP)
- 移行節に 5 項目を追加する(スキル統合、`LSP` 除去、MCP 付与、`_common.md` の相談先表記と制約の変更、実行帯の解決順が役割マーカー必須になったこと)
- 環境変数節に `CLAUDE_CODE_SUBAGENT_MODEL` が frontmatter の `model` を上書きする旨を追記する
- WebSocket 経由の MCP サーバーは検出対象外である旨を追記する
- SessionStart の役割マーカー表が日本語表記である旨を追記する
- `docs/development/cliproxyapi-setup.md` の手順に含まれる `agent-policy:setup-gpt` / `setup-grok` を `setup-agents` へ更新する
- `harness-docs/ARCHITECTURE.md` のディレクトリ構成が `assets/roles/<lang>/` という新レイアウトを知らないため、`/metatron:update` で追随させる
- 「同梱エージェント」表は変更しない

### 8.6 バージョン

`0.9.0-dev` → `0.10.0-dev`。`plugin.json` と `package.json` を揃える。CLI の破壊的変更(`--vendor` 廃止)とスキル統合を含むため、マイナーを上げる。

## 9. 検証

### 9.1 テスト

| ファイル | 内容 |
| --- | --- |
| `src/agents/__test__/policies.test.ts`(新規) | `ASSIGNMENTS` が全ポリシー × `RoleId` 10 種を網羅すること、`modelsFor` / `rolesFor` の逆引き整合、`advisor` が 2 モデルを持つこと |
| `src/agents/__test__/roles.test.ts` | `LSP` 除去後の `resolveTools` 期待値。`complex-impl` / `normal-impl` / `light-impl` / `general` の 4 役割すべてを網羅 |
| `src/agents/__test__/presets.test.ts` | 導出結果が §8.2 の表と一致すること |
| `src/agents/__test__/fragments.test.ts`(新規) | 3 段探索の優先順位、`source` 判定、`source-hash` の stale 検出、ベンダー別断片の言語別読み込み |
| `src/agents/__test__/mcp.test.ts`(新規) | `claude mcp list` 出力のパース(コロンを含む名前、警告行とヘルスチェック行の除去、各ステータス)、`usable` 判定、サーバー名からツール名プレフィックスへの変換、既存定義からの `mcpCurrent` 逆算 |
| `src/agents/__test__/compose.test.ts` | `LSP` 除去、言語別語彙(`ja` / `en` の見出しと description)、MCP 付与、`disallowedTools` 節の出力 |
| `src/__test__/setup-agents.test.ts` | `--vendor` 廃止、`--policy` / `--model-id` / `--lang` の検証、担当表外の組み込み役割の拒否、**プロジェクト独自役割が通ること**、`--scaffold-fragments`、`--check-fragments` の応答構造、`automaticKeep` が `mcp__` を除外すること |
| `src/hooks/__test__/session-start.test.ts` | スキル名の変更、`labelOf` が `roles/<lang>/` を走査すること |

`mcp.test.ts` は外部コマンド `claude mcp list` に依存する。テスト方針が「E2E テストは持たない」「故障注入は `src/testing/` に置く」であるため、次の形に分ける。

- パース(`parseMcpList`)と逆算(`mcpCurrent`)は純関数として単体テストする
- コマンド実行は `src/testing/fake-claude.mjs` を用意し、環境変数 `AGENT_POLICY_CLAUDE_BIN` でそのパスを指す。CLI はこの変数があればそれを、無ければ `claude` を実行する
- 本番の CLI にテスト専用オプションを置かない。`--mcp-usable` のようなフラグは、スキルの `Bash(setup-agents.mjs *)` が事前承認する範囲に入るため、実在しないサーバー名を `tools` へ書く迂回路になる

英語断片の品質はテストでは検証できない。`compose` が en 断片と en 語彙で合成でき、出力に日本語が混入しないことを検証する。

### 9.2 Done の条件

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る
- `src/` を変更したため `pnpm run build` を実行し、`scripts/` と `agents/` の差分が同じコミットに含まれる
- `plugin.json` と `package.json` のバージョンが揃って `0.10.0-dev` になっている
- ルートの `README.md` と `docs/development/cliproxyapi-setup.md` に反映されている
- `/metatron:update` で ARCHITECTURE のディレクトリ構成を追随させている

## 10. 不採用案

### 10.1 setup-claude を独立スキルとして追加する

当初の依頼どおり `setup-claude` を 3 本目のスキルとして追加する案。`setup-gpt` / `setup-grok` とほぼ同一の手順が 3 本並ぶことになり、重複が増える。要件 2(ポリシー・モデル・役割を選んで一度に複数生成)と要件 3(担当表による絞り込み)を満たすには、いずれにせよ担当表の機械可読化が必要であり、その時点でスキルを分けておく利点が消える。

### 10.2 スキルに `Write` を許可して翻訳断片を書く

当初の案。`allowed-tools` に `Write` を足し、書き込み先を `Write(.claude/agent-policy/roles/**)` で限定する構想であった。公式ドキュメントが `Write(path)` を照合しないと明記しているため成立しない。`allowed-tools` は制限ではなく事前承認であるため、`Write` を足すと `.claude/agents/` への書き込みまで承認され、エージェント定義を CLI に閉じる契約が権限レベルで崩れる。`Edit(path)` は照合されるため、§6.5 の方式を採る。

### 10.3 翻訳文を CLI の標準入力で渡す

`Write` の全面禁止を維持したまま翻訳を実現する案。ファイルを書く主体が CLI のままとなる点は優れるが、11 断片ぶんの Markdown をシェル経由で渡すことになり、引用符と改行で壊れやすい。既知の失敗パターン(`raphael:ab-2026-0803-002`「改行がスペースに置換される」)の踏み台になる。`--scaffold-fragments` + `Edit` はこの案の利点(CLI が新規作成を担う)を保ちつつ、シェル経由の受け渡しを避けられる。

### 10.4 その他言語を英語へフォールバックする

翻訳経路を作らず、`ja` / `en` 以外は英語断片を使う案。要件 5「その他の言語は英語から翻訳する」を満たさない。

### 10.5 MCP ツールを個別に列挙する

`tools` に `mcp__serena__find_symbol` のようにツール名を列挙する案。粒度は細かいが、ツール一覧を機械的に取得する手段が無い(`claude mcp list` も `claude mcp get` もツール名を返さない)。スキル実行中の Claude が自身のツール一覧から列挙することは可能だが、幻覚により存在しない名前を書けば「他の許可ツールが落ちる」という未解明の故障を踏む。サーバー単位のパターンが使えるため、この案は不要である。

### 10.6 Claude 帯を同梱プリセットに追加する

`agent-policy:claude-opus` などを配布物に含める案。setup を実行せずに使える利点があるが、§8.2 のとおり役割の和集合がポリシーをまたいで広がり、担当表と食い違う定義を配ることになる。

### 10.7 `mcpServers` frontmatter を使う

公式はプロジェクト subagent の frontmatter に `mcpServers` を書いて、既存サーバー名を指定する経路も提供している(プラグイン subagent では無視される)。`tools` に `mcp__<server>` を書く方式と併用したときの解決順が不明であり、両方書くと許可集合が想定とずれる。本設計は `tools` 方式に一本化し、`mcpServers` は使わない。

### 10.8 見出しまで翻訳可能にする

翻訳断片の節見出しをユーザー言語にする案。`compose.ts` が見出し文字列で節を突き合わせる構造上、語彙を翻訳断片側から読む仕組みが要る。`_common.md` の節構成とも連動するため複雑になる。`ja` / `en` の 2 語彙を持ち、その他言語は英語見出し + 翻訳本文とする(§6.2)。

### 10.9 プラグインが既知 MCP サーバーの推奨表を持つ

`serena` / `context7` / `playwright` / `github` について「どの役割へ付けるか」の推奨マッピングをプラグインが持ち、それを既定として提示する案。当初の設計はこの形だった。

3 つの理由で採らない。第一に、`agent-policy` は役割と担当表を知る立場であって、世の中にどの MCP があり、そのどれが有用かを知る立場ではない。役割は利用者の環境から独立しているが、MCP は完全に環境依存である。第二に、列挙した 4 種のいずれも使わない利用者に対して、表は何の役にも立たないうえ「この 4 つが想定されている」という誤った印象を与える。第三に、`github` を既定で外す根拠にしていた `_common.md` の GitHub 制約自体が、このリポジトリ固有の判断の混入であった(§8.4)。

代わりに、検出結果から利用者が選ぶ形とし、プラグイン側の既定は常に「付けない」とする(§7.1)。

### 10.10 読み取り役割の編集系ツールをプラグインが列挙する

サーバーごとの書き込み系ツール名をプラグインが表として持ち、読み取り役割へ付けるときに `disallowedTools` へ展開する案。編集系ツールを持つのは Serena に限らず、任意のサーバーがそれを持ちうるため、プラグインが網羅することは原理的にできない。`disallowedTools` は誤りが無害であるという非対称性を利用し、スキル実行中の Claude が自身のツール一覧から列挙する形を採る(§7.3)。

### 10.11 MCP の選択を専用の設定ファイルへ保存する

`.claude/agent-policy/mcp.json` に「役割 → サーバー」の対応を保存し、再 setup では聞かずに適用する案。当初の設計はこの形だった。

2 つの理由で採らない。第一に、**保存する必要が無い**。前回の選択は生成された定義ファイル自体に書かれており、`agent-policy-role` マーカーと `tools` の `mcp__*` を突き合わせれば逆算できる。同じ内容を別ファイルへ持つと二重管理になる。第二に、**書き込む経路が無い**。スキルは `Write` をツールレベルで禁止し、`Edit` は `roles/**` に限定している。設定ファイルはその外にあるため、CLI に書き込みサブコマンドを足さないかぎり保存できない。要らない機能のために契約を広げることになる。

加えて `.mcp.json`(Claude Code が読む MCP の接続設定)と紛らわしい名前になる点も避けたい。

### 10.12 `LSP` を残す

背景では落ちるが、前景・fork・背景無効化環境では機能するため残すという案。定義が実行文脈によって違う能力になり、しかも除去はエラーを報告しないため、利用者からは「動く場合と動かない場合がある」としか見えない。並列委譲を前提とする本プラグインでは前景で動く場面が限られるため、挙動の一貫性を優先して除去する。失われる能力は MCP(Serena)が代替する。
