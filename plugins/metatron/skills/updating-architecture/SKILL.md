---
name: updating-architecture
description: 既にあるアーキテクチャ文書(ARCHITECTURE)と rules(規約・保護パス・テスト方針)を更新するときに必ず使用する。「アーキ文書が古い」「実装に合わせて直して」「更新しといて」「ADR に残して」「前提だった ADR を廃止に」「保護パスがズレてる」「死んだ glob を直して」「書式や規律に合わせて見直して」のような依頼が該当する。依頼ではなく、自ら文書を更新するときにも必ず使用する。文書が 1 枚も無い状態からの初版作成、ドメインマップだけの最小構成を育てる依頼、失敗の新規記録とタグ付けは別のスキルが担当する。
---

# ARCHITECTURE と rules の更新

## 共通規律

- CLI の絶対パスは、セッションに注入された案内、または直接編集の拒否メッセージに現れたものを使う。
- 案内が無いときはユーザーに絶対パスを尋ねる。インストール先を推測して組み立てない。
- 入力の渡し方・出力の読み方・失敗時の扱いは `../../references/cli-usage.md` を読む。
- 長い入力は Write ツールで一時ファイルへ書き、`--input <path>` で渡す。
- 引数へ本文を直接埋め込まず、一時ファイルのパスだけを渡す。
- ARCHITECTURE と rules の更新は CLI だけで行う。Edit / Write で直接書き換えない。

## 起点と手順の省略

更新のきっかけが何であっても、手順 1 から順に進める。

- きっかけには、乖離の検出の依頼、監査の依頼、ADR の追加、1 セクションの修正、実装計画書に書かれた CLI の手順、自分の作業で気づいた変更を含む。
- 監査の依頼(`/metatron:audit` など)では、手順 3 の後に「監査」の手順を行い、その候補も手順 4 に並べる。
- 監査の依頼は「依頼された変更」に当たらない。監査の候補は、ほかの候補と同じく手順 4 で 1 件ずつ選ばせる。
- ユーザーが依頼した変更は、手順 4 の一覧に「依頼された変更」として並べる。承認済みの計画書に書かれた変更も含む。
- 依頼された変更は、依頼の時点で更新が選ばれたものとして扱う。更新するかどうかを手順 4 で選び直させない。
- 依頼された変更と同じ内容の候補が手順 2 と 3 で見つかったときは、依頼された変更として 1 件にまとめる。
- まとめた相手が ADR 候補なら、手順 5 の書き写しと手順 10 の縮約では、ADR 候補から起こしたものとして扱う。
- まとめた相手の ADR 候補の `adoptedAs` が `null` でないときは、ADR が既にあるので新しく作らず、縮約だけを行う。
- 依頼や計画書の承認は、手順 9 の diff の承認に代えない。
- 自分の作業で気づいた変更は、手順 2 と 3 の候補と同じく手順 4 で選ばせる。
- 対象が 1 件だけ・数行だけのときも、手順を省かない。
- 手順を飛ばすのは次の場合だけとする。
  - 「記録の有効・無効」が定める場合
  - 手順 4 で選ばれた対象が無く、手順 5〜10 で扱うものが無い場合
  - 縮約だけを選ばれた ADR 候補が、手順 5〜9 を経ずに手順 10 で縮約される場合
  - 監査だけの依頼で、手順 2 の `diff-architecture`・`scan-adr-candidates` と手順 11 を飛ばす場合(手順 2 の `get architecture` は行う)

## 記録の有効・無効

ADR と GOTCHAS の記録は、環境変数 `AMATSUKA_METATRON_ENABLE_ADR` と `AMATSUKA_METATRON_ENABLE_GOTCHAS` がそれぞれ有効なときだけ行う。

- 手順 1 の `get config` の `features.adr` と `features.gotchas` で確かめる。拒否された CLI を実行してから分岐しない。
- `features.adr` が `false` のときは、`scan-adr-candidates`・`stage-adr`・`shrink-adr-candidate` を飛ばす。
- `features.adr` が `false` で ADR を求められたときは、手順を進めず、`AMATSUKA_METATRON_ENABLE_ADR` の設定を案内して止める。
- `features.gotchas` が `false` のときは、手順 11 を飛ばす。

## 手順

