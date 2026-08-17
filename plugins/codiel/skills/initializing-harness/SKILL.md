---
name: initializing-harness
description: /codiel:init で対象プロジェクトに Codiel ハーネス(.codiel/・raguel.config.yaml・CLAUDE.md の運用ルール節・最小 ARCHITECTURE)を初期化・補完するとき使用。/codiel:run が未初期化を検出した場合の案内先でもある
---

# Codiel ハーネス初期化

`/codiel:init` は対象プロジェクト(カレントディレクトリ)に、`/codiel:run` を開始できる状態を作る。

## プラグインルート参照規約

このスキル起動時に通知される「Base directory for this skill」は
`<plugin-root>/skills/initializing-harness` である。**`<plugin-root>` はそのベース
ディレクトリの 2 階層上**。

## チェックリスト

- [ ] 0. **現状調査**。全部揃っていれば「初期化済み」と報告して終了する
- [ ] 1. **ARCHITECTURE の確認**(不足していれば最小生成)
- [ ] 2. **`.codiel/` の配置**
- [ ] 3. **`raguel.config.yaml` の生成**(保護パス)
- [ ] 4. **`CLAUDE.md` への運用ルール節の追記**
- [ ] 5. **検証**
- [ ] 6. **完了報告**

## 0. 現状調査

次の 4 点を確認し、**不足しているものだけ**を以降の手順の対象にする。

| # | 確認対象 | 「揃っている」の判定 |
|---|---|---|
| A | ARCHITECTURE(手順 1 で解決するパス) | ファイルが存在し、手順 5 の検証コマンドが OK を返す |
| B | `CLAUDE.md` | ファイルが存在し、`## Codiel ハーネス運用ルール` 見出しを含む |
| C | `raguel.config.yaml` | ファイルが存在し、YAML としてパースできる |
| D | `.codiel/specs` / `.codiel/runs` / `.codiel/reports` | 3 ディレクトリが存在する |

- 4 点すべて揃っていれば「初期化済み。作業なし」と報告して**終了する**(何も書き込まない)。
- 一部が欠けていれば、欠けている項目に対応する手順だけを実施する。
- GOTCHAS は確認対象に含めない。失敗を記録する時点で `recording-gotchas` が台帳ごと作成する。
- git 管理外のプロジェクトでも実行する。警告を 1 行添えるだけにとどめる。

## 1. ARCHITECTURE の確認

ARCHITECTURE のパスは次で解決する。固定パス `docs/ARCHITECTURE.md` を前提にしない。

```
node -e 'import("<plugin-root>/scripts/lib.mjs").then(({ resolveDocPaths }) => console.log(JSON.stringify(resolveDocPaths(process.cwd()))))'
```

- 解決したパスにファイルがあり、手順 5 の検証コマンドが OK を返す → 何も書き込まず手順 2 へ進む。
- ファイルが無い、または domains ブロックが読めない → 下の 2 つの分岐のどちらかに入る。

**metatron がインストール済みかを検出しない。** metatron のプラグインルート・ソース・CLI の
場所を探さない。見るのは「解決したパスのファイルが契約を満たすか」と
「`/metatron:init` が自分の利用可能コマンドにあるか」の 2 点だけである。

### `/metatron:init` が自分の利用可能コマンドにある場合

- AskUserQuestion で次の 2 択を提示する。
  - (a) `/metatron:init` を実行する(推奨)
  - (b) 最小 ARCHITECTURE を生成して進む
- (a) を選んだら、`/metatron:init` の完了後に `/codiel:init` を再実行するよう案内して終了する。
- (b) を選んだら「最小 ARCHITECTURE の生成」へ進む。推奨に従わなかったことを理由に
  警告を繰り返さない。

### `/metatron:init` が無い場合

「最小 ARCHITECTURE の生成」へ進む。

### 最小 ARCHITECTURE の生成

1. AskUserQuestion で**ドメイン分割だけ**を聞く。書き込みを許すパスの glob をドメインごとに尋ねる。
   技術スタック・ディレクトリ構成・コマンド定義・テスト方針・規約は聞かない。
2. 回答から下の形の**全文**を組み立てる。
3. 全文を提示して**改めて承認を得てから**書き込む。回答したこと自体を承認とみなさない。

````markdown
# ARCHITECTURE

## ドメインマップ

```json metatron:domains
{
  "frontend": ["src/app/**", "src/components/**"],
  "backend": ["src/server/**", "src/api/**"]
}
```
````

- ドメイン名は任意の文字列にする。`frontend` / `backend` は例であり固定語彙ではない。
- 分割が馴染まなければ `{ "generic": ["**"] }` に縮退させる。
- トップレベルはオブジェクトにし、各値は 1 要素以上の文字列配列にする。
- ブロック内は有効な JSON のみにする。コメントを書かない。
- 見出しは `# ARCHITECTURE` と `## ドメインマップ` だけにする。散文セクションを足さない。

**移行作業はゼロである。** ARCHITECTURE はすべてのセクションが任意であり、この最小ファイルは
正当な ARCHITECTURE である。後から metatron を導入した場合、`/metatron:init` が既存の
`## ドメインマップ` をそのまま活かして残りのセクションを足す。変換もマーカーの書き換えもしない。

## 2. `.codiel/` の配置

```
bash <plugin-root>/scripts/install-harness.sh
```

を対象プロジェクトのルートで Claude 自身が Bash ツールで実行する(ユーザーに実行させない)。
このスクリプトが作るのは `.codiel/specs` / `.codiel/runs` / `.codiel/reports` だけである。

## 3. `raguel.config.yaml` の生成

保護パスの入力は 1 回にする。

- ARCHITECTURE に `## 保護パス` 節が**ある**場合 → その glob を読み取り、内容を提示して
  承認を得たうえで生成する。インタビューで聞き直さない。
