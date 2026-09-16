# agent-policy

Claude Code を使うときのエージェント運用方針を、スキルとして配布する Claude Code プラグインです。

モデル別または役割別の担当表、設計/実装フロー、アドバイザー運用、並列原則、コードベース探索のコスト効率化施策(context-map)を定めます。Claude モデルだけで完結するプロファイルと、プロジェクト固有の Agent 定義を使う custom プロファイルを選べます。`AMATSUKA_AGENT_AUTO_INJECTION` を設定すれば、任意のプロジェクトへ同じ運用を持ち込めます。

## 動作要件

方針スキル自体に依存はありません。

SessionStart フックと SubagentStart フックは Node.js で動作します。`node` が PATH 上にあり、バージョンが 22 以上である必要があります。

SubagentStart フックはサブエージェントの起動時に発火し、役割マーカーの対応表を注入します。Claude Code 2.0.43 より前のバージョンにはこのイベントが無いため、注入は行われません。

Claude Code 本体はネイティブバイナリで配布され Node.js を同梱しないため、未導入の場合は別途インストールしてください。

## 導入

Claude Code で Marketplace を追加します。

```text
/plugin marketplace add https://github.com/Amatsuka-kobo/amatsuka-claude-plugins
```

Marketplace から `agent-policy` をインストールします。

```text
/plugin agent-policy
```

プロジェクト単位またはユーザー単位で導入する場合はスコープを指定します。

```text
/plugin agent-policy --scope project
/plugin agent-policy --scope user
```

## プロファイル

環境変数 `AMATSUKA_AGENT_AUTO_INJECTION` の値を trim・小文字化して判定し、SessionStart フックがセッション開始時の方針を注入します。通常使う値は `none`、`claude`、`custom` の 3 つです。

| 値 | プロファイルと注入内容 |
| --- | --- |
| `none` または未設定 | 方針スキルと役割マーカーの対応表を注入しません。 |
| `claude` | `agent-policy:claude-model-policy` を注入します。役割の一覧は共通規律にあり、その「Claude モデル」列で役割を固定します。Agent 定義のセットアップは不要です。 |
| `custom` | プロジェクトの役割マーカー付き Agent 定義を検査します。構成が成立すれば、`agent-policy:custom-policy` と役割マーカーの対応表を注入します。 |

`custom` では、役割マーカー付き定義の外部モデルがプロキシの `/v1/models` に実在することを検証します。すべて存在すると確認できた場合は `custom-policy` と対応表を注入します。役割マーカー付き定義が無い、モデルが見つからない、または照会に失敗した場合は、セッション全体を `claude` プロファイルへフォールバックし、その理由を起動時に通知します。

自動注入を使わない場合は、CLAUDE.md に方針スキルへ従う旨を直接書けます。たとえば custom 構成では、次のように書きます。

```markdown
- 最初に必ず `agent-policy:custom-policy` スキルを使用し、この規律に従う。
```

## 環境変数

| 変数名 | 用途 | 既定値 |
| --- | --- | --- |
| `AMATSUKA_AGENT_AUTO_INJECTION` | 注入プロファイルの選択(`none` / `claude` / `custom`) | 未設定(`none` と同じ) |
| `ANTHROPIC_BASE_URL` | custom 構成の外部モデルを照会するプロキシのベース URL | 未設定 |
| `ANTHROPIC_AUTH_TOKEN` | `/v1/models` 照会の Bearer 認証トークン | 未設定 |
| `ANTHROPIC_API_KEY` | Bearer トークンが無い場合の `/v1/models` 照会用 API キー | 未設定 |
| `AMATSUKA_AGENT_DELEGATION_GATE` | delegation gate の有効化 | 未設定(無効) |
| `AMATSUKA_AGENT_PARALLEL_NUDGE` | 並列促しフックの無効化 | 未設定(有効) |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Claude Code が全サブエージェントへ適用するモデル | 未設定 |

`CLAUDE_CODE_SUBAGENT_MODEL` を設定すると、Agent 定義の frontmatter にある `model` より優先されます。定義ごとに選んだモデルを使う場合は設定しないでください。

