# better-agentics 改修設計書: 役割ごとの起動モード、サブエージェントの文脈の作り直しを減らす策、codiel との整合

- 日付: 2026-11-10
- 対象: plugins/better-agentics
- バージョン: 現行は 0.0.2-dev。`-dev` のため、この改修では上げない(プロジェクトの運用。上げるときはユーザーに確かめる)
- 前提: 現行の設計書 `harness-docs/design/2026-10-26-better-agentics-design.md`(以下「現行の設計書」)、根拠の文書 `plugins/better-agentics/docs/rationale.md`、codiel との食い違いの文書 `harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md`(以下「食い違いの文書」)
- 行番号の出典: `SKILL.md` は `plugins/better-agentics/skills/orchestration/SKILL.md`、`subagent-policy.md` は `plugins/better-agentics/references/subagent-policy.md`、setup の `SKILL.md` は `plugins/better-agentics/skills/setup/SKILL.md` を指す(2026-11-10 時点)

## 0. 決まったこと

ユーザーと次を決めた。再検討しない。決定の出どころは次のとおりである。執筆者が決めた細部は 11 章にまとめる。

- D1・D3・D20 は、ユーザーが示した。
- D9 は、ユーザーが執筆者の提案を退けて決めた。
- D18・D19 は、執筆者が示した選択肢からユーザーが選んだ。
- 残りは、執筆者の提案をユーザーが採った。D6 の役割の限定は、ユーザーの求めによる。

| 番号 | 決定 |
| --- | --- |
| D1 | 委譲先はサブエージェント(Agent ツール)のままとする。バックグラウンドのメインセッション(`claude --bg`)へは委譲しない |
| D2 | 委譲している間も、オーケストレーターは自分の分担を進める。自分の分担が無く待つだけになる委譲は、長く機械的な作業に限る |
| D3 | 委譲の起動を、役割ごとに 2 つのモードで行う。プロジェクトにその役割の定義があれば **Custom Agent モード**(定義名で起動)、無ければ **Standard Agent モード**(`general-purpose` に model・effort・依頼文の前置きを付けて起動)とする |
| D4 | Standard Agent モードでは、役割の指示とサブエージェントの規律を依頼文の前置きで渡す。役割の定義をプラグインに同梱しない |
| D5 | 再レビューは、前の巡のレビュアーへ SendMessage で続きを頼む |
| D6 | fork は complex-impl・normal-impl・general の 3 役割に限り、役割のモデルが親のモデルと同じときだけ使う。fork の effort は親と同じになり、条件に含めない |
| D7 | 役割の指示の置き場所(システムプロンプトか依頼文か)を、性能の改善策として扱わない |
| D8 | setup で、役割ごとに `omitClaudeMd: true` を付けるかを選べるようにする。推奨は knowledge-elicitation だけに付けること |
| D9 | knowledge-elicitation は haiku / low のまま据え置く。medium では役割を果たせない |
| D10 | 役割の model・effort を黙って上書きする環境変数を、SessionStart で警告する |
| D11 | レビューの 5 役割(code-review・design-review・complex-review・adversarial-review・knowledge-elicitation)の定義に、1 時間のプロンプトキャッシュを付ける |
| D12 | 役割断片の Output Format に、結果が無いときの書き方を足す |
| D13 | split の理由の表から、規模の条件(「大きな作業を」)を外す。実装を委譲している間に、受け入れ検査を自分で書く規律を足す |
| D14 | レビュー中も編集を続けるときは、レビューの対象を依頼の時点で固定する |
| D15 | スキルやコマンドの手順が定めることは、手順に従う条項を足す |
| D16 | `pick-delegate` の委譲先 1 件の項目を、codiel の「委譲の指定」(`agentType`・`model`・`effort`・前置き)と同じにする |
| D17 | 食い違いの文書のうち、better-agentics 側の G3・G4・G5・G9・G10・G12 をこの改修で直す |
| D18 | 役割を委譲先の候補から外す手段を設ける。setup で「この役割を使わない」を選んだ役割は、プロジェクトの設定に記録し、`pick-delegate` の候補から外す |
| D19 | D2 は、並列化やコストのために作業を分担する split にだけ当てる。review・stuck・文脈の保護のための探索の委譲は、待つだけになってもよい |
| D20 | 外側の手順が、人の判断の代わりに Jev に判断させる仕組み(codiel の Auto Ask)を持つときは、運用方針が人の判断を求める場面も Jev が判断する。ただし、`pick-delegate` の失敗の原因が Jev(`no-api-key`・`jev-failed`)のときは例外とし、人に回す |

## 1. 背景: 委譲を役割ごとのモデルで行いながら、オーケストレーターを止めない

better-agentics では、オーケストレーターが調査・設計・実装を自分で行う。サブエージェントへ委譲するのは、review・split・stuck の 3 つの場面だけである。委譲先は、TypeSafe AI の判断モデル Jev が各定義の `## When to invoke` から選ぶ。

ユーザーは、agent-policy のように役割ごとにモデルと effort を当てた委譲で、コストを下げたい。ただし、agent-policy のように全部を委譲すると、委譲先が動いている間オーケストレーターが何もしなくなる。

最初は、委譲先をバックグラウンドのメインセッションにする案を検討した。サブエージェントより性能が落ちないと見込んだためである。しかし、codiel との衝突などの理由で採らなかった(12.2)。

そこで方向を切り替えた。委譲先はサブエージェントのままとする。そのうえで、サブエージェントが遅くなり質が落ちる原因を取り除く。公式ドキュメントが挙げる主な原因は、文脈の作り直しである(3 章)。fork でないサブエージェントは、毎回まっさらな状態から始まる。親と別のプロンプトキャッシュを、5 分の寿命で温め直す。

## 2. 目標・非目標・避けること

### 2.1 目標は、setup 無しで役割ごとに委譲でき、文脈の作り直しが減ること

この章の目標は、現行どおり `TYPESAFE_API_KEY` を設定した利用者に当てる。規律の注入の条件(`AMATSUKA_AGENT_ENABLE_ORCHESTRATION` とキー。`SKILL.md` の description)は変えない。

- setup で定義を作らなくても、外していない役割すべてへ、役割ごとのモデルで委譲できる(D3・D18)。effort も役割ごとに渡す。effort が届くことは 13 章の S1 で確かめる。
- 定義を作った役割は、その定義で起動する。利用者が定義を編集して調整できる状態を保つ(D3)。
- 文脈の作り直しを減らす。
  - 再レビューは、前の巡のレビュアーを再開する(D5)。
  - 文脈が要る split は、fork に委譲する(D6)。
  - Custom Agent モードのレビュアーは、キャッシュの寿命を 1 時間にする(D11)。
  - CLAUDE.md の要らない役割には、CLAUDE.md を読ませない(D8)。
- split で委譲している間も、オーケストレーターが自分の分担を進める(D2・D13・D19)。
- codiel 1.1〜2.0 の run の中で、better-agentics の規律が codiel の手順とぶつからない(D15・D17)。

### 2.2 非目標

- バックグラウンドのメインセッションへの委譲と、それに伴う worktree の隔離。
- agent-policy の改修。食い違いの文書の agent-policy 側の項目は扱わない。
- codiel の改修。codiel は委譲先を決める手順を書かない(codiel 1.1 の D1、1.2 の D14)。codiel の作業に委譲先を当てるときの決め方は、better-agentics の規律が持つ(5.1)。
- 他のプラグインが委譲先へ注入する文の削減。このリポジトリでは約 26KB あるが、プロジェクトの構成の判断である(3.3)。
- `TYPESAFE_API_KEY` が無いときの代替経路。現行の設計書の非スコープを引き継ぐ。

### 2.3 避けること

- split で委譲している間に、オーケストレーターが自分の分担を持たずに待つこと(長く機械的な作業を除く)。
- 委譲先の選択基準(`## When to invoke`)が、オーケストレーターの文脈に入ること。
- レビュアーが、オーケストレーターの結論を受け取ること。fork をレビューに使うと、これが起きる。
- 環境変数や設定によって、役割の model・effort・キャッシュの寿命が利用者の気づかないうちに上書きされること。fork が親の effort で動くことは、4.5 で仕様として定め、README で利用者に知らせる。

## 3. 前提として確かめた事実

### 3.1 Claude Code の仕様(2.1.321)

