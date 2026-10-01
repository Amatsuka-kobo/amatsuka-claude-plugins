---
name: capturing-intent
description: Codiel の intent フェーズで、オーケストレーター本体が Issue 番号・intent 文書のパス・省略のいずれかを起点に ASIS と TOBE を聞き取り、承認後に intent 文書を確定して run を作成するときに使う。orchestrating-runs が名指しで起動する。
---

# intent フェーズの聞き取りと確定

## 目的

TOBE を聞き取り、intent に関係する範囲の現状と突き合わせ、分岐を合意したうえで intent 文書に固定する。承認後は run を作成し、intent フェーズの完了までを担当する。discuss 以降の設計・実装・テストの合意形成は別のスキルが担う。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は `<plugin-root>/skills/capturing-intent`
である。**`<plugin-root>` はそのベースディレクトリの 2 階層上**。環境検出と `codiel-state` の呼び出しは
対象プロジェクトのルートで実行する(`<plugin-root>` は絶対パスに展開して実行する)。

```
node <plugin-root>/scripts/check-intent-env.mjs
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

## 共通規律

- 経路の選択と承認、畳む経路の判断は `../../references/intent-common.md` に従う。
- intent 文書と intent-issue の書式は `../../references/intent-format.md` に従う。書式の正本はそちらであり、この文書は手順だけを持つ。
- 変更ごとの intent の文の組み立ては `../../references/intent-writing.md` に、GitHub へ投稿する本文の文の組み立てと画像の載せ方は `../../references/github-writing.md` に従う。
- gh-utility の `issue-craft` へ委譲するときの契約は `../../references/handoff-contract.md` に従う。
- ディスカッションの言語はユーザーの使用言語に従う。intent 文書と issue 本文の言語は手順 4 で 1 回だけ別に確認する。

## 手順

- [ ] 0. active run の確認
- [ ] 1. 前提確認とベースブランチの最新化
- [ ] 2. 入口の分岐
- [ ] 3. 聞き取りと現状調査
- [ ] 4. ドラフトの提示と承認ゲート
- [ ] 5. run の作成と保存
- [ ] 6. try-2 以降の持ち込み

## 0. active run の確認

聞き取り・書き込み・起票のどれよりも前に、`node <plugin-root>/scripts/codiel-state.mjs get --active` でほかの run が active でないことを確かめる。`active` または `awaiting_human` の run が見つかったら、今回再開する run かどうかを次のとおり判定する。

- 入口が intent パスで、その frontmatter の `run` が見つかった run の slug と一致するときは、確かめずに今回再開する run とみなす。
- 入口が intent パスで、frontmatter の `run` では当たらないが、見つかった run の state の `intent`(repoRoot 相対にしたもの)が入口のパスと同じときは、state の `intent` だけで当たった run とみなす。作業ツリーに intent のファイルが無く frontmatter を読めないときも、この照合で再開する run を見つけられる。この run は確かめずには再開せず、内容(slug・intent のパス・現在のフェーズ)を示して今回再開するかをユーザーに確かめる。
- それ以外(上の 2 つに当たらない intent パス、Issue 番号、省略)では、見つかった run が `commands/run.md` の「未完了の run があれば再開」に当たる可能性がある。終端にする前にその run の内容(slug・intent のパス・現在のフェーズ)を示し、今回再開するかをユーザーに確かめる(run を作る前なので `mark-ask` は要らない)。

今回再開する run と決まったものは終端にせず、`orchestrating-runs` の再開手順(§6)へ進める。再開しないと答えたものと、確認の対象にならなかったものは、`codiel-state finalize --slug <slug>` か、前のセッションから残った待ちを `codiel-state wait-clear --slug <slug>` で消してからの `codiel-state stop --slug <slug> --reason <理由>` で終端にする。この確認により、手順 5 の (1)〜(3) の間は、再開する run 以外に active run が無い状態が保証される。

## 1. 前提確認とベースブランチの最新化

1. `orchestrating-runs` の前提確認(Raguel MCP の利用可否、ハーネスの初期化の確認)に従う。
2. 連携モード・`imageUpload`・`adrTarget` の判定は `orchestrating-runs` の §0 が正本である。§0 を経て起動されたときは、そこで得た `check-intent-env` の出力と判定結果(連携モード・`imageUpload`・`adrTarget`)をそのまま使い、ここで判定し直さない。**§0 を経ずに起動されたときだけ**、`orchestrating-runs/SKILL.md` の §0 の手順(`check-intent-env.mjs` の実行、連携モード・`imageUpload`・`adrTarget` の判定)をこの場で行う。
3. ベースブランチの名前を解決し、`git switch <ベース> && git pull --ff-only` で最新化する。`pull --ff-only` が失敗したら、その旨を人に確認してから続ける。以降、このブランチを「開始時のブランチ」と呼ぶ。intent フェーズの間は、開始時のブランチの作業ツリーで intent 文書を書く。
4. 入口が intent パスのときは、手順 2 の前に、前の try の run ブランチから intent を持ち込む。手順 2 は intent の frontmatter と本文を読むが、実装の途中で止まった try の intent は、その run ブランチにしか無いためである。手順 0 が frontmatter の `run` と state の `intent` で終端でない run(再開の候補)を探すのに対し、この持ち込みは入口のパスのファイル名の slug で終端になった前の try を探す。
   - 入口のパスのファイル名の slug で `node <plugin-root>/scripts/codiel-state.mjs get --slug <slug>` を実行し、最新の try の state を読む。run が無いとき、state の `intent` が入口のパスと違うとき、終端でないとき(手順 0 で扱う)は持ち込まない。
   - 最新の try の `stopReason` が `commit-failed` なら持ち込まず、作業ツリーに残した intent をそのまま使う。承認済みの新しい版は作業ツリーにしか無いためである。
   - 最新の try の `branch` が `null`(文書だけで終えた try)なら持ち込まない。intent は開始時のブランチにコミット済みである。
   - それ以外は `git checkout <最新の try の branch> -- <intent パス>` で同じパスに持ち込む。失敗したら(run ブランチを消した場合など)、出力を示してユーザーに確かめる。この時点では active run が無いので、応答を待って止まれる。
   - 持ち込みとは別に、最新の try が `stopped` で、`stopReason` が `raguel-stop` か、`humanApproved` の無い `verdict: "STOP"` のフェーズを持つなら、STOP を受けたフェーズとその `evaluationId` を示し、新しい try を作ってよいかをユーザーに確かめる。承認されたら手順 5 の (4) の `init` に `--human-approved` を付ける。承認されなければ run を始めない。前の try の成果物(intent 以外)を新しい try で使うときは、それを作るフェーズを新しい try で進め、そのフェーズのゲートを通してから後のフェーズの入力にする(ゲートを通さずに run ブランチへ持ち込まない)。

`configWarnings` が空でないときは、その項目のパス設定が拒否されて既定値に落ちているか、ARCHITECTURE の構造に指摘がある。読めた文書だけで進み、警告の内容を完了報告に残す。

## 2. 入口の分岐

起動時の引数で次のいずれかに分岐する。

- **Issue 番号**: github モードでは `gh issue view`、読めなければ GitHub MCP の読み取りで本文とコメントを得る。local モードではユーザーに本文を貼ってもらう。正本は以後 intent 文書になる。本文にあるマーカーで原文と派生の扱いを決める。`<!-- intent:v2 -->` は原文のセクションだけを原文へ転記し、不足分をこの後の手順で聞き取る。`<!-- intent:v1 -->` は本文全体を AI の整理とみなし、`## ASIS` / `## TOBE` を `## 現状調査` / `## 要求` へ移してユーザーに聞き直す。`<!-- codiel:generated -->` があれば、`<!-- intent:v2 -->` の有無によらず本文全体を派生(`## 現状調査` の材料)として扱う。どのマーカーがあっても、人が書いたコメント(bot のコメントと `<!-- codiel:generated -->` を持つコメントを除く)は話者と日付つきで原文のセクションに記録する。マーカーが無ければ、本文とコメントを人が書いたものとして原文のセクションに記録する。詳細な対応は `intent-format.md` の「intent-issue の本文」に従う。取り込んだ記録のうち原文から除くものは、手順 4 の承認ゲートでユーザーが選ぶ。
- **intent パス**: 手順 0 と同じ照合(frontmatter の `run` と、state の `intent`)で未終端の run が見つかれば、`orchestrating-runs` の再開手順でその run を続ける。state の `intent` だけで当たった run は、手順 0 と同じく内容(slug・intent のパス・現在のフェーズ)を示してユーザーに確かめてから続ける。照合する run が無く、作業ツリーにも intent のファイルが無いときは、パスが無いことを示してユーザーに確かめる。run が無くファイルがあれば、記載済みの内容を確定扱いにして聞き取りの不足分から手順 3 を始める。
- **intent パスで frontmatter が `intent: v1` のとき**: v2 へ昇格して再開する。v1 の `## ASIS` / `## TOBE` をそれぞれ `## 現状調査` / `## 要求` へ移す(`intent-format.md` の変換の例に従う)。既存のセクションは確定済みとして扱い、不足する原文の `## ASIS` / `## TOBE` と、`## 目的` と `## 意図的な制約` だけを聞き取る。原文はユーザーに尋ねて、ユーザーの言葉のまま埋める。昇格したドラフトを全文提示し、手順 4 の承認ゲートを取り直す。保存は元のパスへの上書きとし、`## 変更履歴` に v1 からの昇格を 1 行記録する。
- **省略**: 「何を達成したいか」から聞く。

