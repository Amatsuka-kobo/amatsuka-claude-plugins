# codiel・metatron 敵対的レビュー所見の修正 設計書

- 日付: 2026-10-05
- 入力: `harness-docs/design/2026-10-05-codiel-metatron-adversarial-review-findings.md`(以下「所見一覧」)、引き継ぎ書 `harness-docs/handover/2026-10-05-codiel-metatron-adversarial-fixes-handover.md`
- 前提の ADR: ADR-003・ADR-011・ADR-012・ADR-013・ADR-014
- 行番号は HEAD `fbe2d6f` で読み直した位置である。

## 1. 今回直す範囲は 1・2 章と 3-b〜3-d、3-e の high と安価な medium である

ユーザーと 2026-10-05 に次の 3 点を決めた。

- 範囲: 所見一覧の 1 章・2 章の全件、3-b・3-c・3-d の既知以外、3-e の high(I4-05・C3-05)と安価な medium(C3-09・R2-06・I4-08)を直す。low と既知の 9 件は直さず、所見一覧の「採否」に理由を書く。
- 3-a の保証範囲: ガードは「AI の誤操作を止める安全網」とし、意図的な回避は防がない。AI が通常の作業で書きうる形(`rm`、`cd` の後の相対パス、引数の引用符、短いオプションの結合、symlink を通る Write、GitHub MCP からの作成)だけを塞ぐ。
- 根が同じ組: 組ごとに共通の根を 1 箇所で直し、1 コミットにする。R2-01 は単独で最初に出す。

採否の全件は所見一覧の「採否」列に書き、この設計書には重複させない。

## 2. ガードの保証範囲を「安全網」として文書に明記する

- codiel と metatron の README に、hook のガードの保証範囲を書く。
  - 止めるもの: AI がツール(Write・Edit・Bash・GitHub MCP)で通常の書き方をしたときの、保護対象への変更と、フェーズに合わない外部への投稿。
  - 止めないもの: 引数の組み立てを意図的に変えた回避(heredoc・`eval` の中の投稿、設定ファイルの書き換えによる保護対象の付け替えなど)と、hook の matcher が対象にしないツール。
- この方針は ADR にしない(2026-10-05 にユーザーが判断した)。保証範囲は README とこの設計書に書く。
- metatron の README:115 のパスの規則は、`config-schema.md:77-82` に合わせて「字句で判定し、symlink の実体は見ない」と書く(M1-05)。`config-schema.md` は変えない。2 実装の追随は発生しない。

## 3. 進め方は「失敗するテスト → 修正 → build」を組ごとに回す

- `src/` を変える組は、所見の再現手順を失敗するテストとして先に足し、失敗を確かめてから直す。
- `src/` を変えたら `pnpm run build` を実行し、`plugins/*/scripts/` と `raguel-mcp/dist/` の差分を同じコミットに入れる。
- 指示書だけの組(I4 系の多く)はテストを持たない。代わりに次で確かめ、結果を完了報告に書く。
  - git の挙動に依存する手順は、/tmp の使い捨てリポジトリで手順どおりにコマンドを流す。
  - 判定規則の変更は、変更後の手順を所見の経路に当てて読み、経路が閉じることを書く。
- 指示書(`plugins/codiel/skills/**`・`references/**`)は `prompt-smith:prompt-smith` の規律で書く。`orchestrating-runs/SKILL.md` の §2.1・§2.4 の番号を変えない。
- `intent-format.md` に触れる組(I4-05・I4-08・I4-11)は、各コミットで `plugins/codiel/docs/format-change-checklist.md` の該当セクションの項目を追随させる。3 件を 1 コミットに束ねない(組ごと 1 変更の合意に従う)。
- バージョン: codiel は 1.0.0-dev のまま上げない。metatron は 0.4.0-dev → 0.4.1-dev とし、最初の metatron の変更のコミットで `plugin.json` と `package.json` を揃えて上げる。
- ルートの README は、metatron のバージョンが README に載っていれば追随させる。

## 4. 組ごとの変更

### 4.1 R2-01: diff に `--text` を付けて attributes の影響を消す

根: Raguel が作る diff が `.gitattributes`(作業ツリー・未追跡を含む)と `.git/info/attributes` と NUL の判定に従い、本文が `Binary files … differ` に置き換わる。

- 変更: `raguel-mcp/src/subject/code.ts:278-296` の本文の diff の引数に `--text` を足す。パス名だけを読む name-status の diff(:305-316)には足さない。`FIXED_CONFIG` は `-c` の設定の列で、`--text` は diff のオプションなのでそこには置かない。
- `--text` は git が読むすべての attributes の源(作業ツリーの `.gitattributes`・`.git/info/attributes`・system・global)と NUL の判定より優先して本文を出す(2026-10-05 に git 2.43 で確かめた)。
- guard 層(guard-write・guard-bash が `.gitattributes` と `.git/info/` を見ない点)は直さない。`--text` の後は attributes が diff の本文に影響しないので、guard で守る対象が無くなる。`diff=<driver>` は既存の `--no-ext-diff --no-textconv` が無効にしている。
- 副作用: `--text` でバイナリも偽の `+` 行になる。`code/max-diff-lines` は、NUL を含むファイルを変更行数に数えない(attributes に頼らず `--text` の diff の行で判定する)。`patternScan` と `common/secrets` はバイナリを除かない(除くと attributes や NUL で検査を外せる経路に戻る)。既知の限界として、`MAX_DIFF_BYTES`(20 MB)を超える大きなバイナリを含むコミットは `SubjectInputError` になる(raguel-redesign 設計書 §13 に記載)。
- `Binary files` の行が残った場合の追加の検査は足さない。`--text` を付けた diff はこの行を出さない。
- テスト(先に足す)
  - `subject/__test__/code.test.ts` の `describe("collectCodeSubject")`: 未追跡の `.gitattributes`(`* -diff`)、`.git/info/attributes`(`* -diff`)、NUL を含むファイルの 3 経路で、diff に追加行の本文が入る。ヘルパーは `subject/__test__/helpers/gitRepo.ts`。
  - `core/__test__/pipeline.golden.test.ts`: 未追跡の `.gitattributes`(`* -diff`)を置き、秘密情報か破壊操作の追加行を含むコミットを評価すると verdict が STOP になる。Done の条件の確認をこのテストで固定する。