- [ ] 1. 設定の確認(`get config`)
- [ ] 2. 乖離と ADR 候補の検出(`diff-architecture`・`get architecture`・ADR 有効時は `scan-adr-candidates`)
- [ ] 3. rules の確認(`get rules`)
- [ ] 監査(監査の依頼のときだけ。`get gotchas`)
- [ ] 4. 候補の提示と選択
- [ ] 5. 起草(セクションを足すときは `scan`)
- [ ] 6. サブエージェントによる簡潔化
- [ ] 7. 草案の提示
- [ ] 8. stage(`stage-architecture`・`stage-adr`・`stage-rules`・`stage-gotcha`)
- [ ] 9. diff の提示と承認
- [ ] 10. 書き込み(`commit-architecture`・`commit-rules`・`commit-gotchas`・`shrink-adr-candidate`)
- [ ] 11. GOTCHAS 候補の取り込み(`scan-gotcha-candidates`)
- [ ] 12. 報告

## 1. 設定の確認

`get config` を 1 回実行し、`features.adr` と `features.gotchas` を確かめる。

## 2. 乖離と ADR 候補の検出

- `diff-architecture` を実行し、`findings` と `skipped` を取る。
- `features.adr` が `true` のときは `scan-adr-candidates` も実行し、ADR 候補の配列を取る。
- `get architecture` で現行の本文を取る。手順 4 で候補に併記する「現行の記述」にも使う。
- この結果と現行の本文で、依頼された変更と自分で気づいた変更が ARCHITECTURE の他の部分を古くしていないかを確かめる。
- `diff-architecture` が返すのは決定的に検出できる乖離だけである。対象はドメインマップの穴、死んだ glob、書かれたディレクトリの消失、セクションの欠落とする。ADR の状態の陳腐化、技術スタック・コマンド定義の突き合わせ、書かれていないディレクトリは `skipped` で返る。
- 書かれていないディレクトリは乖離として扱わない。置き場を迷うディレクトリが新しくできたときだけ候補に加える。
- ディレクトリの消失を CLI が判定するのは、インラインコードで書いた `/` を含むパスだけである。ツリー(コードフェンスの中)と 1 語(`legacy/` など)で書いたディレクトリは、実在するかを自分で確かめる。
- `## 技術スタック` と `## コマンド定義` は、`diff-architecture` の `sources` に並んだファイルを読んで確かめる。書かれた技術とバージョン、書かれたコマンドが消えたと確かめられたものだけを候補に加える。
- `sources` は読む起点であり、網羅していない。ランタイムのバージョン定義(`.nvmrc` など)・ビルド設定・ツールに組み込みのコマンド(`go test` など)は `sources` の外にある。`sources` に見当たらないだけでは候補にせず、該当しそうなファイルを探して確かめる。
- `sources` にあって節に書かれていない依存とコマンドは、乖離として扱わない。節に載せる粒度は `../../references/architecture-format.md` に従う。
- `skipped` に理由付きで返った項目は、その実行では検出していない。判断が要るときは該当ファイルを読んで自分で確かめ、結果を候補に加える。
- `features.adr` が `false` のときは、`## ADR 一覧` の欠落と ADR の状態の陳腐化を、`skipped` から確かめたものも含めて候補にしない。どちらも ADR が無効な間は書き込めない。
- 散文の内容が実装と食い違うといった意味的な乖離は検出されない。実装 diff を見て気づいた点は、`findings` に無くても候補に加える。
- `findings` が 0 件でも、気づいた意味的な乖離があれば候補に加える。「乖離なし」で終えない。

## 3. rules の確認

- `get rules` を実行し、`exists` が `false` のファイルを候補に加える。
- rules の未作成は `diff-architecture` では検出されない。未作成のファイルは `stage-rules` で作る。

## 監査

書式と執筆規律の現行の規定に、既存の文書が合っているかを確かめる。監査の依頼のときだけ行う。

- `../../references/architecture-format.md`・`../../references/rules-format.md`・`../../references/gotchas-format.md`・`../../references/writing-discipline.md` を読む。
- ARCHITECTURE の各セクション、rules の各ファイル、GOTCHAS の各エントリを規定と照らし、合わない箇所を候補に加える。
- GOTCHAS のエントリは、`features.gotchas` が `true` のときだけ `get gotchas` で取って照らす。`false` のときは対象から外し、外したことを手順 12 で報告する。
- 候補には、当たった規定の文書名と項目を添える。
- 監査の候補は書き方だけを直す。書かれた事実が実装と食い違うときは、監査ではなく乖離の候補として扱う。
- ADR のエントリは書き換えられないため、合わない箇所を手順 12 で報告するだけにする。
- 手順 4 では、監査の候補を種別「監査」としてまとめる。

