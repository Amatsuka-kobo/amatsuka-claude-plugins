---
name: initializing-harness
description: /codiel:init で対象プロジェクトに Codiel ハーネス(docs/ARCHITECTURE.md・docs/GOTCHAS.md・CLAUDE.md・raguel.config.yaml・.codiel/)を対話インタビューで初期化・補完するとき使用。/codiel:run が未初期化を検出した場合の案内先でもある
---

# Codiel ハーネス初期化

## 概要

`/codiel:init` は対象プロジェクト(カレントディレクトリ)に Codiel ハーネス資産を配置し、
対話インタビューの回答からプロジェクトに合った `docs/ARCHITECTURE.md` / `CLAUDE.md` /
`raguel.config.yaml` を生成する。**コードベースの自動解析は行わない**(内容の出所は常に
ユーザーの回答である。推測で埋めない)。

不足しているものだけを対象にするため、初期化済みプロジェクトでの再実行は不足分の補完に
なり(補完モード)、途中で中断しても再実行すれば不足分から自然に再開される(冪等)。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は
`<plugin-root>/skills/initializing-harness` である。**`<plugin-root>` はそのベース
ディレクトリの 2 階層上**。

## チェックリスト

- [ ] 1. **現状調査**(下記)。全部揃っていれば「初期化済み」と報告して終了する
- [ ] 2. **機械的配置**: `bash <plugin-root>/scripts/install-harness.sh` を実行する
- [ ] 3. **対話インタビュー**(不足セクションに対応するテーマのみ)
- [ ] 4. **生成と自動マージ**(書き込み前にドラフト/差分を提示して承認を得る)
- [ ] 5. **検証**(domains ブロックのパース確認・保護パスの整合確認)
- [ ] 6. **完了報告**(`/codiel:run <issue番号>` を案内する)

## 1. 現状調査(モード判定)

対象プロジェクトで次の 5 点を確認し、**不足しているものだけ**を以降の手順の対象にする。

| # | 確認対象 | 「揃っている」の判定 |
|---|---|---|
| A | `docs/ARCHITECTURE.md` | ファイルが存在し、` ```json codiel:domains ` フェンスブロックが有効な JSON としてパースできる(手順 5 と同じ node コマンドで確認してよい) |
| B | `CLAUDE.md` | ファイルが存在し、`## Codiel ハーネス運用ルール` 見出しを含む |
| C | `docs/GOTCHAS.md` | ファイルが存在する |
| D | `raguel.config.yaml` | ファイルが存在する |
| E | `.codiel/specs` / `.codiel/runs` / `.codiel/reports` | 3 ディレクトリが存在する |

- 5 点すべて揃っていれば「初期化済み。作業なし」と報告して**終了する**(何も書き込まない)。
- 一部が欠けていれば**補完モード**: 欠けている項目に対応する手順・質問だけを実施する。
  たとえば A の ARCHITECTURE.md は存在するが「コマンド定義」節が空の場合は、そのテーマの
  質問だけを行い、該当セクションだけを追記する。
- git 管理外のプロジェクトでも実行してよい(警告を一言添えるのみ。init 自体は git を
  必要としない)。

## 2. 機械的配置

```
bash <plugin-root>/scripts/install-harness.sh
```

を対象プロジェクトのルートで実行する(ユーザーに実行させず Claude 自身が Bash ツールで行う)。
このスクリプトの責務は `.codiel/{specs,runs,reports}` の作成と `docs/GOTCHAS.md` 雛形の
copy-if-absent のみ。GOTCHAS は「空のジャーナル」であり、インタビューでの設定は不要。
ARCHITECTURE.md / CLAUDE.md / raguel.config.yaml はこのスクリプトでは配置**されない**
(以降の手順で生成する)。

## 3. 対話インタビュー

AskUserQuestion ツールで **1 テーマずつ**質問する(一度に複数テーマを聞かない)。
選択肢は一般的な候補を挙げ、ユーザーは常に Other で自由回答できる。回答が曖昧・不足して
いる場合は同じテーマ内で追加の質問をしてよいが、**コードベースを読んで推測で補うことは
しない**(不明ならユーザーに聞く)。

補完モードでは、不足しているセクションに対応するテーマだけを質問する。

