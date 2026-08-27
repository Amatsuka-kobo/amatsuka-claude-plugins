# agent-policy: 外部 Agent へのモデル割当と最適化定義の合成

- 日付: 2026-08-27
- 対象プラグイン: `plugins/agent-policy`
- 状態: 設計（実装前・第 4 版）
- 関連: `harness-docs/handover/2026-08-26-agent-policy-external-agent-compatibility-handoff.md`（監査引き継ぎ書）
- 版注: 第 3 版に対するレビュー第 3 巡（Haiku・Grok 独立・引き継ぎ書突き合わせ）の指摘と、ユーザー決定 2 件を反映した。主な変更: 起動形態に「モデル注入起動」を新設（合成不成立時の帯モデル喪失を解消）、合成対象帯から `general` を除外、判定表の評価順を原本特定先行へ再構成、適用除外の allow-list 化、`model: inherit` の扱いの是正、fail-open 時も対応表は注入、deny-list 照合と frontmatter パーサの堅牢化、事実訂正（旧バージョン縮退・codiel の MCP・setup CLI の実態）、実機検証の拡充

## 背景と問題

agent-policy の現行運用は role 毎定義生成である。`setup-agents` がプロジェクトの `.claude/agents/` に役割ごとの定義を生成し、各定義には MCP tools の付与（Serena 等）と本文のプロジェクト適応が入る。GPT/Grok 帯だけでなく Claude モデル帯の定義も生成される。以下、この生成された定義を「最適化定義」と呼ぶ。

一方、このプロジェクト外で定義された Agent（他プラグイン同梱の Agent、利用者の自作 Agent。以下「外部 Agent」）には `model` を宣言しないものがある。オーケストレーターがこれを名指しで dispatch すると、セッションのメインモデル（最上位モデル）を継承して起動し、コストと役割の両面で担当表と不整合になる。また、最適化定義の価値（MCP tools・適応本文）が外部 Agent の実行に届かない。

原因は 2 層ある。

**層 1（直接原因）** — `references/orchestration-discipline.md` の「委譲先の実行モデルの確定」節は、同梱エージェント運用・assets 生成運用の時代の機構のままである。`model` 未指定の Agent は「Claude 帯 = ビルトインへ `model` 上書き、GPT/Grok 帯 = 同梱プリセットへ本文移植」と定めており、いずれも最適化定義を経由しない。

**層 2（なぜそのままだったか）** — ハーネスのモデル注入経路が非対称（Agent tool の `model` param は enum のみ、proxy alias・完全モデル ID は定義 frontmatter でしか表現できない）であり、旧機構はこの非対称を回避する形で組まれた。回避策がそのまま規律として残り、最適化定義の登場後も見直されなかった。

監査引き継ぎ書は「担当表への参加は `agent-policy-role` marker による明示 opt-in とする」境界を置いた。「参加」（帯の委譲先候補になること）と「モデル割当・最適化の合成」（名指しで dispatch されるときの実行形態の決定）は別問題である。本設計は後者のみを扱い、前者の境界は維持する。

## 目的

オーケストレーターが名指しで dispatch する外部 Agent に対して、次を実現する。

- **合成に適合するもの**: プロジェクト最適化（MCP tools・適応本文）を届ける。モデルは、`model` 未宣言なら担当表相当の帯モデル、enum 宣言済みなら宣言モデル（所有者の意思を優先）
- **合成に不適合だが帯適合のもの**: 元定義のまま、モデルだけ帯モデルを注入する（現行規律が与えていた水準の回復）
- **それ以外**: 一切変更せずそのまま起動し、外部 Agent の契約を壊さない

### 到達範囲の正直な記述

合成が安定して効くのは、**原本定義を読める外部 Agent** に限られる。プロジェクトローカル（`.claude/agents/`）の手書き Agent は常に読める。user scope（`~/.claude/agents/`）も読める。他プラグイン同梱の Agent は、dispatch に使われる実体と同一の定義を読めた確証がある場合に限り合成でき、確証がなければモデル注入起動またはそのまま起動になる（fail-safe。plugin cache は作業ツリーより古い世代であり得るため、単に読めるだけでは足りない）。

`model` 未宣言かつ固有 MCP を持つ Agent（本リポジトリでは codiel 群）は、§4 の付与が行われない限り合成されないが、帯適合ならモデル注入起動で帯モデルは届く（例: codiel reviewer はコードレビュー帯の Sonnet で起動する）。

## 起動形態の定義

本設計は名指し dispatch の起動形態を 3 種に分ける。

