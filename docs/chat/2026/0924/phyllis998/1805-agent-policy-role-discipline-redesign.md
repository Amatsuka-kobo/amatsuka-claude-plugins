# agent-policy 改修設計: 役割体系・規律基準・生成規則

- 日付: 2026-09-24
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 設計案 §1〜§4（役割表の改編、基準の移設、生成規則の統一、移行・テスト手順）
- 前提: agent-policy v0.19.8-dev、orchestration-discipline.md、ARCHITECTURE
- セッション ID: 5d1599d7-51d4-44d4-bbaa-649f6b185332

---

## セッション 1: agent-policy 役割・規律・生成の4項改修設計

# phyllis998

> agent-policyの複数の改修を行います。
> このセッションでは、設計と引継ぎをゴールとします。引継ぎではsession-handoverスキルを使い、プロンプトの執筆はprompt-smithを使ってください。
>
> 1.
> as-is: doc-writingがすべての文書とコメントを執筆する。
> to-be: doc-writingを廃止し、その執筆基準をすべてのエージェントの標準とする。
>
> 2.
> as-is: 設計書・実装計画書の独立レビューと、設計書・実装計画書のレビューでは、一見役割が被って見える。
> to-be: 設計書・実装計画書の独立レビューを設計書・実装計画書のレビュー(doc-review)と改め、元のdoc-reviewは、暗黙知の抽出・理解レビュー(knowledge-elicitation)とし、対象を設計書・実装計画書に限らないようにする。
>
> 3.
> as-is: 敵対的レビュアーの役割がない
> to-be: 敵対的レビュアーの役割を新設する。推奨モデルはOpus, gpt-solとする。
>
> 4.
> as-is: setup-agentsのデフォルトは、1つのモデルに対する推奨帯をすべてもつエージェントを定義する
> to-be: setup-agentsのデフォルトは、1役割1エージェントとする

# AI

Using agent-policy:custom-policy → superpowers:brainstorming → 設計 → session-handover + prompt-smith。

分類: **architectural**(担当表・規律文書・setup-agents の生成規則 3 系統に跨る)。設計書 → 引継ぎの流れ。まず現状探索。

設計案。節ごとに承認を求める。まとめて可否を返してよい。

## §1 担当表(17 役割のまま。1 廃止・2 改名・1 新設)

| 変更 | RoleId | 役割名 | 種別 | Agent Tool | Claude | RECOMMENDED(custom) | default-name |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 廃止 | `doc-writing` | 文書作成 | — | — | — | — | — |
| 改名 | `independent-review` → `design-review` | 設計書・実装計画書のレビュー | readonly | 可 | Sonnet | sonnet, grok | `docs-reviewer` |
| 改名 | `doc-review` → `knowledge-elicitation` | 暗黙知の抽出・理解レビュー | readonly | 否 | Haiku | haiku | `knowledge-elicitor` |
| 新設 | `adversarial-review` | 敵対的レビュー | readonly | 否 | Opus | opus, gpt-sol | `adversary` |

- 並び: `design-review` は旧 independent-review の位置、`knowledge-elicitation` は旧 doc-review の位置、`adversarial-review` は `gate-review` の直後・`advisor` の直前(advisor 末尾固定のテスト維持)。
- `design-review`: 断片本文は旧 independent-review をそのまま継承(原本のみ・反証提示)。「順 2/3 へ進めず省略」規則も継承。
- `knowledge-elicitation`: 対象を「設計書・実装計画書」から「文書・指示書・仕様・コードなど任意の成果物」へ広げる。Output(理解した内容/暗黙知/矛盾/過不足)は維持。tools Read/Grep/Glob。
- `adversarial-review`: 対象は任意成果物。「破る立場」で読み、失敗経路・境界条件・前提の突き崩し・具体的反例(再現手順)を提示。採否判断しない。tools Read/Grep/Glob/Bash。標準フローには組み込まず、オーケストレーターが必要と判断したときだけ起動。design-review(別ベンダーの前提検証)・final-review(完了可否)との違いを When to invoke に明記。