| 事項 | 内容 | 出典 |
| --- | --- | --- |
| Agent ツールの引数 | `subagent_type`・`model`(`sonnet` / `opus` / `haiku` / `fable`)・`effort`・`run_in_background` を受ける | このセッションの Agent ツールの定義 |
| fork のモデルと effort | `subagent_type: "fork"` では `model` も `effort` も無視され、親のモデルと effort で動く | このセッションの Agent ツールの定義。sub-agents の "How forks differ"(モデルが親と同じ) |
| fork の文脈とコスト | 会話の履歴をすべて受け取る。システムプロンプト・ツール・モデルは親と同じで、プロンプトキャッシュを親と共有する。公式は「同じ文脈が要る作業では、新しいサブエージェントより安い」と書く。fork はさらに fork を作れない | sub-agents の "How forks differ" |
| fork モード | v2.1.302 以降は既定で有効。`CLAUDE_CODE_FORK_SUBAGENT=0` か、`permissions.deny` の `Agent(fork)` で止まる。有効な間、対話のターミナル・VS Code・デスクトップのセッションでは、Claude はサブエージェントの完了を待てない。サブエージェントはバックグラウンドで動き、完了は通知で届く | sub-agents の "Turn fork mode off" と "Which subagents run in the background"、env-vars の `CLAUDE_CODE_FORK_SUBAGENT` |
| `general-purpose` のツール | 全ツールを持つ(Agent・Skill を含む) | このセッションのエージェントの一覧 |
| 呼び出しごとの effort | `effort` 引数は定義の `effort` に勝ち、再開しても保たれる。`CLAUDE_CODE_EFFORT_LEVEL` は両方に勝つ。値には `auto`・`unset`(effort を送らない)もある。`maxEffortLevel` と組織の上限は、どちらにも上限をかける。v2.1.292 以上 | sub-agents の "Choose an effort level"、model-config の "Set the effort level" と "Send no effort level"、env-vars |
| モデルの一括指定 | `CLAUDE_CODE_SUBAGENT_MODEL` は既定値にすぎず、定義や呼び出しの `model` が勝つ。`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` を付けると、全サブエージェントに強制される | sub-agents の "Run every subagent on one model" |
| 使えないモデル | `availableModels` が塞ぐモデルを定義や呼び出しで指定すると、別のモデルに置き換わる。エラーにはならず、対話セッションでは利用者に警告が出る | sub-agents の "Choose a model" |
| 再開 | 完了したサブエージェントへ SendMessage すると、ツール呼び出しと推論を含む履歴を保って再開し、前の実行で温めたキャッシュを読める。Explore と Plan は再開できない。再開で SubagentStart は発火するが、同じ文は再注入されない | sub-agents の "Resume subagents"、hooks の "SubagentStart" |
| サブエージェントのキャッシュ | 既定の寿命は 5 分。定義の `experimental.cacheTtl: 1h`(v2.1.248 以上)で 1 時間にできる。この指定はファイルの定義だけで読まれ、`--agents` の JSON では無視される。`FORCE_PROMPT_CACHING_5M`・`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`・設定の `subagentPromptCacheTtl` が、frontmatter より優先される。サブスクリプションの使用クレジットを消費している間は、1 時間の指定が無視される | sub-agents、prompt-caching の "Choose the TTL yourself"、settings-reference |
| キャッシュの料金 | API の料金で、5 分のキャッシュの書き込みは基本の入力単価の 1.25 倍、1 時間の書き込みは 2 倍、読み出しは 0.1 倍である(モデルごとの例外は脚注にある) | platform.claude.com の prompt caching の "Pricing" |
| 保護パス | `.git` と `.claude` への書き込みは、`default`・`acceptEdits` では確認が出て、`auto` では分類器に回り、`dontAsk` では拒否される。Bash の出力のリダイレクトも検査の対象になる | permission-modes の "Protected paths"、permissions の "Output redirects" |
| `omitClaudeMd` | frontmatter でも `--agents` の JSON でも効く。v2.1.271 以上 | sub-agents の "Supported frontmatter fields" |
| 起動時に読むもの | 定義の本文・依頼文・CLAUDE.md の全階層・git status・`skills` で指定したスキル。Explore と Plan は CLAUDE.md と git status を読まない | sub-agents の "What loads at startup" |

### 3.2 `omitClaudeMd` で外れるもの(2026-11-10 に試験で確かめた)

スクラッチパッドに仕込み文字列を置いた git リポジトリを作った。`claude -p`(2.1.321)の `--agents` で 2 つの定義を作り、`omitClaudeMd` の有無で比べた。AGENTS.md は、CLAUDE.md があると既定では読まれないので、AGENTS.md だけのリポジトリで別に試した。

| 読み込み元 | 通常の定義 | `omitClaudeMd: true` |
| --- | --- | --- |
| プロジェクトの CLAUDE.md・CLAUDE.local.md | 読む | 外れる |
| プロジェクトの `.claude/rules/`(`paths` 無し) | 読む | 外れる |
| ユーザーの `~/.claude/rules/` | 読む | 外れる |
| AGENTS.md(CLAUDE.md の無いリポジトリ) | 読む | 外れる |
| `paths` 付きの rules | 対象のファイルに触れたときに読む | 対象のファイルに触れたときに読む |
| SubagentStart の hook の注入 | 届く | 届く |

### 3.3 このリポジトリで測った起動時の負荷

各 hook のコマンドを、サンプルの入力 JSON を標準入力に渡して実行し、出力の大きさと所要時間を測った。

- SubagentStart の hook 3 本の出力は、合わせて約 26KB ある。内訳は metatron が 9,164B、native-japanese が 13,936B、better-agentics が 2,779B である。
- CLAUDE.md と `.claude/rules/` は、合わせて約 8KB ある。
- Edit 1 回で動く PreToolUse・PostToolUse の hook は、1 本あたり 36〜50ms だった。遅さの主因ではない。
- `tools` を Read だけに絞ったサブエージェントにも、MCP サーバーの使い方の説明(Claude Docs と Figma)が届いていた(3.2 の試験での観測。仕組みは確かめていない)。

### 3.4 現行の実装(2026-11-10 時点)

- `pick-delegate` の候補は、`<projectDir>/.claude/agents/*.md` のうち `better-agentics-role` を持つ定義だけである(`src/lib/agents.ts:143`、`:162-163`)。理由に当たる定義が 0 件なら `no-candidates`(`src/lib/pick.ts:120-128`)、候補が 1 件なら Jev を呼ばない(`:256-259`、`:294-301`)。全員の確率が 0.5 未満の review は、最も高い 1 人を `fallback: true` で返す(`:272-286`)。
- Jev に渡す基準は、定義本文の `## When to invoke` である(`src/lib/agents.ts:180`)。同梱の断片の `## When to invoke` は、ja と en で同じ英文である。`src/lib/fragments.ts` の `loadFragments` がこれを読める。
- 役割断片の frontmatter は、`id`・`label`・`description`・`default-name`・`tools`・`kind` を持つ(`src/lib/fragments.ts:115-136`)。
- 出力の委譲先は `{agent, role, p?}` で(`src/lib/pick.ts:12-16`)、`agent` は定義の `name` である。リポジトリの中で `pick-delegate` を呼ぶのは better-agentics の `SKILL.md` だけである。
- setup が書く frontmatter は、`name`・`description`・`model`・`effort`・`tools`・`disallowedTools`・`better-agentics-role`・`better-agentics-hash` である(`src/lib/compose.ts:66-80`)。
- 再生成では、`GENERATED_KEYS`(`src/lib/regenerate.ts:34-43`)以外の既存キーを保つ(`:173-179`)。再生成の読み書き(`src/lib/document.ts:24-37`、`:71`)は、字下げ行をブロック値として丸ごと保つので、`experimental:` の入れ子もそのまま書き戻せる。走査側(`src/lib/agents.ts:36-61`)は字下げ行を最上位のキーとして読むが、使わないキーなので害は無い。
- setup の `--list-coverage` は、定義の無い役割を `uncovered` として返す(`src/setup.ts:225-227`)。モデルの質問は、ステップ 6 では `uncovered` の役割に、ステップ 7 では `model` が 4 つの別名のどれでもない定義にだけ出る(setup の `SKILL.md:143-148`、`:185`)。
- SubagentStart は、`agent_type` と定義の `name` が一致したときだけ規律を注入する(`src/hooks/subagent-start.ts:21`)。
- 翻訳断片は、`source-hash` が同梱の断片と合わないと stale になる(`src/lib/fragments.ts:267-272`)。stale があると、setup の `--check` と `--write` は止まる(`src/setup.ts:418-423`)。

## 4. 委譲先の決め方と起動の形(`pick-delegate`)

### 4.1 入力に、親のモデル・会話の言語・文脈の要否を足す

既存の入力に、次の任意の項目を足す。

| 項目 | 置き場所 | 値 | 使い道 |
| --- | --- | --- | --- |
| `parentModel` | 最上位 | `fable` / `opus` / `sonnet` / `haiku` | fork の条件の判定(4.5) |
| `lang` | 最上位 | 言語コード。既定は `en` | Standard Agent モードの前置きの言語(4.6) |
| `needsContext` | split の各 `tasks[]` | 真偽値。既定は偽 | fork の条件の判定(4.5) |
| `excludeRoles` | 最上位 | 役割 ID の配列。既定は空。役割表に無い ID があれば `invalid-input` | その呼び出しだけ候補から外す役割。断られた作業の選び直しに使う(5.1) |

