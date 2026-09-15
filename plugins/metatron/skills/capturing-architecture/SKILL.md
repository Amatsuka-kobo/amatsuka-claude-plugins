---
name: capturing-architecture
description: プロジェクトのアーキテクチャ文書(ARCHITECTURE)を初めて作るとき、またはドメインマップだけの最小 ARCHITECTURE に技術スタック・レイヤー構造・コマンド定義などのセクションを足すときに必ず使用する。「アーキテクチャ文書を作って」「ARCHITECTURE.md を初期化して」「この構成をドキュメントに起こして」のような依頼と、初期化コマンド(`/metatron:init`)からの起動が該当する。生成物には ARCHITECTURE、rules 3 ファイル、GOTCHAS の空の台帳が含まれる。コードベースを解析してセクションごとのドラフトを起草し、セクション単位の対話で確認・確定してから書き込む。既存 ARCHITECTURE と実装の乖離を検出して直す依頼は updating-architecture、AI の失敗を台帳に残す依頼は recording-gotchas が担当する。設計書・README・API 仕様など ARCHITECTURE 以外の文書を書く依頼には使わない。
---

# ARCHITECTURE と rules と GOTCHAS の初回生成

## 目的

コードベースの解析結果からドラフト単位ごとの草案を起草し、対話ウォークスルーで 1 単位ずつ確定してから ARCHITECTURE と rules へ書き込む。

インタビューで内容を聞き出してから書く方式は取らない。解析でたたき台を作り、提示したものを承認させる。

## 共通規律

- CLI の呼び出しは `../../references/cli-usage.md` に従う。
- ARCHITECTURE のセクション構成と書式は `../../references/architecture-format.md` に従う。
- rules の 3 ファイルの内容と書式は `../../references/rules-format.md` に従う。
- ドラフトの文体は `../../references/writing-discipline.md` に従う。起草の段階から根拠・経緯を書かない。

## CLI の呼び出し

- 実行するコマンド行は `node <CLI の絶対パス> <サブコマンド>` の形にする。
- CLI の絶対パスは、セッション開始時に注入された案内か、文書の直接編集が拒否されたときのメッセージに現れる。コンテキストに現れたものをそのまま使う。
- 現れていないときは `../../references/cli-usage.md` の手順で求める。パスを推測して書かない。
- `--input <path>` に渡す JSON は Write ツールで一時ファイルへ書いてから渡す。引数へ直接埋め込まない。ヒアドキュメントで渡さない。
- ARCHITECTURE と rules を Edit / Write で直接書き換えない。書き込みは CLI 経由だけで行う。

## 手順

- [ ] 1. 現状確認
- [ ] 2. 事実の収集(`scan`)
- [ ] 3. ドラフトの起草
- [ ] 4. 対話ウォークスルー
- [ ] 5. stage(`stage-architecture` 1 回・`stage-rules` 3 回)
- [ ] 6. 提示と承認(合計 5 回。ARCHITECTURE 1・rules 3・GOTCHAS 1)
- [ ] 7. 書き込み(`commit-architecture` 1 回・`commit-rules` 3 回・`init-gotchas` 1 回)
- [ ] 8. 完了報告

## 1. 現状確認

- `get config` で ARCHITECTURE の解決先パスと存在の有無、`rules.dir` と 3 ファイルそれぞれの `exists`、GOTCHAS の解決先パスと `exists` を確認する。
- `get config` の `warnings` に docRoot と起動ディレクトリのずれが載っているときは、rules を書く前にユーザーへ伝える。
- ARCHITECTURE があれば `get architecture` で既存セクションの見出しと本文を取得する。
- rules があれば `get rules` で既存の本文を取得する。
- 既存の内容は「既存の内容」としてウォークスルーに載せ、残りの単位を埋める。
- 既存の内容を勝手に上書きしない。書き換えが要ると判断したときは、変更案を提示してその単位単独で承認を得る。
- 対象の 9 単位(下記)がすべて埋まっており、かつ GOTCHAS の台帳に内容があるときは初回生成ではない。`/metatron:update` を案内して終了する。
- 9 単位が埋まっていて GOTCHAS の台帳だけが無い(または空である)ときは、手順 2 から 5 を飛ばし、手順 6 と 7 の GOTCHAS の分だけを行う。

