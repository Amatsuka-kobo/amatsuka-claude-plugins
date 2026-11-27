---
name: capturing-architecture
description: アーキテクチャ文書(ARCHITECTURE)がまだ無いプロジェクトで初版を作るとき、ドメインマップだけの最小構成にセクションを足して通常の構成へ育てるときに必ず使用する。「アーキ文書を作って」「初期化したい」「全体像の文書が無い」「この構成をドキュメントに起こして」のような依頼が該当する。禁止事項・変更時の追随・テスト方針も併せて作る。既にある文書と実装の乖離を直す依頼は別のスキルが担当する。
---

# ARCHITECTURE の初回生成

## 目的

インタビューで内容を聞き出してから書く方式は取らない。解析でたたき台を作り、提示したものを承認させる。

## 共通規律

- CLI の呼び出しは `../../references/cli-usage.md` に従う。
- ARCHITECTURE のセクション構成と書式は `../../references/architecture-format.md` に従う。
- ドラフトの文体は `../../references/writing-discipline.md` に従い草案を書いたのち、サブエージェントに同じ規律を守った上でより簡潔にさせる。
- ARCHITECTURE と CLAUDE.md のどちらに書くかは `../../references/document-boundary.md` に従う。

## CLI の呼び出し

- 実行するコマンド行は `node <CLI の絶対パス> <サブコマンド>` の形にする。
- CLI の絶対パスは、SessionStart の hook が出す案内文か、文書の直接編集が拒否されたときのメッセージに現れる。コンテキストに現れたものをそのまま使う。`get config` の `cli.path` も同じ値を返す。
- 現れていないときはユーザーに絶対パスを尋ねる。インストール先を推測して組み立てない。
- `--input <path>` に渡す JSON は Write ツールで一時ファイルへ書いてから渡す。
- 引数へ本文を直接埋め込まず、一時ファイルのパスだけを渡す。
- ヒアドキュメントで stdin へ流さず、`--input` でパスを渡す。
- ARCHITECTURE の書き込みは CLI 経由だけで行う。Edit / Write で直接書き換えない。
- CLAUDE.md への @メンションの追記は `link-claude-md` だけで行う。Edit / Write で書かない。

## 手順

- [ ] 1. 現状確認
- [ ] 2. 事実の収集(`scan`)
- [ ] 3. ドラフトの起草
- [ ] 4. 対話ウォークスルー
- [ ] 5. stage(`stage-architecture` 1 回)
- [ ] 6. 提示と承認(1 回)
- [ ] 7. 書き込み(`commit-architecture` 1 回)
- [ ] 8. CLAUDE.md への @メンションの追記(承認 1 回・`link-claude-md`)
- [ ] 9. 完了報告

## 1. 現状確認

- `get config` で ARCHITECTURE の解決先パスと存在の有無を確認する。
- `get config` の `warnings` に docRoot と起動ディレクトリのずれが載っているときは、書き込みの前にユーザーへ伝える。
- ARCHITECTURE があれば `get architecture` で既存セクションの見出しと本文を取得する。
- 既存の内容は「既存の内容」としてウォークスルーに載せ、残りの単位を埋める。
- 既存の内容を勝手に上書きしない。書き換えが要ると判断したときは、変更案を提示してその単位単独で承認を得る。
- 対象の 8 単位(下記)がすべて埋まっているときは初回生成ではない。`/metatron:update` を案内して終了する。
- 既存の ARCHITECTURE に旧見出し(`## レイヤー構造`・`## ディレクトリ構成と責務`・`## 保護パス`)のどれかがあるときも初回生成ではない。旧構成の移行として `/metatron:update` を案内して終了する。

## 2. 事実の収集

- `scan` を実行し、返った JSON をドラフトの材料にする。
- `scan` が返すのはファイルシステムから決定的に取れる事実だけである。事実に無いことをドラフトの根拠にしない。
- `warnings` が空でないときは、読めなかった範囲を把握したうえで進む。読めなかった範囲を推測で補わない。
- 既存の README・CLAUDE.md・`docs/` の文書は `documents` の見出し一覧で当たりを付け、必要なものだけ Read する。