1. **そのまま起動** — `subagent_type`・モデル・tools のいずれにも触れない。`model` 未宣言ならメインモデルを継承する
2. **モデル注入起動** — `subagent_type`・tools・本文は元定義のまま、`model` param だけを注入する。注入するのは、`model` 未宣言・`inherit` の定義に対する帯モデルである（宣言済みの定義には注入しない）。帯モデルが GPT/Grok（param で表現不能）のときは、`claude-model-policy` の同帯モデルへ読み替えて注入する（既存フォールバック節と同じパターン）
3. **合成** — 帯ホスト（最適化定義）を `subagent_type` にし、外部本文を依頼文へ同梱する（§2）

## 適用範囲と適用除外

本設計が対象とするのは、**オーケストレーター（メインセッション。他プラグインのワークフロースキルを進行中の場合を含む）が Agent tool で外部 Agent を名指しで dispatch する場面**だけである。役割ベースの dispatch（帯に対して委譲先を選ぶ場面）は現行の実行帯の解決順のままであり、本設計は変更しない。

次はすべて**適用除外**とし、指示どおり・定義どおりに**そのまま起動**する。

1. **フック指示 dispatch** — フックの注入文が `subagent_type` や起動様式（`run_in_background` 等）を直接指定している dispatch。起動検知や結果消費を機械が `agent_type` で行うか否かを問わない（例: chat-history の記録エージェント、raphael の蒸留エージェント）。判定はその dispatch を指示した文脈がフック注入文か否かで行う
2. **原本定義を特定できない dispatch** — 合成にもモデル注入（未宣言であることの確認）にも原本の frontmatter・本文が必要である。確認先は project の `.claude/agents/` → user の `~/.claude/agents/` → プラグイン実体の `agents/`。dispatch に使われる実体と同一の定義を読めた確証がなければ、そのまま起動する
3. **契約 frontmatter・展開値依存を持つ定義** — frontmatter に `name` / `description` / `model` / `tools` / `color` / `agent-policy-role` **以外の**フィールドを 1 つでも持つ定義（`background` / `disallowedTools` / `skills` / `memory` / `permissionMode` / `isolation` 等、将来の未知フィールドを含む）、または本文が `${CLAUDE_PLUGIN_ROOT}` 等の展開値に依存する定義。合成すると契約が機械的に失われるか壊れるため合成しない。allow-list 方式なので未知フィールドにも頑健であり、原本を読んだ時点で機械的に判定できる。`color` と `agent-policy-role` は挙動に影響しない既知メタフィールドであり、allow-list に含める（本プラグインの生成器と Claude Code の定義ウィザードがほぼ全定義に書くため、除外条件に含めると大半の Agent が適用除外に落ち、モデル注入・合成が発火しなくなる — 実装計画レビュー第 2 巡での是正）
4. **`model` 宣言が enum（`sonnet` / `opus` / `haiku` / `fable`）で表せない定義** — 完全モデル ID・proxy alias の宣言は、その定義自身の frontmatter でしか効かせられない。宣言を尊重してそのまま起動する
5. **作業種別が合成対象帯に合致しない dispatch** — 合成対象帯は `general` を除く RoleId 9 役（complex-impl / normal-impl / light-impl / explore / realtime-research / independent-review / doc-review / code-review / advisor）である。`general`（その他のタスク）は catch-all であり、これを含めると分類の揺れがそのまま合成可否の揺れになり、読み取り系の外部 Agent が Write/編集系 MCP を持つ実装ホストへ乗る事故経路になるため、合成対象から除外する（ユーザー決定）。担当表の「調査・分析」「設計書・実装計画書の作成」「コードベース探索統括」相当の作業も RoleId を持たず不適合である。探索は、実働（explore）に当たるなら適合とする

「判定に迷う場合は合成しない」を原則とし、適用除外側に倒す。

## 非目標

- **帯参加昇格**。marker 未宣言の Agent を帯の委譲先候補にはしない（監査境界の維持）
- **役割ベース dispatch の実行帯の解決順の変更**
- **割当マップ・派生定義の生成・CLAUDE.md への焼き込み**（不採用案を参照）
- **Agent discovery の事前走査の scope 拡張**（監査所見 1・2 の修正自体は別課題。本設計が必要とする原本確認は dispatch 時に行い、特定できなければ合成しない）
- **監査所見 4〜11 の修正**。別課題
- **SessionStart フックの注入・警告体系の変更**。現行維持

## 前提

### 文書上で確認した仕様（実機裏取りは §8）