### プロキシを使う custom 構成

外部モデルの実在を検証する custom 構成では、`ANTHROPIC_BASE_URL` がフックの実行環境から見える必要があります。シェル環境に設定した値がフックへ継承されることは実測で確認しています。プロジェクトごとに固定したい場合などは、Claude Code の `settings.json` / `settings.local.json` の `env` に置くこともできます。プロジェクト単位では、そのプロジェクトの `.claude/settings.json` に書きます。

```json
{
  "env": {
    "AMATSUKA_AGENT_AUTO_INJECTION": "custom",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8317"
  }
}
```

`/v1/models` の照会では、`ANTHROPIC_AUTH_TOKEN` を `Authorization: Bearer` として最初に使います。これが無い場合は `ANTHROPIC_API_KEY` を `x-api-key` として使い、どちらも無い場合は無認証で 1 回試行します。これらの認証変数はいずれも必須ではありません。

外部モデルの検証が必要な custom 構成で `ANTHROPIC_BASE_URL` が無い場合、照会は行われず、セッションは claude プロファイルへフォールバックします。この理由は起動時に通知されます。`AMATSUKA_AGENT_AUTO_INJECTION` に未知の値を設定した場合も、方針は注入されず、値が未知である旨を通知します。

## 役割を選んで自分の定義を作る

`agent-policy:setup-agents` は、custom プロファイルで使う Agent 定義を、実在するモデルと役割からまとめて作る対話ウィザードです。claude プロファイルはセットアップ不要です。custom プロファイルを使う場合は、プロジェクトの `.claude/agents/` に定義を生成してください。

```text
/agent-policy:setup-agents
```

対話モードでは、会話の使用言語を確認した後、`/v1/models` を照会して実在する外部モデルと Claude enum を候補にします。既存定義の役割被覆を確認し、作るモデル・役割・定義名・ベンダーを選んで差分を確認してから生成します。モデルと役割の組合せは拘束しません。推奨から外れる組合せは警告として表示されます。

プロキシを照会できない場合も、Claude enum と推奨モデルの既定エイリアスから定義を生成できますが、外部モデルの実在は保証されません。次の SessionStart で検証できるようになったときに、不在のモデルは検出されます。

日本語と英語の役割断片は同梱されています。それ以外の言語では `.claude/agent-policy/roles/<lang>/` に英語の雛形を作り、翻訳してから生成します。

MCP サーバーの検出には `claude mcp list` を使い、接続済みまたはキャッシュ済みのサーバーだけを候補にします。WebSocket 経由の MCP サーバーは検出対象外です。読み取り役割へ MCP を付ける場合は、外部状態を変更するツールを `disallowedTools` へ入れる案を確認してから生成します。

MCP の付与単位は役割ではなく定義です。既定では実装役割(`complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` / `design-plan` / `doc-writing` / `explore-lead`)を持つ定義にだけ付き、読み取り役割だけの定義には付きません。定義ごとの調整を選ぶと、この既定を定義単位で上書きできます。実装役割と読み取り役割を同じ定義が持つ場合、MCP はその定義全体に付き、役割ごとには分離できません。