## §2 doc-writing 廃止と執筆基準の移設

- 削除: `ROLES`/`RECOMMENDED`/`ASSIGNMENTS`/`SOLO_DENIED_ROLES` の項目、`assets/roles/{ja,en}/doc-writing.md`、setup-agents の MCP 既定付与列挙、README §MCP の列挙。
- 執筆基準の新居(2 箇所。読者が違うため重複を許容):
  - `_common.md` ja/en に新節 `## 文書の執筆` / `## Writing` を追加し、`compose.ts` が無条件で出力(`vocabulary.ts` に見出し追加、`制約` の直前)。内容 = 旧 doc-writing §作業手順(正しい文法・簡潔・回りくどさ回避・出典最小・意訳)。ja の 5 語例(バージョン/パス・失敗/確定版/一覧・管理表・ログ/ステップ)は ja だけ。
  - `orchestration-discipline.md` に同基準を、オーケストレーター自身が書くときの規律として置く。
- `_common.md` `## Agent tool の制約`: 再委譲節(D1)を撤去し「Agent tool の用途はアドバイザーへの相談だけ」へ戻す。§制約 の「本文に載せる」受信側規則は文書一般の規則として残す。
- 規律 §オーケストレーターが自ら担う作業: 「自ら書かず委譲」(F1)撤去。§文書作成を委譲するとき → 「文書の執筆を委譲するとき」に改題し、GOTCHA-002 由来の例示規則(本文に載せる/閉じた列挙にしない/判断の軸)と依頼文の形は役割非依存の規則として残す。「サブエージェントは〜」12 条項のうち doc-writing 再委譲の 1 条項を削除。
- `general`: description を「定型メンテナンス・文書作成など、レビュー・設計を除く一般作業」へ戻し、When to invoke に文書作成を復帰。`design-plan`/`explore-lead` の「確定後の文章化は再委譲可」1 行を削除。
- バイト上限: 規律 + context-map-guide ≤ 30,720B を実装時に `wc -c` で確認(削除量 > 追加量の見込み)。

## §3 setup-agents 既定 = 1 役割 1 定義

- CLI: `--models <csv>` を廃止フラグへ(`ok:false`)。新フラグ `--recommended [--roles <csv>]`。
  - 役割ごとに、custom は `RECOMMENDED[role]`、claude は `ASSIGNMENTS[role]` の先頭から順に live models に実在する最初の ModelId を採る。照会失敗時は先頭を採り warning。全滅なら `rolesDropped: [{role, models}]`。
  - 定義名 `<model-id>-<default-name>`(例 `opus-adversary`、`grok-docs-reviewer`)、`roles` 単一、vendor は ModelSpec から。`results[]` に `roleId` を付ける。`modelsDropped` は廃止。
  - `--roles` で対象役割を絞れる → MCP 付与の有無で 2 回に分けて発行できる。
- SKILL.md: ステップ 4/5 をモデル中心から役割中心へ書き換え。`--check --recommended` で「役割 / モデル / 定義名 / 差分」表 → 全部作る/一部調整/中止。個別調整は既存 `--model-id … --roles <1件>` 経路。5c の MCP 既定配分は impl 役割の定義に付与・readonly は付けない(現行どおり、定義 = 役割なので分離問題が消える)。6b の「同モデルの役割をまとめて 1 定義にするか」の質問を削除。非対話モードのハードコード ID 一覧を削除し `--write --merge --recommended --scope X`。
- 5b の kind 混在警告は「個別調整で複数役割を選んだとき」だけ残る。

## §4 移行・テスト・周辺

