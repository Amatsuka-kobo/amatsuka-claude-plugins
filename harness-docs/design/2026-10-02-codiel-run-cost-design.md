# codiel:run のコスト効率を改善する 設計書

指摘の一覧は付録 `2026-10-02-codiel-run-cost-findings.md` にある。この設計書で「A7」「C22」のように書いた ID は付録の行を指す。

## 1. 確定済みの決定(この設計の前提)

ユーザーとの合意(2026-10-02)で次を決めた。実装の判断で覆さない。

| ID | 決定 |
| --- | --- |
| K1 | prompt-smith の評価で出た指摘 181 件(付録)を改修の入力にする |
| K2 | HARD-GATE と Red Flags は両方を削る。本文の手順と重ならない条項だけを、その操作をする手順の中へ移す(§5.1) |
| K3 | 委譲先スキルと `orchestrating-runs` §3 の dispatch テンプレートが同じ規則を持つときは、委譲先スキルの側を正本にする。テンプレートは、読むスキルと実行時の値だけを渡す(§5.2) |
| K4 | 特定の場面でしか使わない手順は、そのスキル配下の `references/` へ切り出し、その場面に入ったときに読ませる(§5.3) |
| K5 | プラグインのバージョンは上げない。`.claude/rules/metatron/conventions.md` の Done の条件「バージョンを上げる」より、この決定を優先する |
| K6 | 施策 P1(review の観点を選ぶ規則、§6.1)を採る |
| K7 | 施策 P3(改修の前後の計測、§7)を採り、受け入れ基準にする |
| K8 | 施策 P4(compaction の後の読み直し、§6.2)を採る |
| K9 | 施策 P5(完了報告の項目の固定)と P6(判断用の抜粋)を採る(§5.4) |
| K10 | 施策 P7(フェーズの境目でのセッションの切り替え、§6.3)を採る |
| K11 | 施策 P2(再レビューを、所見が出た観点と修正差分に絞る)は採らない |

K2 は、評価の担当とオーケストレーターが推奨した「HARD-GATE は縮めて残す」を採らない決定である。K4 の切り出し先は `references/` であり、`plugins/codiel/docs/` ではない。ARCHITECTURE は `docs/` を「読まない」場所と定めている。

## 2. 背景と目的

codiel の run は、オーケストレーターと委譲先が読む指示書の量が大きい。run が辿る指示書は 23 本、合計約 300KB ある(2026-10-02 に `wc -c` で計測)。最大は `skills/orchestrating-runs/SKILL.md` の 95,193B で、run の開始から終わりまでオーケストレーターのコンテキストに載る。

コストは「読まれる回数 × バイト数」で決まる。回数が多い箇所は 2 つある。

- `orchestrating-runs` と `raguel-gating`(26,204B)は run の開始から載る。オーケストレーターの毎ターンのキャッシュ読み出しに入る。
- `reviewing-diffs`(12,131B)は、review の観点ごとに担当 1 人が読む。7 観点なら 1 回のレビューで約 92KB になる。再レビューのたびに同じ量が載る。

この改修の目的は、run 1 回あたりのトークン消費を減らすことである。run の手順と成果物は変えない。例外は P1 で、観点を選ぶ規則が実行側のスキルに無いという欠落を直す。

## 3. 前提

### 3.1 指示書の読まれ方

| 読み手 | 読む時点 | 指示書 |
| --- | --- | --- |
| オーケストレーター | run の開始から | `commands/run.md`、`orchestrating-runs`、`raguel-gating`、`references/intent-common.md` |
| オーケストレーター | そのフェーズに入ったとき | `capturing-intent`(intent)、`facilitating-design-discussions`(discuss・design)、`syncing-intents`(intent-sync)、`fixing-review-findings`(fix-loop)、`filing-followup-issues`(triage)、`references/intent-format.md`・`intent-writing.md`(intent・intent-sync) |
| 委譲先 | 委譲されたとき | `preparing-design-agendas`、`writing-design-docs`、`writing-dev-plans`、`writing-test-specs`、`implementing`、`fixing-failures`、`reviewing-diffs`、`running-regression-tests`、`scripting-tests`、`references/e2e-report-format.md`、`references/github-writing.md` など |

codiel は既に「フェーズに入ったときに読む」構造を持っている。K4 の `orchestrating-runs` の分割は、この構造に `orchestrating-runs` 自身をそろえる変更である。

### 3.2 評価の結果

