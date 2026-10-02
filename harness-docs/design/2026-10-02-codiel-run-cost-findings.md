# codiel:run のコスト改修 指摘一覧(設計書の付録)

設計書 `2026-10-02-codiel-run-cost-design.md` の付録である。2026-10-02 に prompt-smith の評価で出た指摘 181 件を、1 行 1 件で載せる。

- ベースパスは `plugins/codiel/` である。
- 行番号は 2026-10-02 時点(HEAD `6b5d001`)のものである。実装の前に該当箇所を読み直して位置を確かめる。
- 「元の判定」は評価の担当が出した判定である。設計書 §1 の決定より前に出ているので、適用するときは設計書 §4 の読み替え規則を当てる。
- 「採否」が空欄の行は採用する。採用しない行と読み替える行だけに印を付ける。
- 「見込み」は削減の概算バイトで、負の値は増加である。

## A: commands/run.md と skills/orchestrating-runs/SKILL.md

| ID | ファイル | 該当箇所 | 内容 | 元の判定 | 見込み | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | commands/run.md | L9-10 | 引数の判定の説明が description・argument-hint・orchestrating-runs §1 と重複 | 削除 | 200 | |
| A2 | commands/run.md | L11 | 禁止だけの文。「orchestrating-runs を起動して読み、その内容に従って進める」へ | 書き換え | 0 | |
| A3 | orchestrating-runs | 概要 L8-26 | L16-17 が HARD-GATE と同文、L20-26 がチェックリストの言い換え。L8-15 の 2 文だけ残す | 削除 | 900 | |
| A4 | orchestrating-runs | §0 手順 1-2(L61-97) | 「1 回だけ」が 4 か所。冒頭に「4 つのコマンドは run ごとに 1 回だけ実行し値を使い回す」を 1 文置く | 削除 | 600 | |
| A5 | orchestrating-runs | §0 手順 7-10(L137-145) | 手順 8・9 が分岐表、手順 10 が §3・§6 と重複。「GOTCHAS が無ければスキップ」だけ残す | 削除 | 900 | |
| A6 | orchestrating-runs | §1 L148-158 | `/codiel:run` の 3 形と `get --active` が run.md・チェックリストと重複 | 削除 | 250 | |
| A7 | orchestrating-runs | 進行表の「コミット担当」列(L194-209) | §2.1 と同一内容。「コミットは §2.1 に従う」の 1 行にし、例外は §2.1 へ寄せる | 削除 | 2000 | |
| A8 | orchestrating-runs | §2.1 L265-273・L286-289 | コード系の委譲先コミットの説明が §2.5・§2.7-2.9・§3 L647 と同文 | 削除 | 1300 | |
| A9 | orchestrating-runs | L286-289・L464・L583-588・L647-648・L791-793 | 返答を `waits/<id>.md` と報告の置き場へ書いてから `wait-done` する手順が 5 か所。§3 L647 を正本にする | 削除 | 1000 | |
| A10 | orchestrating-runs | L442・L771 | `set-domain` を伴う待ちの間は他の委譲を出さない、が 2 か所。§4 に 1 つ残す | 削除 | 300 | |
| A11 | orchestrating-runs | §3 L641-642 | `wait-add` の id 規則が raguel-gating L91 と同一 | 削除 | 400 | 読み替え(§4 W5) |
| A12 | orchestrating-runs | §4 L739-749 と §4.1 L751-772 | `clear-domain`・`set-domain` の規則と「2.6 に従う」が二重。1 つのセクションに統合 | 削除 | 1200 | |
| A13 | orchestrating-runs | §5 fix-loop のスキップ経路(L795-812) | L211-212・L243-245 と同内容。コマンド 1 つと「critical/high が 1 件でもあれば使わない」だけ残す | 削除 | 900 | |
| A14 | orchestrating-runs | §7 L878-892・L905-910 | 未記録の GOTCHAS の退避手順が raguel-gating L191 と重複 | 削除 | 1500 | |
| A15 | orchestrating-runs | Red Flags(L928-936) | HARD-GATE の理由の言い換え | 削除 | 1200 | 読み替え(§4 W1) |
| A16 | orchestrating-runs | 太字 約 20 か所 | 太字の強調を外す | 書き換え | 100 | |
| A17 | orchestrating-runs | L788・L864・L925 | 禁止だけの文に代わりの動きを足す(例: 裁定が出るまで待ち、裁定を受けてから続行する) | 書き換え | 0 | |
| A18 | orchestrating-runs | L204-209 の空セル・敬体の混在 | 表記をそろえる | 書き換え | 50 | |
| A19 | orchestrating-runs | §2.6 L456-475 | 報告の置き場の名前が 6 通り出る。置き場の表を 1 つにし、各所は表を指す | 書き換え | 600 | |
| A20 | orchestrating-runs | §2.4 L382・L387-388 | 判断基準のない修飾 | 削除 | 120 | |
| A21 | orchestrating-runs | §2.5 L412-419 | worktree の名前規則と `exclude` が §2.7-2.9 で再掲 | 削除 | 300 | |
| A22 | orchestrating-runs | §6 L835-844 | 連携モード・実行モードの再判定が §0 の繰り返し。「§0 の判定をやり直し、記録と違えば人に確認する」の 3 行へ | 書き換え | 800 | |
| A23 | orchestrating-runs | §2.2 | `gh pr create` が失敗したときの扱いが無い | 書き換え(追加) | -200 | 対象外(§8 K-X1) |
| A24 | orchestrating-runs | §2.5 | worktree を作る具体コマンドが無い | 書き換え(追加) | -100 | 対象外(§8 K-X1) |

