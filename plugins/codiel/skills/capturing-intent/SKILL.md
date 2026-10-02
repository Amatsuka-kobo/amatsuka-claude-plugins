---
name: capturing-intent
description: Codiel の intent フェーズで、オーケストレーター本体が Issue 番号・intent 文書のパス・省略のいずれかを起点に ASIS と TOBE を聞き取り、承認後に intent 文書を確定して run を作成するときに使う。orchestrating-runs が名指しで起動する。
---

# intent フェーズの聞き取りと確定

## 目的

TOBE を聞き取り、intent に関係する範囲の現状と突き合わせ、分岐を合意したうえで intent 文書に固定する。承認後は run を作成し、intent フェーズの完了までを担当する。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は `<plugin-root>/skills/capturing-intent` である。`<plugin-root>` はそのベースディレクトリの 2 階層上である。環境検出と `codiel-state` の呼び出しは対象プロジェクトのルートで実行する(`<plugin-root>` は絶対パスに展開して実行する)。

```
node <plugin-root>/scripts/check-intent-env.mjs
node <plugin-root>/scripts/codiel-state.mjs <command> [引数...] --slug <slug>
```

## 共通規律

- 経路の選択と承認、畳む経路の判断は `../../references/intent-common.md` に従う。
- intent 文書と intent-issue の書式は `../../references/intent-format.md` に従う。
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

## 0. active run の確認

聞き取り・書き込み・起票のどれよりも前に、`node <plugin-root>/scripts/codiel-state.mjs get --active` でほかの run が active でないことを確かめる。`active` または `awaiting_human` の run が見つかったら、`references/active-run-check.md` を Read して従う。

## 1. 前提確認とベースブランチの最新化

1. `orchestrating-runs` の前提確認(Raguel MCP の利用可否、ハーネスの初期化の確認)に従う。
2. 連携モード・`imageUpload`・`adrTarget` の判定は `orchestrating-runs` の §0 が正本である。§0 を経て起動されたときは、そこで得た `check-intent-env` の出力と判定結果をそのまま使い、ここで判定し直さない。§0 を経ずに起動されたときだけ、`orchestrating-runs/SKILL.md` の §0 の手順をこの場で行う。
3. ベースブランチの名前を解決し、`git switch <ベース> && git pull --ff-only` で最新化する。`pull --ff-only` が失敗したら、その旨を人に確認してから続ける。以降、このブランチを「開始時のブランチ」と呼ぶ。intent フェーズの間は、開始時のブランチの作業ツリーで intent 文書を書く。
4. 入口が intent パスのときは、手順 2 の前に `references/carry-over-intent.md` を Read して従う。前の try の run ブランチからの intent の持ち込みと、前の try が STOP で止まっていたときの確認を扱う。

`configWarnings` が空でないときは、その項目のパス設定が拒否されて既定値に落ちているか、ARCHITECTURE の構造に指摘がある。読めた文書だけで進み、警告の内容を完了報告に残す。

## 2. 入口の分岐

起動時の引数で次のいずれかに分岐する。

- Issue 番号・intent パス・intent パスで frontmatter が `intent: v1`: `references/entry-branches.md` を Read して従う。
- 省略: 「何を達成したいか」から聞く。

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

- 不足している観点だけを 1 問ずつ聞く。起動時の引数と会話に既に現れている観点は聞き直さない。
- 選択式で聞ける場面は AskUserQuestion を使う。自由記述でしか答えられない問いだけを文章で聞く。
- 聞いても埋まらなかった観点は推測で埋めず、`## 未確定事項` に残す。

### 3-2. 原文の記録

原文のセクションの記録の規則(要約しない・日付と話者と出所の行を置く・ユーザーが現状を語っていないときの 1 問を含む)は `intent-format.md` の「本文のセクション」に従う。run の途中でユーザーが言葉を足したら、どのフェーズでも即座に、日付・話者・出所の行つきで末尾に追記する。ユーザー自身の言葉なので承認は要らない。

### 3-3. 現状調査

ASIS はユーザーに聞かず自分で読む。`## 現状調査` は AI がコードと文書を読んで書く。ユーザーに聞くのは、読んでも分からないこと(何を達成したいか、どうなったら完了か)だけである。読んで確かめられなかったことは書かない。