- オーケストレーターは、システムプロンプトの環境の欄にある自分のモデル名から、`parentModel` に別名を書く。
- `needsContext` は、会話の文脈が無いと仕様を書き切れない作業に付ける。

### 4.2 候補は、外していない全役割とし、定義の有無で基準の出どころを変える

- 理由に当たる役割(`src/lib/roles.ts` の `ROLES` の `reason`)のうち、プロジェクトの設定で外していない役割をすべて候補にする(D18。設定は 7.3)。
- 役割ごとに、`better-agentics-role` でその役割を持つ定義があれば Custom Agent モードの候補にし、基準は定義の `## When to invoke` を使う。
- 定義が無ければ Standard Agent モードの候補にし、基準は同梱の断片の `## When to invoke` を使う。
- 同じ役割を 2 件以上の定義が持つときは、現行どおり `duplicate-role` を返す。
- `excludeRoles` に入れた役割も、その呼び出しの候補から外す。
- 設定と `excludeRoles` で理由に当たる役割をすべて外したときは、`no-candidates` を返す。
- 外した役割に定義があっても、外す設定を優先する。SessionStart がこの食い違いを知らせる(8.1)。
- 設定ファイルがあるのに読めないとき、または `disabledRoles` の形が違うときは、新しいエラー `invalid-config` を返す(11 章の J23)。外した役割が黙って候補に戻らないようにするためである。

### 4.3 Jev への問い方は現行の形を保つ

- 問いの形は、現行の設計書 7-3 と現行の実装(3.4)のとおりとする。review は候補ごとに真偽の確率(`noul`)、split は作業ごとに選択肢(`choice`)で問う。全員の確率が 0.5 未満の review は、最も高い 1 人を `fallback: true` で返す。
- 選択肢の鍵は、定義の名前ではなく役割 ID に揃える(J1)。
- 外していない候補が 2 つ以上あれば、Jev を呼ぶ。外さなければ review は 5 候補、split は 7 候補になる。キーが無ければ `no-api-key` を返す。
- stuck の役割は escalation の 1 つだけなので、現行どおり Jev を呼ばずに返す。

### 4.4 出力の委譲先は、codiel の「委譲の指定」と同じ項目で返す

codiel 1.2 の設計書 3.4(280 行)は、委譲の指定を「Agent ツールで起動するときと同じ `agentType`・`model`・`effort` に、依頼文の前置きの文を加えたもの」と定める。委譲先 1 件を、これと同じ項目に役割とモードを足した形で返す。値は例示で、実際の内容に置き換わる。

```json
{"role": "normal-impl", "mode": "standard", "agentType": "general-purpose", "model": "sonnet", "effort": "medium", "preamble": "<前置き>", "p": 0.82}
```

| `mode` | `agentType` | `model`・`effort` | `preamble` |
| --- | --- | --- | --- |
| `custom` | 定義の `name` | 返さない。渡すと定義の frontmatter を上書きするため | 返さない。規律は SubagentStart が注入する(13 章の S6 の結果で変わりうる) |
| `standard` | `general-purpose` | `roles.ts` の推奨値 | 役割の指示とサブエージェントの規律(4.6) |
| `fork` | `fork` | 返さない。fork は無視する | fork の担い手としての指示・役割の Output Format・サブエージェントの規律(4.6) |
| `self` | 返さない | 返さない | 返さない。委譲せず、オーケストレーターが自分で行うことを示す(4.5)。`role`・`p` も返さない |

- review は `{ok, reason, agents: [委譲先...], fallback?}`、split は `{ok, reason, assignments: [{id, ...委譲先}]}`、stuck は `{ok, reason, agents: [委譲先]}` とする。
- 現行の `agent` は `agentType` に名前を変える。
- オーケストレーターは、`agentType` を Agent ツールの `subagent_type` に、`model`・`effort` を同名の引数に渡す。`preamble` は依頼文の冒頭に置く。
- codiel の Workflow の `args` へ渡すときに使う項目は、`agentType`・`model`・`effort`・`preamble` である。`role`・`mode`・`p` は渡さない。前置きの英字の項目名は codiel の設計書に無いので、`preamble` を codiel の実装へ伝える(9.2)。

### 4.5 fork は条件をすべて満たすときだけ返す

D6 の「役割のモデルが親と同じ」に、執筆者が 4 つの条件を足した(J4〜J7)。

- 理由が `split` である。
- その作業に `needsContext: true` が付いている。
- Jev が選んだ役割が、complex-impl・normal-impl・general のどれかである。
- その役割のモデルが `parentModel` と同じである。
  - Custom Agent モードでは、定義の `model` を見る。`model` が 4 つの別名のどれかで、`parentModel` と同じときだけ一致とみなす。`inherit`・未設定・完全なモデル ID は一致とみなさない。
  - Standard Agent モードでは、`roles.ts` の推奨値を見る。
- `CLAUDE_CODE_FORK_SUBAGENT` が `0` でない。

`needsContext: true` の作業で条件を満たさないときは、`mode: "self"` を返す(J27)。文脈が無いと仕様を書き切れない作業なので、fork 以外の委譲先には渡せないためである。Jev を呼ぶ前に決まる条件(`parentModel` が無い、`CLAUDE_CODE_FORK_SUBAGENT=0`)を満たさない作業は、Jev の問いから外して `self` を返す。外側の手順へ渡す作業には `needsContext` を付けない(J7)ので、外側の手順が `self` を受け取ることは無い。`needsContext` の無い作業は、選ばれた役割の Custom Agent モードか Standard Agent モードで返す。役割を絞る理由は次のとおりである。

| 役割 | fork を使わない理由 |
| --- | --- |
| レビューの 5 役割 | fork はオーケストレーターの結論まで引き継ぐ。レビュアーに自分の結論を渡さない規律に反する |
| escalation | 行き詰まりには、別の目と上位のモデル(fable / high)が要る。fork は親と同じ見落としを引き継ぐ |
| explore・realtime-research・e2e-verify | 会話の履歴が要らない。安いモデルで新しく起動するほうが合う |
| light-impl | haiku で済む機械的な作業で、親のモデルでは過剰になる |

- fork は、親の effort で動く。これは仕様であり、役割の推奨 effort は使われない。effort を条件に含めないのは、オーケストレーターが自分の effort を確実には知れないためである。README で利用者に知らせる(9.2)。
- モデルが同じなら、fork はキャッシュを共有するぶん安い(3.1)。
- 定義のある役割でも fork が返りうる。fork は定義の `tools` と本文を通らない。文脈を引き継ぐ代わりに、定義による調整は効かない。
- 親が fable のときは、3 役割の推奨モデル(opus・sonnet・sonnet)と一致しないので、Standard Agent モードの役割に fork は返らない。

### 4.6 前置きは `pick-delegate` が組み立てる

- Standard Agent モードの前置きは、次をこの順でつなぐ。
  - `_common.md` の Preamble。`{{NAME}}` には断片の frontmatter の `default-name`(例: code-reviewer)、`{{ROLE_LABEL}}` には `label` を入れる(J3)
  - 役割断片の `## When to invoke` 以外のセクション(責務・手順・制約・Output Format)
  - `references/subagent-policy.md`
- fork の前置きは、次の 3 つをつなぐ。
  - 「split の分担を担う担い手として、依頼文の作業だけを行う。会話の履歴にあるオーケストレーターの規律のうち、委譲と `pick-delegate` に関するものは当てない」という指示
  - 選ばれた役割の断片の Output Format(J5)
  - `references/subagent-policy.md`
- 言語は `lang` で選ぶ。
  - ja と en は、同梱の断片を使う。
  - それ以外の言語は、setup が作った翻訳断片が stale でなければそれを使い、無いか stale なら en を使う(J19)。
  - `subagent-policy.md` は ja しか無いので、どの言語でも ja の規律をつなぐ(現行の SubagentStart と同じ)。
- 前置きに `## When to invoke` を含めない。オーケストレーターは前置きを依頼文へ写すので、含めると選択基準がオーケストレーターの文脈に入る。
- 前置きの渡し方は、13 章の S2 の結果で決める(J2)。
  - 既定は、前置きの全文を本文で返す形とする。
  - 全文を返す形では、前置きは 1 件あたり約 3.5〜4.7KB になる。Standard Agent モードのレビュアーが 5 人選ばれると、オーケストレーターは 1 回で約 20KB を書き写す。
  - S2 で次の 3 つがすべて確かめられたら、ファイルを指す形に切り替える。
    - 委譲先がプラグインの中のファイルを、許可の確認なしに読める。
    - 委譲先が、1 行の指示に従って最初に読む。
    - 委譲先が、読んだ規律に従う。
  - ファイルを指す形では、ビルド時に、ja と en の役割ごとの前置きのファイルをプラグインの中に作る。`pick-delegate` は実行時に自分の置き場所からそのファイルの絶対パスを組み立て、「最初に <絶対パス> を Read で読み、その役割と規律に従う」の 1 行を返す。ja・en 以外の言語は、全文を返す形のままにする。