- バージョン: `0.19.8-dev` → `0.20.0-dev`(plugin.json / package.json)。
- README: 「0.19 系から 0.20 系への移行」節。RoleId 改名(`agent-policy-role` の書換え or 再生成)、`doc-writing` 定義の削除、`--models` 廃止、既定生成単位の変更。
- テスト: roles/fragments/policies の 17 件固定と id 列挙、compose の doc-writing 再委譲・independent-review 文字列、setup-agents の `--models による推奨一括` describe を `--recommended` へ、`_common` 英語純度、discipline-role-table は自動追随。
- このリポジトリの `.claude/agents/`: 実装後に再生成(GOTCHA-001: `--mcp-deny` 明示・退避・差分確認)。`document-writer.md` 削除、`knowledge-elicitationer`/`docs-reviewer` の role マーカー書換え、敵対的レビュー定義を追加。
- Serena メモリ `agent_policy/core` 更新。ARCHITECTURE/ADR は影響なし(層・依存不変)。
- 不採用: `doc-review` id 流用(既存定義の誤解釈)、敵対的レビューの標準フロー組込み(コスト)、`--models` 温存(優先順位が別途要る)。

**確認したい点**: default-name 3 件(`docs-reviewer` 継承 / `knowledge-elicitor` / `adversary`)と `_common` の新節見出し名。異論なければこのまま設計書執筆へ進む。

設計案 §1〜§4 を提示済み。承認、または default-name 3 件・`_common` 新節見出し名への修正指示を待つ。

## セッション 2: §5追加：context-map廃止要件をagent-policy設計へ組み込む

# AI

記録完了通知のみ。設計案 §1〜§4 の承認待ち。

設計案 §1〜§4 の承認待ち。

# phyllis998

> 追加要件です。
> context-mapに関して、これまで運用してきた中で目立った効果は確認されず、設計書などと内容の重複してしまいあまり役に立っていないようでした。
> context-mapの作成とコードベース探索統括の役割を廃止したいです。なお、コードベース探索実働に関しては、そのまま"コードベース探索"の役割として存続します。

# AI

§5 追加要件を設計へ組み込む。§1〜§4 との整合点も含めて提示。

## §5 context-map と探索統括の廃止

- 削除: 役割 `explore-lead`(`ROLES`/`RECOMMENDED`/`ASSIGNMENTS`、`assets/roles/{ja,en}/explore-lead.md`)、`references/context-map-guide.md`、`assets/context-map-template.md`、`.gitignore` の `.claude/context-maps` 行。役割数 17 → **16**。
- `explore`: id 維持、役割名「コードベース探索実働」→「コードベース探索」、default-name 維持。本文から「統括からの再委譲」前提を外し、オーケストレーターから直接依頼される形へ。Output は事実の報告(パス・行番号・根拠)。種別 readonly・Agent Tool 可は現状維持。
- 規律 `orchestration-discipline.md`:
  - §コードベース探索を書き換え。「探索は『コードベース探索』へ委譲する。grep/read の反復が 3 ターン以上見込まれる探索は 1 回の dispatch にまとめる。探索結果の突き合わせ・未解決事項の判断・要件確定はオーケストレーターが行う」。context-map-guide への参照を削除。
  - §設計・実装計画の規律 先頭「context-map 作成後に着手」→「探索で確定した事実(パス・行・現況)を要件・受け入れ基準とともに依頼文で渡してから設計書執筆へ委譲する」。
  - §分析 の「複数の context-map・…」から context-map を除去。
- 断片: `design-plan` の入力から context-map を外し「渡された探索結果と実コードに食い違いがあれば報告」へ一般化。`_common.md` §制約 の context-map 条項も同様に一般化(ja/en)。
- `setup-agents`: MCP 既定付与の列挙から `explore-lead` を除去(§2 の `doc-writing` 除去と合わせ、impl 役割 6 件)。SKILL 5c-3 の混在例(`explore`/`explore-lead`)を削除。
- テスト: roles.test の design-plan/explore-lead 形状検査、compose.test の並び順検査(L119–122)、marker-scan.test のラベル検査、setup-agents.test の役割列挙。
- README: 役割一覧・移行節に「explore-lead 廃止・context-map 廃止・`explore` の役割名変更」。既存 `.claude/context-maps/` は各プロジェクトの判断で削除と案内。
- このリポジトリ: `system-planner`(design-plan + explore-lead)と `general-explore` を再生成対象に追加。
- 副次効果: 30KB 上限の計算対象から context-map-guide(6,169B)が外れ、規律の追記余地が広がる。