| # | テーマ | 質問する内容 | 反映先 |
|---|---|---|---|
| 1 | プロジェクト概要 | 何のためのプロダクトか・利用者・主要な技術的制約(1 段落分) | ARCHITECTURE 冒頭 |
| 2 | 技術スタック | 言語 / フレームワーク / 主要ライブラリ / パッケージマネージャ / バージョン方針 | 「技術スタック」表 |
| 3 | ディレクトリ構成 | 主要ディレクトリと各領域の責務(ドメインマップと矛盾しないこと) | 「ディレクトリ構成と責務」節 |
| 4 | ドメイン分割 | frontend / backend / data それぞれの書き込み許可パス glob。分割が馴染まなければ `{ "generic": ["**"] }` に縮退 | ` ```json codiel:domains ` ブロック |
| 5 | コマンド定義 | test / lint / typecheck / build / e2e の実行コマンド(プロジェクトルートで実行できる形) | 「コマンド定義」表 |
| 6 | テスト方針 | E2E フレームワークと実行方法、ユニットテストの要否・フレームワーク・配置規約 | 「テスト方針」節 |
| 7 | 保護パス | 触ってはいけない/特に慎重を要するパスの glob | ARCHITECTURE「保護パス」節 + `raguel.config.yaml` の `rules.code/protected-paths.globs`(**同一の回答から両方を生成する**) |
| 8 | 規約 | コーディング規約 / ベースブランチ / ブランチ・PR 命名 / Definition of Done | 「規約」節 |

## 4. 生成と自動マージ

回答からドラフトを作り、**書き込み前に必ず内容(新規ファイルは全文、既存ファイルへの追記は
追記箇所の差分)を提示してユーザーの承認を得る**。否認されたら該当テーマのインタビューに
戻って回答を修正し、再生成する。

- **`docs/ARCHITECTURE.md`**
  - 形式は `<plugin-root>/docs/ARCHITECTURE.example.md` に厳密に準拠する(作成前に必ず
    Read する)。セクション構成(概要 / 技術スタック / ディレクトリ構成と責務 /
    ドメインマップ / コマンド定義 / テスト方針 / 保護パス / 規約)と機械可読ブロックの
    形式(開始行 ` ```json codiel:domains ` そのまま・ブロック内は有効な JSON のみ・
    コメント不可)を変えない。example の HTML コメント(記入ガイド)はコピーしない。
  - 新規: 全セクションを回答から生成する。
  - 既存: 既存の記述は削除・改変せず、**不足セクションのみ**を追記する。
- **`CLAUDE.md`**
  - `<plugin-root>/CLAUDE.example.md` の `## Codiel ハーネス運用ルール` セクション
    (7 ルール)を**固定文言のまま**使う(作成前に必ず Read する。冒頭の HTML コメントは
    コピーしない)。
  - 新規: `# CLAUDE.md` 見出し + 同セクションで生成する。
  - 既存: `## Codiel ハーネス運用ルール` 見出しがなければ**末尾に追記**する。あれば触らない。
    既存の他セクションは一切変更しない。
- **`raguel.config.yaml`**
  - 形式は同梱の `raguel.config.example.yaml` に準拠する(作成前に必ず Read する)。
  - Raguel の設定は内蔵デフォルトへの**差分オーバーレイ**(deep merge)なので、
    プロジェクト固有の上書き(テーマ 7 の保護パス globs)だけを書いた最小ファイルを
    生成する。デフォルト全量をコピーしない。
  - 既存: 触らない(存在すれば現状調査 D で「揃っている」扱いになる)。

## 5. 検証(フェイルクローズドの前倒し)

run 開始時に初めて発覚していた不備を、init 完了時点で検出する。

1. **domains ブロックのパース確認**: 対象プロジェクトのルートで次を実行し、hooks・
   オーケストレーターと**同一の解析系**(`lib.mjs` の `readDomains`)で読めることを確認する:

   ```
   node -e 'import("<plugin-root>/hooks/scripts/lib.mjs").then(({ readDomains }) => {
     const d = readDomains(process.cwd());
     const ok = d && !Array.isArray(d) && Object.keys(d).length > 0 &&
       Object.values(d).every(v => Array.isArray(v) && v.length > 0 && v.every(g => typeof g === "string"));
     if (!ok) { console.error("NG: codiel:domains ブロックが読めない/形式不正"); process.exit(1); }
     console.log("OK:", JSON.stringify(d));
   })'
   ```

   (`<plugin-root>` は絶対パスに展開して実行する)
2. **保護パスの整合確認**: `docs/ARCHITECTURE.md` の「保護パス」節と `raguel.config.yaml` の
   `rules.code/protected-paths.globs` を両方 Read し、glob の集合が一致していることを確認する。
3. 検証に失敗したら該当ファイルを修正して再検証する。**失敗のまま完了報告しない**。

## 6. 完了報告

次を報告して終了する。

- 配置・生成・追記したファイルの一覧(skip したものは skip と明記)
- 次のアクション: `/codiel:run <issue番号>` で run を開始できること

<HARD-GATE>
- **承認なしに書き込まない**。手順 4 のドラフト/差分提示と承認の取得は、ファイルが新規でも
  既存でも省略できない。
- **既存記述を削除・改変しない**。ARCHITECTURE.md / CLAUDE.md への変更は不足分の追記のみ。
- **検証(手順 5)を省略して完了報告しない**。domains ブロックが readDomains で読めることを
  確認するまで初期化は完了していない。
- **コードベース解析で回答を代替しない**。ドメインマップ・コマンド定義等の内容はユーザーの
  回答からのみ生成する(ファイルを読んで「たぶんこうだろう」と埋めない)。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「package.json を見ればコマンド定義は分かるので聞かなくていい」 | scripts の存在と「プロジェクトの正式なテスト方針」は別物。宣言の出所はユーザーの回答であることがこのスキルの前提。 |
| 「小さいプロジェクトだからドラフト提示を飛ばして直接書いていい」 | CLAUDE.md / ARCHITECTURE.md はプロジェクトの恒久資産。承認なしの書き込みは HARD-GATE 違反。 |
| 「domains の JSON は自分で書いたのだから検証不要」 | 検証は「自分が正しく書けたか」ではなく「hooks と同じ解析系で読めるか」の確認。フェンス開始行の 1 文字の違いで run が開始できなくなる。 |
| 「既存 CLAUDE.md の古い記述もついでに直してあげよう」 | スコープ外。追記のみが許可された変更。気づいた問題は報告に留める。 |
