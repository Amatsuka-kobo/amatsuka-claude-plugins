# agent-policy 役割の再編(文書作成・探索統括の廃止、レビュー役割の改名と新設、setup-agents の役割単位生成) 設計書

- 作成日: 2026-09-24
- 対象プラグイン: `plugins/agent-policy`
- 現行バージョン: `0.19.8-dev` → `0.20.0-dev`
- 状態: 設計(実装前・第 3 版。第 2 版で未解決事項への決定と要件 9、第 3 版でレビュー指摘の採否を反映)
- context-map: なし(本設計で context-map を廃止する。実測はオーケストレーターが行い本依頼文で渡した)
- 関連: `harness-docs/design/2026-09-16-agent-policy-doc-writing-role-design.md`(`doc-writing` / D1 / F1 / G を足した 0.19.0 の設計。本設計はその大半を撤回する)、`harness-docs/GOTCHAS.md`(GOTCHA-001 / GOTCHA-002)

## 1. 背景と目的

0.19 系で足した役割 `doc-writing` は、執筆規律を 1 つの役割に閉じ込めた。その結果、文書を書くたびにオーケストレーターと impl 役割のサブエージェントが「文書作成」へ委譲・再委譲する経路ができた。この経路は段数とコストを増やす一方で、執筆規律そのものは他の役割へ届かなかった。

探索でも同じ形の問題がある。`explore-lead` が探索を統括して context-map を書き、`explore` がその実働を担う 2 段の構成は、オーケストレーターが自分で結果を突き合わせる運用と重複している。

レビュー役割は名前と対象がずれている。`doc-review` は設計書に限らず任意の成果物の暗黙知を抽出できるが、名前と断片が設計書に限定している。`independent-review` は設計書・実装計画書のレビューであることが ID から読めない。成果物を「破る立場」で読む役割は存在しない。

setup-agents はモデルごとに 1 定義を作る。1 つのモデルが推奨される役割をすべて 1 定義に束ねるため、readonly と impl が同居し、MCP の付与と役割の分離をウィザードで後から調整する手順が要る。

実装 4 役割と advisor は、どれに振るかの基準が主観語(「設計判断の有無」「迷ったとき」)に依存し、escalation には発火条件が無い。

本改修は次の 9 つを行う。

1. `doc-writing` を廃止し、執筆基準を全エージェント共通の基準にする。
2. `independent-review` を `design-review` へ、`doc-review` を `knowledge-elicitation` へ改名し、後者の対象を任意の成果物へ広げる。
3. 敵対的レビューの役割 `adversarial-review` を新設する。
4. setup-agents の既定を「1 役割 1 定義」にし、`--models` を `--recommended` に置き換える。
5. context-map と `explore-lead` を廃止し、探索は `explore` へ直接委譲する。
6. `e2e-verify` の推奨モデルから `gpt-astra` を外す。
7. 実装 4 役割の振り分けを観測可能な基準にし、escalation の発火条件を定める。
8. advisor へ相談する条件と、オーケストレーター側の相談の規律を定める。
9. ModelId `gemini-flash` とベンダー `gemini` を削除する。

## 2. 確定要件(ユーザー承認済み 2026-09-24。本設計はこれを前提とし、覆さない)

### 2.1 要件 1: `doc-writing` の廃止と執筆基準の標準化

1. `doc-writing` を `RoleId` / `ROLES` / `RECOMMENDED` / `ASSIGNMENTS` / `SOLO_DENIED_ROLES` から削除する。断片 `assets/roles/{ja,en}/doc-writing.md` を削除する。
2. 旧 `doc-writing` 断片の §作業手順 にある執筆基準(言語の正しい文脈と文法、簡潔さ、難しい言い回しと回りくどい言い回しの回避、引用と出典を必要な分に絞る、英語以外は直訳せず意訳する)を全エージェント共通にする。置き場所は次の 2 箇所とし、読者が違うため重複を許す。
   - `assets/roles/{ja,en}/_common.md` の新しい節。見出しは ja `## 文書の執筆`、en `## Writing`。見出しを `src/agents/vocabulary.ts` に足し、`src/agents/compose.ts` が `withAgent` に関わらず出力する。位置は `## 制約` の直前。日本語の言い換え例(Version、Green / Red、Frozen Document、Ledger、Step の 5 つ)は ja 断片にだけ置く。en 断片には日本語を書かない。
   - `references/orchestration-discipline.md`。オーケストレーター自身がファイルとして残す文書を書くときの規律として置く。
3. オーケストレーターはファイルとして残す文書を自分で書いてよい。§オーケストレーターが自ら担う作業 から、文書を自ら書かず「文書作成」へ委譲する条項(F1)を撤去する。
4. §文書作成を委譲するとき を「文書の執筆を委譲するとき」へ改題し、役割に依存しない規則として残す。残す内容は、依頼文に載せるものの形(事実・決定事項・制約・受け入れ基準・章立て・用語・参照先パスを箇条書き・表・キーワードで)、完成文を載せない、例には「本文に載せる」を添える、閉じた列挙にしない、判断の軸を書く、の 5 つである。GOTCHA-002 の対策であり削らない。
5. `_common.md` の `## Agent tool の制約` / `## Agent tool limits` から、文書作成への再委譲(D1)の項目をすべて撤去する。`Agent` tool の用途はアドバイザーへの相談だけに戻す。§制約 にある「本文に載せる」の受信側の 2 規則は文書一般の規則として残す。
6. §サブエージェントの規律 の「サブエージェントは〜」12 条項から、doc-writing への再委譲を定めた 1 条項を削除する。
7. `assets/roles/{ja,en}/general.md` の description を「定型メンテナンス・文書作成など、レビュー・設計を除く一般作業」の趣旨へ戻し、When to invoke と Core Responsibilities に文書作成を戻す(オーケストレーター決定 2026-09-24)。
8. `assets/roles/{ja,en}/design-plan.md` から、doc-writing を前提にした L31「文書の文体は、担当表の『文書作成』の役割の規律に従う」を削除する(ja / en とも。オーケストレーター決定 2026-09-24。§3.3-3)。
9. MCP の既定付与の役割列挙(SKILL.md ステップ 5c-3、プラグイン README L103)から `doc-writing` を外す(§3.3-1)。

### 2.2 要件 2: レビュー 2 役割の改名と対象の拡大

1. `independent-review` → `design-review`。役割名「設計書・実装計画書のレビュー」。default-name `docs-reviewer`、種別 readonly、Agent Tool 可、Claude モデル Sonnet、`RECOMMENDED` の要素(sonnet と grok。並びは §2.4 の並べ替えに従う)、断片本文(原本のみを読む、他のレビューの指摘を読まない、前提の検証と根拠付きの反証、採否はオーケストレーター)はすべて引き継ぐ。§委譲先の解決 の「順 2 と順 3 へ進めず、対応表に無ければ省略する。他の役割で代行しない」も引き継ぎ、役割名の表記だけを追随させる。制約文の冒頭の役割スコープ句は新しい役割名に合わせる(オーケストレーター決定 2026-09-24)。
2. `doc-review` → `knowledge-elicitation`。役割名「暗黙知の抽出・理解レビュー」。default-name `knowledge-elicitor`、種別 readonly、Agent Tool 否、Claude モデル Haiku、`RECOMMENDED` `["haiku"]`、tools `Read, Grep, Glob`。対象を設計書・実装計画書から、文書・指示書・仕様・コードなど任意の成果物へ広げる。Output Format(理解した内容 / 暗黙知 / 矛盾・不整合 / 記述の過不足)は維持する。
3. 旧 ID `doc-review` と `independent-review` は残さない(§9)。
4. `ROLES` の位置は、`design-review` が旧 `independent-review` の位置、`knowledge-elicitation` が旧 `doc-review` の位置。
5. §設計・実装計画の規律 の流れは「`knowledge-elicitation` でレビュー → `design-review` に原本のみを渡して dispatch → オーケストレーターが採否」の順とし、役割名を追随させる。

### 2.3 要件 3: `adversarial-review` の新設

1. id `adversarial-review`、役割名「敵対的レビュー」、default-name `adversary`、種別 readonly、tools `Read, Grep, Glob, Bash`、Agent Tool 否(`SOLO_DENIED_ROLES` へ追加)、Claude モデル Opus、`RECOMMENDED` `["opus", "gpt-sol"]`。
2. `ROLES` の位置は `gate-review` の直後、`advisor` の直前。`advisor` は末尾のまま。
3. 担当範囲は、設計書・実装計画書・コード・指示書・テストなど任意の成果物を破る立場で読み、失敗経路・境界条件・前提の突き崩し・具体的な反例(再現手順)を示すこと。採否は判断しない。
4. 標準フローには組み込まない。§設計・実装計画の規律 は変えず、オーケストレーターが要ると判断したときだけ起動する。
5. When to invoke に、`design-review`(別ベンダーによる前提の検証。原本のみ)と `final-review`(重要な実装の完了可否)との違いを書く。
6. ja / en の断片を新規作成する。断片本文で `###` 見出しを使わない。

### 2.4 要件 4: setup-agents の既定を 1 役割 1 定義にする

1. CLI: `--models <csv>` を廃止フラグにし、`--policy` 等と同じく `ok: false` を返す。新フラグ `--recommended [--roles <role-id,...>]` を足す。
   - 役割ごとに候補モデルの列を先頭から評価し、live models に実在する最初の ModelId を採る。候補の列は `--scope custom` なら `RECOMMENDED[role]`、`--scope claude` なら `ASSIGNMENTS["claude-model-policy"][role]`。照会に失敗したときは先頭を採り、`warnings` に入れる。Claude enum は常に実在とみなされるため、各行は最初の Claude enum で必ず止まる。候補がすべて不在になる経路は無いため、`rolesDropped` は作らない(オーケストレーター決定 2026-09-24。§4.5)。
   - 定義名は `<model-id>-<default-name>`。`roles` は単一。vendor と color は ModelSpec から取る。`results[]` の各要素に `roleId` を付ける。`modelsDropped` は廃止し、代わりのキーは設けない。
   - `--roles` で対象の役割を絞れる。MCP を付ける役割群と付けない役割群で `--write` を 2 回に分けられるようにするためである。
   - `--check --recommended` は同じ対象の差分だけを返す。
   - `--recommended` と `--model-id` / `--name` / `--model` / `--vendor` / `--keep` の併用は `ok: false` で拒否する。vendor は ModelSpec から取り、`--vendor` を当てない(オーケストレーター決定 2026-09-24)。
   - `recommendedRolesFor` は呼び出し元が無くなるため削除する(オーケストレーター決定 2026-09-24。§3.3-2)。
   - `--model-id … --name … --model … --roles …` の個別経路、`--list-coverage`、`--list-roles`、`--list-live-models`、`--merge` / `--keep`、MCP の付与、翻訳断片の仕組みは変えない。
   - `RECOMMENDED` の並びを役割ごとに §5.2 の表へ並べ替える。解決規則(先頭から順に、live models に実在する最初の ModelId)は変えない。`ASSIGNMENTS` は変えない(ユーザー決定 2026-09-24。§4.11)。
2. `skills/setup-agents/SKILL.md` をモデル中心から役割中心の手順へ書き換える(§5.12)。
3. `src/__test__/setup-agents.test.ts` の describe「--models による推奨一括」を `--recommended` の検査に書き換え、describe「廃止フラグ」に `--models` を足す。custom を要するケースは `--scope custom` を明示する。

### 2.5 要件 5: context-map と `explore-lead` の廃止

1. `explore-lead` を `RoleId` / `ROLES` / `RECOMMENDED` / `ASSIGNMENTS` から削除し、断片 `assets/roles/{ja,en}/explore-lead.md`、`references/context-map-guide.md`、`assets/context-map-template.md` を削除する。
2. ルート `.gitignore` の `.claude/context-maps` 行は残す。既存の `.claude/context-maps/` の扱いは各プロジェクトに任せ、README の移行節で案内する。
3. `explore` は id と default-name を維持し、役割名を「コードベース探索実働」から「コードベース探索」へ変える。断片から統括の存在を前提にした記述を外し、オーケストレーターから直接依頼される形にする。Output は事実の報告(パス・行番号・根拠)。種別 readonly と Agent Tool 可は維持する。
4. 規律の §コードベース探索、§設計・実装計画の規律 の先頭、§分析 の突き合わせ対象から context-map を外す(§5.10)。
5. `design-plan` 断片(ja/en)と `_common.md`(ja/en)§制約 の context-map 条項を「渡された探索結果と実コードに食い違いがあれば報告する」へ一般化する。
6. MCP の既定付与の役割列挙から `explore-lead` を外す。要件 1 と合わせ、列挙は `complex-impl` / `normal-impl` / `light-impl` / `escalation` / `general` / `design-plan` の 6 件になる。
7. 役割数は 17 → 16(`doc-writing` −1、`explore-lead` −1、`adversarial-review` +1)。