## 5. 外側の手順に従う条項(D15・D17)

### 5.1 「外側の手順」の範囲と、置き換わる規律

- 「外側の手順」は、better-agentics の外のスキルやコマンドが定める手順を指す。オーケストレーターがそのスキルやコマンドに従って作業している間に当てる。better-agentics の `SKILL.md` 自身の手順は含まない。
- better-agentics の規律では、codiel に言及しない(ユーザーの方針。ARCHITECTURE の指示層・参照層の規則とも合う)。
  - 対象は、`SKILL.md`・setup の `SKILL.md`・`subagent-policy.md`・役割断片と、`pick-delegate` が組み立てる前置きである。
  - codiel の名前も、codiel 固有の語(`declined`・`wait-add`・run・codiel のフェーズの名前など)も書かない。「このスキルの外のスキルやコマンドの手順」と書く。
  - この設計書の中の codiel への言及は、規律を決めた根拠と、codiel の設計書との照合のために書いたものである。規律の文面には写さない。
- 外側の手順が次の表の事項を定めているときは、外側の手順に従い、表の右の現行の規律を当てない。外側の手順が定めていない事項には、現行の規律を当てる。

| 外側の手順が定める事項 | 当てなくなる現行の規律 | 食い違い |
| --- | --- | --- |
| 委譲するかどうか、委譲する単位、委譲先に任せる判断 | `SKILL.md:12-18` の 3 つの理由に限る規定。`:108-109` の「追加の判断なしに進められない部分は切り出さない」「全体の設計判断は手元に残す」。6.1 の D2・D19 の規律 | G12 |
| 並列に進める範囲と条件 | `:114-118` の並列のグループの条件。`:127-128` の並列中の検査の制限 | G10 |
| レビューの時点と方法 | `:55-66` の必須の時点と、コードレビューを省ける条件。外側の手順のレビューを、必須のレビューを満たすものとして扱う | G5 |
| 人への聞き方と報告の仕方(人の判断の代わりに別の仕組みで判断する定めを含む) | `:21-22` の「`ok: false` をユーザーへ報告して指示を待つ」。`:79` と `:81` の `AskUserQuestion` と、2 巡後にユーザーへ判断を仰ぐ規定。6.2 の起動の失敗の報告 | G4・G9 |
| 委譲先の渡し方(委譲の指定をスクリプトへ渡す、1 件だけ受け取る) | `:76` の「複数のレビュアーを全員並列に起動する」 | G3 |
| スキルの渡し方 | `:148-149` のスキルの名指しと書き写し | G3 |
| 委譲している間にオーケストレーターが行うこと、テストを書く時点 | 6.4 の、実装を委譲している間に受け入れ検査を並行して書く規律(D13 の後半) | 新規。codiel はテストを先に書くフェーズを持ち、実装のフェーズではテストを hook で保護する(`plugins/codiel/src/hooks/guard-write.ts:39-43`) |
| 委譲先の出力の形(書く出力ファイル・戻り値の形) | `:146` の「Output Format を依頼文で指定し直さない」 | 新規。codiel の契約は、出力ファイルと戻り値のスキーマを定める(codiel 1.2 の 3.4) |

- 外側の手順のスクリプトが、作業の単位ごとに委譲の指定を受け取れるときは、作業の種類で `reason` を選んで `pick-delegate` を呼ぶ(J25)。レビューの作業は `review`、行き詰まった作業の打開は `stuck`、それ以外の作業(実装・設計・修正・テストなど)は `split` とする。
- 外側の手順が、断られた作業の委譲の指定を選び直すよう求めたら、断った役割を `excludeRoles`(4.1)に入れて `pick-delegate` を呼び直す(J26)。人が委譲の指定を示したときは、それを使う。
- 選び直しに備えて、委譲の指定を外側の手順へ渡すときに、返った `role` を外側の手順の記録か自分の作業の記録に控える。Custom Agent モードの `agentType` は定義の名前で、役割 ID ではないためである。
- 外側の手順が委譲先を 1 件だけ受け取るときは、返った委譲先のうち `p` が最も高いものを渡す(J8)。
- 外側の手順のスクリプトへ渡す作業には、`needsContext` を付けない。fork は親の会話を前提にするので、スクリプトが起動するエージェントには渡せない(J7)。
- `ok: false` が返ったときに外側の手順が人への聞き方を定めていなければ、現行どおりユーザーへ報告して指示を待つ。人のいないセッションでは、ここで止まりうる。運用方針が人の判断を求めたときの扱いは、外側の手順の側で定める。
- 外側の手順が、人の判断の代わりに別の仕組みで判断すると定めていれば、その判断に従う。codiel では、Auto Ask が有効なら、運用方針が人の判断を求めたときも Jev が判断する(D20)。codiel 2.0 の 4.6 と 5.1 は、この向きに改められた(コミット fcf312be)。
- ただし、`pick-delegate` の失敗の原因が Jev そのもの(`no-api-key`・`jev-failed`)のときは例外とし、Jev に判断させずに人に回す(D20)。`pick-delegate` と外側の手順の Jev は同じキーを使うので、一緒に使えなくなりうるためである。
  - この例外は `SKILL.md` に書き、外側の手順の定めより優先する。文面は「`no-api-key`・`jev-failed` の失敗は、外側の手順が人の判断に代わる仕組みを定めていても、その仕組みに回さず人に回す」の形にする。
  - better-agentics は `ok: false` の報告にエラーの種別を添える(`SKILL.md:21`)ので、外側の手順もこの種別で例外を見分けられる。codiel 2.0 の 5.1 は、この種別で見分ける(fcf312be)。
- 残りの失敗(`no-candidates`・`duplicate-role`・`invalid-config`・`invalid-input`)は、設定や入力の誤りで、呼び直しても直らない。人の判断に代わる仕組みで判断するときに意味のある選択肢は、「委譲せずに続ける」と「止める」である。選択肢の組み立ては外側の手順が行う。

### 5.2 サブエージェントの規律(`subagent-policy.md`)に足す G3 の条項

- 依頼文が作業として明示した外部への操作(push・PR の作成・Issue の起票など)は、外部への副作用の禁止(`:27`)の例外とする。
- 依頼文が、行う作業と書いてよい範囲を列挙しているときは、役割の範囲(`:18`)よりその列挙を優先する(J16)。
- 依頼文が出力の形(書く出力ファイル・戻り値の形)を定めているときは、役割の Output Format より依頼文に従う(J28)。
- 役割断片の「引き受けない」「差し戻す」の条項は、この優先の対象に入れない。断片の制約は書き換えず、依頼文が列挙していても効かせる(J16)。
  - 例: `assets/roles/ja/light-impl.md` の制約。判断・設計・複雑な読解の作業を断る。hooks・規約が手順を定めるパス・データ移行の変更も断る。
  - 例: 実装の 4 役割の「構造が変わる判断の差し戻し」。
  - これらは、安いモデルの委譲先が担えない作業を断るための安全弁である。外側の手順の作業が断られたときは、外側の手順が定める「断られたとき」の経路に乗る。codiel では、この経路は `declined` である(根拠の説明であり、規律の文面には写さない)。
- 冒頭の役割の決め方(`:3`)を、「依頼文の冒頭に役割の指定があればそれに従う。無ければ、定義本文か前置きに書かれた役割で作業する」に改める(J15)。外側の手順の前置きは任意で、役割の指定が依頼文に入る保証が無いためである(食い違いの文書の 5 章)。
- 依頼文が委譲を指示したときを除き、Agent ツールでさらに委譲しない。必要なら差し戻す(J13)。Standard Agent モードと fork の委譲先は Agent ツールを持つので、規律で止める。

## 6. オーケストレーターの規律(`SKILL.md`)

### 6.1 委譲の場面: split の規模の条件を外し、待つだけの委譲を限る

- 理由の表の split(`:17`)を、「作業の一部を委譲先に進めさせるとき」に改める(D13)。分担の範囲は、現行どおり「並列化」と「文脈の保護」の 2 つである(`:98-103`)。D13 が外すのは、この表の「大きな作業を」だけである。
- 着手前の見積もり(`:85-96`)は、split を大きな作業に限る条件ではない。大きな探索を自分で始めずに委譲させる義務なので、変えない。
- 並列化やコストのために分担する split では、自分の分担が無く待つだけになる委譲を、長く機械的な作業(多数のファイルへの一括変更など)に限る(D2・D19)。
- review・stuck と、文脈の保護のための探索の split(`:103`。着手前の見積もりで委譲するものを含む)は、待つだけになってもよい(D19)。

### 6.2 `pick-delegate` の呼び方と起動

- 入力に、`parentModel`(4.1)と `lang`(会話の言語)を付ける。
- 会話の文脈が無いと仕様を書き切れない split の作業には、`needsContext: true` を付ける。
- 断られた作業の委譲先を選び直すときは、断った役割を `excludeRoles` に入れる(5.1、J26)。
- 出力の委譲先を、4.4 の対応で Agent ツールの引数へ写す。
  - `preamble` があれば、依頼文の冒頭にそのまま置く。
  - `mode: custom` の委譲先には、`model` と `effort` を渡さない。