文の総数が 10 未満の references は評点を出していない。

| 指示書 | バイト | 冗長度 | 充足度 | スタイル適合 |
| --- | --- | --- | --- | --- |
| orchestrating-runs | 95,193 | 4 | 4 | 4 |
| capturing-intent | 28,888 | 4 | 4 | 4 |
| syncing-intents | 12,359 | 3 | 5 | 4 |
| references/intent-format.md | 27,575 | 4 | 5 | 5 |
| references/intent-common.md | 3,022 | 3 | 5 | 4 |
| references/intent-writing.md | 1,748 | 3 | 5 | 5 |
| raguel-gating | 26,204 | 4 | 5 | 5 |
| fixing-review-findings | 12,545 | 4 | 5 | 4 |
| filing-followup-issues | 12,701 | 4 | 5 | 4 |
| facilitating-design-discussions | 7,911 | 4 | 5 | 4 |
| references/github-writing.md | 6,252 | 4 | 5 | 5 |
| preparing-design-agendas | 7,852 | 4 | 5 | 4 |
| writing-design-docs | 9,474 | 4 | 5 | 4 |
| writing-dev-plans | 13,157 | 4 | 4 | 4 |
| writing-test-specs | 13,079 | 4 | 5 | 4 |
| implementing | 13,004 | 3 | 5 | 4 |
| fixing-failures | 7,338 | 3 | 5 | 4 |
| reviewing-diffs | 12,131 | 3 | 5 | 4 |
| reviewing-diffs/references(7 本の合算) | 7,289 | 3 | 5 | 5 |
| running-regression-tests | 12,637 | 3 | 5 | 4 |
| scripting-tests | 10,295 | 3 | 5 | 4 |
| references/e2e-report-format.md | 7,008 | 3 | 5 | 5 |

指摘の中身は次の 4 種類に集まる。

- HARD-GATE と Red Flags が本文の手順を言い直している。ほぼ全スキルに当てはまり、合計 10KB を超える。
- 委譲先スキルと `orchestrating-runs` §3 の dispatch テンプレートが同じ規則を書いている(D1・D7・D31・D33 など)。
- 同じ規則が複数のスキルにある。例は「プラグインルート参照規約」(7 スキル)、E2E の実行の文(5 か所)、`gh api -F body=@` の投稿手順(github-writing と fixing-review-findings の 4 か所)。
- 特定の場面でしか使わない手順が本文に常に載っている(付録の各セクション末尾の「場面限定で切り出せるセクション」)。

### 3.3 探索で確かめた事実

2026-10-02 に general-explore へ委譲して確かめた。

- review の観点ファイルは 7 種類ある(`skills/reviewing-diffs/references/`: frontend・backend・data・doc・security・infra・generic)。`orchestrating-runs` は「観点ごとに委譲する」(L643・L646・L648・L732)とだけ書き、観点を選ぶ規則を持たない。規則は `plugins/codiel/docs/DESIGN.md:130-132` と README にだけあり、内容は「diff のドメインに応じた frontend/backend/data と、常時参加の doc/security」である。infra と generic をいつ選ぶかは、どこにも書かれていない。
- fix-loop の再レビューは、観点を毎回選び直し、`git diff <base>...<branch>` の全体を見る(`fixing-review-findings/SKILL.md:77-78`)。
- compaction の後、または同じセッションで run を続けるときに、スキルを読み直す規定は無い。§6 の再開手順(L814-865)は新しいセッションからの再開だけを扱う。`hooks/hooks.json` は PreToolUse と Stop だけを登録している。
- `scale: light` で省けるのは discuss と design の 2 フェーズで、省かれるゲートは design の `evaluate_design` だけである(`src/codiel-state.ts:182-184`)。
- skills と references の本文を検査するテストは無い。`src/hooks/__test__/guard-bash.test.ts:1426` が `orchestrating-runs/SKILL.md` のパスを文字列として使うだけである。

## 4. 指摘の読み替え規則

付録の「元の判定」は K1〜K11 より前に出ている。適用するときは次の規則で読み替える。付録の「採否」列に、当てる規則を書いた。

