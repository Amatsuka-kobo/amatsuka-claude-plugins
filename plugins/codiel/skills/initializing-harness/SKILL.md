---
name: initializing-harness
description: Codiel のハーネス初期化で、セッション本体が保護パスをユーザーに確認しながら .codiel/・config.json の raguel・.gitignore・.claude/rules/codiel.md・CLAUDE.md の ## Codiel を生成・補完するときに使う。/codiel:init が名指しで起動する。
---

# Codiel ハーネス初期化

`/codiel:init` は対象プロジェクト(カレントディレクトリ)に、`/codiel:run` を開始できる状態を作る。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は
`<plugin-root>/skills/initializing-harness` である。**`<plugin-root>` はそのベース
ディレクトリの 2 階層上**。

## チェックリスト

- [ ] 0. **現状調査**。3 点すべて揃っていれば「初期化済み」と報告して終了する
- [ ] 1. **`.codiel/` の配置**
- [ ] 2. **`.codiel/config.json` の `raguel` の生成**(保護パス)
- [ ] 3. **`.gitignore` の整備**
- [ ] 4. **`.claude/rules/codiel.md` の配置と `CLAUDE.md` への `## Codiel` の追記**
- [ ] 5. **検証**
- [ ] 6. **完了報告**

## 承認の前に、書く内容を応答の本文へ出す

以降の手順で承認を求める対象(書き込みの差分、新規ファイルの全文、ファイルの削除、置換の案)は、すべてこの規律に従う。

- 承認を聞く前に、承認を求める対象を応答の本文へ出す。書き込みは差分を、新規ファイルは全文を、削除は消すファイルのパスを、置換は変更前と変更後を出す。
- AskUserQuestion の質問文と、考えの中だけで示した内容は、示したことに数えない。
- 複数の対象をまとめて承認を聞くときは、すべてを本文へ出してから 1 回聞く。
- 承認を聞く質問文には、本文に出した内容のどれを承認するかだけを書く。

## 0. 現状調査

次の 3 点を確認し、**不足しているものだけ**を以降の手順の対象にする。

| # | 確認対象 | 「揃っている」の判定 |
|---|---|---|
| B | `.claude/rules/codiel.md` / `CLAUDE.md` | `.claude/rules/codiel.md` が存在し、かつ `CLAUDE.md` に、行全体が(前後の空白を除き)`## Codiel` と一致する行がある |
| C | `.codiel/config.json` | JSON のオブジェクトとして読め、`raguel` がオブジェクトである(空のオブジェクトでよい)。`raguel.config.yaml` は見ない |
| D | `.codiel/runs` / `.codiel/reports` / `.gitignore` | `.codiel/runs` と `.codiel/reports` の 2 ディレクトリが存在し、`node <plugin-root>/scripts/codiel-state.mjs gitignore` が返す `missing` が空である |

- 3 点すべて揃っていれば「初期化済み。作業なし」と報告して**終了する**(何も書き込まない)。
- 一部が欠けていれば、欠けている項目に対応する手順だけを実施する。
- `codiel-state gitignore` が失敗したとき(config.json が不正なとき)は、標準エラー出力の理由を控え、D は揃っていないものとして扱う。
- GOTCHAS は確認対象に含めない。台帳の生成は metatron が行う(`/metatron:init`)。codiel は台帳を作らない。
- ARCHITECTURE は確認対象に含めない。作成と更新は metatron が行う。codiel は ARCHITECTURE を書かない。
- git 管理外のプロジェクトでも実行する。警告を 1 行添えるだけにとどめる。

## 1. `.codiel/` の配置

```
bash <plugin-root>/scripts/install-harness.sh
```

を対象プロジェクトのルートで Claude 自身が Bash ツールで実行する(ユーザーに実行させない)。
このスクリプトが作るのは `.codiel/runs` / `.codiel/reports` の 2 ディレクトリと、無ければ
既定値 `testsDir`(`docs/codiel/tests`)と `runsDir`(`docs/codiel/runs`)で作る `.codiel/config.json` である。
`.codiel/config.json` が既にあれば中身を変えない。`raguel` と `.gitignore` は書かない。

`.codiel/config.json` が無いときは、手順 2 の前に必ずこの手順を実行する。ファイルがあれば
スクリプトは中身を変えないので、D が揃っていても重ねて実行してよい。