- 委譲先はバックグラウンドで起動する(J21)。fork モードが有効な対話セッションでは、完了を待つ起動ができない(3.1)。`claude -p` での扱いは 13 章の S10 で確かめる。
- 待つだけでよい場面(D19)では、ターンを終えて完了の通知を待つ。通知で始まる次のターンで、委譲先の結果を読む。review なら、そのターンで指摘の採否を決めてから、ユーザーへの提示(`:57`)やコミット(`:58`)へ進む。
- 委譲先の起動がエラーになったときは、別のモデルで起動し直さず、エラーを報告する(J20)。報告では、その役割を setup で外すか、別のモデルで定義を作るよう案内する。報告の仕方は、外側の手順が人への聞き方を定めていればそれに従う(5.1)。
- `pick-delegate` のエラーの表(`:45-51`)を改める。
  - `no-candidates` の説明を、「理由に当たる役割をすべて外している」にする。
  - `invalid-config`(4.2)を足す。

### 6.3 review: 対象を依頼の時点で固定し、再レビューは同じレビュアーを再開する

- レビューを依頼した後も自分の編集を続けるときは、依頼の時点の作業ツリーをスナップショットのコミットとして固定する(D14、J14)。
  - スナップショットのコミットは、どのブランチにも載せない。本物のインデックスと作業ツリーにも触れない。未追跡の新しいファイルも含める。
  - 作り方の例は、一時インデックスで `git add -A` し、`git write-tree` と `git commit-tree -p HEAD` でコミットを作る方法である。
  - レビュアーには、`git diff <スナップショット>^ <スナップショット>` のコマンドを渡す。基準を親のコミットで固定するので、レビュー中にオーケストレーターがコミットしても対象が動かない。worktree の中でも同じ手順で動く。
  - Edit・Write のツールと出力のリダイレクトを使わないので、保護パスの検査には当たらないと推定する。git が `.git` の下に書くことが検査に当たるかと、許可の確認が出るかは、13 章の S8 で確かめる。
  - S8 で確認が出ると分かった環境では、スナップショットを作らない。代わりに、レビュー中はレビューの対象のファイルを編集せず、対象を依頼の時点の状態のまま固定する(文書のレビューと同じ扱い)。`SKILL.md` に書く切り替えの条件(許可モードの別、作成が拒否されたときなど)は、S8 の結果を受けて実装計画で決める。
- 文書のレビューでは、レビュー中にその文書を編集しない(J22)。文書はパスで渡すので、編集すると対象が動く。
- 編集を続けないときは、現行どおり差分を取るコマンドを渡す。
- 再レビューは、前の巡のレビュアーへ SendMessage で続きを頼む(D5)。送るのは、直した後の差分の取り方と満たすべき要件だけとし、自分の反論や結論は送らない。
- 再開できなかったときは、前の巡と同じ委譲の指定で新しく起動する。どちらの場合も `pick-delegate` は呼ばない。巡の数は、同じレビュアーの組ごとに数える(現行の `:78`)。

### 6.4 split: 受け入れ検査を並行して書き、文脈が要る部分は fork か自分で行う

- 実装を委譲したら、委譲先が動いている間に、その変更の受け入れ検査(テストや確認の手順)を自分で書く(D13)。
  - 自分が書くテストのファイルは、委譲先の書き込み範囲から外して依頼文に書く(J18)。
  - 依頼文で委譲先にテストも書かせる部分には、並行の検査を書かない。
- 仕様を書き切れない部分は、`needsContext: true` を付けて `pick-delegate` に渡す。
  - `mode: fork` が返れば、fork に委譲する。
  - `mode: self` が返ったら、その作業は委譲せず、現行どおり自分で行う(`:108`)。
  - fork の起動が拒否されたとき(`permissions.deny` の `Agent(fork)` など)も、自分で行う(J6)。
- 並列のグループの条件と、並列中の検査の制限(`:114-118`、`:127-128`)は、外側の手順が定めていない限り現行どおりとする。

### 6.5 依頼文: 前置きが返ったときだけ規律と役割を依頼文に載せる

- `:143`「冒頭に、担わせる役割を書く」と `:145`「規律は自動で注入されるので書かない」を、次のように改める。
  - `preamble` が返ったら、依頼文の冒頭に置く。前置きが役割を名乗るので、役割を別に書かない。
  - `preamble` が返らないとき(Custom Agent モード)は、現行どおり冒頭に役割を書き、規律は書かない。
- `:146` の Output Format を、「Custom Agent モードでは定義本文に、Standard Agent モードと fork では前置きにあるので、依頼文で指定し直さない」に改める。外側の手順が出力の形を定めるときは、この規律を当てない(5.1)。
- `:148` のスキルの名指しの条件に、「Standard Agent モードと fork の委譲先は Skill を持つ」を足す(3.1)。

## 7. setup と生成する定義

### 7.1 setup は任意の手順になり、役割の使い方を決めるステップを持つ

- setup は、委譲を使うための必須の手順ではなくなる。調整したい役割の定義を作る手順と、役割を外す手順になる。
- ステップ 2(既存定義の点検)とステップ 3(被覆の確認)の間に、「外す役割の見直し」のステップを足す(J24)。
  - 13 役割の一覧を、役割ごとの状態(定義あり・Standard Agent モード・外している)とともに `AskUserQuestion` の中に入れる。setup の規律(setup の `SKILL.md:44-47`)に従い、一覧を質問の外の本文に置かない。`question` に入れるか各選択肢の `preview` に入れるかは、同じ規律の表の長さの決まり(`:45`)に従う。
  - 選択肢は「変えない(推奨)」「すべて使う」とし、外す役割は自由入力(Other)で受け取る。
  - 自由入力には、外す役割の全体を役割 ID のカンマ区切りで書く。入力は今の設定を置き換える。一部だけ戻すときは、外したままにする役割だけを書く。
  - 役割表に無い ID が入っていたら、その ID を示して聞き直す。
  - 定義のある役割も外せる。外した役割の定義は消さず、ステップ 8 の報告で「定義はあるが外している」と伝える。
  - このステップの答えが決まった時点で、設定ファイル(7.3)を書く。後のステップで中止しても、設定ファイルは残る。
- モデルの質問の「この役割は作らない」(setup の `SKILL.md:145-148`)を、「定義を作らず、Standard Agent モードに任せる」に改める。役割を外すのは、上の見直しのステップだけで行う。選択肢の数は、現行の上限(4)を超えない。
- `--list-coverage` は、外した役割を `uncovered` に入れず、別の欄で返す。ステップ 3 の「未カバーの役割だけ作る」で、外した役割を聞き直さないためである。
- 外す役割が 0 件でも、空の `disabledRoles` を書く。
- 理由に当たる役割をすべて外す選び方(例: review の 5 役割すべて)をしたときは、`AskUserQuestion` で「このまま外す」「選び直す」を聞く。質問には、必須のレビューが `no-candidates` で止まることを書く。

### 7.2 生成する frontmatter に `omitClaudeMd` と `experimental` を足す

2 つのキーは `GENERATED_KEYS` に入れない。再生成で、利用者が手で書いた値を黙って消さないためである。次の規則で読み書きする(J12)。

- `omitClaudeMd`
  - 新規生成(setup のステップ 6)では、役割ごとに付けるかを聞く(D8)。
  - 再生成(ステップ 7)と取り込みでは、既存の値を既定にして聞く。
  - 聞き方: `AskUserQuestion` で「付けない」「付ける」を出す。推奨の側を先頭に置いて「(推奨)」を付ける。推奨は、knowledge-elicitation では「付ける」、それ以外では「付けない」とする。既存の値があるときは、既存の値の側を先頭に置く。
  - 選択肢の説明には、規約・保護パス・ユーザーの rules も届かなくなることを書く。
  - 「付ける」なら `omitClaudeMd: true` を書く。「付けない」なら、既存の `omitClaudeMd` の行を消す。
- `experimental:` の下の `cacheTtl: 1h`
  - レビューの 5 役割では、聞かずに `cacheTtl` だけを書き込む(D11)。既存の `experimental` の他の下位キーは残す。
  - レビュー以外の役割では、`experimental` に触れない。
- ステップ 8 の報告に、2 つのキーを書き込んだ・書き換えた・消した定義を載せる。
- 書き込み側は、`src/lib/document.ts` の字下げ行のブロック値の扱いを使う(3.4)。`experimental` の中の `cacheTtl` だけを書き換える処理と、`omitClaudeMd` の行を消す処理を足す。

### 7.3 外した役割は、プロジェクトの設定ファイルに記録する