- 文書: `harness-docs/design/2026-09-28-raguel-redesign-design.md` §6.2.2 手順 4 のコマンド(:293-297)に `--text` を足す。
- コミット: 1 つ(R2-01)。

### 4.2 R2-02: submodule の追加と参照先の変更を依存として扱う

- 変更: `rules/code/newDependency.ts`
  - `.gitmodules` は解析しない。空行とコメント(`#`・`;` で始まる行)以外の追加行が 1 行でもあれば、そのファイルで 1 件の ask を出す。キーの大小・空白・タブ・見出しの変形・include などの書式の揺れで、パーサーとの差による抜けを作らないためである。
  - mode 160000 のファイルの `Subproject commit` 行の追加(参照先の変更と、`.gitmodules` を変えない gitlink の新規の追加)も新しい依存と同じ重さ(ask)にする。名前は submodule のパスとする。`.gitmodules` の追加と同じ submodule で二重に出ても ask が 1 つ増えるだけなので、重複は除かない。
  - `subject/code.ts` の `FIXED_CONFIG` に `diff.submodule=short` と `diff.ignoreSubmodules=none` を足す。利用者の git 設定(`log` 形式や無視の設定)で `Subproject commit` の行が消えたり形が変わったりしないようにする。
- テスト: `rules/code/__test__/newDependency.test.ts` に `.gitmodules`(設定行の追加、書式の揺れ 8 件、空行・コメントと削除だけでは出さない)と `Subproject commit` の追加・変更。ヘルパーは `rules/code/__test__/helpers/diff.ts`。`subject/__test__/code.test.ts` に、リポジトリの設定を `diff.submodule=log` と `diff.ignoreSubmodules=all` にしても、gitlink の更新が `Subproject commit` の行で diff に入ることを 2 件。
- 文書: raguel-redesign 設計書 :453 の `code/new-dependency` の行。
- コミット: 1 つ。

### 4.3 M1-01: 正本への書き込みを一時ファイル + rename にそろえる

根: 正本を `writeFileSync` で直接書き、途中で失敗すると切り詰められる。

- 変更
  - `plugins/metatron/src/lib/atomic-write.ts` を新設し、`writeFileAtomic(target, data)` を export する。
    - 正本が symlink のときは、リンクを辿った実体のパスの隣に一時ファイルを作って rename する。symlink を潰さず、別のファイルシステムへの rename も起きない。
    - 実体がまだ無い symlink(リンク先のファイルが未作成)も、今の直接書き込みと同じく作れるようにする。`realpathSync` が ENOENT のときは `readlinkSync` でリンク先を辿り(リンクの置き場からの相対で解決し、循環は回数の上限で止める)、辿り着いたパスへ書く。
    - 既存ファイルの mode を引き継ぐ。失敗したら一時ファイルを消し、元の例外をそのまま投げ直す。専用のエラークラスは作らない。呼び出し側の例外の扱い(staging の `write_failed` など)は今のまま変えない。
    - 書き込み先の親ディレクトリは、今の `mkdirSync(..., { recursive: true })` と同じく作る。
  - 置き換える箇所は 4 つ: `staging.ts:542`(commit-architecture・commit-rules・ADR)、`gotchas.ts:914`(`initGotchasLedger`)、`:943`(`appendGotcha`)、`:1031`(`tagGotcha`)。
  - `adr-candidates.ts` と `gotcha-candidates.ts` の既存の `writeAtomically` は、エラーの包み方が違うので今回は統合しない。
  - staging の消費の印を書き込みの前に付ける順序は変えない(`staging.ts:440-460` のコメントが巻き戻しを却下している)。書き込みに失敗しても正本は元のまま残り、staging は消費済みになる。利用者は stage からやり直す。
- テスト
  - `src/lib/__test__/staging.test.ts` の T8c 付近: `installWriteFaults` を拡張し、先頭の数バイトだけ書いて ENOSPC を投げる spy で、正本が元のバイト列のまま、一時ファイルが残らないことを確かめる。
  - `src/lib/__test__/gotchas.test.ts`: init・append・tag の 3 経路に同じ確認を足す。
  - 正本が symlink のとき、commit 後も symlink のまま実体が更新されることを 1 件足す。実体が未作成の symlink への新規作成の commit が成功し、リンク先にファイルができることを 1 件足す。
- 文書: `references/cli-usage.md:40-42` を「非 0 のとき正本は 1 バイトも変わらない。staging は消費済みになることがある」に直し、:195 と食い違わないようにする。
- metatron のバージョンをこのコミットで上げる。
- コミット: 1 つ。

### 4.4 B5-01: ADR 候補の縮約は書き込みの直前に領域ファイルを読み直して照合する

- 変更: `adr-candidates.ts` の `shrinkAdrCandidate` で、`writeAtomically`(:601)の直前に対象を読み直し、最初に読んだ `parsed.buf` とバイト列で比べる。違えばエラーコード `file_changed` で拒否し、1 バイトも書かない。
- ロックは足さない。再照合と rename の間の短い窓は残る(安全網の範囲)。
- テスト: `src/lib/__test__/adr-candidates.test.ts` の縮約の群に、読み込みの後で候補外の行を書き換えると `file_changed` で拒否され、書き換えた内容が残ることを足す。差し込みは `fs.readFileSync` の spy で 2 回目の返り値を変える。
- 文書: `references/cli-usage.md:141-156` のエラーコード一覧に `file_changed` を足す。`references/architecture-format.md` の「ADR 候補の取り込み」と、`plugins/metatron/docs/format-change-checklist.md` の同名セクション(:65)を追随させる。4.5・4.16 の checklist も metatron の側を指す。
- コミット: 1 つ。

### 4.5 B5-02: `ADR 候補 ID:` の行はコードフェンスの外だけを数える

- 変更: `adr-candidates.ts:311-318` の `candidateIdsIn` で、既存の `scanFences(entry.raw)`(`architecture.ts:146`)を呼び、`insideFence[i]` の行を飛ばす。呼び出し元 3 箇所はこの関数を通るので、1 箇所で直る。
- テスト: 同テストファイルで、フェンスの中だけに `ADR 候補 ID: x` を持つ ADR に対し、走査の `adoptedAs` が null になり、縮約が `candidate_id_line_missing` で拒否される。
- 文書: `references/architecture-format.md` の「ADR 候補の取り込み」に「フェンスの中の行は数えない」を足す。checklist の同名セクションを追随させる。
- コミット: 1 つ。