既存 intent 文書との重複確認は、`existingIntents` のタイトル一覧を読み、今回の TOBE と重なるものがあるかを意味で判断する。重なるものがあれば、既存を更新するか新規に起こすかをユーザーに確認する。重なりが無ければそのまま手順 3 へ進む。

## 3. 聞き取りと現状調査

### 3-1. TOBE のヒアリング

埋まるべき観点は次の 4 つである。

| 観点 | 記録先 |
| --- | --- |
| 今それができない理由・困っている具体的な場面 | `## ASIS` |
| 何を達成したいか | `## TOBE` |
| どうなったら「できた」と言えるか | `## TOBE` |
| 今回やらないこと | `## TOBE` |

- 不足している観点だけを 1 問ずつ聞く。起動時の引数と会話に既に現れている観点は聞き直さない。4 問を並べて一度に投げない。
- 選択式で聞ける場面は AskUserQuestion を使う。自由記述でしか答えられない問いだけを文章で聞く。
- ユーザーが現状について何も語っていなければ、聞き取りで 1 問だけ、ユーザーの言葉で現状を尋ね、答えを `## ASIS` に記録する。この問いはユーザーが感じている現状を聞くものであり、コードを読んで書く `## 現状調査` とは別である。
- 聞いても埋まらなかった観点は推測で埋めず、`## 未確定事項` に残す。