## 2. 事実の収集

- `scan` を実行し、返った JSON をドラフトの材料にする。
- `scan` が返すのはファイルシステムから決定的に取れる事実だけである。事実に無いことをドラフトの根拠にしない。
- `warnings` が空でないときは、読めなかった範囲を把握したうえで進む。読めなかった範囲を推測で補わない。
- 既存の README・CLAUDE.md・`docs/` の文書は `documents` の見出し一覧で当たりを付け、必要なものだけ Read する。

## 3. ドラフトの起草

対象は次の 9 単位とする。

| ドラフト単位 | ドラフトの主な材料 |
| --- | --- |
| ARCHITECTURE `## システム概要` | `documents` と `tree` と `dependencies`。散文 1 段落と、必要な場合は Mermaid 図 |
| ARCHITECTURE `## 技術スタック` | `languages` / `packageManager` / `dependencies` |
| ARCHITECTURE `## レイヤー構造` | `tree` / `domainCandidates` |
| ARCHITECTURE `## ディレクトリ構成と責務` | `tree` / `fileCount` |
| ARCHITECTURE `## ドメインマップ` | `domainCandidates` |
| ARCHITECTURE `## コマンド定義` | `commands` / `scripts` |
| rules `conventions.md` | `../../docs/RULES.example.md` の記入例と既存の CLAUDE.md |
| rules `protected-paths.md` | `../../docs/RULES.example.md` の記入例と既存の設定ファイル |
| rules `testing-policy.md` | `../../docs/RULES.example.md` の記入例と既存の文書 |

- GOTCHAS の台帳はこの 9 単位に含めない。起草するものが無いため、手順 6 で承認対象として扱う。
- rules の 3 単位を `scan` の事実から起草しない。`../../docs/RULES.example.md` の記入例を既定のドラフトとして提示し、指摘を受けて直す。
- rules の各ファイルは `# 見出し` から始まる完全な本文として起草し、見出しの直後に管理者表示行を置く。文言は `../../references/rules-format.md` にある。
- `## ADR 一覧` は初回生成で扱わない。ドラフトも空の節も作らない。最初の ADR を追加するときに `stage-adr` が節ごと作る。
- `## システム概要` に Mermaid 図を置くかどうかを含めてウォークスルーで問う。置く場合は解析結果から起草し、粒度も問う。
- ARCHITECTURE の各セクションの起草は `../../references/architecture-format.md` の該当節の要件を満たす形で行う。
- 情報が足りずドラフトを書けない単位は推測で埋めない。その単位だけ質問形式に切り替える。
- 質問しても材料が得られないときは、その単位を生成対象から外し、未記入であることを完了報告に載せる。

## 4. 対話ウォークスルー

- 1 ドラフト単位につき、ドラフト本文と確認すべき点 1〜3 個を 1 メッセージで提示する。
- 確認点は、誤りに気づける具体的な問いにする。「問題ないか」だけを尋ねない。
- 生成物のファイルを直読させない。「ARCHITECTURE.md を読んで確認してほしい」と依頼しない。提示はメッセージ本文で行う。
- 修正の指示を受けたらその単位を直して再提示し、確定を得てから次の単位へ進む。
- 確定していない単位を残したまま手順 5 へ進まない。
- ドメインマップは解析候補として提示し、最終決定を必ずユーザーに確認する。候補をそのまま確定扱いにしない。
- ドメイン分割が馴染まないプロジェクトには `{ "generic": ["**"] }` への縮退を選択肢として示す。
- 既存の `## ドメインマップ` があるときは、既存の内容として提示し、変更の要否だけを問う。
- ユーザーが「まとめて全部見る」を希望したときは、全単位を一度に提示してよい。手順 5 から 7 は省略しない。