## 3. ドラフトの起草

対象は次の 8 単位とする。

| ドラフト単位 | ドラフトの主な材料 |
| --- | --- |
| ARCHITECTURE `## システム概要` | `documents` と `tree` と `dependencies`。散文 1 段落と、必要な場合は Mermaid 図 |
| ARCHITECTURE `## 技術スタック` | `languages` / `dependencies`。言語・ランタイム・フレームワーク・データ層の技術だけを載せる |
| ARCHITECTURE `## ディレクトリ構成` | `tree` / `fileCount` / `domainCandidates` |
| ARCHITECTURE `## ドメインマップ` | `domainCandidates` |
| ARCHITECTURE `## コマンド定義` | `commands` / `scripts`。定義の名前から読めない使い分け・前提・引数の付け方だけを載せる |
| ARCHITECTURE `## テスト方針` | `../../docs/ARCHITECTURE.example.md` の記入例と既存の文書 |
| ARCHITECTURE `## 禁止事項` | `../../docs/ARCHITECTURE.example.md` の記入例と既存の設定ファイル |
| ARCHITECTURE `## 変更時の追随` | `../../docs/ARCHITECTURE.example.md` の記入例と既存の設定ファイル |

- `## 禁止事項`・`## 変更時の追随`・`## テスト方針` を `scan` の事実から起草しない。`../../docs/ARCHITECTURE.example.md` の該当セクションの記入例を型にして既定のドラフトを作り、指摘を受けて直す。
- docRoot に旧 rules の `.claude/rules/metatron/` が残っているときは、その `protected-paths.md` の触らないパスを `## 禁止事項`、変更に慎重を要するパスを `## 変更時の追随`、`testing-policy.md` の本文を `## テスト方針` の材料にする。
- 旧ファイルの移行と削除はこのスキルで行わず、手順 9 で `/metatron:update` を案内する。
- `document-boundary.md` で CLAUDE.md に当たる内容は起草しない。材料の中に見つけたときは、CLAUDE.md へ移す案として手順 9 で示す。CLAUDE.md は書き換えない。
- `## システム概要` に Mermaid 図を置くかどうかを含めてウォークスルーで問う。置く場合は解析結果から起草し、粒度も問う。
- ARCHITECTURE の各セクションの起草は `../../references/architecture-format.md` の該当節の要件を満たす形で行う。
- `../../references/writing-discipline.md` の「削れる内容」の 4 種類は起草しない。
- 情報が足りずドラフトを書けない単位は推測で埋めない。その単位だけ質問形式に切り替える。
- 質問しても材料が得られないときは、その単位を生成対象から外し、未記入であることを完了報告に載せる。

## 4. 対話ウォークスルー

- 1 ドラフト単位につき、ドラフト本文と確認すべき点 1〜3 個を 1 メッセージで提示する。
- 確認点は、誤りに気づける具体的な問いにする。「問題ないか」だけを尋ねない。
- 生成物のファイルを直読させず、提示はメッセージ本文で行う。
- 修正の指示を受けたらその単位を直して再提示し、確定を得てから次の単位へ進む。
- 確定していない単位が残っているときは、その単位のウォークスルーへ戻る。
- ドメインマップは解析候補として提示し、最終決定を必ずユーザーに確認する。
- ドメイン分割が馴染まないプロジェクトには `{ "generic": ["**"] }` への縮退を選択肢として示す。
- 既存の `## ドメインマップ` があるときは、既存の内容として提示し、変更の要否だけを問う。
- ユーザーが「まとめて全部見る」を希望したときは、全単位を一度に提示してよい。手順 5 から 7 は省略しない。

## 5. stage-architecture