- Agent tool の `model` param は、委譲先定義の frontmatter `model` より優先される。値は enum のみで、proxy alias・完全モデル ID は渡せない
- サブエージェントの tools は spawn 時に定義 frontmatter の `tools` からのみ決まる。`tools` 欄が無い定義は全ツール（Agent tool を含む）を継承する。依頼文のテキストは能力を拡張できず、制限方向の指示のみ可能で、それは遵守依存である
- `SubagentStart` フックは Agent tool による spawn 時に発火し、入力で `agent_type` を受け取る。matcher で選別でき、`hookSpecificOutput.additionalContext` でサブエージェントの初回プロンプト前にコンテキストを注入できる（公式 docs の hooks リファレンスに明記。changelog には現れないため §8 で実機裏取りする）。生成の block はできない。ビルトインにも発火する。プラグインの hooks はサブエージェント内にも自動適用される
- CLAUDE.md は fork でないカスタムサブエージェントに渡るが、ビルトイン `Explore` / `Plan` には渡らない（公式 docs で確認）
- CLAUDE.md もフック注入も「context であって強制ではない」（公式 docs 明記）。本設計の規律も同じ遵守クラスに属する。機械的に強制されるのは frontmatter（tools・model 等）と `model` param だけである
- skill 駆動ワークフローのオーケストレーターはメインセッション自身であり、SessionStart 注入と本規律が届く

### 既知制約

- `CLAUDE_CODE_SUBAGENT_MODEL` が設定された環境では、全定義の frontmatter `model` が上書きされ、本設計のモデル決定則は効かない。per-definition モデルを使う運用ではこの env を設定しない（README 既記載の運用を前提とする）
- 生成された最適化定義の preamble は「どの役割で呼ばれたかは依頼文の冒頭で指定される。指定がなく、複数の役割のどれとも判断できないときは差し戻す」と定める。合成 dispatch は必ず役割を冒頭で明示するため（§2）、差し戻し条件には該当しない。dispatch するのは常に本規律を読んだオーケストレーターであることが、この成立の前提である
- 生成された実装帯定義の Agent tool は**アドバイザー相談専用**であり、再オーケストレーションは禁止されている。したがって SubagentStart 配布（§5）の実装帯定義での主な受益は「アドバイザー相談先の解決」である。再オーケストレーションを許す自作定義では、配布された対応表が全帯の解決に使われる
- `SubagentStart` は Claude Code 2.0.43 で追加されたイベントである。それより古い環境ではフックが発火せず、サブエージェントへの配布は行われない（監査時と同じ「解決結果は親セッションのみが保持する」状態に留まる。現行より悪化はしない）
- 「外部 Agent がプラグイン外部の汎用 MCP tool を固有に持つのは稀」を前提とする。根拠: 多くのプラグイン同梱 Agent は MCP を持たないか、持っていても自プラグインのサーバーに閉じる。汎用 MCP（ブラウザ操作・GitHub・ドキュメント検索等）を frontmatter で要求する外部 Agent は例外的である。本リポジトリでは codiel の 13 定義（`mcp__context7` / `mcp__github__*` / `mcp__playwright`）がその例外にあたるが、codiel 自体が稀なケースであり、この母集団は一般利用者を代表しない

## 方針（原理）

> **合成に適合する名指し dispatch では、最適化定義（真髄 = MCP tools と適応本文の器）をホストにし、外部 Agent の本文を役割定義として依頼文へ注入する。合成に不適合でも帯適合で `model` 未宣言なら、元定義のままモデルだけ帯から注入する。宣言があれば常に宣言を優先する。機械契約に触れる dispatch は一切変更しない。**

事前登録・生成物を持たず、dispatch 時にその都度判定する。同じ外部 Agent への判定がセッション間で揺れ得ることは許容する（固定が必要になった場合の割当マップ追加は将来の拡張点）。適用除外 1〜4 は原本と依頼文脈から機械的に判定でき、揺れの余地を持たない。揺れが残るのは作業種別の分類（適用除外 5）と固有 MCP の本体性判断（判定フロー 6）である。

## 設計

### 1. 判定フロー（名指し dispatch の決定表）

dispatch 前に上から順に評価し、最初に該当した行で確定する。

| 順 | 条件 | 起動形態 |
| --- | --- | --- |
| 1 | フック指示 dispatch（適用除外 1） | そのまま起動 |
| 2 | 原本定義を特定できない（適用除外 2） | そのまま起動（宣言の有無が不明なため注入もしない） |
| 3 | 契約 frontmatter・展開値依存（適用除外 3） | そのまま起動 |
| 4 | `model` 宣言が enum 外（適用除外 4） | そのまま起動 |
| 5 | 作業種別が合成対象帯（9 役）に不適合（適用除外 5） | そのまま起動 |
| 6 | 合成不成立 — 帯に marker 解決済み定義が無い / 外部固有 MCP tool が作業の本体で未付与（§4） / 外部本文の義務条項がホスト本文の禁止条項と衝突する | **モデル注入起動**（未宣言・`inherit` なら帯モデルを注入。enum 宣言済みはそのまま起動と同じ） |
| 7 | 上記以外・`model` 未宣言・`inherit` | 合成: ホストへ外部本文を同梱、モデルはホストの frontmatter |
| 8 | 上記以外・`model` 宣言済み（enum） | 合成 + `model` param で宣言値を適用（GPT/Grok ホストへの上書きも行う。proxy を経由しなくなるだけで、ホストの tools・本文は生きる） |

