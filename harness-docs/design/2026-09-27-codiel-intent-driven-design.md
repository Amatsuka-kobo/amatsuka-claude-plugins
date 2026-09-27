# codiel を intent 駆動へ改造し、sandalphon を吸収する 設計書

- 作成日: 2026-09-27
- 状態: 設計(第 9 版)・承認済み(2026-09-27)・実装時の追補(2026-09-27〜28。決定 54〜71)
- 対象プラグイン: `plugins/codiel`(主)、`plugins/sandalphon`(撤去)、`plugins/metatron`(参照文書・テストの追随、`[ADR 候補]` の走査と縮約の実装、執筆規律の追随)、`plugins/gh-utility`(GitHub の執筆規則と画像の載せ方)
- 現行バージョン: codiel `0.9.0-dev` → `1.0.0`、metatron `0.3.10-dev` → `0.4.0-dev`(マイナー)、sandalphon `0.2.1-dev` → 撤去、gh-utility `0.5.2-dev` → `0.5.3-dev`(§9)
- 入力: オーケストレーター確定事項(2026-09-27。ユーザー合意済み)、暗黙知レビューと反証レビューの採否(2026-09-27。オーケストレーター決定)、ユーザーレビューの修正指示 3 点と、独立性の要件・metatron が無いときの ADR の決定・ADR 候補の移送を metatron 側で行う決定・執筆規則の決定(2026-09-27)
- 先行設計: `harness-docs/design/2026-08-16-sandalphon-design.md`、`2026-08-16-file-contract-freeze.md`、`2026-09-15-codiel-domain-map-decoupling-design.md`、`2026-09-22-codiel-agents-to-skills-design.md`
- 実装計画書(WBS): 本設計の承認後に別途作る。マイルストーン分割は §10 に従う

---

## 1. 確定済みの決定(この設計の前提)

次の決定はユーザーまたはオーケストレーターが確定させた。本設計はこれを覆さず、別案も提示しない。表の「具体化」列が本設計の該当セクションを指す。

第 2 版では、第 1 版の未決事項 14 件をすべて確定へ移し(決定 22〜35)、決定 20 を改めた。あわせて 2 つのレビューの採用分を各セクションへ反映した。

第 3 版では、ユーザーレビューの指示で決定 24 を改め、決定 36(生成物の扱い)と決定 37(intent 文書の書き込みを hook で許す)を足した。

第 4 版では、ユーザーの要件と決定で決定 12 を改め、決定 38(codiel と metatron の独立性)と決定 39(metatron が無いときの ADR)を足した。独立性の監査を §6.10 に置いた。

第 5 版では、ユーザーの決定で決定 20 と決定 39 を改め、決定 40(`[ADR 候補]` の移送と縮約を metatron が行う)を足した。第 4 版の「README に手動で移す手順を書く」は撤回した。metatron 側の設計を §6.11 に置いた。

第 5 版の追補では、`[ADR 候補]` の印に候補 ID を持たせ、縮約の失敗後の検出をタイトルの一致から候補 ID の一致に替えた(§6.4.2、§6.11)。

第 6 版では、ユーザーの決定で決定 20 を改め、決定 41〜45(執筆規則と画像の載せ方)を足した。執筆規則を §6.12 に置いた。

第 7 版では、第 6 版に対する 2 つのレビューの採用分と、`ghAttach` の判定のユーザー決定(決定 44)を反映した。主な変更は、intent フェーズの手順の順序(§6.1.2)、hook の `docs/intents/**` と worktree の判定(§6.8)、wave の出力の形と重なり判定(§6.6.2)、metatron の縮約を `shrink-adr-candidate` に一本化したこと(§6.11)である。

第 7 版の追補では、`*.ghe.com` を github モードに含めるユーザー決定(決定 46。§15 の未決事項を移した)と、stop-guard との衝突を避けるためユーザーへの確認を `codiel-state init` より前へ移したこと(§6.1.2)を反映した。

第 8 版では、ユーザーの要件(raw human intent を完了判定の最高権威とし、現状とゴールをユーザーの言葉のまま記録する)と決定で、決定 23 を改め、決定 47〜49 を足した。書式 v2 の `## ASIS` / `## TOBE` を原文のセクションにし、派生文を `## 現状調査` / `## 要求` へ移した(§6.3.3)。

第 9 版では、原文まわりの 2 つのレビューの採用分を反映した。原文になるのは人が書いた・語った言葉だけという原則を置き、Issue を入口にしたときの扱い、途中の要望の即時追記と hook の許可、`status: done` を finalize が付けること、`mark-ask` による確認の一般則を決めた(決定 47・49 を改め、決定 50〜52 を足した)。

第 9 版の追補では、`mark-ask --kind`、finalize での `resume` の遷移、intent 文書を書くのはオーケストレーターだけという規則、`stop --reason intent-updated` の例外、codiel が起票した Issue の人のコメントの扱いを決めた(§6.1.1、§6.2.2、§6.3.2、§6.3.5、§6.8)。続く追補では、run が active な間に GitHub へ投稿する本文すべてに `<!-- codiel:generated -->` を付け、hook で強制することを決めた(決定 53。§6.3.5、§6.8)。

実装時の追補(2026-09-27)では、実装中のユーザー決定を決定 54〜59 として足し、M2 のレビューで直した仕様を決定 60〜62 として足した。これに合わせて §3.6・§6.1.1・§6.1.2・§6.2.2・§6.8・§6.9.4・§6.10.1・§7.1・§10・§11.1 の該当行を改めた。続く追補では、M2 の再レビューとユーザー決定で決定 63〜71 を足し、§4.2 の A2-3・A2-21、§6.1.1・§6.1.2・§6.2.2・§6.2.4・§6.3.2・§6.8・§6.12.3・§6.12.6 を改め、§6.12.7 を足した。実装計画書 §9.4 の 11〜25 が経緯を持つ。

| # | 論点 | 決定 | 具体化 |
| --- | --- | --- | --- |
| 1 | 文書の本数 | 設計書 1 本。実装計画はマイルストーン分割 | §10 |
| 2 | intent の層 | 2 層。変更ごとの intent と、長く残る持続層 | §6.3、§6.4 |
| 3 | run の本数と入口 | run は 1 本。`/codiel:run [<Issue番号> \| <intent パス> \| 省略]` | §6.1 |
| 4 | フェーズ列 | `intent → discuss → design → (test-spec ∥ dev-plan) → implement(並列) → test-loop(並列) → intent-sync → pr → review → fix-loop → triage → finalize` | §6.1 |
| 5 | intent 承認ゲートで決めること | 規模(標準 / 軽量)、文書だけ残して終えるか、Issue 起票(github モードのみ・任意) | §6.1.3 |
| 6 | 軽量でも review は飛ばさない | 軽量は discuss と design だけを飛ばす | §6.1.4 |
| 7 | sandalphon の実行系 | `executing-intent`・`bridging-execution`・`/sandalphon:run` を廃止。起票部分だけ決定 5 の任意選択肢として残す | §7 |
| 8 | discuss の範囲 | how の論点だけ。intent で合意済みの分岐は再提示しない | §6.1.5 |
| 9 | run の識別子 | intent slug。`.codiel/runs/<slug>/try-<n>/`、ブランチ `codiel/<slug>-try-<n>`。state `version: 2`、`intent` 必須・`issue` 任意 | §6.2 |
| 10 | 変更ごとの intent の書式 | 置き場 `docs/intents/YYYY-MM-DD-<slug>.md`。書式 v2 | §6.3 |
| 11 | 持続層 | `docs/intents/domains/<領域>.md`。1 領域 1 ファイル | §6.4 |
| 12 | ADR との分担 | metatron が有るとき、ADR は metatron に残す。持続層は ADR の 3 条件を満たさない設計理由と意図的な制約を持ち、ADR へは参照だけを持つ。metatron が無いときは決定 39 | §6.4.3 |
| 13 | 持続層の読み書き | 読むのは intent の現状調査・design・review(軽量では決定 33)。codiel の中で書くのは intent-sync だけ。codiel の外では metatron が `[ADR 候補]` の縮約だけを行う(決定 40) | §6.4.4 |
| 14 | 書式の正本 | `plugins/codiel/references/intent-format.md`。format-change-checklist は `plugins/codiel/docs/` | §6.9 |
| 15 | コミット | intent 文書(両層)は codiel が run の中でコミットする | §6.1.2、§6.4.4 |
| 16 | 連携モード | `github` / `local`。state に記録する | §6.5 |
| 17 | 並列実装 | wave 分割・1 ステップ 1 worktree・brief / report ファイル・ステップごとのタスクレビュー・順次マージ | §6.6 |
| 18 | test-loop の並列化 | Step A は unit ごと、Step B は worktree 方式。fix-loop は直列 | §6.7 |
| 19 | sandalphon の撤去 | 資産を codiel へ移し、波及先をすべて追随させる。`plugins/sandalphon/` の削除はユーザーが手で行う | §7 |
| 20 | バージョン | codiel は M1〜M3 の終点で `1.0.0-dev`、M4 の終点で `1.0.0`。metatron は走査と縮約の実装が入るため、パッチではなくマイナーを上げて `0.4.0-dev` にする(執筆規律の追随も同じマイナーに含める)。gh-utility は GitHub の執筆規則と画像の載せ方を足すため、パッチを上げて `0.5.3-dev` にする。raguel-mcp は変更しない | §9 |
| 21 | マイルストーン | M1 吸収 → M2 起点変更 → M3 持続層 → M4 並列化 | §10 |
| 22 | intent-sync のゲート | Raguel `evaluate_design` による pass-gate。`GATED` に入れる | §6.1.1 |
| 23 | sandalphon の v1 intent を入力に受けたとき | v2 へ昇格して再開する。v1 の `## ASIS` / `## TOBE` をそれぞれ `## 現状調査` / `## 要求` へ移す。不足セクション(原文の `## ASIS` / `## TOBE`、`## 目的`・`## 意図的な制約`)だけを聞き取り、承認ゲートを取り直す。既存の記述は確定済みとして扱う | §6.1.2、§6.3.3 |
| 24 | 文書だけ残して終える run | intent 文書を開始時のブランチ(base)にコミットし、run ブランチは作らず `completed` で閉じる。intent の `status` は `approved` のまま残し、後でパスを渡せば実装を再開できる。そのため run ブランチの作成は承認ゲートの後に置く | §6.1.2、§6.1.3、§6.2 |
| 25 | slug | ASCII。`^[a-z0-9]+(-[a-z0-9]+)*$`、最大 40 文字。同日同 slug は `-2`、`-3` を付す | §6.2.3 |
| 26 | `implement.steps` のスキーマ | 設計書は必須フィールドの列挙まで。詳細は実装計画で確定する | §6.6.5 |
| 27 | worktree の後始末 | マージ済みは直後に削除する。失敗したものは run の終了まで残し、やり直しの前に必ず削除してから作り直す | §6.6.3 |
| 28 | 連携モードの固定 | run 開始時に判定して固定する。再判定は resume 時だけ行い、変わっていたら人に確認する | §6.5.1 |
| 29 | 並列度の上限 | 固定 4 | §6.6.2 |
| 30 | Step A の実行 | 「並列可」の規則を当てる | §6.7 |
| 31 | 領域名の記録 | intent の frontmatter `domains` に YAML 配列で記録する。ファイル名に使えない領域名は slug と同じ規則に正規化する | §6.3.2、§6.4.1 |
| 32 | `analyzing-issues` と `codiel-analyst` | 削除する。Issue の読み取りは intent フェーズのオーケストレーターが行う。ADR-004 との不整合は M2 で起票する新 ADR で解消する | §3.6、§6.1.6、§10 |
| 33 | 軽量経路で持続層を読むフェーズ | intent・test-spec・dev-plan・review | §6.4.4 |
| 34 | 修正ループ 4〜5 ラウンド | ADR-004 に合わせ、作業内容で表す。役割名もモデル名も書かない | §6.6.4 |
| 35 | 手順の実行者 | state を書くのはオーケストレーターだけ。サブエージェントは `codiel-state` を呼ばない | §6.6.5 |
| 36 | ビルド生成物の扱い | 対象プロジェクトの規約に従う。dev-plan の `## 生成物` で、a(各ステップで生成し同じコミットに入れる)か b(全 wave の後の直列の最終ステップでまとめて生成する)を宣言する。規約に定めが無ければ b。「ソースと生成物を同じコミットに入れる」はこのリポジトリの規約であり、codiel の一般規則ではない | §6.6.1、§6.6.2、§6.6.4 |
| 37 | run 作成前後の intent 文書の書き込み | 手順の順序を入れ替えず、hook で許す。guard-write は `docs/intents/**` を phase `null`・intent・intent-sync・triage で通す | §6.1.2、§6.8 |
| 38 | codiel と metatron の独立性 | どちらか一方だけを導入した環境でも、両方の機能が成り立つ。codiel → metatron の依存にはすべて縮退先を持たせ、metatron → codiel の実行時依存は作らない | §6.10 |
| 39 | metatron が無いときの ADR | 判定は run 開始時の既存の解決(`orchestrating-runs` §0)で ARCHITECTURE が見つからないこと(`architecture_missing`)とし、未導入と未初期化を同じ分岐で扱う。無いときは、ADR の 3 条件を満たす判断を持続層の `## 意図的な制約` に背景・検討した選択肢・理由を省かず書き、「ADR 候補」の印を付ける。finalize でも ADR 候補として挙げる。ADR への移送は決定 40 | §6.2.1、§6.4.2、§6.4.3 |
| 40 | `[ADR 候補]` の移送 | metatron の init と update が `docs/intents/domains/*.md` を在れば読み、無ければ何もしない。印付きエントリを ADR 候補として提示し、承認されたものを既存の ADR の規律で ADR にし、同じ commit の手順の中で持続層の該当エントリを参照形に縮める。ADR の作成に失敗・却下したエントリは全文のまま残す。metatron が持続層に行ってよい書き換えはこの縮約だけである。`[ADR 候補]` の書式は両プラグインの共有ファイル契約とし、正本は codiel の `intent-format.md`、metatron は参照文書に写しを置く | §6.4.3、§6.10、§6.11 |
| 41 | metatron の執筆規律の追随 | `writing-discipline.md` を prompt-smith の現行規律に追随させる。理由の扱い・例・簡潔さ・強調の禁止の 4 点、出力の形を示す例の明記、禁止を書くときの「やむを得ず」、引くための記述の例外と見分け方、見出しの概要や 1 文だけの指示を見出しの直下に書く規則、箇条書きで文脈が破綻する箇所を散文で書く規則を、すべて移す(ユーザーが 2026-09-27 に全移植を決定)。引くための記述の例外は ARCHITECTURE と rules の値を引く先のブロックだけに効かせ、GOTCHAS エントリには当てない特化を維持する。ARCHITECTURE・GOTCHAS・ADR 固有のほかの特化も維持し、metatron の checklist に追随の行を足す | §6.12.5 |
| 42 | Intent 文書の執筆規則 | codiel に新設する。正本は `plugins/codiel/references/intent-writing.md`。構成は prompt-smith の現行規律に従い、根拠と背景は「過剰なものは削り、必要なものは残す」。引用・出典は末尾の `## 出典` セクションにまとめ、intent 書式 v2 と持続層の書式に `## 出典` を足す | §6.3.3、§6.4.2、§6.12.2 |
| 43 | GitHub の Issue・PR・コメントの執筆規則 | 読者は主に人間。codiel の正本は `plugins/codiel/references/github-writing.md`。gh-utility にも独立に写し、gh-utility の正本は gh-utility の中に置いて codiel を参照しない | §6.12.3、§6.12.6 |
| 44 | 画像の載せ方 | `gh` 2.99.0 以上の `--attach`(リモートのホストが `github.com` か `*.ghe.com` のときだけ。GHES を除く)、claude-in-chrome によるブラウザからのアップロード、ローカル保存の順に縮退する。レビュー本文だけは claude-in-chrome を先にする。codiel は run 開始時に判定して state に記録し、gh-utility は実行時に判定する | §6.2.1、§6.12.4 |
| 45 | 執筆規則のマイルストーン | intent-writing・github-writing・画像の手段の判定・gh-utility への写しは M2、metatron の執筆規律の追随は M3 | §10 |
| 46 | `*.ghe.com` の扱い | github モードに含める。codiel の `check-intent-env` と gh-utility の `check-issue-env.ts` の両方で、`repoSlug` の正規表現を `github.com` と `<名前>.ghe.com` のホストを受ける形に改め、出力に `remoteHost` を持たせ、認証は `gh auth status --hostname <remoteHost>` で確かめる。独立実装なので両方を個別に直す。GHES(それ以外のホスト)は従来どおり local | §6.5.1、§6.9.3、§6.12.6、§7.4 |
| 47 | 原文のセクション | 書式 v2 の `## ASIS` にユーザーが語った現状を、`## TOBE` にそれ以外のユーザーの言葉すべてを、原文のまま原語で記録する。要約・言い換え・並べ替え・翻訳をしない。run の途中で足された言葉は、どのフェーズでも即座に日付・話者・出所つきで末尾に追記し、既存の原文を書き換えない。ユーザーが現状を語っていなければ、聞き取りで 1 問だけユーザーの言葉で尋ねる。原文は変更ごとの intent にだけ置き、持続層には置かない。原文になるのは人が書いた・語った言葉だけであり、AI が生成した文は原文にしない | §6.3.3 |
| 48 | 派生文のセクション | v1 の `## ASIS`(AI の現状調査)を `## 現状調査` へ、`## TOBE`(要求 1 件 1 行)を `## 要求` へ移し、どちらも原文からの派生と書式に明記する。受け入れ基準は `## 要求` から派生する | §6.3.3 |
| 49 | 原文による完了判定 | 完了判定の最高権威は原文である。review は差分が原文を満たすかも見て、原文の要望の未達を severity high にする。finalize は結果レポートで原文の各要望に「達成 / 未達 / 要確認 / 持ち越し」を示す。派生文と原文が食い違ったら原文を正とし、`mark-ask` で人に確認する。原文は自動で書き換えない。`status: done` は finalize が、持ち越しを除く原文の要望がすべて達成のときだけ付ける | §6.3.2、§6.3.6 |
| 50 | Issue を入口にしたとき | マーカーは本文全体から行の完全一致で探す。`<!-- intent:v2 -->` は原文のセクションだけを原文へ、`<!-- intent:v1 -->` と `<!-- codiel:generated -->` は本文を派生として扱い原文を聞き取る。マーカーの無い Issue は本文と人のコメントを原文に記録する。承認ゲートでユーザーは原文から除く記録を選べる | §6.3.5 |
| 51 | 途中の追記と hook | active run の `state.intent` が指すファイル 1 本への書き込みは、すべてのフェーズで許可する。原文を書き換えない・要約しないは AI 側の規律で守る。intent-sync より後の追加の要望は、ユーザーが run に含めるかを決め、含めなければ持ち越しの注記を付ける | §6.3.4、§6.8 |
| 52 | 途中の人への確認 | フェーズの途中で人に確認するときは、`mark-ask` で `awaiting_human` にしてから確認する。stop-guard に止められないためである | §6.1 |
| 53 | 投稿する本文のマーカー | run が active な間、GitHub へ本文を投稿する操作はすべて `<!-- codiel:generated -->` を本文に含める。対象は Issue の作成・編集・コメント、PR の作成・編集・コメント・レビュー本文である。スキルの規律で付けたうえで、`gh` のコマンドは guard-bash、GitHub MCP の書き込みツールは新しい PreToolUse の hook で強制し、マーカーが無ければ deny する。run が active でないセッションには掛けない。codiel を通さない投稿までは追わない。gh-utility の投稿にはマーカーを付けない | §6.3.5、§6.8、§6.12.3、§6.12.6 |
| 54 | evals | codiel は `evals/` を持たない。codiel のスキルはどれもコマンド・`orchestrating-runs` の手順・依頼文から名前かパスで起動され、description の照合では起動されないので、発火率を測る evals は要らない | §6.9.4 |
| 55 | スキルの description | codiel の全スキルの description を「Codiel の <フェーズ> フェーズで、<担い手> が <入力> から <出力> を<動作>ときに使う。<起動元> が名指しで起動する。」の形に揃える。発火を促す句は入れない。対象はスキルだけで、commands と Agent 定義は含めない | §6.9.1 |
| 56 | 同梱 Agent | codiel は同梱 Agent を持たない。`codiel-test-designer` を廃止し、test-spec は成果物を書く委譲にする。書ける範囲(`.codiel/specs/<unit-id>/` の `spec.md` と `cases.md` だけ、Bash を使わない)は依頼文と `writing-test-specs` の HARD-GATE で表す | §3.6、§6.1.1、§10 |
| 57 | `CLAUDE.example.md` | metatron への分離後と intent 駆動化後の実態に合わせて書き直す | §6.9.4 |
| 58 | GOTCHAS の記録 | codiel の `recording-gotchas` スキルを削除し、GOTCHAS の記録は `metatron:recording-gotchas` に委ねる。codiel に残すのは、記録の契機 4 つ(Raguel の STOP、ループ上限超過、incident、レビューで発覚した設計漏れ)と、metatron の CLI の案内が無いときの退避(未記録の GOTCHAS)だけで、`orchestrating-runs` の「失敗の記録」のセクションに置く | §6.10.1 |
| 59 | `CLAUDE.example.md` と metatron | `CLAUDE.example.md` に ARCHITECTURE・GOTCHAS・metatron の言及を書かない。metatron が無い環境では不要で、有る環境では metatron の SessionStart の注入が伝える。ARCHITECTURE との乖離の縮退は `orchestrating-runs` の依頼文テンプレートと finalize が持つ | §6.10.1 |
| 60 | `gh api` の本文 | guard-bash は `gh api` の書き込み(POST・PATCH・PUT)のうち、`body` のフィールドか `--input` で本文を送るものにもマーカーを求める。codiel のスキルが `gh api` で PR の行コメントと反論を投稿するためである | §6.8 |
| 61 | `mark-ask` の受け付ける状態 | `mark-ask` は `in_progress` のフェーズと、`pending` の finalize だけを受け付ける。終端の run、passed のフェーズ、finalize 以外の `pending` のフェーズは拒否する。フェーズの合間に確認するときは、次のフェーズを `start-phase` してから `mark-ask` する | §6.1.1、§6.2.2 |
| 62 | intent フェーズの手順 0 と再開 | 手順 0 は、今回再開する run を終端にしない。終端にするのは再開しないほかの run だけで、終端にする前にユーザーに示して確かめる | §6.1.2 |
| 63 | v1 の run の outcome | `version: 1` で `awaiting_outcome` の run は、outcome を記録できる。`get --active` はこの run を `runs` に含めて文言を出さず、`record-outcome` はこの run と、`completed` / `rejected` の v1 の run への incident だけを受け付ける。同期では `integration` を github として扱う。§6.2.4 の例外である | §6.2.2、§6.2.4 |
| 64 | 本文を自動で作るフラグ | run が active な間、本文のフラグ(`--body` / `-b` / `--body-file` / `-F`)を持たずに `--fill`・`--fill-first`・`--fill-verbose`・`--template` / `-T` を持つ `gh pr create` と、`--template` / `-T` を持つ `gh issue create` を deny する。本文のフラグを持つ呼び出しは本文を検査する | §6.8 |
| 65 | Issue・PR のテンプレート | テンプレートはスキルが読み、その見出し構成に沿って本文を書き、マーカーを含む本文を `--body-file` で投稿する。gh の `-T` は使わない。PR は単一ファイルのテンプレートだけを使い、`PULL_REQUEST_TEMPLATE/` 配下にしか無いときは使わない。後続 Issue は `filing-followup-issues` の既存の探索を使う。intent-issue は gh-utility `issue-craft` の選択と 3 択のまま据え置く。同意・署名・人の確認を表すチェックボックスは付けずに残す | §6.12.7 |
| 66 | 同じコマンドでの本文の書き換えと複数の投稿 | guard-bash は、本文ファイルのパスが同じコマンドの別の場所にも現れる呼び出し、本文付きの投稿が 2 つ以上あっていずれかが本文を引数で渡す呼び出し、`gh pr create --web` / `-w` を deny する。本文は Write ツールで run の `reports/` に投稿ごとに別名で書き、別の Bash 呼び出しで `--body-file` で渡す | §6.8、§6.12.3 |
| 67 | 本文ファイルのコミット | PR と後続 Issue の本文ファイルは、`review-<n>.md` と同じく run ブランチにコミットする | §6.12.7 |
| 68 | intent の保存に失敗したとき | intent フェーズの手順 5 の (6) で `git switch -c` か `git commit` が「変更なし」以外の理由で失敗したら、`codiel-state stop --slug <slug> --reason commit-failed` で run を終端にしてからユーザーに確かめる。この確認は手順 5 の (4)〜(6) の間に確認を挟まない規則の例外である。intent は `abandoned` にしない。次の try は、作業ツリーに残した intent をそのまま使い、前の try のブランチから持ち込まない | §6.1.1、§6.1.2、§6.3.2 |
| 69 | 投稿のマーカーを検査する hook の範囲 | guard-bash と guard-github-mcp は、run の手順の中でマーカーを付け忘れた投稿を止める安全網である。塞ぐのは、スキルの手順で使う書き方と、自然に書きうる書き方(本文のコマンド置換、行の継続、短いフラグの結合、フラグの繰り返し、`-R` の位置)ですり抜ける投稿である。手順どおりの正当な呼び出しを止める誤検知も、同じ重さで直す。複雑なシェル構文による意図的な回避まですべて塞ぐことは目的にせず、既知の限界として §6.8 に記録する(決定 53 の「codiel を通さない投稿までは追わない」) | §6.8 |
| 70 | 運用の規律の置き場 | codiel の運用の規律(intent の原文・持続層・テスト仕様書の扱いと、run の前提・state.json・Raguel ゲート・incident の規則)は、`/codiel:init` が対象プロジェクトの `.claude/rules/codiel.md`(`paths` の指定なし)に置く。CLAUDE.md はセッションの最初にだけ読まれるので、最初に知っておくべき知識(置き場の地図と入口のコマンド)だけを「## Codiel」のセクションに置く。雛形は `plugins/codiel/assets/rules/codiel.md` と `CLAUDE.example.md` である。既存の CLAUDE.md に旧セクション「## Codiel ハーネス運用ルール」があれば、取り除く差分を示して承認を得てから消し、承認されなければ残して報告する | §6.9.4 |
| 71 | ADR の書き方 | metatron の `writing-discipline.md` に「## ADR の書き方」を足し、次の 6 つを定める。背景には、なぜその決定が要ったか(解きたい問題、反していた考え)を書き、現状の事実だけでは背景にしない。各欄の事実と決定を落とさない範囲で、最も短い文と最も少ない文数で書く。影響範囲には、その決定から直接生じる変化だけを 1 項目 1 文で書き、結論の繰り返しと別の決定の帰結は書かない。本文を書き換えないほかの ADR の記述が古くなるときは、その置き換えを影響範囲に 1 文で書き、ほかの ADR の一部を上書きするときは上書きする範囲を結論に書く。検討した選択肢は互いに食い違わない書き方にし、前の選択肢を土台にするときは差分を書く。理由には、採用した結論が背景の問題をどう解くかと選んだ根拠を書き、背景の文を繰り返さない(ADR-006 の起票で決めた基準) | §6.12.5 |

---

## 2. 背景と目的

### 2.1 codiel の起点が GitHub Issue に固定されている

`/codiel:run <issue番号>`(`plugins/codiel/commands/run.md:3`)は Issue 番号を必須の引数に取り、run の識別子・ディレクトリ・ブランチ・Raguel の runId をすべて Issue 番号から作る(`plugins/codiel/src/codiel-state.ts:116-118,195-200`)。init フェーズは `gh issue view` で Issue を読み、`issue.md` に構造化する(`plugins/codiel/skills/analyzing-issues/SKILL.md`)。

この形では、Issue を作れない環境(GitHub 以外のリモート、`gh` 未認証、リモートなし)で run を始められない。要望が固まる前の上流区間は sandalphon が担っていたが、intent 文書 → Issue → codiel の `issue.md` という 2 回の転記を挟み、転記の写像表(`plugins/sandalphon/references/intent-format.md:123-136`)を両プラグインで同期させる必要があった。

### 2.2 「なぜそうなっているか」を残す場所が無い

metatron は ARCHITECTURE(構造と ADR)と GOTCHAS(失敗)を持つ。ADR になるのは「覆すコストが大きい・選択肢が実在した・理由が自明でない」の 3 条件をすべて満たす判断だけである(`plugins/metatron/references/writing-discipline.md:67-75`)。3 条件を満たさない設計理由や、「この領域ではこうしない」という意図的な制約は、Issue と PR の本文に散って run が終わると辿れなくなる。

### 2.3 目的

1. sandalphon を codiel に吸収し、プラグイン一覧から削除する。
2. run の起点を codiel 自身が作る intent 文書にする。Issue は任意の入力とし、読んだ後に intent を作る。implement と test-loop は、独立したステップを worktree で並列に実行する。
3. metatron が扱わない「領域ごとの目的と意図的な制約」を持続層として codiel が持ち、run のたびに読み、run の終わりに更新する。