### 4.6 R2-05: code の diff の秘密情報は追加行だけを STOP の対象にする

- 変更: `rules/common/secrets.ts:174` で、成果物の種別が code のときは `parseDiff` の `additionLines` に入らない行(削除行と文脈行)を `skip` に足す。文書(plan・design)は今のまま全行を見る。
- 削除行と文脈行の秘密は、この変更より前から履歴かファイルにあり、今回の変更が持ち込んだものではない。秘密を取り除く変更と、既存の固定データの隣の変更で run を止めない。
- `maskSecrets` は `skip` を使わず全行を伏せたままにする。Jev へ送る本文の伏せ字は変わらない。
- テスト: `rules/common/__test__/secrets.test.ts` に、削除行だけ・文脈行だけに秘密がある diff は STOP にならず、追加行にあれば STOP になる 3 件。伏せ字が削除行にも当たることを 1 件。
- 文書: raguel-redesign 設計書 :468-475 に検査の対象行を足す。
- コミット: 1 つ。

### 4.7 I4-01: intent-only の退避は HEAD から index と作業ツリーを戻す

- 変更: `capturing-intent/references/intent-only.md:7` の `git restore <intent パス>` を `git restore --source=HEAD --staged --worktree <intent パス>` にする。
- HEAD に無いパスは index と作業ツリーから消え、続く `git switch <base>` が通る(2026-10-05 に /tmp で確かめた)。
- 書き戻しの後、コミットの前に `git add -- <intent パス>` を足す。切り替え先に intent が無いと、書き戻したファイルは未追跡になり、パスを指定した `git commit -- <パス>` の対象にならない。
- 検証: /tmp で、ベースに intent が無い初期状態から「run ブランチで intent を書き直して `git add` → 退避 → `git restore --source=HEAD --staged --worktree` → `git switch main` → 書き戻し → `git add` → `git commit -- <パス>`」を流す。switch とコミットが成功し、ベースに新しい本文がコミットされることを確かめる。
- 文書: `harness-docs/design/2026-10-05-codiel-run-structure-followups-design.md` §8 :241 の intent-only の手順を追随させる。
- コミット: 1 つ。

### 4.8 C3-05 と I4-02: run ブランチは自分の run のものだけを使い、intent-only の後は base の intent を正にする

根: capturing-intent の手順 1 の 4 が、`codiel/<slug>` があれば所有も由来も見ずに切り替える。そのため、他人のブランチや同名の worktree ブランチを try-1 で再利用し、intent-only が base に残した新しい intent より古い run ブランチの本文を読む。

- 実行順: capturing-intent は、手順 1 の 4(開始時のブランチの決定と切り替え) → 手順 5 の (4) `init` → (6) の run ブランチの作成か切り替え、の順に進む。init の時点では、この run はまだ run ブランチを作っていない。手順 1 の 4 の「最新の try」は、init の前に `codiel-state get --slug` で読む前の try を指す。(6) の「`state.branch` が既にある」は、init が作った新しい try の `state.branch` が指す ref(`codiel/<slug>`)が存在することを指す。
- 変更(コード): `codiel-state init` で try-1 を作るとき、`git show-ref --verify --quiet refs/heads/codiel/<slug>` が成功したら失敗する。run の無い slug に既存のブランチがあるのは、利用者が作ったか別の slug の worktree ブランチと名前が重なったときだけである。失敗文で、ブランチを消すか別の slug を選ぶよう案内する。
- 変更(指示書): `capturing-intent/SKILL.md` 手順 1 の 4 を次のとおりにする。
  - `codiel-state get --slug <slug>` で run が無いのに `codiel/<slug>` があれば、切り替えずに人に確かめて止まる。
  - 最新の try の `branch` が null(前の try が intent-only)なら、run ブランチへ切り替えず、ベースブランチを開始時のブランチにする。
  - それ以外で `codiel/<slug>` があれば、今どおり切り替える。
- 変更(指示書): 手順 5 の (6) の 1 で、開始時のブランチが別で `state.branch` が既にあるときは、intent-only と同じ退避の形で切り替える。intent の本文を退避し、`git restore --source=HEAD --staged --worktree <intent パス>` → `git switch <state.branch>` → 退避した本文を書き戻し、`git add -- <intent パス>` してからコミットする。run ブランチの古い intent は新しい本文で置き換わる。
- `carry-over-intent.md:3, :9` の前提(「手順 1 の 4 で切り替え済み」「intent-only の try の intent は開始時のブランチ」)を、上の分岐に合わせて書き直す。
- slug の規則(`intent-format.md:7`)は変えない。init の検査で衝突を止めるので、契約に触れずに済む。
- テスト: `src/__test__/codiel-state.test.ts` の try-1 SKIPPED のテスト(:601)付近に、`codiel/demo` を先に作った状態で `init --slug demo` が失敗し、state が書かれないことを足す。try-2 以降は既存のブランチがあっても通ることを 1 件。
- 検証(指示書): /tmp で「try-1 で run ブランチを作って stop → try-2 を intent-only で base にコミット → try-3 を続行」を流し、run ブランチの intent が try-2 の本文になることを確かめる。
- 文書: followups 設計書 §1.2(:32-39)と §8 :234-239。
- コミット: 1 つ。

### 4.9 I4-12: 未追跡ファイルの退避は `-u` とパスの指定を併用する

- 変更: `capturing-intent/references/uncommitted-changes.md:9` を `git stash push -u -m <タグ> -- <intent 以外のパス>` にし、「`-u` はパスの指定と組で使う」と書く。パスを指定すれば intent は含まれない。
- 検証: /tmp で未追跡ファイルと intent を置き、上のコマンドで未追跡ファイルだけが退避されることを確かめる。
- コミット: 1 つ。

### 4.10 C3-11: 壊れた state は該当の run を飛ばし、stop-guard は例外でセッションを止めない