- 置き場所は `.claude/better-agentics/config.json`、キーは `disabledRoles`(役割 ID の配列)とする(J10)。
- 書くのは setup だけとする。`pick-delegate` と SessionStart は読むだけとする。
- ファイルが無いときは、外した役割が無いものとして扱う。
- ファイルがあるのに読めないとき、または形が違うときは、`pick-delegate` は `invalid-config` を返し、SessionStart は警告する(J23)。
- git で追跡するかは、定義と同じくプロジェクトの判断とする(setup の `SKILL.md:223`)。追跡しないと worktree では外した役割が戻ることを、README に書く。
- setup が読めない設定ファイルを見つけたときは、その旨とファイルの中身を示し、作り直すかを `AskUserQuestion` で聞く(J23)。中身を示すのは、利用者が外していた役割を作り直しで失わないためである。

## 8. hook

### 8.1 SessionStart: 定義が無いことを誤りとして扱わず、上書きと移行を知らせる

- 定義が 1 つも無いときの文(`src/hooks/session-start.ts:37-39`)を、「定義の無い役割は Standard Agent モードで委譲する。調整したい役割の定義と、外す役割は better-agentics:setup で決める」に改める。
- better-agentics の定義が 1 つ以上あり、設定ファイル(7.3)がまだ無いときは、移行の知らせを添える(J11)。
  - 知らせには、定義の無い役割の一覧と、それらが Standard Agent モードで動くことを書く。
  - 改修の前に「作らない」を選んでいた利用者は、ここで気づける。setup を一度走らせると設定ファイルができ、知らせは出なくなる。
  - 定義を 1 つも持たない利用者は、「作らない」を選んだことが無いので、知らせを出さない。
- 次のどれかに当たるときも、知らせを添える。
  - 外した役割に定義がある。
  - ある理由に当たる役割をすべて外している(review なら必須のレビューが止まる)。
  - 設定ファイルが読めない(J23)。
- 次のどれかに当たるときは、規律の使用指示に警告を添える(D10、J9)。注入は止めない。

| 条件 | 起きること |
| --- | --- |
| `CLAUDE_CODE_EFFORT_LEVEL` が空でない値に設定されている(`auto`・`unset` を含む) | 役割の effort が使われない。`auto` と `unset` で役割の effort が捨てられるかは 13 章の S1 で確かめ、捨てられないと分かれば警告の対象から外す |
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` が空でも `0` でも `false` でもない | 役割のモデルが一律になる。公式が書く有効な値は `1` で、それ以外の値の扱いは S1 で確かめる。警告は広めに出す |
| `FORCE_PROMPT_CACHING_5M` が設定されていて、レビューの役割の定義が 1 つ以上ある | レビュアーの 1 時間のキャッシュが効かない |
| `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` が `5m` で、レビューの役割の定義が 1 つ以上ある | レビュアーの 1 時間のキャッシュが効かない |

- `CLAUDE_CODE_SUBAGENT_MODEL` だけの設定は、定義と呼び出しの `model` が勝つので警告しない。
- 設定ファイルの `maxEffortLevel`・`subagentPromptCacheTtl`・`availableModels` と、組織の effort の上限は検出しない。14 章の限界と README に書く。

### 8.2 SubagentStart は変えない

- Custom Agent モードの委譲先には、現行どおり定義の `name` との突き合わせで規律を注入する。
- Standard Agent モードと fork の委譲先には、前置きで規律を渡す。fork の起動で SubagentStart がどう発火するか(S3)と、Workflow のエージェントで発火するか(S6)の結果によって、規律の渡し方を見直す。

## 9. 役割断片と文書

### 9.1 役割断片

- 13 役割の Output Format(ja・en)に、結果が無いときの書き方を足す(D12)。例は、code-review の「指摘が無いときは『指摘なし』と書き、確かめた範囲を添える」である。文言は役割ごとに決める。
- knowledge-elicitation の model と effort は変えない(D9)。
- 断片を変えると、次の 2 つが起きる。README の更新の案内に、作り直しの手順を書く。
  - 既存の定義を setup で作り直すとき、Output Format が「テンプレートが変わった」と判定される。
  - ja・en 以外の翻訳断片が stale になり、訳し直すまで setup の `--check` と `--write` が止まる(3.4)。

### 9.2 文書

- `README.md`
  - setup を任意の手順に改め、2 つのモードと役割の外し方を説明する。設定ファイルを git で追跡しないと、worktree で外した役割が戻ることを書く(7.3)。
  - 「更新で変わる挙動」として次を書く。
    - 改修の前に「作らない」を選んだ役割が、Standard Agent モードの候補に戻る。SessionStart の知らせと、setup での外し方を示す。
    - 理由に当たる定義が 1 つだけでも、外していない役割が 2 つ以上あれば Jev を呼ぶようになる。
    - 出力のキーが `agent` から `agentType` に変わる。
    - 翻訳断片を訳し直す必要がある。
  - fork が親のモデルと effort で動き、役割の推奨 effort を使わないことを書く。
  - SessionStart の警告の意味と、検出しない設定(`maxEffortLevel`・`subagentPromptCacheTtl`・`availableModels`・組織の上限)を書く。`availableModels` が塞ぐモデルは、エラーにならず別のモデルに置き換わる(3.1)。fable を使えない環境では、escalation と complex-review を外すか、別のモデルで定義を作るよう案内する。
  - 必要な Claude Code のバージョンを書く。呼び出しごとの `effort` は v2.1.292、`omitClaudeMd` は v2.1.271、`experimental.cacheTtl` は v2.1.248、fork の既定は v2.1.302 である。
  - 「TypeSafe AI へ送る内容」に、Standard Agent モードの候補として、役割 ID と同梱の断片の `## When to invoke` を送ることを足す。送る内容の種類(作業の要約・成果物のパス・候補の名前と基準)は変わらない。
- `docs/rationale.md`: 12 章の覆した判断と採らなかった案を移す。
- 現行の設計書: この設計書で変わるセクション(1-3、2-2、4-2、6、7、8、9、10)に、この設計書を指す注記を置くか、内容を改める(15 章)。
- `.claude-plugin/plugin.json` の description: 「各 Agent 定義の選択基準をもとに選ぶ」を、定義の無い役割も含む書き方に改める。
- ルートの `README.md`: プラグインの説明を改める(プロジェクトの規約)。
- `.serena/memories/core.md` の better-agentics の項(120-127 行): 候補の集め方が変わるので改める(プロジェクトの規約)。
- 食い違いの文書: 実装が済んだら、G3・G4・G5・G9・G10・G12 の better-agentics 側を解消済みにする。前置きの項目名 `preamble` を、codiel 1.2 の実装へ伝える記述を足す。G9 は、codiel 側で D20 の向きと D20 への参照が足された(コミット fcf312be)。

ARCHITECTURE はプラグインの中の契約を書いていないので、変えない。better-agentics には `evals/` が無い。

## 10. 決定と本文の対応

| 決定 | 書いた場所 |
| --- | --- |
| D1・D4・D7 | 1 章、4.4、4.6、12.2 |
| D2・D13・D19 | 6.1、6.4 |
| D3・D16・D18 | 4.2、4.4、7.1、7.3 |
| D5・D14 | 6.3 |
| D6 | 4.5、6.4 |
| D8・D11 | 7.2 |
| D9・D12 | 9.1 |
| D10 | 8.1 |
| D15・D17・D20 | 5 章 |

## 11. 執筆者の判断

ユーザーの決定の範囲で、執筆者が決めた細部である。読み合わせで確かめてほしい。