**§1〜§5 まとめて承認可否を返してほしい。** 承認後、設計書執筆(system-planner)→ 理解レビュー(knowledge-elicitationer)→ 独立レビュー(docs-reviewer)→ 提示、の順で進める。

§1〜§5 の承認待ち。

## セッション 3: context-map廃止要件を確認、設計案§1-§5の承認待ち

# phyllis998

> .gitignoreのcontext-mapsは残しておいてください。

# AI

了解。§5 から `.gitignore` の削除を外す。`.claude/context-maps` 行は残す。

その他 §1〜§5 は承認と解釈してよいか。承認なら設計書執筆へ進む。

記録通知のみ。§1〜§5(`.gitignore` 維持で修正済み)の承認待ち。

§1〜§5 の承認待ち。

§1〜§5 の承認待ち。

## セッション 4: e2e推奨モデル削減と実装4役割基準の見直し案

# AI

§1〜§5 の承認待ち。

§1〜§5 の承認待ち。

# phyllis998

> 1~5は承認します。
> 申し訳ないですが追加要件です。
> e2e-verifyの推奨モデルからgpt-astraを外したいです。また、excalationの役割がまだ一度も仕事をしていないので、complex-impl,normal-impl,light-impl都も併せて基準の見直しを行いたいです。

# AI

§6・§7 の設計案。承認後に設計書執筆へ進む。

## §6 e2e-verify の推奨モデル

- `RECOMMENDED["e2e-verify"]`: `["sonnet", "gpt-astra"]` → `["sonnet"]`。`ASSIGNMENTS` は Sonnet のまま。policies.test の固定値を追随。

## §7 実装 4 役割の基準見直し

現状の問題: 規律 §モデル別役割の運用 の 3 行(複数コンポーネント/単一コンポーネント/機械的反復)だけで、escalation の発火条件が無い。境界も「設計判断の有無」という主観語に依存。

**observable な基準へ置き換え(規律 §モデル別役割の運用 と各断片 When to invoke を同じ基準で揃える)**

| 役割 | 基準(どれか 1 つで該当。上から評価し最初に該当した役割) |
| --- | --- |
| `escalation` | 同じ作業を同じ実装役割へ 2 回委譲して完了しない / 実装役割からの差し戻しで原因が未特定 / テスト・型検査・lint の失敗を実装役割が 2 回直して解消しない |
| `complex-impl` | 公開インターフェース(型・API・CLI 引数・ファイル契約・フック)を変える / 2 つ以上のコンポーネント(パッケージ・プラグイン・層)を同時に変える / 参照できる既存パターンが無く新しい構造を決める / 失敗の影響が全セッション・保護パス・データ移行に及ぶ |
| `normal-impl` | 1 コンポーネント内 / 既存パターンの踏襲 / 公開インターフェース不変。テストの追加・修正、設定編集、ビルド/テスト実行を含む |
| `light-impl` | 変更内容が依頼文で完全に指定済み / 対象を Glob・Grep で列挙できる / 新しいロジックを書かない(一括適用・一括チェック・反復変換・定型の小変更) |

- escalation の運用規律(オーケストレーター側): 発火条件に該当したら、オーケストレーターが自ら原因を追わず escalation へ委譲する。依頼文に「試行履歴(誰に何を頼み、何が返ったか)」「失敗出力の原文」「未解決の制約」を必ず載せる。初回の作業を escalation へ委譲しない。
- escalation 断片: 上記の入力を要求し、無ければ差し戻す 1 行を追加。When to invoke に発火条件を転記。
- complex/normal/light 断片: When to invoke を上表の基準で書き直す。Core Responsibilities・手順・制約は維持。
- 4 断片の en 版も同内容で追随。
- 規律のバイト増は §5 の context-map-guide 削除分で吸収。

**§6・§7 承認可否。** 承認で §1〜§7 を設計書へ。

§6・§7 の承認待ち。