---

## 3. 前提(実測。2026-09-27 時点の working tree)

### 3.1 baseline

- HEAD: `e40dece`。作業ツリーの差分は `docs/chat/INDEX.md` の変更と未追跡の会話記録だけで、本改修と無関係である。
- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` の結果は、計画書の最初のタスクで取り直して記録する。

### 3.2 codiel の現行構造

- フェーズ列と GATED は `codiel-state.ts:66-95` にある。コード上の `STAGES` は 11 ステージで、test-spec と dev-plan だけが同じステージに並ぶ。`GATED` は init / design / test-spec / dev-plan / implement / test-loop / fix-loop の 7 フェーズ、`SKIPPABLE` は fix-loop だけである。
- フェーズの入出力表の正本は `plugins/codiel/skills/orchestrating-runs/SKILL.md:128-142` である。
- Issue 番号は識別子として 5 箇所で使われる。`runDir`(`codiel-state.ts:116-118`)、`findActiveRun` のディレクトリ名フィルタ `/^issue-\d+$/`(`:149`)、`newState` の `runId` / `issue` / `branch` / `raguelRunId`(`:195-200`)、`loadRun` の `--issue` 必須(`:213-216`)、`get --active` のフィルタ(`:265`)。
- `RunState.issue` は `number` 型の必須フィールドである(`codiel-state.ts:30`)。`pr` は `{ url: string | null }` である(`:36`、`:204`)。
- `guard-bash.ts:161-182` は、アクティブ run があるとき `gh issue create` を triage 以外で、`gh pr create` を pr フェーズかつ test-loop 合格後以外で、`git push` を pr / fix-loop / triage / finalize かつ test-loop 合格後以外で拒否する。条件はフェーズと test-loop の状態だけであり、`state.issue` を見ていない。
- `guard-write.ts:101-104` は `findProjectRoot(cwd)`(`.codiel` を持つ最も近い祖先。`lib.ts:539-545`)を基準に `codielRel` を作り、`.codiel/` 配下への書き込みをドメイン境界の対象外にする(`:136`、`:180`)。ドメイン境界の値は `state.domain` の 1 つだけである(`:134`)。
- Raguel の runId は `^[A-Za-z0-9._-]{1,64}$` に制約される(`plugins/codiel/raguel-mcp/src/tools/shared.ts:15`、`src/casefile/store.ts:29`)。
- dev-plan の各ステップは「変更ファイル / 内容 / ユニットテスト / 完了条件 / 検証コマンド」を持つ(`plugins/codiel/skills/writing-dev-plans/SKILL.md:57-76`)。`spec.md` は frontmatter を持たない(`plugins/codiel/skills/writing-test-specs/SKILL.md:52`)。

### 3.3 gh への依存箇所

| ファイル | 行 | 依存 |
| --- | --- | --- |
| `skills/analyzing-issues/SKILL.md` | `:21`、`:73-91` | `gh issue view` と intent issue の写像 |
| `skills/reviewing-diffs/SKILL.md` | `:11`、`:33`、`:83`、`:85` | `gh pr diff` / `gh pr view` で diff を取り、`gh pr review`(`:83`)と `gh api`(`:85`)で投稿 |
| `skills/filing-followup-issues/SKILL.md` | `:48-55`、`:114-115` | `gh issue list` / `gh issue create` / `gh pr comment` |
| `skills/raguel-gating/SKILL.md` | `:149` | `gh pr view` で merge を判定 |
| `agents/codiel-analyst.md` | `:4`、`:21` | GitHub MCP の読み取り群と `gh issue view` |
| `commands/run.md` | 全体 | 引数が Issue 番号 |

### 3.4 sandalphon の構成

- 指示層: `skills/capturing-intent/SKILL.md`(11,245 B)、`bridging-execution`(11,560 B)、`executing-intent`(11,580 B)、`commands/run.md`。
- 参照層: `references/intent-format.md`(書式の正本)、`handoff-contract.md`(gh-utility `issue-craft` 持ち込みモードの呼び出し契約)、`sandalphon-common.md`(基本方針・環境チェック・畳む経路の表・失敗時)。
- 実装層: `src/check-intent-env.ts`(812 行)。ルート解決・設定読み取り・ドメインマップ読み取りを codiel `src/hooks/lib.ts` と同じ規則で独立に実装している(`:266-545`)。
- 文書: `docs/rationale.md`、`docs/format-change-checklist.md`。evals: `evals/{capturing-intent,bridging-execution,executing-intent}.json`。
- 3 者比較テスト: `src/__test__/check-intent-env.test.ts` の `expectThreeWayMatch`(定義 `:911`)とケース 16f(`:1011-`)。metatron 側は `plugins/metatron/src/lib/__test__/config.test.ts:274-338` の R4-a〜f。

### 3.5 sandalphon への言及が残る箇所(`plugins/sandalphon/` の外)

| ファイル | 行 | 内容 |
| --- | --- | --- |
| `.claude-plugin/marketplace.json` | `:64-65` | プラグイン登録 |
| `.claude/settings.json` | `:62` | `enabledPlugins` の `sandalphon@amatsuka-claude-plugins` |
| `.claude/skills/session-handover/evals/session-handover.json` | `:21` | eval のクエリ文 |
| `README.md` | `:134` ほか | プラグインの説明 |
| `pnpm-workspace.yaml` | `plugins/sandalphon` 行 | workspace 登録 |
| `pnpm-lock.yaml` | sandalphon の importer | `pnpm install` で再生成される |
| `harness-docs/ARCHITECTURE.md` | `:50` | 「4 プラグイン同士の言及」の例外 |
| `.claude/rules/metatron/protected-paths.md` | `:21`、`:22` | 3 者の独立実装、intent 書式契約の行 |
| `plugins/metatron/references/architecture-format.md` | `:84` | ドメインマップの読み手 `sandalphon check-intent-env` |
| `plugins/metatron/docs/format-change-checklist.md` | ARCHITECTURE 書式のセクション、config のセクション | sandalphon の追随先と 3 者比較 |
| `plugins/metatron/docs/ARCHITECTURE.example.md` | `:106` | 読み手の列挙 |
| `plugins/metatron/README.md` | `:116-118` | 連携のセクション |
| `plugins/metatron/src/lib/config.ts` | `:8-9` | コメント(3 者比較を「契約 §13」と誤記) |
| `plugins/metatron/src/lib/__test__/config.test.ts` | `:241` | コメント(「契約 §13」と誤記) |
| `plugins/metatron/src/fixtures/section-reference-inventory.json` | `:148`、`:154`、`:160` | 登録簿に sandalphon の 3 ファイル |
| `plugins/codiel/src/hooks/lib.ts` | `:62`、`:88`、`:333`、`:339-340`、`:448` | コメント(`:340` は「契約 §13」と誤記) |
| `plugins/codiel/src/hooks/__test__/lib.test.ts` | `:6`、`:69`、`:206`、`:334`、`:677` | コメント(`:6`、`:69` は「契約 §13」と誤記) |
| `plugins/codiel/README.md` | `:52` | intent issue を起点にした場合のセクション |
| `.serena/memories/sandalphon/core.md` | 全体 | メモリ |
| `.serena/memories/file_contract.md` | `:1-17`、`:19-47`、`:85-94` | 3 者比較の記述 |
| `.serena/memories/codiel/core.md` | `:79` | intent issue を起点にした場合のセクション |
| `.serena/memories/core.md` | `:13`、`:50`、`:68`、`:71`、`:86-88` | プラグイン一覧と連携の記述 |
| `.serena/memories/tech_stack.md` | `:8` | プラグイン一覧 |
| `.serena/memories/metatron/core.md` | `:132` | 読み手の記述 |

「契約 §13」の誤記は、3 者比較のセクションが確定版の契約文書で §14(`harness-docs/design/2026-08-16-file-contract-freeze.md:838`)にあるのに §13 と書いているものである。§13 は hook 出力の形式(`:765`)であり、`plugins/metatron/src/inject-context.ts:5` の「§13」はこちらを指していて正しい。

gh-utility には sandalphon への言及が無い(`grep -rn sandalphon plugins/gh-utility` が 0 件)。§7.4 で扱う。

`docs/prompts/` の過去プロンプトと `docs/chat/` の会話記録にも言及があるが、記録として残す(§7.6)。

### 3.6 変えない前提と、上書きする ADR

- `plugins/codiel/raguel-mcp/`。runId の制約は slug 側で満たす(§6.2.3)。
- ADR-004 のディスパッチ規則。codiel は委譲先を名指しでも役割名でも指定せず、作業内容と委譲の種別だけを渡す(`harness-docs/ARCHITECTURE.md:225-251`)。§6.6.4 の修正ループもこの規則に従う。
- ただし ADR-004 の決定のうち「同梱 Agent を `codiel-analyst` と `codiel-test-designer` の 2 体に絞る」(`harness-docs/ARCHITECTURE.md:243`)は、本改修で `codiel-analyst` を削除するため成り立たなくなる。M2 で起票する新 ADR が、ADR-004 のこの部分を上書きする(§10)。実装時に `codiel-test-designer` も廃止したので(決定 56)、新 ADR は codiel が同梱 Agent を持たないことを内容とする。ADR-004 の本文は書き換えない。
- ドメインマップの契約と実行モード(`mapped` / `unscoped`)の分岐(`orchestrating-runs/SKILL.md:53-94`)。
- `/codiel:init` と `/codiel:test` の入口。init コマンドは初期化の外形(B + C + D)を作るもので、廃止する init フェーズとは別物である。
- 確定版の契約文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の本文。書き換えず、上書きの記録を §7.5 に置く。

---

## 4. 要件と受け入れ基準

受け入れ基準はすべて、コマンドの出力・ファイルの有無・grep の件数・テストの成否で YES / NO を判定できる形にしてある。

### 4.1 吸収(目的 1)

- A1-1: `.claude-plugin/marketplace.json` に `"name": "sandalphon"` が無い。
- A1-2: `pnpm-workspace.yaml` に `plugins/sandalphon` が無く、`pnpm install` 後に `pnpm run build` が成功する。
- A1-3: `plugins/codiel/references/intent-format.md`、`plugins/codiel/references/handoff-contract.md`、`plugins/codiel/docs/format-change-checklist.md` が存在する。
- A1-4: `grep -rln sandalphon . --exclude-dir=node_modules --exclude-dir=.git` の出力のうち、§7.6 の許可リストに当たらないパスが 0 件である。
- A1-5: `plugins/codiel/src/__test__/check-intent-env.test.ts` に metatron `loadConfig` と codiel `resolveDocPaths` の 2 者比較があり、`pnpm run test` で成功する。
- A1-6: `plugins/sandalphon/` が存在しない(ユーザーの手による削除後)。

### 4.2 起点変更(目的 2 の前半)

- A2-1: `/codiel:run` が引数なし・Issue 番号・intent パスの 3 形で起動でき、`commands/run.md` の `argument-hint` が 3 形を示す。
- A2-2: `codiel-state init` が `--slug <slug>` と `--intent <パス>` を必須とし、`--issue` を任意とする。作られる state は `version: 2`、`runId: <slug>`、`branch: codiel/<slug>-try-<n>`、`raguelRunId: <slug>-try-<n>` を持つ(テスト)。
- A2-3: `version: 1` の state に対し `get` と `stop` 以外のコマンドが非ゼロで終了し、stderr に §6.2.4 の文言テンプレートと同じ文言を出す(テスト)。`get --active` は v1 の `active` / `awaiting_human` の run を `runs` に含めず、同じ文言を stderr に出す(テスト)。v1 の `awaiting_outcome` の run は `runs` に含め、`record-outcome` を受け付ける(決定 63。テスト)。
- A2-4: state に `integration: "github" | "local"` が記録され、`local` の run で `complete-phase pr` が `--pr-url` なしで成功する(テスト)。
- A2-5: `issue` を持たない run でも、guard-bash が phase に応じて `gh issue create` / `gh pr create` / `git push` を拒否する(テスト)。
- A2-6: `plugins/codiel/skills/analyzing-issues/` と `plugins/codiel/agents/codiel-analyst.md` が存在しない。
- A2-7: 軽量の run で `skip-phase discuss` と `skip-phase design` が成功し、標準の run では失敗する(テスト)。
- A2-8: `init --intent-only` で作った run は `branch` が `null` で、intent の `pass-gate` の後に `close` で `status` が `completed` になる。`branch` が `null` の run では intent 以外の `start-phase` が失敗する(テスト)。`capturing-intent` の SKILL.md が、intent 文書をパス限定で stage してからコミットする手順を持つ(grep で `git add -- ` と `git commit -m` と `-- <intent パス>` の 3 つの文字列)。同じ SKILL.md が、intent 以外の未コミット変更を退避するときに `git stash push -m` をパス指定で使い、`stash -u` を使わないと明記する(grep で `git stash push -m`)。
- A2-9: guard-write が、`docs/intents/*.md`(直下)への書き込みを phase `null`・intent・intent-sync・triage で通し、それ以外のフェーズで ask を返す。ただし active run の `state.intent` が指すファイル 1 本への書き込みは、すべてのフェーズで通す。`docs/intents/domains/**` への書き込みは intent-sync だけで通し、phase `null`・intent・triage では ask を返す(テスト)。
- A2-10: `plugins/codiel/references/intent-writing.md` が次の固定文字列をすべて含む(grep)。「制約を意図して置いたと分かる理由」「合意済み事項がその選択肢に決まった理由」「適用範囲や優先順位を判断する材料になる理由」「議論の経過の語り」「実測値の詳細」「採らなかった案の長い説明」「同じ理由の言い換え」「## 出典」。`plugins/codiel/references/intent-format.md` の変更 intent の書式と持続層の書式のコードブロックで、最後の `##` 見出しが `## 出典` である(grep で各コードブロックの最終見出しを確かめる)。
- A2-11: `plugins/codiel/references/github-writing.md` があり、§6.12.3 の 3 文と、§6.12.4 の縮退の順序(Issue・PR・コメント全般とレビュー本文の 2 系統)と、可視性がリポジトリに従うことを含む(grep)。
- A2-12: `plugins/gh-utility/references/` に GitHub の執筆規則のファイルがあり、A2-11 と同じ 3 文・縮退の順序・可視性の記述を含む。gh-utility の Issue やコメントを書くスキル(`issue-craft`・`issue-split`・`issue-triage`)の SKILL.md がそのファイルを読む指示を持つ。gh-utility の配下に `codiel` の語が無い(grep)。gh-utility の `check-issue-env.ts` が、リモートのホストが `github.com` と `<名前>.ghe.com` のとき `repoSlug` を返し、GHES の独自ドメインでは `null` を返し、出力に `remoteHost` を持ち、認証を `gh auth status --hostname <remoteHost>` で確かめる(テスト。`src/__test__/check-issue-env.test.ts`)。
- A2-13: `codiel-state init` が `--image-upload` の値を state の `imageUpload` に記録し、`integration` が `local` のときは両方の手段を無効として記録する(テスト)。
- A2-14: 環境判定スクリプト(`check-intent-env`)の出力に `gh` のバージョンとリモートのホストがあり、`ghAttachSupported` が「2.99.0 以上」かつ「ホストが `github.com` か `*.ghe.com`」のときだけ真になる。バージョンの境界値(2.98.x・2.99.0・2.100.0・未導入)と、ホスト(`github.com`・`example.ghe.com`・GHES の独自ドメイン)の組み合わせで確かめる。同じスクリプトが、`github.com` と `example.ghe.com` で `repoSlug` を返し、GHES の独自ドメインでは `null` を返す。認証は `gh auth status --hostname <remoteHost>` で確かめる(テスト。gh のスタブで `--hostname` の引数を検証する)。
- A2-15: `codiel-state init` が `^issue-\d+$` に一致する slug を拒否する(テスト)。
- A2-16: `plugins/codiel/references/intent-format.md` の変更 intent の書式のコードブロックで、`##` 見出しが `## ASIS`・`## TOBE`・`## 目的`・`## 現状調査`・`## 要求`・`## 受け入れ基準`・`## 実装方針`・`## 意図的な制約`・`## 合意済み事項`・`## 非スコープ`・`## 未確定事項`・`## 変更履歴`・`## 出典` の順に並ぶ(grep)。同じファイルが次の固定文字列をすべて含む(grep)。「原文のまま記録する」「要約・言い換え・並べ替え・翻訳をしない」「日付つきで末尾に追記する」「既存の原文は書き換えない」「原文のセクションからの派生である」「`## 受け入れ基準` は `## 要求` から派生させる」「人が自分で書いた・語った言葉だけである」「AI が生成した文は、どの経路を通っても原文にしない」「<!-- codiel:unrecorded -->」「<!-- codiel:generated -->」「[持ち越し 」。v1 から v2 への変換の例がある(grep で `## 現状調査` と `## 要求` を含むコードブロック)。
- A2-17: `plugins/codiel/references/intent-writing.md` が「原文のセクションには削る基準を当てず、ユーザーの言葉を原文のまま保つ」と「原文のセクションには文の組み立ての規則も当てない」の 2 文を含む(grep)。
- A2-18: `plugins/codiel/skills/reviewing-diffs/SKILL.md` が「原文の要望の未達は severity high」の文を含む。`orchestrating-runs/SKILL.md` の finalize のセクションが「達成 / 未達 / 要確認 / 持ち越し」と「すべて達成のときだけ `status: done`」を含む。両方が「原文を正とし」と「`mark-ask`」を含む。`orchestrating-runs/SKILL.md` が「フェーズの途中で人に確認するときは `mark-ask`」の文と `--kind confirm` と `--reason intent-updated` を含む。`orchestrating-runs/SKILL.md` の依頼文テンプレートが「intent 文書を書き換えない。原文の追加が必要ならオーケストレーターへ報告する」の文を含む(grep)。
- A2-19: `plugins/codiel/skills/capturing-intent/SKILL.md` が次の固定文字列をすべて含む(grep)。「`## 現状調査`」「1 問だけ」「要約しない」「書き換えない」「原文にしない」「今回やらないことも `## TOBE` に記録する」「翻訳しない」「<!-- codiel:generated -->」。同じファイルが、「ASIS はユーザーに聞かず自分で読む」を `## 現状調査` の規律として持つ。
- A2-20: `codiel-state finalize` の後に intent の `status` が、持ち越しを除く原文の要望がすべて達成のときだけ `done` になり、未達か要確認が残れば `in-progress` のままである(スキルの手順の grep と §8.4 の手動確認)。intent-sync は `status` を `done` にしない(grep)。
- A2-21: guard-bash が、active run があるとき、`gh issue create|comment|edit` と `gh pr create|comment|edit|review` のうち本文を持つ呼び出しで、本文(`--body` / `-b` の値、`--body-file` / `-F` のファイルの中身)に `<!-- codiel:generated -->` が無ければ deny する。本文を持たない呼び出し(`gh pr review --approve` だけ、`gh issue edit --add-label` だけ)は通す。ただし、本文を自動で作る呼び出し(決定 64)と、`gh pr create` / `gh issue create` の `--web` は deny する。`--body-file -` と `-F -` は deny する。active run が無ければ、どれも通す(テスト)。
- A2-22: GitHub MCP の本文を書き込むツールに掛ける hook が、active run があるとき、本文の引数(`body` など)に `<!-- codiel:generated -->` が無ければ deny し、active run が無ければ通す(テスト)。`plugins/codiel/hooks/hooks.json` に、そのツール名に当たる matcher がある(grep)。
- A2-23: `plugins/codiel/references/github-writing.md` が「`<!-- codiel:generated -->` を本文に含める」の文を含む。`plugins/gh-utility/references/` の GitHub の執筆規則のファイルに `codiel:generated` の語が無い(grep)。

### 4.3 持続層(目的 3)

- A3-1: intent-sync が `STAGES` で test-loop と pr の間にあり、`GATED` に含まれる(テスト)。
- A3-2: intent-sync のスキルの SKILL.md が `docs/intents/domains/` と、持続層の 5 セクション(`## 目的` / `## 意図的な制約` / `## 非ゴール` / `## 由来` / `## 出典`)の見出しを含む(grep)。
- A3-3: `plugins/metatron/references/config-schema.md` の既定パス表に `docs/intents/domains/<領域>.md` を含む行がある(grep)。
- A3-4: `plugins/codiel/skills/reviewing-diffs/SKILL.md` に「持続層の意図的な制約に反する変更は severity high」という文言がある(grep)。
- A3-5: `plugins/codiel/references/intent-format.md` の持続層のセクションが次の固定文字列をすべて含む(grep)。「[ADR 候補: <領域名>-<連番>]」「(候補 ID: 」「ADR 候補 ID: 」「最大連番 + 1」「#### 背景」「#### 検討した選択肢」「#### 採用した結論」「#### 理由」「#### 影響範囲」「1 行 1 パス」。
- A3-6: intent-sync のスキルの SKILL.md が、`state.adrTarget` の値で `metatron`(番号参照だけ)と `intents`(`[ADR 候補]` の全文)を書き分ける手順を持つ(grep で `adrTarget` と `[ADR 候補]`)。
- A3-7: `codiel-state init` が `--adr-target <metatron|intents>` を必須とし、値を state の `adrTarget` に記録する(テスト)。
- A3-8: `plugins/codiel/README.md` に「metatron を導入すると init / update が `[ADR 候補]` を ADR へ移す」という記述があり、手動で移す手順のセクションが無い(grep で `[ADR 候補]` と `/metatron:init`)。`plugins/metatron/README.md` に持続層の走査の挙動の記述がある(grep で `docs/intents/domains`)。
- A3-9: metatron の CLI `scan-adr-candidates` が、`docs/intents/domains/` が無いとき・印付きエントリが無いときに空の `candidates` を返して 0 で終わり、印付きエントリがあるときは候補 ID つきで返す。ADR の本文に `ADR 候補 ID: <候補 ID>` の行が完全一致で存在するとき `adoptedAs` にその番号が入り、ADR のタイトルを候補と違うものに変えていても入る。候補 `frontend-1` に対し、`ADR 候補 ID: frontend-10` だけを持つ ADR では `adoptedAs` が `null` になる(テスト)。
- A3-10: `shrink-adr-candidate` が、候補 ID で特定したエントリだけを候補 ID を残した参照形に書き換え、0 で終わる。既に参照形なら何もせず 0 で終わる。エントリのハッシュが一致しない、ADR が無い、書き込みに失敗した、のいずれかでは何も書かずに終了コード 3 と `shrinkPending` を返す。同じファイルの 2 つの候補を順に縮約しても、先に縮約したエントリが印付きに戻らない。書き込み先が repoRoot の `docs/intents/domains/*.md` 以外なら拒否する。`stage-adr` と `commit-architecture` は持続層に触れず、候補を渡さない場合の挙動は変わらない(テスト)。
- A3-11: metatron の `capturing-architecture` と `updating-architecture` の SKILL.md が、`scan-adr-candidates` を呼んで候補を提示する手順を持つ(grep)。
- A3-12: `plugins/metatron/references/architecture-format.md` に `[ADR 候補]` の書式(候補 ID と `ADR 候補 ID:` の行の形を含む)の写しのセクションがあり、正本が codiel の `intent-format.md` であるという記述がある(grep)。両プラグインの `format-change-checklist.md` に互いを追随させる行がある(grep)。
- A3-13: codiel の intent-sync のスキルの SKILL.md が次の固定文字列をすべて含む(grep)。「最大連番 + 1」「縮約済みの ID も数える」「完全一致のトークン」「参照形のエントリは確定済み」「新しい候補 ID」。
- A3-14: `plugins/metatron/references/writing-discipline.md` が次をすべて満たす(grep)。「実測値など、指示を正当化するための根拠は削る」と「適用範囲や優先順位を判断する材料になる理由は、短く 1 か所にまとめて残す」の 2 文がある。「性質の違う例は削らない」の文がある。「極力簡潔に」が無く、「残す基準に当たる内容を保てる範囲で、最も短い文で書く」の文がある。強調の禁止、出力の形を示す例の明記、「やむを得ず禁止を書くときは」、見出しの概要や 1 文だけの指示を見出しの直下に書く規則、箇条書きで文脈が破綻する箇所を散文で書く規則の 5 つの文がある。引くための記述の例外のセクションがあり、効く範囲として ARCHITECTURE と rules の値を引く先のブロックを挙げ、GOTCHAS エントリには当てない文がある。`## 適用の強さ`・`## 例外の範囲`・`## GOTCHAS エントリ`・`## 何を ADR にするか`・`## 図の基準` のセクションが残っている。
- A3-15: `plugins/metatron/docs/format-change-checklist.md` に、`writing-discipline.md` を prompt-smith の規律に追随させるセクションがある(grep)。

### 4.4 並列化(目的 2 の後半)

- A4-1: `plugins/codiel/skills/writing-dev-plans/SKILL.md` の出力書式に `- 触るファイル:`、`- 前提ステップ:`、`## 環境準備`、`## 生成物` がある。同じファイルに、規約に定めが無ければ方式 b とする規則の文がある(grep)。
- A4-2: `codiel-state waves --slug <slug>` が stdout に JSON `{ "groups": [{ "steps": [...], "mode": "parallel" | "serial" }], "final": [...] }` を出す。`groups` はトポロジカル順に並ぶ。lockfile を触るステップは単独の `serial` グループになり、依存順の位置に置かれる。前提が `serial` のステップも、前提を含むグループより後に並ぶ。`parallel` グループの大きさは 4 以下である。方式 b の最終ステップは `final` にだけ現れる。触るファイルが重なる 2 ステップは同じグループに入らない。`src/app/**` と `src/apple/**` は重ならない。中括弧の glob は展開してから比べる。固定部が空の glob(`*.ts`・`**/*`)を持つステップは全ステップと重なる。循環依存があれば非ゼロで終了する(テスト)。
- A4-3: guard-write が、kind が `step` と `unit` の worktree の両方について、cwd が worktree 内のときと、cwd がメイン作業ツリーのルートで書き込み先が worktree 内のときの両方で、worktree ルート基準の相対パスで判定する。docRoot がメインルートのサブディレクトリのときも正しく照合する(テスト。§8.2 の worktree のケース)。
- A4-4: `plugins/codiel/skills/writing-test-specs/SKILL.md` の `spec.md` の書式に、`---` で囲む frontmatter と `parallel: true` の記述と、「無ければ直列」の文がある(grep)。

### 4.5 独立性

- A5-1: codiel の `src/` のうち `__test__/` 以外のファイルに、`metatron/src` を指す import が無い(grep)。
- A5-2: metatron の `src/` に、`codiel/src` を指す import が無い(grep)。持続層との連携はファイル契約だけで行う。
- A5-3: §6.10.1 の依存表の各行について、縮退先を定めた指示書または実装の箇所がある(計画書の各タスクで、該当ファイルの grep で確かめる)。「定める箇所」が「縮退不要(理由)」の行は判定の対象から外す。
- A5-4: metatron の既存テストが、`docs/intents/domains/` の無い一時リポジトリでも変更なしで通る(A3-9 の「ファイル無し」のケースと合わせて、codiel 未導入の環境で metatron の動作が変わらないことを確かめる)。

---

## 5. 全体像

```
/codiel:run [<Issue番号> | <intent パス> | 省略]
  └─ orchestrating-runs
       §0 前提確認・実行モード・連携モード(github | local)の判定
       [intent]      聞き取り(原文を ASIS / TOBE に記録)→ 現状調査 → 分岐の合意 → ドラフト全文提示
                     ★ゲート: 承認 + 規模(標準/軽量)+ 文書だけで終えるか + Issue 起票(github のみ)
                     → 開始時のブランチに intent 文書を書く → (任意)Issue 起票 → state 作成
                     → intent-only: 開始時のブランチにコミット → Raguel ゲート → close(completed)
                     → 続行: run ブランチ作成 → コミット → Raguel ゲート
       [discuss]     how の論点だけ(軽量では skip)
       [design]      持続層を読む(軽量では skip)
       [test-spec ∥ dev-plan]  軽量では intent と持続層から直接作る
       [implement]   wave ごとにステップを worktree で並列実装 → タスクレビュー → 順次マージ
       [test-loop]   Step A を unit ごとに並列、Step B を worktree 方式で並列
       [intent-sync] 受け入れ基準の変更と、途中で追記された原文を派生文のセクションへ反映する / 持続層を更新する → Raguel ゲート
       [pr]          github: push + gh pr create / local: 記録だけ
       [review]      git diff <base>...<run ブランチ>。原文の要望の未達と持続層の制約違反は high
       [fix-loop]    直列
       [triage]      github: Issue 起票 / local: status: proposed の intent 草案
       [finalize]    原文の要望ごとに 達成 / 未達 / 要確認 / 持ち越し を報告し、すべて達成なら status: done
```

持続層は `docs/intents/domains/` にあり、intent・design・review が読み、intent-sync だけが書く。intent-sync は test-loop と pr の間にあるため、持続層の変更は同じ run ブランチに入り、review の対象になる。

---

## 6. 各構成要素の設計

### 6.1 フェーズ

#### 6.1.1 フェーズ列と種別

コード上の `STAGES` を次の 12 ステージにする。

```ts
[["intent"], ["discuss"], ["design"], ["test-spec", "dev-plan"], ["implement"],
 ["test-loop"], ["intent-sync"], ["pr"], ["review"], ["fix-loop"], ["triage"], ["finalize"]]