## 4. 候補の提示と選択

- 依頼された変更、手順 2 と 3 の候補、監査の候補、ADR 候補を 1 つの一覧に並べる。
- 候補は種別ごとにまとめ、1 件を 1 行で示す。
- 各候補に、現行の記述と実装側の事実を併記する。監査の候補には、実装側の事実の代わりに当たった規定を併記する。
- 依頼された変更のほかに候補が無いときも、乖離と rules の候補が 0 件だったことを一覧に書く。
- 依頼された変更を除く候補は、更新するかしないかを 1 件ずつ選ばせる。全件を一括で更新に倒さない。
- 更新しないと選ばれた候補は、その回では扱わない。
- ADR 候補が 0 件なら、ADR 候補の欄を設けない。
- ADR 候補のうち `adoptedAs` が `null` でないものは、ADR を作らず、手順 10 の `shrink-adr-candidate` による縮約だけを提案する(前回の縮約が失敗して残ったエントリである)。
- 却下された ADR 候補は、持続層に全文のまま残す。

## 5. 起草

- 文面は `../../references/writing-discipline.md` の執筆規律に従って書く。
- セクションごとに書く内容は `../../references/architecture-format.md` に合わせる。
- rules の 3 ファイルに書く内容は `../../references/rules-format.md` に合わせる。
- GOTCHAS のエントリの書き換えは `../../references/gotchas-format.md` に合わせる。
- 欠けているセクションを足すときは `scan` を実行し、その事実で埋まる範囲だけを草案にする。埋まらない箇所は推測せずユーザーに聞く。
- rules の草案を `scan` の事実から起こさない。未作成のファイルは `../../docs/RULES.example.md` の記入例を既定の草案にする。
- ADR にするかどうかは `writing-discipline.md` の「何を ADR にするか」の条件で判断する。満たさない変更は、ユーザーが ADR を求めていなければ該当セクションの本文へ書く。
- ユーザーが ADR を求めた変更が条件を満たさないときは、本文へ書く案とその理由を示し、ADR と本文のどちらで残すかを聞く。
- ADR 候補から起こす草案の `#### 背景` には、候補の `sourceIntents`(出典 intent)の各行と「ADR 候補 ID: <候補 ID>」の 1 行を文言を変えずに書き写す。
- `決定者` など ADR の必須項目のうち、依頼・候補・事実で埋まらないものは推測せずユーザーに聞く。必須項目は `../../references/cli-usage.md` の「stage-adr(追加)」にある。
- ADR の状態を変えるときは理由を必須とする。理由が定まらない状態変更は、手順 8 の `stage-adr` に渡さない。

## 6. サブエージェントによる簡潔化

- 手順 5 の草案をすべてサブエージェントに渡し、`writing-discipline.md` の規律を守った上でより簡潔にさせる。
- 次の部分は、簡潔化の対象から外すよう依頼文に書く。
  - コードフェンスの中身(`metatron:domains` のブロックなど)
  - `#### 背景` に書き写した `sourceIntents` の各行と「ADR 候補 ID」の行
  - rules の `# 見出し` の行と管理者表示行
- 返った文面で、事実と決定が変わっていないことと、対象から外した部分が手順 5 の草案と一字一句同じことを確かめてから、手順 7 で使う。

## 7. 草案の提示

- 1 セクション(GOTCHAS は 1 エントリ)につき、草案と確認してほしい点 1〜3 個を 1 メッセージで示す。
- 残す部分と差し替える部分を、提示の時点で分けて示す。

## 8. stage