## セッション 5: §6-8 の設計案（e2e-verify・実装役割・advisor 基準）

# AI

§6・§7 の承認待ち。

§6・§7 の承認待ち。

# phyllis998

> escalationと同じ構造で、advisorもあまり機能していないように感じます。こちらも基準を見直すことはできますか？

# AI

## §8 advisor の基準見直し

原因は escalation と同型。`_common.md` の「判断に迷ったときだけ」が主観語で、迷いは差し戻しでも解消できるため相談が選ばれない。オーケストレーター側には相談の規律が無く、advisor は誰からも呼ばれない。

**observable な発火条件へ置き換え(`_common.md` §アドバイザーへの相談 と規律の「サブエージェントは〜」条項、advisor 断片 When to invoke を同じ基準で揃える)**

- サブエージェントが相談する条件(どれか 1 つ)
  - 依頼文に無い判断が要り、選択肢が 2 つ以上あり、どれを選ぶかで成果物の構造(インターフェース・ファイル配置・依存関係)が変わる
  - 依頼文と実コードが食い違い、どちらに合わせるかを依頼文から決められない
  - テスト・型検査の失敗に原因候補が複数あり、再現で 1 つに絞れない
- 相談しない条件(差し戻しまたは自分で確認)
  - 依頼文に書かれた事項の確認 → 依頼文を読む
  - Read/Grep で確かめられる事実 → 自分で確かめる
  - 命名・表記・並び順の選択 → 既存パターンに合わせて自分で決める
  - 作業範囲の拡大が要る判断 → 差し戻す
- オーケストレーター側の新条項(§オーケストレーターが自ら担う作業 §分析 へ)
  - レビューの指摘が互いに対立し、採否の軸を自分で言葉にできないとき
  - 要件確定で選択肢が 2 つ以上あり、ユーザーへ提示する判断軸を自分で立てられないとき
  - → advisor へ諮り、軸と推奨を受け取ってから判断する。結論は自分が出す(advisor に採否を委ねない)。
- 依頼文の必須項目: 選択肢の列挙、判断を縛る制約、関係ファイルのパス。advisor 断片は、これらが無ければ推測せず不足を返す(現行維持)。
- advisor 断片 Output: 推奨は 1 案。条件付きなら条件を明記。「判断できない事項」欄は維持。
- 推奨モデル Fable / gpt-astra、Agent Tool 否は維持。

**§6〜§8 承認可否。** 承認で §1〜§8 を設計書へ。

§6〜§8 の承認待ち。

## セッション 6: agent-policy §6-8：role 基準を observable 条件で統一

# AI

§6〜§8 の承認待ち。

§6〜§8 の承認待ち。

# phyllis998

> 承認します

# AI

設計書・実装計画書の執筆を system-planner へ委譲中。完了後、理解レビュー(knowledge-elicitationer)と独立レビュー(docs-reviewer)を並列で dispatch し、指摘の採否をまとめて提示する。

設計書執筆の完了待ち。

## セッション 7: gemini ベンダー削除を要件に追加、改訂待ち

# AI

設計書執筆の完了待ち。

設計書執筆の完了待ち。

設計書・実装計画書の初稿完了。執筆者から未解決事項 10 件。8 件は判断済み(下記)。2 件はユーザー判断が要る。

**自分で決めた 8 件**
- `recommendedRolesFor`: 呼び出し元が消えるため削除。
- `design-plan` 断片: 消すのは L31「文体は『文書作成』の規律に従う」(執筆者の案どおり)。
- `design-review` 制約文の冒頭は新役割名に合わせ、テストも追随。
- `--recommended` と `--model-id`/`--name`/`--model`/`--vendor`/`--keep` の併用は拒否(`ok:false`)。
- `gemini-flash`: `MODELS` と README の表に残す。推奨役割ゼロは許容(個別調整で選べる)。
- ステップ 1b「未カバーの役割だけ作る」と 6b は `--recommended --roles <uncovered>` へ置き換え。
- 翻訳ディレクトリの旧断片: README 案内のみ。CLI 検出は作らない。
- `general` の Core Responsibilities にも文書作成を戻す。