### 3-2. 原文の記録

- `## ASIS` にはユーザーが語った現状を、`## TOBE` にはそれ以外の言葉すべてを入れる。今回やらないことも `## TOBE` に記録する。
- 要約しない。言い換え・並べ替え・翻訳しない。原文のまま、原語で記録する。
- 各記録の前に、日付・話者・出所の行を置く。Issue から取り込んだ記録は、Issue の作成者やコメントの書き手を話者とし、出所に URL を書く。
- run の途中でユーザーが言葉を足したら、どのフェーズでも即座に、日付・話者・出所の行つきで末尾に追記する。ユーザー自身の言葉なので承認は要らない。既存の原文は書き換えない。
- 記録するのは、人が書いた・語った言葉だけである。AI が生成した文は原文にしない。

### 3-3. 現状調査

ASIS はユーザーに聞かず自分で読む。`## 現状調査` は AI がコードと文書を読んで書く。ユーザーに聞くのは、読んでも分からないこと(何を達成したいか、どうなったら完了か)だけである。

優先順は **ARCHITECTURE → `CLAUDE.md` → GOTCHAS → `README.md`**。人間が書いた要約であり、コードを読むより桁で安い。

- パスは手順 1 の解決結果を使う。固定パスで開かない。
- **注入済みの内容は読み直さない。** セッション開始時に ARCHITECTURE や GOTCHAS 要約がコンテキストへ注入されている環境がある。既にコンテキストにある内容を Read で読み直すのは純粋な重複である。
- **注入は縮退しうる。** 縮退していて、かつ全文が判断に必要なら `contextDocs` のパスを Read する。「注入されていたから全部見た」と扱わない。
- **注入はサブエージェントに継承されない。** 探索を委譲するときは、解決済みの絶対パスを渡して委譲先に読ませる。
- 探索範囲は TOBE に登場する語から辿れる範囲に限定する。プロジェクト全体のスナップショットを作らない。
- Serena が利用可能なら優先して使う(`get_symbols_overview` / `find_symbol` / `find_referencing_symbols`)。利用できなければ Grep / Glob / Read で代替する。
- `projectDocs.domainsReadable` が `true` で、TOBE が特定のドメインに閉じると判断できるときは、そのドメインの glob に絞ってよい。
- 「受け入れ基準を書ける」かつ「実装方針の選択肢を 2 つ挙げられる」状態になったら止める。それ以上は設計フェーズの仕事である。
- 対象が見つからないときは推測で書かず、「該当する既存実装は見つからなかった(新規追加とみなす)」と `## 現状調査` に明記する。