行 6 のモデル注入起動は、現行規律「`model` 未指定・`inherit` の Agents は、作業種別を担当表に照らして実行帯を決める」が与えていた水準の回復である（第 3 巡レビューで、旧「完全そのまま起動」案が現行規律からの後退になることが判明し、ユーザー決定で変更した）。

### 2. 合成 dispatch の手順

現行の GPT/Grok 帯 dispatch 手順（役割の冒頭明示 + 定義本文の同梱）を、全ベンダーのホストへ一般化する。

- **ホストの選定**: 帯の marker 解決済み定義から選ぶ。同じ帯に複数あるときは、役割ベース dispatch と同じ規則（依頼内容に近いもの）で選ぶ。同梱プリセット（`agent-policy:gpt-*` / `grok`）はプロジェクト最適化を持たないため、合成ホストには使わない。marker の宣言は「帯参加」に加えて「合成ホストになり得る」ことへの opt-in でもある（この意味の拡張は §6 の規律改訂と README に明記し、既存 marker 保有プロジェクトへは変更履歴で告知する）
- 依頼文の冒頭で、ホストの担う役割名（例: 「通常の実装」）を明示する。ホスト preamble の差し戻し条件を満たさないための必須手順である
- 外部定義の本文（YAML frontmatter ブロックより後の全文）を、その作業の役割定義として依頼文へ同梱する
- 外部本文中の禁止条項・制約条項は、ホスト本文の同種規定より優先することを依頼文に明記する。外部本文の**義務条項**（毎ステップ commit 等）がホスト本文の禁止条項と衝突する場合は、合成せず判定フロー 6 へ倒す

### 3. tools 規則（方向別）

一律の許可リストは置かない。

1. **built-in（非 MCP）tools は外部定義を上限とする**。外部定義の tools に無い `Write` / `Edit` / `Bash` 等は使わない。外部契約の安全プロファイルの保全が目的である
2. **ホスト frontmatter の `mcp__*` は、外部定義の tools に無くても使用してよい**。最適化の真髄の通り道である。ただし外部本文が明示的に禁じる操作は、この規則より優先する

補強: MCP の許可はサーバー単位（ADR-001）であり、編集系ツールを含むサーバー（Serena 等）をホストが持つ場合に備え、読み取り系の役割（explore / realtime-research / independent-review / doc-review / code-review / advisor）で合成するときは既存の読み取り限定 overlay（「ファイルを変更しない・報告のみを返す」条項。各方針スキルの dispatch 節）を従来どおり重ねる。

enforcement の階級: 本節はすべて依頼文レベル（遵守依存）。機械的な天井はホスト frontmatter の tools である。

### 4. 外部固有 MCP tool の序列

外部 Agent の固有 MCP tool が作業の本体であるとき:

1. **ホスト定義（プロジェクト所有）へ当該 MCP サーバーを許可することをユーザーへ提案する**。付与は `setup-agents` CLI の単一定義書込（`--policy` + `--name` + `--model-id` + `--roles` 指定）で可能だが、`--mcp-servers` は「付与したい全集合」を渡す仕様であり、**既存の MCP サーバーを明示しないと脱落する**。提案文にはこの注意（既存 MCP を含めた全集合を渡すこと・付与が永続変更であること・サーバー単位許可は外部のツール単位 allowlist より広くなること）を含める。`setup-agents` は明示的な依頼でのみ発動する契約であり、dispatch の副作用として自動実行してはならない。1 サーバーだけ追加する専用経路を設けるかは実装計画書の判断事項とする
2. 付与が行われていない・行えない（サーバー未接続等）なら、**判定フロー 6（モデル注入起動）へ倒す**

依頼文テキストで tools を移すことはできない（前提を参照）。定義 frontmatter の書換は所有している定義（最適化定義）に対してのみ行い、外部定義には行わない。

### 5. 配布機構（二段フック）