- 変更
  - `codiel-state.ts` の `latestTries` で、`readState` の例外と `phases` の欠けた state を捕まえ、その slug を飛ばして標準エラー出力に slug 名を 1 行出す。
  - 壊れた state の run は CLI からも操作できないので、run が無いものとして扱う。壊れた state が実際の active run のものなら、その run のガードは外れる。安全網の範囲で受け入れる。
  - `hooks/stop-guard.ts` を try/catch で包み、例外のときはセッションの停止を通す。block にすると利用者が止まれなくなる。
- テスト: `src/__test__/codiel-state.test.ts` の findActiveRun の群(:2507)に、別 slug の state が壊れていても正常な run が返ることを足す。`hooks/__test__/stop-guard.test.ts` に、壊れた state があっても停止を block しないことを足す。
- コミット: C3-11 と I4-10 は根が違うので分ける。

### 4.11 I4-10: `metatronRules` は読めるディレクトリのときだけ true にする

- 変更: `check-intent-env.ts:254` を、`fs.accessSync(dir, R_OK | X_OK)` が通ったときだけ true にする。
- テスト: `src/__test__/check-intent-env.test.ts:1179` の群に、権限を外した rules ディレクトリで false になることを足す(root のときは飛ばす。「ケース 24」:675 の分岐に倣う)。
- コミット: 1 つ。

### 4.12 3-a: AI が通常書く形のガードの抜けを塞ぐ

方針は第 2 セクションの安全網とする。C3-07・B5-03・M1-05(コード)・C3-14・M1-07・M1-08・R2-10 は直さない。

#### 4.12.1 C3-01: GitHub MCP の作成にも gh と同じフェーズの検査を当てる

- 変更
  - `guard-bash.ts:936-961` の try ブロックに直書きされたフェーズの検査を、`hooks/lib.ts` の関数(`ghPostPhaseProblem(kind, state)`)へ移す。`kind` は `"pr"` と `"issue"` である。
  - guard-bash と guard-github-mcp の両方から呼ぶ。
  - MCP 側の対応: `create_pull_request` は PR の作成、`create_issue` と `issue_write`(`method: "create"`)は Issue の作成とする。`issue_write` の判別は github-mcp-server の仕様(`method` が `create` か `update`)に従う。
  - gh 側のフェーズの検査は Issue の作成と PR の作成(と push)だけで、コメントと更新には掛かっていない。MCP 側も作成の 3 ツールだけに掛け、コメント・更新・レビューのツールはマーカーの検査だけを残す。
- 設計書 2026-09-27 決定 69 の「マーカー検査は関数を共有しない」とは衝突しない。共有するのはフェーズの検査だけで、マーカーの検査は各 hook に残す。
- テスト: `hooks/__test__/guard-github-mcp.test.ts:61-89` の既存のループは、init 直後の作成を許す前提なので、作成系 3 ツールの期待を「拒否」に直す。PR を作れるフェーズまで進めた run で許すことを足す。フェーズを進めるヘルパーは、guard-bash.test.ts の `setupRunAtPr`(:199)・`setupRunAtTriage`(:226)と、それらが使う `passGateOf`(:163)・`recordEvaluation`(:111)を `hooks/__test__/helpers/` へ移し、2 つのテストから import する。
- 文書: 設計書 2026-09-27 §6.8 の GitHub MCP の hook の規則(:1295-1300 付近)と A2-22(:302)。

#### 4.12.2 C3-06: git の解析を既存のトークナイザに替え、force の判定を広げる

- 変更
  - `guard-bash.ts` の `findGitInvocations`(:49)の入力を、gh 側と同じ `parseCommands(cmd) ?? splitLoosely(cmd)` の語の列にする。引用符が外れ、`git "push"` と `git push origin "main"` を判定できる。
  - `isForceToken`(:90)を、`-` で始まる短いオプションの結合に `f` を含むもの(`-vf` など)と、`+` で始まる refspec も force に数える形に広げる。
- force と保護ブランチの判定には、字句解析の読み方と、以前の行の走査(`joinContinuedLines(cmd).split(SEGMENT_SPLIT_RE)` で区切り、語の前後のクォートと括弧を外したもの)の両方を当てる。どちらかで当たれば拒否する。字句解析だけにすると、heredoc と here-string でシェルへ渡した本文(`bash <<EOF` … `git push -f`、`bash <<< "git push -f"`)の push を見落とす。フェーズの検査に使う push の有無も、同じく両方の読み方のどちらかで push と判定すれば検査を掛ける(セキュリティレビューの指摘で、字句解析だけにした形から戻した)。コミットメッセージの heredoc に `git push` と書いただけのコマンドも、フェーズの外では拒否する。以前と同じ挙動である。
- 副作用: `bash -c "git push -f"` が新しく見えるようになる。heredoc の本文に書いた `git push --force`(コミットメッセージの中のものを含む)は、行の走査で今までどおり拒否する。誤検知の側に倒している。
- テスト: `hooks/__test__/guard-bash.test.ts` の push の群に、`git "push" --force`、`git push origin "main"`、`git push -vf`、`git push origin +feature` の 4 件と、`bash -c "git push -f"`、heredoc と here-string でシェルへ渡した `git push -f` を足す。既存の heredoc のテスト(git commit メッセージの中の gh)が回帰を見る。

#### 4.12.3 C3-02: state.json の保護は `cd` を追った解決後のパスで判定し、`rm` などを含める

