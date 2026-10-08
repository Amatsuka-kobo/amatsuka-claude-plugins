---
name: updating-architecture
description: 既にあるアーキテクチャ文書(ARCHITECTURE)と rules(規約・保護パス・テスト方針)を実装に合わせて更新するときに必ず使用する。「アーキ文書が古い」「実装に合わせて直して」「更新しといて」「ADR に残して」「前提だった ADR を廃止に」「保護パスがズレてる」「死んだ glob を直して」のような依頼が該当する。文書が 1 枚も無い状態からの初版作成、ドメインマップだけの最小構成を育てる依頼、失敗の記録は別のスキルが担当する。
---

# ARCHITECTURE と rules の更新

## 前提

- CLI の絶対パスは、セッションに注入された案内、または直接編集の拒否メッセージに現れたものを使う。
- 案内が無いときはユーザーに絶対パスを尋ねる。インストール先を推測して組み立てない。
- 入力の渡し方・出力の読み方・失敗時の扱いは `../../references/cli-usage.md` を読む。
- 長い入力は Write ツールで一時ファイルへ書き、`--input <path>` で渡す。
- 引数へ本文を直接埋め込まず、一時ファイルのパスだけを渡す。
- ARCHITECTURE と rules の更新は CLI だけで行う。Edit / Write で直接書き換えない。

## 記録の有効・無効

ADR と GOTCHAS の記録は、環境変数 `AMATSUKA_METATRON_ENABLE_ADR` と `AMATSUKA_METATRON_ENABLE_GOTCHAS` がそれぞれ有効なときだけ行う。

- 手順の先頭で `get config` を 1 回呼び、`features.adr` と `features.gotchas` を確かめる。拒否された CLI を実行してから分岐しない。
- `features.adr` が `false` のときは、「## ADR」と「## ADR 候補の取り込み」を飛ばす。ADR を求められたときは、手順を進めず、`AMATSUKA_METATRON_ENABLE_ADR` の設定を案内して止める。
- `features.gotchas` が `false` のときは、手順 8 と「## GOTCHAS 候補の取り込み」を飛ばす。

## 手順

1. `diff-architecture` を実行し、`findings` と `skipped` を取る。`features.adr` が `true` のときは `scan-adr-candidates` も実行し、ADR 候補の配列を取る。
2. `get rules` を実行し、`exists` が `false` のファイルを候補に加える。
3. 候補を一覧提示し、1 件ごとに更新するかしないかを選ばせる。
4. 選ばれた分の本文を起草し、確認してほしい点を添えて提示する。
5. ARCHITECTURE のセクションは `stage-architecture`、ADR は `stage-adr`(`features.adr` が `true` のときだけ)、rules は `stage-rules` へ分けて渡す。
6. 返った diff を全文提示して承認を得る。
7. ARCHITECTURE と ADR は `commit-architecture --staging-id <id>`、rules は `commit-rules --staging-id <id>` で書き込む。
8. 下の「GOTCHAS 候補の取り込み」に従う(`features.gotchas` が `false` なら飛ばす)。
9. 更新したセクション・ADR・rules と、移した GOTCHAS 候補を報告する。

## 検出の範囲

- `diff-architecture` が返すのは決定的に検出できる乖離だけである。対象は技術スタックの追加・削除、コマンドの変更、ドメインマップの穴、死んだ glob、ディレクトリ構成の変化、セクションの欠落、ADR の状態の陳腐化とする。`features.adr` が `false` のときは、`## ADR 一覧` の欠落を扱わない。
- rules の未作成は `diff-architecture` では検出されない。`get rules` の `exists` が `false` のファイルを候補一覧に並べ、`stage-rules` での作成を案内する。
- `skipped` に理由付きで返った項目は、その実行では検出していない。判断が要るときは該当ファイルを読んで自分で確かめ、結果を候補として同じ一覧に並べる。
- 散文の内容が実装と食い違うといった意味的な乖離は検出されない。実装 diff を見て気づいた点は、候補一覧に無くても `stage-architecture` に直接載せて更新する。
- `findings` が 0 件でも、気づいた意味的な乖離があれば候補として提示する。「乖離なし」で終えない。

## 候補の提示

- 候補は種別ごとにまとめ、1 件を 1 行で示す。
- 各候補に、現行の記述と実装側の事実を併記する。
- 更新するかしないかは 1 件ずつ選ばせる。全件を一括で更新に倒さない。
- 更新しないと選ばれた候補は、その回では扱わない。次の候補へ進む。

## 起草