優先順は ARCHITECTURE → `CLAUDE.md` → GOTCHAS → `README.md` とする。

- パスは手順 1 の解決結果を使う。固定パスで開かない。
- セッション開始時にコンテキストへ注入済みの ARCHITECTURE や GOTCHAS 要約は、読み直さない。注入が縮退していて、全文が判断に必要なときは `contextDocs` のパスを Read する。
- 探索を委譲するときは、解決済みの絶対パスを渡して委譲先に読ませる。注入はサブエージェントに継承されない。
- 探索範囲は TOBE に登場する語から辿れる範囲に限定する。
- Serena が利用可能なら優先して使う(`get_symbols_overview` / `find_symbol` / `find_referencing_symbols`)。利用できなければ Grep / Glob / Read で代替する。
- `projectDocs.domainsReadable` が `true` で、TOBE が特定のドメインに閉じると判断できるときは、そのドメインの glob に絞ってよい。
- 「受け入れ基準を書ける」かつ「実装方針の選択肢を 2 つ挙げられる」状態になったら止める。それ以上は設計フェーズの仕事である。
- 対象が見つからないときは推測で書かず、「該当する既存実装は見つからなかった(新規追加とみなす)」と `## 現状調査` に明記する。

### 3-3-1. 領域名の決定

持続層を読む前に、`references/domain-names.md` を Read して、この intent が属する領域名を決める。

### 3-3-2. 持続層の読み取り

- 3-3-1 で決めた領域の持続層 `docs/intents/domains/<領域>.md` を読む。`domains` が空なら読まない。ファイルが無い領域は制約なしとして進む。
- 読めた持続層の `## 意図的な制約` はユーザーに示し、`## 意図的な制約` の初稿にする。`## 意図的な制約` は「制約 | 理由」の表(ヘッダ行 `| 制約 | 理由 |`)で書く。

### 3-4. 分岐の提示と合意

実装方針が割れる論点は、選択肢を 2 つ以上と各々の帰結を示して合意を取る。自分で決めて先へ進まない。選択肢を選ばず保留されたときは、1 回尋ね直し、決まらなければ `## 未確定事項` へ残す。合意した論点は `## 合意済み事項` へ「論点 | 決定 | 理由」の表(ヘッダ行 `| 論点 | 決定 | 理由 |`)の 1 行として残す。決着しなかった論点は `## 未確定事項` へ残す。

`## 受け入れ基準` は `## 要求` から派生させ、機械的に YES/NO を判定できる文にする。「使いやすくなる」のような人が雰囲気で判定する文は書かない。

## 4. ドラフトの提示と承認ゲート

- ドラフトを書く前に、intent 文書の言語と issue 本文の言語を 1 回で確認する。リポジトリの既存文書から推定した言語を推奨として添える。この確認は派生文のセクションだけに当て、原文のセクションは対象外とし、原語のまま残す。
- 書式は `intent-format.md` に従う。見出しの名称と順序を変えない。slug とファイル名の規則、日付の決め方も同じ文書の「保存先と命名」に従う。
- 提示はメッセージ本文で行い、ドラフトの全文を示す。要約・抜粋・差分には置き換えない。先にファイルへ書いて「読んで確認してほしい」と依頼しない。保存と `docs/intents/` の作成は承認後に行う。
- `## 実装方針` も承認対象に含める。設計書ではなく、どの層をどう変えるかの方針として書く。
- 承認はユーザーの明示的な返答だけとする。ドラフトへの相槌や部分的な感想は、承認に当たらない。

全文を提示したうえで、次の 3 項目を含む承認を同時に得る。差し戻されたら手順 3 へ戻り、指摘された観点を聞き直してからドラフトを作り直し、全文を再提示する。

| 項目 | 選択肢 | 決めた後の動き |
| --- | --- | --- |
| 規模 | 標準 / 軽量 | `codiel-state init --scale` に渡す |
| 文書だけ残して終えるか | 続行 / 終える | 終えるときは `--intent-only` を付けて `init` し、intent の `pass-gate` の後に `close` で run を `completed` にする。run ブランチは作らない |
| Issue 起票 | する / しない | github モードで、入力に Issue が無いときだけ選択肢に出す。local モードでは選択肢に出さず理由を 1 行添える |