- 変更(Bash)
  - コマンドの中に現れた `cd <dir>` の行き先をすべて集め、元の cwd と合わせて cwd の候補にする。サブシェル・パイプ・`{ }` の区別はせず、どれか 1 つの候補で保護対象に当たれば拒否する。拒否が広がる向きに倒し、cd の効く範囲を正確に追う解析は持たない。
  - 語を各候補の cwd と字句で結合し、`..` を畳む前に、存在する最深の祖先まで前から `realpathSync` で実体化してから残りを付ける(4.12.4 と同じ順序)。`path.resolve` で先に `..` を畳むと、`alias/../state.json`(alias は try のディレクトリの下を指す symlink)が別のパスに化ける。この解決関数は codiel の `hooks/lib.ts` に置き、metatron の実装とは独立に持つ(ARCHITECTURE の「他プラグインの src を import しない」)。その結果が`<root>/.codiel/runs/` の配下の `state.json` か、`runs/` 配下のディレクトリかで判定する。
  - 対象の操作に `rm`・`mv`・`cp`・`ln` を足し、親ディレクトリの削除(`rm -rf .codiel/runs/<slug>`)も拒否する。
  - 判定をパスの解決に替えると、/tmp のテストデータに `state.json` の文字列が入っているだけのコマンドは拒否されなくなる(所見一覧 4 章の C3-15 の誤検知が消える)。active run が無くても拒否する性質(ALWAYS_DENY)は残す。
  - 実装時に足した事項(セキュリティレビューの指摘による)は次の 3 つである。
    - 語に `.codiel/runs/…state.json` を含むかの字句の検査も残し、解決したパスの判定と両方を当てる。`$PWD/.codiel/runs/…/state.json` のようにシェルの展開を含む語は、解決したパスでは当たらないためである。字句の検査は語ごとに当てるので、C3-15 の誤検知は戻らない。
    - 照合の候補は 3 つにする。字句で畳んだパス、生の結合パスを実体で辿ったパス、字句で畳んだパスを実体で辿ったパスである。Bash と Write の両方に当てる。
    - 解決関数は、途中に存在しないセグメントがあっても早く返さず、後ろのセグメントで realpath を試し直して最後まで辿る(`nodir/../alias/state.json`)。
  - 続くセキュリティレビューの指摘で、さらに次の 3 つを足した。
    - cwd の候補が上限(64)を超えたら、打ち切って素通しせず拒否する。
    - `ln` の引数(リンク先と作るリンクの名前)のどれかが runs の配下か runs を含む祖先に解決されれば拒否する。同じコマンドで symlink を作ってから書く形(`ln -s .codiel/runs/x/try-1 a && echo '{}' > a/state.json`)を止めるためである。
    - heredoc と here-string でシェルへ渡したコマンドの中の書き込みと削除を止めるため、4.12.2 と同じ行の走査で作った語の列にも同じ判定を当てる。行の走査では、ファイル操作のコマンド名を、区切りの先頭の語・`<<<` の直後の語・シェルの `-c` の直後の語でだけ認める。printf などのデータの中の `cp …` をコマンドと読むと、C3-15 の誤検知が戻るためである。`sudo`・`env` などが前に付く形は、字句解析の側が拾う。
- 変更(Write/Edit): `guard-write.ts:241` で、論理パスに加えて、`path.resolve` の前の生の結合パスを上の解決関数に通した結果にも同じ判定を当てる。
- テスト: `hooks/__test__/guard-bash.test.ts` の state.json の群(:299、:490)に、`rm <state.json>`、`cd .codiel/runs/x/try-1 && echo > state.json`、`rm -rf .codiel/runs/x` の拒否と、/tmp のパスに `state.json` を含む printf の許可を足す。`hooks/__test__/guard-write.test.ts` に symlink を通した Write の拒否を足す。Bash と Write の両方に `alias/../state.json` の拒否を 1 件ずつ足す。
- 文書: 設計書 2026-09-27 §6.16.2(決定 96)の既知の限界の記述と、`guard-bash.ts:761-763` のコメント。

#### 4.12.4 M1-04: guard-docs は `..` を畳む前に、存在する最深の祖先を実体化する

- 変更: `guard-docs.ts` の `realpathOrParent` を書き換える。入力を字句で畳まずにセグメントを前から辿る。存在する最深の祖先まで `realpathSync` し、残りのセグメントを付ける。`comparisonKey` の呼び出し側(:214-239)の `path.resolve` も、この関数に生の結合パスを渡す形に替える。正本の側の key も同じ関数で作るので、両辺に同じ規則が掛かる。
- 候補パスごとに、生の結合パスを実体で辿ったキーと、`path.resolve(cwd, <パス>)` で字句で畳んだ従来のキーの 2 つを作り、どちらかが正本のキーに当たれば拒否する。
- テスト: `src/__test__/guard-docs.test.ts` の D7 系(:199-290)に、`alias/../ARCHITECTURE.md`(alias は別ディレクトリへの symlink)と、親ディレクトリが未作成の正本へ symlink を通した Write の 2 件を足す。

#### 4.12.5 文書の保証範囲(M1-05 ほか)

- 第 2 セクションの README の記述を、この組のコミットに入れる。ADR は作らない。

#### 4.12.6 コミット

- C3-01・C3-06・C3-02 は guard の根(文字列とツール名の一致)が同じだが、触る hook が別なので、hook ごとに 3 コミットに分ける。M1-04 は metatron で 1 コミット。README は 1 コミット。

### 4.13 C3-03・C3-04・C3-08: STOP の再提出は Raguel の記録と state の構造化した値で判定する

根: STOP の扱いが、自由文の note の文型、mark-ask が書く state の verdict、SHA の不一致だけに頼っている。

- 変更(C3-04、pass-gate)
  - `codiel-state.ts` の pass-gate(:1056 以降)で、STOP の有無を state の `ph.verdict` ではなく Raguel の索引から決める。
  - 判定は `phaseStops(readEvaluationIndex(store), raguelRunId, phase)` のうち、`judgeStatus` が `ok` で、裁定(`readOutcomes`)が `false-positive` でない行が 1 件でもあるか、とする。
  - `judgeStatus` は基盤の障害の有無を表し、`degraded` は ADR-011 のとおり ASK になる。STOP の行は `ok` なので、この条件で人の裁定の無い STOP を落とすことはない。条件は `unresolvedStops`(`raguel-records.ts:480-499`)と同じにそろえる。
  - この結果を `resubmitAfterStop`(:1071-1078)、:1081 の拒否、:1124-1135 の `stopIds`・`stopRow` の算出に使う。
- 変更(C3-03、init)
  - `codiel-state.ts:884-888` で、前の try の全フェーズの note を `unresolvedStops` へ渡すのをやめる。
  - 「再提出で通した STOP」は、前の try の carry-over が `passed` で、その `phases["carry-over"].evaluationId` が、索引でその STOP より後ろの PROCEED の行であるものに限る。
  - `evaluationId` は mark-ask も書くが、STOP を記録した後は上書きしない(`codiel-state.ts:1219-1226`)。`passed` になった時点の値は、pass-gate が通した評価の ID である。比べるのはこの 1 つだけとする。
  - note の文型は人が読む記録として残し、判定には使わない。`raguel-records.ts:464-467` の `resubmittedIds` は、索引の順序で判定する関数に置き換える。