```

| フェーズ | 実作業の担い手 | 入力 | 出力 | ゲート |
| --- | --- | --- | --- | --- |
| intent | オーケストレーター本体(対話)。現状調査は読み取りだけの委譲 | Issue 本文(任意)、既存 intent(任意)、ARCHITECTURE、GOTCHAS、持続層 | `docs/intents/YYYY-MM-DD-<slug>.md` | ユーザー承認の後に pass-gate(`evaluate_decision`) |
| discuss | 成果物を書く委譲(アジェンダ)+ 本体の進行 | intent | `agenda.md`、`discussion.md` | complete-phase |
| design | 成果物を書く委譲 | intent、`discussion.md`、持続層 | `design.md` | ウォークスルー後に pass-gate(`evaluate_design`) |
| test-spec | 成果物を書く委譲(決定 56) | `design.md`(軽量では intent と持続層) | `spec.md` / `cases.md` | pass-gate(`evaluate_plan`) |
| dev-plan | 成果物を書く委譲 | `design.md`(軽量では intent と持続層) | `dev-plan.md` | `codiel-state waves` の成功を確かめた後に pass-gate(`evaluate_plan`) |
| implement | 成果物を書く委譲をステップごとに並列 | `dev-plan.md` | コード diff | 全 wave の後に pass-gate(`evaluate_code`)を 1 回 |
| test-loop | 成果物を書く委譲を unit ごとに並列 | `cases.md` | `scripts/`、`test-run-<n>.md`、修正 diff | pass-gate(`evaluate_code`) |
| intent-sync | 成果物を書く委譲 | intent、承認済みの受け入れ基準変更、追加の要望(原文。intent に追記済み)、持続層 | intent の派生文のセクションと変更履歴、`docs/intents/domains/<領域>.md` | pass-gate(`evaluate_design`) |
| pr | オーケストレーター本体 | 各成果物 | github: PR / local: state の記録 | complete-phase |
| review | 読み取りだけの委譲(観点ごと) | `git diff <base>...<branch>`、intent、`design.md`(軽量では intent と `dev-plan.md`)、specs、持続層 | `reports/review-<n>.md` | complete-phase |
| fix-loop | 現行どおり(直列) | `review-<n>.md` の critical / high | 修正 diff | pass-gate(`evaluate_code`) |
| triage | オーケストレーター本体 | `review-<n>.md` の medium / low | github: Issue / local: intent 草案 | complete-phase |
| finalize | オーケストレーター本体 | 全成果物、intent の原文のセクション | 結果レポート(原文の要望ごとの「達成 / 未達 / 要確認 / 持ち越し」を含む。§6.3.6)、intent の `status` | `codiel-state finalize` |

- `GATED` は intent / design / test-spec / dev-plan / implement / test-loop / intent-sync / fix-loop の 8 フェーズにする。
- guard-write の `DOC_PHASES` に intent と intent-sync を加え、init を除く。`docs/intents/**` の扱いは §6.8 に置く。
- フェーズの途中で人に確認するときは、`codiel-state mark-ask <phase> --slug <slug> --kind confirm` で run を `awaiting_human` にしてから確認し、答えを得たら `resume` で戻す。stop-guard(`stop-guard.ts`)は `active` の run でのセッションの停止を block するので、`active` のまま応答を待つと止まれないためである。`evaluationId` は無くてよい(`codiel-state.ts:381-391`)。例外は、run を作る前に確認を済ませる intent フェーズの手順 5 の (1)〜(3) と、(6) の保存に失敗して run を終端にしてから確かめる場合(決定 68)である(§6.1.2)。
- `--kind` は確認の種類を表す。Raguel の ASK は `raguel`(既定)、人への確認の一般則は `confirm` を使う。値はフェーズの `askKind` に記録され、ゲートの記録(`raguel`)と区別できる(§6.2.2)。
- finalize で `mark-ask` → `resume` を行うと、`phases.finalize` が `in_progress` になる。finalize はもともと `start-phase` しないフェーズだが、この遷移は許容する。`codiel-state finalize` は finalize 自身を検査から外す(`codiel-state.ts:453-457`)ので、`in_progress` のままでも成立する。

#### 6.1.2 intent フェーズの手順

sandalphon `capturing-intent` の手順(`plugins/sandalphon/skills/capturing-intent/SKILL.md:20-118`)を移植し、run の開始手順と結合する。聞き取りには AskUserQuestion が要るため、intent フェーズの対話はオーケストレーター本体が行う。Issue の読み取りも本体が行う。intent 文書の本文はユーザーが承認したドラフトの保存であり、`discussion.md` と同じく合意の記録として本体が書く。

0. 聞き取り・書き込み・起票のどれよりも前に、ほかの run が active でないことを確かめる。active / awaiting_human の run があれば、`finalize` か `codiel-state stop` で終端にしてから始める(現行 `orchestrating-runs/SKILL.md:102-104` の検査を、ここへ前倒しする)。ただし、入口の intent パスの frontmatter `run` に当たる run と、ユーザーが今回再開すると答えた run は終端にせず、§6.2.5 の再開手順へ進む。終端にする run は、その前に内容(slug・intent のパス・現在のフェーズ)をユーザーに示して確かめる(決定 62)。これで、手順 5 の (1)〜(3) の間は active run が無いことが保証される。
1. §0 の前提確認と連携モードの判定を行う(§6.5)。続けてベースブランチの名前を解決し、`git switch <ベース> && git pull --ff-only` で最新化する。聞き取りの前へ移すのは、現行 `orchestrating-runs/SKILL.md:110-116`(ベース名の解決と switch / pull)だけである。`:117-121`(`codiel-state init` と `git switch -c`)は承認後の手順 5 に置く。本設計では、このベースブランチを「開始時のブランチ」と呼ぶ。intent フェーズの間は、開始時のブランチの作業ツリーで intent 文書を書く。
2. 入口の引数で分岐する。
   - Issue 番号: github モードでは `gh issue view`、読めなければ GitHub MCP の読み取りで本文とコメントを得る。local モードではユーザーに本文を貼ってもらう。本文を原文にするか派生にするかは、本文にあるマーカーで決める(§6.3.5)。正本は以後 intent になる。
   - intent パス: frontmatter の `run` に対応する未終端の run があれば、その run を §6.2.5 の再開手順で続ける。無ければ、記載済みの内容を確定扱いにして聞き取りの不足分から始める。
   - intent パスで frontmatter が `intent: v1` のとき: v2 へ昇格して再開する。v1 の `## ASIS` / `## TOBE` をそれぞれ `## 現状調査` / `## 要求` へ移す(§6.3.3 の変換の例)。既存のセクションは確定済みとして扱い、不足する原文の `## ASIS` / `## TOBE` と、`## 目的` と `## 意図的な制約` だけを聞き取る。原文はユーザーに尋ねて、ユーザーの言葉のまま埋める。昇格したドラフトを全文提示し、承認ゲートを取り直す。保存は元のパスへの上書きとし、`## 変更履歴` に v1 からの昇格を 1 行記録する。
   - 省略: 「何を達成したいか」から聞く。
3. 既存 intent との重複確認、ゴールと現状の聞き取り、現状調査、分岐の合意を、移植元の手順 2〜5 のとおり行う。
   - 最初の依頼と聞き取りでの回答は、原文のセクションにそのまま記録する(§6.3.3)。ユーザーが語った現状は `## ASIS` に、それ以外(ゴール、完了の条件、今回やらないこと、制約の希望)は `## TOBE` に入る。聞き取りの 4 観点の回答は、すべてどちらかに入る。
   - ユーザーが現状について何も語っていなければ、1 問だけ、ユーザーの言葉で現状を尋ね、答えを `## ASIS` に記録する。この問いはユーザーが感じている現状を聞くものであり、コードを読んで書く `## 現状調査` とは別である。コードの実装がどうなっているかは問いにしない。
   - 現状調査はユーザーに聞かずコードと文書を読んで行い、`## 現状調査` に書く。関係する領域の持続層(§6.4)も読む。
   - `## 要求`・`## 非スコープ`・`## 意図的な制約` などの派生文のセクションは、原文から派生させる。`## 受け入れ基準` は `## 要求` から派生させる。
   - 原文は原語のまま記録し、翻訳しない。移植元の、intent 文書と Issue 本文の言語を揃える手順(`plugins/sandalphon/skills/capturing-intent/SKILL.md:96-97`)は、派生文のセクションにだけ当てる。
4. ドラフトを全文提示し、承認ゲートで §6.1.3 の 3 項目を同時に決める。Issue から取り込んだ原文の記録(本文と人のコメント)のうち、原文から除くものがあれば、ユーザーがこのゲートで選ぶ。除いた記録は原文に入れない。
5. 承認後、次の (1)〜(6) をこの順に行う。git の操作と Raguel MCP の呼び出しはオーケストレーター、`codiel-state` の各コマンドは CLI が行う。ユーザーへの確認はすべて (3) までに済ませ、(4) の `init` から `start-phase intent` までは確認を挟まずに一気に進める。この区間は phase が `null` の active run になり、stop-guard(`stop-guard.ts`)が active の run でのセッションの停止を block するので、ユーザーの応答を待って止まれないためである。

   (1) 開始時のブランチの作業ツリーに intent 文書を Write で書く。frontmatter `run` には slug を入れる。

   (2) Issue 起票を選んだときだけ、gh-utility `issue-craft` を持ち込みモードで起動して起票し、番号を intent の frontmatter `issue` に書く。

   (3) intent 以外の未コミットの変更があるかを確かめ、あればユーザーに示して扱いを決めてもらう。分岐ごとの扱いは次のとおりである。
   - 終える(intent-only)とき: intent 以外の変更には触れず、作業ツリーに残すことを告げる。
   - 続行するとき: `git switch -c` が stage 済みの intent もほかの未コミットの変更も新しいブランチへ持ち越し、持ち越した変更が pr フェーズ前の `git status --short` の確認(`orchestrating-runs/SKILL.md:166-168`)で止まることを示す。そのうえで退避するかを確認する。退避するなら `git stash push -m <タグ> -- <intent 以外のパス>` をパスを指定して使う。`git stash -u` は intent も持っていくので使わない。自動では退避しない。退避はこの (3) の中で済ませる。

   (4) `codiel-state init --slug <slug> --intent <パス> [--issue N] --base-branch <開始時のブランチ> --domain-mode <モード> --integration <モード> --scale <standard|light> --adr-target <metatron|intents> --image-upload <gh-attach,chrome の組み合わせ|none> [--intent-only]` を実行する。`branch` は CLI が決める。`--intent-only` なら `null`、それ以外は `codiel/<slug>-try-<n>` である。

   (5) `git add -- <intent パス>` で intent 文書だけを stage する。未追跡のファイルでもパスを限定したコミットができるようにするためである。

   (6) 承認ゲートの「文書だけ残して終えるか」(§6.1.3)で分岐する。どちらの分岐も、ユーザーへの確認を挟まずに進める。`git commit` が「変更なし」で失敗したときは、そのコミットを飛ばして進む。`git switch -c` が失敗したとき、または `git commit` がそれ以外の理由で失敗したときは(決定 68)、intent フェーズがまだ `pending` で `mark-ask` できない(決定 61)ので、`codiel-state stop --slug <slug> --reason commit-failed` で run を終端にしてから、失敗の出力と intent のパスを示してユーザーに確かめる。続行の分岐で失敗したときは、先に開始時のブランチへ戻る。この停止では intent の `status` を変えない(§6.3.2)。
   - 終える(intent-only)とき:
     1. 開始時のブランチで `git commit -m "codiel(intent): <要約> (<slug> try-<n>)" -- <intent パス>` を実行する。
     2. `codiel-state start-phase intent --slug <slug>` を実行する。
     3. `evaluate_decision` を呼ぶ。
     4. `codiel-state pass-gate intent --slug <slug>` を実行する。
     5. `codiel-state close --slug <slug> --reason intent-only` を実行する。phase は `close` まで `intent` のままである。run ブランチは作らない。
   - 続行するとき:
     1. `git switch -c <state.branch>` を実行する。
     2. `git commit -m "codiel(intent): <要約> (<slug> try-<n>)" -- <intent パス>` を実行する。
     3. `codiel-state start-phase intent --slug <slug>` → `evaluate_decision` → `codiel-state pass-gate intent --slug <slug>` の順に進め、以降のフェーズへ移る。

   補足は次のとおりである。

   - (1)〜(3) の間は active run が無い(手順 0 で保証する)。guard-write は active run が無いとき全面的に pass する(`guard-write.ts:104-105`)ので、(1) の書き込みはもともと妨げられない。(2) の起票も run の作成前なので、guard-bash の `gh issue create` の制限(`guard-bash.ts:164-168`)に掛からない。stop-guard も active run が無いので、(1)〜(3) でユーザーの応答を待って止まれる。
   - (4) の後から `start-phase intent` までは、active run の `phase` が `null` である。この間に intent 文書を直す必要が出ても、guard-write が `docs/intents/*.md` を phase `null` で通す(§6.8)。
   - `evaluate_decision` が ASK を返したときは、現行どおり `mark-ask` で run を `awaiting_human` にしてから人の裁定を待つ。stop-guard は `active` の run だけを block するので、この待ちは妨げられない。
6. 前の try がある run(try-2 以降)では、新しい run ブランチは開始時のブランチから切る。実装の途中で止まった run の intent は前の try の run ブランチにしか無いため、手順 5 の (1) で新規に書かず、`git checkout <前の try のブランチ> -- <intent パス>` で同じパスに持ち込む。文書だけで終えた intent は開始時のブランチにコミット済みなので、持ち込みは要らない。前の try が `commit-failed` で止まったときは、作業ツリーに残した intent をそのまま使い、前の try のブランチから持ち込まない(決定 68)。そのブランチには intent のコミットが無く、開始時のブランチに古い版があれば、持ち込みが承認済みの新しい版を上書きするためである。

#### 6.1.3 承認ゲートで決める 3 項目

| 項目 | 選択肢 | 決めた後の動き |
| --- | --- | --- |
| 規模 | 標準 / 軽量 | state の `scale` に記録する |
| 文書だけ残して終えるか | 続行 / 終える | 終えるときは intent 文書を開始時のブランチにコミットし、intent の `pass-gate` の後に `codiel-state close --slug <slug> --reason intent-only` で run の `status` を `completed` にする。run ブランチは作らない。intent の `status` は `approved` のまま残す(§6.1.2 の手順 5 の (6)) |
| Issue 起票 | する / しない | github モードで、入力に Issue が無いときだけ選択肢に出す。起票した番号を `init --issue` と intent の frontmatter `issue` に記録する |

- `close` は新設のコマンドである。intent が `passed` で、`state.branch` が `null` で、それ以外のフェーズがすべて `pending` のときだけ成功し、`status` を `completed` にする。outcome の自動同期は `pr.url` も run ブランチも無い run を扱わないため、`awaiting_outcome` を経由させない。
- 文書だけで終えた intent は開始時のブランチにあるため、後でパスを渡せば新しい try として実装を始められる。開始時のブランチへの push は codiel が行わない。
- 起票は外部公開行為であり、持ち込みモード側でも全文提示と明示承認を経る(`plugins/sandalphon/references/handoff-contract.md:25`)。
- local モードでは Issue 起票を選択肢に出さず、理由を 1 行添える(移植元 `plugins/sandalphon/references/sandalphon-common.md:31-52` の「畳む経路」の規律を継ぐ)。

#### 6.1.4 軽量の経路

- 軽量では discuss と design を `skip-phase` で飛ばす。`SKIPPABLE` に discuss と design を加え、`skip-phase` はこの 2 フェーズについて `state.scale === "light"` のときだけ成功する。
- test-spec と dev-plan は `design.md` の代わりに intent と持続層を入力にする。`writing-test-specs` と `writing-dev-plans` に「`design.md` が無い run では intent の `## 受け入れ基準` と `## 実装方針`、関係する領域の持続層を入力にする」規則を足す。
- review は `design.md` の代わりに intent と `dev-plan.md` を設計の入力にする(§6.5.2)。
- implement 以降は標準と同じである。review を飛ばす経路は持たない。

#### 6.1.5 discuss の範囲

`preparing-design-agendas/SKILL.md:69-103` の「合意済み事項の継承」を、`issue.md` の `## 原文` ではなく intent の `## 合意済み事項` と `## 意図的な制約` を読む形に書き換える。論点は how(実現方法)に限り、what(達成すること・受け入れ基準)は intent で合意済みとして立てない。

#### 6.1.6 `issue.md` を読んでいたスキルの入力を intent へ替える

| スキル | 変更 |
| --- | --- |
| `preparing-design-agendas` | 入力を intent に。§6.1.5 |
| `writing-design-docs` | 入力を intent + `discussion.md` に。持続層の制約を設計の前提として読む |
| `writing-test-specs` / `writing-dev-plans` | 軽量のとき intent と持続層を入力に(§6.1.4) |
| `reviewing-diffs` | 受け入れ基準の出所を intent に。軽量の入力(§6.5.2) |
| `facilitating-design-discussions` | `issue.md` への言及を intent へ |

`analyzing-issues` スキルと `codiel-analyst` Agent は、担っていた init フェーズが無くなり、Issue の読み取りも intent フェーズの本体が行うため削除する。

### 6.2 run state v2

#### 6.2.1 フィールド

| フィールド | v1 | v2 |
| --- | --- | --- |
| `version` | `1` | `2` |
| `runId` | `issue-<N>` | `<slug>` |
| `issue` | `number`(必須) | `number \| null`(任意) |
| `intent` | なし | intent 文書の repoRoot 相対パス(必須) |
| `branch` | `codiel/issue-<N>-try-<n>` | `string \| null`。`init` は承認ゲートの後に呼ばれるため、そこで値を決める。`--intent-only` のときは `null`(run ブランチを作らない)、それ以外は `codiel/<slug>-try-<n>` |
| `raguelRunId` | `issue-<N>-try-<n>` | `<slug>-try-<n>` |
| `integration` | なし | `"github" \| "local"`(必須) |
| `scale` | なし | `"standard" \| "light"`(必須) |
| `pr` | `{ url: string \| null }` | 同じ。local では `null` のまま |
| `implement` | なし | `{ steps: Record<string, StepState> }`(任意。M4 で追加。§6.6.5) |
| `imageUpload` | なし | `{ ghAttach: boolean, chrome: boolean }`(必須。M2 で追加)。画像を GitHub に載せる手段が使えるか(§6.12.4) |
| `adrTarget` | なし | `"metatron" \| "intents"`(必須。M2 で追加し、M3 から使う)。ADR の 3 条件を満たす判断の書き先(§6.4.3) |

`adrTarget` は、§0 の既存の解決で `readDomainsResult` が `unreadable: "architecture_missing"` を返した(`resolveDocPaths` が解決した ARCHITECTURE のパスにファイルが無い)ときに `intents`、それ以外で `metatron` とする。metatron の未導入と未初期化は、どちらも ARCHITECTURE が無いので同じ分岐になる。

既存の `domainMode` では代えられない。`unscoped` は `block_missing`(ARCHITECTURE はあるがドメインマップが無い)や `invalid_json` からも選ばれ(`orchestrating-runs/SKILL.md:80-88`)、ARCHITECTURE の有無と 1 対 1 に対応しないためである。値は run の開始時に決めて固定し、resume 時に ARCHITECTURE の有無が変わっていても記録を正とする。途中で metatron を導入した場合、その run の ADR 候補は `intents` に書かれ、次の `/metatron:update` の走査で ADR へ移る(§6.11)。

`imageUpload` は §0 で連携モードと同時に判定する。`integration` が `local` なら両方 `false` とする。`github` のときは次のとおりにする。判定の後は run の間固定し、resume 時の扱いは連携モードと同じにする(§6.5.1)。

- `ghAttach`: 環境判定スクリプトが返す `gh` のバージョンが 2.99.0 以上で、かつ `origin` のホストが `github.com` か `*.ghe.com` のときだけ `true`。それ以外のホスト(GHES)では、バージョンにかかわらず `false`。
- `chrome`: セッションで `mcp__claude-in-chrome__*` のツールが使えるなら `true`。

連携モードのような 1 値の列挙にせず 2 つの真偽値で持つのは、縮退の順序が文書の種類で違うためである。Issue・PR・コメントは `ghAttach` を先に、レビュー本文は `chrome` を先に試す(§6.12.4)。

その他のフィールド(`try` / `status` / `phase` / `phases` / `limits` / `stopReason` / `incidents` / `baseBranch` / `domainMode` / `domain`)は現行のまま残す。

#### 6.2.2 CLI

- すべてのコマンドの run 指定を `--issue <N>` から `--slug <slug>` に替える。
- `init` は `--slug` / `--intent` / `--integration` / `--scale` / `--adr-target` / `--image-upload` を必須、`--issue` と `--intent-only` を任意とする。`--intent-only` を付けると `branch` を `null` にする。
- `branch` が `null` の run では、`start-phase` は intent 以外を拒否する。run ブランチを持たないまま実装系のフェーズへ進ませないためである。
- `runDir` は `.codiel/runs/<slug>`。`findActiveRun` と `get --active` はディレクトリ名のパターンで絞らず、`runs/` 直下のディレクトリをすべて走査し、`version: 2` の state だけを run として扱う。例外として、`get --active` は `version: 1` で `awaiting_outcome` の run も `runs` に含める(決定 63)。
- `complete-phase pr` の `--pr-url` 必須は `integration === "github"` のときだけにする。
- `close`(§6.1.3)、`step-add` / `step-update` / `waves`(§6.6)を足す。
- `mark-ask` に `--kind raguel|confirm` を足す。省略時は `raguel` とし、既存の呼び出しの意味を変えない。値はフェーズの `askKind` に記録する。`raguel` と `confirm` 以外は拒否する。`resume` は `askKind` を消さず、記録として残す。`mark-ask` は `in_progress` のフェーズと `pending` の finalize だけを受け付け、終端の run・passed のフェーズ・finalize 以外の `pending` のフェーズを拒否する(決定 61)。
- `stop --reason` の値のうち `intent-updated` を、intent を続ける停止として扱う(§6.3.2)。CLI は値を記録するだけで、intent の `status` は変えない。

#### 6.2.3 slug の制約

- slug は ASCII の英小文字ケバブケース `^[a-z0-9]+(-[a-z0-9]+)*$` とし、最大 40 文字とする。`raguelRunId = <slug>-try-<n>` は try が 5 桁でも 50 文字で、Raguel の 64 文字に収まる。
- 同日に同じ slug の intent が既にあるときは `-2`、`-3` を付す。ファイル名は `YYYY-MM-DD-<slug>-2.md` の形になる。
- run の slug は接尾辞を含めたファイル名の slug に揃え、`.codiel/runs/<slug>/` の衝突を避ける。接尾辞を足しても 40 文字を超えないよう、聞き取りで決める slug はその分を残す。
- `^issue-\d+$` に一致する slug は禁止する。v1 の run ディレクトリ名(`issue-<N>`)と v2 の run ディレクトリが同じ名前にならないようにするためである。
- `init` は書式・長さ・禁止の形に反する slug を拒否する。

#### 6.2.4 version 1 の扱い

- v2 の CLI と hook は、`version: 1` の state を持つ run ディレクトリを active run として扱わない。hook の挙動は run が無いときと同じになる。
- `get --active` は v1 の `active` / `awaiting_human` の run を `runs` に含めず、見つけたら run ごとに次の文言を stderr に出す。v1 の `awaiting_outcome` の run は `runs` に含め、文言を出さない。outcome の同期で記録して終端にするためである(決定 63)。同期では、v1 の state に無い `integration` を github として扱い、PR の URL(`pr.url`)と evaluationId(`phases.<fix-loop|test-loop|implement>.evaluationId`)は v2 と同じ場所から読む。
- `--slug issue-<N>` で v1 の run を直接指したときは、`get` と `stop` だけを受け付け、ほかのコマンドは非ゼロで終了して同じ文言を stderr に出す。例外は、`awaiting_outcome` の v1 の run への `record-outcome` と、`completed` / `rejected` の v1 の run への `record-outcome --outcome incident` である(v2 と同じ扱い)。state は version 1 のまま書き戻す。`issue-<N>` の形は v2 の slug として禁止しているので(§6.2.3)、この形で指せるのは v1 の run だけである。

文言のテンプレート。`<N>` と `<status>` を実際の値に置き換えて出す。

```
codiel: .codiel/runs/issue-<N> は codiel 0.x の run(state version 1、status: <status>)であり、この版では再開できない。codiel 0.x で完了させるか、`codiel-state stop --slug issue-<N> --reason migrate` で止めてから、`/codiel:run <N>` で新しい run を始める。
```

#### 6.2.5 再開

`orchestrating-runs` §6 の再開手順を、`--slug <slug>` と intent の frontmatter `run` からの逆引きに替える。resume 時には連携モードを再判定し、state の記録と違えば人に確認する(§6.5.1)。

### 6.3 変更ごとの intent(書式 v2)

#### 6.3.1 置き場と命名

現行どおり `docs/intents/YYYY-MM-DD-<slug>.md`。基準は `repoRoot` で固定し、設定を持たない(`plugins/metatron/references/config-schema.md:91`)。slug の規則は §6.2.3 に従う。

#### 6.3.2 frontmatter

| キー | 必須 | 値 |
| --- | --- | --- |
| `intent` | 必須 | `v2` |
| `slug` | 必須 | ファイル名の slug |
| `created` | 必須 | `YYYY-MM-DD` |
| `status` | 必須 | `proposed` / `approved` / `in-progress` / `done` / `abandoned` |
| `run` | 必須(値は空でよい) | runId(= slug)。run を作るまでは空 |
| `issue` | 任意 | Issue 番号または URL |
| `domains` | 任意 | 持続層の領域名の YAML 配列。1 行のフロー形式 `domains: [frontend, data]` で書く |

- 平坦なキーを行単位で読む現行の解析規則(`intent-format.md:21-26`)を継ぐ。現行は「リストは解釈しない」と定めるため、v2 では `domains` だけを例外とし、値が `[` で始まり `]` で終わる 1 行のフロー形式を配列として読む規則を加える。ブロック形式(`- ` で始まる複数行)は書かない。
- `status` の意味と遷移させる主体は次のとおり。遷移をスクリプトで検証しない方針も継ぐ(`intent-format.md:89`)。

| status | 意味 | 主体 |
| --- | --- | --- |
| `proposed` | triage が local モードで書いた草案。未承認 | triage |
| `approved` | 承認ゲートを通過して保存された。文書だけで終えた run もこの値のまま残る | intent フェーズ |
| `in-progress` | run が implement に入った | implement の開始時 |
| `done` | 持ち越しを除く原文の要望が、finalize の判定ですべて達成だった | finalize |
| `abandoned` | run を止め、この intent を続けない | `stop` の後にオーケストレーターが更新する。ただし `stop --reason intent-updated` と `stop --reason commit-failed`(§6.1.2 手順 5 の (6))のときは例外とし、`abandoned` にしない |

- intent-sync より後の要望を「この run に含める」と決めて止めるときは(§6.3.4)、`codiel-state stop --slug <slug> --reason intent-updated` を使う。この値の停止では intent を `abandoned` にせず、`in-progress` のまま残し、新しい try で intent から再開する。
- `done` は intent-sync ではなく finalize が付ける。finalize の判定(§6.3.6)で、持ち越しを除く原文の要望がすべて「達成」のときだけ `done` にする。「未達」か「要確認」が 1 つでも残れば `in-progress` のままにし、結果レポートに残りを示す。
- finalize が intent を更新したら、run ブランチへコミットする。github モードでは続けて push し、PR に反映させる(finalize は guard-bash が push を許すフェーズである。`guard-bash.ts:174-182`)。local モードでは push しない。この更新・コミット・push は、`codiel-state finalize`(run を `awaiting_outcome` にする)を呼ぶ前に済ませる。
- `done` は run ブランチ上の値であり、PR がマージされて初めて base に現れる。PR が閉じられたとき base には intent が現れないため、base 側で `done` と実態が食い違うことは無い。

#### 6.3.3 本文のセクション

ユーザーの要望(raw human intent)は、現状調査・要求・受け入れ基準・設計・実装のすべての派生元であり、派生文は解釈のロスを含みうる。そこで書式 v2 は、ユーザーの言葉を原文のまま記録するセクション(原文のセクション)と、AI が原文から派生させたセクション(派生文のセクション)を分ける。完了判定の最高権威は原文のセクションである(§6.3.6)。

原則を次のとおり定め、書式の正本(`intent-format.md`)の本文に載せる。

> 原文になるのは、人が自分で書いた・語った言葉だけである。AI が生成した文は、どの経路を通っても原文にしない。v1 intent の `## ASIS` / `## TOBE`、v2 の派生文のセクション、codiel が起票した Issue、レビュー所見、要約は、AI が生成した文に当たる。

書式 v2 のセクションと順序は次のとおりで、これで確定する。

```markdown
# intent: <一行で表したゴール>

## ASIS
## TOBE
## 目的
## 現状調査
## 要求
## 受け入れ基準
## 実装方針
## 意図的な制約
## 合意済み事項
## 非スコープ
## 未確定事項
## 変更履歴
## 出典
```

| セクション | 種類 | 内容 |
| --- | --- | --- |
| `## ASIS` | 原文 | ユーザーが語った現状を、原文のまま記録する |
| `## TOBE` | 原文 | 現状以外のユーザーの言葉すべて(ゴール、完了の条件、今回やらないこと、制約の希望)を、原文のまま記録する |
| `## 目的` | 派生文 | TOBE を達成したい理由 |
| `## 現状調査` | 派生文(原文からの派生と明記する) | AI がコードと文書を読んで調べた、intent に関係する範囲の現状。v1 の `## ASIS` の役割 |
| `## 要求` | 派生文(原文からの派生と明記する) | AI が原文を要求 1 件 1 行に整理したもの。v1 の `## TOBE` の役割 |
| `## 受け入れ基準` | 派生文 | `## 要求` から派生させた、機械的に YES/NO を判定できる基準 |
| `## 実装方針` 〜 `## 未確定事項` | 派生文 | v1 と同じ |
| `## 変更履歴` | 記録 | 日付・変更したセクション・変更内容・承認の経路(ASK の evaluationId 等)を 1 行ずつ追記する。保存時は「なし」 |
| `## 出典` | 記録 | 最後のセクション。本文が引いた引用・出典をまとめる。無ければ「なし」(§6.12.2) |

原文のセクション(`## ASIS` と `## TOBE`)の規則は次のとおりである。

- 記録するのは、人が書いた・語った言葉である。最初の依頼、聞き取りでの回答、人が書いた Issue の本文とコメントが当たる(Issue の扱いは §6.3.5)。
- `## ASIS` にはユーザーが語った現状を、`## TOBE` にはそれ以外の言葉すべてを入れる。今回やらないことも `## TOBE` に記録する。聞き取りの 4 観点の回答は、すべてどちらかに入る。
- 要約・言い換え・並べ替え・翻訳をしない。原文のまま、原語で記録する。
- 各記録の前に、日付・話者・出所の行を置く。Issue から取り込んだ記録は、Issue の作成者やコメントの書き手を話者とし、出所に URL を書く。
- run の途中でユーザーが言葉を足したら、どのフェーズでも即座に、日付・話者・出所の行つきで末尾に追記する。ユーザー自身の言葉なので承認は要らない。既存の原文は書き換えない。追記の後の扱いは §6.3.4 に従う。
- ユーザーが現状について何も語っていなければ、聞き取りで 1 問だけ、ユーザーの言葉で現状を尋ねる。答えを `## ASIS` に記録する。この問いはユーザーが感じている現状を聞くものであり、コードを読んで書く `## 現状調査` とは別である。
- 原文のセクションには、執筆規則の削る基準も文の組み立ての規則も当てない(§6.12.2)。
- 原文を書き換えない・要約しない規律は、AI 側で守る。hook は原文の中身を検査しない(§6.8)。

原文がまだ無いセクションは、本文を置かずに見出しと次の 1 行だけにする。

```markdown
## ASIS
<!-- codiel:unrecorded -->
```

この行(未記録のマーカー)は、書式上の不足セクションを表す。triage が local モードで書く草案(§6.5.2)が当たる。run を始めるときの聞き取りで、マーカーを原文の記録に置き換える。この置き換えは、原文が無かった所に最初の原文を置く操作であり、「既存の原文を書き換える」には当たらない。

持ち越しの注記は、原文の記録の直後に次の 1 行を足す形とする(§6.3.4)。値は例であり、実際の日付と try に置き換える。記録の本文には手を入れない。

```markdown
[2026-10-05 / ユーザー / fix-loop 中の追加]
> 画面の右上にも保存状態を出してほしい
[持ち越し 2026-10-05 / try-1 / この run に含めないとユーザーが決めた]
```

原文のセクションの記録の形を示す。値は例であり、実際の日付・話者・出所・発言に置き換える。

```markdown
## TOBE

[2026-10-01 / ユーザー / 最初の依頼]
> ログインしたまま 1 日放置しても、作業中の画面が消えないようにしたい

[2026-10-01 / @alice(Issue #12 の作成者)/ Issue 本文]
> セッション切れで入力フォームの内容が消える
```

派生文のセクションの規則は次のとおりである。

- `## 現状調査` と `## 要求` の冒頭に、原文のセクションからの派生であることを書く。
- `## 現状調査` はユーザーに聞かず、AI がコードと文書を読んで書く(capturing-intent の「ASIS はユーザーに聞かず自分で読む」の規律を、このセクションへ付け替える)。
- `## 受け入れ基準` は `## 要求` から派生させる。
- `## 意図的な制約` は「制約: 理由」の対で書く。内容が無ければ「なし」と書き、見出しは残す。

v1 から v2 への変換の例を 1 組示す。値は例である。

v1:

```markdown
## ASIS
- セッションの有効期限は `src/auth/session.ts` で 30 分に固定されている
## TOBE
- 無操作でも作業中の入力を失わない
```

v2(昇格後):

```markdown
## ASIS
[2026-10-02 / ユーザー / 昇格時の聞き取り]
> 30 分くらい席を外すと、書きかけの内容が全部消えてしまう

## TOBE
[2026-10-02 / ユーザー / 昇格時の聞き取り]
> 放置しても書きかけの内容が残ってほしい

## 現状調査
原文のセクション(`## ASIS` / `## TOBE`)からの派生である。
- セッションの有効期限は `src/auth/session.ts` で 30 分に固定されている

## 要求
原文のセクション(`## ASIS` / `## TOBE`)からの派生である。
- 無操作でも作業中の入力を失わない
```

v1 の `## ASIS` と `## TOBE` の本文は、そのまま `## 現状調査` と `## 要求` へ移る。原文の `## ASIS` と `## TOBE` は、昇格時の聞き取りでユーザーに尋ねて埋める(§6.1.2)。

#### 6.3.4 実装中の受け入れ基準の変更と、途中の要望

現行どおり、受け入れ基準を変える必要が出たら Raguel の ASK と同じ扱いで人に確認する。承認された変更は、その場では intent を書き換えず `reports/` の記録に残し、intent-sync で本文へ書き戻して `## 変更履歴` に 1 行加える。書き換えを intent-sync に寄せるのは、派生文の変更を 1 回のコミットにまとめて review に見せるためである。

ユーザーが run の途中で言葉を足したときは、次のとおりにする。

1. どのフェーズでも、その場で原文のセクションの末尾へ日付・話者・出所の行つきで追記する(§6.3.3)。承認は要らない。書き込めるのは、hook が `state.intent` のファイルをすべてのフェーズで通すためである(§6.8)。
2. 追記したのが intent-sync より前なら、派生文のセクション(要求・受け入れ基準など)への反映は intent-sync で行う。反映の内容は人に確認してから書く(`mark-ask --kind confirm`。§6.1.1)。
3. 追記したのが intent-sync より後なら、`mark-ask --kind confirm` で `awaiting_human` にしてから、この run に含めるかをユーザーに確認する。
   - 含めないとき: 原文の記録の直後に持ち越しの注記(§6.3.3)を付ける。finalize はこの記録を達成の判定から外し、結果レポートに「持ち越し」として示す。
   - 含めるとき: この run を `codiel-state stop --slug <slug> --reason intent-updated` で止め、新しい try を intent から始める(§6.1.2 の手順 6。前の try のブランチから intent を持ち込む)。intent は `abandoned` にせず、`in-progress` のまま残す(§6.3.2)。

#### 6.3.5 intent-issue の本文

Issue 起票(§6.1.3)の本文は現行の intent-issue 書式(`intent-format.md:93-116`)を v2 のセクションに合わせ、マーカーを `<!-- intent:v2 -->` にする。原文のセクション(`## ASIS` / `## TOBE`)も、日付・話者・出所の行を含めてそのまま転記する。

codiel が起票する Issue には、`<!-- intent:v2 -->` とは別に、次の識別マーカーを本文に置く。triage の Issue と、intent 承認時の任意の起票の両方が当たる。

```markdown
<!-- codiel:generated -->
```

投稿する側の規則は次のとおりである(決定 53)。

- run が active な間に GitHub へ本文を投稿する操作は、すべてこのマーカーを本文に含める。起票に限らない。対象は Issue の作成・編集・コメント、PR の作成・編集・コメント・レビュー本文である。
- マーカーはスキルの規律で付け、hook で強制する(§6.8)。付け忘れた投稿は deny され、マーカーを付けて投稿し直すことになる。
- 人のアカウントから投稿されても、run が active なセッションで投稿された本文は AI が生成した文として扱われる。読み取る側が原文から除けるのはこのためである。
- codiel を通さない投稿(run が active でないセッション、別のツール)は追わない。
- intent の承認時の任意の起票(§6.1.2 の手順 5 の (2))は run の作成前に行うので hook は掛からないが、スキルの規律でマーカーを付ける。

Issue を入口にしたときの扱いは、本文のマーカーで決める。読み取る側の規則(マーカー付きの本文やコメントと bot のコメントは原文から除く)は変えない。

- マーカーは現行の契約どおり、本文全体から探す(先頭の行に限らない)。判定は行の完全一致で行う(`intent-format.md:109-112`)。
- 知らないバージョンのマーカー(`<!-- intent:v3 -->` など)は写像せず、マーカーが無いときと同じに扱う。

| 本文のマーカー | 本文の扱い | 原文のセクション |
| --- | --- | --- |
| `<!-- intent:v2 -->` | 原文のセクションだけを原文のセクションへ、派生文のセクションは派生文のセクションへ転記する | 転記したものを使い、不足分を聞き取る |
| `<!-- intent:v1 -->` | 本文は AI の整理なので、`## ASIS` / `## TOBE` を `## 現状調査` / `## 要求` へ移す(ファイル経由の v1 の昇格と同じ) | ユーザーに聞き直す |
| `<!-- codiel:generated -->` | 本文は codiel が生成した文なので、`<!-- intent:v2 -->` があっても本文全体を派生(現状調査の材料)として扱う。このマーカーは intent のマーカーより先に見る | 人が書いたコメントを記録し、不足分をユーザーに聞き取る |
| なし | 人が書いたものとして、本文を原文のセクションに記録する。話者は Issue の作成者、出所は Issue の URL とする | 本文と人のコメントを記録する |

- 人が書いたコメントは、本文のマーカーによらず、話者(書き手)と日付つきで原文のセクションに記録する。`<!-- codiel:generated -->` の Issue でも同じである(本文は派生のまま)。bot のコメントと、`<!-- codiel:generated -->` を持つコメントは除く。
- Issue から取り込んだ記録のうち原文から除くものは、承認ゲートでユーザーが選ぶ(§6.1.2 の手順 4)。

`issue.md` への写像表(`intent-format.md:123-136`)は写像先が無くなるため削除する。

#### 6.3.6 原文による完了判定

完了判定の最高権威は原文のセクションである。最終的な正しさは原文へ遡って照合する。照合は review と finalize の 2 箇所で行う。

| 場面 | 照合の仕方 |
| --- | --- |
| review | 差分が受け入れ基準と設計に合うかに加え、原文の `## ASIS` / `## TOBE` が語る要望を満たすかも見る。原文の要望の未達は severity high の所見にする |
| finalize | 結果レポートで、原文の要望ごとに「達成 / 未達 / 要確認 / 持ち越し」を示す。持ち越しの注記(§6.3.3)がある記録は達成の判定から外し、「持ち越し」と示す。判定の後、intent の `status` を決める(§6.3.2) |

- 要望の単位は、原文の記録 1 件を基本とする。1 件に複数の要望があるときは、原文の該当箇所を引用して分けて示す。分け方は表示のためだけであり、原文へ書き戻さない。
- 派生文のセクション(現状調査・要求・受け入れ基準)、設計、実装が原文と食い違ったら、原文を正とする。
- 食い違いを見つけたら、`mark-ask --kind confirm` で `awaiting_human` にしてから人に確認する(§6.1.1)。finalize でこれを行うと `phases.finalize` が `in_progress` になるが、その遷移は許容する(§6.1.1)。原文は自動で書き換えない。
- 人が派生文側を直すと決めたら、同じフェーズの中で `state.intent` のファイルの派生文のセクションを直す(§6.8 の規則で書ける)。
- review で見つけた食い違いは review の所見として、finalize で見つけた食い違いは結果レポートの「要確認」として示す。

### 6.4 持続層

#### 6.4.1 置き場と領域名

- 持続層には原文のセクション(`## ASIS` / `## TOBE`)を置かない。原文は変更ごとの intent にだけ置く(§6.3.3)。
- `docs/intents/domains/<領域>.md`。基準は `repoRoot` で固定し、設定を持たない。
- 1 領域 1 ファイルとする。
- 領域名は、metatron のドメインマップが読めればそのキーを使う。読めなければ intent フェーズでユーザーと合意する。どちらの場合も intent の frontmatter `domains` に記録する。
- ファイル名は領域名を slug と同じ規則(§6.2.3 の正規表現)に正規化したものとする。英大文字は小文字にし、規則に合わない文字の連続は `-` 1 つに置き換え、先頭と末尾の `-` を除く。正規化で名前が変わった領域は、ファイルの `# <領域名>` 見出しに元の名前を書く。

#### 6.4.2 セクション

```markdown
# <領域名>

## 目的
## 意図的な制約
### <制約の見出し>
- 制約: <...>
- 理由: <...>
- 出典 intent: docs/intents/YYYY-MM-DD-<slug>.md
- 関連 ADR: ADR-NNN(無ければ「なし」)
## 非ゴール
## 由来
- docs/intents/YYYY-MM-DD-<slug>.md(取り込み日 YYYY-MM-DD)
## 出典
```

`出典 intent` が複数あるときは、1 行 1 パスで `- 出典 intent: <パス>` の行を繰り返す。1 行に複数のパスを並べない。

`## 出典` は最後のセクションとし、`## 意図的な制約` などが引いた引用・出典をまとめる。無ければ「なし」と書く(§6.12.2)。`[ADR 候補]` のエントリが引いた出典もここに置く。metatron が縮約してもこのセクションは書き換えないので、ADR へ移した後も出典は持続層に残る。

`adrTarget` が `intents` のとき、ADR の 3 条件を満たす判断は `## 意図的な制約` の中に次の形で書く。見出しの末尾に候補 ID つきの印 `[ADR 候補: <領域名>-<連番>]` を付け、小見出しは metatron の ADR エントリ(確定版の契約文書 §6-1、`harness-docs/design/2026-08-16-file-contract-freeze.md:352-367`)と同じ名前と順序にする。metatron が ADR へ移すとき(§6.11)、小見出しの下をそのまま写せるようにするためである。

```markdown
### <判断のタイトル> [ADR 候補: <領域名>-<連番>]
- 制約: <...>
- 決定日: YYYY-MM-DD
- 出典 intent: docs/intents/YYYY-MM-DD-<slug>.md
- 関連 ADR: なし(ADR 候補)
#### 背景
#### 検討した選択肢
#### 採用した結論
#### 理由
#### 影響範囲
```

たとえば領域 `frontend` の 3 件目の候補は `[ADR 候補: frontend-3]` になる。値は例であり、実際の領域名と連番に置き換える。

- 印は `[ADR 候補: <候補 ID>]` の 1 形だけとし、全角・半角の揺れや別の語を使わない。metatron は印の文字列で検索する。
- 候補 ID は `<領域名>-<連番>` とする。`<領域名>` はファイル名に使う正規化後の領域名(§6.4.1)、`<連番>` は 1 から始まる整数である。
- 候補 ID は intent-sync が採番する。そのファイルに現れる候補 ID(印付きエントリと参照形の両方)の最大連番 + 1 とし、同じ領域文書の中で一意にする。縮約済みの ID も数えるので、一度使った ID は再利用されない。
- 最大連番を数えるときは、印 `[ADR 候補: <候補 ID>]` と参照形の `(候補 ID: <候補 ID>)` を、完全一致のトークンとして読む。`frontend-1` を数えるときに `frontend-10` の一部を拾わない。
- 出典 intent が複数あるときは、1 行 1 パスで繰り返す(上の書式と同じ)。
- 候補 ID は、見出しのタイトルを書き換えても変えない。
- エントリの範囲は、印付きの `###` 見出しから、次の `###` 見出しか `##` 見出しの直前までとする。
- 5 つの小見出しは省かない。内容が無い小見出しは「なし」と書く。

metatron が ADR を確定させた後、エントリは次の参照形に縮められる(§6.11)。

```markdown
### <判断のタイトル>
- 制約: <...>
- 関連 ADR: ADR-NNN(候補 ID: <領域名>-<連番>)
```

- 参照形は印を外した見出しと、制約 1 行と、`関連 ADR` の 1 行だけからなる。`決定日` と `出典 intent` と 5 つの小見出しは消える。
- `関連 ADR` の行に候補 ID を残すのは、採番で ID を再利用しないためである。
- 消える `出典 intent` の各行は、metatron が `ADR 候補 ID: <候補 ID>` の行とあわせて ADR の `#### 背景` に書き写す(§6.11.3)。

変換の例を 1 組示す。値は例であり、実際の判断・パス・番号に置き換える。

縮約の前(印付きの形):

```markdown
### 認証トークンはサーバー側でだけ保持する [ADR 候補: frontend-3]
- 制約: ブラウザの保存領域に認証トークンを置かない
- 決定日: 2026-10-01
- 出典 intent: docs/intents/2026-09-30-login-rework.md
- 出典 intent: docs/intents/2026-10-01-session-timeout.md
- 関連 ADR: なし(ADR 候補)
#### 背景
<...>
#### 検討した選択肢
<...>
#### 採用した結論
<...>
#### 理由
<...>
#### 影響範囲
<...>
```

縮約の後(参照形。ADR-012 が採番された場合):

```markdown
### 認証トークンはサーバー側でだけ保持する
- 制約: ブラウザの保存領域に認証トークンを置かない
- 関連 ADR: ADR-012(候補 ID: frontend-3)
```

このとき ADR-012 の `#### 背景` には、次の 3 行が入る。

```markdown
- 出典 intent: docs/intents/2026-09-30-login-rework.md
- 出典 intent: docs/intents/2026-10-01-session-timeout.md
ADR 候補 ID: frontend-3
```

`[ADR 候補]` の書式と参照形は、codiel と metatron の共有ファイル契約である。正本は `plugins/codiel/references/intent-format.md` にセクションを設けて置く。metatron は読み取りと縮約に要る最小限の写しを参照文書に置く(§6.11.5)。

#### 6.4.3 ADR との分担

ADR の 3 条件(覆すコストが大きい・選択肢が実在した・理由が自明でない。`plugins/metatron/references/writing-discipline.md:69-73`)は、codiel の `intent-format.md` にも写しを置く。metatron が無い環境でも判定できるようにするためである。写しを持つ理由と追随の規則は §6.10.1 に書く。

| `adrTarget` | 3 条件を満たす判断 | 3 条件を満たさない設計理由と制約 |
| --- | --- | --- |
| `metatron` | metatron の ADR にする。持続層には本文を写さず、`関連 ADR` に番号だけを書く。intent-sync の委譲先は持続層に書かずに報告し、オーケストレーターが finalize の結果レポートで ADR 候補として挙げる。ADR の追加は metatron の手順で行う | 持続層に書く |
| `intents` | 該当する領域の持続層の `## 意図的な制約` に、§6.4.2 の `[ADR 候補]` の形で全文を書く。オーケストレーターは finalize の結果レポートでも ADR 候補として挙げる | 持続層に書く |

- `[ADR 候補]` を ADR へ移すのは metatron の init と update である(§6.11)。codiel は移送の手順を持たない。
- `adrTarget` が `metatron` の run は `[ADR 候補]` を作らない。そのため metatron の update が見つける候補は、metatron の導入前に作られたものと、metatron が外れていた期間(ARCHITECTURE が無かった期間)に作られたものだけになる。
- `plugins/codiel/README.md` には「metatron を導入すると `/metatron:init` と `/metatron:update` が `[ADR 候補]` を ADR へ移す」という内容だけを書く(§6.9.4)。

#### 6.4.4 読み手と書き手

| フェーズ | 操作 | 使い方 |
| --- | --- | --- |
| intent | 読む | 現状調査の材料。関係する領域の制約をユーザーに示し、`## 意図的な制約` の初稿にする |
| design(標準) | 読む | 制約を設計の前提にする。制約に反する設計が要るときは、ウォークスルーで明示して合意を取る |
| test-spec・dev-plan(軽量) | 読む | design を飛ばすため、制約を仕様と手順の前提にする |
| review | 読む | 制約への違反を severity high の所見にする |
| intent-sync | 書く | intent の `## 目的` / `## 意図的な制約` / `## 非スコープ` を領域ファイルへ取り込み、`## 由来` に intent のパスを追記する。`adrTarget` が `intents` なら、ADR の 3 条件を満たす判断を `[ADR 候補: <候補 ID>]` の形で書き、候補 ID を採番する(§6.4.2、§6.4.3) |

- codiel の中で持続層を書くのは intent-sync だけである。ほかのフェーズの委譲先は持続層を変更しない。codiel の外で書き換えるのは metatron だけで、その範囲は `[ADR 候補]` の参照形への縮約に限る(§6.11.4)。guard-write も intent-sync 以外での `docs/intents/domains/**` への書き込みに ask を返す(§6.8。intent と triage は `docs/intents/*.md` だけを書く)。
- 取り込み時に既存の制約と矛盾したら、上書きせずユーザーに確認する。
- 参照形のエントリは確定済みとして扱う。intent-sync は参照形のエントリに全文を書き戻さない。今回の変更がその制約を変えるときは、ユーザーに確認する。
- 新しい ADR 級の判断は、既存の参照形を書き換えず、新しい候補 ID で新しいエントリとして書く。
- 既存の制約と同じ内容を別の intent が再び持ち込んだときは、制約を増やさず `出典 intent` にパスを加える。
- intent-sync の成果物はオーケストレーターがコミットする(文書系フェーズの規約。`orchestrating-runs/SKILL.md:151-165`)。

### 6.5 連携モード

#### 6.5.1 判定

- §0 で判定し、`codiel-state init --integration` で記録する。以後は記録を正として固定する。
- `github`: `origin` のリモートのホストが `github.com` か `<名前>.ghe.com` で(移植する環境判定の `repoSlug` が null でない)、かつ `gh auth status --hostname <remoteHost>` が 0 で終わる(決定 46)。
- `local`: それ以外。GHES(`github.com` と `*.ghe.com` 以外のホスト)は従来どおり `local` である。
- 判定の事実は移植した環境判定スクリプト(§6.9.3)が返し、判断はオーケストレーターが行う。
- resume 時だけ再判定する。記録と違えば、どちらで続けるかを人に確認する。確認の結果で記録を変えるときは CLI を通す(コマンド名は計画書で決める)。

#### 6.5.2 フェーズごとの差

| フェーズ | github | local |
| --- | --- | --- |
| intent(Issue 入力時) | `gh issue view`。読めなければ GitHub MCP の読み取り | ユーザーが本文を貼る |
| intent(Issue 起票) | 任意の選択肢として出す | 出さない |
| pr | `git push -u origin <branch>` → `gh pr create`。本文に intent パスを書き、`issue` があれば `Closes #N` | push しない。run ブランチと base は state の `branch` / `baseBranch` にある。完了報告にマージ手順を載せる |
| review | 入力は `git diff <base>...<branch>`。`reports/review-<n>.md` を書き、PR にも投稿する | 入力と `review-<n>.md` は同じ。投稿しない |
| fix-loop | 修正後に push して PR を更新する | push しない。再レビューはローカルの `git diff` を読むため、push は要らない |
| triage | medium / low を Issue として起票する | medium / low を `status: proposed` の intent 草案として `docs/intents/` に書き、コミットする |
| outcome 同期 | `gh pr view` で merge を判定 | `git merge-base --is-ancestor <branch> <base>` が真なら取り込み済みとする。偽ならユーザーに聞く |

- review の入力を両モードとも `git diff` にするため、`reviewing-diffs/SKILL.md:33` の `gh pr diff` を置き換える。現行の「fix-loop で push しないと再レビューが古い diff を見る」問題(`orchestrating-runs/SKILL.md:140`)はこれで消える。
- 軽量の run では `design.md` が無い。`reviewing-diffs` の入力に「`design.md` が無いときは intent と `dev-plan.md` を設計の代わりに読む」規則を足す。
- local の outcome で偽のときに聞くのは、squash merge・未取り込み・却下を git の履歴から区別できないためである。
- github モードで codiel が書く Issue(triage、intent 承認時の任意の起票)・PR 本文・PR と Issue のコメント・レビュー本文には、`github-writing.md` の執筆規則と画像の載せ方(§6.12.3〜§6.12.4)を当てる。PR 本文とレビュー本文には、test-loop が得たスクリーンショットなど関連する画像を載せる。
- `filing-followup-issues` は local の分岐を持つ。草案の frontmatter は `status: proposed`、`run` は空、本文の `## 現状調査` に所見の出所(`review-<n>.md` の該当行)を書く。レビュー所見は AI が生成した文なので、原文にしない。原文の `## ASIS` / `## TOBE` には本文を置かず、見出しと未記録のマーカー `<!-- codiel:unrecorded -->` だけを置く(§6.3.3)。草案を入力に run を始めたときは、このセクションを不足セクションとして聞き取りで埋める。github モードで triage が起票する Issue には `<!-- codiel:generated -->` を付ける(§6.3.5)。

#### 6.5.3 hook

guard-bash の 3 つの制限(`guard-bash.ts:164-182`)は現行どおりフェーズと test-loop の状態だけを条件にする。`state.issue` と `state.integration` を条件に加えない。push を許すフェーズは pr / fix-loop / triage / finalize のままとし、intent-sync を含めない。intent フェーズの Issue 起票は run の作成前に行うため、この制限に掛からない(§6.1.2)。

### 6.6 並列実装

並列実装(`implement.steps`、wave、worktree、hook の worktree の判定)は M4 で入れる。M2〜M3 の implement は現行どおり 1 ステップずつ直列に委譲し、hook の worktree の分岐も M4 で足す。M4 で state に `implement` と `testLoop` の任意フィールドを足すのは、既存の state を読めなくしない後方互換の追加として扱い、`version` は 2 のまま据え置く。

#### 6.6.1 dev-plan の書式

`writing-dev-plans` の出力書式(`SKILL.md:57-76`)を次のとおり改める。

- 「変更ファイル」を「触るファイル」に置き換える。値は repoRoot 相対の glob の列とする。触るファイルはディレクトリを含めて書く(`src/app/**/*.ts` のように書き、`*.ts` や `**/*` だけを書かない)。固定部が空の glob は全ステップと重なるとみなされ、並列にできなくなるためである(§6.6.2)。
- 「前提ステップ」を足す。値は先に終わっている必要があるステップ番号の列で、無ければ「なし」。
- 文書の先頭に `## 環境準備` を置き、worktree で依存をインストールするコマンドを書かせる。lockfile を変更しないモードのコマンドにする。書けなければ「なし」とし、§6.6.3 の既定に任せる。
- 文書の先頭に `## 生成物` を置き、ビルド生成物の扱いを宣言させる。項目は、方式(a または b)・生成コマンド・生成物のパス(glob)・方式を選んだ根拠(規約の出所)である。生成物が無いプロジェクトでは「なし」と書く。

生成物の扱いは対象プロジェクトの規約に従う。codiel が一律の規則を課さない。dev-plan 担当は規約を読み、次のどちらかを選んで `## 生成物` に宣言する。

| 方式 | 内容 | 選ぶ条件 |
| --- | --- | --- |
| a | 各ステップが自分の worktree で生成し、ソースの変更と同じコミットに入れる。生成物のパスをそのステップの「触るファイル」に含めることを必須にする | 規約が「ソースの変更と生成物を同じコミットに入れる」ことを求めるとき |
| b | ステップは生成物をコミットしない。全 wave の後に、生成だけを行う最終ステップを run ブランチ上で直列に実行する | 規約に定めが無いとき(既定)、または規約が b を求めるとき |

- 規約は、docRoot 配下の `CLAUDE.md` と `.claude/rules/**/*.md`(metatron の rules が既定の場所にあればここに含まれる)から読む。読み先を決めた理由と限界は §6.10.1 にある。
- b では、最終ステップを dev-plan の最後のステップとして書かせ、前提ステップに全ステップを並べる。
- このリポジトリ(プラグインのマーケットプレイス)の規約は `.claude/rules/metatron/conventions.md` の Done 条件で「`plugins/*/src/` の変更と `plugins/*/scripts/` の差分を同じコミットに入れる」ことを求める。§8.4 の手動確認でこのリポジトリを対象にするときは a になる。

#### 6.6.2 wave 分割

- オーケストレーターは dev-plan のステップを `codiel-state step-add` で登録し、`codiel-state waves` で実行の順序を得る。順序は CLI が決定的に計算する。
- 循環依存は dev-plan のゲートで検出する。`waves` が非ゼロで終わったら dev-plan を差し戻し、`evaluate_plan` を呼ばない。
- `waves` の出力は次の形とする。

```json
{
  "groups": [
    { "steps": ["1", "2", "4"], "mode": "parallel" },
    { "steps": ["3"], "mode": "serial" },
    { "steps": ["5", "6"], "mode": "parallel" }
  ],
  "final": ["7"]
}
```

値は例であり、実際のステップ番号に置き換わる。

- 並べ方の規則は次のとおりである。
  1. `groups` はトポロジカル順に並ぶ。どのステップも、その前提ステップをすべて含むグループより後のグループに入る。前提が `serial` のステップでも同じである。
  2. 触るファイルが重なりうる 2 ステップを同じグループに入れない。
  3. 触るファイルに lockfile(`pnpm-lock.yaml`、`package-lock.json`、`yarn.lock`、`bun.lockb` 等。一覧は計画書で確定する)を含むステップは、そのステップだけの `serial` グループにし、依存順の位置に置く。`serial` グループは run ブランチ上で直列に実行する。
  4. 方式 b の最終ステップ(`step-add --final` で登録する)は、どのグループにも入れず `final` に出す。`final` は全グループの後に run ブランチ上で実行する。
  5. `parallel` グループのステップ数は 4 を上限とする。超える分は同じ規則のまま次のグループへ送る。
- 重なりの判定は次のとおり保守的に行う。
  1. glob の中括弧(`{a,b}`)は展開し、展開後の各 glob を比べる。
  2. glob を `/` でセグメントに分け、ワイルドカード(`*`・`?`・`[`)を含む最初のセグメントより前を固定部とする。ワイルドカードを含まないパスは、パス全体を固定部とする。
  3. 2 つの固定部を、セグメント単位で先頭から比べる。一方のセグメント列が他方のセグメント列の先頭に一致すれば、重なりうるとみなす。`src/app` と `src/apple` は、セグメント `app` と `apple` が違うので重ならない。
  4. 固定部が空の glob(`*.ts`、`**/*`)は、全ステップと重なるとみなす。
- 方式 a では生成物のパスも触るファイルに含まれるため、同じ生成物を触るステップはこの規則で別のグループに分かれる。
- 判定は宣言に基づくため、宣言されていないファイルでの衝突は起こりうる。マージ時の衝突の処理(§6.6.4 の手順 6)はそのためにある。

#### 6.6.3 worktree

- 1 ステップ 1 worktree とする。パスは `.codiel/worktrees/<slug>/<kind>-<id>` とし、kind は implement のステップなら `step`、test-loop の unit なら `unit` である。implement のステップは `.codiel/worktrees/<slug>/step-<k>`、ブランチは `codiel/<slug>-try-<n>-step-<k>` になる。test-loop の unit は `.codiel/worktrees/<slug>/unit-<unit-id>`、ブランチは `codiel/<slug>-try-<n>-unit-<unit-id>` になる。起点はそのグループを始める時点の run ブランチ HEAD である。
- 触るファイルの glob は repoRoot 相対で書かれている。worktree 内では、その worktree のルートを同じ基準として当てる。
- `.codiel/worktrees/` は run の最初の worktree 作成時に `.git/info/exclude` へ加える。追跡ファイルを変えずに、`pr` 前の `git status --short` の確認(`orchestrating-runs/SKILL.md:166-168`)を汚さないためである。
- ステップの開始時に、worktree 内で依存をインストールする。コマンドは dev-plan の `## 環境準備` を使う。「なし」のときは lockfile の種類から既定を選ぶ(`pnpm-lock.yaml` なら `pnpm install --frozen-lockfile`、`package-lock.json` なら `npm ci` 等。対応表は計画書で確定する)。lockfile が無ければインストールを省く。
- 後始末は次のとおりとする。
  - マージ済みのステップ: マージの直後に `git worktree remove` し、step ブランチを削除する。
  - 失敗したステップ: run の終了まで残す。ただしやり直す前には必ず `git worktree remove` と step ブランチの削除を行い、新しい HEAD から作り直す。同じパス・同じ名前のブランチでの再作成を git が拒否するためである。
  - run の終了時(finalize または stop): 残っている worktree と step ブランチをすべて削除する。

#### 6.6.4 1 つの `parallel` グループの流れ

`groups` を先頭から順に処理する。`parallel` グループは次の手順で、`serial` グループと `final` は run ブランチ上で 1 ステップずつ委譲する(手順 8〜9)。

1. オーケストレーターがステップごとに brief ファイル `.codiel/runs/<slug>/try-<n>/steps/step-<k>/brief.md` を書く。内容は現行の依頼文テンプレート(`orchestrating-runs/SKILL.md:177-218`)に、worktree の絶対パス・触るファイル・前提ステップ・環境準備のコマンドを加えたものである。
2. 実装の委譲をステップ単位で同じ応答から並列に出す。依頼文は brief の絶対パスを読ませる。委譲先は worktree 内で依存のインストール・実装・ユニットテストを行う。生成物は dev-plan の `## 生成物` の方式に従う。方式 a では生成してソースの変更と同じコミットに入れ、方式 b では生成物をコミットしない。報告は `report.md` を同じディレクトリに書く。委譲先は `codiel-state` を呼ばない。
3. ステップごとのタスクレビューを並列に出す。読み取りだけの委譲で、観点は仕様適合(dev-plan のステップと受け入れ基準に合うか)と品質の 2 つである。
4. 所見があれば修正ループを回す。上限は 5 ラウンドとし、ラウンドは `implement.steps[k].attempts` で数える。
   - 1〜3 ラウンド: 同じ委譲先を、文脈を保ったまま続投させる。
   - 4〜5 ラウンド: 作業内容を「行き詰まりの打開」と明記した新しい委譲として出す。委譲先の選択はセッションの規律に委ね、codiel は役割名もモデル名も書かない(ADR-004)。
   - 5 ラウンドで通らなければ、run を awaiting_human にする。
5. レビューを通ったステップから、run ブランチへ順にマージする(`git merge --no-ff`)。
6. 衝突したら `git merge --abort` し、そのステップを失敗として記録する。失敗したステップはグループの残りのマージが済んだ後、§6.6.3 の後始末をしてから新しい HEAD で作り直し、直列にやり直す。
7. グループのマージが済んだら、オーケストレーターがユニットテストのコマンドを実行する。失敗したら、修正を成果物を書く委譲として run ブランチ上で直列に出す。
8. `serial` グループ(lockfile を変えるステップ)は、`groups` の中の位置に来たときに run ブランチ上で委譲する。worktree は作らない。
9. 方式 b では、全グループの後に `final` の最終ステップ(生成物の生成とコミット)を run ブランチ上で委譲する。
10. 全グループと `final` の後、implement 全体に対して `evaluate_code` を 1 回呼び、`pass-gate implement` する。

#### 6.6.5 `implement.steps` と state の更新

- run state に `implement.steps[k]` を持つ。必須のフィールドは次のとおりで、型と遷移の詳細は実装計画で確定する。
  - 状態(`pending` / `running` / `reviewing` / `merged` / `failed`)
  - 触るファイル、前提ステップ、グループの位置と種類(`parallel` / `serial` / `final`)
  - worktree のパスとブランチ
  - コミット範囲(起点 HEAD と終点)
  - 修正ラウンド数 `attempts`
  - ドメインタグ `domain`(`mapped` のとき)
- state を書くのはオーケストレーターだけである。ステップ担当のサブエージェントとレビュー担当は `codiel-state` を呼ばない。オーケストレーターは CLI を直列に呼ぶため、`writeState`(`codiel-state.ts:109-114`)の書き込みが競合することは無い。
- ステップの修正ラウンドは `implement.steps[k].attempts` で数え、フェーズの `record-attempt`(`phases[phase].attempts`)とは別にする。
- SDD(subagent-driven-development)の台帳ファイルは使わない。run state が同じ役を担い、hook が読める。

#### 6.6.6 ドメイン境界

`state.domain` は 1 値しか持てず(`guard-write.ts:134`)、並列の委譲には使えない。`mapped` のとき、guard-write は書き込み先が属する worktree の kind と id から、`implement.steps[k].domain` または `testLoop.units[id].domain` を引いて境界を判定する(§6.8)。run ブランチ本体(メインの作業ツリー)への書き込みには、現行どおり `state.domain` を使う。

### 6.7 test-loop の並列化

- Step A(スクリプト安定化): スクリプトの作成は unit ごとに並列に委譲する。作業場所は unit ごとの worktree とし、作り方・後始末・マージは §6.6.3〜§6.6.4 に従う。同じ作業ツリーで複数の委譲先が同時にコミットすると `index.lock` で衝突するためである。
- 実行: `spec.md` の frontmatter に `parallel: true` を持つ unit だけを同時に実行する。frontmatter は `spec.md` の先頭で `---` に囲む YAML とし、定義するキーは `parallel`(真偽値)だけである。frontmatter やキーが無ければ直列とする。持たない unit は直列に実行する。ポート・データベース・外部サービスのような共有資源を持つ unit を保護するためである。この規則はStep A の中の実行と回帰実行の両方に当てる。
- Step B(NG 修正): unit ごとに §6.6 と同じ worktree とマージの方式で並列に修正する。
- 並列度の上限は §6.6.2 と同じ 4 とする。
- test-loop の worktree は `.codiel/worktrees/<slug>/unit-<unit-id>` に作り(§6.6.3)、state の `testLoop.units[unit-id]` に `implement.steps` と同じ必須フィールドで登録する。
- unit のドメインは、`spec.md` が対象とする機能単位がドメインマップのどのドメインの glob に収まるかで決め、`testLoop.units[unit-id].domain` に入れる。1 つのドメインに決まらなければ、その unit は境界を課さない(unscoped として扱う)。
- fix-loop は直列のまま変えない。
- `writing-test-specs` の `spec.md` の書式に、`---` で囲む frontmatter と `parallel: true` の宣言を足し、「無ければ直列」と書く。

### 6.8 hook

| hook | 変更 | マイルストーン |
| --- | --- | --- |
| guard-bash | `findActiveRun` の走査範囲の変更(§6.2.2)と、run の検索をメイン作業ツリーのルートで行う変更(下記 (a))に追随する。制限の条件はフェーズのまま | M2(走査)、M4(ルート) |
| guard-write | `DOC_PHASES` に intent / intent-sync を加え、init を除く。`docs/intents/**` の規則を足す(下記) | M2 |
| guard-write | worktree 内の書き込みの判定(下記 (a)〜(c)) | M4 |
| stop-guard | run の検索をメイン作業ツリーのルートで行う(下記 (a)) | M4 |
| guard-bash | GitHub へ投稿する `gh` のコマンドの本文に `<!-- codiel:generated -->` を求める(下記「投稿する本文のマーカー」) | M2 |
| 新設 guard-github-mcp | GitHub MCP の本文を書き込むツールの引数に `<!-- codiel:generated -->` を求める(同上) | M2 |

#### 投稿する本文のマーカー

run が active な間、GitHub へ本文を投稿する操作には `<!-- codiel:generated -->` を求める(決定 53、§6.3.5)。どちらの hook も、active run が無いとき(`findActiveRun` が run を返さないとき)は何もせずに通す。

hook の検査の範囲は決定 69 に従う。スキルの手順で使う書き方と自然に書きうる書き方のすり抜けと、正当な呼び出しの誤検知を直し、意図的な回避でしか起きない穴はこのセクションの既知の限界に挙げる。

guard-bash の規則は次のとおりである。

- 対象のコマンドは `gh issue create`・`gh issue comment`・`gh issue edit`・`gh pr create`・`gh pr comment`・`gh pr edit`・`gh pr review` である。サブコマンドは、git と同じくトークンの解析で見分ける(`guard-bash.ts:36-60` の手法)。
- 本文を持つ呼び出しだけを検査する。本文を持つとは、`--body` / `-b` か `--body-file` / `-F` を含むことである。本文を持たない呼び出し(`gh pr review --approve` だけ、`gh issue edit --add-label` だけ)は通す。例外は、下の項の本文を自動で作る呼び出しと `--web` である。
- フラグは、短いフラグの結合(`-df`)と値の連結(`-bX`)も読む。行末の `\` による行の継続は、gh と git の起動を探す前に 1 行へ戻す。
- `--body` / `-b` のときは、コマンドの文字列全体にマーカーが含まれるかを見る。本文はクォートや heredoc(`"$(cat <<'EOF' … EOF)"`)で複数行になり、改行で区切るセグメントの分割(`guard-bash.ts:18`)では切れてしまうので、セグメントに分けずに見る。1 つの投稿が本文の値を 2 つ以上持つとき(本文のフラグの繰り返し、`gh api` の `comments[][body]`)は、値ごとにマーカーを求める。gh は繰り返したフラグの最後の値を使うためである。
- `--body-file` / `-F` のときは、値のパスを cwd 基準で解決し、ファイルの中身にマーカーが含まれるかを見る。ファイルが読めなければ deny する。
- 値が `-`(標準入力)のときは中身を検査できないので deny し、ファイルに書いて `--body-file <パス>` で渡すよう案内する。
- マーカーが無ければ deny し、「本文に `<!-- codiel:generated -->` を含めて投稿し直す」よう案内する。
- 既存のフェーズの制限(`gh issue create` は triage だけ、`gh pr create` は pr だけ)は残し、マーカーの検査はその後に当てる。フェーズの制限は、正規表現ではなく、下の項の字句解析で見つけた gh の起動で判定する(`gh -R o/r pr create` を捕まえ、コミットメッセージに書いた使用例を捕まえないため)。
- `gh api` も対象にする(決定 60)。メソッドは `-X` / `--method` の値で決め、指定が無ければフィールドか `--input` があるとき POST、無いとき GET とする。POST・PATCH・PUT のうち、キーが `body`(`comments[][body]` の形を含む)のフィールドを `-f` / `--raw-field` / `-F` / `--field` で送るものと、`"body":` を含む `--input <ファイル>` を送るものを検査する。`-F body=@<パス>` と `--input <パス>` はファイルの中身を見る。`@-` と `--input -` は deny し、読めないファイルも deny する。本文を持たない呼び出し(読み取り、ラベルだけの更新)は通す。GraphQL の mutation の query に本文を直接書く形と、`body` 以外の名前のフィールドで本文を送る形は検出しない。
- 本文のフラグを持たずに本文を自動で作る呼び出しを deny する(決定 64)。対象は、`--fill`・`--fill-first`・`--fill-verbose`・`--template` / `-T` を持つ `gh pr create` と、`--template` / `-T` を持つ `gh issue create` である。`gh pr create` と `gh issue create` の `--web` / `-w` も deny する(決定 66)。Web の作成画面はテンプレートを入れた状態で開き、画面で編集した本文は検査できないためである。
- 本文ファイルのパス(`--body-file` / `-F` の値、`gh api` の `-F body=@<パス>`、`--input <パス>`)が、同じコマンドの中でフラグの値以外の場所にも現れたら deny する(決定 66)。hook は実行前にファイルを読むので、同じコマンドで書き換えると古い中身を検査してしまうためである。パスの表記を変えた書き換えは検出しないので、本文を Write ツールで書く規律(§6.12.3)と併せて防ぐ。
- 1 つのコマンドに本文付きの投稿が 2 つ以上あり、いずれかが本文を引数(`--body` / `-b`、`gh api` の `-f body=`)で渡すときは deny する(決定 66)。コマンドの文字列全体でマーカーを探すので、1 つのマーカーで別の投稿まで通ってしまうためである。
- gh の起動は、クォートと入れ子を追う字句解析で探す。起動を分けるのは、コマンドの区切り(`;` `&` `|` 改行、サブシェルの括弧)とコマンド置換(`$( … )`、バッククォート)の境界だけである。クォートした文字列は 1 語として扱い、その中の語をフラグとも gh の起動とも読まない。コマンド置換の中と、`bash -c` / `eval` の引数の中の gh は、別の起動として検査する。
- heredoc の本文の行(`<<WORD` から終端の `WORD` の行まで)は、gh の起動として読まない。コミットメッセージに書いた gh の使用例を投稿と見なさないためである。本文を除くのは終端の行が見つかったときだけである。開始は、`<<` / `<<-` の後に空白を置く形(`cat << 'EOF'`)と空白を詰めた形(`cat<<EOF`)の両方で、終端の語はクォートした語(`-` などを含んでよい)、`\WORD`、クォートしない `[A-Za-z_]\w*` の 3 つの形を受ける。`<<` の直前が数字・`)`・`<` のもの(here-string の `<<<`、`1<<2`)、算術の展開 `$(( … ))` の中の `<<`、終端の語の直後に語の区切り以外が続く形(`<<EOF-X`)は heredoc の開始と見なさない。終端の語をクォートしない heredoc(`<<EOF`)では、本文の中のコマンド置換を実行されるものとして検査する。
- 字句解析が閉じていないクォートかコマンド置換を残して文字列の終わりに達したときは、空白で区切る以前の方式で gh の起動を探し直し、厳しい側で検査する。
- `-c` の引数を読み直すのは、シェルの語(bash・sh・zsh・dash・ksh と、その絶対パス)の後ろの `-…c` の語の次の語と、`eval` の次の語だけである。`grep -c` などの値は読まない。マーカーの検査は、従来どおりコマンドの文字列全体で行う。

既知の限界(決定 69。意図的な回避か、誤検知の側に倒れるもの)は次のとおりである。

- `bash <<EOF` の本文の中で起動した gh の投稿は検出せず、フェーズの制限にも掛からない。
- 1 つの本文の値は、コマンドの文字列全体でマーカーを探す(決定 53 の規則)。本文の外(`# <マーカー>` のコメント、別の heredoc、変数)にマーカーを置くと通る。
- `-c` と `eval` 以外のコマンドが実行するクォートした文字列(`watch "gh …"`、`ssh host "gh …"`、`parallel`)の中の gh と、`sudo -u gh gh …` のように gh の語を 2 つ持つ形は検出しない。
- 本文ファイルの書き換えは、同じパスの表記(`./x.md` と `x.md`)を変えると検出しない。GraphQL の mutation の query に直接書いた本文と、`body` 以外の名前のフィールドで送る本文も検出しない(§6.8 の `gh api` の項)。
- `$` の無い算術コマンド `(( x << y ))` の `<<` は heredoc の開始と誤読し、`y` だけの行があればそこまでの行を読まない。`case` の `)` を含むコマンド置換は早く閉じる。
- 開始として受けない heredoc の書き方(クォートしない `<<END-OF-MSG`、`<<E"O"F`、`0<<EOF`)と、終端の語を `)` と同じ行に書く `$(cat <<'EOF' … EOF)` は、本文の行をコマンドとして読む(誤検知の側。本文の gh の使用例がフェーズの制限に掛かりうる)。
- シェルの語が実際のコマンド名かは確かめないので、`echo bash -c "gh pr create"` の値もコマンドとして読む(誤検知の側)。
- 直前が数字の `<<`(空白を詰めた `python3<<'EOF'`)は heredoc の開始と見なさない。
- 閉じていないクォートを残したときに使う読み直し(空白で区切る方式)は、`$(` の直前が代入以外の文字の形の gh の起動を見つけないことがあり、引数の値の `NAME=gh`(`-f name=gh`、クォートの中の `x=gh`)を gh の起動と読むことがある(誤検知と見逃しの両方)。この方式に入るのは、開始として受けない heredoc の本文に対になっていないクォートがあるときだけである。

GitHub MCP の hook の規則は次のとおりである。

- 新しい PreToolUse の hook(`src/hooks/guard-github-mcp.ts`)を足し、`build.ts` のエントリと `hooks/hooks.json` に登録する。
- matcher は GitHub MCP の本文を書き込むツールに当てる。Claude Code は MCP のツールを `mcp__<サーバー名>__<ツール名>` の名前で渡すので、サーバー名の違い(プラグイン経由の接続を含む)を吸収できるよう、正規表現で書く。対象のツールは `issue_write`・`add_issue_comment`・`update_issue_comment`・`create_pull_request`・`update_pull_request`・`update_pull_request_body`・`create_pull_request_review`・`add_comment_to_pending_review`・`pull_request_review_write`・`add_reply_to_pull_request_comment`・`submit_pending_pull_request_review`・`add_pull_request_review_comment`・`create_issue`・`update_issue_body`・`update_issue` の 15 個である(実装時に確定。実装計画書 §9.3)。サーバー名の `github` は大文字小文字を区別せずに照合する。
- 本文にあたる引数(`body` など)を、guard-bash と同じ条件で検査する。本文の引数を持たない呼び出しは通す。マーカーが無ければ deny する。
- ツールの一覧と、ツールごとの本文の引数の名前は、実装時に GitHub MCP の現行のツール定義で確かめて確定する(§10 の引き継ぎ)。

`hooks/hooks.json` の変更は全セッションの挙動を変える(`.claude/rules/metatron/protected-paths.md` の「変更に慎重を要するパス」)。変更後に新しいセッションで hook が発火することを確かめる(§8.4)。

`docs/intents/**` の規則は次のとおりにする。許可は直下と `domains/` で分ける。

| 書き込み先 | 通すフェーズ | それ以外 |
| --- | --- | --- |
| active run の `state.intent` が指すファイル 1 本 | すべてのフェーズ | — |
| `docs/intents/*.md`(直下。`domains/` を含まない。上のファイルを除く) | phase `null`・intent・intent-sync・triage | ask |
| `docs/intents/domains/**` | intent-sync だけ | ask |

- `state.intent` のファイルをすべてのフェーズで通すのは、ユーザーが run の途中で足した言葉をその場で原文に追記するため(§6.3.4)と、review・finalize で人が派生文を直すと決めたときに同じフェーズで直すため(§6.3.6)である。比べるのは、書き込み先の repoRoot 相対のパスと `state.intent` の値の完全一致である。
- 原文を書き換えない・要約しないは、AI 側の規律で守る。hook は書き込みの中身を検査しない。
- intent 文書を書くのはオーケストレーターだけである。hook は `state.intent` のファイルをすべてのフェーズで通すので、実装・テスト・レビューなどの委譲先も書き込めてしまう。そこで委譲の依頼文(`orchestrating-runs` の依頼文テンプレート)に、「intent 文書を書き換えない。原文の追加が必要ならオーケストレーターへ報告する」の文を入れる(§6.9.1)。例外は intent-sync の委譲で、派生文のセクションの反映だけを許す。
- `null` は `init` の直後で `start-phase` の前を指す。triage は local モードの草案を書くために直下を通す。
- 判定の順序は次のとおりとする。まず `state.intent` のファイルかを見て、当たれば通す。次に `docs/intents/**` の規則を当て、そのあとで現行の `DOC_PHASES` の分岐(`guard-write.ts:108-115`)を当てる。intent フェーズは `DOC_PHASES` に入り、その分岐は `docs/` 全体を通すので、`docs/intents/domains/**` への書き込みは `DOC_PHASES` の分岐より先に ask にする。
- phase `null` で `docs/intents/*.md` 以外へ書くときは、現行どおり末尾の catch-all(`guard-write.ts:179-181`)に落ち、`.codiel/` 配下は通し、それ以外は ask を返す。
- active run が無いときは、現行どおり全面的に pass する(`guard-write.ts:104-105`)。run の作成前に intent 文書を書く操作(§6.1.2 の手順 5 の (1))はこれで通る。

intent フェーズの手順を「承認 → intent 文書を書く → run を作る」の順に保てるのは、この規則による。

worktree 内の書き込みは、次の 3 点で判定する。worktree は `.codiel/worktrees/<slug>/<kind>-<id>/` にあり、kind は `step` か `unit` である(§6.6.3)。

- (a) run の検索は常にメイン作業ツリーのルートで行う。worktree はメインの作業ツリーの中にあり、現行の `findProjectRoot(cwd)`(`lib.ts:539-545`)の返り値は worktree の中身で変わる。worktree の checkout に `.codiel/` が無ければ親をたどってメインのルートを返し、`.codiel/specs` がコミットされていれば worktree のルートを返す。どちらも起こりうるので、cwd が worktree 内のときは `git worktree list --porcelain` の先頭のエントリ(メインの作業ツリー)のパスをメインのルートとし、そこで `findActiveRun` を呼ぶ。`git rev-parse --git-common-dir` の値は `.git` ディレクトリを指すので、そのままルートとして使わない。
- (b) 書き込み先の絶対パスが `<メインのルート>/.codiel/worktrees/<slug>/<kind>-<id>/` 配下なら、その worktree のルート(`worktreeRoot`)を基準に判定する。
  - `codielRel` は `worktreeRoot` 基準の相対パスとする。
  - worktree の中の docRoot は `worktreeRoot + relative(mainRoot, docRoot)` で求め、`docRel` はそれを基準にする。docRoot がメインのルートの子(例 `repo/sub`)でも、同じ位置関係で worktree の中に写る。
  - そのうえでドメイン境界・spec / cases の改竄検知(`guard-write.ts:117`)・DOC の判定を通常どおり当てる。この書き込みを `.codiel/` 配下の免除(`:136`、`:180`)に入れない。メインのルート基準で相対化すると、worktree 内のすべての書き込みが `.codiel/` 配下と判定されて免除される。
- (c) (b) のとき、境界に使うドメインは、kind が `step` なら `implement.steps[id].domain`、`unit` なら `testLoop.units[id].domain` である。`state.domain` は使わない。値が無ければ境界を課さない。

`state.json` の保護(`guard-write.ts:79`)は絶対パスで判定しており、変えない。

### 6.9 スキルと参照文書の配置

#### 6.9.1 codiel の指示層

| 種別 | 変更 |
| --- | --- |
| 新設 `skills/capturing-intent/` | sandalphon の同名スキルを移植し、§6.1.2〜§6.1.3 の手順に改める。`/sandalphon:run` と `bridging-execution` への言及を除く |
| 新設 `skills/syncing-intents/` | intent-sync フェーズの手順(§6.3.4、§6.4.4)と、`adrTarget` による ADR の書き分け(§6.4.3)。名前は計画書で確定してよい |
| 削除 `skills/analyzing-issues/` | §6.1.6 |
| 削除 `agents/codiel-analyst.md` | §6.1.6 |
| 改修 `skills/orchestrating-runs/` | フェーズ表・§0・§1・§2.1・§4.1・§5・§6 |
| 改修 `skills/writing-dev-plans/` | §6.6.1(触るファイル・前提ステップ・`## 環境準備`・`## 生成物` と方式の選び方) |
| 改修 `skills/writing-test-specs/` | 軽量の入力(§6.1.4)、`parallel: true` の宣言(§6.7) |
| 改修 `skills/implementing/` | worktree 内での作業(依存のインストール、`## 生成物` の方式に従う生成物の扱い)と `report.md` |
| 改修 `skills/running-regression-tests/` / `scripting-tests/` | §6.7 |
| 改修 `skills/reviewing-diffs/` | 入力を `git diff`、軽量の入力、持続層の違反は high(A3-4 の文言)、原文の `## ASIS` / `## TOBE` の要望を満たすかも見て未達は high、派生文と原文の食い違いは原文を正として所見に挙げる(§6.3.6)、local では投稿しない。投稿するレビュー本文は `github-writing.md` に従い、画像はレビュー本文の縮退の順序で載せる(§6.12.4) |
| 改修 `skills/filing-followup-issues/` | local の草案(`intent-writing.md` に従う。原文のセクションは `<!-- codiel:unrecorded -->`)。github の Issue とコメントは `github-writing.md` に従い、本文に `<!-- codiel:generated -->` を置く |
| 改修 `skills/orchestrating-runs/`(pr) | PR 本文を `github-writing.md` に従って書き、画像を載せる。§0 で `imageUpload` を判定する |
| 改修 `skills/orchestrating-runs/`(finalize) | 結果レポートに、原文の要望ごとの「達成 / 未達 / 要確認 / 持ち越し」の表を足す。持ち越しを除いてすべて達成のときだけ intent の `status` を `done` にし、run ブランチへコミットし、github モードでは push する。派生文と原文の食い違いは `mark-ask` の後に人に確認し、原文を自動で書き換えない(§6.3.2、§6.3.6) |
| 改修 `skills/orchestrating-runs/`(共通) | フェーズの途中で人に確認するときは `mark-ask --kind confirm` を使う一般則(§6.1.1)。ユーザーが途中で言葉を足したら、どのフェーズでも原文へ即座に追記し、§6.3.4 の扱いに進む。intent-sync より後の要望を run に含めるときは `stop --reason intent-updated` を使う |
| 改修 `skills/orchestrating-runs/`(依頼文テンプレート) | intent-sync 以外の委譲の依頼文に「intent 文書を書き換えない。原文の追加が必要ならオーケストレーターへ報告する」の文を入れる(§6.8)。intent-sync の依頼文には、派生文のセクションだけを書き換え、原文のセクションを書き換えないと明記する |
| 改修 `skills/capturing-intent/`(原文) | 人が書いた・語った言葉だけを原文のセクションへ日付・話者・出所つきで、原語のまま記録する。AI が生成した文は原文にしない。今回やらないことも `## TOBE` に記録する。現状を語っていなければ 1 問だけ尋ねる。「ASIS はユーザーに聞かず自分で読む」を `## 現状調査` の規律に付け替える。Issue を入口にしたときのマーカーの扱い(§6.3.5)。任意の起票の本文に `<!-- codiel:generated -->` を置く |
| 改修 `skills/syncing-intents/`(原文) | 途中で追記された原文を、人の確認の後に派生文のセクションへ反映する。原文のセクションは書き換えない。`status` を `done` にしない(finalize が付ける) |
| 改修 `skills/raguel-gating/` | outcome 同期の local 分岐、`--slug` |
| 改修 `skills/preparing-design-agendas/` / `writing-design-docs/` / `facilitating-design-discussions/` | 入力を intent に |
| 改修 `commands/run.md` | 引数 3 形、description |

指示書の文面は `prompt-smith:prompt-smith` の規律で書く(`.claude/rules/metatron/conventions.md` の「AI 向けの指示書」)。スキルの description は `prompt-smith:skill-creator` で書く。

#### 6.9.2 codiel の参照層

プラグイン直下に `plugins/codiel/references/` を新設する。複数のスキルから読まれる規律と書式だけを置く(`harness-docs/ARCHITECTURE.md` の参照層の定義)。

| ファイル | 出所 | 読み手 |
| --- | --- | --- |
| `references/intent-format.md` | sandalphon の同名ファイルを v2 に改訂。持続層の書式をセクションとして加える | capturing-intent、syncing-intents、filing-followup-issues、preparing-design-agendas |
| `references/handoff-contract.md` | sandalphon の同名ファイル。「同じコミットで gh-utility を更新する」の規律を継ぐ | capturing-intent |
| `references/intent-common.md` | `sandalphon-common.md` のうち、基本方針・大原則・畳む経路の表(Codiel 委譲と testRunner の行を除く)・畳んだことの報告・自前起票・失敗時 | capturing-intent、orchestrating-runs |
| `references/intent-writing.md`(新設) | §6.12.2 | capturing-intent、syncing-intents、filing-followup-issues(local の草案) |
| `references/github-writing.md`(新設) | §6.12.3〜§6.12.4 | capturing-intent(任意の起票)、orchestrating-runs(PR 本文)、reviewing-diffs、fixing-review-findings、filing-followup-issues |

`sandalphon-common.md` の「環境チェック」セクションは capturing-intent の本文へ吸収し、共通文書に残さない。ファイル名 `intent-common.md` は計画書で変えてよい。

#### 6.9.3 codiel の実装層

- `src/check-intent-env.ts` を codiel へ移す。ルート解決・設定読み取り・ドメインマップ読み取りは codiel `src/hooks/lib.ts` の `findDocRoot` / `resolveDocPaths` / `readDomainsResult` を import して使い、独自の写しを削る。
- 出力から `codielHandoffCandidate`・`codielHarness`・`testRunner` を外す。どれも廃止する委譲判定と自前実行のための値である。
- `repoSlug` の正規表現を、ホストが `github.com` か `<名前>.ghe.com` のリモートを受ける形に改める(決定 46)。現行は `github.com` の完全一致だけを受ける(`plugins/sandalphon/src/check-intent-env.ts:163-169`)。SSH・HTTPS の両形式と、`notgithub.com` のような部分一致を弾く現行の性質は保つ。GHES の独自ドメインでは従来どおり `null` を返す。
- `ghAuthenticated` は `gh auth status --hostname <remoteHost>` の終了コードで判定する。`remoteHost` が無いときは現行どおり `gh auth status` で判定する。
- 出力に `ghVersion`(`gh --version` の版数。未導入なら `null`)、`remoteHost`(`origin` のホスト名。無ければ `null`)、`ghAttachSupported`(2.99.0 以上で、かつ `remoteHost` が `github.com` か `*.ghe.com` か)を足す(§6.12.4)。判定は事実だけを返し、`imageUpload` の決定はオーケストレーターが行う。
- `build.ts` のエントリに `check-intent-env` を加え、`scripts/check-intent-env.mjs` を生成する。
- `lib.ts` と `check-intent-env.ts` のコメントにある「3 実装」「sandalphon」を「2 実装」「metatron」に改め、3 者比較を指す「契約 §13」を「契約 §14」に直す(§3.5)。

#### 6.9.4 codiel の文書

- `plugins/sandalphon/docs/rationale.md` を `plugins/codiel/docs/DESIGN.md` の新しいセクションへ統合する。
- `plugins/sandalphon/docs/format-change-checklist.md` を `plugins/codiel/docs/format-change-checklist.md` へ移し、追随先を改める(`analyzing-issues` の行を削り、`filing-followup-issues` と `syncing-intents` を加える)。
- codiel は `evals/` を持たない(決定 54)。M1 で移した `evals/capturing-intent.json` は M2 で削除した。
- `plugins/codiel/CLAUDE.example.md` を、metatron への分離後と intent 駆動化後の実態に合わせて書き直す(決定 57)。ARCHITECTURE・GOTCHAS・metatron には触れない(決定 59)。
- 運用の規律は `plugins/codiel/assets/rules/codiel.md` を雛形として、`/codiel:init` が `.claude/rules/codiel.md` に置く。`CLAUDE.example.md` は、置き場の地図と入口のコマンドだけを持つ「## Codiel」のセクションにする(決定 70)。`/codiel:init` と `/codiel:run` の初期化の判定(B)は、`.claude/rules/codiel.md` が在ることと、CLAUDE.md に行全体が(前後の空白を除き)`## Codiel` と一致する行があることで行う。旧見出し「## Codiel ハーネス運用ルール」は前方一致でも満たさない。
- `plugins/codiel/docs/DESIGN.md` と `README.md` を intent 駆動の run に書き換える。
- `plugins/codiel/README.md` には「metatron を導入すると `/metatron:init` と `/metatron:update` が `[ADR 候補]` を ADR へ移し、持続層を参照形に縮める」という内容だけを書く(§6.4.3)。手動で移す手順は書かない。

### 6.10 metatron との独立性

codiel と metatron は、どちらか一方だけを導入した環境でも、それぞれの機能が成り立つ(決定 38)。このセクションは両方向の依存を列挙し、相手が無いときの振る舞いを 1 行ずつ定める。

#### 6.10.1 codiel → metatron

「metatron が無い」は、§0 の解決で ARCHITECTURE が見つからない状態(`architecture_missing`)を指す。未導入と未初期化を区別しない。

| 依存 | metatron が有るとき | 無いときの縮退先 | 定める箇所 |
| --- | --- | --- | --- |
| `metatron.config.json` による ARCHITECTURE / GOTCHAS のパス解決 | 設定のパスを使う | 既定パス(`docs/ARCHITECTURE.md` / `docs/GOTCHAS.md`)。解決は codiel の `lib.ts` が独立に実装しており、metatron のコードを呼ばない | `lib.ts` の `resolveDocPaths`(既存) |
| ARCHITECTURE のドメインマップ | `mapped` で境界を課す | `unscoped` で実行する(ユーザー確認つき)。持続層の領域名は intent フェーズでユーザーと合意する | `orchestrating-runs` §0(既存)、§6.4.1 |
| ARCHITECTURE と GOTCHAS を作業の前提として読む | 委譲先が読む | 読まない。依頼文の前提欄に「なし」と書く | `orchestrating-runs` §3 の依頼文テンプレート(既存) |
| metatron の SessionStart による ARCHITECTURE / GOTCHAS の注入 | メインセッションに注入される | 注入は無い。codiel は注入に頼らず、§0 で解決したパスを依頼文で渡す | `orchestrating-runs` の §0 と依頼文テンプレート(決定 59) |
| GOTCHAS への記録(metatron の CLI `append-gotcha`) | CLI で台帳へ追記する | 台帳へ書かず、run の `reports/`(run が無ければ `.codiel/reports/`)へ「未記録の GOTCHAS」として退避し、完了報告にも載せる | `orchestrating-runs` の「失敗の記録」(決定 58) |
| ARCHITECTURE の更新(`/metatron:update`) | 乖離を報告し、所有者の更新へ渡す | 乖離を報告に残すだけにする。codiel は ARCHITECTURE を作らない | `orchestrating-runs` の依頼文テンプレートと finalize の「乖離」(決定 59) |
| ADR | metatron の ADR。持続層には番号参照だけ | 持続層に `[ADR 候補]` の全文(§6.4.2〜§6.4.3)。後で metatron を導入すると、metatron の init / update が ADR へ移して縮める(§6.11) | `intent-format.md`、`syncing-intents` |
| ADR の 3 条件(`writing-discipline.md:69-73`) | metatron の定義を使う | codiel の `intent-format.md` の写しを使う | `intent-format.md`。写しの追随は `plugins/codiel/docs/format-change-checklist.md` と metatron の `format-change-checklist.md` の双方に 1 行ずつ載せる |
| rules(`conventions.md` 等)を生成物の方式の根拠に読む(§6.6.1) | `.claude/rules/**` の rules を読む | `CLAUDE.md` などプロジェクトの指示書を読む。定めが無ければ方式 b | `writing-dev-plans` |
| metatron `config-schema.md` の `docs/intents/domains/<領域>.md` 行 | metatron の既定パス表に載る | 影響なし。置き場の正本は codiel の `intent-format.md` であり、metatron の行はそれを参照する記載にとどまる | `intent-format.md`、`config-schema.md` |
| metatron の保護 hook(ARCHITECTURE・GOTCHAS・rules の直接編集を拒否) | 効く | 効かない。codiel はもともとこれらを直接編集しない | 縮退不要(codiel はこれらのファイルを直接編集しないので、hook が無くても振る舞いが変わらない) |
| 2 者比較テスト(§8.3) | テストが metatron の `src/` を import する | 実行時の依存ではない(§6.10.3) | 縮退不要(テストはこのリポジトリでだけ走り、配布される codiel の動作に関わらない) |

rules の読み先について、codiel の `lib.ts` は metatron の `paths.rulesDir` の設定を解決しない。そのため dev-plan の担当には、docRoot 配下の `CLAUDE.md` と `.claude/rules/**/*.md` を読ませる。`paths.rulesDir` を `.claude/rules/` の外へ向けた構成では rules を読み落とすが、そのときは方式 b に倒れ、生成物が別コミットになるだけで run は壊れない。

#### 6.10.2 metatron → codiel

今回 metatron 側に入れる変更は次のとおりで、どれも metatron の単独動作に codiel を要求しない。

metatron の持続層の走査は、codiel がドメインマップを在れば読み、無ければ `unscoped` で進む構造と対称の任意連携である。`docs/intents/domains/` が無ければ何もしないので、codiel を導入していない環境で metatron の動作は変わらない。連携はファイル契約(`[ADR 候補]` の書式と参照形)だけで行い、metatron は codiel のコードを呼ばない。

| 変更 | metatron の単独動作への影響 |
| --- | --- |
| `config-schema.md` の既定パス表に `docs/intents/domains/<領域>.md` の行を足す | 文書の記載である。このパスを読むのは `scan-adr-candidates` だけで、ディレクトリが無ければ空を返す |
| CLI `scan-adr-candidates` と `shrink-adr-candidate` の新設(§6.11) | `stage-adr` と `commit-architecture` は変えない。走査の結果が空なら、init と update の手順は現行と同じ流れになり、`shrink-adr-candidate` は呼ばれない |
| `capturing-architecture` と `updating-architecture` に走査の手順を足す(§6.11.3) | 候補が 0 件なら提示を省く。利用者から見える変化は無い |
| `architecture-format.md:84` の読み手表を `codiel check-intent-env` に | 読み手の列挙だけである。metatron はドメインマップを自分で読み、読み手の有無に依存しない |
| `config.ts:8-9`、`config.test.ts:241` のコメントの §13 → §14 | コメントだけである |
| `section-reference-inventory.json` の登録簿を codiel の移設先へ | このリポジトリの登録簿テスト用の fixtures である。配布される metatron の実行時の動作に関わらない |

metatron の `src/` は codiel の `src/` を import していない(現状。`grep` で確認)。本改修でも足さない(A5-2)。

#### 6.10.3 テスト時だけの依存と、禁止依存との関係

ARCHITECTURE は「実装層は他プラグインの `src/` を import しない」と定める(`harness-docs/ARCHITECTURE.md:48`)。2 者比較テストは codiel の `__test__/` から metatron の `loadConfig` / `extractDomains` を相対パスで import する。

本設計はこの import を、実行時の依存ではなくテスト時だけの依存として扱う。根拠は次の 2 つの既存の構造である。

- sandalphon のケース 16f は、sandalphon の `__test__/` から codiel と metatron の `src/` を相対 import していた(`plugins/sandalphon/src/__test__/check-intent-env.test.ts:7-16`)。コメントは「sandalphon の実行時に metatron / codiel を参照することはない」と明記する。
- codiel の `lib.test.ts` も、同じ目的で metatron の `src/` を相対 import している(`plugins/codiel/src/hooks/__test__/lib.test.ts:6-9`。「codiel の実行時に metatron を参照することはない(テストコード限定)」)。

`__test__/` はバンドルのエントリに入らない(`build.ts` のエントリは hooks・CLI・lib だけ)。配布される `scripts/*.mjs` に metatron のコードは含まれず、metatron を導入していない環境でも codiel は動く。テストはこのリポジトリ(両プラグインが同居する)でだけ実行される。

ARCHITECTURE の文言は、テストコードを除外すると明記していない。本設計は上の 2 例に倣うが、文言の整理は範囲外とし §13 に記録する。

### 6.11 metatron による `[ADR 候補]` の移送と縮約

metatron が無い環境で持続層に全文で残した `[ADR 候補]` は、後から metatron を導入して ADR にしたとき、持続層を縮めないと ADR と二重に管理される。移送と縮約は ADR の規律の持ち主である metatron が、導入の時点(init)と以後の更新(update)で行う(決定 40)。

#### 6.11.1 走査の対象

- 対象は `<repoRoot>/docs/intents/domains/*.md` である。repoRoot は、docRoot から `git rev-parse --show-toplevel` で求める。git リポジトリでないとき、または git が無いときは走査しない。
- ディレクトリもファイルも無ければ、何もしない。
- `adrTarget` が `metatron` の codiel の run は候補を作らない(§6.4.3)。そのため update が見つける候補は、metatron の導入前に作られたものと、metatron が外れていた期間に作られたものだけである。

#### 6.11.2 CLI

| コマンド | 区分 | 入出力 |
| --- | --- | --- |
| `scan-adr-candidates`(新設) | 読 | `{ candidates, warnings }` を返す。`candidates` の各要素は、ファイル・候補 ID・見出し・タイトル・制約・決定日・出典 intent の列・5 つの小見出しの本文・内容のハッシュ・`adoptedAs` を持つ。`adoptedAs` は、ADR の本文に `ADR 候補 ID: <候補 ID>` の行が完全一致で存在するときその番号、無ければ `null`。行の完全一致で判定し、部分文字列でもタイトルの一致でも判定しない(`frontend-1` の候補に `ADR 候補 ID: frontend-10` は一致しない)。対象が無ければ `candidates: []` で 0 で終わる。5 つの小見出しが揃わないエントリ、候補 ID の無い印、同じファイルで重複した候補 ID は候補にせず、`warnings` に載せる |
| `stage-adr --input <path>` / `commit-architecture --staging-id <id>`(変更しない) | 段階・書 | 持続層には触れない。現行の staging は 1 ファイル・docRoot の中・全文のハッシュを前提にしており、docRoot の外にありうる持続層を含めない。`commit-architecture` は ADR だけを確定する |
| `shrink-adr-candidate --file <path> --candidate-id <候補 ID> --adr <ADR-NNN> --hash <走査の hash>`(新設) | 書 | 縮約を行う唯一のコマンド。`--hash` は `scan-adr-candidates` が返したエントリの範囲のハッシュで、§6.11.4 の手順 2 で走査のときの値と照らすために必須とする(実装時に追加)。手順は §6.11.4。成功と「既に参照形」は 0、拒否と失敗は終了コード 3 と `shrinkPending: { file, candidateId, adr }` を返す |

`references/cli-usage.md` に 2 つの新設コマンドを載せ、`shrink-adr-candidate` の終了コード 3 を書く。終了コード 3 は metatron の既存の値(0 成功・1 拒否・2 使い方の誤り。`src/cli/output.ts`)と重ならない、縮約の失敗専用の値とする。

#### 6.11.3 スキルの手順

- `updating-architecture`: 検出のステージで `scan-adr-candidates` を呼び、候補を乖離の候補と並べて提示する。承認された候補は、既存の `## ADR` の規律(`diff-architecture`・`get rules`・草案の第三者検査)を通して ADR の草案にする。草案の `#### 背景` には、候補の `出典 intent` のパスと候補 ID を書き写す。候補 ID は `ADR 候補 ID: <候補 ID>` の 1 行で書き、文言を変えない。次の走査の `adoptedAs` の判定はこの行で行う。候補にない `決定者` はユーザーに聞く。ADR は既存の `stage-adr` → `commit-architecture` で確定させ、その後に `shrink-adr-candidate` を呼ぶ(§6.11.4)。
- `capturing-architecture`: 初版の ARCHITECTURE を `commit-architecture` した後(`SKILL.md` の手順 7 の後)に `scan-adr-candidates` を呼ぶ。候補があれば、`updating-architecture` の `## ADR` の規律で ADR にする。ARCHITECTURE が確定する前に ADR を足さない。
- どちらのスキルも、候補が 0 件なら何も提示しない。
- `adoptedAs` が `null` でない候補は、ADR を作らず `shrink-adr-candidate` で縮約だけを提案する。前回の縮約が失敗して残ったものである(§6.11.4)。ADR の草案でタイトルを変えていても、候補 ID で見つかる。
- 却下された候補と、ADR の作成に失敗した候補は、持続層に全文のまま残す。

#### 6.11.4 確定と縮約の順序

順序は「ADR の確定 → 縮約」とし、2 つを別のコマンドで行う。

1. スキルが既存の `stage-adr` → 承認 → `commit-architecture` で ADR を確定させる。ADR の `#### 背景` には `ADR 候補 ID: <候補 ID>` の行が入る。ここで失敗したら持続層には触れず、候補は全文のまま残る。
2. スキルが `shrink-adr-candidate --file <path> --candidate-id <候補 ID> --adr <ADR-NNN>` を呼ぶ。コマンドは次の順に動く。
   1. 書き込み先が repoRoot の `docs/intents/domains/*.md` であることを確かめる。docRoot の外でもよい。ほかのパスは拒否する。
   2. そのときのファイルの内容を読み、候補 ID でエントリを特定する。既に参照形なら何もせず 0 で終わる(冪等)。
   3. `ADR-NNN` が ARCHITECTURE に在り、その本文に `ADR 候補 ID: <候補 ID>` の行が完全一致で存在することを確かめる。
   4. エントリの範囲(§6.4.2)の内容のハッシュを、走査のときの値と照らす。
   5. そのエントリの範囲だけを参照形に置き換えた内容を、一時ファイルへの書き込みと rename で書く。同じファイルのほかの候補、ほかのエントリとセクションは変えない。
   6. 3〜5 のどれかで拒否または失敗したら、何も書かずに終了コード 3 と `shrinkPending: { file, candidateId, adr }` を返す。
3. 2 が終了コード 3 で終わったら、スキルは `shrink-adr-candidate` を 1 回だけやり直し、それも失敗したらユーザーに報告する。ADR の本文には候補 ID の行が入っているので、残ったエントリは次の走査で `adoptedAs` 付きの候補として見つかり、縮約だけが提案される(§6.11.3)。

`shrink-adr-candidate` は毎回そのときのファイルの内容を読むので、同じファイルの 2 つの候補を順に縮約しても、先に縮約したエントリが後の書き込みで印付きに戻ることはない。

ADR を先に確定させるのは、候補の本文を失わないためである。縮約を先にすると、ADR の書き込みに失敗したとき背景と検討した選択肢が消える。縮約が失敗した間は ADR と全文の候補が並ぶが、候補 ID で検出でき、次の走査で縮約だけを提案するので、この状態は残り続けない。

#### 6.11.5 書き換えの範囲と書式の写し

- metatron が持続層に行ってよい書き換えは、`[ADR 候補]` の印付きエントリを参照形へ縮めることだけである。エントリの範囲(§6.4.2)の外は、1 バイトも変えない。ファイルの作成・削除、ほかのエントリやセクションの編集はしない。
- `[ADR 候補]` の書式と参照形は、codiel と metatron の共有ファイル契約である。正本は `plugins/codiel/references/intent-format.md` に置く。
- metatron は `plugins/metatron/references/architecture-format.md` に「ADR 候補の取り込み」のセクションを設け、読み取りと縮約に要る最小限(候補 ID つきの印の形、候補 ID の書式、エントリの範囲、5 つの小見出しの名前、参照形、ADR の背景に書く `ADR 候補 ID:` の行の形)だけを写す。採番の規則は codiel だけが使うので写さない。正本が codiel にあることをセクションの冒頭に書く。
- 両プラグインの `format-change-checklist.md` に、相手の写しを追随させる行を 1 行ずつ足す。`config-schema.md` の運用と同じである。
- `plugins/metatron/README.md` に、init と update が持続層を走査して ADR 候補を移す挙動を書く。

### 6.12 執筆規則

#### 6.12.1 文書の種類と規則の対応

読者と目的が違う 3 種の文書に、別々の規則を当てる。

| 文書 | 主な読者 | 規則の正本 |
| --- | --- | --- |
| ARCHITECTURE・GOTCHAS・ADR・rules | 毎セッション注入を受ける AI | metatron `references/writing-discipline.md`(§6.12.5) |
| 変更 intent・持続層・intent 草案 | 後で変更する人と AI | codiel `references/intent-writing.md`(§6.12.2) |
| Issue・PR・それぞれのコメント・レビュー本文 | 人間 | codiel `references/github-writing.md`、gh-utility の同等のファイル(§6.12.3、§6.12.6) |

3 つの規則は、文の組み立て(言い切り、1 文 1 義、箇条書きと散文の使い分け、強調をしない、例の置き方、最も短い文で書く)を prompt-smith の現行規律(`plugins/prompt-smith/skills/prompt-smith/SKILL.md`)に揃える。違うのは、根拠・背景・出典をどこまで残すかと、画像を載せるかである。

各規則のファイルは、文の組み立ての規則を自分の本文に書く。prompt-smith を参照して読ませる形にしない。`harness-docs/ARCHITECTURE.md:50` が指示層と参照層に他プラグインの名前を書くことを禁じ、例外は codiel・metatron・gh-utility の間の言及だけであるためである。prompt-smith の規律が変わったときに追随させる行は、codiel・metatron・gh-utility それぞれの開発者向けの文書(`docs/`)に置く。`docs/` は指示層でも参照層でもないので、prompt-smith の名前を書いてよい。

#### 6.12.2 Intent 文書の執筆規則(`intent-writing.md`)

- 適用範囲は、変更 intent、持続層、triage が local モードで書く intent 草案である。
- 文の組み立ては prompt-smith の現行規律に従う。
- 根拠と背景は、過剰なものは削り、必要なものは残す。基準は次のとおりで、この表を規則の本文に載せる。

| 扱い | 対象 |
| --- | --- |
| 残す | 制約を意図して置いたと分かる理由(後の変更者が偶然の制約と区別するため) |
| 残す | 合意済み事項がその選択肢に決まった理由 |
| 残す | 適用範囲や優先順位を判断する材料になる理由 |
| 削る | 議論の経過の語り |
| 削る | 実測値の詳細(結論と出典への参照だけを残す) |
| 削る | 採らなかった案の長い説明(理由 1 行だけを残す) |
| 削る | 同じ理由の言い換え |

- 引用・出典は削らず、文書の末尾の `## 出典` セクションにまとめる。無ければ「なし」と書く。
- 原文のセクション(変更 intent の `## ASIS` と `## TOBE`)には、この規則の削る基準も文の組み立ての規則も当てない。ユーザーの言葉を原文のまま保つ。規則を当てるのは派生文のセクションと記録のセクションだけである。この内容を規則の本文に「原文のセクションには削る基準を当てず、ユーザーの言葉を原文のまま保つ」と「原文のセクションには文の組み立ての規則も当てない」の 2 文で載せる。
- 持続層には原文のセクションを置かない。原文は変更ごとの intent にだけ置く。triage の intent 草案は書式 v2 に従って原文のセクションの見出しを持つが、ユーザーの言葉が無いので未記録のマーカー `<!-- codiel:unrecorded -->` を置く(§6.3.3、§6.5.2)。
- `## 出典` は、変更 intent の書式 v2(§6.3.3)と持続層の書式(§6.4.2)の最後のセクションである。書式契約の変更なので、codiel の `format-change-checklist.md` の追随先(契約文書の上書き記録 §7.5、metatron の `architecture-format.md` の写しの確認)に沿って揃える。

#### 6.12.3 GitHub の Issue・PR・コメントの執筆規則(`github-writing.md`)

- 適用範囲は、codiel が書く Issue(triage、intent 承認時の任意の起票)・PR 本文・PR と Issue のコメント・レビュー本文である。
- intent を Issue に転記するとき(§6.3.5)、原文のセクションは Intent 文書の規則と同じく原文のまま写し、この規則で簡潔にしない。
- 構成は Intent 文書の執筆規則(§6.12.2)に従う。そのうえで次の 3 文を規則の本文に載せる。
  - 「必要な情報を 100% 落とさずに、人が読みやすくなるよう可能な限り簡潔に書く。」
  - 「テストの結果得たスクショなど、関連する画像を本文に載せる。」
  - 「引用・出典は削らず末尾にまとめる。」
- 画像の載せ方は §6.12.4 に従う。
- run が active な間に投稿する本文には、`<!-- codiel:generated -->` を含める(§6.3.5)。この規則を「`<!-- codiel:generated -->` を本文に含める」の文で規則の本文に載せる。付け忘れると hook に deny される(§6.8)。
- 本文は Write ツールで run の `reports/` に投稿ごとに別名のファイルで書き、別の Bash 呼び出しで `--body-file` で渡す(決定 66)。gh の `--template` / `-T`・`--fill` 系・`--web` は使わない(決定 64・66)。この 2 点は、マーカーの項と同じく gh-utility へ写さない(§6.12.6)。

#### 6.12.4 画像の載せ方

事実(2026-09-27 に確認):

- `gh` の `--attach` は v2.99.0(2026-09-01)以降、`issue create` / `issue edit` / `issue comment` / `pr create` / `pr edit` / `pr comment` の 6 コマンドにだけある。`gh pr review` には無い(出典: https://github.com/cli/cli/releases/tag/v2.99.0 、https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)。
- 本文に `![alt](./file.png)` を書き、同じパスを `--attach` に渡すと、本文の参照が `https://github.com/user-attachments/assets/<uuid>` に差し替わる。書き込み権限が要り、GHES では使えない。画像は 10 MiB までで、アップロードは取り消せない。
- 公式の GitHub MCP にアップロードのツールは無い(https://github.com/github/github-mcp-server/issues/738 は open)。
- この作業環境の `gh` は 2.45.0 である。

縮退の順序は、文書の種類で 2 系統に分かれる。手段が使えるかは codiel では state の `imageUpload`(§6.2.1)で引き、gh-utility では実行時に判定する。

| 順 | Issue・PR・コメント全般 | レビュー本文(`gh pr review`) |
| --- | --- | --- |
| 1 | `gh` 2.99.0 以上で、リモートのホストが `github.com` か `*.ghe.com` なら `--attach` で載せる(GHES では使わない) | claude-in-chrome MCP(`mcp__claude-in-chrome__*`)が使えれば、ブラウザから GitHub に画像をアップロードし、得た `https://github.com/user-attachments/assets/*` の URL をレビュー本文に書く |
| 2 | claude-in-chrome MCP が使えれば、ブラウザからアップロードして得た URL を本文に書く | `gh` 2.99.0 以上でホストが `github.com` か `*.ghe.com` なら、画像付きの本文を `gh pr comment --attach` で投稿し、承認・変更要求の判定だけを `gh pr review` で行う |
| 3 | どちらも使えなければ、画像をローカルに保存し、本文に添付できなかった理由と保存パスを書く | 同左 |

- `--attach` を使うのは、`gh` が 2.99.0 以上で、かつ `origin` のホストが `github.com` か `*.ghe.com` のときだけである(ユーザー決定)。GHES のホストでは `--attach` を使わず、次の順へ縮退する。gh-utility も実行時に同じ条件で判定する。
- ローカルの保存先は、codiel では run の `reports/`、gh-utility では利用者に示すパスとする。
- local モードの codiel は、常に 3 を採る。
- アップロードは取り消せない外部公開行為である。画像の可視性はリポジトリの可視性に従い、private リポジトリの画像は閲覧権限のある人にだけ見える。この内容を規則に書き、公開してよい画像かを載せる前に確かめる。
- claude-in-chrome の具体的な操作手順(GitHub のどの画面でファイルを選ぶか、URL をどう取り出すか、未投稿の下書きをどう破棄するか)とログインの前提は、設計書に書かない。実装計画の E2E 確認項目として引き継ぐ(§10)。設計書が定めるのは、ブラウザが使えてログイン済みであるという前提と、操作に失敗したら次の順へ縮退することだけである。

#### 6.12.5 metatron の執筆規律の追随

`plugins/metatron/references/writing-discipline.md`(最終更新 `55fd70c`、2026-09-15)は、prompt-smith の正本(`plugins/prompt-smith/skills/prompt-smith/SKILL.md`。`10f11ee`、`8f7378a`、`57927a1` で改訂)から遅れている。次をすべて移す(ユーザーが 2026-09-27 に全移植を決定)。

| 項目 | metatron の現行 | 移した後 |
| --- | --- | --- |
| 理由の扱い | 根拠・理由をすべて削る(`:7`) | 実測値など指示を正当化する根拠は削る。適用範囲や優先順位を判断する材料になる理由は、短く 1 か所にまとめて残す(prompt-smith `:23`、`:45`) |
| 例 | 2 つ目以降を削る(`:12`、`:53`) | 性質の同じ例だけを 1 つに絞り、性質の違う例は削らない。判断を示す例は性質の違うものを 2 つ以上置く(`:29`、`:55`) |
| 簡潔さ | 極力簡潔に(`:23`) | 残す基準に当たる内容を保てる範囲で、最も短い文で書く(`:50`) |
| 強調 | 定めなし | 太字・`IMPORTANT`・「絶対に」で強調せず、条件と範囲で重さを伝える(`:53`) |
| 出力の形を示す例 | 定めなし | 例示であることと、値を実際の内容に置き換えることを明記する(`:54`) |
| 禁止の書き方 | 「〜にせず、〜する」を併記 | 「やむを得ず禁止を書くときは」の条件を足す(`:52`) |
| 見出しの概要 | 箇条書きにしない、だけ | 見出しの概要や 1 文だけの指示は、その見出しの直下に書く(`:58`) |
| 散文の使いどころ | 定めなし | 箇条書きにすると文脈が破綻する箇所は散文で書く(`:61`) |
| 引くための記述の例外 | 定めなし | 見分け方(`:30-38`)とともに移す。効くのは ARCHITECTURE と rules の、値を引く先のブロック(技術スタックの表、ドメインマップ、コマンド定義など)だけとする |

維持する特化は次のとおりである。

- 適用の強さ(削る基準を強く当てるセクションと、根拠系フィールドの例外)。
- 根拠系フィールドの例外の範囲(`## 例外の範囲`)。
- GOTCHAS エントリを 1〜3 文に収めること。
- GOTCHAS エントリに引くための記述の例外を当てないこと(全文が毎セッション注入されるため。`:60` の「引くための記述だから通読させない」を理由に簡潔化を外さない)。
- ADR の 3 条件(`## 何を ADR にするか`)。
- 図の基準。

持ち込まないものは、評点表と退避である(`harness-docs/design/2026-08-16-metatron-design.md:793`)。

- 規律を機械的に検査するコードは metatron に無い。波及は、`skills/{capturing-architecture,updating-architecture,recording-gotchas}/SKILL.md` と `references/{gotchas-format,rules-format}.md` からの参照だけである。参照の文言が変更後のセクション名と合うかを確かめる。
- metatron の `format-change-checklist.md` に、writing-discipline を prompt-smith の規律に追随させるセクションを足す。prompt-smith の SKILL.md を改訂したら、このセクションに沿って writing-discipline を見直す。
- この変更は metatron のマイナー(`0.4.0-dev`)に含める。
- あわせて、ADR の書き方の基準を新しいセクション「## ADR の書き方」として足す(決定 71)。既存の「## 何を ADR にするか」は ADR にするかの判断を定め、新しいセクションは書き方を定める。

#### 6.12.6 gh-utility への写し

- gh-utility に GitHub の執筆規則と画像の載せ方を独立に置く。置き場は `plugins/gh-utility/references/` の新しいファイルとし、名前は計画書で確定する。既存の `references/github-issue-common.md` にセクションとして足してもよい。
- 内容は §6.12.3〜§6.12.4 と同じ規則である。codiel を参照せず、codiel の名前も書かない。
- 投稿する本文のマーカー(§6.12.3 の最後から 2 番目の項)と、本文ファイルの書き方(§6.12.3 の最後の項)は写さない。gh-utility の投稿にはマーカーを付けない。テンプレートの扱い(§6.12.7)も写さない。gh-utility の `issue-craft` はテンプレートを利用者に選ばせる独自の手順を持つ。
- codiel の run が active なセッションで gh-utility のスキルから本文を投稿すると、マーカーが無いので codiel の hook に deny される(§6.8)。codiel は run の間に gh-utility を起動しない。intent 承認時の任意の起票は run の作成前に行うので、この制限に当たらない。利用者が run の間に gh-utility を使うと deny されることは、codiel の README に書く。
- Issue やコメントを書くスキル(`issue-craft`・`issue-split`・`issue-triage`)のすべてが、このファイルを読む指示を持つ。
- gh-utility は state を持たないので、画像の手段は実行時に判定する(`gh --version`、`remoteHost`、セッションで claude-in-chrome のツールが使えるか)。ローカル保存の場合は保存パスを利用者に示す。
- gh-utility の `src/check-issue-env.ts` も、codiel と同じく `*.ghe.com` を受ける(決定 46)。`repoSlug` の正規表現を `github.com` と `<名前>.ghe.com` を受ける形に改め、出力に `remoteHost` を足し、認証を `gh auth status --hostname <remoteHost>` で確かめる。codiel とは独立実装なので、codiel のコードを使わずに個別に直す。
- 同じ規則を codiel と gh-utility が別々に持つので、どちらかを変えたらもう一方を追随させる。codiel の `format-change-checklist.md` と、gh-utility の文書(置き場は計画書で確定)に追随の行を足す。
- gh-utility は `0.5.2-dev` から `0.5.3-dev` に上げる。

#### 6.12.7 Issue・PR のテンプレート

リポジトリの Issue・PR のテンプレートは、スキルが読んで本文の構成に使う(決定 65)。gh の `--template` / `-T` は使わない。gh 2.101.0 は TTY の無い環境で `-T` を拒み、`-T` と `--body` / `--body-file` の併用も拒むので、テンプレートを使えるのはスキルが読んで写す経路だけである。

- PR: pr フェーズで、単一ファイルのテンプレートを探す。対象は `.github/`・リポジトリのルート・`docs/` の `pull_request_template.md` / `.txt` で、大文字小文字を区別せず、この順に最初に見つかったものを使う。`PULL_REQUEST_TEMPLATE/` 配下にしか無いときは使わない。GitHub の Web 画面も、`?template=` の指定が無ければそれらを適用しないためである。
- テンプレートを使うときは、見出しの構成を保ち、記入の案内の HTML コメントを消す。codiel のマーカー(`<!-- codiel:generated -->` など)は消さない。codiel が必ず書く項目(intent のパス、`Closes #<N>`、画像、`## 出典`)に当たる見出しが無ければ末尾に足す。
- 同意・署名・人の確認を表すチェックボックス(行動規範への同意、CLA の署名、「テストした」など)は付けずに残し、人が確かめる項目であることを本文に書く。マーカーは描画されないので、付けると人が同意したように見えるためである。
- 後続 Issue(triage): `filing-followup-issues` の既存の `.github/ISSUE_TEMPLATE` の探索と展開を使う。探索から `config.yml` を除き、チェックボックスは上と同じ規則にする。
- intent-issue: gh-utility `issue-craft` の持ち込みモード(テンプレートの選択と、見出しが衝突したときの 3 択)と、`intent-common.md` の自前起票の 3 択のまま据え置く。テンプレートの項目を本文の末尾へ自動で足す既定は作らない。人が後で埋めた欄は、マーカーのある本文の中なので派生として扱われ、原文から落ちるためである。
- 本文ファイルは Write ツールで `.codiel/runs/<slug>/try-<n>/reports/` に投稿ごとに別名で書き(PR は `pr-body.md`)、`review-<n>.md` と同じく run ブランチにコミットしてから投稿する(決定 67)。コミットしないと、次の try の pr フェーズの開始時の `git status --short` に未追跡の行が残る。
- org やアカウントの `.github` リポジトリに置いた既定のテンプレートはローカルに無いので使わない。

---

## 7. 撤去と波及

### 7.1 sandalphon の資産の行き先

| 資産 | 行き先 |
| --- | --- |
| `skills/capturing-intent/SKILL.md` | `plugins/codiel/skills/capturing-intent/SKILL.md`(改修) |
| `skills/bridging-execution/SKILL.md` | 廃止。起票の手順だけ capturing-intent のゲート(§6.1.3)へ |
| `skills/executing-intent/SKILL.md` | 廃止 |
| `commands/run.md` | 廃止 |
| `references/intent-format.md` | `plugins/codiel/references/intent-format.md`(v2) |
| `references/handoff-contract.md` | `plugins/codiel/references/handoff-contract.md` |
| `references/sandalphon-common.md` | `plugins/codiel/references/intent-common.md`(必要なセクション) |
| `docs/rationale.md` | `plugins/codiel/docs/DESIGN.md` に統合 |
| `docs/format-change-checklist.md` | `plugins/codiel/docs/format-change-checklist.md` |
| `evals/capturing-intent.json` | `plugins/codiel/evals/capturing-intent.json`(M2 で削除。決定 54) |
| `evals/bridging-execution.json` / `executing-intent.json` | 廃止 |
| `src/check-intent-env.ts` | `plugins/codiel/src/check-intent-env.ts`(config 解決は lib.ts へ寄せる) |
| `src/__test__/check-intent-env.test.ts` | `plugins/codiel/src/__test__/check-intent-env.test.ts`(§8.3) |
| `src/testing/run-ts.ts` | 廃止。codiel に同名ファイルがある(`plugins/codiel/src/testing/run-ts.ts`) |
| `package.json` / `build.ts` / `scripts/` / `.claude-plugin/` / `README.md` | 廃止 |

### 7.2 リポジトリ共通の波及

| 対象 | 変更 | 手段 |
| --- | --- | --- |
| `.claude-plugin/marketplace.json` | sandalphon のエントリを削除 | Edit |
| `.claude/settings.json:62` | `enabledPlugins` から `sandalphon@amatsuka-claude-plugins` を削除 | Edit |
| `.claude/skills/session-handover/evals/session-handover.json:21` | クエリ文の sandalphon を現存するプラグイン名に置き換える。eval の意図(発火しないクエリ)は変えない | Edit |
| `README.md`(ルート) | sandalphon のセクションを削除し、codiel のセクションを intent 駆動に書き換える | Edit |
| `pnpm-workspace.yaml` | `plugins/sandalphon` を削除し、`pnpm install` を実行 | Edit |
| `harness-docs/ARCHITECTURE.md:50` | 「4 プラグイン同士」を `codiel` `metatron` `gh-utility` の 3 プラグインに | `/metatron:update`。ADR-003 の本文は記録として残す |
| `.claude/rules/metatron/protected-paths.md:21` | 「3 プラグインの独立実装」「3 者比較テスト」を 2 実装・2 者比較に | metatron `stage-rules` → `commit-rules` |
| `.claude/rules/metatron/protected-paths.md:22` | intent 書式契約の行を `plugins/codiel/references/intent-format.md` と `plugins/codiel/docs/format-change-checklist.md` に | 同上 |
| `plugins/sandalphon/` | ディレクトリの削除 | ユーザーが手で実行する(§7.7) |

### 7.3 metatron の追随

`plugins/metatron/docs/format-change-checklist.md` の該当セクションに沿って追随させる。

| ファイル | 変更 |
| --- | --- |
| `references/config-schema.md` | 既定パス表(`:86-91`)に `docs/intents/domains/<領域>.md`・基準 `repoRoot`・設定なしの行を足す |
| `references/architecture-format.md:84` | 読み手 `sandalphon check-intent-env` を `codiel check-intent-env` に |
| `references/architecture-format.md` | 「ADR 候補の取り込み」のセクションを足す(M3。§6.11.5) |
| `references/cli-usage.md` | `scan-adr-candidates`・`shrink-adr-candidate` と、`shrink-adr-candidate` の終了コード 3 と `shrinkPending` を載せる(M3。§6.11.2) |
| `skills/updating-architecture/SKILL.md` / `skills/capturing-architecture/SKILL.md` | 走査と候補の提示の手順(M3。§6.11.3) |
| `src/`(CLI と `src/lib/adr.ts` 周辺)とテスト | 走査・staging の拡張・縮約の実装(M3。§6.11.2、§6.11.4)。置き場は計画書で確定する |
| `docs/format-change-checklist.md` | ARCHITECTURE 書式のセクションの sandalphon 行と、config のセクションの 3 者比較を codiel と 2 者比較に。ADR の 3 条件(`writing-discipline.md` の「何を ADR にするか」)を変えたら codiel `references/intent-format.md` の写しを追随させる 1 行を足す。ADR 候補の取り込みのセクションを変えるときは codiel の正本と揃える 1 行を足す(M3。§6.10.1、§6.11.5) |
| `docs/ARCHITECTURE.example.md:106` | 読み手の列挙を追随 |
| `README.md:116-118` | sandalphon のセクションを削除し、codiel のセクションへ統合する。init と update の持続層の走査の挙動を書く(M3) |
| `src/lib/config.ts:8-9` | コメントを追随し、「契約 §13」を「契約 §14」に |
| `src/lib/__test__/config.test.ts:241` | 「契約 §13」を「契約 §14」に |
| `src/fixtures/section-reference-inventory.json:148-160` | sandalphon の 3 エントリを codiel の移設先へ置き換える |
| `.claude-plugin/plugin.json` / `package.json` | M1 でパッチ、M3 でマイナーを上げる(§9) |
| `references/writing-discipline.md` | prompt-smith の現行規律に追随させる(M3。§6.12.5) |
| `docs/format-change-checklist.md`(writing-discipline のセクション) | writing-discipline を prompt-smith の規律に追随させるセクションを足す(M3。§6.12.5) |
| `skills/{capturing-architecture,updating-architecture,recording-gotchas}/SKILL.md`、`references/{gotchas-format,rules-format}.md` | writing-discipline への参照の文言が変更後のセクション名と合うかを確かめる(M3) |

`architecture-format.md:82-87` には、この変更と別に既存の食い違いがある(§13)。本改修では `:84` の読み手名だけを直す。

### 7.4 gh-utility は執筆規則と画像の載せ方だけを足す

`issue-craft/SKILL.md` の `## 持ち込みモード`(`:64-101`)は呼び出し元を「他のスキル・エージェント」と一般化して書いており、sandalphon への言及も契約文書のパスも持たない。呼び出し元が codiel に替わっても、持ち込みモードの本文は変えない。

gh-utility への変更は、GitHub の執筆規則と画像の載せ方の写し(§6.12.6)と、`*.ghe.com` を受ける環境判定(決定 46)である。M2 で行い、`0.5.2-dev` を `0.5.3-dev` に上げる。

| ファイル | 変更 |
| --- | --- |
| `src/check-issue-env.ts` | `repoSlug` の正規表現を `github.com` と `<名前>.ghe.com` を受ける形に改め(`:22` 付近)、出力に `remoteHost` を足し、認証を `gh auth status --hostname <remoteHost>` で確かめる(`:32` 付近) |
| `src/__test__/check-issue-env.test.ts` | `github.com`・`example.ghe.com`・GHES の独自ドメイン・`notgithub.com` のホストで `repoSlug` と `remoteHost` を確かめる。gh のスタブで `--hostname` の引数を確かめる |
| `scripts/`(バンドル) | `pnpm run build` で再生成する |
| `references/` の新しいファイル(または `github-issue-common.md` の新しいセクション) | GitHub の執筆規則と画像の載せ方(§6.12.3〜§6.12.4 と同じ内容。codiel を参照しない) |
| `skills/{issue-craft,issue-split,issue-triage}/SKILL.md` | 上のファイルを読む指示を足す |
| `README.md` | 画像の載せ方と、`gh` 2.99.0 以上・claude-in-chrome の前提を利用者向けに書く |
| `docs/` の文書(置き場は計画書で確定) | codiel の `github-writing.md` と揃える追随の行 |
| `.claude-plugin/plugin.json` / `package.json` | `0.5.3-dev` |

### 7.5 確定版の契約文書の上書き記録

`harness-docs/design/2026-08-16-file-contract-freeze.md` は書き換えない。本設計の承認をもって次を上書きする。

| 契約のセクション | 確定版の記述 | 上書き後 |
| --- | --- | --- |
| 冒頭・適用範囲(`:1-11`) | metatron / codiel / sandalphon の 3 プラグイン | metatron / codiel の 2 プラグイン(gh-utility は持ち込みモードの契約だけ) |
| §3 各実装の担当(`:188-195`) | 3 実装が独立に持つ | metatron と codiel の 2 実装。codiel は `lib.ts` の 1 箇所に集約し、`check-intent-env` はそれを import する |
| §3 codiel における 2 つのルート概念(`:196-207`) | codiel の `docRoot` と `codielRoot` | 変えない |
| §3 sandalphon の 3 基準(`:208-222`) | sandalphon が `repoRoot` / `docRoot` / `codielRoot` を使い分ける | codiel の `check-intent-env` が同じ 3 基準を使い分ける |
| §9 intent 文書の書式(`:526-610`) | v1、status `approved` / `issued` / `done`、`## ASIS` / `## TOBE` は AI の整理 | v2(§6.3)。`## ASIS` / `## TOBE` はユーザーの言葉の原文、AI の整理は `## 現状調査` / `## 要求` へ。正本は `plugins/codiel/references/intent-format.md` |
| §10 intent-issue の書式(`:611-662`) | v1、`issue.md` への写像表あり。マーカーは本文全体から行の完全一致で検知し、未知のバージョンは写像しない | v2 マーカー。原文のセクションも転記する。codiel が起票する Issue には `<!-- codiel:generated -->` を足し、そのマーカーのある Issue は本文を派生として扱う。マーカーの検知の規則(本文全体・行の完全一致・未知のバージョンは写像しない)は変えない。写像表は廃止 |
| §11 持ち込みモードの呼び出し契約(`:663-683`) | 呼び出し元は sandalphon | 呼び出し元は codiel `capturing-intent` |
| §14 実装間の一致検証(`:838-867`) | テスト R4 / sandalphon ケース 16f の 3 者比較 | テスト R4 / codiel `check-intent-env.test.ts` の 2 者比較 |
| §15 チェックリスト(`:868-`) | sandalphon の 3 項目 | codiel の `check-intent-env.ts` / `references/intent-format.md` / `references/handoff-contract.md` |

実装のコメントで 3 者比較を「契約 §13」と書いている箇所は、§14 の誤記である。§3.5 の各行と §7.3 のとおり §14 に直す。

### 7.6 sandalphon の名前を残す箇所(A1-4 の許可リスト)

次のパスは経緯の記録であり、名前を残す。A1-4 の grep は、この許可リストに当たらない一致を 0 件とする。

- `harness-docs/design/**`、`harness-docs/plans/**`、`harness-docs/handover/**`(本設計書を含む)
- `harness-docs/ARCHITECTURE.md`(ADR-003 の本文。`:50` の例外の文は §7.2 で直す)
- `docs/prompts/**`
- `docs/chat/**`
- `plugins/codiel/docs/DESIGN.md`(旧 sandalphon から移したことを記す統合セクション)

`pnpm-lock.yaml` の sandalphon の記述は、§7.2 の `pnpm install` で消える。許可リストには入れない。

許可リストの最終形は計画書の最後の grep 結果で確かめる。許可リストに無いパスで一致が残ったら、許可リストを広げずに該当箇所を直す。

### 7.7 ユーザーが手で行う削除

一括削除はユーザーの手で行う。計画書は次のコマンドを絶対パスで提示し、実行を依頼する。

```
! rm -rf /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development/plugins/sandalphon
```

削除は資産の移設・テストの移設・波及先の追随がすべて終わり、`pnpm run test` が sandalphon の外で成功した後に行う。削除後に `pnpm install` と `pnpm run build` と `pnpm run test` を再実行する。

### 7.8 Serena メモリ

- `sandalphon/core` の内容を `codiel/core` へ統合し、`sandalphon/core` を削除する。統合は `edit_memory`、削除はユーザーの許可を得て `delete_memory` で行う。
- `file_contract` の 3 者比較の記述(`:1-17`、`:19-47`、`:85-94`)を 2 者比較に改める。
- `codiel/core.md:79` の「sandalphon の intent issue を起点にした場合」のセクションを、intent 駆動の run の記述に置き換える。
- `core.md`(`:13`、`:50`、`:68`、`:71`、`:86-88`)、`tech_stack.md:8`、`metatron/core.md:132` の sandalphon の記述を削るか codiel に置き換える。
- M3 の終点で、`metatron/core.md` と `file_contract.md` に、`[ADR 候補]` の走査と縮約(§6.11)、候補 ID による `adoptedAs` の判定、共有ファイル契約が増えたことを足す。
- いずれも `edit_memory` で行う。

---

## 8. 検証

### 8.1 既存テストで書き換えが要るもの

| テスト | 理由 |
| --- | --- |
| `plugins/codiel/src/__test__/codiel-state.test.ts` | `--issue` を `--slug` に、init フェーズを intent に、`STAGES` に intent-sync |
| `plugins/codiel/src/hooks/__test__/guard-bash.test.ts` | run の作り方(`init --issue 1`。`:37` ほか) |
| `plugins/codiel/src/hooks/__test__/guard-write.test.ts` | `DOC_PHASES` の変更、run の作り方 |
| `plugins/codiel/src/hooks/__test__/stop-guard.test.ts` | run の作り方 |
| `plugins/metatron/src/__test__/section-reference-inventory.test.ts` の fixtures | §7.3 |

### 8.2 新規テスト(vitest)

置き場は `.claude/rules/metatron/testing-policy.md` に従う。

| 対象 | テストファイル | 確認すること |
| --- | --- | --- |
| state v2 | `src/__test__/codiel-state.test.ts` | slug の識別子(runDir・branch・raguelRunId)、slug の書式と 40 文字の上限、`integration` と `scale` の必須、local で `--pr-url` なしの `complete-phase pr`、軽量でだけ discuss / design を skip できる、`--intent-only` で `branch` が `null` になる、`branch` が `null` の run で intent 以外の `start-phase` が失敗する、`close` が `completed` にする条件(intent が `passed` でないと失敗する、`branch` が `null` でないと失敗する)、intent-sync が `GATED` にある、`^issue-\d+$` に一致する slug(`issue-12`)を拒否し、`issue-tracker` のような一致しない slug は受け付ける |
| intent 書式 v2 | `src/__test__/check-intent-env.test.ts` | `existingIntents` が `intent: v1` と `intent: v2` の文書をどちらも列挙し、それぞれの `intent` の値を返す(昇格の要否を判断する材料)。原文のセクションの中身は解析しない |
| `adrTarget` | 同上 | `--adr-target` の必須、値域(`metatron` / `intents` 以外を拒否)、state への記録 |
| `imageUpload` | 同上 | `--image-upload` の必須、値の解釈(`gh-attach` / `chrome` / 両方 / `none`、それ以外を拒否)、`integration` が `local` のときは指定にかかわらず両方 `false` |
| `mark-ask --kind` | 同上 | `--kind` を省くと `askKind` が `raguel` になる、`--kind confirm` で `confirm` になる、それ以外の値を拒否する、`resume` の後も `askKind` が残る、finalize で `mark-ask` → `resume` した後に `codiel-state finalize` が成功する、`stop --reason intent-updated` が `stopReason` に記録される |
| v1 の扱い | 同上 | v1 の state で `get` / `stop` 以外が拒否され stderr に §6.2.4 の文言が出る、`get --active` が v1 を `runs` に含めず同じ文言を出す |
| `implement.steps` | 同上 | 登録と更新、`waves` の JSON(`groups` の各要素が `steps` と `mode` を持ち、`final` がある)、トポロジカル順、循環で非ゼロ終了、触るファイルが重なるステップを分ける、lockfile を触るステップが単独の `serial` グループとして依存順の位置に出る、前提が `serial` のステップがその後のグループに出る、`--final` で登録したステップが `final` にだけ出る、`parallel` グループの 4 件の上限、`src/app/**` と `src/apple/**` が重ならない、`src/{a,b}/**` が展開されて `src/a/x.ts` と重なる、`*.ts` と `**/*` が全ステップと重なる、`attempts` がフェーズの `record-attempt` と独立に数えられる |
| guard-bash | `src/hooks/__test__/guard-bash.test.ts` | `issue` が null の run でも 3 つの制限が phase で効く、intent-sync では push を拒否する、v1 の active run だけがあるとき制限が掛からない(run 無しと同じ) |
| guard-bash(マーカー) | 同上 | active run があるとき、7 つの `gh` のコマンドそれぞれで、`--body` と `-b` の本文にマーカーがあれば通り無ければ deny、heredoc で複数行にした本文にマーカーがあれば通る、`--body-file` と `-F` のファイルの中身にマーカーがあれば通り無ければ deny、ファイルが読めなければ deny、`--body-file -` と `-F -` は deny、本文を持たない呼び出し(`gh pr review --approve`、`gh issue edit --add-label bug`)は通る。active run が無いときは、マーカーが無くても通る |
| guard-github-mcp | `src/hooks/__test__/guard-github-mcp.test.ts` | active run があるとき、列挙した GitHub MCP の各ツールで、本文の引数にマーカーがあれば通り無ければ deny、本文の引数を持たない呼び出しは通る、対象外のツール名(読み取りのツールなど)は通る、サーバー名が違う(プラグイン経由の接続の)ツール名でも matcher と検査が効く。active run が無いときは、マーカーが無くても通る |
| guard-write(フェーズ) | `src/hooks/__test__/guard-write.test.ts` | `state.intent` が指すファイルを、implement・review・fix-loop・finalize を含むすべてのフェーズで通す。同じ `docs/intents/` の別のファイルは、design など規則外のフェーズで ask を返す。`docs/intents/*.md` を phase `null`・intent・intent-sync・triage で通し、design など他のフェーズで ask を返す。`docs/intents/domains/**` を intent-sync で通し、intent・phase `null`・triage で ask を返す(intent は `DOC_PHASES` に入るが ask になること)。phase `null` で `docs/intents/*.md` 以外(`.codiel/` 外のソース)へ書くと従来どおり ask を返す。active run が無いときは `docs/intents/**` も含めて通す |
| guard-write(worktree) | 同上 | 下の表のケース |
| 環境判定 | `src/__test__/check-intent-env.test.ts` | sandalphon のケース 1〜24 のうち、残す出力に関わるもの。`codielHandoffCandidate` / `codielHarness` / `testRunner` のケースは削る。`ghVersion` と `ghAttachSupported` を、`gh` のスタブで 2.45.0・2.98.9・2.99.0・2.100.0・未導入の各ケースと、リモートのホストが `github.com`・`example.ghe.com`・GHES の独自ドメインの各ケースの組み合わせで確かめる。GHES では 2.99.0 以上でも `ghAttachSupported` が偽になる。`repoSlug` が `github.com` と `example.ghe.com` で値を持ち、GHES の独自ドメインと `notgithub.com` で `null` になる。gh のスタブで、認証の確認が `gh auth status --hostname <remoteHost>` で呼ばれることを確かめる |
| gh-utility の環境判定 | `plugins/gh-utility/src/__test__/check-issue-env.test.ts` | 上と同じホストのケースで、`repoSlug`・`remoteHost`・`gh auth status --hostname` の呼び方を確かめる。codiel のテストとは独立に持つ |
| 2 者比較 | 同上 | metatron `loadConfig` / `extractDomains` と codiel `resolveDocPaths` / `readDomainsResult` / `check-intent-env` の出力の一致。ケース 16f と R4-a〜f の構成をすべて含める |
| metatron の走査 | metatron の `__test__/`(置き場は計画書で確定) | `docs/intents/domains/` が無い、git リポジトリでない、印付きエントリが無い、印付きエントリが有る、5 つの小見出しが欠けたエントリ、候補 ID の無い印、同じファイルで重複した候補 ID(いずれも `warnings` に載り候補にならない)、本文に `ADR 候補 ID: <候補 ID>` の行を持つ ADR が既にある(`adoptedAs` に番号が入る)、その ADR のタイトルが候補のタイトルと違う(それでも入る)、タイトルだけが同じで候補 ID の行を持たない ADR がある(`null`)、候補 `frontend-1` に対して `ADR 候補 ID: frontend-10` の行だけを持つ ADR がある(`null`)の各ケース |
| metatron の縮約 | 同上 | `shrink-adr-candidate` が、候補 ID で特定したエントリを候補 ID を残した参照形にし、0 で終わる。エントリの範囲の外がバイト単位で変わらない。既に参照形なら何もせず 0 で終わる。エントリのハッシュ不一致・ADR が無い・ADR の本文に `ADR 候補 ID:` の行が無い・書き込みの失敗のそれぞれで、何も書かずに終了コード 3 と `shrinkPending` を返す。書き込み先が repoRoot の `docs/intents/domains/*.md` 以外なら拒否する。docRoot の外にある持続層も書ける。同じファイルの 2 候補を順に縮約して、先の候補が印付きに戻らない。`stage-adr` と `commit-architecture` の既存テストが変わらず通り、持続層に触れない |
| 採番 | codiel の intent-sync の規則(grep、A3-13)と、計画書で決める採番の実装のテスト | `frontend-1` と `frontend-10` が同じファイルにあるとき、最大連番を 10 と数え、次を `frontend-11` にする |

guard-write の worktree のケースは次のとおりである。どのケースも `mapped` の run で、該当する `implement.steps[k].domain` または `testLoop.units[id].domain` にドメイン X を持たせ、メインの `state.domain` は null にしておく。

| ケース | cwd | 書き込み先 | 期待 |
| --- | --- | --- | --- |
| W-1 | `<メイン>/.codiel/worktrees/<slug>/step-<k>/src`(worktree 内) | worktree 内の `.codiel/specs/<unit>/cases.md` | ask(改竄検知が効く) |
| W-1b | 同上 | worktree 内で X の範囲外のソース | ask(X で境界判定する) |
| W-2 | `<メイン>`(worktree の親) | worktree 内で X の範囲外のソース(絶対パス) | ask(`.codiel/` 免除に入らない) |
| W-2b | 同上 | worktree 内で X の範囲内のソース(絶対パス) | 通す |
| W-3 | `<メイン>/.codiel/worktrees/<slug>/unit-<id>/`(unit の worktree) | worktree 内で X の範囲外のソース | ask(`testLoop.units[id].domain` で判定する) |
| W-4 | worktree 内。docRoot はメインの `sub/`(`sub/metatron.config.json` がある) | worktree 内の `sub/` 配下で X の範囲内のソース | 通す(docRoot を `worktreeRoot/sub` に写して照合する) |
| W-5 | worktree 内。worktree の checkout に `.codiel/specs` がある場合と無い場合の両方 | 任意 | どちらでも run がメインのルートで見つかる |

W 系では、run の検索が `git worktree list --porcelain` の先頭のエントリでメインのルートに届くことを確かめる。

テストで見ない受け入れ基準は grep で確かめる。対象は A2-10〜A2-12、A2-16〜A2-20、A2-22 の matcher、A2-23、A3-2、A3-4〜A3-6、A3-8、A3-11〜A3-15、A4-1、A4-4、A5-1、A5-2 である。A5-1 と A5-2 の grep は、計画書の各マイルストーンの終点で毎回実行する。

### 8.3 3 者比較から 2 者比較への縮小

- sandalphon の `expectThreeWayMatch` を `expectTwoWayMatch` にし、sandalphon の子プロセス呼び出しを codiel の `check-intent-env` の子プロセス呼び出しに替える。codiel の `check-intent-env` は `lib.ts` を使うため、実装としては metatron と codiel の 2 つを比べることになる。
- 比較項目(docRoot、architecture / gotchas のパス、warnings の有無と件数、ドメインマップの可読性・値・件数)は減らさない。
- metatron 側の R4-a〜f(`config.test.ts:274-338`)は変えない。

### 8.4 テストで見られないものの確認

intent フェーズの対話、並列の委譲、worktree のマージはユニットテストで見られない。計画書の各マイルストーンの終点で、このリポジトリを対象プロジェクトとして `/codiel:run` を 1 回通す手動の確認手順を置く。github と local の両モードを、M2 と M4 の終点でそれぞれ 1 回ずつ通す。このリポジトリの規約はソースと生成物を同じコミットに求めるため、M4 の確認では dev-plan の `## 生成物` が方式 a になることも確かめる(§6.6.1)。

このリポジトリは metatron を導入済みなので、metatron が無い経路は通らない。M3 の終点で、ARCHITECTURE を持たない一時の git リポジトリを用意し、`/codiel:init` の後に軽量の run を 1 回通す。確かめるのは、`adrTarget` が `intents` になること、`unscoped` で進むこと、ADR の 3 条件を満たす判断が持続層に `[ADR 候補]` の形で書かれ、finalize の報告に挙がることである。続けて同じリポジトリで `/metatron:init` を実行し、候補が提示され、承認した候補が ADR になり、持続層が参照形に縮むことを確かめる。

原文のセクションと完了判定(§6.3.3〜§6.3.6)は、M2 の終点の手動確認で次を確かめる。

- 聞き取りの回答が要約も翻訳もされずに `## ASIS` / `## TOBE` に入り、今回やらないことも `## TOBE` に入ること。
- run の途中で要望を足すと、そのフェーズの中で原文のセクションの末尾に日付つきで追記され、既存の原文が変わらないこと。
- intent-sync より後に要望を足し、run に含めないと答えると持ち越しの注記が付き、finalize で「持ち越し」と示されて達成の判定から外れること。
- 原文にだけある要望を実装で満たさないとき、review が severity high の所見を出し、finalize の結果レポートで「未達」になり、intent の `status` が `in-progress` のままであること。すべて達成のときだけ `done` になり、run ブランチにコミット(github では push)されること。
- 派生文と原文の食い違いの確認で、run が `awaiting_human` になってから人に聞くこと。
- v1 の intent ファイルを渡すと、`## 現状調査` / `## 要求` へ移り、原文のセクションが聞き取りで埋まること。
- Issue を入口にしたときの 4 通り: `<!-- intent:v1 -->` の Issue は本文が派生になり原文を聞き直すこと。マーカーの無い Issue は本文と人のコメントが原文に入り、bot と `<!-- codiel:generated -->` のコメントが除かれること。codiel が起票した `<!-- codiel:generated -->` の Issue を入口にすると本文が派生になり原文を聞き取ること。承認ゲートで原文から記録を除けること。
- triage の草案を入口にすると、`<!-- codiel:unrecorded -->` が聞き取りの原文に置き換わること。

投稿する本文のマーカー(§6.8)は、M2 の終点で次を確かめる。`hooks/hooks.json` は全セッションの挙動を変える保護パスなので、変更の後に新しいセッションを始めて確かめる。

- 新しいセッションで、guard-bash と guard-github-mcp の hook が発火すること(マーカーの無い本文の投稿が deny されること)。
- run が active な間に codiel が投稿した PR 本文・レビュー本文・Issue・コメントのすべてに `<!-- codiel:generated -->` が入っていること。
- run が active でないセッションでは、どちらの hook もマーカーを求めないこと。

画像の載せ方(§6.12.4)は、M2 の終点で E2E 確認項目として確かめる。この作業環境の `gh` は 2.45.0 なので、`--attach` の経路を確かめるには 2.99.0 以上の `gh` を用意する。確かめる手段は次の 4 つである。

- `--attach` で Issue と PR コメントに画像を載せ、本文の参照が `user-attachments` の URL に差し替わる。
- claude-in-chrome で画像をアップロードし、得た URL をレビュー本文に書く。操作の手順(ファイルを選ぶ画面、URL の取り出し方、未投稿の下書きの破棄)とログインの前提は、この確認で確定させて計画書に記録する。
- claude-in-chrome が使えないとき、レビューを `gh pr comment --attach` と `gh pr review` に分けて投稿する。
- どちらも使えないとき、画像を `reports/` に保存し、本文に理由と保存パスが載る。

確認に使うリポジトリは private のテスト用のものとし、アップロードが取り消せないことを踏まえて公開してよい画像だけを使う。

---

## 9. バージョン

| プラグイン | 現行 | M1〜M3 の終点 | M4 の終点 |
| --- | --- | --- | --- |
| codiel(`plugin.json` と `package.json`) | `0.9.0-dev` | `1.0.0-dev` | `1.0.0` |
| metatron | `0.3.10-dev` | M1 の終点で `0.3.11-dev`。M3 の終点で `0.4.0-dev`(走査と縮約の実装が入るため、マイナーを上げる) | 変更が無ければ据え置く |
| gh-utility | `0.5.2-dev` | M2 の終点で `0.5.3-dev`(執筆規則と画像の載せ方の写し、`check-issue-env.ts` の `*.ghe.com` 対応。`src` の変更を含むのでバンドルも再生成する) | 変更が無ければ据え置く |
| raguel-mcp | 変更しない | — | — |

- codiel のメジャーを上げることはユーザーと合意済みである(`.claude/rules/metatron/protected-paths.md` の「メジャーは人間に確認」を満たす)。
- M1〜M3 の終点では `-dev` を付ける。規約上、開発中のプラグインは `-dev` を付けるためである。M4 の終点で `-dev` を外す。

---

## 10. マイルストーン

各マイルストーンの終点で `.claude/rules/metatron/conventions.md` の Done 条件(§14)を満たす。

### M1 吸収

sandalphon の資産を codiel へ移し、撤去の波及を済ませる。codiel の run はまだ Issue 起点のまま動く。

- §6.9.2 の参照文書を移す。書式は v1 のまま移し、v2 への改訂は M2 で行う。
- `check-intent-env` を移して lib.ts へ寄せ、2 者比較テストを移す。
- `capturing-intent` スキルを移す。この時点では sandalphon の手順から `/sandalphon:run` と後段スキルへの言及を除いただけのもので、codiel の run とはまだつながらない。
- evals・docs を移す。
- §7.2・§7.3・§7.8 の波及を済ませる。
- ユーザーに `plugins/sandalphon/` の削除を依頼する。
- 終点: A1-1〜A1-6。

### M2 起点変更

run を intent から始める。

- state v2(§6.2)、intent フェーズ(§6.1.2〜§6.1.3)、軽量の経路(§6.1.4)、連携モード(§6.5)。
- intent 書式 v2(§6.3)と v1 からの昇格。
- intent-sync フェーズを `STAGES` と `GATED` に入れ、受け入れ基準の書き戻しと、途中で追記された原文の派生文のセクションへの反映(人の確認つき)だけを行う。`status: done` は finalize が付ける(§6.3.2)。持続層の取り込みは M3 で足す。state の形を M3 で変えないためである。
- guard-write の `docs/intents/**` の規則(phase `null` を含む。§6.8)。
- run ブランチの作成を承認ゲートの後へ移し、intent-only の文書を開始時のブランチへコミットする流れ(§6.1.2〜§6.1.3)。
- `analyzing-issues` と `codiel-analyst` を削除し、`issue.md` を読んでいたスキルを intent へ替える。
- review の入力を `git diff` に、triage と outcome 同期に local の分岐を足す。
- state の `adrTarget` と `init --adr-target`(§6.2.1)。使うのは M3 だが、state の形を M3 で変えないため M2 で入れる。
- intent の執筆規則 `intent-writing.md` と、書式 v2 の `## 出典`(§6.12.2)。
- GitHub の執筆規則 `github-writing.md`、画像の手段の判定(`check-intent-env` の `ghVersion`、state の `imageUpload`)、pr・review・triage への適用(§6.12.3〜§6.12.4)。
- gh-utility への写しと `0.5.3-dev`(§6.12.6)。codiel 側の作業と依存しないので、独立に並列で進められるステップとして計画書に書く。
- 画像の載せ方の E2E 確認(§8.4)。
- 新 ADR を起票する(下記「計画側への引き継ぎ」)。
- 原文のセクションと派生文のセクションへの書式 v2 の組み替え(§6.3.3)、Issue を入口にしたときのマーカーの扱いと `<!-- codiel:generated -->`(§6.3.5)、review と finalize による原文の完了判定と finalize による `status: done`(§6.3.2、§6.3.6)。
- 途中の要望の即時追記、intent-sync での原文の派生文への反映(人の確認つき)、intent-sync より後の要望の持ち越し(§6.3.4)。guard-write の `state.intent` の許可(§6.8)。`mark-ask` による確認の一般則(§6.1.1)。
- 投稿する本文のマーカー: guard-bash の検査と、新設の guard-github-mcp(`build.ts` のエントリと `hooks/hooks.json` の matcher を含む)、github-writing の規則(§6.8、§6.12.3)。`hooks.json` の変更後は新しいセッションで発火を確かめる(§8.4)。
- 終点: A2-1〜A2-23、A3-1、A3-7、A5-1、A5-2。

### M3 持続層

- 持続層の書式(§6.4.2。`[ADR 候補]` の形を含む)と ADR の 3 条件の写しを `intent-format.md` に足す。
- intent-sync に持続層の取り込みと、`adrTarget` による書き分け(§6.4.3)を足す。
- intent の現状調査・design・review、軽量の test-spec・dev-plan に持続層の読み取りを足す。review の severity 規則を足す。
- metatron `config-schema.md` に行を足し、metatron と codiel の `format-change-checklist.md` に ADR の 3 条件の写しと ADR 候補の書式の追随を 1 行ずつ足す。
- metatron に `[ADR 候補]` の走査と縮約を実装する(§6.11)。CLI・スキル・参照文書の写し・README・テストを含め、metatron を `0.4.0-dev` にする。
- codiel の README に「metatron を導入すると ADR 候補が移る」という内容を書く。
- metatron の `writing-discipline.md` を prompt-smith の現行規律に追随させ、checklist に追随のセクションを足す(§6.12.5)。`0.4.0-dev` に含める。
- metatron が無い環境と、その後に metatron を導入したときの手動確認(§8.4)。
- 終点: A3-2〜A3-15、A5-1〜A5-4。§8.2 の「metatron の走査」「metatron の縮約」のテストがすべて通る。

### M4 並列化

- 並列実装はこのマイルストーンで入れる。M2〜M3 の implement は現行どおり直列で、hook の worktree の分岐もここで足す。state の `implement` と `testLoop` は任意フィールドの後方互換の追加とし、`version` は 2 のまま据え置く(§6.6)。
- dev-plan の書式(§6.6.1)、`implement.steps` と `waves` のグループ分け(§6.6.2、§6.6.5)。
- worktree・依存のインストール・生成物の方式 a / b・brief / report・タスクレビュー・マージ・後始末の手順(§6.6.3〜§6.6.4)。
- hook の worktree 対応(kind が `step` と `unit` の両方、docRoot の写し)と、ステップ・unit 単位のドメイン境界(§6.6.6、§6.7、§6.8)。
- test-loop の並列化(§6.7)。
- codiel を `1.0.0` にする。
- 終点: A4-1〜A4-4。

### 計画側への引き継ぎ

- この改修(codiel の起点を intent へ変えたこと、sandalphon を統合したこと)は ADR 候補である。M2 の終点で新 ADR を起票する。
- 新 ADR は ADR-004 の決定のうち「同梱 Agent を `codiel-analyst` と `codiel-test-designer` の 2 体に絞る」部分を上書きし、codiel が同梱 Agent を持たないとする(決定 56)。ADR-004 の本文は書き換えず、状態の変更は metatron の ADR の書式(状態変更の履歴)に従う。
- ADR の追加は `metatron:updating-architecture` スキルを起動して行う。`stage-adr` → `commit-architecture` を直接呼ぶ手順で代えない。
- `harness-docs/ARCHITECTURE.md:50` の変更(§7.2)も同じスキルの経路で行う。
- metatron が codiel の持続層を縮約すること(プラグインをまたぐ書き込み)も ADR 候補である。起票するかは M3 の終点で、同じスキルの手順の中で判断する。
- M3 の metatron 側の実装は、metatron の `format-change-checklist.md` の ADR の書式のセクション(`adr.ts` の規則・契約文書 §6 など)に沿って、追随先を確かめる。
- AI 向けの指示書に当たるファイル(`plugins/codiel/references/**`、`skills/**`、`harness-docs/**`)を書くタスクには、`prompt-smith:prompt-smith` の起動を明記する。
- 計画書で確定させる細目: `implement.steps` と test-loop の worktree の型と遷移、lockfile の一覧と既定のインストールコマンドの対応表、連携モードの記録を変える CLI の名前、`syncing-intents` と `intent-common.md` の名前、gh-utility の執筆規則のファイルの名前と追随の行の置き場、guard-github-mcp の対象のツールの一覧とツールごとの本文の引数の名前(GitHub MCP の現行のツール定義で確かめる)、`hooks.json` の matcher の正規表現。
- E2E 確認項目として引き継ぐもの: claude-in-chrome で GitHub に画像をアップロードする具体的な操作(ファイルを選ぶ画面、`user-attachments` の URL の取り出し方、未投稿の下書きの破棄)と、ログインの前提(§6.12.4、§8.4)。確定した手順は `github-writing.md` と gh-utility の同等のファイルに書く。
- `github-writing.md`・`intent-writing.md`・gh-utility の執筆規則は、AI が読む `references/` の文書なので `prompt-smith:prompt-smith` の規律で書く。規則の中身は人間向けの文書の書き方であり、指示書としての書き方と混同しない。

---

## 11. 影響ファイル一覧

### 11.1 codiel

| 区分 | ファイル |
| --- | --- |
| 実装層 | `src/codiel-state.ts`、`src/codiel-state-cli.ts`、`src/hooks/lib.ts`、`src/hooks/guard-bash.ts`、`src/hooks/guard-write.ts`、`src/hooks/stop-guard.ts`、新設 `src/hooks/guard-github-mcp.ts`、新設 `src/check-intent-env.ts`、`build.ts` |
| テスト | `src/__test__/codiel-state.test.ts`、新設 `src/__test__/check-intent-env.test.ts`、`src/hooks/__test__/{guard-bash,guard-write,stop-guard,lib}.test.ts`、新設 `src/hooks/__test__/guard-github-mcp.test.ts` |
| hook の登録 | `hooks/hooks.json`(GitHub MCP の書き込みツールの matcher を足す。保護パス) |
| バンドル | `scripts/*.mjs`(`pnpm run build` で再生成) |
| 指示層 | §6.9.1 の表のとおり |
| 参照層 | 新設 `references/{intent-format,handoff-contract,intent-common,intent-writing,github-writing}.md` |
| 文書 | `docs/DESIGN.md`、`docs/skill-flowcharts.md`、新設 `docs/format-change-checklist.md`、`README.md`、`CLAUDE.example.md` |
| evals | なし(M1 で移し、M2 で削除した。決定 54) |
| 配布 | `.claude-plugin/plugin.json`、`package.json` |

### 11.2 そのほか

§7.2(リポジトリ共通)、§7.3(metatron)、§7.8(Serena メモリ)を参照する。gh-utility の影響ファイルは §7.4 に、metatron の走査・縮約・執筆規律の追随の影響ファイルは §7.3 に並べた。metatron 側の変更が単独動作に codiel を要求しないことは §6.10.2 で確かめた。

---

## 12. 不採用案

| # | 案 | 採らない理由 |
| --- | --- | --- |
| 1 | 持続層を 1 枚の台帳にする | 領域をまたぐ 1 ファイルは run のたびに衝突し、review で領域ごとの差分を読み分けられない |
| 2 | 持続層をコードの近く(各ディレクトリの README 等)に置く | 置き場がプロジェクトの構成に依存し、読み手が探索しないと見つけられない。intent と同じ `docs/intents/` に寄せれば解決規則が 1 つで済む |
| 3 | 軽量の経路を別モード(別コマンド)で残す | run が 2 系統になり、state・hook・review の保証を二重に持つことになる。規模は同じ run の分岐で表せる |
| 4 | 常に全フェーズを通す重い run だけにする | 小さな変更で discuss と design の往復が過剰になり、sandalphon の自前実行が担っていた軽い経路が失われる |
| 5 | 両層を `docs/changes/` と `docs/areas/` に再配置する | 既存の `docs/intents/` の置き場と、metatron `config-schema.md:91` の既定パスを動かす理由が無い |
| 6 | discuss を intent フェーズに吸収する | intent は what、discuss は how を扱う。吸収すると承認ゲートの前に設計論点が混ざり、what の合意が遅れる |
| 7 | 持続層への取り込みを finalize で行う | finalize は PR の後であり、持続層の変更が review の対象から外れる。github モードでは PR にも入らない |
| 8 | 同じ作業ツリーで、ステップごとに触るファイルを宣言して並列に実装する | 宣言は守られる保証が無く、同時コミットは `index.lock` で衝突する。worktree なら分離をファイルシステムで保証できる |
| 9 | 実装は直列のまま、レビューだけを並列にする | 実装時間が短くならず、目的 2 の並列化を満たさない |
| 10 | Issue だけを任意にし、PR は必須にする | local モードで run を最後まで通せない。PR を作れない環境こそ Issue を作れない環境と重なる |
| 11 | 設計書を 3 本(吸収・起点変更・並列化)または 2 本に分ける | 3 つの変更は state のスキーマとフェーズ列を共有しており、分けると同じ決定を複数の文書で持つことになる |
| 12 | 持続層を持たず、ADR に一本化する | ADR の 3 条件を満たさない設計理由と制約が行き場を失う。ADR の基準を緩めると ARCHITECTURE の注入が膨らむ |
| 13 | intent 文書(両層)をコミットしない | 作業ツリーの外に残り、run ブランチと PR から辿れない。try をまたいだ持ち込み(§6.1.2 の 6)もできなくなる |
| 14 | 生成物の扱いを codiel が一律に決める(常に各ステップで生成する、または常に最終ステップでまとめる) | 生成物の扱いは対象プロジェクトの規約で決まる。「ソースと生成物を同じコミットに入れる」はこのリポジトリの規約であり、ほかのプロジェクトに課す根拠が無い。最終ステップでまとめる方式は不採用ではなく、規約に定めが無いときの既定(方式 b)として残す(§6.6.1) |
| 15 | 文書だけ残して終える run を `stop --reason intent-only` で閉じる | stopped が中止と区別できない。`completed` で閉じる(§6.1.3) |
| 16 | intent 文書の書き込みを hook に通させるため、`start-phase intent` の後に書く順序へ入れ替える | 承認の直後に文書を書くという自然な順序が崩れ、intent-only で run ブランチを作らない流れとも合わない。hook 側で phase `null` の `docs/intents/**` を通す(§6.8) |
| 17 | 文書だけで終えた intent も run ブランチにコミットし、再開時に前の try のブランチから持ち込む | 文書が base に届かず、パスを渡しても作業ツリーに無い。開始時のブランチにコミットすれば持ち込みが要らない(§6.1.3) |
| 18 | metatron が無いとき、codiel 専用の決定記録 `docs/intents/decisions/` を持つ | 判断の置き場が持続層と決定記録の 2 つに割れ、design と review が読む先が増える。判断は制約と同じ領域に属しており、持続層の `## 意図的な制約` に印付きで置けば、読み手も移す手順も 1 つで済む(§6.4.3) |
| 19 | metatron が無いとき、ADR 候補を finalize の報告に挙げるだけにとどめる | 報告は run が終わると辿れなくなり、背景と検討した選択肢が失われる。後から metatron を導入しても移す元が無い(§2.2 の問題がそのまま残る) |
| 20 | `[ADR 候補]` の移送を codiel 側で行う(専用コマンド、または intent-sync での移送) | 移送すべき時機は metatron を導入した時点だが、codiel の run はその時機と一致しない。ADR は規律の持ち主である metatron が作るべきである。codiel から行うと、ADR の確定と持続層の縮約を 1 つの commit の手順にまとめられず、二重管理の中間状態が残りうる(§6.11) |
| 21 | 利用者が README の手順に沿って手で移す(第 4 版の案) | 移した後に持続層を縮め忘れると、ADR と持続層の二重管理になる。縮約を ADR の確定と同じ手順に入れるには metatron の CLI が要る |
| 22 | ARCHITECTURE 系・Intent 文書・GitHub の 3 種の文書に同じ執筆規則を当てる | 読者と目的が違う。毎セッション注入される ARCHITECTURE 系は根拠を削って短くし、後で変更する人が読む Intent 文書は制約の理由を残し、人間が読む GitHub の文書は情報を落とさず画像も載せる(§6.12.1) |
| 23 | Intent 文書でも出典を削る | 制約や合意の根拠を後から確かめる手段が消える。Intent 文書は ARCHITECTURE 系と違って毎セッション注入されないので、出典を残しても読み込みのコストは増えない。末尾の `## 出典` にまとめれば本文の短さも保てる(§6.12.2) |
| 24 | gh-utility に GitHub の執筆規則を写さない | codiel を導入していない利用者が gh-utility で書く Issue やコメントに、同じ品質の規則が届かない。gh-utility は codiel を参照できないので、独立に持つしかない(§6.12.6) |
| 25 | GitHub MCP で画像を添付する | 公式の GitHub MCP にアップロードのツールが無い(github/github-mcp-server#738 が open) |
| 26 | 未公開の upload エンドポイントを直接叩く | 公開された API ではなく、予告なく変わりうる。認証の扱いも利用者の環境に依存し、壊れたときの縮退が設計できない |
| 27 | private リポジトリで画像をリポジトリにコミットして参照する | 画像がコードの履歴に残り、消すには履歴の書き換えが要る。PR やコメントの補助資料のためにリポジトリを肥大させる |
| 28 | 原文を別のセクション `## 要望(原文)` に新設し、`## ASIS` / `## TOBE` は派生文のまま残す | ユーザーが `## ASIS` / `## TOBE` そのものを原文のセクションにすることを選んだ(§6.3.3) |
| 29 | 原文による完了判定を各ゲート(design・dev-plan・implement など)でも行う | 派生の段階ごとに照合すると、判定の手間がフェーズの数だけ増える。派生文のずれは成果物に現れた時点で見れば足りるので、差分がそろう review と、run 全体を締める finalize の 2 箇所に絞る(§6.3.6) |
| 30 | 原文による完了判定を finalize だけで行う | finalize は PR と review の後であり、未達を見つけても fix-loop で直す機会が過ぎている。review で未達を severity high にすれば、fix-loop で直せる(§6.3.6) |
| 31 | Issue の本文を常に原文とする | codiel が起票した Issue や v1 の intent の Issue の本文は AI が生成した文であり、それを原文にすると AI の文が完了判定の最高権威になる(§6.3.5) |
| 32 | run の途中の追記に承認を要する | 追記するのはユーザー自身の言葉であり、承認を挟むとユーザーの言葉を AI の手順で止めることになる。承認が要るのは、原文を派生文へ反映するときだけである(§6.3.4) |
| 33 | intent-sync が `status: done` を付ける | intent-sync は review と finalize の前にあり、原文の要望に未達が残っていても完了の扱いになる。原文による判定が済む finalize で付ける(§6.3.2) |
| 34 | 投稿する本文のマーカーを、スキルの規律だけで付ける | 付け忘れを防げない。付け忘れた本文は人の言葉として原文に入り、AI の文が最高権威になる。hook で投稿を deny すれば、付け忘れた本文は GitHub に届かない(§6.8) |

---

## 13. 範囲外・既知の食い違い

次の食い違いは本改修の前から存在する。本改修では直さず、記録だけを残す。

| 箇所 | 食い違い |
| --- | --- |
| `plugins/metatron/references/architecture-format.md:82-87` と `plugins/codiel/skills/initializing-harness/SKILL.md:38`、`plugins/codiel/src/hooks/guard-write.ts:153` | 読み手の表は `initializing-harness` を「run 開始の前提条件(読めなければ run を開始しない)」とし、`guard-write` は「このブロックを読まない」とする。現行の `initializing-harness` はドメインマップを確認対象に含めず(`:38`)、`guard-write` は `readDomainsResult` でブロックを読む(`:153`) |
| `.serena/memories/` の各メモリ | プラグインのバージョン表記が現行と合わない |
| `plugins/codiel/docs/DESIGN.md:174-175` と `plugins/codiel/src/codiel-state.ts:90-95` | DESIGN.md は終了状態を completed / stopped / rejected とし、`TERMINAL` は awaiting_outcome も含む |

§6.9.4 で `DESIGN.md` を書き換えるとき、3 行目の食い違いに当たる記述は現行の `TERMINAL` に合わせてよい。ただし計画書ではその作業を本改修のタスクと分けて書く。

「契約 §13」の誤記(§3.5)は本改修で触るファイルにあるため、範囲外にせず §7.3・§6.9.3 で直す。

`harness-docs/ARCHITECTURE.md:48` の「実装層は他プラグインの `src/` を import しない」は、テストコードを除くと明記していない。一方で codiel の `lib.test.ts:6-9` と sandalphon の `check-intent-env.test.ts:7-16` は、実装間の一致検証のために他プラグインの `src/` をテストから import している。本設計はこれをテスト時だけの依存として扱い(§6.10.3)、ARCHITECTURE の文言の整理は範囲外とする。

---

## 14. Done 条件

各マイルストーンの終点で次をすべて満たす。

- `pnpm run lint` と `pnpm run typecheck` と `pnpm run test` が通る。
- `plugins/*/src/` を変更したマイルストーンでは `pnpm run build` を実行し、`plugins/*/scripts/` の差分が同じコミットにある。
- 改修したプラグインの `plugin.json` と `package.json` のバージョンが揃って上がっている(§9)。
- ルートの `README.md` に反映されている。
- ARCHITECTURE に影響する変更は `/metatron:update` で追随させている(§10 の引き継ぎ)。
- `.serena/memories/` の記述と食い違う箇所を更新している(§7.8)。
- 編集内容を適切に分けて git にコミットしている。
- そのマイルストーンの受け入れ基準(§10 の「終点」)がすべて YES である。

---

## 15. 未決事項

第 1 版の未決事項 14 件は、第 2 版ですべて確定した(§1 の決定 20、22〜35)。実装計画で確定させる細目は §10 の「計画側への引き継ぎ」に列挙した。

第 7 版で生じた「`*.ghe.com` のリモートを連携モード `github` に含めるか」は、第 7 版の追補でユーザーが含めると決めた(決定 46)。本設計の範囲で判断が付いていない論点は残っていない。