場面限定で切り出せるセクション(A 担当の所見 (a)): §2.7-2.9(L477-569、約 9200)、§6(L814-865、6059)、§2.6(L428-476、5681)、§2.10(L570-610、4802)、§2 の軽量経路と test-spec・dev-plan の並列手順(L211-240、約 4300)、§2.3(L343-379、3592)、§7(L866-911、3224)、§2.2(L302-342、3118)、§5(L776-813、2763)、§2.11(L611-633、2037)、§2.5(L406-427、1985)。

## B: intent 系(capturing-intent・syncing-intents・intent-format・intent-common・intent-writing)

| ID | ファイル | 該当箇所 | 内容 | 元の判定 | 見込み | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | capturing-intent | 3-2 原文の記録(L94-100) | intent-format L95-103 と同内容。参照 1 文にし、「run 途中のユーザーの言葉は即時に追記する」だけ残す | 退避 | 650 | 読み替え(§4 W3: 削除して参照) |
| B2 | capturing-intent | L69 の Issue 番号の分岐 | マーカー 4 種の扱いが intent-format L267-280 と同内容。参照と「人のコメントは話者と日付つきで原文に記録」へ | 書き換え | 800 | |
| B3 | capturing-intent | L71 v1 の昇格 | intent-format L178-211・L275 と同じ写像。参照と聞き取る範囲・承認・上書き・変更履歴の 1 行へ | 書き換え | 250 | |
| B4 | capturing-intent | L144 slug の規則 | intent-format L7-9 と同内容。参照へ | 書き換え | 250 | |
| B5 | capturing-intent | L145 日付・L140 言語確認の理由 | 日付は intent-format L6、言語は intent-common L16 と重複。理由は根拠 | 退避 | 280 | 読み替え(§4 W3: 理由は docs/) |
| B6 | capturing-intent | L91 | intent-format L102 と同文 | 削除 | 200 | |
| B7 | capturing-intent | L136 派生文の書き方 | intent-format L157-159 と同じ。受け入れ基準の 1 文だけ残す | 書き換え | 120 | |
| B8 | capturing-intent | L26・L10 | 文書自身の構成の説明 | 削除 | 170 | |
| B9 | capturing-intent | L106-107・L109・L110 | 根拠の説明。L110 の「縮退していて全文が要るなら Read する」は残す | 削除 | 130 | |
| B10 | capturing-intent | L161 と L204(HARD-GATE 最終項) | (4)〜(6) の間に確認を挟まない、が 2 回 | 削除 | 300 | 読み替え(§4 W1) |
| B11 | capturing-intent | L203 | L142・intent-format L10 と同内容 | 削除 | 90 | |
| B12 | capturing-intent | 手順 6 try-2 以降の持ち込み(L194-196)と一覧 L33-39 の項目 6 | 手順 1 の 4(L56-61)と重複 | 削除 | 450 | |
| B13 | capturing-intent | L179 | 失敗時の経路と理由を 1 文に連ねている。理由は intent-format L40-44 にある。4 文に分ける | 書き換え | 250 | |
| B14 | capturing-intent | L63・L108-116 の一部 | 言い換え | 削除 | 150 | |
| B15 | capturing-intent | L14-15・L54・L106・L109-111・L161 の太字 | 太字を外し条件と範囲の文へ | 書き換え | 40 | |
| B16 | capturing-intent | L58・L59 の「版」、L89・L147 の禁止形 | 「版」を「バージョン」へ、禁止形を「〜する」へ | 書き換え | 0 | |
| B17 | capturing-intent | 手順 3-4 | 選択肢を選ばず保留されたときの境界が無い。「1 回尋ねて決まらなければ `## 未確定事項` へ残す」を足す | 書き換え(追加) | -60 | |
| B18 | syncing-intents | 概要 L10・L12 | 書き戻しの対象と持続層の見出し 5 つの再説。1 段落へ | 書き換え | 500 | |
| B19 | syncing-intents | 担い手の分担(L14-27) | HARD-GATE L88・L66・L90・L79 と重複。6 行へ | 書き換え | 600 | |
| B20 | syncing-intents | L81-83 候補 ID の採番 | intent-format L331-332 と同じ。`candidateId` をそのまま使う、だけ残す | 削除 | 650 | |
| B21 | syncing-intents | L43-52 変更履歴の記録例 | 性質が同じ例が 2 つ。1 行残す | 書き換え | 200 | |
| B22 | syncing-intents | Red Flags(L94-102) | 4 行が HARD-GATE の言い直し、残る 1 行は L38 と同義 | 退避 | 1500 | 読み替え(§4 W1・R3) |
| B23 | syncing-intents | L72 の手順 8 の 2 文・L89 | 重複。HARD-GATE 側だけ残す | 削除 | 250 | 読み替え(§4 W1: 本文側に残す) |
| B24 | syncing-intents | L61 | L72 の言い換え | 削除 | 100 | |
| B25 | syncing-intents | L10・L35-41 | 一文に前提・主体・条件が詰まっている。3 文に割る | 書き換え | 0 | |
| B26 | syncing-intents | L98 ほか | 同じ文型の繰り返し(B22 で消える) | 削除 | 0 | |
| B27 | intent-format | L243-244 | マーカー検知の理由。規則は残し理由を docs/ へ | 退避 | 500 | |
| B28 | intent-format | L312・L346・L387-389 | 根拠・文書自身の説明 | 退避 | 600 | |
| B29 | intent-format | L338-385 | 縮約と参照形の例が 3 度 | 退避または削除 | 600 | |
| B30 | intent-format | L261-265 投稿する側の規則 | L262・L263・L265 は理由と hook 側の仕様 | 削除 | 400 | |
| B31 | intent-format | L122-211 の例 4 つ | 形を示す例が 4 つ。表の例と原文の例を各 1 つ残す | 退避 | 1500 | |
| B32 | intent-format | L28・L30・L42 | 言い換え | 削除 | 250 | |
| B33 | intent-format | L112・L150 | 文書自身の説明 | 削除 | 200 | |
| B34 | intent-common | L3 | 「`capturing-intent` / `orchestrating-runs` が従う共通規律である」へ | 書き換え | 30 | |
| B35 | intent-common | 大原則 L13-18 | capturing-intent L29・L140・L165 と orchestrating-runs と重複。言語の規則は capturing-intent L29 を正本に | 削除 | 300 | |
| B36 | intent-common | L33-38 報告の例文 | 規則の言い換え | 削除 | 170 | |
| B37 | intent-common | L43 | capturing-intent L165 と同じ | 削除 | 90 | |
| B38 | intent-common | 失敗時 L45-49 | 禁止に代わりの動きが無い。「失敗したら生のエラーを報告して停止し、リトライや代替手段への切り替えをせずに指示を待つ。どこまで処理済みかを添える」へ | 書き換え | 80 | |
| B39 | intent-common | L15「厳守する」・L9 | 「厳守する」を「従う」へ | 書き換え | 0 | |
| B40 | intent-writing | L9-21 表の「削る」4 行 | readable-writing への参照にし、削る 4 行を落とす | 書き換え | 350 | |
| B41 | intent-writing | L29-33 | intent-format L103・L284 と同文。triage の草案の `<!-- codiel:unrecorded -->` の 1 文だけ残す | 削除 | 300 | |