## 2. `.codiel/config.json` の `raguel` の生成

保護パスの正本は `.codiel/config.json` の `raguel` である。他のファイルの記述と突き合わせない。
`raguel` の値は、Raguel が読む設定そのものである。書いたキーだけが内蔵の既定値を上書きするので、変えたいキーだけを書く。
形式は同梱の `config.example.json` に準拠する(書く前に必ず Read する)。
JSON はコメントを持てないので、マージの規則と、書くキーの意味は次のとおり本文が定める。

### マージの規則

- オブジェクトは再帰でマージする。書いていないキーは既定値のままである。
- 配列は置換する。既定の要素を残したいときは、残す要素も自分で書く。
- 例外は、和集合と宣言されたリスト(`code/protected-paths` の `globs`、`common/secrets` の `allowPatterns`)である。既定値に利用者の要素が加わり、既定の要素は消えない。

### 書くキーと使う場面

- `storage.projectId`: ケースファイルと判例を束ねるキーである。既定は git の共通ディレクトリから作る値で、どの worktree からでも同じになる。リポジトリを移したあとも履歴を引き継ぎたいときなど、名前を固定したいときだけ文字列で書く(例: `"storage": { "projectId": "my-service" }`)。
- `code/protected-paths` の `excludeDefaults`: 和集合を取ったあとに、既定の保護の glob(`.github/**`・`infra/**`・`**/*.env*`)から取り除くものを書く。既定の glob と完全に一致する文字列だけを受け、利用者の `globs` を取り除く手段にはならない。IaC や CI の設定を直すプロジェクトでは、既定のままだと implement のゲートが毎回 STOP になるので、直す対象のパターンだけを名指しして外す(例: `"excludeDefaults": [".github/**"]`)。
- `code/protected-paths` の `generated`: 生成物の glob を書く。和集合を取らず、既定は空である。生成物をコミットする規約のプロジェクトで、生成物が保護パスや重さの判定に掛からないようにする(例: `"generated": ["dist/**"]`)。秘密情報の検査は生成物にも掛かる。ワイルドカードより前の固定部が空の glob(`**/*`・`*.js`)は読み込みエラーになる。
- `subject.ignoreUncommitted`: 未コミットの変更を、code 系のゲートの入力の誤りに数えないパスの glob を書く。配列は置換し、既定は空である。使うのは、会話記録の追記など、ほかの仕組みが同じ作業ツリーへ書き続けるプロジェクトである。書くのは、run と関係の無いそのファイルの置き場だけにする(例: `"subject": { "ignoreUncommitted": ["docs/chat/**"] }`)。ソースのパスは書かない。書くと、未コミットのコードの変更が評価に入らないまま残る。ワイルドカードより前の固定部が空の glob(`**/*`・`*.js`)は読み込みエラーになる。
- `excludeDefaults` と `generated` は保護を緩めるので、聞いた回答に外す理由(IaC・CI を直す、生成物をコミットする)があるときだけ書く。理由を聞き取れなければ書かない。
- run が active か awaiting_human の間は、config.json への書き込みを codiel の guard が拒む。書き込みは run の外で行う。

### 書き込みの手順

`raguel` の出所を次の順に判定し、当てはまる 1 つだけを行う。

1. config.json に `raguel` があれば、判定 C を満たすので、この手順を行わない。
2. `raguel` が無く、`raguel.config.yaml` が YAML として読めるときは、次の順に進める。
   1. その中身を `raguel` に写す差分を示し、承認を得て config.json に書く。撤去したキー(`judge`・`weight`・`panel` の全体と `contextJudge.enabled`)は、Raguel が警告を出して無視する。`common/resubmission-loop` の `stopAfter` は、写すと読み込みエラーになる。どちらも写さずに外し、外したことを差分に示す。
   2. 書いた後に config.json を Read し、`raguel` の中身が YAML と同じであることを確かめる。
   3. `raguel.config.yaml` を消すことを示して承認を得てから、Bash の `rm` で消す。
   4. 消す承認が得られなければ残し、Raguel が読まないファイルであることを完了報告に書く。