## 5. stage-architecture と stage-rules

- 9 単位すべての確定を得てから stage を始める。
- stage を要する対象は 4 つ(ARCHITECTURE 1・rules 3)である。GOTCHAS は stage を持たない。
- stage を要する対象 1 つにつき、stage → 手順 6 の承認 → 手順 7 の commit を回す。4 対象分の stage をまとめて先に発行しない。
- 確定した ARCHITECTURE の 6 セクションを 1 回の `stage-architecture --input <path>` にまとめて渡す。
- rules は 1 ファイルにつき 1 回、合計 3 回の `stage-rules --input <path>` を発行する。1 回の staging に 2 ファイル以上は渡せない。
- `stage-architecture` の入力の形は次のとおり。

```json
{
  "sections": [
    { "heading": "技術スタック", "body": "<本文>" }
  ],
  "reason": "初回生成"
}
```

- `heading` は書式のキーをそのまま書く。`##` を付けない。
- `body` に `## 見出し` の行を含めない。見出し行は CLI が付ける。
- `heading` に `ADR 一覧` を指定しない。指定すると拒否される。
- `heading` に `テスト方針` / `保護パス` / `規約` を指定しない。この 3 節は rules へ移っており、指定すると `unknown_heading` で拒否される。
- `## ドメインマップ` の `body` には `` ```json metatron:domains `` で始まるフェンスブロックをそのまま含める。
- `stage-rules` の入力の形は次のとおり。

```json
{
  "name": "conventions",
  "body": "<# 見出しから始まるファイル全体>",
  "reason": "初回生成"
}
```

- `name` は `conventions` / `protected-paths` / `testing-policy` のいずれかにする。
- `body` はファイル全体とする。`# 見出し` の行と、その直後の管理者表示行を含める。
- `body` に frontmatter を書かない。書くと拒否される。
- 拒否されたら `error` と `message` を読み、該当の単位を直して stage をやり直す。拒否を握り潰して先へ進まない。

## 6. diff の全文提示と承認

- 承認は対象ごとに得る。ARCHITECTURE 1 回と rules 3 回と GOTCHAS 1 回で合計 5 回になる。
- 提示の前に `diff.truncated` を見る。省略の有無を `diff.unified` の文面から判断しない。
- `diff.truncated` が `false` のときは `diff.unified` を**全文**提示する。要約・抜粋・変更行数の報告に置き換えない。
- `stage-architecture` の diff が `truncated` のときは `diff.unified` を提示に使わない。`diff.sections` の `before` / `after` をセクション単位で全文提示する。
- セクション単位でも一度に提示しきれないときは、`diff.sections` の `heading` を一覧で示し、どのセクションから見るかをユーザーに尋ねる。
- `stage-rules` の diff は `sections` を持たない。`truncated` になったときは本文を短くしてから手順 5 をやり直す。
- `warnings` があれば併せて提示する。
- 提示したうえで、書き込んでよいかの明示的な承認を得る。
- `stage-architecture` / `stage-rules` が exit 0 で返ったことを承認と読み替えない。
- 否認されたら該当単位のウォークスルーへ戻る。`stagingId` は使い回さない。stage からやり直す。

### GOTCHAS の台帳

- `get gotchas-template` を実行する。分岐は `hasContent` で行う。`exists` では分岐しない(空のファイルがあるときに判断を誤る)。
- `hasContent` が `true` のときは、提示も承認も行わない。既存の台帳がある旨を手順 8 で報告し、手順 7 の `init-gotchas` を実行しない。
- `hasContent` が `false` のときは、返った `path` と `relative` と `template` を提示する。
- 提示するのは次の 3 つとする。
  1. 台帳を作る絶対パスと、docRoot からの相対パス。
  2. `template` の**全文**。要約・抜粋に置き換えない。
  3. 作成後は、この台帳への直接編集が PreToolUse hook に拒否されるようになること、および毎セッションの注入対象に入ることの 2 点。