場面限定で切り出せるセクション(B 担当の所見 (a)): capturing-intent の手順 0(L43-49、約 2050)・手順 1 の 4(L56-61、約 2250)・手順 2 の入口の分岐(L69-71、約 2660)・3-3-1 の領域名(L118-130、約 1590)・手順 5 の (3)(L167-173、約 1630)と (6)(L179-192、約 2860)、syncing-intents の持続層への取り込み(L54-83、約 4690)。intent-format の「持続層」(L282-403、約 7260)と「intent-issue の本文」(L213-280、約 5510)は設計書 §5.6 で分割しないと決めた。

## C: gate とレビュー対応の系統(raguel-gating・fixing-review-findings・filing-followup-issues・facilitating-design-discussions・github-writing・readable-writing・handoff-contract)

| ID | ファイル | 該当箇所 | 内容 | 元の判定 | 見込み | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | raguel-gating | L14-22 プラグインルート参照規約 | 同じセクションが 7 スキルにある | 削除 | 350 | 読み替え(§4 W4) |
| C2 | raguel-gating | L220-251 outcome の自動同期 | 起動時に 1 回だけ使う | 退避 | 2400 | 読み替え(§4 W3: references/ へ切り出し) |
| C3 | raguel-gating | L24-31 コマンド起動時 | L220 以降と同内容 | 削除 | 250 | |
| C4 | raguel-gating | Red Flags L271-277 | ASK の自己承認禁止が L130・L262-268 と重複 | 削除 | 1000 | 読み替え(§4 W1) |
| C5 | raguel-gating | HARD-GATE L259-269 の 2・3 項目 | `--human-approved` と verdict の扱いが本文と重複 | 書き換え | 700 | 読み替え(§4 W1) |
| C6 | raguel-gating | L162-172 degraded の ASK 手順 3・5 | 通常の ASK の言い換え。選択肢だけ書く | 書き換え | 400 | |
| C7 | raguel-gating | L127-129・L168-169・L185-186 | 質問文の規則が 3 回。ASK 手順 3 に 1 回 | 書き換え | 400 | |
| C8 | raguel-gating | L91-93 wait-add の id 規則 | 待ちに移るときだけ使う | 退避 | 400 | 読み替え(§4 W5) |
| C9 | raguel-gating | L106-118 並列フェーズの ASK・STOP | test-spec と dev-plan だけに当たる | 退避 | 900 | 読み替え(§4 W3: references/ へ切り出し) |
| C10 | raguel-gating | L216-218 | 直前の段落の言い換え。1 文へ | 書き換え | 350 | |
| C11 | raguel-gating | L79-85 未コミット変更の分岐 | まれな分岐 | 退避 | 900 | 読み替え(§4 W3: references/ へ切り出し) |
| C12 | raguel-gating | L253-257 `state.version` 1 | まれな分岐。C2 と同じ切り出し先へ | 退避 | 500 | 読み替え(§4 W3: references/ へ切り出し) |
| C13 | fixing-review-findings | 概要 L8-19 | skip の説明が orchestrating-runs §5 と重複・太字 6 か所 | 書き換え | 250 | |
| C14 | fixing-review-findings | L27-35 プラグインルート参照規約 | C1 と同じ | 削除 | 420 | 読み替え(§4 W4) |
| C15 | fixing-review-findings | 手順 4・10・L101-125 | Write → 別 Bash で `gh api -F body=@` の手順が 4 回。github-writing L25 が正本。共通手順を 1 か所に | 書き換え | 1000 | |
| C16 | fixing-review-findings | HARD-GATE L127-139 | 手順 2・4 と概要の言い直し | 書き換え | 800 | 読み替え(§4 W1) |
| C17 | fixing-review-findings | Red Flags L141-147 | 手順 2・5・HARD-GATE と重複 | 削除 | 700 | 読み替え(§4 W1) |
| C18 | fixing-review-findings | 手順 8 の括弧書き | 根拠。「github では `git push` で PR ブランチを最新化する。local では push しない」へ | 書き換え | 300 | |
| C19 | filing-followup-issues | 概要 L8-23 | 並置の説明とモード別の説明の二重・太字 | 書き換え | 300 | |
| C20 | filing-followup-issues | L25-33 プラグインルート参照規約 | C1 と同じ | 削除 | 420 | 読み替え(§4 W4) |
| C21 | filing-followup-issues | 手順 3・6・local の手順 3 | `mark-ask` と `resume` の説明が 3 回。1 か所に | 書き換え | 450 | |
| C22 | filing-followup-issues | L105-125 ISSUE_TEMPLATE の読み方と手順 5 | テンプレートがある github モードだけで使う | 退避 | 1450 | 読み替え(§4 W3: references/ へ切り出し) |
| C23 | filing-followup-issues | HARD-GATE L154-164 | 手順 3・概要と重複、3 項目目は出典 | 書き換え | 600 | 読み替え(§4 W1) |
| C24 | filing-followup-issues | Red Flags L166-173 | 手順 3・5・6・8 と重複 | 削除 | 1000 | 読み替え(§4 W1) |
| C25 | filing-followup-issues | L81-103 local モードのチェックリスト | run ごとにモードは片方だけ | 退避 | 1500 | 読み替え(§4 W3: local を references/ へ。§5.7) |
| C26 | facilitating-design-discussions | L82-98 待機と Stop フック | orchestrating-runs L382-390 の一般則と同じ。1 文へ | 書き換え | 500 | |
| C27 | facilitating-design-discussions | HARD-GATE L100-107・Red Flags L109-115 | 手順 2・3・5 と重複 | 書き換え | 1000 | 読み替え(§4 W1) |
| C28 | facilitating-design-discussions | L56-73 設計ウォークスルー | design フェーズでしか使わない | 退避 | 1500 | 読み替え(§4 W3: references/ へ切り出し) |
| C29 | facilitating-design-discussions | 手順 8 のコードブロック | 「agenda.md と discussion.md をコミットし `complete-phase discuss` を呼ぶ」へ | 書き換え | 200 | |
| C30 | github-writing | L27-51 画像の載せ方とブラウザでのアップロード | 画像を載せるときだけ使う | 退避 | 3500 | 読み替え(§4 W3: references/ へ切り出し。§5.8) |
| C31 | github-writing | L53-66 PR 本文 | pr フェーズでしか使わない | 退避 | 1300 | 読み替え(§4 W3: references/ へ切り出し。§5.8) |
| C32 | github-writing | L43 | L41-42 の可視性の注意と重複 | 削除 | 150 | 不採用(§5.8) |
| C33 | readable-writing | L11 | 別規則との関係の言い換え | 削除 | 150 | 不採用(§5.8) |
| C34 | handoff-contract | 契約の 3 項目目の後半 | 理由の説明 | 削除 | 100 | |