- **SessionStart**: 現行維持。方針スキルの使用指示・marker 対応表・警告を注入する。本設計の規律は方針スキル・references の改訂（§6）を通じてオーケストレーターに届く
- **SubagentStart**: 新設。選別は **deny-list 方式**とする。注入**しない**のは、(a) project 走査で frontmatter `tools` を持ち、かつそこに `Agent` が無いと判明した定義、(b) 自プラグイン同梱のうち `agents/*.md` の実走査で Agent tool を持たないと判明した定義（名前のハードコードはしない）、(c) ビルトイン `Explore` / `Plan`。それ以外（Agent tool を持つ定義、`tools` 欄の無い定義 = 全ツール継承、走査で判定できない未知の type = user scope・他プラグイン定義を含む）にはすべて注入する。判定できないものへ注入する側に倒すのは、数百 token の過剰配布より P0（role map の全階層伝播）の取りこぼしの方が高くつくためである
- **照合規則**: `agent_type` の照合は完全形（名前空間付き）の一致を優先し、末段一致は自プラグイン・ビルトインの完全形と衝突しない場合に限る。衝突・曖昧の場合は注入側（過剰配布）に倒す。フック入力の `agent_type` の形式は §8.6 で確定する
- **注入断片の内容契約**: 次の順で構成する。(1) 「あなたはサブエージェントである」の宣言、(2) marker 解決済み対応表（SessionStart と同一の情報）、(3) サブエージェント向け規律の要約 — 再委譲先は対応表を担当表より優先する / アドバイザー相談先は対応表に advisor があればそれを、無ければ `Fable`（不可なら `Opus`）/ アドバイザーへ Agent tool を許可しない（軽量帯への Agent tool 可否は profile 依存 — with-grok-policy では軽量帯 = Grok に許可される — のため断片には含めず、discipline と各方針スキルに置く。実装計画レビューでの是正）/ 読み取り役割を実装帯へ再委譲するときは読み取り限定条項を明記する / 依頼文で指定されないスキル（方針スキルを含む）をロードしない。静的部分（宣言と要約）は目安 300 token。対応表は marker 数に依存するため全体は変動し、実行時は 9,500 字を機械上限として要約側 → 表側の順で後方から切り詰める（対応表を優先して残す。実装計画レビューでの精密化）。方針スキルの使用指示は含めない（子がオーケストレーター化するのを防ぐ）。静的部分（宣言と規律要約）の正本は `references/subagent-discipline.md`（新設）に置き、AI 向け指示書として prompt-smith の基準で執筆・保守する。フックは実行時にこのファイルを `${CLAUDE_PLUGIN_ROOT}` 経由で読み、生成した対応表と合成して注入する
- **fail-open の優先順位**: 静的正本の読込に失敗しても、**対応表だけは注入する**（対応表はコード生成でありファイルに依存しない。トークン超過時の「対応表優先」と同じ優先順位）。フック入力の parse 失敗・その他の障害時は無注入で継続し（exit 0）、子 Agent は方針の既定フォールバックに従う。これは引き継ぎ書の「map に該当 role がない場合だけ fallback」より広い fallback 許容であり、意図的な逸脱である（生成を block できない以上、中止を強制する手段が無く、セッションを壊さない原則を優先する）
- **性質の明記**: これはスナップショットの伝播ではなく、フック実行時の filesystem 再解決である。セッション中に `.claude/agents/` が変更された場合、親と子で解決結果が異なり得る（許容する）。また SubagentStart は生成を block できないため、注入は対応表の機械的**配布**であり、dispatch 先の強制ではない。注入は適用除外対象（機械契約 Agent 等）にも届き得るが、`subagent_type`・モデル・tools を変えない追加 context であり、起動契約の不変条件には含めない（過剰配布側に倒す設計判断。監査対応表に逸脱として明記）
- **出力契約**: フック出力は `hookSpecificOutput.hookEventName: "SubagentStart"` + `additionalContext` の JSON とする。`additionalContext` の上限（10,000 文字）を超えないことをコードで保証する。スキーマの詳細は実装計画書で確定する

### 6. 規律文書の改訂

- `references/orchestration-discipline.md` の「委譲先の実行モデルの確定」節を §1〜§4 の決定則へ書き換える。旧「`model` が具体的なモデルに指定されている Agents は、そのまま起動する」は**縮小して維持**される（enum 外宣言はそのまま起動のまま。enum 宣言は合成適合時に限り判定フロー 8 でホスト実行に変わる）。旧「`model` 未指定・`inherit` は実行帯を決める」は判定フロー 6〜7 に引き継がれる
- 4 方針スキルの dispatch 節を追随させる。GPT/Grok 帯の「本文同梱 + 役割冒頭明示」の既存記述は、合成 dispatch の共通手順として一般化する。現行の「このとき `model` 上書きは使わない」は「外部 Agent の enum 宣言を適用する場合を除き、`model` 上書きは使わない」へ改める
- 4 方針スキル冒頭の読者宣言「あなたはオーケストレーターまたはそのサブエージェントである」を「あなたはオーケストレーターである」へ訂正する。本構成ではサブエージェントは方針スキルを読まず、SubagentStart の断片・生成定義の本文・依頼文への転記で規律を受け取る
- `orchestration-discipline.md` の冒頭に読者を明示する: 正本の読者はオーケストレーターであり、「サブエージェントは〜」で始まる条項は生成定義の本文・SubagentStart の注入断片・依頼文への転記を通じてサブエージェントへ届く
- サブエージェントへ方針スキルをロードさせない条項を `orchestration-discipline.md` に追加する（断片注入と転記で賄う。コスト規律の 30KB 上限と同方向の規則）
- `references/subagent-discipline.md` を新設する（§5 の注入断片の静的正本。「あなたはサブエージェントである」宣言とサブエージェント向け規律要約を収める。`orchestration-discipline.md` のサブエージェント条項と内容が食い違わないよう、改訂時は両文書を突き合わせる）
- marker の意味の拡張（帯参加 + 合成ホスト候補）を、setup-agents スキルと README の marker 説明に追記する
- `policies.ts` の `ASSIGNMENTS`（担当表の正本）は変更しない。変わるのは marker frontmatter の意味付けと dispatch の機構だけであり、policy × role × model の対応データには影響しない