### 3-3-1. 領域名の決定

持続層を読む前に、この intent が属する領域名を決める。この確認は run を作る前に行うので、`mark-ask` を使わない。

- intent の frontmatter に `domains` が既にあれば(intent パスを入口にした run、v1 からの昇格)、それを使い、聞き直さない。
- `projectDocs.domainsReadable` が `true` なら、ドメインマップのキーのうち、TOBE で変わるファイルが glob に当たるものを選ぶ。ユーザーには別に聞かず、手順 4 のドラフトの frontmatter で示して承認を得る。当たるキーが無ければ `domains` を空のままにし、ドラフトでその旨を示す。
- 読めなければ、TOBE と現状調査から領域名の候補を 2〜3 個作り、AskUserQuestion で聞く。候補は `intent-format.md` の正規化の後の形(英小文字のケバブケース)で示す。複数の領域を選べるようにし、候補の外の答えも受ける。
- 決めた領域名を intent の frontmatter `domains` に、1 行のフロー形式(`domains: [frontend, data]`)で書く。

### 3-3-2. 持続層の読み取り

- 3-3-1 で決めた領域の持続層 `docs/intents/domains/<領域>.md` を読む。`domains` が空なら読まない。ファイルが無い領域は制約なしとして進む。
- 読めた持続層の `## 意図的な制約` はユーザーに示し、`## 意図的な制約` の初稿にする。`## 意図的な制約` は「制約 | 理由」の表(ヘッダ行 `| 制約 | 理由 |`)で書く。

### 3-4. 分岐の提示と合意

実装方針が割れる論点は、選択肢を 2 つ以上と各々の帰結を示して合意を取る。自分で決めて先へ進まない。合意した論点は `## 合意済み事項` へ「論点 | 決定 | 理由」の表(ヘッダ行 `| 論点 | 決定 | 理由 |`)の 1 行として残す。決着しなかった論点は `## 未確定事項` へ残す。

`## 要求`・`## 非スコープ`・`## 意図的な制約` などの派生文のセクションは、原文から派生させる。`## 受け入れ基準` は `## 要求` から派生させ、機械的に YES/NO を判定できる文にする。「使いやすくなる」のような人が雰囲気で判定する文を書かない。

## 4. ドラフトの提示と承認ゲート

- ドラフトを書く前に、intent 文書の言語と issue 本文の言語を 1 回で確認する。リポジトリの既存文書から推定した言語を推奨として添える。両者が食い違うと、issue への転記に翻訳という加工が入り、原文をそのまま転記するという前提が崩れる。この確認は派生文のセクションだけに当て、原文のセクションは対象外とし、原語のまま残す。
- 書式は `intent-format.md` に従う。見出しの名称と順序を変えない。
- 提示はメッセージ本文で行う。先にファイルへ書いて「読んで確認してほしい」と依頼しない。保存は承認後である。
- `## 実装方針` も承認対象に含める。設計書ではなく、どの層をどう変えるかの方針として書く。
- slug は TOBE を表す ASCII の英小文字ケバブケース(`^[a-z0-9]+(-[a-z0-9]+)*$`)にし、最大 40 文字とする。日本語のプロジェクトでも slug は英字にする。`^issue-\d+$` に一致する形は使わない。同日に同じ slug の intent が既にあるときは、ファイル名の `-2`・`-3` の接尾辞を含めて run の slug にそろえる(`.codiel/runs/<run の slug>/` の衝突を避けるため)。接尾辞を足しても 40 文字を超えないよう、ここで決める slug はその分を残す。
- ファイル名の日付と frontmatter の `created` は、ローカルのタイムゾーンの日付(`date +%F`)で決める。`date -u` を使わない。