`gemini-flash` の削除を要件 9 として設計へ追加済み(ベンダー `gemini` と `antigravity` 推定は残す)。system-planner の改訂完了待ち。完了後、理解レビューと独立レビューを並列 dispatch。

# phyllis998

> ベンダーも削除でお願いします

# AI

ベンダー `gemini` の削除も要件 9 に含めた(`Vendor` 4 値化、`antigravity` 推定は `unknown` へ戻す)。system-planner の改訂完了待ち。

system-planner の改訂完了待ち。

## セッション 8: 設計書・実装計画書第3版の完成と2レビュー指摘の統合

# AI

system-planner の改訂完了待ち。

system-planner の改訂完了待ち。

Antigravity 注記は `gemini-flash` の行と一緒に削除(Gemini を扱わなくなるため)。レビュー修正と一緒に反映させる。理解レビューと独立レビューを並列 dispatch。

2 レビュー並列実行中。完了後に指摘の採否をまとめて提示。

理解レビュー受領。独立レビュー(docs-reviewer)の完了を待って、両方の採否をまとめて判断する。

独立レビューの完了待ち。

両レビュー受領。採否を判断し、設計書 第 3 版へ反映させる。

**採用(独立レビュー)**
1. `--recommended` の連鎖は Claude enum で必ず止まる → `rolesDropped` は組み込み役割で到達不能。`rolesDropped` を削除し、Claude enum 以降の候補が `--recommended` では採られないことを仕様として明記。
2. 合成検査(文書作成/doc-writing/context-map 不在)は T2 では赤になる → T3 へ移し、禁止語は `doc-writing` と `context-map` に限定(`general` の「文書作成」は正当)。ja `_common.md` L20 も T2 の書き換え範囲に含める。
3. 30KB の測定対象が誤り → 正しくは方針スキル本文 + 規律(custom-policy 2,421B + 規律 24,316B = 26,737B、余裕 3,983B)。Done 条件と T6/T12 の検査を差し替え。
4. `setup-agents.test.ts` の行の取り違え → T5 は L469(gpt-sol)を `["complex-impl","adversarial-review"]` へ、T1 は L472-480(astra)。
5. 英語純度検査は complex-impl/explore しか合成しない → 全役割を回すよう T5 で拡張。
6. §5.3「COLORS は変えない」と §5.2b の矛盾 → 文言修正。

**採用(理解レビュー)**: T2 で触る `_common.md` の行範囲明記、T3 時点の `rolesFor("sonnet")` 期待値、T14 の照合対象の対応表、compose.test の行範囲の統一、`Vocabulary` フィールド名 `writingHeading` の確定、文言は実装者が prompt-smith の規律で決める旨の明記。

**不採用**: ベンダー色の「新値の初期化場所」(削除のみで新値なし)、翻訳ディレクトリ旧断片の実装タスク化(README 案内のみで決定済み)。

第 3 版の改訂を system-planner へ委譲中。完了後、設計書のパスと要点を提示して承認を求め、承認後に引継ぎ資料へ進む。

設計書・実装計画書 第 3 版 完成。2 レビュー(理解・独立)の指摘を反映済み。

- 設計書: `harness-docs/design/2026-09-24-agent-policy-role-overhaul-design.md`(803 行)
- 実装計画書: `harness-docs/plans/2026-09-24-agent-policy-role-overhaul-plan.md`(449 行、T0〜T16)

**要点**
- 要件 9 件(doc-writing 廃止 / レビュー改名 / adversarial-review / 1 役割 1 定義 / context-map 廃止 / e2e-verify / 実装 4 役割 / advisor / gemini 削除)。役割 17 → 16、MODELS 10 → 9、Vendor 5 → 4 値。
- `--recommended` は各行の最初の Claude enum で必ず止まる仕様(§8)。`rolesDropped`・`modelsDropped` は持たない。
- 30KB の測定対象は `custom-policy/SKILL.md` + 規律(現在 26,737B、純増上限 3,983B)。
- 自リポの `.claude/agents/` は既存名・役割構成を保って個別経路で再生成。未解決は敵対的レビュー定義の名前とモデルだけ(T16 でユーザー確認)。
- コミット単位: T1(e2e)→ T1b(gemini)→ T2〜T8(要件ごと)→ T9 SKILL → T10 README → T11 版 → T12〜T16 検証・メモリ・再生成。