## D: 設計・実装系(preparing-design-agendas・writing-design-docs・writing-dev-plans・writing-test-specs・implementing・fixing-failures)

| ID | ファイル | 該当箇所 | 内容 | 元の判定 | 見込み | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | preparing-design-agendas | チェックリスト 2(L23-28) | ARCHITECTURE・GOTCHAS の扱いが orchestrating-runs §3 L685-687 と二重 | 書き換え | 450 | 読み替え(§4 W2: スキル側を残し §3 側を削る) |
| D2 | preparing-design-agendas | 概要の最終段落 | 文書自身の意図の説明 | 削除 | 200 | |
| D3 | preparing-design-agendas | 合意済み事項の継承の理由文 | 根拠 | 退避 | 280 | |
| D4 | preparing-design-agendas | HARD-GATE の 2・3 項目 | チェックリスト 4 と例外の重複 | 削除 | 250 | 読み替え(§4 W1) |
| D5 | preparing-design-agendas | Red Flags 行 1 後半・行 3 | チェックリスト 5 と論点の粒度の重複 | 削除 | 500 | 読み替え(§4 W1) |
| D6 | preparing-design-agendas | L34 の太字と「必ず」 | 「intent の `## 未確定事項` は 1 件も落とさず論点にする」へ | 書き換え | 20 | |
| D7 | writing-design-docs | チェックリスト 3(L30-35) | D1 と同じ二重 | 書き換え | 450 | 読み替え(§4 W2) |
| D8 | writing-design-docs | 概要の第 2 段落と最終段落 | 文書自身の意図・チェックリスト 7 と重複 | 削除 | 450 | |
| D9 | writing-design-docs | チェックリスト 6 末尾と Red Flags 行 2 | 同じ指示の言い換え | 削除 | 300 | |
| D10 | writing-design-docs | 候補の行の書式(L97-105)とチェックリスト 7 の下位 3 項目(L49-53) | 3 重記述。書式のコードブロックは残す | 削除 | 400 | |
| D11 | writing-design-docs | Red Flags 行 4・行 5 | チェックリスト 2・HARD-GATE と重複 | 削除 | 650 | 読み替え(§4 W1) |
| D12 | writing-design-docs | HARD-GATE の再協議事項(L118-123) | チェックリスト 2 と二重 | 書き換え | 200 | 読み替え(§4 W1) |
| D13 | writing-design-docs | 太字 5 か所 | 太字を外す | 書き換え | 20 | |
| D14 | writing-dev-plans | 概要の第 2〜4 段落(L14-29) | 軽量記述の重複と hooks・ドメイン規律の経緯 | 退避と削除 | 1000 | |
| D15 | writing-dev-plans | チェックリスト 1・2・3 | 軽量記述と `unscoped` 記述の言い換え | 書き換え | 300 | |
| D16 | writing-dev-plans | 5.8 どのドメインにも属さないパス(L143-149) | 見出しの番号を外し、末尾の 1 文を削る | 書き換え | 130 | |
| D17 | writing-dev-plans | Red Flags 行 1・行 4 | HARD-GATE とチェックリスト 9・10 と重複 | 削除 | 650 | 読み替え(§4 W1) |
| D18 | writing-dev-plans | HARD-GATE の 2 文目 | チェックリスト 10 と同文 | 削除 | 150 | 読み替え(§4 W1) |
| D19 | writing-dev-plans | チェックリスト 5 末尾・7 | 言い換え | 書き換え | 200 | |
| D20 | writing-dev-plans | 生成物の方式とチェックリスト 11 | `## 環境準備` の「なし」の扱いが衝突。「書けなければ『なし』にし、実装側は lockfile から既定を選ぶ」へ | 書き換え | 0 | |
| D21 | writing-dev-plans | 太字と「green」 | 太字を外し「green」を「パス」へ | 書き換え | 10 | |
| D22 | writing-dev-plans | 「必ず」「同定し直さない」 | 命令形・予防線 | 書き換え | 20 | |
| D23 | writing-test-specs | 概要の最終段落と軽量記述(L15-24) | 文書の位置づけの説明と重複 | 削除 | 450 | |
| D24 | writing-test-specs | 軽量の run での同定(L76-87) | オーケストレーターだけが読む | 退避 | 850 | 読み替え(§4 W3: orchestrating-runs の references/ へ移す) |
| D25 | writing-test-specs | ツール運用(L111-114) | dispatch で許可済み・グローバル規約と重複 | 削除 | 330 | |
| D26 | writing-test-specs | チェックリスト 7・コミット責務・HARD-GATE | 「テストコードに触れない」が 3 か所 | 削除 | 500 | 読み替え(§4 W1: 本文に 1 つ残す) |
| D27 | writing-test-specs | コミット責務の導入と hooks の 2 項目 | orchestrating-runs §3 L708 と二重・hooks の挙動は根拠 | 削除 | 500 | 読み替え(§4 W2・R3) |
| D28 | writing-test-specs | Red Flags 行 1・行 4 | HARD-GATE とチェックリスト 8 と重複 | 削除 | 500 | 読み替え(§4 W1) |
| D29 | writing-test-specs | 画面名の決め方の 1 文 | orchestrating-runs とチェックリスト 9 の言い換え | 削除 | 200 | |
| D30 | writing-test-specs | 太字 5 か所 | 太字を外す | 書き換え | 20 | |
| D31 | implementing | チェックリスト 2・3(L73・L75-77) | D1 と同じ二重 | 書き換え | 500 | 読み替え(§4 W2) |
| D32 | implementing | ドメイン規律(L127-137) | チェックリスト 1・2・HARD-GATE・orchestrating-runs §4 と重複。共有コードのタグ判断の 1 文だけ残す | 書き換え | 650 | |
| D33 | implementing | 完了報告の返し方(L46-49) | チェックリスト 7・orchestrating-runs §3 L697 と二重。2 文へ | 書き換え | 250 | 読み替え(§4 W2・§5.4 P5) |
| D34 | implementing | チェックリスト 6 の E2E レポートの 2 文(L91-92) | fixing-failures と同文。fixing-failures 側に残す | 削除 | 250 | |
| D35 | implementing | HARD-GATE の 2 項目 | 出典と fixing-failures 手順 5 との二重 | 退避と削除 | 350 | 読み替え(§4 W1・R3) |
| D36 | implementing | コミット責務の冒頭 | チェックリスト 5-5 と重複・経緯 | 書き換え | 250 | |
| D37 | implementing | Red Flags 行 1-3 | HARD-GATE とドメイン規律と重複 | 削除 | 900 | 読み替え(§4 W1) |
| D38 | implementing | worktree 内での作業(L38-41) | `## 環境準備` が「なし」のときの既定が orchestrating-runs L421・writing-dev-plans と重複。1 文へ | 書き換え | 200 | |
| D39 | implementing | フレームワーク解決の 3 段階(L22-27) | 実装担当はテストを書かない。「テストの実行方法は dev-plan の検証コマンドに従う」へ | 書き換え | 350 | |
| D40 | implementing | 太字 6 か所 | 太字を外す | 書き換え | 30 | |
| D41 | fixing-failures | 概要 | 文書自身の意図・チェックリスト 1 と重複 | 削除 | 200 | |
| D42 | fixing-failures | チェックリスト 5 と最小修正の判断基準の 2 つ目 | implementing の HARD-GATE と同じ指示 | 削除 | 400 | |
| D43 | fixing-failures | 手順 8 の長い 1 文 | 「`running-regression-tests` の回帰の範囲全体を自分で実行する。対象ケースだけの再実行で完了としない」へ | 書き換え | 250 | |
| D44 | fixing-failures | Red Flags 行 1・行 2 | HARD-GATE と重複 | 削除 | 600 | 読み替え(§4 W1) |
| D45 | fixing-failures | 手順 9 の完了報告項目 | implementing のチェックリスト 7 と二重 | 書き換え | 250 | 読み替え(§5.4 P5) |
| D46 | fixing-failures | チェックリスト 2 | D34 の受け皿。追記不要 | ― | 0 | |
| D47 | implementing/references | backend.md 3 項目・frontend.md 4 項目 | 「注意する」だけの項目 | 削除 | 260 | 不採用(§5.9) |
| D48 | implementing/references | frontend.md 最後の 2 項目 | implementing と同じ趣旨。1 文に統合 | 削除 | 50 | |