- 変更(C3-08): :1134 の「HEAD が進んだ」を、次の 3 条件をすべて満たすことにする。
  - `stopHead !== head`
  - `isAncestor(root, stopHead, head)`
  - `changedPathsSince(root, stopHead)` が空でない
  - 内容を変えない amend、reset、別ブランチへの switch はここで落ちる。
- state の形は変えない。
- テスト(`src/__test__/codiel-state.test.ts`)
  - C3-04: implement の STOP 拒否のテスト(:818)に倣い、mark-ask を経ずに STOP を記録してから PROCEED を記録し、pass-gate が失敗する。
  - C3-03: carry-over の再提出の群(:724-830)に、discuss の `complete-phase --note` に再提出の文型を書いても、次の init が `--human-approved` を求めることを足す。
  - C3-08: :763 の隣に、`git commit --amend --no-edit`・`git reset --hard HEAD~`・別ブランチへの switch の 3 件で pass-gate が失敗することを足す。
- 文書: followups 設計書 §8 :234-243、`orchestrating-runs/references/phase-carry-over.md:7-9`、`raguel-gating/SKILL.md:165-185`。指示書の記述は「note を書く」を残し、「note で判定する」読み方の記述があれば消す。
- コミット: 1 つ。

### 4.14 C3-10: record-attempt は終端の run を拒否する

- 変更: `codiel-state.ts:1339` の record-attempt の先頭で `TERMINAL.has(latest.state.status)` なら失敗する。上限を超えた後の `awaiting_human` → `resume` の運用は残すので、`active` に限る検査にはしない。
- pass-gate と complete-phase の終端の検査の欠落(範囲外で見つかった点)は今回扱わない。
- テスト: :1288 付近に、stop の後の record-attempt が失敗し、run が `stopped` のまま残ることを足す。
- コミット: 1 つ。

### 4.15 R2-03・R2-04: resubmission-loop は revise を比較に残し、前回と今回を同じ基準でそろえる

根: 比較の相手を選ぶ規則が、裁定の種類と Jev の調整の前後を区別しない。

- 変更(R2-03): `casefile/store.ts:415` の `hasRuling` を「`ruling` が `as-is` か `false-positive`」にする。revise は人が「直して再提出せよ」と指示した記録なので、再提出の比較の相手に残す。
- 変更(R2-04)
  - `core/pipeline.ts` の `record()` が書く `01-rules.json` に、Jev の調整の前の ask 以上の ruleId の列を `askRuleIdsBeforeJudge` として足す。
  - `readPriorAttempts`(`store.ts:398-404`)は、このキーがあればそれを、無ければ今の findings を読む。変更前のケースファイルもそのまま読める。
  - 今回側は Jev の前に計算しているので、前回側をそろえれば両者が同じ基準になる。
  - codiel の pass-gate は `01-rules.json` を読まないので、ADR-011 の 2 者比較には掛からない(2026-10-05 に grep で確かめた)。実装の後で、codiel の `raguel-records.test.ts` などの比較テストがパスすることを確かめる。
- テスト
  - `casefile/__test__/store.test.ts` の :513 の群: revise の attempt は `hasRuling: false`、as-is と false-positive は true。既存の revise の期待(:547-565 付近)を直す。
  - `core/__test__/pipeline.golden.test.ts` の :935 の群: `fakeJev` で info を ask に上げた評価の後、Jev の効かない再評価で同じ本文が resubmission-loop の ASK になる。
- 文書: `plugins/codiel/docs/raguel-contract.md:116-133`(01-rules.json のキー)と :118・:166、raguel-redesign 設計書 R3(:25)と :520-530。
- コミット: 1 つ。

### 4.16 M1-02・M1-03・M1-06: CLI は組み上げた後の全文を既存の parser で読み直してから保存する

根: stage と append が入力の部分だけを検査し、差し込んだ後の文書を見ない。

- 変更(M1-02): `architecture.ts` の `applySectionChanges` の戻り値(:849 と新規作成の :762-767)を、次の 3 点で検証する。違反は既存の拒否と同じ形(エラーコード付き)で返す。
  - `parseArchitecture` が `unclosed_fence` を返さない。
  - ドメインマップのブロックがあれば `extractDomains` が ok を返す。
  - `## ADR 一覧` の見出しの数が変更前と同じで、ADR のエントリの ID と状態の組が変わらない(stage-architecture の場合)。ADR 一覧を持たない文書(セクションはすべて任意で、ドメインマップだけの文書も正当)は、持たないままなら通す。新規作成(`createArchitecture`)も同じ条件で通る。
- 変更(M1-03): `adr.ts` の `buildAdrAddition`(:716-749)と `buildAdrStatusChange`(:773-863)で、次の 2 つを行う。
  - 入力の検査(`validateAdrAddInput` と状態変更の理由): 散文のフィールドに、フェンスの外でエントリの見出し(`### ADR-`)・状態行(`- 状態:`)・小見出し(`#### `)に当たる行があれば拒否する。parser は最初の状態行だけを採るので、全文の読み直しだけでは後ろに入れた状態行を拒否できない。
  - 組み上げた全文の読み直し: `parseAdrDocument` の `unclosedFence` が立たないこと。追加ではエントリ数が 1 増え、新しいエントリの ID と状態が入力どおりで、ID の重複が無いこと。状態の変更ではエントリ数が変わらず、対象の状態だけが変わること。
- 変更(M1-06): `gotchas.ts` の `buildAppendedText`(:565-578)の末尾で、追記した全文を `parseGotchas` で読み直し、新しいエントリの `tag` が null で、タイトルが入力どおりであることを確かめる。検証は `withFileLock` の中で書き込みの直前に行う。
- テスト
  - `src/lib/__test__/architecture.test.ts`: body に `## ADR 一覧`、閉じていないフェンス、不正なドメインマップを入れると stage が拒否される 3 件。ADR 一覧の無い新規作成(既存の A7、:296-320)と、ADR 一覧の無い既存文書の更新が通る回帰を確かめる。
  - `src/lib/__test__/adr.test.ts`: 散文に改行と `### ADR-001:` を入れた入力、背景に閉じていないフェンスを入れた入力、正規の状態行の後ろの散文に `- 状態: 値域外` を入れた入力が拒否される 3 件。
  - `src/lib/__test__/gotchas.test.ts`: title が `[解決済み] …` の append が拒否される 1 件。