### 2.6 要件 6: `e2e-verify` の推奨モデル

`RECOMMENDED["e2e-verify"]` を `["sonnet", "gpt-astra"]` → `["sonnet"]` にする。`ASSIGNMENTS` は Sonnet のまま。

### 2.7 要件 7: 実装 4 役割の基準

1. §モデル別役割の運用 と 4 断片の When to invoke を、次の観測できる基準で揃える。上から順に評価し、最初に該当した役割にする。各役割の条件はどれか 1 つに当たれば該当とする。
   - `escalation`: 同じ作業を同じ実装役割へ 2 回委譲して完了しない / 実装役割から差し戻され、原因が特定されていない / テスト・型検査・lint の失敗を実装役割が 2 回直しても解消しない。
   - `complex-impl`: 公開インターフェース(型・API・CLI 引数・ファイル契約・フック)を変える / 2 つ以上のコンポーネント(パッケージ・プラグイン・層)を同時に変える / 参照できる既存パターンが無く、新しい構造を決める / 失敗の影響が全セッション・保護パス・データ移行に及ぶ。
   - `normal-impl`: 1 コンポーネント内 / 既存パターンの踏襲 / 公開インターフェース不変。テストの追加・修正、設定編集、ビルド・テストの実行を含む。
   - `light-impl`: 変更内容が依頼文で完全に指定されている / 対象を Glob・Grep で列挙できる / 新しいロジックを書かない(一括適用・一括チェック・反復変換・定型の小変更)。
2. escalation の運用規律をオーケストレーター側に足す。発火条件に当たったら、オーケストレーターは自分で原因を追わず escalation へ委譲する。依頼文には試行履歴(誰に何を頼み、何が返ったか)、失敗出力の原文、未解決の制約を載せる。初回の作業を escalation へ委譲しない。
3. `escalation` 断片に、上の入力を要求し、無ければ差し戻す 1 行を足す。When to invoke に発火条件を書く。
4. `complex-impl` / `normal-impl` / `light-impl` 断片は When to invoke だけを上の基準で書き直す。Core Responsibilities・作業手順・制約・Output Format は維持する。
5. 4 断片とも en 版を同じ内容で追随させる。

### 2.8 要件 8: advisor の基準

1. `_common.md`(ja/en)§アドバイザーへの相談、規律の「サブエージェントは〜」のアドバイザー条項、`advisor` 断片の When to invoke を次の基準で揃える。
   - 相談する条件(どれか 1 つ): 依頼文に無い判断が要り、選択肢が 2 つ以上あり、どれを選ぶかで成果物の構造(インターフェース・ファイル配置・依存関係)が変わる / 依頼文と実コードが食い違い、どちらに合わせるかを依頼文から決められない / テスト・型検査の失敗に原因候補が複数あり、再現で 1 つに絞れない。
   - 相談しない条件: 依頼文に書かれた事項の確認は依頼文を読む / Read・Grep で確かめられる事実は自分で確かめる / 命名・表記・並び順は既存パターンに合わせて自分で決める / 作業範囲の拡大が要る判断は差し戻す。
2. 規律 §分析 にオーケストレーター側の条項を足す。レビューの指摘が互いに対立し採否の軸を自分で言葉にできないとき、または要件確定で選択肢が 2 つ以上ありユーザーへ示す判断軸を自分で立てられないときは、advisor へ諮り、軸と推奨を受け取ってから判断する。結論はオーケストレーターが出し、advisor に採否を委ねない。
3. 依頼文の必須項目は、選択肢の列挙、判断を縛る制約、関係ファイルのパスの 3 つ。advisor 断片は、これらが無ければ推測せず不足を返す(現行維持)。
4. advisor 断片の Output は推奨を 1 案にし、条件付きなら条件を明記する。「判断できない事項」の欄は維持する。
5. 推奨モデル(Fable / gpt-astra)と Agent Tool 否は維持する。

### 2.9 要件 9: ModelId `gemini-flash` とベンダー `gemini` の削除(ユーザー決定 2026-09-24)

1. `gemini-flash` を `ModelId` と `MODELS` から削除する(10 件 → 9 件)。
2. `Vendor` から `gemini` を外し、`gpt` / `grok` / `claude` / `none` の 4 値にする。`COLORS` / `VENDOR_COLORS` の `gemini`、`--vendor` の検証と推定失敗時の文言、`LiveVendor`、`live-models.ts` の `antigravity` → `gemini` の推定を追随させる。`owned_by` が `antigravity` のモデルは `unknown` に戻る。
3. `skills/setup-agents/SKILL.md` の既定エイリアスの列挙(`gemini-flash` = `claude-gemini-3-8-flash`)と、ベンダーの 5 値の列挙(ステップ 4・5b・6・6b)を追随させる。
4. プラグイン README のモデル表とベンダーの説明を追随させる。移行節に、`gemini-flash` と `gemini` の削除、Gemini のエイリアスを使うときはベンダーが `unknown` になるため個別調整で `--vendor none` か他のベンダーを選ぶことを書く。
5. `.gemini.md` の overlay 断片は存在しないため、断片の削除は無い。
6. `live-models.test.ts` / `policies.test.ts` / `setup-agents.test.ts` / `compose.test.ts` / `discipline-role-table.test.ts` の `gemini-flash` と `gemini` を固定する検査を追随させる。

### 2.10 全体

1. `plugin.json` と `package.json` を `0.19.8-dev` → `0.20.0-dev` に揃える。
2. プラグイン README の役割一覧、MCP の説明、L5 の概要文を更新し、移行節「0.19 系から 0.20 系へ」を新設する。ルート `README.md` は L100 から「context-map」の語を外し、L104 の役割数を 16 種に、L106 のサポートする推奨モデルから Gemini を外す。
3. `.serena/memories/agent_policy/core.md` を Serena のツールで更新する。
4. このリポジトリの `.claude/agents/`(git 追跡外、14 定義)を実装後に再生成する。既存の定義名と役割構成を保ち、個別経路で保持マージする(ユーザー決定 2026-09-24。§5.16)。GOTCHA-001 の手順に従う。
5. ARCHITECTURE と ADR は層と依存方向が変わらないため更新しない。
6. 委譲先にロードさせるスキルの本文と参照文書の合計が 30,720B 以下であることを、実装後に `wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md` の合計で確認する(§4.10)。

## 3. 前提(実測)

### 3.1 コードの現況

| 対象 | 実測 |
| --- | --- |
| `src/agents/roles.ts` L3-20 | `RoleId` 17 種。L30-133 が `ROLES` 17 件。並びは complex-impl, normal-impl, light-impl, escalation, general, design-plan, doc-writing, explore-lead, explore, realtime-research, e2e-verify, independent-review, doc-review, code-review, final-review, gate-review, advisor |
| 同 L80-84 | `explore` の label は「コードベース探索実働」 |
| `src/agents/policies.ts` L133-156 | `ASSIGNMENTS["claude-model-policy"]` が 17 役割を持つ |
| 同 L159-177 | `RECOMMENDED` が 17 役割を持つ。全役割の先頭要素が Claude のモデル(opus / sonnet / haiku / fable)である |
| 同 L181-188 | `SOLO_DENIED_ROLES` = advisor, doc-review, code-review, final-review, gate-review, doc-writing |
| 同 L191-193 | `allowsAgentTool(ids)` は役割だけで判定する |
| 同 L4-15 / L27-128 | `ModelId` 10 種、`MODELS` 10 件。末尾(添字 9)が `gemini-flash`(vendor `gemini`、model `claude-gemini-3-8-flash`、color green) |
| 同 L166 | `RECOMMENDED` で `gemini-flash` を持つのは `doc-writing` だけ |
| 同 L230-235 | `CLAUDE_ENUM_MODELS` = sonnet, opus, haiku, fable |
| `src/agents/fragments.ts` L6 | `Vendor` = `gpt` / `grok` / `gemini` / `claude` / `none` |
| `src/agents/compose.ts` L32-38 / `src/setup-agents.ts` L78-84 | `COLORS` / `VENDOR_COLORS` に `gemini: "green"` |
| `src/agents/live-models.ts` L32-33 | `owned_by` が `antigravity` のとき `gemini` を返す |
| `src/setup-agents.ts` L267 / L940-948 | 推定失敗の文言と `--vendor` の検証が 5 値(`gemini` を含む) |
| `assets/roles/{ja,en}/` | `.gemini.md` の overlay 断片は無い |
| `src/agents/vocabulary.ts` L3-12 | `Vocabulary` は `advisorHeading` / `agentConstraintHeading` / `constraintHeading` などを持つ。執筆の見出しは無い |
| `src/agents/compose.ts` L77-91 | `withAgent` が真のときだけ advisor 節と Agent tool の制約を出す。続いて `_common` の `## 制約` と各断片の `## 制約` を 1 節に束ねる |
| `src/agents/compose.ts` L12-22 | `ComposeInput` は `modelId` を持たない(0.19 系で除去済み) |
| `src/agents/fragments.ts` L218-265 | 翻訳断片の stale 判定は `_common.md` を含む同梱ファイル全件の本文ハッシュで行う |
| `src/setup-agents.ts` L40-61 | `Options` は `models: ModelId[]` を持ち、`recommended` は無い |
| 同 L72-76 | `TargetResolution` は `modelsDropped: ModelId[]` を持つ |
| 同 L182-188 | `recommendedRolesFor(modelId)` の呼び出し元は L231(`defaultAgentName`)と L315(`--models` 経路)の 2 箇所だけ |
| 同 L230-244 | `defaultAgentName` は推奨役割が 1 件のときだけ `<model-id>-<default-name>`、それ以外は `<model-id>` を返す。呼び出し元は L313(`--models` 経路)だけ |
| 同 L273-275 | `modelIsAvailable` は Claude enum を常に実在とみなす |
| 同 L279-321 | `targetsFor` の `--models` 経路。モデルごとに 1 定義を作り、vendor は `resolveVendor`(live の推定を使い、`unknown` で throw)で決める |
| 同 L693-715 | `setup()` は `{ ok, results, warnings, modelsDropped }` を返す。`results[]` の要素は `modelId` / `mcpCurrent` / `mcpDropped` を持ち、`roleId` は無い |
| 同 L910-915 | 廃止フラグ(`--policy` / `--list-policies` / `--list-models`)は throw で `ok: false` を返す |
| 同 L1023-1028 | `--models` と `--keep` の併用は拒否する |
| `assets/roles/ja/_common.md` | 節は Preamble(L5)/ アドバイザーへの相談(L11-16)/ Agent tool の制約(L18-32)/ 制約(L34-43)。L20-32 が D1 の再委譲の規定。L42 が context-map 条項。en も同じ構成 |
| `assets/roles/{ja,en}/design-plan.md` | description(L4)・Core Responsibilities(L16)・作業手順(L20)が context-map に触れる。L31 が「文体は『文書作成』の役割の規律に従う」 |
| `assets/roles/{ja,en}/general.md` L4 / L12 | description と When to invoke が「文書作成を除く」と書く |
| `assets/roles/ja/doc-writing.md` L22-32 | 執筆基準 5 項目と日本語の言い換え例 5 つ |
| `references/orchestration-discipline.md`(192 行、24,316B) | §担当表 L4-29(L26 の説明文が `[doc-writing]` を例に使う)/ §委譲先の解決 L31-55(L55 が独立レビューの省略規則)/ §オーケストレーターが自ら担う作業 L57-81(§分析 L63-69、§文書作成を委譲するとき L71-81)/ §モデル別役割の運用 L83-99(L86-88 が実装 3 役割の基準)/ §サブエージェントの規律 L101-114(L107 が doc-writing 再委譲、L108 がアドバイザー)/ §委譲先の実行モデルの確定 L116-170 / §コードベース探索 L172-178 / §コスト規律 L180-183 / §設計・実装計画の規律 L185-192 |
| `references/context-map-guide.md` | 6,169B。方針スキル(`custom-policy` / `claude-model-policy`)の参照には入っていない |
| `skills/custom-policy/SKILL.md` / `skills/claude-model-policy/SKILL.md` | 2,421B / 883B。方針スキルが読む参照は `orchestration-discipline.md` だけであり、合計は custom 26,737B、claude 25,199B |
| `skills/setup-agents/SKILL.md`(356 行) | 非対話モード L37-66(L45-46 にモデル ID の固定一覧 2 つ)、ステップ 4 L157-176、ステップ 5 L178-200、ステップ 5b L202-246、ステップ 5c L248-271(L260 が MCP 既定の役割列挙、L264 が `explore` / `explore-lead` の同居例)、ステップ 6 L273-294、ステップ 6b L296-326(L310 が役割をまとめる質問)、ステップ 7 L328-356 |
| `plugins/agent-policy/README.md` | L5 に「context-map」、L103 に MCP 既定の役割列挙、L109-129 に役割一覧表(17 種)、L131-144 にモデル ID の表(10 種、L144 が `gemini-flash`)、L146-150 に `gemini-flash` を Antigravity 経由で使うときの注記、L214 以降に「旧バージョンからの移行」(新しい順。0.19 節の 5 項目めと 9 項目めが `gemini` を追加した記述) |
| `skills/setup-agents/SKILL.md` L45 / L100 / L163 | `gemini-flash` を含むモデル ID の列挙と既定エイリアスの対応 |
| 同 L170-174 / L232 / L291 / L321 | ベンダーの 5 値の列挙(`gemini` を含む) |
| ルート `README.md` L100 / L104 / L106 | L100 がプラグイン説明の「context-map の作成指針」、L104 が「全17種の役割」、L106 が「推奨モデルとして GPT・Grok・Gemini をサポート」 |
| ルート `.gitignore` L13 / L14 | `.claude/context-maps` と `.claude/agents` |
| `.serena/memories/agent_policy/core.md` | L21-23 が現行設計書として 0.19.0 の設計を挙げる。L95-98 に役割 ID の列挙と `doc-writing` の説明 |
| `.serena/memories/core.md` L150 / L163-164 | `.claude/context-maps`、`independent-review`、`doc-review` に触れる |
| このリポジトリの `.claude/agents/` | 14 定義。役割マーカーは §5.16 の表のとおり。7 定義が `disallowedTools` を持つ |