### 7. 実装変更一覧

- `plugins/agent-policy/hooks/hooks.json`: `SubagentStart` エントリ追加
- `plugins/agent-policy/build.ts`: `entryPoints` に `src/hooks/subagent-start.ts` を追加（`scripts/` は保護パスであり、バンドル経由でのみ生成できる）
- `src/hooks/subagent-start.ts` 新設（ビルド出力 `scripts/subagent-start.mjs`）。marker 走査・対応表整形は `session-start.ts` から関数として抽出して共通化する（挙動変更なし。シグネチャは実装計画書で定める）。frontmatter パーサは YAML 配列形式の `tools` に対応させる（読めない形式は「欄なし = 注入する」側へ倒す）。方針スキル使用指示のブロックは共通化の対象外とし、SubagentStart 側からは出力しない
- `references/subagent-discipline.md` 新設（注入断片の静的正本。prompt-smith の対象）。`subagent-start.ts` が実行時に読み込み、対応表と合成する。配布物層が参照層を実行時に読む依存方向はこのプラグインで新規のため、ARCHITECTURE のレイヤー記述への影響判定（Done 条件の `/metatron:update`）の対象に含める
- `references/orchestration-discipline.md`・4 方針スキル・setup-agents スキル・README の改訂（§6）
- `src/hooks/__test__/subagent-start.test.ts` 追加
- `plugin.json` / `package.json` のバージョン上げ、ルート README 反映、ビルド差分の同コミット化

実装計画書で確定する主な事項: 抽出関数のシグネチャ / deny-list 走査の実施タイミングとキャッシュ / フック出力 JSON スキーマ / token 計測方法 / fail 時の stderr ログ方針 / §4 の 1 サーバー追加経路の要否 / 注入断片の実文面。

### 8. 実機検証項目

前提節の「文書上で確認した仕様」を実機で裏取りする。**実装計画書の作成より前に実施する**（結果が §1 の決定表と §5 の配布機構の両方を左右するため）。食い違った項目に応じて該当節を再設計し、ユーザーへ報告して再承認を得てから計画・実装に入る。

1. `model` param が宣言済み frontmatter より優先されること
2. proxy alias を frontmatter に持つホストへの enum 上書きが、Claude モデルでの実行になること（§1 判定 8 の前提）
3. `model` param が完全モデル ID を受け付けないこと（受け付ける場合、適用除外 4 の分類を再検討する）
4. `SubagentStart` が nested spawn（サブエージェント発の Agent tool 呼び出し）でも発火すること
5. `SubagentStart` の `additionalContext` が子サブエージェント（ビルトイン `general-purpose` を含む）の初回プロンプト前に届くこと。**これが不成立なら §5 は成立せず、配布機構を再設計する**
6. `SubagentStart` フック入力の `agent_type` の形式（名前空間プレフィックス付きか末段のみか。照合実装の確定）
7. `SessionStart` フックがサブエージェント spawn では発火しないこと（発火する場合、方針スキル使用指示が子に届いて二重注入・オーケストレーター化が起きるため、§5・§6 を再設計する）
8. 合成 dispatch の一連（役割冒頭明示・外部本文同梱・enum 宣言値の `model` param 適用・tools 規則）が代表 1 ケースで成立すること（手動シナリオ）
9. 実装帯ホストからのアドバイザー再委譲で、注入された対応表の advisor が実際に選ばれること（手動シナリオ）

### 実測結果（2026-08-27、サンドボックス `/tmp/ap-verify`・Claude Code 実機）

項目 1〜7 を確認した。**前提との食い違いは無い。**