| 番号 | 判断 | 理由 |
| --- | --- | --- |
| J1 | Jev の選択肢の鍵を役割 ID に揃える | Standard Agent モードの候補には定義の名前が無く、定義の名前が役割 ID と重なりうる |
| J2 | 前置きは全文を本文で返す形を既定にし、S2 の結果で ja・en をファイルを指す形に切り替える | 全文の写しは出力トークンを増やす。一方、ファイルを読ませる形は、許可の確認と読み落としが未確認である |
| J3 | 前置きの `{{NAME}}` に `default-name`、`{{ROLE_LABEL}}` に `label` を入れる | 同じ語を 2 度入れると文が崩れる |
| J4 | Custom Agent モードの fork の判定では、定義の `model` が 4 つの別名のどれかで `parentModel` と同じときだけ一致とみなす | `inherit`・未設定・完全な ID は比べる規則が無く、一致とみなすと誤った fork が起きうる |
| J5 | fork の前置きに、役割の Output Format を入れる | fork には定義本文も役割の前置きも無く、出力の形が決まらない |
| J6 | fork の起動が拒否されたら、自分で行う | `permissions.deny` の `Agent(fork)` は `pick-delegate` から見えない |
| J7 | 外側の手順のスクリプトへ渡す作業には `needsContext` を付けない | fork は親の会話を前提にし、スクリプトが起動するエージェントには渡せない |
| J8 | 外側の手順が委譲先を 1 件だけ受け取るときは、`p` が最も高いものを渡す | codiel のレビューの指定は 1 つで、`pick-delegate` は複数を返しうる |
| J9 | 8.1 の 4 つの環境変数を警告する。キャッシュの 2 つは、レビューの定義があるときだけ出す | どれも、役割の model・effort・キャッシュの寿命を黙って変える。1 時間のキャッシュは Custom Agent モードのレビュアーにしか付かない |
| J10 | 外した役割の記録を `.claude/better-agentics/config.json` の `disabledRoles` に置く | 定義のファイルとは別に、役割単位の設定を置く場所が要る |
| J11 | better-agentics の定義が 1 つ以上あり、設定ファイルが無い間は、移行の知らせを出す | 改修の前に「作らない」を選んだ記録が残っていない。定義を持たない利用者には不要な知らせになる |
| J12 | `omitClaudeMd`・`experimental` を `GENERATED_KEYS` に入れず、7.2 の規則で読み書きする | 再生成で、利用者が手で書いた値を黙って消さない |
| J13 | 依頼文が指示したときを除き、委譲先がさらに委譲しない | Standard Agent モードと fork の委譲先は Agent ツールを持ち、役割ごとのモデルの割り当てが崩れる |
| J14 | レビューの対象を、どのブランチにも載せないスナップショットのコミットで固定し、差分は親のコミットを基準に取る | ファイルに保存すると、保護パスへの書き込みか、プロジェクトの外の読み取りで許可の確認が出うる。worktree では `.git` がファイルである。`HEAD` を基準にすると、レビュー中のコミットで対象が動く |
| J15 | 委譲先の役割は、依頼文の冒頭の指定、定義本文か前置きの順で決める | 外側の手順の前置きは任意である |
| J16 | 依頼文の優先は「行う作業と書いてよい範囲の列挙」で判定し、役割の範囲(`:18`)にだけ当てる。役割断片の「引き受けない」「差し戻す」には当てない | 断片の条項は、安いモデルの委譲先が担えない作業を断る安全弁である。通常の split の依頼文も作業と範囲を列挙するので、断片に当てると安全弁がいつも外れる |
| J17 | README で `subagentPromptCacheTtl` を勧めない | 全サブエージェント・Workflow・compaction に効き、`5m` にすると D11 を打ち消す |
| J18 | 並行して書くテストのファイルを、委譲先の書き込み範囲から外す | 並列のグループの条件(書き込みが重ならない)を保つ |
| J19 | ja・en 以外の前置きは、stale でない翻訳断片か en を使う | stale の訳には古い Output Format が残る |
| J20 | 委譲先の起動がエラーになったら、別のモデルで起動し直さず報告する | 役割のモデルを黙って変えると、2.3 の避けることに当たる。`availableModels` による置き換えはエラーにならないので、README の案内で補う |
| J21 | 委譲先はバックグラウンドで起動し、待つだけの場面ではターンを終えて完了の通知で再開する | fork モードが有効な対話セッションでは、完了を待つ起動ができない。`-p` の扱いは S10 で確かめる |
| J22 | 文書のレビュー中は、その文書を編集しない | 文書はパスで渡すので、編集すると対象が動く |
| J23 | 設定ファイルがあるのに読めないときは、`pick-delegate` が `invalid-config` を返し、SessionStart が警告する | 外した役割が黙って候補に戻らないようにする |
| J24 | 役割を外すのは、setup のステップ 2 と 3 の間に足す「外す役割の見直し」のステップだけで行う。一覧は質問の中に入れ、自由入力は外す役割の全体として扱う | モデルの質問は定義のある役割に出ないことがあり、選択肢の上限(4)もある。ステップ 3 で中止しても、設定ファイルを残す |
| J25 | 外側の手順のスクリプトが委譲の指定を受け取れるときは、レビューの作業は `review`、行き詰まりの打開は `stuck`、それ以外は `split` で問う | codiel は委譲の指定の形を定めるが、委譲先を決める手順は書かず、指定を渡すことも求めない(任意で受け取る)。そのため、better-agentics の規律が決める |
| J26 | `pick-delegate` の入力に `excludeRoles` を足し、断られた作業の選び直しでは断った役割を外して呼び直す | 委譲先を自分で選ぶことは規律が禁じる(`SKILL.md:20`)。同じ要約で呼び直すと、同じ役割が返りうる |
| J27 | `needsContext` の作業で fork の条件を満たさないときは、`mode: "self"` を返す | 返した委譲先を使わない規律にすると、返す理由と使わない理由が結び付かない |
| J28 | 依頼文が出力の形を定めているときは、役割の Output Format より依頼文に従う | 外側の手順の契約は、出力ファイルと戻り値のスキーマを定める。役割の Output Format と並ぶと、どちらに従うかが決まらない |

## 12. 覆した判断と採らなかった案

### 12.1 覆した判断

| 元の判断 | 出どころ | 覆した理由 |
| --- | --- | --- |
| 起動形態の判定(モデル注入起動・合成)は対象外 | 現行の設計書の 2-2 | Standard Agent モードで、定義を作らずに役割ごとのモデルと effort で委譲するため |
| 同梱の役割断片を役割 ID で引いて基準にする案を採らない | rationale.md の不採用案 | 不採用の理由は「利用者が定義を編集しても基準が変わらない」だった。断片の基準を使うのは定義の無い役割だけで、定義があればその基準を使うので、理由が当たらない |
| 定義は 1 役割に 1 つで、model と effort を frontmatter に固定する | 現行の設計書の 1-3 | Custom Agent モードでは保つ。Standard Agent モードでは `roles.ts` の推奨値を呼び出しで渡す |
| 定義の無い役割は委譲先にならない | 現行の setup の「この役割は作らない」 | 定義の無い役割は Standard Agent モードで委譲する。外したい役割は D18 の設定で外す |

### 12.2 採らなかった案

| 案 | 採らなかった理由 |
| --- | --- |
| 委譲先をバックグラウンドのメインセッションにする | 理由は次の 6 つ。codiel の stop-guard が委譲先の終了を止める【推定】。書き込みに worktree が要り、codiel 1.1 の D8 とぶつかる。codiel の待ちの仕組みは、サブエージェントの完了の通知を前提にしている。Workflow の `agent()` では起動できない。他のプラグインの hook がすべて委譲先で動く。規律の注入を SessionStart の分岐へ作り直す必要がある |
| 書き込む委譲先を worktree で、または `worktree.bgIsolation: "none"` で動かす | 上の案を採らないので不要 |
| 役割の定義をプラグインに同梱し、Standard Agent モードで使う | 置き場所による守られ方の差に根拠が無い(D7)。定義の説明文は常にエージェントの一覧に載る。プラグイン同梱の定義では `mcpServers` が無視される |
| knowledge-elicitation の effort を medium に上げる | medium では役割を果たせない(D9) |
| fork を 3 役割以外にも使う。effort を fork の条件に含める | 4.5 のとおり |
| 委譲先への文脈の受け渡しに context-map を使う | agent-policy で 2026-09-24 に廃止された(コミット 202955e8) |
| Standard Agent モードの読み取りの役割に、組み込みの Explore を使う | Explore は再開できず(D5 が使えない)、CLAUDE.md も読まない |
| 外した役割を、定義のファイル(役割マーカーだけの定義など)で表す | 定義の一覧と Agent ツールの一覧に、使わない定義が載る |
| レビューの差分をファイルに保存して渡す | 保護パス(`.git`・`.claude`)への書き込みか、プロジェクトの外の読み取りで許可の確認が出うる(J14) |
| 依頼文の優先の条項を、役割断片の「引き受けない」にも当てる | 安全弁がいつも外れる(J16) |

## 13. 確かめる事項

実装計画の先頭に、次を確かめる小さな試作(スパイク)を置く。