### 3.2 テストが固定している値

| ファイル:行 | 固定している値 |
| --- | --- |
| `src/agents/__test__/roles.test.ts:11-31` | 役割 ID 17 件の列挙と件数 |
| 同 `:34-43` | `doc-writing` の label・kind・tools |
| 同 `:44-58` | `design-plan` と `explore-lead` の label・kind・tools |
| 同 `:140` | `advisor` が末尾 |
| `src/agents/__test__/fragments.test.ts:57` / `:64` | 断片 17 件、`doc-writing` の default-name |
| `src/agents/__test__/policies.test.ts:19-77` | `EXPECTED_CLAUDE_ASSIGNMENTS` / `EXPECTED_RECOMMENDED` / `EXPECTED_AGENT_TOOL`(全役割) |
| 同 `:104` / `:116` / `:238` | テスト名の「17 役割」 |
| 同 `:210-221` | `rolesFor("sonnet")` 8 件(`doc-writing` と `independent-review` を含む) |
| `src/agents/__test__/compose.test.ts:119-122` | `explore, explore-lead, general, design-plan` の並べ替え |
| 同 `:213-232` | Agent tool の制約の文言 `` `Agent` tool を使うのは `` の有無と重複 |
| 同 `:248` / `:261` | Output Format の小見出しと冒頭宣言に「コードベース探索実働」 |
| 同 `:433` / `:467` | プロジェクト断片のフィクスチャの label に「コードベース探索実働」 |
| `src/__test__/setup-agents.test.ts:467-469` | `claude-gpt-6-sol` の `recommendedFor` が `["complex-impl"]` |
| 同 `:251-254` | `independent-review` の本文の「**独立レビューとして依頼されたときは**」 |
| 同 `:587-597` | 英語で合成した定義に日本語と日本語約物が混入しない。合成するのは `complex-impl` と `explore` の 2 役割だけ |
| `src/agents/__test__/discipline-role-table.test.ts:155` | 担当表の行数 = `ROLES.length`。5 列を `ROLES` / `allowsAgentTool` / `ASSIGNMENTS` と突き合わせる |
| `src/hooks/__test__/marker-scan.test.ts:309` | `explore-lead` の label |
| `src/hooks/__test__/session-start.test.ts:654` / `:732` / `:802` | 注入文に `explore` の label「コードベース探索実働」 |
| `src/agents/__test__/compose.test.ts:194-211` | 本文の節の順序(執筆の節は無い) |
| `src/__test__/setup-agents.test.ts:275-287` | 廃止フラグ 3 種 |
| 同 `:355-369` | `--scope claude` の `--models` が外部モデルを落として `modelsDropped` を返す |
| 同 `:472-480` | `claude-gpt-6-astra` の `recommendedFor` に `e2e-verify` |
| 同 `:543` / `:610` | `--list-coverage` の役割 17 件 |
| 同 `:737-754` | `--list-roles` の ID 列(`doc-writing` / `explore-lead` / `independent-review` / `doc-review` を含む) |
| 同 `:950-961` / `:1012` | `independent-review` を使う `--check` と `agentToolFor` |
| 同 `:1829-` | describe「--models による推奨一括」(`--models` を使う 7 箇所、`modelsDropped` の検査 2 箇所) |
| 同 `:84` | 応答型の `modelsDropped: string[]` |
| 同 `:146-160` | `AMBIENT_ENV_VARS` が `AMATSUKA_AGENT_AUTO_INJECTION` を落とすため、既定の scope は claude になる |
| 同 `:129` / `:1782` / `:1917` | 応答型の vendor union、`--vendor gemini` の `it.each`、推定失敗の文言に `gemini` |
| `src/agents/__test__/policies.test.ts:124` / `:155-167` / `:170-178` | `MODELS` 10 件、ID の全件の並び、`modelById("gemini-flash")` の値。`:144` / `:152` の `MODELS.at(7)` / `at(8)` は `gemini-flash` より前の要素であり、削除の影響を受けない |
| `src/agents/__test__/compose.test.ts:78-80` / `:98` | vendor `gemini` の色 green、vendor marker の配列 |
| `src/agents/__test__/live-models.test.ts:47-70` | `owned_by: "antigravity"` が `gemini` になる |
| `src/agents/__test__/discipline-role-table.test.ts:27` | `MODEL_IDS` の `"Gemini Flash": "gemini-flash"` |

### 3.3 依頼文の記載と実コードの食い違い

1. **`src/setup-agents.ts` に MCP 既定付与の役割列挙は無い。** 依頼文は「`src/setup-agents.ts` と SKILL.md 5c-3、README L103 から `doc-writing` / `explore-lead` を外す」とするが、`setup-agents.ts` は役割の列挙を持たない(`grep -n "explore-lead\|doc-writing" src/setup-agents.ts` が 0 件)。MCP の既定配分はウィザードが SKILL.md の列挙に従って計算し、CLI は渡された `--mcp-servers` をそのまま付ける。本設計では SKILL.md と README の 2 箇所だけを直す。
2. **`recommendedRolesFor` は `--list-roles` / `recommendedFor` / 推奨外役割の警告では使われていない。** 依頼文は「使い続ける」とするが、これは実測の誤りである。実際の呼び出し元は `defaultAgentName` と `--models` 経路だけである。`--list-roles` は `listAvailableRoles` が断片から組み立て、`recommendedFor` は `recommendedForAlias` が、警告は `validateRoles` が `RECOMMENDED` を直接引く。`--models` の廃止で呼び出し元が無くなるため削除する(オーケストレーター決定 2026-09-24)。
3. **`design-plan` 断片に「内容が確定した後の文章化・推敲・翻訳は再委譲してよい」の 1 行は無い。** その文言は `_common.md` の Agent tool の制約(ja L23 / en L23)にあり、要件 1-5 の D1 撤去に含まれる。`design-plan` 断片で doc-writing を前提にしているのは L31「文書の文体は、担当表の『文書作成』の役割の規律に従う」(en L31 も同旨)であり、これを削除する(オーケストレーター決定 2026-09-24)。
4. このリポジトリの `.claude/agents/` の `system-planner.md` は `design-plan, explore-lead` を持ち、`complex-reviewer.md` は `e2e-verify, final-review, gate-review` を `gpt-astra` で持つ。要件 6 の後、`gpt-astra` の `e2e-verify` は推奨外になる(§5.16。警告を受容する)。
5. 依頼文が挙げていなかった、`explore` の役割名を固定する検査(`session-start.test.ts:654` / `:732` / `:802`、`compose.test.ts:248` / `:261` / `:433` / `:467`)と、節の順序を固定する `compose.test.ts:194-211` がある。§7 に含めた。プラグイン README L5 の「context-map」と `.serena/memories/core.md` の旧 ID・context-map の記述も更新対象に含めた。

## 4. 設計判断

### 4.1 執筆基準の置き場所と出力条件

**決定: `_common.md` に新節を置き、`compose.ts` が常に出力する。規律にも同じ基準を置く。**

`_common.md` の節は合成された全定義に届く。Agent Tool の可否で出し分けると、Agent 否の役割(`code-review` など)が報告以外の文書を書く場面で基準を持たない。そこで `withAgent` に関わらず出す。位置は advisor 節の後、`## 制約` の直前とする。`## 制約` は `_common` と各断片の制約を束ねた節であり、その前に独立した節として置けば束ねる処理に触れない。

`Vocabulary` に執筆の見出しを 1 フィールド足す(名前は実装で既存の命名に合わせる。例: `writingHeading`)。ja は `## 文書の執筆`、en は `## Writing`。ja / en 以外の言語は en の語彙を使うため、翻訳断片の `_common.md` も英語見出し `## Writing` を持つ必要がある。

規律にも同じ基準を置く。規律の読者はオーケストレーターであり、生成された定義の本文を読まない。定義の読者はサブエージェントであり、規律を読まない。0.17 で「同じ規律を複数の指示書に書かない」を原則にしたが、この 2 つは読者が重ならないため例外とする。規律側の置き場所は §オーケストレーターが自ら担う作業 の下とし、F1 を撤去した後の「オーケストレーターは文書を自分で書いてよい」と並べる。

日本語の言い換え例は ja の `_common.md` にだけ置く。en の `_common.md` には「対象言語の慣用に合わせ、直訳を避ける」という一般基準だけを書く。`compose.test.ts:587` の英語純度検査がこれを担保する。現行の検査は `complex-impl` と `explore` の 2 役割しか合成しないため、T5 で `ROLES` の全 id を 1 件ずつ en で合成して検査する形に広げる。広げた後は、全役割の en 断片と en の `_common.md` の全節が検査の対象になる。規律(日本語の文書)には言い換え例を置いてよいが、`_common.md` と重ねる必要は無い。置くかどうかはバイト上限(§4.10)と合わせて実装時に決める(判断の軸: オーケストレーターが書く文書の言語が日本語に偏るなら置く)。

`_common.md` の本文ハッシュが変わるため、ja / en 以外で翻訳断片を持つプロジェクトは `_common.md` が stale になり、再翻訳するまで生成が止まる(`validateFragments`)。これは断片を変えるたびに起きる既存の挙動であり、移行節で案内する。

### 4.2 「文書の執筆を委譲するとき」を役割に依存しない規則として残す

`doc-writing` を廃止しても、オーケストレーターが文書の執筆を他の役割(`general`、`normal-impl` など)へ委譲する場面は残る。依頼文へ完成文を載せない規則と「本文に載せる」の添え書きは、GOTCHA-002 の対策であり、委譲先の役割に関係なく効く。節名から「文書作成」の役割名を外し、各条項の「文書作成を委譲する依頼文」も「文書の執筆を委譲する依頼文」へ言い換える。委譲先の解決は §委譲先の解決 と担当表に従うため、この節で委譲先の役割を名指ししない。

受信側の 2 規則(`_common.md` §制約 の「本文に載せる」の扱い、§サブエージェントの規律 の最後の 2 条項)は残す。

撤去するのは、「文書作成へ委譲せよ」という経路の規定(F1 と D1)と、「文章を考えること自体が文書作成の委譲先の役割である」の 1 項である。後者は役割を名指ししており、経路を撤去した後は意味を持たない。

### 4.3 改名は旧 ID を残さない

旧 ID から新 ID への読み替え表を持たない。理由は §9 の不採用案に書く。生成済みの定義は、`agent-policy-role` を書き換えるか setup-agents で再生成する必要がある。旧 ID のマーカーを持つ定義は、フックからは組み込みに無い役割として扱われ、役割名が引けない(`marker-scan.ts` `roleLabel`)。移行節で書き換えを案内する。

新しい label「設計書・実装計画書のレビュー」は、0.19 系では `doc-review` の label だった。0.20 系では `design-review` を指す。過去の会話記録や設計書で同じ語が別の役割を指すため、移行節に対応を書く。

### 4.4 `adversarial-review` の位置と Agent Tool