全文を提示したうえで、次の 3 項目を含む承認を同時に得る。差し戻されたら手順 3 へ戻り、指摘された観点を聞き直してからドラフトを作り直す。指摘部分だけを直して再提示することを繰り返さない。

| 項目 | 選択肢 | 決めた後の動き |
| --- | --- | --- |
| 規模 | 標準 / 軽量 | `codiel-state init --scale` に渡す |
| 文書だけ残して終えるか | 続行 / 終える | 終えるときは `--intent-only` を付けて `init` し、intent の `pass-gate` の後に `close` で run を `completed` にする。run ブランチは作らない |
| Issue 起票 | する / しない | github モードで、入力に Issue が無いときだけ選択肢に出す。local モードでは選択肢に出さず理由を 1 行添える |

Issue から取り込んだ原文の記録(本文と人のコメント)のうち、原文から除くものがあれば、ユーザーがこのゲートで選ぶ。除いた記録は原文に入れない。

## 5. run の作成と保存

承認後、次の (1)〜(6) をこの順に行う。git の操作と Raguel MCP の呼び出しはこのスキルの実行者、`codiel-state` の各コマンドは CLI が行う。

**ユーザーへの確認は (3) までに済ませる。** (1)〜(3) は run を作る前なので `mark-ask` を使わない例外であり、これ以外の途中で人へ確認するときは `codiel-state mark-ask <phase> --slug <slug> --kind confirm` で run を `awaiting_human` にしてから確認し、答えを得たら `codiel-state resume --slug <slug>` で戻す(`--evaluation-id` は無くてよい)。**(4) の `codiel-state init` から (6) の `start-phase intent` までは確認を挟まず一気に進める。** この区間は phase が `null` の active run になり、stop-guard が active な run でのセッションの停止を block するので、ユーザーの応答を待つと止まれないためである。

(1) 開始時のブランチの作業ツリーに intent 文書を Write で書く。frontmatter `run` には slug を入れる。保存先の命名規則(同日重複の扱い、git 未管理時の扱い)は `intent-format.md` の「保存先と命名」に従う。

(2) Issue 起票を選んだときだけ、gh-utility `issue-craft` を持ち込みモードで起動して起票し、番号を intent の frontmatter `issue` に書く。固定開始句「持ち込みモード: 以下の完成済み本文で起票」で起動し、`title` / `body` / `labels`(任意)を渡す(`handoff-contract.md`)。渡す本文には `<!-- codiel:generated -->` を含める。起票は外部公開行為であり、持ち込みモード側でも全文提示と明示承認を経る。`issue-craft` が使えないときは `intent-common.md` の「自前起票」に従う。

(3) intent 以外の未コミットの変更があるかを確かめ、あればユーザーに示して扱いを決めてもらう。

- 終える(intent-only)とき: intent 以外の変更には触れず、作業ツリーに残すことを告げる。
- 続行するとき: この後の `git switch -c` が stage 済みの intent もほかの未コミットの変更も新しいブランチへ持ち越し、持ち越した変更が pr フェーズ前の `git status --short` の確認で止まることを示す。そのうえで退避するかを確認する。退避するなら `git stash push -m <タグ> -- <intent 以外のパス>` をパスを指定して使う。`git stash -u` は intent も持っていくので使わない。自動では退避しない。退避はこの (3) の中で済ませる。

(4) `codiel-state init --slug <slug> --intent <パス> --integration <github|local> --scale <standard|light> --adr-target <metatron|intents> --image-upload <gh-attach|chrome|gh-attach,chrome|none> [--issue <N>] [--intent-only] [--base-branch <開始時のブランチ>] [--domain-mode <mapped|unscoped>] [--human-approved]` を実行する。`--intent` は repoRoot 相対のパスで渡す(絶対パスは拒否される)。`branch` は CLI が決める。`--intent-only` なら `null`、それ以外は `codiel/<slug>-try-<n>` である。`--human-approved` は、手順 1 で前の try の STOP(`raguel-stop` か、`humanApproved` の無い `verdict: "STOP"` のフェーズ)についてユーザーが新しい try を承認したときだけ付ける。