- 8 単位すべての確定を得てから stage を始める。
- 確定した ARCHITECTURE の 8 セクションを 1 回の `stage-architecture --input <path>` にまとめて渡す。
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
- `body` は見出し行を含まない本文だけにする。
- `heading` に `規約` を指定しない。指定すると `unknown_heading` で返る。
- `## ドメインマップ` の `body` には `` ```json metatron:domains `` で始まるフェンスブロックをそのまま含める。
- 拒否されたら `error` と `message` を読み、該当の単位を直して stage をやり直す。拒否を握り潰して先へ進まない。

## 6. diff の全文提示と承認

- 承認は ARCHITECTURE の 1 回だけ得る。
- 提示の前に `diff.truncated` を見る。省略の有無を `diff.unified` の文面から判断しない。
- `diff.truncated` が `false` のときは `diff.unified` を**全文**提示する。要約・抜粋・変更行数の報告に置き換えない。
- `stage-architecture` の diff が `truncated` のときは `diff.unified` を提示に使わず、`diff.sections` の `before` / `after` をセクション単位で全文提示してから承認を得る。
- セクション単位でも一度に提示しきれないときは、`diff.sections` の `heading` を一覧で示し、どのセクションから見るかをユーザーに尋ねる。
- `warnings` があれば併せて提示する。
- 提示したうえで、書き込んでよいかの明示的な承認を得る。
- `stage-architecture` が exit 0 で返ったことを承認と読み替えない。
- 否認されたら該当単位のウォークスルーへ戻る。`stagingId` は使い回さない。stage からやり直す。

## 7. commit-architecture

- 承認を得た後に、その stage の出力の `next` に載っているコマンド行を実行する。
- `expired` で失敗したときは有効期限切れである。手順 5 からやり直す。
- `file_changed` で失敗したときは stage 後に対象ファイルが変化している。現行内容を読み直し、手順 5 からやり直す。
- `lock_timeout` で失敗したときは、同じ文書へ書く別プロセスの完了を待って再実行する。ロックファイルを手で消さない。

## 8. CLAUDE.md への @メンションの追記

ARCHITECTURE がまだ無いとき(手順 6 で否認されたとき)は、この手順を飛ばす。`link-claude-md` が `architecture_missing` で拒否する。

- 追記する行は、`get config` の `architecture.relative` から `@<相対パス>` の形で組み立てる。
- 追記先は docRoot の `CLAUDE.md` とする。それが無く `.claude/CLAUDE.md` だけがあるときは `.claude/CLAUDE.md` とし、各行のパスに `../` を付ける。どちらも無ければ `CLAUDE.md` が新しく作られる。
- どちらかの CLAUDE.md のコードの外に同じ @メンションが既にあるときは、その行を追記する行から外す。全部が既にあり、`metatron.config.json` もあるときは、承認を求めずに手順 9 へ進む。
- `metatron.config.json` が無いときは、`link-claude-md` が `{ "version": 1 }` の設定ファイルも作る。承認を求めるときに、作られる設定ファイルのパスも併せて示す。
- 追記先のパスと追記する行を示し、追記してよいかの明示的な承認を得る。
- 承認を得てから `link-claude-md` を実行する。入力もオプションも取らない。
- 返った `added` と `present` を手順 9 の報告に使う。
- 否認されたときは追記しない。文書が読み込まれないことと、後から `/metatron:update` で追記できることを手順 9 で伝える。

## 9. 完了報告

- CLAUDE.md へ移す案があれば、その文面を示す。CLAUDE.md への追記は、ユーザーに頼まれたときだけ、追記する位置を示して承認を得てから Edit で行う。
- 書き込んだファイルのパスと、確定した単位の一覧を報告する。
- 未記入のまま残した単位があれば一覧で報告する。
- CLAUDE.md に追記した行、既にあった行、追記しなかったときはその理由を報告する。
- 旧 rules の `.claude/rules/metatron/` が残っているときは、`/metatron:update` で移行することを案内する。
- 「更新した(未コミット)。コミットするか」の確認を 1 行添える。
- 呼び出し元のフローがコミットまでを担っているとき(ハーネスの run の一部として起動されたとき)は、この確認を添えない。