- ARCHITECTURE のセクションは `stage-architecture`、ADR は `stage-adr`、rules は `stage-rules`、GOTCHAS のエントリの書き換えは `stage-gotcha` へ分けて渡す。
- `stage-gotcha` の 1 回で扱えるのは 1 エントリである。入力の書式は `../../references/cli-usage.md` の「stage-gotcha」にある。
- GOTCHAS の書き換えが複数あるときは、1 エントリごとに手順 8〜10 を終えてから次のエントリを stage する。stage は台帳全体に紐づくので、まとめて stage すると 2 件目以降の commit が `file_changed` で失敗する。
- ADR 一覧の追加と状態変更は `stage-adr` で行う。`stage-architecture` には渡さない。
- ADR のエントリを削除しない。覆した判断は `廃止` の状態で残す。
- `stage-rules` の 1 回で扱えるのは `conventions` / `protected-paths` / `testing-policy` のうち 1 ファイルである。
- `stage-rules` の `body` はファイル全体とする。`# 見出し` の行と、その直後の管理者表示行を含める。
- `stage-rules` の `body` に frontmatter を書かない。
- `stage-architecture` に `テスト方針` / `保護パス` / `規約` の見出しを渡さない。指定すると `unknown_heading` で返る。
- `stage-rules` の diff は `sections` を持たない。`truncated` になったときは本文を短くしてから stage をやり直す。

## 9. diff の提示と承認

- 返った diff を提示し、書き込んでよいかの明示的な承認を得る。
- ADR の追加と状態変更はどちらも承認を要する。状態変更は過去の判断を覆す行為であり、承認を省かない。
- `stage-architecture` / `stage-adr` / `stage-rules` / `stage-gotcha` が exit 0 で返ったことを承認と読み替えない。
- 承認は stage 1 回につき 1 回得る。複数の stage を 1 回の承認でまとめない。
- 提示の前に `diff.truncated` を見る。省略の有無を `diff.unified` の文面から判断しない。
- `diff.truncated` が `false` のときは `diff.unified` を要約せず全文提示する。長いときは分割して提示する。
- `stage-architecture` の diff が `truncated` のときは `diff.unified` を提示に使わず、`diff.sections` の `before` / `after` をセクション単位で全文提示する。
- セクション単位でも一度に提示しきれないときは、`diff.sections` の `heading` を一覧で示し、どのセクションから見るかをユーザーに尋ねる。
- 承認の後に文面を足さない。足すときは手順 8 からやり直して承認を取り直す。

## 10. 書き込み

- 手順 9 で承認を得た staging だけを書き込む。
- ARCHITECTURE と ADR は `commit-architecture --staging-id <id>`、rules は `commit-rules --staging-id <id>`、GOTCHAS は `commit-gotchas --staging-id <id>` で書き込む。
- rules の `stagingId` は `commit-rules` へ渡す。取り違えると `staging_kind_mismatch` で返る。
- staging の期限切れや `file_changed` で commit が失敗したときは、現行を読み直して手順 8 からやり直す。
- ADR 候補から起こした ADR の `commit-architecture` が成功したら、`shrink-adr-candidate --file <path> --candidate-id <候補 ID> --adr <ADR-NNN> --hash <候補の hash>` を呼ぶ。`--adr` には `stage-adr` が返した `assignedId` を渡す。
- 手順 4 で縮約だけを選ばれた候補は、stage と commit を経ずに `shrink-adr-candidate` を呼ぶ。手順 4 で縮約を選ばれたことを、その縮約の承認とする。`--adr` には候補の `adoptedAs` を渡す。
- どちらの縮約でも、`--file`・`--candidate-id`・`--hash` には、手順 2 の `scan-adr-candidates` が返したその候補の `file`・`candidateId`・`hash` を渡す。
- `shrink-adr-candidate` が終了コード 3 で終わったら 1 回だけやり直す。それも失敗したらユーザーに報告する。
- ADR の確定に失敗したときは持続層に触れない。候補は全文のまま持続層に残る。

## 11. GOTCHAS 候補の取り込み

- `scan-gotcha-candidates` を実行する。
- 候補が 1 件以上あれば、`../recording-gotchas/SKILL.md` の「持続層の GOTCHAS 候補の取り込み」に従う。0 件なら何も提示しない。

## 12. 報告

- 更新したセクション名・ADR の番号・rules のファイル名・書き換えた GOTCHAS の ID を列挙する。
- 監査では、書き換えられないため報告だけにした箇所と、対象から外した文書も列挙する。
- 手順 11 で台帳へ移した GOTCHAS 候補も列挙する。
- 「<更新したファイルのパス> を更新した(未コミット)。コミットするか」を 1 行添える。
- run の文脈から呼ばれたときは、この確認を添えない。呼び出し元のコミット規約が働く。