3. どちらも無ければ、AskUserQuestion で「触ってはいけない/特に慎重を要するパスの glob」を 1 回だけ聞き、
   `raguel` に `version` と `rules."code/protected-paths".globs` を書く。デフォルト全量をコピーしない。
   回答に、既定の保護から外す理由や生成物のコミット規約が含まれるときだけ、`excludeDefaults` と `generated` も足す。
   保護パスは無いと答えたら、`raguel` を空のオブジェクトにする。

config.json への書き込みは、既存のキーを変えずに `raguel` を足すだけにする。書く前に差分を示し、承認を得る。

## 3. `.gitignore` の整備

`.gitignore` は、`.codiel` を持つディレクトリ(カレントディレクトリ)のものを対象にする。
git に載せない置き場(`.codiel/runs/`・`.codiel/reports/`・E2E のレポートの画像など)の行を、次の順に足す。

1. `node <plugin-root>/scripts/codiel-state.mjs gitignore` を実行する。出力は `{ "path": ".gitignore", "required": [...], "missing": [...] }` である。
2. `missing` が空なら、この手順を行わない。
3. `missing` が空でなければ、`# codiel` の行と `missing` の行を `.gitignore` の末尾に足す差分を示す。`.gitignore` が無ければ全文を示す。承認を得てから書く。
4. 既存の行は変えない。
5. `.gitignore` に `.codiel/` の行があり、`.codiel/config.json` まで無視されるとき(`git check-ignore -q .codiel/config.json` が成功する)は、その事実を示して扱いを AskUserQuestion で聞く。自動では消さない。

`<runsDir>/` は git で共有するので、`.gitignore` に行を置かない。

## 4. `.claude/rules/codiel.md` の配置と `CLAUDE.md` への `## Codiel` の追記

### (a) `.claude/rules/codiel.md` の配置

- `.claude/rules/codiel.md` が無ければ、`<plugin-root>/assets/rules/codiel.md` を
  **固定文言のまま** Write で置く(置く前に必ず Read する)。
- 既にあれば触らない。
- 新規ファイルの全文を提示して承認を得てから書き込む。

### (b) `CLAUDE.md` への `## Codiel` の追記

- `CLAUDE.md` に、行全体が(前後の空白を除き)`## Codiel` と一致する行が無ければ、
  `<plugin-root>/CLAUDE.example.md` の `## Codiel` セクションを**固定文言のまま**使う
  (追記前に必ず Read する)。冒頭の HTML コメントはコピーしない。旧見出し「## Codiel
  ハーネス運用ルール」は先頭が `## Codiel` と一致するが行全体は一致しないため、この判定
  では「無い」行として扱う。
- `CLAUDE.md` が無ければ `# CLAUDE.md` 見出し + 同セクションで新規作成する。
- 既にあり同見出しが無ければ**末尾に追記**する。あれば触らない。
- 追記する差分(新規作成のときは全文)を提示して承認を得てから書き込む。

### (c) 旧セクション「## Codiel ハーネス運用ルール」の取り除き

- `CLAUDE.md` に旧セクション `## Codiel ハーネス運用ルール` があれば、それを取り除く差分を
  提示し、承認を得てから取り除く。
- 承認されなければ残し、完了報告にその旨を書く。

(a)(b)(c) のいずれも、既存の他セクションは一切変更しない。例外は (c) の旧セクション
「## Codiel ハーネス運用ルール」の取り除きだけであり、承認を得た場合に限る。

## 5. 検証

- 手順 2 を実行したときは `.codiel/config.json` を Read し、`raguel` に承認された内容
  (保護パスの glob、または YAML から写した中身)がそのまま入っていて、既存のキーが変わっていないことを確認する。
- 手順 3 を実行したときは `codiel-state gitignore` をもう一度実行し、`missing` が空であることを確認する。
- 手順 4(a) を実行したときは `.claude/rules/codiel.md` を Read し、`<plugin-root>/assets/rules/codiel.md`
  と同じ内容であることを確認する。
- 手順 4(b) を実行したときは `CLAUDE.md` を Read し、`## Codiel` 見出しと 6 行の内容が
  追記されていることを確認する。
- 環境変数 `TYPESAFE_API_KEY` の有無を `test -n "$TYPESAFE_API_KEY"` で確かめる。値は表示しない。無くても初期化は失敗にせず、完了報告で伝える。
- 検証に失敗したら該当ファイルを修正して再検証する。**失敗のまま完了報告しない**。