`ROLES` の並びは担当表の行順、`--list-roles` / `--list-coverage` の順、CSV マーカーの並びにそのまま出る。レビュー系(`design-review` / `knowledge-elicitation` / `code-review` / `final-review` / `gate-review`)の後ろに置くとレビュー群が連続する。`advisor` は末尾に残るため `roles.test.ts:140` は壊れない。

Agent Tool を否にする。敵対的レビューは成果物を読んで反例を返す作業で、再委譲も相談も要らない。迷ったときは差し戻しで解く。`SOLO_DENIED_ROLES` へ入れる。

tools に `Bash` を含めるのは、反例の再現(テストやコマンドの実行)に要るためである。readonly のため、依頼文で「ファイルを変更しない」を明記する規律(§モデル別役割の運用)がそのまま当たる。

標準フローに組み込まないため、§設計・実装計画の規律 には書かない。役割の存在は担当表の 1 行と断片の When to invoke で伝わる。

### 4.5 `--recommended` の解決手順

役割ごとに 1 つの Target を作る。手順は次のとおり。

1. 対象の役割を決める。`--roles` があればそれを使い、無ければ `ROLES` の全役割とする。並びは `sortRoleIds` に従う。`--roles` に組み込み役割以外の ID があれば throw する(プロジェクト独自の役割は候補の列を持たないため)。
2. 候補の列を決める。`--scope custom`(`with-external`)は `RECOMMENDED[role]`、`--scope claude`(`claude-only`)は `ASSIGNMENTS["claude-model-policy"][role]`。
3. 列を先頭から評価し、`modelIsAvailable(spec.model, live)` が真の最初の ModelSpec を採る。照会に失敗したとき(`live.ok` が偽)は先頭を採る。実在の検証をしなかった警告は既存の `unavailableWarning` が `warnings` に入れる。
4. Target は `modelId: spec.id`、`name: <spec.id>-<default-name>`、`model: spec.model`、`roles: [role]`、`vendor: spec.vendor`、`color: VENDOR_COLORS[spec.vendor]` とする。

`--scope claude` のとき live は `{ ok: true, ids: [] }` で渡るが、`ASSIGNMENTS` の値はすべて Claude enum なので手順 3 で必ず先頭が採れる。

`modelIsAvailable`(`src/setup-agents.ts` L273-275)は Claude enum を常に実在とみなす。`RECOMMENDED` の各行は最初の Claude enum で必ず止まり、その後ろの候補(`normal-impl` / `light-impl` の `grok`、`explore` の `gpt-terra`、`adversarial-review` の `gpt-sol`)は `--recommended` では採られない。`ASSIGNMENTS` も全行が Claude enum である。したがって組み込み役割で候補がすべて不在になる経路は無く、採れなかった役割を返すキー(`rolesDropped`)は作らない。解決規則は変えない(オーケストレーター決定 2026-09-24)。後ろの候補は、位置に依存しない用途(`--list-live-models` の `recommendedFor`、`--list-coverage` の `models`、推奨外役割の警告)で引き続き意味を持つ(§8)。

default-name は、断片の `default-name`(vendor の overlay を考慮して読む)を優先し、無ければ `bundledDefaultNames` の値を使う。これは現行 `defaultAgentName` の解決と同じである。組み込み役割はすべて `default-name` を持つため、`<model-id>` だけの名前にはならない。`defaultAgentName` はこの経路専用に書き換え、役割を引数に取る形にする。

vendor は ModelSpec の値を使い、live の推定(`resolveVendor`)を通さない。`--recommended` は推奨の ModelSpec をそのまま使う経路であり、推定との食い違いで throw させない。live の推定と ModelSpec が食い違う構成(既定エイリアスを別ベンダーのモデルに向けている構成)では、生成された `agent-policy-vendor` が実態と合わない。個別経路は現行どおり `resolveVendor` を使うため、食い違いがあるときはウィザードのステップ 5b で直せる(§8)。

`--recommended` と `--model-id` / `--name` / `--model` / `--vendor` / `--keep` の併用は `ok: false` で拒否する。前の 4 つは定義ごとに決める値であり、役割ごとに ModelSpec から決める `--recommended` と両立しない。現行の `--models` は `--name` / `--model` を黙って無視し `--vendor` を全定義へ当てていたが、黙って無視すると利用者の指定が効いたと誤解させる。`--keep` は定義ごとに選ぶ差分方針であり、複数の定義へ同じ指定を当てられない。

`setup()` の応答は `{ ok, results, warnings }` にする。`results[]` の各要素は現行の `modelId` に加えて `roleId` を持つ。個別経路では `roleId` を持たせるか(`--roles` が複数のとき値が決まらない)を決める必要がある。本設計では、`--recommended` 経路の要素だけが `roleId` を持ち、個別経路の要素は持たないとする。応答の読み手(SKILL.md)は、`--recommended` の結果を役割ごとに表へ並べるときだけ `roleId` を使う。

`recommendedRolesFor` は呼び出し元が無くなるため削除する(§3.3-2)。

### 4.6 `--models` の廃止フラグ化

`--policy` 等と同じ `case` へ `--models` を足し、`--recommended` を案内する文言で throw する。既存の文言は `--scope` を案内しているため、`--models` には別の文言が要る。文言は `removed` を含め、`--recommended` を名指しする(`setup-agents.test.ts:285` の `/removed|廃止/i` の検査に合わせる)。

### 4.7 context-map 廃止後の探索

探索は `explore` へ直接委譲する。統括の段を無くしたため、探索結果の突き合わせと要件の確定はオーケストレーターが行う。これは §分析 の「報告の突き合わせ」と同じ作業であり、規律に新しい責務は生まれない。

「grep/read の反復が 3 ターン以上見込まれる探索は 1 回の dispatch にまとめる」は、統括の段が担っていたバッチ化を dispatch の作法として残すものである。オーケストレーターが細かい探索を 1 件ずつ投げると、起動のたびに規律の転記と文脈の読み込みが発生する。

`explore` 断片は Agent Tool 可のまま残す。Agent Tool 可の役割には advisor 節と Agent tool の制約が出るが、要件 1 で再委譲の規定を撤去した後は「アドバイザーへの相談だけ」になるため、探索役が探索を再委譲する経路は生まれない。

設計書の執筆を委譲するときは、探索で確定した事実(パス・行番号・現況)を要件・受け入れ基準と一緒に依頼文へ載せる。context-map のファイルは作らない。依頼文が長くなる懸念はあるが、context-map も結局は依頼文で所在を渡して読ませていたため、読む量は変わらない。

### 4.8 実装 4 役割の基準を上から評価する

基準を「上から順に評価し、最初に該当した役割」とすることで、複数に当たる作業(例: 公開インターフェースを変えるが変更は機械的)を一意に振れる。escalation を最上段に置くのは、発火条件が作業の内容ではなく試行の履歴で決まるためである。履歴がある作業は内容に関わらず escalation へ回す。

「初回の作業を escalation へ委譲しない」は、上から評価する規則と組み合わせて、escalation の発火条件を満たさない作業が最上段で拾われないことを明文化する。

基準は規律と断片の 2 箇所に置く。規律はオーケストレーターが振り分けに使い、断片はサブエージェントが自分の担当範囲を知るのに使う。断片では「上から順に評価する」は書かず、自分の役割の条件だけを書く。評価順はオーケストレーターの判断手順であり、サブエージェントの振る舞いを変えないためである。

escalation 断片の「入力が無ければ差し戻す」は、オーケストレーター側の依頼文の必須項目と対になる。片側だけに置くと、試行履歴の無い依頼を escalation が推測で埋めて作業を始める。

### 4.9 advisor の基準を相談側と受ける側で揃える

相談する条件を 3 つの観測できる状況に絞る。「相談しない条件」を併記するのは、相談の代わりに取る動き(読む・確かめる・既存に合わせる・差し戻す)を示すためである。これで「迷ったら相談」でも「迷ったら差し戻す」でもなく、状況ごとに取る動きが決まる。

`light-impl` の断片にある「判断に迷った場合もアドバイザーへ相談せず、その旨を報告して差し戻す」は変えない。`light-impl` の基準は「変更内容が依頼文で完全に指定されている」であり、相談する条件の 1 つ目(依頼文に無い判断が要る)に当たった時点で担当範囲を外れているからである。

オーケストレーター側の条項は §分析 に置く。advisor へ諮るのは採否と要件の判断の前段であり、分析の結論をオーケストレーターが出す原則(§分析 の冒頭)の中に収まる。

### 4.10 規律のバイト数

規律のコスト規律(L182)の対象は、委譲先にロードさせるスキルの本文と参照文書の合計である。方針スキルが読む参照は `orchestration-discipline.md` だけであり、`context-map-guide.md` は含まれない。したがって `context-map-guide.md` を削除しても余裕は増えない。

測る対象は `skills/custom-policy/SKILL.md` と `references/orchestration-discipline.md` の合計とする。`claude-model-policy` の SKILL.md(883B)は custom(2,421B)より小さいため、custom が上限に収まれば claude も収まる。現在の合計は 26,737B で、上限 30,720B までの余裕は 3,983B である。

本改修で規律から減るのは、§文書作成を委譲するとき の撤去分(L73 / L74 の一部 / L80)、§サブエージェントの規律 L107、§コードベース探索 の context-map 記述である。増えるのは執筆基準、実装 4 役割の基準、escalation と advisor の規律である。規律の純増は 3,983B を上限とする。

T6 / T7 で上限を超える見込みになったときは、次の順で対処する。

1. 撤去する条項(L73 / L80 / L107 / 探索節の context-map 記述)の削除が済んでいることを確かめ、済んでいなければ先に削除する。
2. §2.7 / §2.8 で足す条項を、条件の数と内容を保ったまま短くする。
3. それでも超えるときは、実装を止めてオーケストレーターへ報告する。

### 4.11 `RECOMMENDED` を並べ替え、解決規則は変えない(ユーザー決定 2026-09-24)

現行の `RECOMMENDED` は全役割の先頭が Claude のモデルである(§3.1)。`modelIsAvailable` は Claude enum を常に実在とみなすため、「先頭から順に、実在する最初のもの」という解決規則のままでは、`--scope custom --recommended` が全役割で Claude のモデルを採る。`design-review` に sonnet が入り、別ベンダーのモデルで前提を検証するという役割の趣旨(§委譲先の解決 の省略規則)とも合わない。

解決規則は変えず、`RECOMMENDED` の各行の並びを custom で採りたいモデルが先頭に来るよう並べ替える。custom で採られるのは各行の先頭であり、先頭の既定エイリアスが live models に無いときだけ次の候補へ進む。

並びの根拠は、このリポジトリの現行 14 定義で選んできたベンダーである。実装(`complex-impl` / `normal-impl` / `light-impl` / `general`)・エスカレーション・最終レビュー(`final-review` / `gate-review`)・独立レビュー(`design-review`)・探索(`explore` / `realtime-research`)は外部ベンダーを使い、設計(`design-plan`)・コードレビュー・理解レビュー(`knowledge-elicitation`)は Claude を使っている。アドバイザーは外部ベンダー(gpt-astra)と Fable の両方の定義を持ち、外部ベンダーを先頭にする。`e2e-verify` は要件 6 で候補が sonnet だけになる。`adversarial-review` は既存の定義が無く、要件どおり Opus を先頭にする。

`ASSIGNMENTS` は claude 構成の役割モデルであり、並べ替えの対象にしない。`RECOMMENDED` は setup-agents の提示だけに使う値のため(`policies.ts` L158 のコメント)、並べ替えがセッション中の委譲に影響することはない。影響を受けるのは `--list-coverage` の `models` の並びと `--recommended` の採用結果である。`--list-live-models` の `recommendedFor` は役割の集合を返すため、並びの影響を受けない。

### 4.12 `gemini-flash` とベンダー `gemini` を削除する(ユーザー決定 2026-09-24)

`RECOMMENDED` で `gemini-flash` を持っていたのは `doc-writing` だけであり、要件 1 で推奨する役割が無くなる。Antigravity 経由の Gemini はサブエージェントとして起動できないことが 0.19 の運用で分かっている(旧設計 §10-5)。ユーザーは ModelId とベンダーをともに削除することを選んだ。

削除後、`owned_by` が `antigravity` のモデルは `vendorFor` が `unknown` を返す。live 照会が成功した状態で個別経路にそのエイリアスを渡すと、`resolveVendor` が throw して `--vendor` の指定を求める。利用者は `--vendor none`(ベンダー断片を付けず、色は blue)か、他のベンダーを選ぶ。ウィザードのステップ 4 は `unknown` のエイリアスに対して選択肢を示す手順を既に持つため、手順の追加は要らない。選択肢の数は 5 から 4 に減る。