- **無い**場合 → AskUserQuestion で「触ってはいけない/特に慎重を要するパスの glob」を聞く。
- 形式は同梱の `raguel.config.example.yaml` に準拠する(生成前に必ず Read する)。
- Raguel の設定は内蔵デフォルトへの**差分オーバーレイ**(deep merge)なので、
  `rules."code/protected-paths".globs` だけを書いた最小ファイルを生成する。
  デフォルト全量をコピーしない。
- 既にファイルがあれば触らない。

## 4. `CLAUDE.md` への運用ルール節の追記

- `<plugin-root>/CLAUDE.example.md` の `## Codiel ハーネス運用ルール` セクションを
  **固定文言のまま**使う(追記前に必ず Read する)。冒頭の HTML コメントはコピーしない。
- `CLAUDE.md` が無ければ `# CLAUDE.md` 見出し + 同セクションで新規作成する。
- 既にあり同見出しが無ければ**末尾に追記**する。あれば触らない。
- 既存の他セクションは一切変更しない。
- 追記する差分を提示して承認を得てから書き込む。

## 5. 検証

対象プロジェクトのルートで次を実行し、hooks・オーケストレーターと**同一の解析系**
(`lib.mjs` の `readDomainsResult`)で読めることを確認する。

```
node -e 'import("<plugin-root>/scripts/lib.mjs").then(({ readDomainsResult }) => {
  const { domains: d, warnings } = readDomainsResult(process.cwd());
  for (const w of warnings) console.error("WARN:", w);
  const ok = d && typeof d === "object" && !Array.isArray(d) && Object.keys(d).length > 0 &&
    Object.values(d).every(v => Array.isArray(v) && v.length > 0 && v.every(g => typeof g === "string"));
  if (!ok) { console.error("NG: metatron:domains ブロックが読めない/形式不正"); process.exit(1); }
  console.log("OK:", JSON.stringify(d));
})'
```

(`<plugin-root>` は絶対パスに展開して実行する)

- `WARN:` 行が出たら、`OK:` が返っていても内容を手順 6 の完了報告に出す。
- ARCHITECTURE に `## 保護パス` 節がある場合は、その節と `raguel.config.yaml` の
  `rules."code/protected-paths".globs` を両方 Read し、glob の集合が一致していることを確認する。
- 検証に失敗したら該当ファイルを修正して再検証する。**失敗のまま完了報告しない**。

## 6. 完了報告

次を報告して終了する。

- 配置・生成・追記したファイルの一覧(skip したものは skip と明記)
- 手順 5 の検証コマンドが出した `WARN:` 行(あれば全文)
- ユーザーが不明と答えて未記入のまま残した項目
- 最小 ARCHITECTURE を生成した場合は「これは Codiel が run を開始するための最小構成である。
  技術スタック・規約などの記述を加えるには metatron の導入を検討するとよい」を 1 行添える
- 次のアクション: `/codiel:run <issue番号>` で run を開始できること

## 修復の例外

既存 ARCHITECTURE の ` ```json metatron:domains ` ブロックが読めない(JSON 不正等で
`readDomains` が読めない)場合、および既存 `raguel.config.yaml` が YAML として読めない・
保護パスが ARCHITECTURE と不整合な場合に限り、問題箇所と修正案を提示して
**ユーザーの明示承認を得た上で**、該当ブロック・該当キーのみを置換する。
それ以外の既存記述は不改変のまま維持する。

- ARCHITECTURE への置換が hook に拒否されたら、`/metatron:update` を案内して手を止める。
  別経路での再試行や迂回はしない。

<HARD-GATE>
- **承認なしに書き込まない**。ドラフト全文(新規ファイル)または追記差分(既存ファイル)の
  提示と承認の取得を省略しない。
- **既存記述を削除・改変しない**。変更は不足分の追記だけにする
  (「修復の例外」で明示承認を得た置換を除く)。
- **検証(手順 5)を省略して完了報告しない**。
- **聞いた内容をコードベースの解析結果で置き換えない**。ドメインマップと保護パスは
  ユーザーの回答からのみ生成する。不明ならユーザーに聞く。
</HARD-GATE>

## Red Flags(合理化への反論)

| 思考 | 現実 |
|---|---|
| 「ディレクトリを見ればドメイン分割は分かるので聞かなくていい」 | ディレクトリの存在と「書き込みを許す境界の宣言」は別物。出所はユーザーの回答であることがこのスキルの前提。 |
| 「ドメイン分割を答えてもらったのだから、そのまま書き込んでよい」 | 回答はドラフトの入力であって承認ではない。全文提示と承認は別の手順。 |
| 「小さいプロジェクトだからドラフト提示を飛ばして直接書いていい」 | CLAUDE.md / ARCHITECTURE はプロジェクトの恒久資産。承認なしの書き込みは HARD-GATE 違反。 |
| 「domains の JSON は自分で書いたのだから検証不要」 | 検証は「自分が正しく書けたか」ではなく「hooks と同じ解析系で読めるか」の確認。フェンス開始行の 1 文字の違いで run が開始できなくなる。 |
| 「metatron が入っているか確かめてから分岐しよう」 | インストール検出はしない。見るのはファイルが契約を満たすかと `/metatron:init` が利用可能コマンドにあるかの 2 点だけ。 |
| 「ARCHITECTURE が最小なので技術スタックも足しておこう」 | 手順 1 で聞くのはドメイン分割だけ。散文は metatron の担当であり、勝手に足すと後の `/metatron:init` と衝突する。 |
| 「既存 CLAUDE.md の古い記述もついでに直してあげよう」 | スコープ外。追記のみが許可された変更。気づいた問題は報告に留める。 |