## 6. 完了報告

報告の前に、この実行で書き込んだファイル(`.codiel/config.json`・`.gitignore`・`.claude/rules/codiel.md`・`CLAUDE.md` のうち実際に書いたものだけ)をコミットしてよいかを、AskUserQuestion で聞く。書いたファイルが無ければ聞かない。
承認されたら、書いたファイルのパスを指定して `git add -- <パス>` を行い、`git commit -m "codiel(init): ハーネスを初期化する" -- <パス>` でそのファイルだけをコミットする。ステージ済みのほかの変更は巻き込まない。
断られたら、コミットは利用者に任せる。未コミットのまま run を始めると、code 系のゲート(`evaluate_code`)が未コミットの変更を評価できずに止まることを伝える。

次を報告して終了する。

- 配置・生成・追記したファイルの一覧(skip したものは skip と明記)
- ユーザーが不明と答えて未記入のまま残した項目
- 手順 2 で `raguel.config.yaml` を消す承認が得られず残ったときは、Raguel が読まないファイルであること
- 手順 4(c) の旧セクションの取り除きが承認されず残った場合はその旨
- `.codiel/config.json`・`.gitignore`・`.claude/rules/codiel.md`・`CLAUDE.md` は run の外のファイルである。コミットしたか、断られて利用者に任せたかを書く
- `TYPESAFE_API_KEY` が無いときは、Raguel が Jev による内容の判定と文脈の補正をせず、ルール層だけで判定すること。有効にするには、キーをシェルの環境変数 `TYPESAFE_API_KEY` に設定して Claude Code を起動し直す(手順は `jevriel` プラグインの README に従う)
- 次のアクション: `/codiel:run [<Issue番号> | <intent パス> | 省略]` で run を開始できること

## 修復の例外

`.codiel/config.json` が JSON として読めない場合と、既存の `raguel.config.yaml` が YAML として
読めない場合に限り、問題箇所と修正案を提示して
**ユーザーの明示承認を得た上で**、該当キーのみを置換する。
それ以外の既存記述は不改変のまま維持する。

<HARD-GATE>
- **承認なしに書き込まない**。ドラフト全文(新規ファイル)または追記差分(既存ファイル)の
  提示と承認の取得を省略しない。提示は応答の本文に出すことであり、承認を聞くより前に行う。
- **既存記述を削除・改変しない**。変更は不足分の追記だけにする
  (「修復の例外」で明示承認を得た置換と、手順 4(c) で承認を得た旧セクション
  「## Codiel ハーネス運用ルール」の取り除きと、手順 2 で承認を得た `raguel.config.yaml` の削除を除く)。
- **検証(手順 5)を省略して完了報告しない**。
- **聞いた保護パスをコードベースの解析結果で置き換えない**。保護パスはユーザーの回答からのみ
  生成する。不明ならユーザーに聞く。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「ドメイン分割を答えてもらったのだから、そのまま書き込んでよい」 | 回答はドラフトの入力であって承認ではない。全文提示と承認は別の手順。 |
| 「小さいプロジェクトだからドラフト提示を飛ばして直接書いていい」 | CLAUDE.md / ARCHITECTURE はプロジェクトの恒久資産。承認なしの書き込みは HARD-GATE 違反。 |
| 「metatron が入っているか確かめてから分岐しよう」 | インストール検出はしない。見るのはファイルが契約を満たすかと `/metatron:init` が利用可能コマンドにあるかの 2 点だけ。 |
| 「既存 CLAUDE.md の古い記述もついでに直してあげよう」 | スコープ外。追記のみが許可された変更。例外は手順 4(c) の旧セクション「## Codiel ハーネス運用ルール」の取り除きだけで、承認を得てから行う。それ以外の気づいた問題は報告に留める。 |
| 「差分は考えの中でまとめたから、AskUserQuestion で『示した内容のとおりに書いてよいか』と聞けばよい」 | ユーザーには考えの中が見えない。本文に出していない差分は示していないのと同じで、その承認は内容を見ないままの承認になる。 |
| 「YAML を写し終えたから、確認なしで消してよい」 | 消すのも承認を要する変更。写した中身を Read で確かめ、消すことを示して承認を得てから消す。 |