**承認可否。** 承認で session-handover(引継ぎ資料 + goal 用プロンプト、prompt-smith 適用)へ進む。修正点があれば指摘を。

設計書・実装計画書の承認待ち。

# phyllis998

> 承認します

# AI

設計書・実装計画書をコミット(`0757bdb`)。引継ぎ資料と goal プロンプトを document-writer へ委譲中。完了後に確認してコミットし、要約を返す。

引継ぎ資料の執筆完了待ち。

## セッション 9: 敵対的レビュアー定義を確定し全文書を反映完了

# AI

引継ぎ資料の執筆完了待ち。

引継ぎ資料の執筆完了待ち。

完了。設計と引継ぎの成果物 4 本をコミット済み。

**成果物**
- 設計書 `harness-docs/design/2026-09-24-agent-policy-role-overhaul-design.md`(第 3 版、理解レビュー + 独立レビュー反映済み)
- 実装計画書 `harness-docs/plans/2026-09-24-agent-policy-role-overhaul-plan.md`(T0〜T16、T1b 含む)
- 引継ぎ資料 `harness-docs/handover/2026-09-24-agent-policy-role-overhaul-handover.md`
- goal プロンプト `docs/prompts/2026-09-24-agent-policy-role-overhaul-prompt.md`(1,165 字)

**コミット**
- `0757bdb` 設計書・実装計画書
- `7b69744` 引継ぎ資料・プロンプト

**要件 9 件(承認済み)**: doc-writing 廃止と執筆基準の標準化 / `design-review`・`knowledge-elicitation` へ改名 / `adversarial-review` 新設 / setup-agents 既定 1 役割 1 定義(`--recommended`、`RECOMMENDED` 並べ替え)/ context-map と explore-lead 廃止 / e2e-verify は sonnet のみ / 実装 4 役割の観測可能な基準 / advisor の相談条件 / `gemini-flash` とベンダー `gemini` 削除。版は 0.20.0-dev。

**次セッション**: `docs/prompts/2026-09-24-agent-policy-role-overhaul-prompt.md` の本文を goal コマンドへ渡す。未解決は敵対的レビュー定義の名前とモデルだけ(T16 前に確認)。本件と無関係な未コミット変更(`cliproxyapi.config.example.yaml`、`docs/chat/`)は触っていない。

# phyllis998

> 敵対的レビュアーの名前はadversarial-reviwer、モデルはsolでお願いします

# AI

`adversarial-reviwer` は `adversarial-reviewer` の誤記と解釈して進める(違えば指摘を)。モデル `gpt-sol`(`claude-gpt-6-sol`)。設計書・計画書・引継ぎ・プロンプトの未解決事項を確定値へ置き換える。

反映完了。コミット `8db8abe`。

- 定義名 `adversarial-reviewer`(`adversarial-reviwer` は誤記と解釈。違えば指摘を)、モデル `gpt-sol`(`claude-gpt-6-sol`)。
- 設計書 §5.16・§10・§11、計画書 §1・T16 手順 6・§6・§8、引継ぎ資料、goal プロンプトの 4 文書から「ユーザーに確認」を消し、確定値へ置換。未解決事項ゼロ。
- goal プロンプトは 1,218 字(上限 4,000 字内)。

次セッションは `docs/prompts/2026-09-24-agent-policy-role-overhaul-prompt.md` の本文を goal コマンドへ渡して開始。

設計と引継ぎは完了(コミット `0757bdb` / `7b69744` / `8db8abe`)。次セッションは `docs/prompts/2026-09-24-agent-policy-role-overhaul-prompt.md` の本文を goal コマンドへ渡して実装を開始する。