Issue から取り込んだ原文の記録(本文と人のコメント)のうち、原文から除くものがあれば、ユーザーがこのゲートで選ぶ。除いた記録は原文に入れない。

## 5. run の作成と保存

承認後、次の (1)〜(6) をこの順に行う。git の操作と Raguel MCP の呼び出しはこのスキルの実行者、`codiel-state` の各コマンドは CLI が行う。

ユーザーへの確認は (3) までに済ませる。(1)〜(3) は run を作る前なので `mark-ask` を使わない例外である。これ以外の途中で人へ確認するときは、`codiel-state mark-ask <phase> --slug <slug> --kind confirm` で run を `awaiting_human` にしてから確認し、答えを得たら `codiel-state resume --slug <slug>` で戻す(`--evaluation-id` は無くてよい)。(4) の `codiel-state init` から (6) の `start-phase intent` までは確認を挟まず一気に進める。この区間は phase が `null` の active run になり、stop-guard が active な run でのセッションの停止を block する。ユーザーの応答を待つと止まれない。

(1) 開始時のブランチの作業ツリーに intent 文書を Write で書く。frontmatter `run` には slug を入れる。保存先の命名規則(同日重複の扱い、git 未管理時の扱い)は `intent-format.md` の「保存先と命名」に従う。手順 1 で前の try の intent を持ち込んでいるときは、持ち込んだ intent と同じパスに書く。

(2) Issue 起票を選んだときだけ、gh-utility `issue-craft` を持ち込みモードで起動して起票し、番号を intent の frontmatter `issue` に書く。固定開始句「持ち込みモード: 以下の完成済み本文で起票」で起動し、`title` / `body` / `labels`(任意)を渡す(`handoff-contract.md`)。渡す本文には `<!-- codiel:generated -->` を含める。起票は外部公開行為であり、持ち込みモード側でも全文提示と明示承認を経る。`issue-craft` が使えないときは `intent-common.md` の「自前起票」に従う。

(3) intent 以外の未コミットの変更があるかを確かめる。あるときは `references/uncommitted-changes.md` を Read して従う。

(4) `codiel-state init --slug <slug> --intent <パス> --integration <github|local> --scale <standard|light> --adr-target <metatron|intents> --image-upload <gh-attach|chrome|gh-attach,chrome|none> [--issue <N>] [--intent-only] [--base-branch <開始時のブランチ>] [--domain-mode <mapped|unscoped>] [--human-approved]` を実行する。`--intent` は repoRoot 相対のパスで渡す(絶対パスは拒否される)。`branch` は CLI が決める。`--intent-only` なら `null`、それ以外は `codiel/<slug>-try-<n>` である。`--human-approved` は、手順 1 で前の try の STOP(`raguel-stop` か、`humanApproved` の無い `verdict: "STOP"` のフェーズ)についてユーザーが新しい try を承認したときだけ付ける。

(5) `git add -- <intent パス>` で intent 文書だけを stage する。未追跡のファイルでもパスを限定したコミットができる。

(6) 手順 4 で決めた「文書だけ残して終えるか」で分岐する。どちらの分岐も、ユーザーへの確認を挟まずに進める。

- 終える(intent-only)とき: `references/intent-only.md` を Read して従う。
- 続行するとき:
  1. `git switch -c <state.branch>` を実行する。
  2. `git commit -m "codiel(intent): <要約> (<slug> try-<n>)" -- <intent パス>` を実行する。
  3. `codiel-state start-phase intent --slug <slug>` → `evaluate_decision` → `codiel-state pass-gate intent --slug <slug> --evaluation-id <id> --verdict PROCEED` の順に進め、以降のフェーズへ移る。

`git switch -c` か `git commit` が失敗したときは、`references/commit-failure.md` を Read して従う。この失敗で run を `commit-failed` で終端にした後に限り、ユーザーへ確認してよい。

保存に失敗したときは、intent 文書の全文をセッション内に提示したうえで保存先をユーザーに確認する。文書を失わせない。畳んだ経路があるときは、理由と使えるようにする方法を 1 行で報告する。