- W1: HARD-GATE と Red Flags を残す・縮める・1 つにまとめる判定は、すべて K2 に従う。両方を削り、本文に無い条項だけを手順へ移す(§5.1)。
- W2: 委譲先スキルの記述を削り dispatch テンプレートに任せる判定(D1・D7・D31・D27・D33)は、向きを逆にする。委譲先スキルの記述を残し、`orchestrating-runs` §3 の側を削る(§5.2)。
- W3: 「退避」の判定は、退避する内容の種類で行き先を分ける。
  - 場面限定の手順は、そのスキル配下の `references/` へ切り出す(§5.3)。そのスキル以外の読み手だけが使う手順は、読み手のスキルの `references/` へ移す(D24・E1)。
  - 根拠・経緯・理由・出典は、`plugins/codiel/docs/` の既存の設計書(`DESIGN.md`)へ移す。該当: B5 の理由、B22 の理由、B27、B28、D3、D14 の経緯、D27 の hooks の挙動、D35 の出典、E20、E27。移す先に同じ内容が既にあれば、移さずに消す。
  - 書き換えて重複先への参照にできる判定(B1 など)は、退避せず削除して参照にする。
- W4: 「プラグインルート参照規約」(C1・C14・C20・E12 と、`capturing-intent`・`initializing-harness` の同じセクション)は、改修後の本文に `<plugin-root>` を使う箇所が残るスキルでは残し、残らないスキルでは削る。`orchestrating-runs` の規約は残す。
- W5: `wait-add` の id 規則の正本は `orchestrating-runs` §3 とする(A11 は残す)。`raguel-gating` の同じ規則(C8)は §3 への参照にする。

## 5. 文書の改修

### 5.1 HARD-GATE と Red Flags の統合(K2)

- 各スキルの `HARD-GATE` と `Red Flags` のセクションを削る。
- 削る条項ごとに、本文の手順に同じ内容があるかを確かめる。無い条項だけを、その操作をする手順の中へ、条件付きの 1 文として移す。
- 移した先が分かるよう、移した条項の一覧を実装の完了報告に添える。
- 「HARD-GATE」「Red Flags」の語を、他のスキル・references・`commands/` が参照していないかを確かめ、参照があれば移した先の手順を指すように直す。

### 5.2 重複の正本(K3)

`orchestrating-runs` §3「ディスパッチプロンプトの規約」のテンプレートは、次だけを渡す形にする。

- 読むスキルの名前
- 観点ファイルのパス
- 入力ファイル・出力ファイルのパス
- §0 で解決した値(ARCHITECTURE と GOTCHAS のパス、実行モード、ドメインマップ)
- 前フェーズの申し送り
- セッションの規律の転記

委譲先スキルが既に持つ規則(ARCHITECTURE と GOTCHAS の扱い、報告のファイルを書かず最終の返答で返すこと、git 操作をしないこと)は、テンプレートと §3 の説明文から削る。オーケストレーター自身の作業(返答を `waits/<id>.md` に書き `wait-done` を呼ぶこと)は §3 に残し、ほかの 4 か所(A9)からは削る。

### 5.3 場面限定の手順の切り出し(K4)

#### 5.3.1 orchestrating-runs

本文には、run の開始から必要な部分だけを残す。残すのは、概要、チェックリスト、§0 前提確認、§1 run の解決、§2 フェーズ進行表と §2.1 成果物コミット規約と §2.4 共通、§3 ディスパッチプロンプトの規約、§4 ドメインディスパッチ、の 7 つである。

次を `skills/orchestrating-runs/references/` へ切り出す。ファイル名は実装で決めてよいが、フェーズ名を含める。

| 切り出す内容 | 読む時点 |
| --- | --- |
| §2 の軽量経路と、test-spec・dev-plan の並列手順(L211-240)、`writing-test-specs` の「軽量の run での同定」(D24) | test-spec または dev-plan に入ったとき |
| §2.5 worktree と §2.6 テストを実行する委譲の並べ方と環境の失敗 | test-code・implement・test-loop・fix-loop に入ったとき |
| §2.7 test-code の運転 | test-code に入ったとき |
| §2.8 implement の運転 | implement に入ったとき |
| §2.9 test-loop の運転と §5 のうち test-loop の部分 | test-loop に入ったとき |
| §2.10 E2E のレポート(e2e-report-format への参照に縮める。E29・E30) | E2E を実行する委譲を出す前 |
| §2.2 pr の運転 | pr に入ったとき |
| review の運転。P1 の観点を選ぶ規則(§6.1)と、`reviewing-diffs` の「所見の統合と投稿」(E1) | review に入ったとき |
| §5 のうち fix-loop の部分とスキップ経路 | fix-loop に入ったとき |
| §2.11 intent-sync の運転 | intent-sync に入ったとき |
| §2.3 finalize の運転 | finalize に入ったとき |
| §6 再開手順 | run を再開するとき |
| §7 失敗の記録 | 失敗の記録の契機があったとき |

