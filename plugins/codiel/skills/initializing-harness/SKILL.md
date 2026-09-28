---
name: initializing-harness
description: Codiel のハーネス初期化で、セッション本体が保護パスをユーザーに確認しながら .codiel/・raguel.config.yaml・.claude/rules/codiel.md・CLAUDE.md の ## Codiel を生成・補完するときに使う。/codiel:init が名指しで起動する。
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
- [ ] 2. **`raguel.config.yaml` の生成**(保護パス)
- [ ] 3. **`.claude/rules/codiel.md` の配置と `CLAUDE.md` への `## Codiel` の追記**
- [ ] 4. **検証**
- [ ] 5. **完了報告**

## 0. 現状調査

次の 3 点を確認し、**不足しているものだけ**を以降の手順の対象にする。

| # | 確認対象 | 「揃っている」の判定 |
|---|---|---|
| B | `.claude/rules/codiel.md` / `CLAUDE.md` | `.claude/rules/codiel.md` が存在し、かつ `CLAUDE.md` に、行全体が(前後の空白を除き)`## Codiel` と一致する行がある |
| C | `raguel.config.yaml` | ファイルが存在し、YAML としてパースできる |
| D | `.codiel/runs` / `.codiel/reports` / `.codiel/config.json` | 3 つが存在する |

- 3 点すべて揃っていれば「初期化済み。作業なし」と報告して**終了する**(何も書き込まない)。
- 一部が欠けていれば、欠けている項目に対応する手順だけを実施する。
- GOTCHAS は確認対象に含めない。台帳の生成は metatron が行う(`/metatron:init`)。codiel は台帳を作らない。
- ARCHITECTURE は確認対象に含めない。作成と更新は metatron が行う。codiel は ARCHITECTURE を書かない。
- git 管理外のプロジェクトでも実行する。警告を 1 行添えるだけにとどめる。

## 1. `.codiel/` の配置

```
bash <plugin-root>/scripts/install-harness.sh
```

を対象プロジェクトのルートで Claude 自身が Bash ツールで実行する(ユーザーに実行させない)。
このスクリプトが作るのは `.codiel/runs` / `.codiel/reports` の 2 ディレクトリと、無ければ
既定値 `{ "testsDir": "docs/tests" }` で作る `.codiel/config.json` である。`.codiel/config.json` が
既にあれば中身を変えない。

## 2. `raguel.config.yaml` の生成

保護パスの正本は `raguel.config.yaml` である。他のファイルの記述と突き合わせない。

- AskUserQuestion で「触ってはいけない/特に慎重を要するパスの glob」を 1 回だけ聞く。
- 形式は同梱の `raguel.config.example.yaml` に準拠する(生成前に必ず Read する)。
- Raguel の設定は内蔵デフォルトへの**差分オーバーレイ**(deep merge)なので、
  `rules."code/protected-paths".globs` だけを書いた最小ファイルを生成する。
  デフォルト全量をコピーしない。
- 既にファイルがあれば触らない。

## 3. `.claude/rules/codiel.md` の配置と `CLAUDE.md` への `## Codiel` の追記

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

## 4. 検証

- `raguel.config.yaml` の `rules."code/protected-paths".globs` を Read し、手順 2 で承認された
  glob がそのまま入っていることを確認する。
- 手順 3(a) を実行したときは `.claude/rules/codiel.md` を Read し、`<plugin-root>/assets/rules/codiel.md`
  と同じ内容であることを確認する。
- 手順 3(b) を実行したときは `CLAUDE.md` を Read し、`## Codiel` 見出しと 5 行の内容が
  追記されていることを確認する。
- 検証に失敗したら該当ファイルを修正して再検証する。**失敗のまま完了報告しない**。

## 5. 完了報告

次を報告して終了する。

- 配置・生成・追記したファイルの一覧(skip したものは skip と明記)
- ユーザーが不明と答えて未記入のまま残した項目
- 手順 3(c) の旧セクションの取り除きが承認されず残った場合はその旨
- 次のアクション: `/codiel:run [<Issue番号> | <intent パス> | 省略]` で run を開始できること

## 修復の例外

既存 `raguel.config.yaml` が YAML として
読めない場合に限り、問題箇所と修正案を提示して
**ユーザーの明示承認を得た上で**、該当キーのみを置換する。
それ以外の既存記述は不改変のまま維持する。

<HARD-GATE>
- **承認なしに書き込まない**。ドラフト全文(新規ファイル)または追記差分(既存ファイル)の
  提示と承認の取得を省略しない。
- **既存記述を削除・改変しない**。変更は不足分の追記だけにする
  (「修復の例外」で明示承認を得た置換と、手順 3(c) で承認を得た旧セクション
  「## Codiel ハーネス運用ルール」の取り除きを除く)。
- **検証(手順 4)を省略して完了報告しない**。
- **聞いた保護パスをコードベースの解析結果で置き換えない**。保護パスはユーザーの回答からのみ
  生成する。不明ならユーザーに聞く。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「ドメイン分割を答えてもらったのだから、そのまま書き込んでよい」 | 回答はドラフトの入力であって承認ではない。全文提示と承認は別の手順。 |
| 「小さいプロジェクトだからドラフト提示を飛ばして直接書いていい」 | CLAUDE.md / ARCHITECTURE はプロジェクトの恒久資産。承認なしの書き込みは HARD-GATE 違反。 |
| 「metatron が入っているか確かめてから分岐しよう」 | インストール検出はしない。見るのはファイルが契約を満たすかと `/metatron:init` が利用可能コマンドにあるかの 2 点だけ。 |
| 「既存 CLAUDE.md の古い記述もついでに直してあげよう」 | スコープ外。追記のみが許可された変更。例外は手順 3(c) の旧セクション「## Codiel ハーネス運用ルール」の取り除きだけで、承認を得てから行う。それ以外の気づいた問題は報告に留める。 |