- 更新する文面は `../../references/writing-discipline.md` の執筆規律に従い草案を書いたのち、サブエージェントに同じ規律を守った上でより簡潔にさせる。
- セクションごとに書く内容は `../../references/architecture-format.md` に合わせる。
- rules の 3 ファイルに書く内容は `../../references/rules-format.md` に合わせる。
- 欠けているセクションを足すときは、`scan` の事実で埋まる範囲だけを草案にする。埋まらない箇所は推測せずユーザーに聞く。
- rules の草案を `scan` の事実から起こさない。未作成のファイルは `../../docs/RULES.example.md` の記入例を既定の草案として提示する。
- 1 セクションにつき、草案と確認してほしい点 1〜3 個を 1 メッセージで示す。
- 残す部分と差し替える部分を、提示の時点で分けて示す。

## ADR

- ADR 一覧の変更は `stage-adr` を使う。`stage-architecture` には渡さない。
- 追加と状態変更はどちらも承認を要する。状態変更は過去の判断を覆す行為であり、承認を省かない。
- 状態を変えるときは理由を必須とする。理由が定まらないまま `stage-adr` を呼ばない。
- エントリを削除しない。覆した判断は `廃止` の状態で残す。
- ADR にするかどうかは `../../references/writing-discipline.md` の 3 条件で判断する。満たさないものは該当セクションの本文へ書く。

## ADR 候補の取り込み

- `scan-adr-candidates` が返した候補を、乖離の候補と並べて一覧提示する。候補が 0 件なら提示しない。
- 見つかった候補のうち `adoptedAs` が `null` でないものは、ADR を作らず `shrink-adr-candidate` で縮約だけを提案する(前回の縮約が失敗して残ったエントリである)。
- 承認された候補は、`## ADR` の規律(`stage-adr` → 承認 → `commit-architecture`)で ADR の草案にする。草案の `#### 背景` には、候補の `sourceIntents`(出典 intent)の各行と「ADR 候補 ID: <候補 ID>」の 1 行を文言を変えずに書き写す。候補には無い `決定者` はユーザーに聞く。
- ADR の確定に失敗したときは持続層に触れない。候補は全文のまま持続層に残る。
- `commit-architecture` が成功したら `shrink-adr-candidate --file <path> --candidate-id <候補 ID> --adr <ADR-NNN> --hash <候補の hash>` を呼ぶ。終了コード 3 で終わったら 1 回だけやり直し、それも失敗したらユーザーに報告する。
- 却下された候補と、ADR の作成に失敗した候補は持続層に全文のまま残す。

## GOTCHAS 候補の取り込み

- ADR 候補の取り込みの後に `scan-gotcha-candidates` を実行する。
- 候補が 1 件以上あれば、`../recording-gotchas/SKILL.md` の「持続層の GOTCHAS 候補の取り込み」に従う。0 件なら何も提示しない。

## rules

- rules の変更は `stage-rules` を使う。1 回の staging で扱えるのは `conventions` / `protected-paths` / `testing-policy` のうち 1 ファイルである。
- `body` はファイル全体とする。`# 見出し` の行と、その直後の管理者表示行を含める。
- `body` に frontmatter を書かない。
- rules の `stagingId` は `commit-rules` へ渡す。取り違えると `staging_kind_mismatch` で返る。
- `stage-architecture` に `テスト方針` / `保護パス` / `規約` の見出しを渡さない。指定すると `unknown_heading` で返る。
- `stage-rules` の diff は `sections` を持たない。`truncated` になったときは本文を短くしてから stage をやり直す。

## 承認

- 提示したうえで、書き込んでよいかの明示的な承認を得てから `commit-architecture` / `commit-rules` を実行する。
- `stage-architecture` / `stage-adr` / `stage-rules` が exit 0 で返ったことを承認と読み替えない。
- 承認は stage 1 回につき 1 回得る。複数の stage を 1 回の承認でまとめない。
- 提示の前に `diff.truncated` を見る。省略の有無を `diff.unified` の文面から判断しない。
- `diff.truncated` が `false` のときは `diff.unified` を要約せず全文提示する。長いときは分割して提示する。
- `stage-architecture` の diff が `truncated` のときは `diff.unified` を提示に使わず、`diff.sections` の `before` / `after` をセクション単位で全文提示してから承認を得る。
- セクション単位でも一度に提示しきれないときは、`diff.sections` の `heading` を一覧で示し、どのセクションから見るかをユーザーに尋ねる。
- 承認の後に文面を足さない。足すときは stage からやり直して承認を取り直す。
- staging の期限切れや `file_changed` で commit が失敗したときは、現行を読み直して stage からやり直す。

## 報告

- 更新したセクション名・ADR の番号・rules のファイル名を列挙する。
- 「<更新したファイルのパス> を更新した(未コミット)。コミットするか」を 1 行添える。
- run の文脈から呼ばれたときは、この確認を添えない。呼び出し元のコミット規約が働く。