本文の §2 に、「`start-phase <phase>` の直後に、そのフェーズの手順ファイルを Read する」の規則と、フェーズと手順ファイルの対応表を置く。

#### 5.3.2 ほかのスキル

| スキル | 切り出す内容 | 読む時点 |
| --- | --- | --- |
| raguel-gating | outcome の自動同期(C2)と `state.version` 1 の読み方(C12) | `/codiel:*` の起動時 |
| raguel-gating | 並列フェーズの ASK・STOP(C9) | test-spec・dev-plan のゲート |
| raguel-gating | 未コミット変更の分岐(C11) | `evaluate_code` が未コミットを理由に入力の誤りを返したとき |
| filing-followup-issues | ISSUE_TEMPLATE の読み方(C22) | テンプレートがある github モード |
| filing-followup-issues | local モードのチェックリスト(C25、§5.7) | 連携モードが local のとき |
| facilitating-design-discussions | 設計ウォークスルー(C28) | design フェーズ |
| capturing-intent | 手順 0、手順 1 の 4、手順 2 の入口の分岐、3-3-1 の領域名、手順 5 の (3) と (6)(付録 B の末尾) | 各分岐に入ったとき |
| syncing-intents | 持続層への取り込み | `domains` が空でないとき |
| github-writing | 画像の載せ方(C30)と PR 本文(C31)。§5.8 | 画像を載せるとき・PR 本文を書くとき |
| implementing | worktree 内での作業、E2E の実行とテストの実行環境、修正モード(付録 D の所見) | `parallel` のステップ・E2E があるとき・修正モード |

切り出した手順は、本文に「〜のときは `references/<file>.md` を Read して従う」の 1 文を残して指す。

### 5.4 完了報告の項目の固定(P5)と判断用の抜粋(P6)

- 委譲先スキルのうち、`implementing`・`fixing-failures`・`reviewing-diffs`・`running-regression-tests`・`scripting-tests`・`writing-test-specs` に、`## 完了報告` のセクションを 1 つずつ置く。返す項目を固定し、長さの上限は設けない。
- `fixing-failures` の完了報告は `implementing` の完了報告に従う(D45)。`running-regression-tests` の委譲先の項目は `e2e-report-format.md` に従う(E16)。
- P6: `reviewing-diffs` の所見の項目に、該当する差分の抜粋(該当行の前後数行)と根拠を含める。`implementing` と `fixing-failures` の完了報告に、変更したファイルの一覧と、各箇所を判定した検査とその結果を含める。オーケストレーターは報告をすべて読む。全文を読む規律(共通規律の「報告の突き合わせ」)は変えない。

### 5.5 そのほかの削除と書き換え

付録の行のうち、W1〜W5 の対象でない行は、元の判定どおりに適用する。太字の強調を外す指摘(A16・B15・D13 など)と、禁止形に代わりの動きを足す指摘(A17・B38・E19 など)も含む。

### 5.6 intent-format.md は分割しない

`references/intent-format.md` の「持続層」(約 7,260B)と「intent-issue の本文」(約 5,510B)は、別ファイルに分けない。

- 理由は 2 つある。1 つ目に、この文書は書式の契約である。2 つ目に、置き場を変えると `plugins/codiel/docs/format-change-checklist.md` の「intent 文書と intent-issue の書式」の 6 項目と「持続層と ADR 候補の書式」の 2 項目が発火し、gh-utility と metatron の写しまで追随が要る。
- B27〜B33 は適用する。チェックリストは「書き方の規律・理由・例は `references/intent-format.md` にだけ置く」と定めており、理由と例を消しても他の写しは変わらない。実装では、マーカー・見出し名・frontmatter のキー・持続層のセクション書式・候補 ID の採番規則の行を変えていないことを diff で確かめる。

### 5.7 filing-followup-issues の local モード

github モードの手順を本文に残し、local モードの手順(C25)を `references/` へ切り出す。

### 5.8 github-writing.md

- 画像の載せ方(C30)と PR 本文(C31)を `references/` 配下の別ファイルへ切り出す。文言は変えない。
- C32(可視性の注意の 1 文の削除)は採らない。チェックリストの「GitHub の執筆規則」で、可視性の記述は gh-utility の写しとそろえる対象である。150B のために他プラグインまで追随させない。
- C33(`readable-writing.md` L11 の削除)も同じ理由で採らない。