- 実装時に決めた事項
  - ADR 一覧の照合は adr.ts を import せずに行う(adr.ts が architecture.ts を import しており、逆向きは循環になる)。`## ADR 一覧` の数と、最初の ADR 一覧の原文(末尾の空白を除く)のバイト一致で判定する。stage-architecture は ADR 一覧を対象にできないので、ID と状態の組より強い条件でも正当な更新を拒否しない。
  - stage-architecture の body に閉じていないフェンスがあれば、body の単位で `unclosed_fence` として拒否する。後ろのセクションのフェンスで閉じられると、全文の読み直しは通るが間の見出しがフェンスに飲まれるためである。stage-adr の散文の項目も同じ理由で、項目の単位で拒否する。
  - ドメインマップの検査は、変更前の文書のブロックが読めていたか、ブロックが無かったときだけ拒否する。変更前から壊れている文書では、stage-adr も他のセクションの stage-architecture も今までどおり通し、ドメインマップを正しい body に差し替える更新も通す。
  - stage-adr の読み直しでは、ADR 一覧以外の `##` 見出しの並びと ADR 一覧の数が変わらないことも確かめる。散文の `## ` 行で ADR 一覧が切れても、エントリ数・ID・状態の 3 条件は通るためである。
- 文書: `references/architecture-format.md`(stage の拒否の記述)、`references/gotchas-format.md`(§6-2 の入力制約)、`references/cli-usage.md` の stage-architecture・stage-adr・append-gotcha のエラーコード。`docs/format-change-checklist.md` の ARCHITECTURE・ADR・GOTCHAS の書式のセクションを追随させる。拒否が増えるだけで書式は変わらないので、固定データ(`THREE_ADRS` など)は変えない。
- コミット: 1 つ。

### 4.17 I4-09: intent の frontmatter は intent 専用の読み取りで解釈する

- 変更: `check-intent-env.ts` に intent 用の読み取り関数を足し、`parseIntentDoc`(:282-295)から使う。リストの値(`  - item`)を項目値として読まず、閉じ区切りは `^---[ \t]*$` の行に限る。テンプレート用の `parseTopLevel` は labels のリストが要るので変えない。
- 実装を契約(`intent-format.md:25`)に合わせる修正で、契約の文書は変えない。
- テスト: `src/__test__/check-intent-env.test.ts` の「intent 書式 v2」(:574)付近に、リスト形式の値が読まれないこと、`----x` の行が閉じ区切りにならないことの 2 件。
- コミット: 1 つ。

### 4.18 I4-04/B5-04・I4-07/B5-05: 候補の写し済みは、写したコミットの到達と本文の一致で判定する

根: codiel の手元の記録が、写し済みかどうかを「写し先 slug の最新 try の status」と「見出しの一致」だけで判定する。

- 変更(I4-04/B5-04): `orchestrating-runs/references/gotcha-candidates.md`
  - try のローカルレポート(`reports/gotcha-candidates.md`)の各エントリにある `写し先` の値を `<path>(<slug>, <コミット>)` にし、写したコミットの SHA を残す。持続層の領域ファイルと intent 文書には書かない。
  - 写し済みの判定を、次のどちらかを満たすことにする。
    - そのコミットがベースブランチか今の HEAD の祖先である(`git merge-base --is-ancestor`)。同じ slug の後続の try は同じ run ブランチで続くので(ADR-014)、HEAD の祖先になる。
    - 写し先 slug の最新 try が `completed` か `awaiting_outcome` である(今の判定)。squash merge で元のコミットがベースの祖先にならない場合も、run が完了していれば写し済みとする。
  - どちらも満たさなければ集め直す。満たせば、metatron がその後に候補を消していても作り直さない。
  - この判定は incident の走査(:40-44)だけでなく、同じ slug の候補を集める規則(:36、:45)と、`adr-candidates.md` の収集規則(:47-52 の読み替えと :49)にも当てる。`写し先` の行の有無だけで外す規則は残さない。
  - 人が選んだ `写さない(<理由>)` の印は、コミットの到達と関係なく今のまま保ち、集め直さない。
- 変更(I4-07/B5-05): 同一の判定を、GOTCHAS 候補は「見出しと `mistake` の一致」、ADR 候補は「見出しと `制約` の一致」にそろえる(`gotcha-candidates.md:23, :53`、`adr-candidates.md:18`)。見出しが同じで本文が違う候補は別のエントリとして足し、metatron 側の確認(recording-gotchas の 4 択)へ届ける。
- 手元の記録の形式は codiel の指示書が定義するもので、`intent-format.md` には触れない。
- 検証: 変更後の手順を次の経路に当てて読み、どれも閉じることを完了報告に書く。所見の 2 経路(後続 try による取り残し、metatron の削除後の作り直し)、squash merge の後に metatron が候補を消した経路、通常候補を写した後に run ブランチをそのコミットより前へ戻した経路、同じ見出しの別の失敗。
- コミット: 1 つ(同じファイルの判定規則なので 2 組を束ねる)。

### 4.19 I4-03: 合意済み事項と設計判断と carry-over の修正判断も ADR 候補の判定にかける

- 変更: `orchestrating-runs/references/adr-candidates.md:5-11` の判定の対象に、intent の「合意済み事項」の表の行、design.md の設計判断、carry-over で採った修正判断を足す。判定は今と同じ 3 条件とする。`syncing-intents/references/persistent-layer.md:9-18` の取り込み手順に、この対象を判定する手順を足す。
- 判定の主体は intent-sync とし、capturing-intent の手順は変えない。
- 検証: 3 種の対象がそれぞれ手順のどこで判定されるかを読み、`intent-format.md` の 3 条件の記述と食い違わないことを確かめる。
- コミット: 1 つ。