`AMATSUKA_AGENT_AUTO_INJECTION=custom` で定義の検証が成立したセッションでは、生成後に CLAUDE.md へ方針の読み込みを追記する必要はありません。未設定・`none`・未知の値では自動注入されないため、必要に応じて「[プロファイル](#プロファイル)」の例を CLAUDE.md へ書けます。`claude` で生成した custom 定義を役割マーカーから使いたい場合は、環境変数を `custom` に変更してください。

`--yes` を渡す非対話モードでは、推奨構成を一括で保持マージ生成します。MCP ツールは明示的な選択がないため付きません。照会に成功した場合は実在しない推奨モデルを生成対象から外し、照会に失敗した場合は実在確認を行わなかった警告とともに生成します。

組み込みの役割 ID は次の 17 種です。

| 役割 ID | 内容 |
| --- | --- |
| `complex-impl` | 複雑または重要な実装 |
| `normal-impl` | 通常の実装 |
| `light-impl` | 軽量な実装 |
| `escalation` | 行き詰まり時のエスカレーション |
| `general` | その他のタスク |
| `design-plan` | 設計書・実装計画書(WBS)の作成 |
| `doc-writing` | 文書作成 |
| `explore-lead` | コードベース探索統括 |
| `explore` | コードベース探索実働 |
| `realtime-research` | リアルタイム情報調査 |
| `e2e-verify` | E2E 動作検証・ブラウザ/GUI 操作 |
| `independent-review` | 設計書・実装計画書の独立レビュー |
| `doc-review` | 設計書・実装計画書のレビュー |
| `code-review` | コードレビュー |
| `final-review` | 重要な実装の最終レビュー |
| `gate-review` | 設計書の最終ゲートレビュー |
| `advisor` | 設計・計画・実装のアドバイザー |

setup-agents が扱う推奨モデル ID は次の 10 種です。

| モデル ID | 表示名 | 既定の `model` 値 |
| --- | --- | --- |
| `opus` | Opus | `opus` |
| `sonnet` | Sonnet | `sonnet` |
| `haiku` | Haiku | `haiku` |
| `fable` | Fable | `fable` |
| `gpt-sol` | GPT Sol | `claude-gpt-5-6-sol` |
| `gpt-terra` | GPT Terra | `claude-gpt-5-6-terra` |
| `gpt-luna` | GPT Luna | `claude-gpt-5-6-luna` |
| `gpt-astra` | GPT Astra | `claude-gpt-6-astra` |
| `grok` | Grok | `claude-grok-4-6` |
| `gemini-flash` | Gemini Flash | `claude-gemini-3-8-flash` |

生成した定義の frontmatter には、選んだ役割を記録する `agent-policy-role` マーカーが入ります。

```yaml
agent-policy-role: normal-impl, explore
```

SessionStart フックはプロジェクトの `.claude/agents/` を走査し、このマーカーから「役割 → Agent 名」の対応をセッションへ注入します。注入される役割マーカー表の各行は `- 役割名 [RoleId]: 定義名` の形です。役割名は日本語表記で、`[RoleId]` は `agent-policy-role` マーカーに書く値と同じです。生成した定義の共通規律は、言語によらずこの RoleId で行を引きます。`--lang en` などで生成した定義でも、役割名の言語に関係なく対応表を照合できます。`custom` と旧互換値の設定では、検証が成立した場合にすべてのマーカー付き定義を載せます。`claude` の設定と、custom から claude へフォールバックした場合は、`model` が Claude のモデルで実行され、かつ外部ベンダーを宣言していない定義だけを載せます。SubagentStart フックは環境変数の値だけで範囲を決めるため、custom から claude へフォールバックしたセッションでは、SessionStart と違ってすべての定義を載せます。この差は既知のもので、親は絞り込んだ表で委譲するため実害は限定的です。`none` と未設定では対応表を注入しません。

このマーカーは、その役割の委譲先候補になることに加えて、外部 Agent を名指しで dispatch するときにプロジェクト最適化(MCP tools と適応本文)を届ける合成ホストの候補になることも表します。合成ホストにしたくない定義からは、マーカーを外してください。

プロジェクト固有の役割断片は `.claude/agent-policy/roles/` に Markdown ファイルとして置けます。断片の frontmatter には `id`、`label`、`description`、`default-name`、`tools`、`kind` を指定します。`default-name` は未カバーの役割を個別に作るときの既定名 `<model-id>-<default-name>` に使われます。`kind` は `impl` または `readonly` です。独自の `id` は setup の選択肢に追加され、既存の役割と同じ `id` を指定すると組み込み断片を置き換えます。

断片の節見出しは、生成時に選んだ言語の見出し集合と一致させてください。`--lang ja` では `## 作業手順` / `## 制約`、それ以外では `## Procedure` / `## Constraints` を使います。一致しない見出しの節は合成結果に現れません。`ja` / `en` 以外の翻訳断片でも見出しは英語のままにし、翻訳するのは本文と frontmatter の `label` / `description` です。

SessionStart フックは独自役割の表示名を解決するとき、`.claude/agent-policy/roles/<id>.md` に加えて `.claude/agent-policy/roles/*/<id>.md` も走査します。同じ役割 ID が複数の言語ディレクトリにある場合、フックは会話言語を知らないため、どの表示名が使われるかは決まりません。

## delegation gate

Delegation gate は、メインセッションから保護対象を直接編集しようとしたときに deny し、担当表に従った委譲を促す PreToolUse フックです。既定では無効です。有効にするには、次の 2 つを必ず揃えます。

1. `AMATSUKA_AGENT_DELEGATION_GATE` を `1`、`true`、`on` のいずれかに設定する。
2. 対象プロジェクトに `.claude/agent-policy/delegation-gate.json` を置く。

設定ファイルは次をひな形にしてください。`denyGlobs` は必須で、空ではない文字列配列にします。`mcpTools` と `ttlSeconds` は任意です。

```json
{
  "denyGlobs": ["plugins/*/src/**", "plugins/*/skills/**"],
  "mcpTools": {
    "mcp__example__edit": {
      "pathParam": "relative_path",
      "absolute": false
    }
  },
  "ttlSeconds": 7200
}
```

`denyGlobs` には、プロジェクトで直接編集から保護したいパスをプロジェクトルート相対の glob で指定します。`mcpTools` には gate の対象に加える MCP ツール名と、パス引数の名前(`pathParam`)・絶対パスかどうか(`absolute`)を指定します。`mcpTools` を省略した場合、MCP ツールは対象になりません。

組み込みの `Edit`、`Write`、`NotebookEdit` は宣言不要で、常に対象です。それぞれ `file_path`、`file_path`、`notebook_path` の絶対パスを検査します。`ttlSeconds` を省略したときの一時解除 TTL は 7,200 秒です。

### 一時解除

対象プロジェクトのルートで、agent-policy のインストール先を指定して次の CLI を実行します。Claude Code が設定する `CLAUDE_PLUGIN_ROOT` を利用できる環境では、そのまま使えます。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegation-gate.mjs" --direct on
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegation-gate.mjs" --direct status
node "${CLAUDE_PLUGIN_ROOT}/scripts/delegation-gate.mjs" --direct off
```

`--direct on` は一時解除を始め、`--direct status` は状態と残り時間を表示し、`--direct off` は解除を終了します。一時解除は `ttlSeconds` の経過で自動的に失効します。この解除は**ユーザー自身が実行するもの**です。Agent や AI に実行させないでください。

このフックには既知の限界があります。Bash 経由の書き込みは技術的に止められません。また、AI 自身が `--direct on` を実行して回避することも技術的には可能であり、「ユーザー自身が実行する」という文言を守る運用に依存します。

## 並列促しフック

サブエージェントを起動しようとするたびに、まだ着手していない独立タスクがあれば同じメッセージで並列 dispatch するよう促す短い文言を注入します。前の出力に依存する場合だけは逐次にします。

このフックは既定で有効です。`AMATSUKA_AGENT_PARALLEL_NUDGE` を `0`、`false`、`off` のいずれかにすると無効にできます。効果は未実証であり、dispatch 時だけ動く低コストな補助として置いています。

## 旧バージョンからの移行

0.18 系から 0.19 系へ移行する場合は、次を確認してください。

1. 役割 ID に `doc-writing`(文書作成)を追加しました。AI が読む文書 —— 引継ぎ書・Skills・Agents 定義・Rules・CLAUDE.md・フックが注入する文 —— とコードコメントの執筆を担う役割です。断片には、直訳を避ける・その言語の文法と慣用に従う・簡潔に書く・過剰な引用と冗長な表現を避ける、という執筆規律が入っています。設計書・実装計画書・context-map については、内容が確定した後の文章化・推敲・翻訳だけを担います。内容の決定と初稿は従来どおり `design-plan` と `explore-lead` の役割が担います。
2. `general`(その他のタスク)から文書の責務を外しました。定型メンテナンスと、他の役割に当てはまらない作業が担当範囲になります。生成済みの定義の本文は自動では変わりません。文言を追随させるには `agent-policy:setup-agents` を再実行してください。
3. `doc-writing` の Agent Tool は「否」です。この役割だけを持つ定義には Agent Tool が付きません。
4. custom プロファイルで、生成済みの定義に `doc-writing` のマーカーが無い場合は、担当表の「Claude モデル」列(`Sonnet`)へ読み替えられます。委譲先を定義で固定したい場合は `agent-policy:setup-agents` を再実行してください。
5. 推奨モデル ID に `gemini-flash`(`claude-gemini-3-8-flash`)を、ベンダーに `gemini` を追加しました。`--vendor` は `gpt` / `grok` / `gemini` / `claude` / `none` の 5 値になります。`gemini` の色は green です。
6. **impl 役割のサブエージェントは、ファイルとして残す文書を書くときに「文書作成」の定義があればそこへ再委譲するようになりました。** 対応表に無ければ自分で書きます。報告の本文は対象外です。生成する定義の共通部分(`_common.md`)で、`Agent` tool の用途を「アドバイザーへの相談」と「文書作成への再委譲」の 2 つに広げています。**`doc-writing` は単独の定義として作ることを勧めます。** 実装役割と兼ねた定義は Agent Tool が「可」になり、名指しで起動したときに再委譲を frontmatter の段階では止められません。
7. **`light-impl`(軽量な実装)の Agent Tool を「可」にしました。** あわせてモデルによる Agent Tool の除外を廃止したため、**Haiku を指定した定義でも、Agent Tool が「可」の役割を持つものには Agent tool が付きます**(従来はモデルが Haiku というだけで外れていました)。Agent の可否は役割だけで決まります。既存の生成済み定義は自動では変わりません。`agent-policy:setup-agents` を再実行してください。
8. **オーケストレーターも、ファイルとして残す文書を自ら書かず「文書作成」の役割へ委譲するようになりました。** 対象は AI が読む文書・引継ぎ書・goal コマンドのプロンプト・内容が確定した後の設計書や実装計画書の文章化・コードコメントです。要件や判断の箇条書きを依頼文の中に書くことは対象外です。
9. プロキシの `/v1/models` が返す `owned_by` が `antigravity` のモデルを `gemini` と判定します。`antigravity` のプロバイダで Gemini 以外のモデルも配っている場合、それらも `gemini` と推定されます。ウィザードは推定値を提示して確認を取るため、違うときはその場で選び直すか `--vendor` で上書きしてください。プロキシ側で Gemini のエイリアスを設定していない場合、この追加による影響はありません。
10. **役割マーカー対応表の各行に RoleId を併記するようにしました。** 行は `- 文書作成 [doc-writing]: writer` の形になります。生成する定義の共通規律(`_common.md`)は、アドバイザーの照合と文書作成への再委譲を、役割名ではなく RoleId で行うようになりました。これにより `--lang en` など日本語以外で生成した定義でも対応表を照合できます。生成済みの定義は自動では変わりません。文言を追随させるには `agent-policy:setup-agents` を再実行してください。再生成しなくても、日本語で生成した定義は役割名で照合し続けられます(役割名は行に残るため)。

0.17 系から 0.18 系へ移行する場合は、次を確認してください。

1. 委譲先の候補という考え方を導入しました。claude 構成では `model` が Claude のモデル(`sonnet` / `opus` / `haiku` / `fable` / `inherit` / 未宣言)で実行され、かつ `agent-policy-vendor` が未宣言・`claude`・`none` のいずれかである定義を候補にします。custom 構成では、これに加えて外部ベンダーのモデルを指定した定義も候補に含めます。
2. claude 構成でも役割マーカーの対応表を注入するようになりました。表の 2 行目に候補の範囲が書かれます。
3. `model` に `sonnet` などの enum ではなく実際の API モデル ID(`claude-sonnet-4-6` 等)を書いた定義は、claude 構成の候補に入りません。`model` を enum で書き直すか、`agent-policy:setup-agents` で生成し直してください。
4. 委譲先の解決順を共通規律の「委譲先の解決」節へ 1 つにまとめ、両方針スキルから同種の記述を削除しました。旧記述の「`readonly` の役割はビルトイン `Explore`、`impl` の役割は `general-purpose` へ委譲する」は誤りでした。ビルトインは、対応表にも候補のプロジェクト定義にも該当が無いときの最後の受け皿です。
5. SubagentStart フックが配布していたサブエージェント向けの規律断片(`references/subagent-discipline.md`)を廃止しました。同フックが注入するのは対応表だけになります。規律は、サブエージェントを起動する側が依頼文へ転記します。共通規律の「サブエージェントは〜」で始まる 9 条項がその対象です。`AMATSUKA_AGENT_AUTO_INJECTION` が `none` または未設定の環境では、これまで断片が届いていましたが、今後は生成した定義の本文だけが規律の経路になります。
6. `agent-policy:setup-agents` に `--scope claude|custom` を足し、ウィザードの冒頭で構成を選べるようにしました。`--scope claude` ではプロキシへ照会せず、Claude のモデルだけで定義を生成します。**`--scope` を省略したときの既定は `AMATSUKA_AGENT_AUTO_INJECTION` から決まります(`custom` / `with-codex` / `with-grok` / `with-codex-grok` とその大文字小文字違いなら `custom`、それ以外と未設定は `claude`)。0.17 以前の CLI はこの環境変数を読んでいなかったため、これは挙動の変化です。** 環境変数を設定していないプロジェクトで `--scope` を省略して `--list-live-models` を叩くと、プロキシを照会せず空の `models` が返ります。従来どおり外部モデルを扱うときは `--scope custom` を明示してください。
7. claude 構成では「設計書・実装計画書の独立レビュー」の役割が**省略**されるようになりました。0.17 以前はビルトイン `Explore` へ送っていましたが、同じベンダーのモデルによるレビューは独立性を持たないため、対応表に該当する定義が無ければ省略し、他の役割で代行しません。外部ベンダーの定義でこの役割を埋めたい場合は `custom` 構成を使ってください。
8. 役割 ID・役割断片・生成される定義の frontmatter・フックの登録は変更していません。既存の定義はそのまま使えます。

0.16 系から 0.17 系へ移行する場合は、次を確認してください。

1. 役割の一覧(役割名・役割 ID・種別・Agent Tool の可否・Claude モデル)を `references/orchestration-discipline.md` の「担当表」節へ集約しました。`claude-model-policy` と `custom-policy` の表は削除しています。両方針スキルは以前から共通規律を必読としているため、動作は変わりません。
2. `custom-policy` の推奨モデル列を廃止しました。推奨は `agent-policy:setup-agents` の提示(`--list-live-models` の `recommendedFor`、`--list-coverage` の `models`)だけで参照します。セッション中に推奨モデルの一覧が要るときは setup-agents を使ってください。
3. custom プロファイルで対応表に無い役割を読み替えるとき、読み替え先は共通規律の「担当表」の「Claude モデル」列になりました。以前は `claude-model-policy` の表を参照する記述でしたが、custom が成立したセッションではその方針が注入されないため、参照が解決できませんでした。
4. 役割 ID・役割断片・フックの動作は変更していません。生成済みの Agent 定義はそのまま使えます。setup-agents の再実行も不要です。ただし共通断片 `_common.md`(日本語)のアドバイザー相談の項で、参照先の呼称を「担当表」から「対応表」へ直しました。サブエージェントへ届くのは役割マーカーの対応表だけであるためです。この変更は次回以降に生成する定義へ反映されます。
5. 役割の区分を指す語を「帯」から「役割」へ改めました(0.17.1)。共通規律の節名は「担当表」、表の列名は「役割名」になっています。方針スキルの節名は「実行役割の解決順」でしたが、0.18 で共通規律の「委譲先の解決」へ統合しました。フックが注入する文言と生成断片も同じ語に揃えています。生成済みの Agent 定義には「帯」が残りますが、動作は変わりません。

0.15 系から 0.16 系へ移行する場合は、次を確認してください。

1. 役割 ID に `design-plan`(設計書・実装計画書(WBS)の作成)と `explore-lead`(コードベース探索統括)を追加しました。これまでオーケストレーター自身が担うとしていた 2 つの作業を、Opus 推奨のサブエージェント役割として委譲します。担当表のすべての役割はサブエージェントが担い、オーケストレーターは dispatch・要件確定・採否判断・承認・分析だけを担います。
2. custom プロファイルで既存の生成済み定義を使っている場合、新 2 役割のマーカーが無いため `claude-model-policy` の同じ役割(`Opus`)へ読み替えられます。委譲先を定義で固定したい場合は `agent-policy:setup-agents` を再実行してください。
3. `context-map-template.md` の「作成者」欄は `Opus(探索統括)` の固定値から記入欄に変わりました。
4. claude プロファイルの「設計・計画・実装のアドバイザー」の役割から `Opus` を外し、`Fable` のみにしました。`Fable` が使えない環境ではアドバイザーへの相談を省き、差し戻しで解決してください。

0.13 系から 0.14 系へ移行する場合は、次を確認してください。

1. 同梱プリセット 4 定義(`agent-policy:gpt-sol` / `agent-policy:gpt-terra` / `agent-policy:gpt-luna` / `agent-policy:grok`)を廃止しました。これらを名指しで呼び出していた場合は動かなくなります。代わりに `agent-policy:setup-agents` を実行し、推奨構成を生成してください。非対話で推奨構成をまとめて作る場合は `/agent-policy:setup-agents --yes` を使えます。
2. 方針スキル `with-codex-policy` / `with-grok-policy` / `codex-grok-policy` を廃止しました。custom 構成の方針は `custom-policy` に統合されています。
3. `AMATSUKA_AGENT_AUTO_INJECTION` の旧値 `with-codex` / `with-grok` / `with-codex-grok` は custom として扱われるため、動作は継続します。ただし SessionStart は `custom` へ変更するよう通知します。環境変数を `custom` に更新してください。
4. エイリアス変数 `AMATSUKA_AGENT_GPT_SOL_ALIAS`、`AMATSUKA_AGENT_GPT_TERRA_ALIAS`、`AMATSUKA_AGENT_GPT_LUNA_ALIAS`、`AMATSUKA_AGENT_GROK_ALIAS` は参照されなくなりました。設定されている場合、SessionStart が非推奨を通知します。モデルは setup-agents が `/v1/models` の実応答から選ぶため、定義の `model` を変えたいときは setup-agents を再実行してください。
5. 以前の `claude-researcher.md`、`gpt-researcher.md`、`grok-researcher.md`、`grok-implementer.md` は廃止済みです。プロジェクトの `.claude/agents/` に残っていれば削除してください。SessionStart は残骸を検知すると通知します。
6. `setup-gpt` と `setup-grok` は `setup-agents` へ統合されています。0.14 系の setup-agents は custom プロファイル専用です。
7. MCP ツールは setup-agents で定義ごとに付与します。既定では付きません。`claude mcp list` で接続済みのサーバーを検出し、許可するものを選べます。
8. 役割定義から `LSP` を外しました。背景で起動するサブエージェントでは Claude Code が `LSP` を除去するため、定義に書いても機能しません。
9. `_common.md` の共通規律では、GitHub の名指しを「外部システムへの不可逆な副作用」という一般則へ変更しました。プロジェクト独自の制約が必要な場合は `.claude/agent-policy/roles/_common.md` の `## 制約` 節で差し替えられます。アドバイザーの相談先は担当表の「設計・計画・実装のアドバイザー」の役割の定義を優先し、無い場合は `model` 上書きで `Fable` を使います。
10. 役割マーカー(`agent-policy-role`)は、役割の委譲先候補に加え、外部 Agent を名指しで dispatch するときの合成ホスト候補も表します。合成ホストにしたくない定義からはマーカーを外してください。
11. setup が提案する既定の定義名は役割ベースです。旧版で生成した定義がある状態で、すべてのモデルを選び直すと役割が重複する場合があります。未カバーの役割だけを作るか、旧名の定義を先に整理してください。
12. SubagentStart フックは、サブエージェント起動時に役割マーカーの対応表を注入します。Claude Code 2.0.43 以降で動作します。