(5) `git add -- <intent パス>` で intent 文書だけを stage する。未追跡のファイルでもパスを限定したコミットができるようにするためである。

(6) 手順 4 で決めた「文書だけ残して終えるか」で分岐する。どちらの分岐も、ユーザーへの確認を挟まずに進める。`git commit` が「変更なし」で失敗したとき(前の try からパスだけを渡して続行する場合など)は、そのコミットを飛ばして次へ進む。`git switch -c` が失敗したとき、またはそれ以外の理由で `git commit` が失敗したときは、この区間では `mark-ask` できない(intent フェーズは `start-phase` 前の `pending` である)ので、`codiel-state stop --slug <slug> --reason commit-failed` で run を終端にしてから、失敗の出力と intent 文書のパスをユーザーに示して扱いを確かめる。続行する分岐で失敗したときは、確かめる前に `git switch <開始時のブランチ>` で開始時のブランチへ戻る。作った run ブランチはそのまま残してよく、やり直しの試行は別の名前のブランチになる。intent 文書は作業ツリーに残す。この停止では intent の `status` を変えない。`abandoned` にしないのは、intent を続けないという判断ではないためである。やり直すときは、その intent パスを入口に run を始め直す。次の try でこの intent を持ち込むときは、作業ツリーに残したこの intent をそのまま使い、この run ブランチからは持ち込まない(手順 1)。

- 終える(intent-only)とき:
  1. 開始時のブランチで `git commit -m "codiel(intent): <要約> (<slug> try-<n>)" -- <intent パス>` を実行する。
  2. `codiel-state start-phase intent --slug <slug>` を実行する。
  3. Raguel MCP の `evaluate_decision` を呼ぶ。ASK が返ったときは、現行どおり `mark-ask` で `awaiting_human` にしてから人の裁定を待つ(`raguel-gating` の手順に従う)。
  4. `codiel-state pass-gate intent --slug <slug> --evaluation-id <id> --verdict PROCEED` を実行する。
  5. `codiel-state close --slug <slug> --reason intent-only` を実行する。phase は `close` まで `intent` のままである。run ブランチは作らない。
- 続行するとき:
  1. `git switch -c <state.branch>` を実行する。
  2. `git commit -m "codiel(intent): <要約> (<slug> try-<n>)" -- <intent パス>` を実行する。
  3. `codiel-state start-phase intent --slug <slug>` → `evaluate_decision` → `codiel-state pass-gate intent --slug <slug> --evaluation-id <id> --verdict PROCEED` の順に進め、以降のフェーズへ移る。

保存に失敗したときは、intent 文書の全文をセッション内に提示したうえで保存先をユーザーに確認する。文書を失わせない。畳んだ経路があるときは、理由と使えるようにする方法を 1 行で報告する。

## 6. try-2 以降の持ち込み

前の try がある run(try-2 以降)では、新しい run ブランチは開始時のブランチから切る。前の try の intent は手順 1 で持ち込んである(文書だけで終えた try と `commit-failed` で止めた try の扱いも手順 1 に置く)。手順 5 の (1) は、持ち込んだ intent と同じパスに承認済みのドラフトを書く。

<HARD-GATE>
- **承認なしに intent 文書を保存しない。** ドラフトへの相槌や部分的な感想は承認ではない。承認はユーザーの明示的な返答だけである。
- **ドラフトを全文提示せずに承認を求めない。** 要約・抜粋・差分の提示に置き換えない。
- **`## 現状調査` を推測で書かない。** 読んで確かめられなかったことは書かない。
- **ヒアリングで埋まらなかった観点を推測で埋めない。** `## 未確定事項` に残す。
- **手順 4 のゲートより前に `docs/intents/` を作らない。**
- **手順 5 の (4)〜(6) の間にユーザーへの確認を挟まない。** stop-guard が active な run の停止を block するため、確認を挟むと止まれない。ただし (6) の `git switch -c` または `git commit` が失敗し `stop --reason commit-failed` で run を終端にした後の確認は例外とする。終端にした run は stop-guard の対象にならないためである。
</HARD-GATE>