- 求める承認は「この台帳をこのパスに作ってよいか」の可否 1 点とする。本文の良し悪しを問わない。
- **本文はこの場では書き換えられないことを併せて伝える。** 雛形は書式の契約で固定されており、`init-gotchas` は本文を入力に取らない。
- 本文の変更を求められたときは、台帳の作成を保留する。書式の契約の変更として扱い、このセッションでは作らない。保留したことを手順 8 で報告する。
- パスが意図と違うと指摘されたときは作成しない。`metatron.config.json` の `paths.gotchas` を直すのはユーザーの作業であり、このスキルは行わない。

## 7. commit-architecture と commit-rules

- 承認を得た後に、その stage の出力の `next` に載っているコマンド行を実行する。
- ARCHITECTURE の `stagingId` は `commit-architecture` へ、rules の `stagingId` は `commit-rules` へ渡す。取り違えると `staging_kind_mismatch` で拒否される。
- `expired` で失敗したときは有効期限切れである。その対象について手順 5 からやり直す。
- `file_changed` で失敗したときは stage 後に対象ファイルが変化している。現行内容を読み直し、手順 5 からやり直す。
- GOTCHAS の承認を得た後に `init-gotchas` を実行する。`--staging-id` も `--input` も取らない。
- `already_exists` で拒否されたときは、承認を得てから実行するまでの間に台帳が作られている。**再実行しない。** 既存の台帳があることを手順 8 で報告する。
- `lock_timeout` で拒否されたときは、同じ文書へ書く別プロセスの完了を待って再実行する。ロックファイルを手で消さない。

## 8. 完了報告

- 書き込んだファイルのパスと、確定した単位の一覧を報告する。ARCHITECTURE のセクションと rules の 3 ファイルを分けて示す。
- 未記入のまま残した単位があれば一覧で報告する。
- GOTCHAS の台帳を作ったときは、そのパスを報告する。台帳は空であり、失敗を記録するときに `append-gotcha` でエントリが入る。
- 既に台帳があって作らなかったとき、承認が得られず作らなかったときは、その事実と理由を報告する。
- 「更新した(未コミット)。コミットするか」の確認を 1 行添える。
- 呼び出し元のフローがコミットまでを担っているとき(ハーネスの run の一部として起動されたとき)は、この確認を添えない。

<HARD-GATE>
- **承認なしに `commit-architecture` / `commit-rules` / `init-gotchas` を実行しない。** stage が成功したこと・CLI が拒否しなかったことは承認ではない。承認はユーザーの明示的な返答だけである。
- **書き込む内容を全文提示せずに承認を求めない。** stage を経る 4 対象は `diff` の全文を、GOTCHAS は `get gotchas-template` の `template` の全文を提示する。
- **5 対象を 1 回の承認でまとめない。** 承認は ARCHITECTURE 1 回と rules 3 回と GOTCHAS 1 回に分ける。
- **stage を経る 4 対象で `diff.truncated` が `true` のまま承認を求めない。** ARCHITECTURE は `diff.sections` の `before` / `after` から全文を提示してから承認を得る。
- **生成物のファイルを直読させて承認に代えない。** 確認は単位ごとの問いで行う。
- **既存の内容を勝手に上書きしない。**
- **`already_exists` を握り潰して既存の台帳を消さない。** 拒否されたら再実行せず報告する。
- **GOTCHAS の雛形を Write / Edit で書かない。** 生成は `init-gotchas` だけで行う。
- **材料が無い単位を推測で埋めない。**
- **`## ADR 一覧` を初回生成で書き込まない。**
</HARD-GATE>