| 記号 | 確かめること | 想定と違うときの扱い |
| --- | --- | --- |
| S1 | `general-purpose` に `model` と `effort` を渡すと、指定どおりに動くか(`/tasks` の行で確かめる)。`CLAUDE_CODE_EFFORT_LEVEL=auto` のとき、渡した effort が捨てられるか。`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` が `1`・`true` のとき、渡した `model` は無視されるか、エラーになるか | effort が届かなければ、Standard Agent モードの effort を 14 章の限界に移し、2.1 の目標を改める。`auto` で捨てられなければ、8.1 の警告から `auto`・`unset` を外す。FORCE の下でエラーになるなら、FORCE の間は `model` を返さない |
| S2 | 前置きの全文の大きさと、オーケストレーターが省かずにそのまま写すか。委譲先がプラグインの中のファイルを許可の確認なしに読み、1 行の指示に従って最初に読み、規律に従うか。Workflow のエージェントも、プラグインの中のファイルを許可の確認なしに読めるか(Workflow はエージェントの許可の確認で止まる) | 4.6 の切り替えの条件に当てる。全文の写しで省略が起きるなら、ファイルを指す形を優先して検討する。Workflow のエージェントで確認が出るなら、外側の手順のスクリプトへ渡す前置きは全文の形のままにする。スクリプトへ渡す指定かどうかは、S6 で足す入力で見分ける |
| S3 | fork が前置きに従い、さらに委譲したり `pick-delegate` を呼んだりしないか。fork の起動で SubagentStart がどの `agent_type` で発火するか。オーケストレーターが申告する `parentModel` が正しいか(SessionStart の入力の `model` と比べる)。親が fable だと Standard Agent モードで fork が返らないので、親を opus か sonnet にして試す | 委譲を始めるなら、fork の前置きの指示を強める。規律が二重に入るなら、前置きから規律を外す。申告が誤るなら、申告の手順を見直す |
| S4 | 2.1.321 で、完了したレビュアー(Custom・Standard の両方)を SendMessage で再開できるか。再開後も model と effort が保たれるか | 再開できないモードでは、新しく起動する経路だけにする |
| S5 | ファイルに書いた定義で、`experimental.cacheTtl: 1h` が効くか | 効かなければ、`experimental` を生成しない |
| S6 | codiel 1.2 の S2(Workflow の `agent()` で SubagentStart が発火するか)の結果。`agent()` が `agentType: "general-purpose"` を受けるか | SubagentStart が発火しなければ、Custom Agent モードでも前置きで規律を渡す経路を足す。そのときは「外側の手順のスクリプトへ渡す」ことを示す入力を `pick-delegate` に足す |
| S7 | 全役割を候補にしたときの Jev の選び方。review は 5 候補、split は 7 候補になる | 偏るなら、断片の `## When to invoke` を見直す |
| S8 | スナップショットのコミットの作り方(6.3)が、`default`・`auto` の許可モードで確認なしに動くか。worktree の中でも動くか。`user.name`・`user.email` が無い環境で `git commit-tree` が通るか。setup の CLI が `.claude/better-agentics/config.json`(保護パスの `.claude` の下)に書くとき、確認が出るか(現行の setup も、同じ CLI で `.claude/agents/` に書いている) | 確認が出るなら、6.3 のとおり、レビュー中は対象を編集しない形にする。作者の情報が無くて失敗するなら、コマンドに作者の環境変数を付ける。設定ファイルの書き込みで確認が出るなら、setup の手順に確認が出ることを書く |
| S9 | 設定ファイルの `env` で設定した変数が、SessionStart の hook のプロセスに見えるか | 見えなければ、8.1 の警告の限界として README に書く |
| S10 | `claude -p` で、バックグラウンドの委譲先を残してターンを終えたとき、完了の通知で次のターンが始まるか。`availableModels` が塞ぐモデルの置き換えで、`-p` では警告が出ないか | 次のターンが始まらないなら、`-p` では委譲先の完了を待つ起動にする。警告が出るなら、14 章の記述を改める |

## 14. 既知の限界

- Standard Agent モードでは、委譲先のツールを絞れない。Agent ツールに、使えるツールを指定する引数が無いためである。読み取りの役割が書き込まないこと、さらに委譲しないことは、規律でしか担保できない。
- `omitClaudeMd`(D8)と 1 時間のキャッシュ(D11)は、定義の frontmatter で効く。そのため、Custom Agent モードの委譲先にしか当たらない。
- 1 時間のキャッシュは、`FORCE_PROMPT_CACHING_5M`・`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`・設定の `subagentPromptCacheTtl` に負ける。使用クレジットを消費している間も効かない。
- 1 時間のキャッシュが得になるのは、再開までの間が 5 分を超えるときだけである。3.1 の料金で、レビュアーの接頭辞を 1 回書いて再レビューで 1 回再開する場合を比べると次のとおり(基本の入力単価を 1 とする)。
  - 間が 5 分を超えるとき: 1 時間なら書き込み 2 と読み出し 0.1 で 2.1、5 分なら書き込み 1.25 の 2 回で 2.5 になる。
  - 間が 5 分以内のとき: 1 時間なら 2.1、5 分なら書き込み 1.25 と読み出し 0.1 で 1.35 になる。
  - 再レビューが無いとき(critical・high・medium が出なかったとき): 1 時間なら 2.0、5 分なら 1.25 で、1 時間は損になる。
  - レビュアーが実行中に読んだファイルやツールの結果も、書き込むたびに同じ倍率がかかる。上の比較は接頭辞だけの概算である。
- `maxEffortLevel` と組織の effort の上限は、役割の effort を抑える。`availableModels` が塞ぐモデルは、別のモデルに置き換わる。対話セッションでは警告が出る。`-p` などの非対話のセッションでは黙って置き換わると推定する(公式は対話セッションの警告だけを書く。S10 で確かめる)。SessionStart はどちらも検出しない。
- 役割断片の「引き受けない」「差し戻す」の条項は、外側の手順の作業も断りうる(5.2)。断られたら、`excludeRoles` で選び直すか、人が委譲の指定を示す(J26)。
- fork の effort は親と同じになり、変えられない。親が fable のときは、Standard Agent モードの役割に fork は返らない。
- `parentModel` はオーケストレーターの申告であり、誤ると条件の判定が誤る。
- 再開した再レビューのレビュアーは、前の巡の自分の指摘を覚えている。修正の確認には向くが、新しい目で読み直すことにはならない。
- 差分を固定しても、コードレビューのレビュアーは呼び出し元を作業ツリーから読む。オーケストレーターが編集を続けていると、固定した差分と食い違う行を読みうる。
- 他のプラグインの SubagentStart の注入と、MCP サーバーの使い方の説明は、この改修で減らない。
- `subagent-policy.md` は ja しか無い。en の前置きでも、規律は ja になる。
- review と split では、候補が 2 つ以上あれば Jev を呼ぶ。外さなければ候補は常に 2 つ以上なので、キーが無いと委譲できない。TypeSafe AI は 2026-09-22 から新規サインアップを停止している。

## 15. ビルダーに任せること

- 前置きの文言と区切り。fork の前置きの指示の文言。
- Jev の選択肢の鍵を役割 ID に揃える実装の方法。
- スナップショットのコミットを作るコマンドの細部(一時インデックスの置き場所と後始末)。
- setup の質問の文言(聞き方は 7.1・7.2 で決めた)。
- 13 役割それぞれの、結果が無いときの書き方。
- 現行の設計書に注記を置くか、内容を改めるか。
- 設定ファイル(7.3)の読み書きを置くモジュール。
- テストの範囲。テスト方針(`.claude/rules/metatron/testing-policy.md`)に従う。

## 16. 影響範囲

| 層 | ファイル |
| --- | --- |
| 実装 | `src/pick-delegate.ts`、`src/lib/pick.ts`(入力の `excludeRoles` を含む・候補・出力の `self` を含む・fork の判定・`invalid-config`)、`src/lib/agents.ts`(候補の集め方)、`src/lib/fragments.ts`(前置きの組み立て)、`src/lib/compose.ts`・`src/lib/regenerate.ts`・`src/lib/document.ts`・`src/setup.ts`(2 キーの読み書き、外す役割の見直し、`--list-coverage` の欄、設定ファイル)、`src/hooks/session-start.ts`(文の変更・移行の知らせ・警告)、設定ファイルを読み書きする新しいモジュール、各 `__test__/` |
| 配布物 | `scripts/` の再生成。J2 でファイルを指す形にするなら、ビルド時に作る前置きのファイル |
| 指示 | `skills/orchestration/SKILL.md`、`skills/setup/SKILL.md` |
| 参照 | `references/subagent-policy.md` |
| 素材 | `assets/roles/{ja,en}/*.md` の Output Format |
| 配布宣言 | `.claude-plugin/plugin.json` の description(バージョンは上げない) |
| 文書 | `README.md`、`docs/rationale.md`、現行の設計書、ルートの `README.md`、`.serena/memories/core.md`、食い違いの文書 |

## 出典

- Claude Code の公式ドキュメント(2026-11-10 取得): https://code.claude.com/docs/en/sub-agents 、https://code.claude.com/docs/en/prompt-caching 、https://code.claude.com/docs/en/settings-reference 、https://code.claude.com/docs/en/model-config 、https://code.claude.com/docs/en/env-vars 、https://code.claude.com/docs/en/hooks 、https://code.claude.com/docs/en/memory 、https://code.claude.com/docs/en/costs 、https://code.claude.com/docs/en/permission-modes 、https://code.claude.com/docs/en/permissions
- プロンプトキャッシュの料金: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Claude Code 2.1.321 の Agent ツールの定義と、エージェントの一覧(2026-11-10 のセッション)
- 2026-11-10 の試験: `omitClaudeMd` で外れる読み込み元(3.2)、SubagentStart の注入の大きさと hook の所要時間(3.3)
- codiel の設計書: `harness-docs/design/2026-11-08-codiel-1-1-executor-neutral-and-design-layer-design.md`、`2026-11-08-codiel-1-2-workflow-modes-design.md`、`2026-11-08-codiel-2-0-loop-engineering-design.md`
- 2026-11-10 の会話で読んだ記事: https://note.com/bos_oyake/n/nf2f8338fc039 、https://saiteki-ai.com/basics/ai-tool/claude-code/claude-code-slow/