切り出しで本文の文言が変わらないかぎり、gh-utility の写しは変えない。文言が変わるなら、チェックリストに従って gh-utility の `references/github-issue-common.md` を同じコミットで追随させる。

### 5.9 implementing の観点ファイル

D47(`backend.md`・`frontend.md` の「注意する」だけの項目の削除)は採らない。削ると `backend.md` が空になる。観点ファイルは個別に強化する予定があり、中身を判断基準に書き換える作業はこの改修の範囲外である。D48 は採る。

## 6. 構造の施策

### 6.1 review の観点を選ぶ規則(P1)

review に入ったときの手順ファイル(§5.3.1)に、次の規則を書く。

- `git diff --name-only <base>...<branch>` の変更パスと内容から、frontend・backend・data・infra のうち当たる観点を選ぶ。
- doc と security は、変更の内容によらず毎回選ぶ。コードだけが変わり文書が追随しないと、両者が乖離する。doc はこの乖離を見る観点だからである。
- frontend・backend・data・infra のどれにも当たらない変更パスがあるときは、generic を選ぶ。
- 選んだ観点と、その観点を選んだ理由(当たった変更パス)を、`review-<m>.md` に 1 行ずつ書く。
- fix-loop の再レビューも同じ規則で選び直す(K11 により、所見が出た観点だけに絞ることはしない)。

あわせて、`plugins/codiel/docs/DESIGN.md:130-132` と README の review の説明に、infra と generic を加える。

### 6.2 compaction の後の読み直し(P4)

`orchestrating-runs` の本文に次を書く。

- 会話が要約されて、`orchestrating-runs` か今のフェーズの手順ファイルの手順を辿れなくなったときは、`orchestrating-runs` と今のフェーズの手順ファイルだけを Read し直す。
- 今のフェーズは `codiel-state.mjs get --active` で確かめる。
- ほかのスキルは、そのスキルを使う手順に入ったときに読む。

フェーズの境目では §5.3.1 の規則で手順ファイルを読むので、境目の後の compaction は特別な手当てなしに直る。

### 6.3 フェーズの境目でのセッションの切り替え(P7)

`orchestrating-runs` の本文に次を書く。新しい再開手順は作らず、既存の §6 を使う。

- 委譲の待ちが無いフェーズの境目では、ユーザーは新しいセッションへ移ってよい。
- 移った先では `/codiel:run` で再開し、§6 の再開手順に従う。

README の利用者向けの説明に、この使い方を 1 段落で書く。

## 7. 計測と受け入れ基準(P3)

### 7.1 計測の方法

- 計測の道具は `tools/` に Python で置く(CLAUDE.md の規約)。
- 道具は、セッションの transcript(`~/.claude/projects/<project>/<session>.jsonl`)と、委譲先の transcript(同じ場所の `<session>/subagents/` 配下)の各行の `message.usage` を合計する。合計する値は `input_tokens`・`cache_creation_input_tokens`・`cache_read_input_tokens`・`output_tokens` である。
- フェーズ別の内訳は、transcript の各行の時刻と、`codiel-state` が記録するフェーズの開始時刻で割り振る。`codiel-state` がフェーズの開始時刻を記録しているかは【要確認】。記録していなければ、`start-phase` を呼んだ Bash の行の時刻で割り振る。
- 委譲別の内訳は、`subagents/` の transcript ごとに出す。

### 7.2 計測の条件

改修の前と後で、同じ条件で run を 1 回ずつ回す。

- 同じリポジトリの同じコミットから始める。
- 同じ確定済みの intent 文書を入口にする(`/codiel:run <intentパス>`)。
- 同じモデル・同じ運用方針のセッションで回す。

計測に使うリポジトリと intent 文書は未決である(§11)。

### 7.3 受け入れ基準

- 改修後の run の合計トークン(4 種類の合計)が、改修前より少ない。
- オーケストレーターの `cache_read_input_tokens` の合計が、改修前より少ない。
- review フェーズの委譲の数が、§6.1 の規則で選んだ観点の数と一致する。
- 改修前の run が通ったフェーズを、改修後の run もすべて通る。
- `pnpm run lint`・`pnpm run typecheck`・`pnpm run test` が通る。
- K5 によりバージョンは上がっていない。