`MODELS` の末尾の要素を削除するため、`policies.test.ts` の `MODELS.at(7)` / `at(8)` は影響を受けない。`live-models.test.ts` の正常応答の検査は、`antigravity` の応答を `unknown` として期待する形に直す(`antigravity` の行を消すのではなく、推定が外れたことを固定する)。

`.gemini.md` の overlay 断片は 0.19.0 で作らなかったため、削除する断片は無い。

## 5. 各変更の詳細

本節は変更の要点を示す。指示書の文面は、実装時に `prompt-smith:prompt-smith` の規律に従って書く。

### 5.1 `src/agents/roles.ts`

- `RoleId` から `"doc-writing"` / `"explore-lead"` / `"independent-review"` / `"doc-review"` を外し、`"design-review"` / `"knowledge-elicitation"` / `"adversarial-review"` を足す。
- `ROLES` の最終形(16 件)は次のとおり。

  | 添字 | id | label | kind | tools |
  | --- | --- | --- | --- | --- |
  | 0 | `complex-impl` | 複雑または重要な実装 | impl | 現行どおり |
  | 1 | `normal-impl` | 通常の実装 | impl | 現行どおり |
  | 2 | `light-impl` | 軽量な実装 | impl | 現行どおり |
  | 3 | `escalation` | 行き詰まり時のエスカレーション | impl | 現行どおり |
  | 4 | `general` | その他のタスク | impl | 現行どおり |
  | 5 | `design-plan` | 設計書・実装計画書(WBS)の作成 | impl | 現行どおり |
  | 6 | `explore` | コードベース探索 | readonly | 現行どおり |
  | 7 | `realtime-research` | リアルタイム情報調査 | readonly | 現行どおり |
  | 8 | `e2e-verify` | E2E 動作検証・ブラウザ/GUI 操作 | impl | 現行どおり |
  | 9 | `design-review` | 設計書・実装計画書のレビュー | readonly | `Read, Grep, Glob, Bash` |
  | 10 | `knowledge-elicitation` | 暗黙知の抽出・理解レビュー | readonly | `Read, Grep, Glob` |
  | 11 | `code-review` | コードレビュー | readonly | 現行どおり |
  | 12 | `final-review` | 重要な実装の最終レビュー | readonly | 現行どおり |
  | 13 | `gate-review` | 設計書の最終ゲートレビュー | readonly | 現行どおり |
  | 14 | `adversarial-review` | 敵対的レビュー | readonly | `Read, Grep, Glob, Bash` |
  | 15 | `advisor` | 設計・計画・実装のアドバイザー | readonly | 現行どおり |

### 5.2 `src/agents/policies.ts`

`RECOMMENDED` の列は並びに意味がある(先頭が custom で採られる。§4.11)。

| 役割 | `ASSIGNMENTS` | `RECOMMENDED`(この順) | Agent Tool |
| --- | --- | --- | --- |
| `complex-impl` | opus | gpt-sol, opus | 可 |
| `normal-impl` | sonnet | gpt-luna, sonnet, grok | 可 |
| `light-impl` | haiku | gpt-luna, haiku, grok | 可 |
| `escalation` | fable | gpt-astra, fable | 可 |
| `general` | sonnet | gpt-luna, sonnet | 可 |
| `design-plan` | opus | opus | 可 |
| `explore` | sonnet | grok, sonnet, gpt-terra | 可 |
| `realtime-research` | sonnet | grok, sonnet | 可 |
| `e2e-verify` | sonnet | sonnet | 可 |
| `design-review` | sonnet | grok, sonnet | 可 |
| `knowledge-elicitation` | haiku | haiku | 否 |
| `code-review` | sonnet | sonnet | 否 |
| `final-review` | fable | gpt-astra, fable | 否 |
| `gate-review` | fable | gpt-astra, fable | 否 |
| `adversarial-review` | opus | opus, gpt-sol | 否 |
| `advisor` | fable | gpt-astra, fable | 否 |

`SOLO_DENIED_ROLES` は `advisor`, `knowledge-elicitation`, `code-review`, `final-review`, `gate-review`, `adversarial-review`。`doc-review` の要素を `knowledge-elicitation` へ置き換え、`doc-writing` を削り、`adversarial-review` を末尾へ足す。

`ModelId` と `MODELS` から `gemini-flash` を削除する(9 件。末尾は `grok`)。

### 5.2b ベンダー `gemini` の削除(要件 9)

| ファイル | 変更 |
| --- | --- |
| `src/agents/fragments.ts` L6 | `Vendor` を `gpt` / `grok` / `claude` / `none` の 4 値にする |
| `src/agents/compose.ts` L32-38 | `COLORS` から `gemini` を削除する |
| `src/setup-agents.ts` L78-84 | `VENDOR_COLORS` から `gemini` を削除する |
| `src/setup-agents.ts` L267 | 推定失敗の文言を `pass --vendor gpt\|grok\|claude\|none` にする |
| `src/setup-agents.ts` L940-948 | `--vendor` の検証を 4 値にし、エラー文言を `vendor: must be gpt, grok, claude or none` にする |
| `src/agents/live-models.ts` L32-33 | `antigravity` の case を削除する。`LiveVendor`(`Exclude<Vendor, "none"> \| "unknown"`)は `Vendor` から導かれるため、定義の変更は要らない |

### 5.3 `src/agents/vocabulary.ts` と `src/agents/compose.ts`

- `Vocabulary` に執筆の見出しのフィールドを足す。ja `## 文書の執筆`、en `## Writing`。
- `compose()` は advisor 節の後、`constraints` を組み立てる前に、`common.get(<執筆の見出し>)` が得られれば見出しと本文を出す。`withAgent` を条件にしない。
- `describeRoles` は変えない。`COLORS` は T1b で `gemini` を消した後の状態を保ち、T2 では触らない。

### 5.4 `src/setup-agents.ts`

- `Options` から `models` を外し、`recommended: boolean` を足す。`--roles` は個別経路と `--recommended` の絞り込みの両方で使う。
- `TargetResolution` から `modelsDropped` を削除する。代わりのキーは足さない(§4.5)。`Target` に `roleId?: RoleId` を足す(個別経路では持たない)。
- `targetsFor` の `--models` 分岐を `--recommended` 分岐へ置き換える(手順は §4.5)。
- `defaultAgentName` を役割を引数に取る形へ書き換える(§4.5)。
- `recommendedRolesFor`(L182-188)を削除する。
- `setup()` の応答を `{ ok, results, warnings }` にし、`results[]` の要素に `roleId` を載せる(Target が持つときだけ)。
- `parseArgs`: `--models` を廃止フラグにし(§4.6)、`--recommended` を足す。`--recommended` のときは `name` / `model-id` / `roles` の必須検査を飛ばす。`--recommended` と `--model-id` / `--name` / `--model` / `--vendor` / `--keep` の併用を拒否する(文言は `--recommended` と併用したフラグを名指しする)。
- 先頭のコメント(L277-278)を `--recommended` の説明に直す。
- `--list-coverage`、`--list-roles`、`--list-live-models`、`--merge` / `--keep`、MCP の付与、翻訳断片の処理は変えない。

### 5.5 役割断片: 削除と新規

| ファイル | 変更 |
| --- | --- |
| `assets/roles/{ja,en}/doc-writing.md` | 削除 |
| `assets/roles/{ja,en}/explore-lead.md` | 削除 |
| `assets/roles/{ja,en}/independent-review.md` | `design-review.md` へ改名(`git mv`)。frontmatter の `id` と `label` を新しい値にする。本文は引き継ぐ。制約の役割スコープ句は新しい役割名に合わせる |
| `assets/roles/{ja,en}/doc-review.md` | `knowledge-elicitation.md` へ改名(`git mv`)。frontmatter の `id` / `label` / `description` / `default-name` を新しい値にする。When to invoke・Core Responsibilities・作業手順・制約の対象を「任意の成果物」へ広げる。Output Format は維持 |
| `assets/roles/{ja,en}/adversarial-review.md` | 新規(§5.6) |
| `assets/context-map-template.md` | 削除 |
| `references/context-map-guide.md` | 削除 |

`knowledge-elicitation` の本文で広げる点は次のとおり。

- When to invoke: 対象を「文書・指示書・仕様・コードなど任意の成果物」にする。
- 作業手順: 節をまたいだ食い違いを探す手順は「成果物の部分をまたいだ食い違い」に一般化する。曖昧さを具体的に指摘する手順は維持する。
- 制約: 役割スコープ句を新しい役割名に合わせる。

### 5.6 `adversarial-review` 断片の内容

frontmatter: `id: adversarial-review`、label(ja「敵対的レビュー」、en は自然な英語)、description(任意の成果物を破る立場で読み、失敗経路と反例を示す趣旨)、`default-name: adversary`、`tools: Read, Grep, Glob, Bash`、`kind: readonly`。

本文に入れる要点:

- When to invoke: 設計書・実装計画書・コード・指示書・テストなど任意の成果物を破る立場で読ませたいとき。`design-review` との違い(あちらは別ベンダーのモデルに原本のみを渡して前提を検証する。こちらは成果物の種類もベンダーも問わず、壊れ方を探す)。`final-review` との違い(あちらは重要な実装の完了可否を判定する。こちらは可否を判定せず反例を積む)。
- Core Responsibilities: 失敗経路・境界条件・前提の突き崩し・具体的な反例を、再現手順付きで示す。採否は判断しない。
- 作業手順: 成果物が依拠する前提を列挙してから崩す / 反例は再現できる形(入力・手順・期待と実際)で書く / コードやテストが対象のときは、ファイルを変更しない範囲でコマンドを実行して確かめる / 確かめられなかった反例はその旨を付けて分ける。
- 制約: 役割スコープ句付きで「成果物(ファイル)を作らず報告のみを返す」「指摘の採否を判断しない」。修正を適用しない。
- Output Format: 指摘ごとに、対象箇所 / 崩した前提または失敗経路 / 反例と再現手順 / 反例が成り立つ場合の影響範囲。最後に、確かめられなかった事項。

`###` 見出しを使わない。ja と en で frontmatter の `default-name` / `tools` / `kind` を一致させる。

### 5.7 役割断片: 既存の書き換え

| ファイル | 変更の要点 |
| --- | --- |
| `_common.md`(ja/en) | (1) `## 文書の執筆` / `## Writing` 節を `## Agent tool の制約` の後、`## 制約` の前に足す。内容は旧 `doc-writing` の執筆基準 5 項目。ja だけに言い換え例 5 つ。(2) `## アドバイザーへの相談` の「迷ったときだけ」「迷っていないときは呼ばない」を、§2.8 の相談する条件と相談しない条件に置き換える。依頼文の必須項目(選択肢・制約・関係ファイルのパス)を足す。助言のみ・Agent 禁止の明記、対応表 → Fable の解決順は維持。(3) `## Agent tool の制約` を「用途はアドバイザーへの相談だけ」「自身が起動したサブエージェントに `Agent` tool を許可しない」に戻す。書き換える範囲は L20-32(L20 の「相談と再委譲の 2 つだけ」を「相談だけ」へ書き直し、D1 の項目 L21-32 を撤去する)。en も L20-32。見出し(L18)は変えない。(4) `## 制約` の context-map 条項(L42)を、渡された探索結果と実コードの食い違いを報告する形へ一般化する。「本文に載せる」の規則(L43)は残す |
| `general.md`(ja/en) | description を「定型メンテナンス・文書作成など、レビュー・設計を除く一般作業」の趣旨に戻す。When to invoke の「文書作成のいずれでもなく」を外し、文書作成の項目を足す(0.19.0 で外した「ドキュメント作業」の趣旨)。Core Responsibilities にも文書作成を戻す |
| `design-plan.md`(ja/en) | description・Core Responsibilities・作業手順から context-map を外し、「渡された要件・受け入れ基準・探索結果」を入力にする。作業手順の context-map 条項を「渡された探索結果と実コードに食い違いがあれば報告する」へ一般化する。制約の L31(文書作成の規律に従う)を削除する(§3.3-3) |
| `explore.md`(ja/en) | label を「コードベース探索」(en は対応する英語)に変える。description と When to invoke から「オーケストレーターが統括する」「実働」を外し、オーケストレーターから直接依頼される探索にする。Output Format は事実の報告(パス・行番号・根拠)と走査範囲。制約の役割スコープ句を新しい役割名に合わせる |
| `escalation.md`(ja/en) | When to invoke に §2.7 の発火条件 3 つを書く。作業手順か制約に、試行履歴・失敗出力の原文・未解決の制約が依頼文に無ければ差し戻す 1 行を足す |
| `complex-impl.md` / `normal-impl.md` / `light-impl.md`(ja/en) | When to invoke だけを §2.7 の基準で書き直す。description は When to invoke と矛盾しない範囲で揃える。他の節は変えない |
| `advisor.md`(ja/en) | When to invoke を、依頼元が §2.8 の相談する条件に当たったときに書き直す。Output Format の推奨を 1 案にし、条件付きなら条件を明記する形にする。「前提が足りず判断できない事項」は維持する |
| `design-review.md`(ja/en) | §5.5 のとおり |