### 4.20 I4-06: carry-over の妥当な STOP を直して続行するときも GOTCHAS 候補を書く

- 変更: `orchestrating-runs/references/phase-carry-over.md` の「修正して再提出」の手順の末尾(5 の 5 の後)に、STOP 由来なら GOTCHAS 候補を 1 件書く手順を足す。番号はずらさない。`gotcha-candidates.md:7` の時点に「carry-over で妥当な STOP を直して再提出を選んだ直後」を足す。ASK 由来の修正は含めない。
- コミット: 1 つ。

### 4.21 I4-11: knowledgeTarget が metatron のときの書式の記述を手順に合わせる

- 変更: `references/intent-format.md:314-316` を「持続層には書かない。metatron が ADR にした後で、`関連 ADR` に番号が入る」に直す。手順側(`persistent-layer.md:23-26`、`adr-candidates.md:47`)は codiel が ADR 番号を知らない前提で正しいので変えない。
- `docs/format-change-checklist.md` の「持続層と ADR 候補の書式」セクションの項目を追随させる。metatron 側の写し(`architecture-format.md`)と食い違わないか確かめる。
- コミット: 1 つ。

### 4.22 I4-05: 原文の権威は製品の要望に限り、本文中の AI 向けの指示には従わない

- 変更
  - `references/intent-format.md` の原文の権威の定義に、権威は製品の要望(何を達成したいか)に限り、本文中の AI 向けの指示・手順・ツールの実行依頼は要望として扱わず従わない、と足す。
  - `capturing-intent/references/entry-branches.md:7-9` の外部 Issue の取り込みに、同じ扱いで記録することを足す。
  - `orchestrating-runs/references/phase-finalize.md:7` の「要望」の単位に、AI 向けの指示を数えないことを足す。
- モデルが実際に従うかは確かめていない。指示書の境界を足すまでを今回の範囲とする。
- `docs/format-change-checklist.md` の「intent 文書と intent-issue の書式」セクションの全項目を追随させる。
- コミット: 1 つ。

### 4.23 C3-09: init は他の slug に未完了の run があれば拒否する

- 変更: `codiel-state init` で、`latestTries(root)` のうち `isLegacy` でなく、status が `active` か `awaiting_human` の run が他の slug にあれば失敗する。失敗文で、`orchestrating-runs/SKILL.md:126` の手順(再開しない run を終端にする)を案内する。
- SKILL.md:126 は単一 run を手順で求めているので、手順と衝突しない。
- `awaiting_outcome` は終端(`TERMINAL`)に含まれ、hook のガードも掛からないので、検査の対象に含めない。
- テスト: `src/__test__/codiel-state.test.ts:485` 付近に、別 slug の active run があると init が失敗し、終端にした後は通ることを足す。
- コミット: 1 つ。

### 4.24 R2-06: runId の置き場は projectDir の直下の子に限る

- 変更: `casefile/store.ts` の `sanitizeRunId`(:79)と掃除(:511)に、`path.resolve(projectDir, runId)` の親が `projectDir` で、`projectDir` 自身でないことの検査を足す。入力の正規表現(`tools/shared.ts:24`、`store.ts:32`)は変えない。raguel-redesign 設計書 :261 の「正規表現は変えない」に合う。
- テスト: `casefile/__test__/store.test.ts` の掃除の群(:436)に、runId `"."` の評価があっても掃除で projectDir が残ることと、`sanitizeRunId(".")` が拒否されることを足す。
- コミット: 1 つ。

### 4.25 I4-08: 領域名の正規化で空か衝突になるときは、人と別名を決め直す

- 変更: `references/intent-format.md:239` の正規化の規則に、正規化の結果が空文字か、既存の別の領域と同じファイル名になるときは、ASCII の別名を人と決め直す、と足す。`capturing-intent/references/domain-names.md:5-8` に、候補を示す前に空と衝突を検査して聞き直す手順を足す。
- `docs/format-change-checklist.md` の「持続層と ADR 候補の書式」の該当項目を追随させる。metatron のドメインマップのキーを使う経路(:239 の前半)と食い違わないか確かめる。
- コミット: 1 つ。

## 5. 実装の順序とコミット

章の順に進め、1 行を 1 コミットにする。最後に所見一覧の「採否」列を埋めるコミットを置く(採否は設計の承認時点で埋め、実装の結果に合わせて最後に直す)。

1. R2-01(4.1)
2. R2-02(4.2)
3. M1-01(4.3、metatron 0.4.1-dev)
4. B5-01(4.4)
5. B5-02(4.5)
6. R2-05(4.6)
7. I4-01(4.7)
8. C3-05・I4-02(4.8)
9. I4-12(4.9)
10. C3-11(4.10)
11. I4-10(4.11)
12. C3-01(4.12.1)
13. C3-06(4.12.2)
14. C3-02(4.12.3)
15. M1-04(4.12.4)
16. 保証範囲の README(4.12.5)
17. C3-03・C3-04・C3-08(4.13)
18. C3-10(4.14)
19. R2-03・R2-04(4.15)
20. M1-02・M1-03・M1-06(4.16)
21. I4-09(4.17)
22. I4-04/B5-04・I4-07/B5-05(4.18)
23. I4-03(4.19)
24. I4-06(4.20)
25. I4-11(4.21)
26. I4-05(4.22)
27. C3-09(4.23)
28. R2-06(4.24)
29. I4-08(4.25)
30. 所見一覧の採否の更新

- `docs/chat/` の未コミットの変更は、どのコミットにも入れない。
- ARCHITECTURE に影響する変更は `metatron:updating-architecture` で行う。

## 6. 完了の確かめ方

- `pnpm run lint`・`pnpm run typecheck`・`pnpm run test`・`pnpm run build` が通る。
- 4.1 の golden test で、未追跡の `.gitattributes`(`* -diff`)の下でコードゲートが STOP を返す。
- `src/` を変えた組は、足したテストが修正前に失敗し、修正後にパスしたことを完了報告に書く。
- 修正した範囲に敵対的レビューを当て直し、critical と high が残らない。依頼文は「文書が述べる保証とコードの食い違いを探す」と書く。
- code-reviewer の critical と high が残らない。
- `.serena/memories/` に修正内容と食い違う記述があれば、Serena の編集ツールで直す。