## E: レビュー・テスト系(reviewing-diffs と観点ファイル・running-regression-tests・scripting-tests・e2e-report-format)

| ID | ファイル | 該当箇所 | 内容 | 元の判定 | 見込み | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | reviewing-diffs | 所見の統合と投稿(L92-125、2841) | レビュー担当は使わず、オーケストレーターだけが使う。担当側には「統合と投稿はオーケストレーターが行う。担当は所見を返すだけで `gh pr review` を実行しない」だけ残す | 退避 | 2700/担当 | 読み替え(§4 W3: orchestrating-runs の references/ へ移す) |
| E2 | reviewing-diffs | 概要の入力の列挙(L10-16) | チェックリスト手順 1 と重複 | 削除 | 600 | |
| E3 | reviewing-diffs | 概要 L29-33 | 手順 5 と重複・github-writing の参照は E1 のセクションでしか使わない | 削除 | 300 | |
| E4 | reviewing-diffs | 観点別の焦点(L126-129)と概要 L35 | 「観点ファイルは依頼文で渡される」が 2 回 | 削除 | 180 | |
| E5 | reviewing-diffs | severity 定義 L86-90 の散文 | 表の言い換え。「security 観点は原則 medium 以上を検討する。持続層の意図的な制約に反する変更は high とする」へ | 書き換え | 350 | |
| E6 | reviewing-diffs | Red Flags 行 2・3 と HARD-GATE 2 番目 | 手順 2・4・6・8 と重複 | 削除 | 850 | 読み替え(§4 W1) |
| E7 | reviewing-diffs | L124 | HARD-GATE と重複(E1 で消える) | 削除 | 120 | |
| E8 | reviewing-diffs | 太字と禁止形 | 太字を外し「〜を返す」の形へ | 書き換え | 0 | |
| E9 | reviewing-diffs/references | 7 ファイルの両方向チェックの箇条 | SKILL.md L24-27 と重複。観点固有の未達・逸脱の例だけ残す | 書き換え | 700 | |
| E10 | reviewing-diffs/references | security.md・infra.md 末尾 | severity 定義と重複 | 削除 | 120 | |
| E11 | reviewing-diffs/references | doc.md の 2 箇条 | 指摘なし | 保持 | 0 | |
| E12 | running-regression-tests | プラグインルート参照規約 L14-22 | 本文で codiel-state を呼ぶ手順が無い | 削除 | 420 | 読み替え(§4 W4) |
| E13 | running-regression-tests | 2 つの起動モード L24-40 | 報告の置き場・日時規則・E2E の 1 回起動が orchestrating-runs 2.6・§3・e2e-report-format と重複。単独実行モードの差分 5 点だけ残す | 書き換え | 900 | |
| E14 | running-regression-tests | 同時実行 L46-49 | orchestrating-runs 2.6・2.9 と重複。1 文へ | 書き換え | 500 | |
| E15 | running-regression-tests | テストの実行環境と環境の失敗 L50-56 | orchestrating-runs 2.6 と重複 | 書き換え | 800 | |
| E16 | running-regression-tests | 完了報告 L124-137 | e2e-report-format L92-103 と同じ項目 | 書き換え | 450 | 読み替え(§5.4 P5) |
| E17 | running-regression-tests | チェックリスト手順 1-5・9・10 | 前のセクションの言い換え。手順 7→8→9 の判定だけ残す | 書き換え | 600 | |
| E18 | running-regression-tests | HARD-GATE L142-145・Red Flags L151-154 | 判定基準・環境の失敗・単独実行モードのセクションと同じ | 削除 | 700 | 読み替え(§4 W1) |
| E19 | running-regression-tests | 太字と禁止形 | 太字を外し禁止形に代わりの動きを併記 | 書き換え | 0 | |
| E20 | scripting-tests | 概要 L12 | 根拠・出典。「このスキルが書くのはテストコードだけで、`spec.md` と `cases.md` は書き換えない」へ | 退避 | 350 | |
| E21 | scripting-tests | worktree での作業 L16-18 | orchestrating-runs 2.7・2.1・2.6 と重複 | 書き換え | 600 | |
| E22 | scripting-tests | E2E の実行とスクリーンショット L53-58 | e2e-report-format と重複(同文が計 5 か所) | 書き換え | 450 | |
| E23 | scripting-tests | 環境の失敗 L47-51 の例 | running-regression-tests・orchestrating-runs 2.6 と同じ列挙 | 書き換え | 250 | |
| E24 | scripting-tests | ツール運用 L60-65 | Context7 は既存規約と重複、Playwright の 2 行は 1 文へ | 書き換え | 300 | |
| E25 | scripting-tests | HARD-GATE L89-93・Red Flags L97-101 | 規約 L35・Red の確認のセクションと重複 | 書き換え | 1000 | 読み替え(§4 W1) |
| E26 | scripting-tests | チェックリスト L67-76・コミット責務 L78-85 | 言い換え。コミットの 1 コマンドと「区切りごとに 1 コミット」だけ残す | 書き換え | 500 | |
| E27 | scripting-tests | L87 guard-write hook の説明 | 根拠 | 削除 | 280 | 読み替え(§4 W3: 要るなら docs/) |
| E28 | scripting-tests | 太字と禁止形 | 太字を外す | 書き換え | 0 | |
| E29 | e2e-report-format | 置き場と名前 L11・L13 | orchestrating-runs 2.10・running-regression-tests L31 と同文。この文書を正本にし相手側を参照へ | 保持 | 0 | |
| E30 | e2e-report-format | failure.md の直し方 L80-90 | orchestrating-runs 2.10 と同文。この文書を正本にし 2.10 を参照へ(2.10 側で約 600 減) | 保持 | 0 | |
| E31 | e2e-report-format | 冒頭 L3 と使い分けの説明 | 置き場のセクションと重複 | 書き換え | 250 | |
| E32 | e2e-report-format | 委譲先が返答に入れる項目 L92-103 | 正本にする | 保持 | 0 | |
| E33 | e2e-report-format | ― | 指摘なし | 保持 | 0 | |
| E34 | e2e-report-format | ファイルの表の JSON を出せない行 | 引くための記述 | 保持 | 0 | |

レビューの読み込み量(E 担当の所見 (c)): 観点ごとに担当 1 人で、担当はそれぞれ SKILL.md 全文と観点ファイル 1 本を読む。7 観点なら 1 回のレビューで SKILL.md 12131B × 7 と観点ファイル 7289B を読む。再レビューのたびに同じ量が載る。