## 8. 対象外と不採用案

### 8.1 対象外

- K-X1: A23(`gh pr create` が失敗したときの扱い)と A24(worktree を作るコマンドの例)は、手順の欠落を直す指摘であり、コストの改修ではない。別の Issue にする。

### 8.2 不採用案

| 案 | 採らない理由 |
| --- | --- |
| HARD-GATE を縮めて残す | ユーザーの決定 K2 |
| 切り出し先を `plugins/codiel/docs/` にする | ARCHITECTURE で `docs/` は「読まない」場所と定めている。手順の置き場に向かない |
| P2: 再レビューを所見の観点と修正差分に絞る | ユーザーが選ばなかった(K11) |
| 並列 dispatch のプロンプトの先頭を固定してキャッシュに当てる | 委譲先の間で共有できるのは主にシステムプロンプトで、dispatch 本文の並べ替えで増える共有部分は小さい。GPT 経路のキャッシュは別の調査が続いている |
| フェーズごとのモデル・effort の目安をスキルに書く | codiel の指示層に役割名や解決機構を書かない、という既存の方針(同梱 Agent 撤去の設計)に当たる |
| 軽量の run で Raguel のゲートを間引く | ゲートは直前の高速化で 0.4〜4.3 秒になり、トークンへの効果が小さい |
| オーケストレーターに報告の要約だけを読ませる | 共通規律の「全レポートを一度に読む。要約の要約で判断しない」と衝突する。P6 で代える |
| 完了報告に長さの上限を設ける | 同じ規律と衝突する。P5 で項目の固定に代える |
| compaction に反応する hook(SessionStart の compact・PreCompact)を足す | `hooks/hooks.json` の変更は全セッションの挙動を変える。§6.2 の指示で足りるかを §7 の計測で確かめ、足りなければ改めて検討する |
| `intent-format.md` を分割する | §5.6 |
| 観点ファイルの「注意する」だけの項目を削る(D47) | §5.9 |

## 9. 効果の見積もり

数値は評価の担当の概算を足したもので、【推定】である。

- どの run でも減る量: 削除と書き換えで約 71KB。うち `orchestrating-runs` で約 14KB、`raguel-gating` で約 8.5KB が、run の開始からオーケストレーターに載る量から減る。
- review 1 回あたりで減る量: `reviewing-diffs` の削減(E1〜E8、約 5KB)が担当の人数分効く。P1 で観点が 7 から 4(doc・security と、当たる観点 2 つ)になる前提では、1 回のレビューで約 92KB から約 30KB になる。
- 一部のフェーズに入らない run でだけ減る量: §5.3 の切り出しで約 50〜60KB。そのフェーズに入る run では、入った時点で載るので減らない。減るのは、入らなかったフェーズの分と、入るまでの毎ターンのキャッシュ読み出しである。
- compaction の後に読み直す量: P4 により、95KB の `orchestrating-runs` 全体ではなく、残した本文と今のフェーズの手順ファイルだけになる。

§7 の計測で、この見積もりを確かめる。

## 10. 記録と付随する作業

- ARCHITECTURE は変えない。`skills/<skill>/references/` は既存の配置で、ARCHITECTURE の「ディレクトリ構成と責務」の範囲に入る。
- ADR は追加しない。委譲先の指定(ADR-004)と run の構造(ADR-006)を変えない。
- `plugins/codiel/docs/DESIGN.md` に、§6.1 の観点の規則、§4 W3 で退避する根拠と経緯、K2 で HARD-GATE と Red Flags を廃止した理由を足す。
- `plugins/codiel/README.md` に §6.1 の観点と §6.3 のセッションの切り替えを反映する。ルートの `README.md` に codiel の run の説明があれば、同じ内容をそろえる。
- `.serena/memories/` に codiel のスキルの構成を書いたメモリがあれば、切り出し後の構成に合わせる。
- AI 向けの指示書を書く作業なので、実装でも `prompt-smith:prompt-smith` の規律に従う。
- 指示書の改修なので、ビルドの出力(`scripts/`)は変わらない。§7 の計測の道具は `tools/` に置く。

## 11. 未決事項

- 計測に使うリポジトリと intent 文書(§7.2)。`.codiel/` を書き換えてよく、run の全フェーズ(E2E を含む)に到達する小さな題材が要る。
- `codiel-state` がフェーズの開始時刻を記録しているか(§7.1)。実装計画の最初の Task で確かめる。