- 1: 宣言 `haiku` の定義 + param `opus` → 子トランスクリプトは `claude-opus-5`（param が frontmatter に優先）
- 2: alias（`claude-grok-4-6`）宣言ホスト + param `haiku` → `claude-haiku-4-5-20251001` で実行（proxy 非経由）
- 3: param への完全モデル ID は enum スキーマ検証で dispatch 前に拒否（`InputValidationError`）
- 4: nested spawn（t-parent → t-unset）でも `SubagentStart` が両階層で発火し、孫にも注入が届いた
- 5: `additionalContext` はカスタム定義・ビルトイン `general-purpose` とも初回プロンプト前に到達（子トランスクリプト内に canary が出現し、子モデルの自己申告も YES）
- 6: project 定義・ビルトインとも入力の `agent_type` は末段のみ（`"t-haiku"` / `"general-purpose"`）。プラグイン定義の形式は未測のため、照合実装は完全形・末段の両対応とし、実装後の dogfood で確認する
- 7: `SessionStart` はサブエージェント spawn では発火しない（driver セッション数と記録数が一致）
- 補足: `model` 未宣言をそのまま起動すると driver のモデルを継承することも実測（`claude-sonnet-5`）

項目 8・9 は改訂後の規律文書と注入断片の実装を要するため、実装後の検証段階で行う（実装計画書に含める）。

## 移行期の運用条件

監査引き継ぎ書「現時点の安全な運用条件」のうち、本設計の実装・実機検証の完了で緩和されるのは「子 Agent が親と同じ custom role map を使う前提を置かない」だけである（SubagentStart 配布により、フック障害時を除き子にも対応表が届く）。残りの条件 — custom Agent のトップ階層配置と active policy の marker 明示、`setup-agents --write --merge` 前の `claude mcp list` 正常確認、Agent 名の他 scope・他 plugin との非重複 — は、対応する別課題（監査所見 1・2 および 4〜11）が修正されるまで継続する。

## 実施手順と Done 条件

1. 本設計書のレビューと、ユーザー承認
2. 着手時に最新 `git status` と現行 HEAD で対象コードを再確認し、`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の baseline を記録する。本改修と無関係な未コミット変更・未追跡ファイルは revert・削除・上書きしない
3. §8 の実機検証を行い、食い違いがあれば設計へ反映する（ユーザーへ報告して再承認を得る）
4. 実装計画書を作成し、設計書と同じレビュー系列を通す
5. テストを先に追加して実装する
6. Done 条件: `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。`src/` 変更に対応する `scripts/` 差分が同じコミットにある。`plugin.json` / `package.json` のバージョンが揃って上がる。ルート README に反映する。hooks 構成と新しいレイヤー依存（配布物 → 参照層）を ARCHITECTURE へ反映する（`/metatron:update` で差分を確定する）

## 不採用案

- **サイドカー割当マップ + setup ウィザード拡張**: セッション間の割当決定性は得るが、登録の検証装置・全 scope discovery・陳腐化管理が連鎖して必要になる。規律ベースで始め、固定が必要になったときの拡張点として残す
- **派生定義の生成（同名 shadow / 別名）**: 上流 drift の hash 管理・生成物の増加・名前解決優先順の実機検証が必要。合成 + `model` param で同じ目的を達成できる
- **CLAUDE.md への焼き込み・@import**: サブエージェント到達は得るが、全サブエージェントへの一律トークン課金・per-project ファイルの追加・プラグイン更新との陳腐化を伴う。`SubagentStart` で代替する
- **反転注入（最適化本文を外部 Agent へ注入）**: 最適化の真髄である MCP tools が文では移らず、届くのは本文成分だけである。廃止した
- **宣言済み外部 Agent の無条件な最適化ホスト実行（初版 v5 案）**: 宣言済み Agent には機械契約型が多く、`subagent_type` 差し替えが状態機械の検査を破壊することがレビューで実証された。適用除外 1〜3 で機械的に守った上で、非契約・帯適合の場合のみ判定フロー 8 で合成する形に縮小した
- **合成不成立時の完全そのまま起動（第 2〜3 版案）**: 第 3 巡レビューで、現行規律が与えていた「未宣言 Agent への帯モデル上書き」まで失う後退であることが判明した（例: codiel reviewer が Sonnet を失いメインモデルで走る）。ユーザー決定により「モデル注入起動」（元定義 + `model` param のみ）へ変更した
- **合成対象帯への `general` の包含（第 2〜3 版案）**: catch-all の `general` を含めると帯不適合の除外がほぼ空集合になり、読み取り系外部 Agent が実装ホストへ乗る事故経路になる。ユーザー決定により合成対象から除外した
- **SessionStart フックの全廃（CLAUDE.md 正本化）**: 検査役（alias 不一致・retired の警告）は静的文書で代替できない
- **SubagentStart の fail-closed**: 生成を block できないため中止を強制できず、採らない（§5）
- **SubagentStart 選別の allow-list 方式・同梱名ハードコード**: `tools` 欄省略の自作オーケストレーター型定義や走査不能な定義への配布が漏れる。deny-list 方式 + 同梱 `agents/` の実走査へ変更した