en 断片に日本語と日本語約物を書かない。断片本文で `###` を使わない。

### 5.8 `references/orchestration-discipline.md` の担当表

§5.1 / §5.2 の最終形の 16 行にする。L26 の説明文が例に使う `[doc-writing]` を、残る役割の ID に差し替える。列幅は既存の桁揃えに合わせる。

### 5.9 `references/orchestration-discipline.md` の本文(要件 1・2・7・8)

| 節 | 変更の要点 |
| --- | --- |
| §委譲先の解決 L55 | 「設計書・実装計画書の独立レビュー」を新しい役割名「設計書・実装計画書のレビュー」へ。規則そのものは維持 |
| §オーケストレーターが自ら担う作業 冒頭 | 「オーケストレーターはファイルとして残す文書を自分で書いてよい」旨を足す。担当表の全役割をサブエージェントが担う原則(L59)は残し、文書の執筆が担当表の役割でなくなったことと整合させる |
| 同 新しい小見出し(文書の執筆) | 執筆基準(§4.1)をオーケストレーターが書く文書の規律として置く |
| §分析 | 突き合わせ対象から context-map を外す。L69 の「コードベース探索実働」を新しい役割名へ。advisor へ諮る条項(§2.8-2)を足す |
| §文書作成を委譲するとき | 「文書の執筆を委譲するとき」へ改題する。L73(F1)、L74 の「文書作成へ委譲するのは執筆と文体だけ」、L80(文章を考えることが文書作成の役割)を撤去する。L75-79 と L81 は「文書の執筆を委譲する依頼文」へ言い換えて残す(§4.2) |
| §モデル別役割の運用 L86-88 | 実装 4 役割の基準(§2.7-1)に置き換える。上から評価する旨を書く。escalation の運用規律(§2.7-2)を足す |
| §サブエージェントの規律 L107 | 削除する |
| 同 L108 | アドバイザーへ相談する条件と相談しない条件(§2.8-1)を反映する。条項は「サブエージェントは〜」で始める形を保つ。相談先の解決(対応表 → Fable → 差し戻し)は維持 |
| §設計・実装計画の規律 | 役割名を追随させる(§5.10 と合わせて行う) |

§サブエージェントの規律 は 12 条項から 11 条項になる。アドバイザー条項が長くなるときは、「サブエージェントは〜」で始まる条項を 2 つに分けてよい(判断の軸: 1 文に 1 指示)。

### 5.10 `references/orchestration-discipline.md` の本文(要件 5)

| 節 | 変更の要点 |
| --- | --- |
| §コードベース探索 | 全体を書き換える。探索は「コードベース探索」の役割へ委譲する / grep・read の反復が 3 ターン以上見込まれる探索は 1 回の dispatch にまとめる / 探索結果の突き合わせ・未解決事項の判断・要件確定はオーケストレーターが行う。`context-map-guide.md` への参照を削除する |
| §設計・実装計画の規律 1 項目 | 「context-map の作成後に着手する」を、探索で確定した事実(パス・行番号・現況)を要件・受け入れ基準とともに依頼文で渡してから設計書の執筆を委譲する、へ変える |
| 同 2 項目 | 依頼文に渡すものから「context-map の所在」を外す |
| 同 3-4 項目 | 「設計書・実装計画書のレビュー」を `knowledge-elicitation` の新しい役割名へ、「設計書・実装計画書の独立レビュー」を `design-review` の新しい役割名へ変える。順序(暗黙知の抽出 → 原本のみで設計レビュー → 採否)は変えない |

### 5.11 README

**プラグイン `README.md`**

- L5: 「コードベース探索のコスト効率化施策(context-map)」を外す。
- L103: MCP 既定の役割列挙を 6 件にする。
- L107: 非対話モードの説明を役割単位の生成に合わせる。
- L109-129: 役割一覧を 16 種にする(§5.1 の表の順)。
- L131-144: モデル ID の表を 9 種にし、`gemini-flash` の行を削除する。
- L146-150: `gemini-flash` を Antigravity 経由で使うときの注記を、`gemini-flash` の行と一緒に削除する(ユーザーが Gemini を扱わないと決めたため。オーケストレーター決定 2026-09-24)。
- ベンダーの説明を 4 値(`gpt` / `grok` / `claude` / `none`)に合わせる。
- 「旧バージョンからの移行」の先頭に「0.19 系から 0.20 系へ」を新設する。項目は次のとおり。
  1. 役割 ID の改名(`independent-review` → `design-review`、`doc-review` → `knowledge-elicitation`)。生成済み定義の `agent-policy-role` を書き換えるか、setup-agents で再生成する。旧 ID のマーカーは組み込み役割として認識されない。「設計書・実装計画書のレビュー」の役割名が指す役割が変わったこと。
  2. `doc-writing` の廃止。定義を削除する。執筆基準は全定義の共通部分に入ったため、再生成で届く。オーケストレーターは文書を自分で書くようになった。
  3. `explore-lead` と context-map の廃止。`explore-lead` の定義を削除するか、マーカーから外す。`.claude/context-maps/` は読まれなくなるため、残すか消すかはプロジェクトで決める。
  4. `explore` の役割名の変更(コードベース探索実働 → コードベース探索)。
  5. `adversarial-review` の新設。標準フローには入らない。
  6. setup-agents の変更。`--models` の廃止と `--recommended`、既定の生成単位が 1 役割 1 定義になったこと、応答から `modelsDropped` を外したこと(代わりのキーは無い)。`--recommended` は個別のフラグ(`--model-id` / `--name` / `--model` / `--vendor` / `--keep`)と併用できないこと。custom で採られる推奨モデルが変わったこと(推奨の並びを入れ替えたため)。
  7. 実装 4 役割と advisor の基準の変更。生成済み定義の本文は再生成で追随する。
  8. `e2e-verify` の推奨から `gpt-astra` を外した。
  9. ja / en 以外の翻訳断片を持つプロジェクトは、`_common.md` が stale になるため再翻訳が要る。削除・改名した役割の翻訳断片(`doc-writing.md` / `explore-lead.md` / `independent-review.md` / `doc-review.md`)が翻訳ディレクトリに残っていると、プロジェクト独自の役割として読まれるため削除する。
  10. 推奨モデル ID `gemini-flash` とベンダー `gemini` を削除した(0.19 で追加したもの)。`--vendor` は `gpt` / `grok` / `claude` / `none` の 4 値になる。Gemini のエイリアスはベンダーが `unknown` と推定されるため、使うときは個別調整で `--model` にエイリアスを指定し、`--vendor none` か他のベンダーを選ぶ。
- 古い移行節(0.18 → 0.19 以前)は履歴として変えない。

**ルート `README.md`**: L100 から「context-map の作成指針」を外し、残りの文が成り立つように整える。L104 の「全17種」を「全16種」に、L106 の「GPT・Grok・Gemini」を「GPT・Grok」にする。他の行は変えない。

### 5.12 `skills/setup-agents/SKILL.md`

| 箇所 | 変更の要点 |
| --- | --- |
| L23 | 読む応答のキーから `modelsDropped` を外し、`warnings` だけにする |
| 非対話モード L43-46 | モデル ID の固定一覧 2 つを削除する |
| 同 手順 3-4 | `--write --merge --recommended --scope <claude\|custom> --lang <lang> --dir "$PWD"` を使う。照会成功時に先頭の既定エイリアスが実在しない役割は次の候補へ進み、最初の Claude のモデルで必ず止まることを書く。報告から `modelsDropped` を外す |
| ステップ 1 L100 | 照会失敗時の既定エイリアスの対応から `gemini-flash` を外す(9 件) |
| ステップ 1b | 「すべてのモデルを選び直す」を役割の言葉に合わせる。「未カバーの役割だけ作る」は、`--check --recommended --roles <uncovered…>` で差分を示し、`--write --merge --recommended --roles <uncovered…>` で生成する手順にする。ステップ 6b を経由しない |
| ステップ 4 | モデル値の複数選択を、`--check --recommended` の結果を「役割 / 採用モデル / 定義名 / 既存状態と差分」の表で示す手順に置き換える。ベンダーの確定は個別調整(ステップ 5b)へ移す。ベンダーの選択肢を 4 値(`gpt` / `grok` / `claude` / 「どれでもない」= `none`)にする。L163 のモデル ID の列挙は手順ごと削除される |
| ステップ 5 | 3 択(このまま全部作る / 一部を調整する / 中止する)を維持し、調整の単位を役割にする。「一部を調整する」で選んだ役割はステップ 5b へ進める |
| ステップ 5b | 調整対象を役割単位にし、`--model-id … --roles <1 件>` で進める。定義名とモデル ID の選択はこのステップに集める(ステップ 6b から移す)。kind 混在の警告は、個別調整で複数の役割を選んだときだけ出る。L232 のコマンド例の `--vendor` を 4 値にする |
| ステップ 5c-3 | 既定の配分を「impl 役割の定義に付け、readonly 役割の定義には付けない」にし、列挙を 6 件にする。定義 = 役割になるため、L262 の同居の説明と L264 の分離提案(`explore` / `explore-lead` の例)を削除する |
| ステップ 6 | `--write --merge --recommended --roles <impl 役割…> --mcp-servers … --mcp-deny …` と `--write --merge --recommended --roles <readonly 役割…>` の 2 回の発行に書き換える。MCP を選ばなかったときは `--recommended` の 1 回。個別調整した役割は現行の個別コマンドで生成する。`--recommended` は `--model-id` / `--name` / `--model` / `--vendor` / `--keep` と併用できない旨を書く。L291 のコマンド例の `--vendor` を 4 値にする |
| ステップ 6b | 被覆を取り直し、`uncovered` が空でなければ `--check --recommended --roles <uncovered…>` → `--write --merge --recommended --roles <uncovered…>` で生成する手順に置き換える。役割をまとめる質問(L310)、役割ごとの定義名・モデル ID・MCP・ベンダーの対話(L308-324)は削除し、利用者が調整を望む役割はステップ 5b の個別調整へ進める。L321 のコマンド例は削除される |
| ステップ 7 | `modelsDropped` の報告を削除する(代わりの報告は無い) |

frontmatter の `description` は変えない(モデルと役割を選ぶ、という記述は役割単位の生成でも成り立つ)。

### 5.13 バージョン

`plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の `version` を `0.20.0-dev` にする。マイナーを上げるのは、役割 ID の改名・削除と CLI フラグの廃止という互換性のない変更を含むためである。

### 5.14 Serena メモリ

`.serena/memories/agent_policy/core.md` の、現行設計書の一覧、役割 ID の列挙と件数、`doc-writing` の説明、`RECOMMENDED` の値と並び、`ModelId` と `Vendor` の集合(`gemini-flash` と `gemini` の削除)、setup-agents の生成単位、規律の構成、バージョンを更新する。`.serena/memories/core.md` の L150 と L163-164 は、このリポジトリの構成の記述であり、改名した役割 ID と context-map に触れている。規約の Done 条件(メモリと食い違うなら更新する)に当たるため、同じタスクで追随させる。どちらも Serena の `edit_memory` / `write_memory` で行う。

### 5.15 変更しないもの

- `harness-docs/ARCHITECTURE.md`、ADR、`harness-docs/GOTCHAS.md`、`.claude/rules/metatron/`。
- ルート `.gitignore` の `.claude/context-maps` 行。
- `src/hooks/*`。役割 ID を列挙していない。`subagent-start.test.ts` は `ROLES` から ID を作るため自動で追随する。
- `src/agents/fragments.ts` と `src/agents/live-models.ts` の、要件 9 以外の部分。
- 他プラグイン。役割 ID・`Vendor`・`ModelId` を参照していない。
- `cliproxyapi.config.example.yaml`(プロキシの設定例であり、agent-policy の値ではない)。

### 5.16 このリポジトリの `.claude/agents/`

実装後、次の方針で再生成する(ユーザー決定 2026-09-24)。既存の定義名と役割構成を保ち、新しい既定(`<model-id>-<default-name>`、1 役割 1 定義)へは揃えない。生成は個別経路(`--model-id … --name … --model … --roles …`)で保持マージする。`--recommended` は使わない(既定名で別の定義を作ってしまうため)。

| 定義 | 現在のマーカー | model | 処置 |
| --- | --- | --- | --- |
| `document-writer.md` | doc-writing | gpt-terra | 削除 |
| `knowledge-elicitationer.md` | doc-review | haiku | マーカーを `knowledge-elicitation` にして再生成 |
| `docs-reviewer.md` | independent-review | grok | マーカーを `design-review` にして再生成 |
| `system-planner.md` | design-plan, explore-lead | opus | `design-plan` だけで再生成 |
| `general-explore.md` | explore | grok | 再生成(役割名の変更を反映) |
| `adversarial-reviewer.md`(新規) | adversarial-review | `claude-gpt-6-sol`(gpt) | 新設。名前とモデルはユーザー決定(2026-09-24)。`--model-id gpt-sol --name adversarial-reviewer --roles adversarial-review` で作る |
| `complex-reviewer.md` | e2e-verify, final-review, gate-review | gpt-astra | 役割構成を保って再生成。`e2e-verify` が gpt-astra の推奨外になり警告が出るが受容する(§8) |
| 残り 7 定義 | 変更なし | — | 本文(`_common.md`・断片)の変更を反映するため再生成 |

GOTCHA-001 に従い、再生成の前に `.claude/agents/` を別ディレクトリへ複製する。`--write` に `--mcp-servers` を渡すときは、事前の `--check` が返す `mcpCurrent.denyTools` を `--mcp-deny` に渡す。生成後に複製との差分を取り、`disallowedTools` と MCP の行が削除されていないことを確認する。`.claude/agents` は `.gitignore:14` で追跡外のため、この作業はコミットを伴わない。

## 6. 影響ファイル

### 6.1 実装

| ファイル | 変更 |
| --- | --- |
| `src/agents/roles.ts` | `RoleId` と `ROLES`(§5.1) |
| `src/agents/policies.ts` | `ModelId` / `MODELS` から `gemini-flash`、`ASSIGNMENTS` / `RECOMMENDED`(並べ替えを含む)/ `SOLO_DENIED_ROLES`(§5.2) |
| `src/agents/fragments.ts` | `Vendor` から `gemini`(§5.2b) |
| `src/agents/vocabulary.ts` | 執筆の見出し |
| `src/agents/compose.ts` | 執筆の節の出力、`COLORS` から `gemini` |
| `src/agents/live-models.ts` | `antigravity` の case の削除 |
| `src/setup-agents.ts` | `--recommended`、`--models` の廃止、併用の拒否、`modelsDropped` の削除、`roleId`、`defaultAgentName`、`recommendedRolesFor` の削除、`VENDOR_COLORS` / `--vendor` の検証 / 推定失敗の文言から `gemini` |
| `scripts/*.mjs` | `pnpm run build` の再生成物 |

### 6.2 断片・規律・文書

| ファイル | 変更 |
| --- | --- |
| `assets/roles/{ja,en}/_common.md` | 執筆の節、アドバイザーの基準、Agent tool の制約の縮小、context-map 条項の一般化 |
| `assets/roles/{ja,en}/doc-writing.md` / `explore-lead.md` | 削除 |
| `assets/roles/{ja,en}/independent-review.md` → `design-review.md` | 改名 |
| `assets/roles/{ja,en}/doc-review.md` → `knowledge-elicitation.md` | 改名と対象の拡大 |
| `assets/roles/{ja,en}/adversarial-review.md` | 新規 |
| `assets/roles/{ja,en}/general.md` / `design-plan.md` / `explore.md` / `escalation.md` / `complex-impl.md` / `normal-impl.md` / `light-impl.md` / `advisor.md` | §5.7 |
| `assets/context-map-template.md`、`references/context-map-guide.md` | 削除 |
| `references/orchestration-discipline.md` | §5.8-5.10 |
| `skills/setup-agents/SKILL.md` | §5.12 |
| `plugins/agent-policy/README.md` | §5.11 |
| ルート `README.md` | L100 / L104 / L106 |
| `.claude-plugin/plugin.json` / `package.json` | `0.20.0-dev` |
| `.serena/memories/agent_policy/core.md` / `.serena/memories/core.md` | Serena 経由 |

### 6.3 テスト

| ファイル | 変更 |
| --- | --- |
| `src/agents/__test__/roles.test.ts` | §7.1 |
| `src/agents/__test__/fragments.test.ts` | §7.1 |
| `src/agents/__test__/policies.test.ts` | §7.1 |
| `src/agents/__test__/compose.test.ts` | §7.1 / §7.2 / §7.4 |
| `src/agents/__test__/live-models.test.ts` | §7.4 |
| `src/agents/__test__/discipline-role-table.test.ts` | §7.4 |
| `src/hooks/__test__/marker-scan.test.ts` | §7.1 |
| `src/hooks/__test__/session-start.test.ts` | §7.1(`explore` の役割名) |
| `src/__test__/setup-agents.test.ts` | §7.1 / §7.3 / §7.4 |

## 7. テスト方針

### 7.1 役割の増減・改名で固定値を直す検査

| ファイル:行 | 変更 |
| --- | --- |
| `roles.test.ts:11-31` | 16 件、§5.1 の並び |
| `roles.test.ts:34-43` | `doc-writing` の形状検査を、新設・改名した役割(`design-review` / `knowledge-elicitation` / `adversarial-review`)の label・kind・tools の検査に置き換える |
| `roles.test.ts:44-58` | `design-plan` だけの検査にする。`explore` の label を検査に含める |
| `roles.test.ts:140` | 変更なし(`advisor` が末尾) |
| `fragments.test.ts:57` | 16 件 |
| `fragments.test.ts:64` | `doc-writing` の代わりに `adversarial-review` → `adversary`、`knowledge-elicitation` → `knowledge-elicitor`、`design-review` → `docs-reviewer` を検査する |
| `policies.test.ts:19-77` | 3 つの期待値表を §5.2 の表にする。`EXPECTED_RECOMMENDED` は並べ替え後の順で書く |
| `policies.test.ts:104` / `:116` / `:238` | テスト名を「16 役割」に |
| `policies.test.ts:210-221` | `rolesFor("sonnet")` を 7 件(normal-impl, general, explore, realtime-research, e2e-verify, design-review, code-review)に |
| `compose.test.ts:119-122` | `explore-lead` を外した 3 役割の並べ替えにする |
| `compose.test.ts:248` / `:261` | 「コードベース探索実働」を新しい役割名に |
| `compose.test.ts:433` / `:467` | プロジェクト断片のフィクスチャの label。検査の対象ではないため変更は任意だが、組み込みの label と揃えるなら新しい役割名にする |
| `hooks/__test__/session-start.test.ts:654` / `:732` / `:802` | 注入文に「コードベース探索実働」が含まれる検査。新しい役割名に |
| `compose.test.ts:251-254` | `design-review` を使い、検査文字列を新しい役割名のスコープ句にする |
| `marker-scan.test.ts:309` | `explore-lead` の行を、残る役割(例: `adversarial-review`)の label に差し替える |
| `setup-agents.test.ts:472-480` / `:1851-1857` | `claude-gpt-6-astra` の `recommendedFor` と `--models` の gpt-astra の役割から `e2e-verify` を外す(T1) |
| `setup-agents.test.ts:469` | `claude-gpt-6-sol` の `recommendedFor` を `["complex-impl", "adversarial-review"]`(`sortRoleIds` の順)にする(T5) |
| `setup-agents.test.ts:543` / `:610` | 16 件。`--list-coverage` の `models` を検査している箇所があれば、`--scope custom` では並べ替え後の順にする |
| `setup-agents.test.ts:737-754` | §5.1 の 16 件の並び |
| `setup-agents.test.ts:950-961` / `:1012` | `independent-review` を `design-review` に |

`discipline-role-table.test.ts` は `ROLES.length` と突き合わせるため、担当表を 16 行にすれば通る。`subagent-start.test.ts` は `ROLES` から ID を作るため変更不要である。

### 7.2 執筆の節と Agent tool の制約

| 検査 | 内容 |
| --- | --- |
| `compose.test.ts:194-211` | 節の順序の期待値に `## 文書の執筆` を `## アドバイザーへの相談` と `## 制約` の間へ足す |
| 新規 | ja で合成した定義に `## 文書の執筆` が 1 回だけ出る。Agent 否の役割(`code-review`)でも出る |
| 新規 | 執筆の節が `## 制約` より前にある。advisor 節を持つ定義では advisor 節より後にある |
| 新規 | en で合成した定義に `## Writing` が出る。英語純度検査(`:587`)が日本語の混入を弾く |
| `compose.test.ts:587-597`(T5) | 英語純度検査を、`ROLES` の全 id を 1 件ずつ en で合成して日本語文字と日本語約物が無いことを見る形に広げる |
| `compose.test.ts:213-232` | Agent tool の制約の文言検査を、縮小後の `_common.md` に残る語で行う。重複検査(`:229-232`)も同じ語で作り直す |
| 新規(T3) | 合成した定義に `doc-writing`(RoleId の文字列)と `context-map` が現れない(ja / en)。T2 の時点では `_common.md` L42 と `design-plan.md` に context-map が残るため、T3 で置く。「文書作成」は `general` に戻す語であり禁止語にしない |

### 7.3 `--recommended`

describe「--models による推奨一括」(`:1829-`)を describe「--recommended」へ書き換える。各ケースは `--scope` を明示する。

| ケース | 期待 |
| --- | --- |
| `--check --recommended --scope claude` | 16 役割それぞれに 1 定義。`modelId` は `ASSIGNMENTS` の値。定義名は `<model-id>-<default-name>`。各 `results[]` に `roleId` がある。応答に `modelsDropped` が無い |
| `--check --recommended --scope custom --roles <複数>` | 指定した役割だけが対象になる。並びは `ROLES` 順 |
| `--scope custom` で照会成功、全推奨エイリアスが実在 | 各役割で `RECOMMENDED` の先頭が採られる(例: `design-review` は `grok`、`complex-impl` は `gpt-sol`、`design-plan` は `opus`) |
| `--scope custom` で照会成功、先頭の候補が live に無い役割 | 2 番目の Claude enum が採られる(例: `claude-grok-4-7` が無いとき `design-review` は `sonnet`) |
| `--scope custom` で照会成功、Claude enum より後ろに外部ベンダーの候補がある役割 | 後ろの候補は採られない(例: `adversarial-review` は `gpt-sol` が実在しても `opus`) |
| `--scope custom` で照会失敗 | 先頭の候補が採られ、`warnings` に実在検証をしなかった警告が入る |
| vendor と color | ModelSpec の値が frontmatter に出る |
| `--write --recommended --roles <impl 役割> --mcp-servers …` の後に `--write --recommended --roles <readonly 役割>` | 1 回目の定義にだけ MCP が付く |
| `--recommended` と `--model-id` / `--name` / `--model` / `--vendor` / `--keep` のそれぞれ | `ok: false` で拒否される(`it.each` で 5 通り) |
| `--recommended --roles <未知の ID>` | 拒否される |

describe「廃止フラグ」(`:275-287`)の `it.each` に `[["--models", "sonnet"], "--models"]` を足す。describe「--scope」の `:355-369`(`--models` で外部モデルを落とす)は、`--recommended --scope claude` が Claude のモデルだけを使うことの検査へ書き換える。応答型(`:84`)から `modelsDropped` を削除し、`results[]` の型に `roleId` を足す。

custom を要するケースで `--scope custom` を明示するのは、`AMBIENT_ENV_VARS`(`:146-160`)が `AMATSUKA_AGENT_AUTO_INJECTION` を落とし、既定が claude になるためである。ヘルパーに scope を焼き込まない。既存ケースの意図(scope を明示したときの挙動の検査)を変えないためである。

### 7.4 `gemini-flash` と `gemini` の削除

| ファイル:行 | 変更 |
| --- | --- |
| `policies.test.ts:124` | `MODELS` 9 件 |
| `policies.test.ts:155-167` | ID の全件の並びから `gemini-flash` を外す |
| `policies.test.ts:170-178` | it「gemini-flash が指定値で定義される」を、`modelById("gemini-flash")` が `undefined` を返す検査へ置き換える |
| `policies.test.ts:144` / `:152` | 変更なし(`MODELS.at(7)` / `at(8)` は削除する要素より前) |
| `compose.test.ts:78-80` | vendor `gemini` の色の検査を削除する |
| `compose.test.ts:98` | vendor marker の配列から `gemini` を外す |
| `live-models.test.ts:47-70` | `owned_by: "antigravity"` の応答の期待値を `unknown` にする |
| `discipline-role-table.test.ts:27` | `MODEL_IDS` から `"Gemini Flash"` を外す |
| `setup-agents.test.ts:129` | 応答型の vendor union から `gemini` を外す |
| `setup-agents.test.ts:1782` | `--vendor gemini` の `it.each` の行を、`--vendor gemini` が拒否される検査へ置き換える |
| `setup-agents.test.ts:1917` | 推定失敗の文言を `pass --vendor gpt\|grok\|claude\|none` にする |

### 7.5 検証コマンド

`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build`。CLI の実挙動は `node plugins/agent-policy/scripts/setup-agents.mjs --list-roles --lang ja --dir "$PWD"`、`--list-coverage --scope claude`、`--check --recommended --scope claude` で確かめる。

## 8. リスクと受容

| リスク | 対処 |
| --- | --- |
| 旧 ID のマーカーを持つ生成済み定義が、更新後に組み込み役割として認識されず、対応表で役割名が引けない | 移行節で書き換えと再生成を案内する。このリポジトリでは最後のタスクで再生成する |
| 「設計書・実装計画書のレビュー」の役割名が 0.19 と 0.20 で別の役割を指す | 移行節に対応を書く。規律は RoleId で役割を特定できるよう、改名した役割の条項では役割名に RoleId を併記するかを実装時に判断する(判断の軸: 規律内で同じ役割名が 2 通りに読める箇所があるか) |
| 翻訳ディレクトリに残った削除・改名前の断片が、プロジェクト独自の役割として読まれる | 移行節で削除を案内する。CLI では検出しない(§9) |
| `_common.md` の変更で、ja / en 以外の翻訳断片が stale になり生成が止まる | 既存の仕組みどおりの挙動である。移行節で再翻訳を案内する |
| `--recommended` が vendor を ModelSpec から取るため、既定エイリアスを別ベンダーに向けた構成で `agent-policy-vendor` が実態と食い違う | 個別経路は `resolveVendor` を使い続ける。ウィザードのステップ 5b で直せる |
| `--recommended` は `RECOMMENDED` の各行を最初の Claude enum で止めるため、その後ろの候補(`normal-impl` / `light-impl` の `grok`、`explore` の `gpt-terra`、`adversarial-review` の `gpt-sol`)は選ばれない | 仕様とする(オーケストレーター決定 2026-09-24)。後ろの候補は、位置に依存しない `--list-live-models` の `recommendedFor`、`--list-coverage` の `models`、推奨外役割の警告では引き続き意味を持つ。外部ベンダーを使いたい役割は個別調整で選ぶ |
| `RECOMMENDED` の並べ替えで、既存の custom 構成で setup-agents を再実行したときに提示されるモデルが変わる | 移行節に書く。生成済みの定義は `--merge` で保持され、自動では変わらない |
| このリポジトリの `complex-reviewer.md`(gpt-astra)が `e2e-verify` を持ち続けるため、再生成のたびに推奨外の警告が出る | 受容する(ユーザー決定 2026-09-24)。定義の役割構成を保つことを優先する |
| `gemini` の削除後、Gemini のエイリアスを配っている構成では `vendorFor` が `unknown` を返し、live 照会が成功した状態の個別経路が `--vendor` を求めて止まる | 移行節で `--vendor none` か他のベンダーの指定を案内する。ウィザードは `unknown` のエイリアスにベンダーを選ばせる手順を持つ |
| 生成済みの定義に `agent-policy-vendor: gemini` が残る | `Vendor` にない値になる。SessionStart と対応表での扱いを実装時に確かめ、影響があれば §7 に記録する。移行節で再生成を案内する |
| 執筆の節を全定義へ出すことで、合成した定義の本文が長くなる | 旧 `doc-writing` の作業手順と同程度の分量(5 項目 + ja の例 5 つ)に収める。Agent tool の制約から D1 の 12 行が消えるため、Agent 可の定義では差し引きで短くなる |
| `custom-policy` の SKILL.md と規律の合計が 30,720B を超える。`context-map-guide.md` は方針スキルの参照に入っていないため、その削除では余裕が増えない | §4.10。規律の純増を 3,983B 以内に抑え、T6 / T7 で超える見込みなら撤去を先に済ませるか足す条項を短くする。超えたら止めて報告する |
| en の `_common.md` や断片へ日本語が入り、英語純度検査が落ちる | 0.19 の実装中に実際に起きた(旧設計 §7-2)。依頼文で明記する。T5 で検査を全役割の en 合成へ広げるため、それ以降はどの断片に入っても検出される |
| `_common.md` の Agent tool の節の見出しを変え、`agentConstraintHeading` と一致しなくなる | 見出しを変えない。`compose.test.ts` の文言検査が検出する |
| 断片に `###` を入れ、合成時に他役割の箇条書きへ紛れる | 依頼文で明記する |
| 再生成で `disallowedTools` と MCP の付与が失われる | GOTCHA-001 の手順(§5.16) |
| 実装 4 役割の基準を上から評価すると、`complex-impl` の条件(公開インターフェースを変える)に当たる機械的な変更まで `complex-impl` に振られる | 仕様どおりである。公開インターフェースを変える変更は機械的でも影響が大きいため、上位の役割に振る |
| `escalation` の発火条件を数える主体(誰が何回委譲したか)がオーケストレーターの記憶に依存する | 依頼文に試行履歴を載せる規律で、数えた結果を明示させる。escalation 断片が履歴の無い依頼を差し戻す |

## 9. 不採用案

| 案 | 不採用の理由 |
| --- | --- |
| `doc-review` の ID を `knowledge-elicitation` の意味で流用する | 既存の定義の `agent-policy-role: doc-review` が、更新後に別の役割(暗黙知の抽出を任意の成果物へ広げたもの)として解釈される。利用者が気付かないまま役割の中身が変わる |
| 旧 ID を新 ID へ読み替える別名表を持つ | 別名は `ROLES` の外に第 2 の ID 空間を作り、`--list-roles`・対応表・テストの全箇所で扱いを決める必要がある。改名は一度きりであり、移行節の書き換え案内で足りる |
| 執筆基準を `_common.md` だけに置く | 規律の読者であるオーケストレーターに届かない(§4.1) |
| 執筆基準を規律だけに置く | サブエージェントは規律を読まない(§4.1) |
| 執筆の節を `withAgent` が真のときだけ出す | Agent 否の役割が文書を書く場面で基準を持たない(§4.1) |
| 執筆基準を `## 制約` 節へ混ぜる | 制約は役割ごとの禁止と範囲を束ねる節であり、書き方の基準とは性質が違う。見出しで引けなくなる |
| 「文書作成を委譲するとき」の節ごと削除する | GOTCHA-002 の対策が失われる。完成文を渡さない規則は委譲先の役割に関係なく要る(§4.2) |
| `adversarial-review` を §設計・実装計画の規律 の標準フローへ入れる | 要件で除外された。毎回の起動はコストに見合わない |
| `adversarial-review` に Agent Tool を許可する | 反例を積む作業に再委譲は要らない(§4.4) |
| `--models` を残して `--recommended` と併存させる | 既定の生成単位が 2 通りになり、SKILL.md の手順が分岐する。要件で廃止が確定している |
| `--recommended` の vendor を `resolveVendor` で決める | live の推定が `unknown` のとき throw し、非対話モードが止まる。推奨の ModelSpec を使う経路として、推定を通さない(§4.5) |
| context-map を残し、`explore-lead` だけを廃止する | context-map を書く役割が無くなり、オーケストレーターが書くことになる。依頼文で事実を渡す運用と二重になる |
| 探索の 3 ターン基準を設けず、探索をすべて委譲する | 1 回の Read で済む確認まで委譲すると起動のコストが上回る |
| 実装 4 役割の基準を断片にだけ置く | オーケストレーターは断片を読まずに振り分ける(§4.8) |
| advisor の相談条件を「迷ったとき」のまま、例を足して補う | 例は閉じた列挙として読まれ、例に無い状況で相談が選ばれない。観測できる条件に置き換える |
| `--recommended` の解決規則を「外部ベンダーの候補を先に評価し、無ければ Claude」に変える | ユーザーが `RECOMMENDED` の並べ替えを選んだ(2026-09-24)。並びで役割ごとに選べるため、規則を役割に依存させずに済む(§4.11) |
| `RECOMMENDED` を並べ替えず、要件の解決規則のまま実装する | custom でも全役割で Claude のモデルが採られ、`design-review` が別ベンダーで検証する趣旨と合わない(§4.11) |
| `recommendedRolesFor` を将来の用途のために残す | 呼び出し元が無く、用途の見込みも無い(§3.3-2) |
| `--recommended` と個別のフラグの併用を黙って無視する | 利用者の指定が効いたと誤解させる(§4.5) |
| `gemini-flash` を推奨する役割の無い ModelId として残す | ユーザーが削除を選んだ(2026-09-24)。Antigravity 経由ではサブエージェントとして起動できず、推奨する役割も無くなる(§4.12) |
| ベンダー `gemini` を残す | ユーザーが削除を選んだ(2026-09-24)。Gemini のエイリアスは `--vendor none` か他のベンダーで扱える(§4.12) |
| 翻訳ディレクトリに残った旧断片を `--check-fragments` で検出する | 削除・改名は一度きりであり、移行節の案内で足りる(オーケストレーター決定 2026-09-24) |
| このリポジトリの定義名を新しい既定(`<model-id>-<default-name>`)へ揃え、複数役割の定義を分割する | ユーザーが既存の定義名と役割構成を保つことを選んだ(2026-09-24。§5.16) |

## 10. 未解決事項

なし。第 3 版で残っていた「このリポジトリに新設する敵対的レビュー定義の名前とモデル」は、ユーザーが `adversarial-reviewer` / `gpt-sol` と決めた(2026-09-24。§5.16)。

## 11. Done 条件

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `pnpm run build` を実行し、`plugins/agent-policy/scripts/` の差分が、対応する `src/` の変更と同じコミットにある。
- `plugin.json` と `package.json` がともに `0.20.0-dev` である。
- `ROLES` が 16 件で §5.1 の並びになり、担当表も 16 行で一致し、`discipline-role-table.test.ts` が通る。
- `grep -rn "doc-writing\|explore-lead\|independent-review\|doc-review\|context-map" plugins/agent-policy/src plugins/agent-policy/assets plugins/agent-policy/references plugins/agent-policy/skills` が、移行や履歴を説明する箇所を除いて 0 件である。
- `assets/roles/{ja,en}/` に `design-review.md` / `knowledge-elicitation.md` / `adversarial-review.md` があり、`doc-writing.md` / `explore-lead.md` / `independent-review.md` / `doc-review.md` が無い。`assets/context-map-template.md` と `references/context-map-guide.md` が無い。
- 合成したすべての定義に執筆の節があり、`## 制約` より前にある。en の定義に日本語が混入しない。
- `_common.md`(ja/en)の Agent tool の制約に、文書作成への再委譲の規定が無い。
- 規律に、実装 4 役割の基準、escalation の運用規律、advisor へ諮るオーケストレーターの条項、オーケストレーター向けの執筆基準、「文書の執筆を委譲するとき」の節がある。§サブエージェントの規律 に doc-writing の条項が無い。
- `--models` が `ok: false` を返し、`--recommended` が役割ごとに 1 定義を返す。`roleId` が応答にあり、`modelsDropped` と `rolesDropped` が無い。`--recommended` と個別のフラグの併用が `ok: false` を返す。
- `RECOMMENDED` が §5.2 の並びであり、`--check --recommended --scope custom` で各役割の先頭が採られる。
- `MODELS` が 9 件で `gemini-flash` を含まず、`Vendor` が 4 値で `gemini` を含まない。`grep -rn "gemini" plugins/agent-policy/src plugins/agent-policy/skills` が、`antigravity` の応答を `unknown` として期待するテストと `--vendor gemini` の拒否の検査を除いて 0 件である。
- `wc -c plugins/agent-policy/skills/custom-policy/SKILL.md plugins/agent-policy/references/orchestration-discipline.md` の合計が 30,720B 以下である(claude-model-policy 側は custom より小さいため測らない)。
- `compose.test.ts` の英語純度検査が `ROLES` の全 id を en で合成して検査している。
- プラグイン README に 16 種の役割表、9 種のモデル表、6 件の MCP 既定列挙、移行節「0.19 系から 0.20 系へ」がある。ルート `README.md` に「context-map」と「Gemini」が無く、役割数が 16 種である。
- `.serena/memories/agent_policy/core.md` と `.serena/memories/core.md` が 0.20 の内容に追随している。
- このリポジトリの `.claude/agents/` が既存の定義名と役割構成を保ち、旧 ID のマーカーが残っておらず、`adversarial-reviewer.md`(`claude-gpt-6-sol`)があり、`--list-coverage` の `uncovered` が空(または作らないと決めた役割だけ)で、再生成の前後で `disallowedTools` と MCP の行が失われていない。
- ARCHITECTURE への影響が無いことを確認した記録がある。
- 変更を実装計画書の方針で分けてコミットしている。