## 監査引き継ぎ書との対応

引き継ぎ書は `harness-docs/handover/2026-08-26-agent-policy-external-agent-compatibility-handoff.md` にある。「維持」「対応」だけでなく、**ユーザー決定による意図的な逸脱**を明示する。

| 引き継ぎ書の項目 | 本設計での扱い |
| --- | --- |
| 境界「workflow 専用 Agent はワークフローのオーケストレーターが直接 dispatch する」 | **一部逸脱（ユーザー決定）**。フック指示・契約 frontmatter・帯不適合の workflow Agent はそのまま起動またはモデル注入起動で境界を維持するが、帯適合の workflow Agent（実装・レビュー系）は合成対象に含める。引き継ぎ書が懸念した「ツール制限・入力契約・出力形式の破壊」は、適用除外 1〜3 の機械的判定・`general` の合成除外・§2 の役割冒頭明示・禁止条項優先・義務衝突時の合成回避で緩和する |
| P0: marker を明示 opt-in として固定 | 維持。帯参加は非目標。なお marker の opt-in の意味を「合成ホスト候補」へ拡張する（§2・§6。既存 marker 保有プロジェクトへは README 変更履歴で告知） |
| P0: 解決済み role map を再委譲先へ伝播 | **方式を変えて対応（逸脱あり）**。スナップショット同梱ではなく `SubagentStart` による spawn 時再解決・機械的配布とし、親子の解決差異とフック障害時の fail-open を許容する（§5）。配布は適用除外対象の Agent にも届き得る（過剰配布側に倒す逸脱） |
| P0: Agent discovery と role 解決の一貫 | 事前走査は拡張しない。合成に必要な原本確認は dispatch 時に project → user → plugin 実体の順で行い、確証がなければ合成しない（fail-safe）。所見 1・2 の修正自体は別課題 |
| 「map に該当 role がない場合だけ policy fallback」 | **逸脱**。フック障害時も fallback に流れる fail-open を採る（§5 に理由を明記。静的正本の読込失敗時は対応表のみ注入し、fallback 移行を最小化する） |
| 所見 3（role 解決が親セッションのみ） | §5 で対応（上記の逸脱つき） |
| 所見 4〜11 | スコープ外。別課題として残る。setup 安全性のテスト行列（MCP 列挙失敗・frontmatter 差異・locale）も同課題へ送る |
| テスト行列（Agent scope / policy と role / dispatch 階層） | **一部反映**。フック単体・回帰・両 policy での配布成立・複数 marker・文書整合はテスト計画に含む。dispatch 階層の振る舞いは自動テストでは検証できず、実機検証の手動シナリオ（§8.8・8.9）と移行期の運用確認に縮小する。自動化は将来課題 |
| 現時点の安全な運用条件 | 「移行期の運用条件」に反映。本設計で緩和されるのは親子 map 非仮定のみで、残りは対応する別課題の完了まで継続 |
| 次セッション開始手順（HEAD 再確認・baseline・無関係変更の保全・レビュー順・テスト先行） | 「実施手順と Done 条件」に反映。実機検証は実装計画書より前に置く |

## テスト計画（概要）

- `subagent-start`（単体）: deny-list 判定 — `tools` に `Agent` の無い project 定義 → 注入なし / `Agent` を含む project 定義・`tools` 欄なし定義・未知の type → 注入あり / 同梱定義は `agents/*.md` の実走査結果に従う（Agent tool 無しの同梱 → 注入なし。名前のハードコードに依存しない） / `Explore`・`Plan` → 注入なし / `agent_type` の完全形・末段の照合規則（衝突時は注入側） / YAML 配列形式の `tools` の parse / 注入文が「あなたはサブエージェントである」宣言と対応表を含み、方針スキル使用指示を含まない / 断片内 advisor 行が対応表の advisor を優先する / `references/subagent-discipline.md` の読込失敗 → 対応表のみ注入 / フック入力の parse 失敗 → exit 0 で無出力 / `additionalContext` が 10,000 文字を超えない
- `session-start`（回帰）: 走査ロジック抽出後の既存テスト全通過
- 対応表の同一性: SessionStart と SubagentStart が同じ入力から同じ対応表を生成すること。`claude-model-policy` / `codex-grok-policy` の両 policy で成立すること。複数 marker 宣言の定義が両フックで同一に扱われること
- 判定フローの文書検証: 4 方針スキル・orchestration-discipline の改訂文面が §1 の決定表と一致すること、4 方針スキル冒頭の読者宣言が訂正済みであること（変更セルの目視突き合わせ）
- dispatch 階層の振る舞いは実機検証（§8.8・8.9）と移行期の運用で確認する（監査対応表に記載のとおり縮小。自動化は将来課題）
