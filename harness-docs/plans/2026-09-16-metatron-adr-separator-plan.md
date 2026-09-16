# metatron の ADR エントリを水平線(`---`)で区切る 実装計画書

- 作成日: 2026-09-16
- 対象プラグイン: `plugins/metatron`(単独)
- バージョン: metatron `0.3.3-dev` → `0.3.4-dev`
- context-map(正本の調査結果): `.claude/context-maps/2026-09-16-metatron-adr-separator.md`
- 設計書: **無し。** 変更が 1 ファイル(`src/lib/adr.ts`)の局所改修と書式契約の追記に収まるため、context-map と本計画書を正本とする
- ADR: **起こさない**(ユーザー判断。制約 C3)

この計画書はタスク分割・順序・検証方法を立てるものであり、要件を上書きしない。
要件(R1〜R9)・受け入れ基準(A1〜A9)・制約(C1〜C7)はオーケストレーターが確定済みである。
計画と実際のコードが食い違う事実を見つけたときは、実装を止めてオーケストレーターへ報告し、§12「計画との食い違い」へ追記する。

---

## 0. 前提と baseline

### 0.1 オーケストレーターが確定済みの判断(着手時にこれを前提とする)

| # | 事項 | 決定 |
| --- | --- | --- |
| R1 | 区切りの置き方 | エントリ**間**にだけ `\n\n---\n\n` を挟む。先頭の前・末尾の後には置かない |
| R2 | 正規化の範囲 | `stage-adr` の追加経路・状態変更経路の**両方**で `## ADR 一覧` 節**全体**を毎回正規化する |
| R3 | `---` の扱い | **装飾**。パーサの境界トークンにしない。刻み目は `### ADR-NNN:` 見出しのまま |
| R4 | `contentEndIndex` | 遡り条件を「空行 **または** 区切り線」へ拡張する |
| R5 | `entry.raw` | 区切り線を含めない。全エントリで対称にする |
| R6 | 書式契約 | 凍結文書 §6-1 / §6-2 と `references/architecture-format.md` に区切りを規定する |
| R7 | チェックリスト | `docs/format-change-checklist.md` に「ADR の書式」の節を新設する |
| R8 | 記入例 | `docs/ARCHITECTURE.example.md` の ADR を 2 件にし、区切りの見本を含める |
| R9 | バージョン | `0.3.3-dev` → **`0.3.4-dev`**(パッチ)。`plugin.json` と `package.json` を揃える |
| C3 | ADR 化 | **しない。** `stage-adr` / `commit-architecture` の実行手順を計画に含めない |
| C5 | ブランチ | **切らない。** worktree も使わない |
| C6 | 契約節番号のずれ | **本計画で判断した。** §4 D7 を見る(`§5-x` → `§6-x` のみ是正し、`§11` は残課題へ回す) |
| U1 | metatron 設計書 §6-6 の書式の写し | **追随先に含める**(レビュー後に確定)。`harness-docs/design/2026-08-16-metatron-design.md` §6-6 の箇条書きへ、§6-1 へ足したのと同じ趣旨の 1〜2 行を追加する。担当は T11 |
| U2 | T14 の手動 CLI 検証 | **実施する**(レビュー後に確定)。任意ではなく**必須の手順**である。§0.4 の隔離手順に従う |

### 0.2 記入欄(実装セッションが着手時に埋める)

| 項目 | 値 |
| --- | --- |
| 着手時の HEAD(`git rev-parse HEAD`) | `dbd0b0e878b51b4492555fdf24139814bf5559f3` |
| `git status --short` の全文 | ` M docs/chat/INDEX.md`<br>`?? docs/chat/2026/0916/`<br>`?? harness-docs/plans/2026-09-16-metatron-adr-separator-plan.md` |
| `pnpm run lint` | 成功(`Checked 381 files`; info 4 件、error 0 件) |
| `pnpm run typecheck` | 成功(`tsc --noEmit`) |
| `pnpm run test` の Test Files / Tests / Duration | `157 passed \| 1 skipped (158)` / `2242 passed \| 2 skipped (2244)` / `70.97s` |

### 0.3 着手前に確認済みの事実(2026-09-16 時点の実測。実装セッションで再確認する)

- 計画作成時の `pnpm run test`: **`157 passed | 1 skipped`(158 ファイル)/ `2242 passed | 2 skipped`(2244 テスト)/ `61.90s`**。この数を下回らないこと。
- metatron のバージョンは `plugin.json` / `package.json` ともに `0.3.3-dev`。
- ルート `README.md` に metatron の**バージョン番号は載っていない**(`grep -nE "[0-9]+\.[0-9]+\.[0-9]+" README.md` は 0 件)。載っているのは L130 / L132 の機能説明のみで、**ADR の書式にも区切りにも触れていない**。
  → **受け入れ基準 A9 は「反映不要」で満たす。** README は変更しない。
- `plugins/metatron/build.ts` の `entryPoints` は 3 本(`metatron` / `inject-context` / `guard-docs`)。**新規ファイルを足さないので変更は要らない**(本計画は `adr.ts` への追記だけで済ませる)。
- `harness-docs/ARCHITECTURE.md` の `## ADR 一覧` に `^---` の行は 0 件。ADR は 3 件、状態変更履歴は 0 件。
- `src/__test__/section-reference-inventory.test.ts` は `SELF = "metatron"` を走査対象から除外する。本改修の文書変更はすべて `plugins/metatron/` 配下のため、このテストには影響しない(実装後に実行して確認する)。
- 契約節番号のずれ(C6)の実測: `§5-1` / `§5-2` / `§5-3` は **`adr.ts` に 21 件(18 行)**、**`adr.test.ts` に 6 件(5 行)**。内訳は `adr.ts` が §5-1 ×10 / §5-2 ×9 / §5-3 ×2、`adr.test.ts` が §5-1 ×4 / §5-2 ×2。
- `adr.ts` L731 のエラーメッセージ本文(`契約 §5-1 の書式に直してから…`)を**期待値にしているテストは無い**(`grep -rn "書式に直してから" src/lib/__test__/ src/cli/__test__/` が 0 件。テストは `code: "invalid_entry"` だけを見ている)。文面を変えても赤にならない。
- `parseArchitecture` が返す `ArchitectureSection.body` は「見出し行を除く本文。原文のまま(**末尾の空行を含む**)」である(`architecture.ts` L185-186)。読み取り経路の節本文は末尾が trim されていない。D5 の記述はこの事実を前提とする。

### 0.4 【必読】CLI を手で実行するときの隔離

**T14 の手動検証でのみ CLI を叩く。リポジトリルートで `stage-adr` / `commit-architecture` を実行してはならない。**
ルート `metatron.config.json` の `paths.architecture` は `harness-docs/ARCHITECTURE.md` を指すため、
ルートで実行すると**このリポジトリの正本 ARCHITECTURE に ADR が書かれる**。
これは制約 C3(この変更を ADR として起こさない)を実行の副作用で破ることになる。

```bash
# 1. cd する前にリポジトリ側の絶対パスを変数へ取る
REPO="$(pwd)"
CLI="$REPO/plugins/metatron/scripts/metatron.mjs"

# 2. 空の一時ディレクトリを作って移動する
TMP="$(mktemp -d)"
cd "$TMP"

# 3. 空の設定ファイルを置く。これがルート解決を TMP に固定する。
#    設定が無いと findDocRoot は git の toplevel を探しに行く段へ落ちる。
echo '{}' > metatron.config.json

# 4. 既定の architecture パスは `docs/ARCHITECTURE.md` である。
#    TMP の直下に置くと CLI から見えず、別のファイルが新規作成されてしまう。
mkdir -p docs
#    ここに検証用の ARCHITECTURE(`## ADR 一覧` を持つもの)を書く。

# 5. 【ガード】docRoot が TMP であることを確認してから先へ進む。
#    ここが TMP でなければ隔離が壊れている。直ちに中止する。
node "$CLI" get config | grep docRoot
```

- `cd` した後は CLI を必ず絶対パス(`$CLI`)で呼ぶ。
- **空の `metatron.config.json`(中身は `{}`)を置く。** `cli.test.ts` が取っている前例と同じ形である(L183-184 ほか。`writeFile(root, "metatron.config.json", "{}")` + `writeFile(root, "docs/ARCHITECTURE.md", …)`)。設定を置かない場合、`findDocRoot` は「設定を持つ祖先 → `git rev-parse --show-toplevel` → 開始ディレクトリ」の順に落ちる。`/tmp` 配下なら git は失敗して TMP に落ち着くが、**その経路に頼らない**。空の設定を置けば段 1 で確定する。
- **リポジトリの `metatron.config.json` をコピーしない。** コピーすると `paths.architecture` が `harness-docs/ARCHITECTURE.md` を指したままになる。
- **検証用 ARCHITECTURE の置き場は `$TMP/docs/ARCHITECTURE.md`。** 空の設定では `paths.architecture` が既定値のままであり、TMP 直下の `ARCHITECTURE.md` は読まれない。
- タスク終了時に `git status --short` で `harness-docs/ARCHITECTURE.md` に差分が無いことを確認する。

---

## 1. 目的と背景

`## ADR 一覧` は「エントリを削除しない。覆した判断は `廃止` の状態で残す」という契約のもとで単調に伸び続ける節である。
現状、エントリ同士の境界は「空行 1 行 + `### ADR-NNN:` 見出し」だけで、視覚的な区切りが無い。
ユーザーは Markdown の水平線(`---`)で境界を引きたい。

素朴に `---` を挿入すると壊れる箇所が実測で 3 つ確認されている(context-map §5.1)。

- **(A) 状態変更の履歴行が次の ADR 側へ入る。** `contentEndIndex` は空行しか遡らないため、`---` の**後ろ**に splice される。
  パーサは見出しでしか切らないので**所属は前のエントリのまま**であり、**エラーにならず静かに壊れる**。これが最も重い。
- **(B) `entry.raw` に後続の `---` が混入する。** 最後のエントリだけ付かないため `get adr` の出力が非対称になる。
- **(C) `buildAdrAddition` の連結が `\n\n` 固定。** 追加した新エントリの前にだけ区切りが無い不揃いな文書になる。

加えて **(D) setext heading の罠**がある。非空行の直後の `---` は水平線ではなく H2 として描かれる。
区切り線の**直前に必ず空行**を置くことが必須であり、これが受け入れ基準 A6 の根拠である。

本改修は (A)〜(D) をまとめて塞ぎ、区切りの生成を `stage-adr` の 1 箇所(節全体の正規化)へ集約する。

---

## 2. 進め方の共通規律

- 各タスクは**テストを先に書いてから実装する**。
- `plugins/metatron/scripts/` と `dist/` は手で編集しない。`src/` を変更し `pnpm run build` で再生成する(制約 C2)。
- `harness-docs/ARCHITECTURE.md` と `.claude/rules/metatron/*.md` を Edit / Write / NotebookEdit で触らない(制約 C1)。本改修ではこれらの更新は**不要**である。
- **`stage-adr` / `commit-architecture` をリポジトリルートで実行しない**(制約 C3・§0.4)。
- ブランチを切らない。`git push` に force 系のフラグを付けない(制約 C5)。
- 作成・編集する文書の文面は通常の日本語で書く(制約 C4)。
- フェーズの境界では常に緑にする。赤が残ってよいのはタスクの内部だけである。
- **触ってはならない未コミット差分。** 着手時点で `docs/chat/` 配下に本改修と無関係の差分・未追跡ファイルがある。触らない。revert もしない。

---

## 3. 変更対象の一覧

| # | ファイル | 何を変えるか | 対応する要件 |
| --- | --- | --- | --- |
| 1 | `plugins/metatron/src/lib/adr.ts` | 区切りの定数と判定正規表現を追加。`contentEndIndex` の遡り条件を拡張。`entry.raw` の算出範囲を変更(**区切り線だけでなく、非最終エントリの末尾の空行も落ちる。§4 D5 / §10 残課題 6**)。`contentEndIndex` と `raw` の doc コメントを更新。`normalizeAdrSeparators` を新設し `applyAdrSection` から呼ぶ。コメントの契約節番号を `§5-x` → `§6-x` へ是正 | R1〜R5 / C6 |
| 2 | `plugins/metatron/src/lib/__test__/adr.test.ts` | 固定データ `THREE_ADRS_SEPARATED` を追加。既存 3 ケースへアサーションを追加。新規ケースを 9 本追加。コメントの節番号を是正 | A7 / A8 |
| 3 | `plugins/metatron/src/cli/__test__/cli.test.ts` | ADR を 2 件追加して区切りが入ることを見る E2E を 1 本**追加**(既存テストは変更しない) | A8 |
| 4 | `plugins/metatron/scripts/metatron.mjs` ほかバンドル出力 | `pnpm run build` で再生成した差分 | A2 |
| 5 | `harness-docs/design/2026-08-16-file-contract-freeze.md` §6-1 / §6-2 | 区切りの規定を追加。履歴行の追記位置を「区切り線より前」と明記 | R6 |
| 6 | `plugins/metatron/references/architecture-format.md` L94-97 | 指示層向けに区切りの 1 行を追加 | R6 |
| 7 | `harness-docs/design/2026-08-16-metatron-design.md` §6-6(L879-902) | 書式の写しへ区切りの 1〜2 行を追加 | U1 |
| 8 | `plugins/metatron/docs/format-change-checklist.md` | 「ADR の書式」の節を新設。既存の「ARCHITECTURE の書式」節に ADR は §6 を見る旨の 1 行を追加 | R7 |
| 9 | `plugins/metatron/docs/ARCHITECTURE.example.md` | ADR-002 を追加し、ADR-001 との間に区切りの見本を置く。記入ガイドに 1 行追加 | R8 |
| 10 | `plugins/metatron/.claude-plugin/plugin.json` / `plugins/metatron/package.json` | `0.3.3-dev` → `0.3.4-dev` | R9 |
| — | `README.md` | **変更しない**(§0.3 のとおり、バージョンも ADR の書式も載っていない) | A9 |
| — | `plugins/metatron/src/lib/architecture.ts` | **変更しない。** `HEADING_RE` / `FENCE_OPEN_RE` は `---` で壊れないことを確認済み。分解器の実装を 2 つ作らない(`adr.ts` L12-14 の規律) | — |
| — | `plugins/metatron/src/cli/get.ts` / `stage.ts` / `commit.ts` / `inject-context.ts` | **変更しない。** `raw` をそのまま載せる・要約 1 行に落とすだけで、区切りの扱いを持たない | — |

---

## 4. 実装上の判断ポイント(選択肢と推奨)

### D1. 正規化関数をどこに置くか

| 案 | 内容 | 評価 |
| --- | --- | --- |
| (a) `buildAdrAddition` と `buildAdrStatusChange` の**両方**で明示的に呼ぶ | 呼び出し位置が読んで分かる | **不採用。** 連結点が 2 箇所に分かれる。§1 の (A)(C) は「2 箇所が別々の整形を持っていた」ことが原因であり、同じ構造を再生産する |
| (b) `applyAdrSection` の内側で呼ぶ | `stage-adr` の 2 経路が必ず通る隘路。R2(毎回正規化)が構造で保証される | **推奨** |
| (c) `architecture.ts` の `normalizeBody` に入れる | ADR 以外の節にも効いてしまう | 不採用 |
| (d) `applySectionChanges` 側で `heading === ADR_HEADING` のときだけ正規化する | ADR の規則が `architecture.ts` へ漏れる | 不採用。`architecture.ts` に手を入れない規律(`adr.ts` L12-14)を優先する |

**推奨 (b)。** `applyAdrSection`(`adr.ts` L612-634)の `applySectionChanges` 呼び出しの直前で `normalizeAdrSeparators(body)` を挟む。
関数自体は `export` して単体テストから直接叩けるようにする。
`applyAdrSection` に「区切りの正規化もここで行う」旨のコメントを 1 行足し、責務が隠れないようにする。

**「隘路」の範囲を厳密に言う。** `applySectionChanges` は `architecture.ts` から `export` されており、
低位 API を直接呼べば ADR 節を正規化なしで書ける(`architecture.test.ts` L441-464 が実際にそうしている)。
したがって (b) が保証するのは「**`stage-adr` の追加経路と状態変更経路においては** `applyAdrSection` が唯一の通り道である」ことに限られる。
本番の CLI 経路はこの 2 つしか無いため判断は成立するが、コメントと説明では範囲を書き切る。

### D2. 正規化関数の入出力と組み立て方

**入力は `## ADR 一覧` の節本文、出力は正規化した節本文。純関数。**

- 行の取得は `scanFences` の `lines[i].text`(改行コードを含まない形)を使い、`"\n"` で連結する。
  改行コードは下流の `architecture.ts` `normalizeBody`(L681-686)が文書の EOL へ戻すため、ここで CRLF を扱う必要はない。
- エントリの刻み目の検出は**自前で書かず `parseEntries` を再利用**する(`startIndex` / `contentEndIndex` をそのまま使う)。
  `scanFences` が 2 回走るが、対象は 1 節ぶんであり無視できる。**同じ規則の実装を 2 つ作らないことを優先する。**
- 最初のエントリより前(記入ガイドのコメント等)は**前書き**として保存し、1 件目との間は空行だけで繋ぐ(区切りを置かない = R1)。
  前書きの末尾に付いた空行・区切り線は落とす。
- エントリが 0 件なら入力をそのまま返す。

### D3. `contentEndIndex` の遡り条件をどう書くか

現行(`parseEntries` L214-220):

```ts
let contentEndIndex = endIndex
while (
  contentEndIndex > startIndex + 1 &&
  lines[contentEndIndex - 1].text.trim() === ""
) {
  contentEndIndex--
}
```

**推奨。** 判定を述語関数へ括り出し、「空行 または 区切り線」に広げる。**フェンス内は対象外**にする。

```ts
// 末尾の埋め物(空行と区切り線)。フェンスの中は本文なので対象にしない。
function isTrailingFiller(text: string, insideFence: boolean): boolean {
  if (insideFence) return false
  return text.trim() === "" || ADR_SEPARATOR_LINE_RE.test(text)
}
```

- `insideFence` の判定は現行の遡りループには無い。フェンスの閉じ行が最終行になるため実害は出にくいが、**防御として入れる**。述語は `normalizeAdrSeparators` の前書きの刈り取りからも使うので、括り出す価値がある。
- ループの下限 `contentEndIndex > startIndex + 1` は**変えない**。見出しだけのエントリで `contentEndIndex` が `startIndex` を割らないための番人である。

### D4. 区切り線として認識する範囲

**推奨: `/^ {0,3}-{3,}[ \t]*$/` のみ。**

- `***` / `___` の水平線は**対象にしない**。metatron が生成するのは `---` だけであり、認識範囲を広げると「本文として書かれた区切り」を落とす確率が上がる。
- 表の区切り行(`| --- | --- |`)は `|` で始まるので一致しない。
- 先頭 3 スペースまで許すのは、`ENTRY_HEADING_RE` ほか既存の正規表現と同じ CommonMark 由来の規約に合わせるためである。

### D5. `entry.raw` の算出をどう変えるか

| 案 | 内容 | 評価 |
| --- | --- | --- |
| (a) `joinRaw(lines, startIndex, contentEndIndex)` | 末尾の空行と区切り線をまとめて外す | **推奨** |
| (b) `endIndex` までを取り、`---` の行だけ後から除く | 末尾の空行の有無が最後のエントリだけ違うまま残り、対称にならない | 不採用 |

**推奨 (a)。** すべてのエントリが「見出しから本文の最終行まで」で揃い、A4(全エントリで対称)を満たす。

**副作用を明示する。** (a) が落とすのは区切り線だけではない。
**非最終エントリが持っていた「次の見出しの直前の空行」も `raw` から落ちる。**
`get adr` の `entries[].raw` は、**文書を一切書き換えなくてもこの変更だけで値が変わる**。
`raw` を消費する外部の実装は本リポジトリに無い(context-map §1 で `plugins/**/*.ts` を走査済み)が、出力契約の変更であることを §10 残課題 6 に記録する。

**「最後のエントリは元から `contentEndIndex` まで」は書き込み結果についてのみ正しい。**
読み取り経路で `parseAdrDocument` が受け取る節本文は `ArchitectureSection.body` であり、これは
「見出し行を除く本文。原文のまま(**末尾の空行を含む**)」(`architecture.ts` L185-186)である。
末尾を trim するのは `normalizeBody`(L681-686)で、これは**書き込み時の再結合でしか通らない**。
したがって「最後のエントリも `contentEndIndex` で切られる」という対称化は、(a) を入れて初めてすべての入力で成立する。

あわせて doc コメントを 2 つ書き換える。

- `AdrEntry.contentEndIndex`(L146「末尾の空行を除いた終端(この行は含まない)。追記位置でもある。」)
  → **「末尾の空行と区切り線を除いた終端(この行は含まない)。追記位置でもある。」**
- `AdrEntry.raw`(L150-151「見出しを含むエントリ全体の原文。」)
  → **「見出しから本文の最終行までの原文。末尾の空行と区切り線は含まない。」**

定義を変えたのにコメントが残ると次の実装者が誤読する。

### D6. 固定データ `THREE_ADRS` を区切り入りに差し替えるか

**推奨: 差し替えない。** `THREE_ADRS`(区切りが**無い**文書)は、A5(区切りが無い既存文書の正規化)と後方互換を見る入力として引き続き要る。
区切り入りの入力が要るケースのために **`THREE_ADRS_SEPARATED` を新設**する(§6.4)。

### D7. コード内コメントの契約節番号のずれ(制約 C6)

実測した対応は次のとおり。

| コメントの表記 | 実際の節 | 件数 | 判断 |
| --- | --- | --- | --- |
| `契約 §5-1` / `§5-2` / `§5-3` | §6-1 / §6-2 / §6-3(ADR の書式) | **`adr.ts` に 21 件(18 行)、`adr.test.ts` に 6 件(5 行)**(§0.3 の実測) | **今回是正する** |
| `契約 §4-1` / `§4-2` / `§4-3` | §4(ARCHITECTURE の書式)= 正しい | — | 変更しない |
| `契約 §11` | §12(CLI の入出力規約)= ずれている | `adr.ts` に 3(L337 / L789 / L812)、`adr.test.ts` に 4、`get.ts` に 2 | **今回は直さない。§11 は残課題 2 へ回す** |

**是正する理由。** 本改修は §6-1 / §6-2 を改訂し、新しいコメントから §6-1 を参照する。
1 つのファイルの中に「§6-1 を指す正しい表記」と「§6-1 を §5-1 と呼ぶ表記」が同居すると、次の実装者が契約文書を引けなくなる。
`adr.ts` の先頭コメント(L4-6)は既に §6 / §4 / §12 と正しく書かれており、**是正は先頭コメントへ寄せる作業**である。

**§11 を直さない理由。** §11 のずれは `get.ts` など ADR 以外のファイルへも広がっており、
「ADR の書式を変える」という本改修の主題から外れる。混ぜるとコミットの意味が濁る。

---

## 5. WBS

フェーズ境界では必ず緑にする。`→` は直列、同じ括弧内は並行可。

### フェーズ 0: 準備(直列 1 件)

#### T0. baseline の取得

- 対象ファイル: 無し(記録のみ)
- 変更内容: `git rev-parse HEAD` / `git status --short` / `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` を実行し、§0.2 の記入欄を埋める。
- 完了条件: 3 つとも緑であり、テスト数が §0.3 の実測(157 ファイル / 2242 テスト)以上である。未コミット差分の一覧を記録した。

### フェーズ 1: 実装層(直列。TDD。T1 → T2 → T3 → T4 → T5)

#### T1. テストを先に書いて赤にする

- 対象ファイル: `plugins/metatron/src/lib/__test__/adr.test.ts`
- 変更内容: §6.4 の `THREE_ADRS_SEPARATED` と §7.4 のヘルパを追加し、§7.2 の新規ケース **N1〜N9 と N11** を書く
  (**N10 は `cli.test.ts` のケースであり T6 が書く**)。
  **先に T2・T3 の公開シグネチャ(§6.1 / §6.2)を確定させてから書く。**
- 完了条件: `pnpm exec vitest run plugins/metatron/src/lib/__test__/adr.test.ts` が**赤**であり、赤の原因が
  (1) `normalizeAdrSeparators` の import 解決失敗、(2) アサーション不成立、の 2 つに限られること。
  構文エラー・固定データの取り違え・既存ケースの巻き添えではない。
- 依存: T0
- 備考: **この時点では `adr.test.ts` がファイルごと落ちる。** N5 / N6 / N7 / N9 / N11 が `normalizeAdrSeparators` を import するが、実装は T3 だからである。
  **T2 でスタブを置いた時点で import 解決失敗は消え、以後は個々のアサーションの赤だけが残る。** T2 の完了条件(N3 / N4 が緑)を観測できるのはその後である。

#### T2. 区切りの定数・判定と、解析側の変更(R3 / R4 / R5)

- 対象ファイル: `plugins/metatron/src/lib/adr.ts`
- 変更内容:
  1. `ADR_SEPARATOR` / `ADR_SEPARATOR_BLOCK` / `ADR_SEPARATOR_LINE_RE` を §6.1 のとおり定義する(`STATUS_CHANGE_RE` の近く、L83 付近)。
  2. **`normalizeAdrSeparators` のスタブを置く。**
     `export function normalizeAdrSeparators(body: string): string { return body }`
     本実装は T3 が差し替える。**スタブを置く目的は、T1 が書いたテストの import を解決して「ファイルごと落ちる」状態を解消し、
     T2 の完了条件(N3 / N4 が緑)を観測できるようにすることである。** 呼び出し側への接続は T3 まで行わない。
  3. `isTrailingFiller` を追加し、`parseEntries` の `contentEndIndex` の遡りを差し替える(L214-220)。
  4. `raw` の算出を `joinRaw(lines, startIndex, contentEndIndex)` へ変える(L277)。
  5. `AdrEntry.contentEndIndex`(L146)と `AdrEntry.raw`(L150-151)の doc コメントを D5 のとおり書き換える。**2 つとも対象である。**
  6. `ENTRY_HEADING_RE` は**変更しない**。刻み目は見出しのまま据え置く(R3)。
- 完了条件: `adr.test.ts` の import が解決し、N3(本文中の `---` でエントリが切れない)と N4(`raw` に区切りの行が無い)が緑。`pnpm run typecheck` が緑。
  スタブのままなので N1 / N2 / N5 / N6 / N7 / N8 / N9 / N11 は赤のままでよい。
- 依存: T1

#### T3. `normalizeAdrSeparators` の実装と組み込み(R1 / R2)

- 対象ファイル: `plugins/metatron/src/lib/adr.ts`
- 変更内容:
  1. **T2 が置いたスタブ(`return body`)を §6.2 の本実装へ差し替える。** 新規に関数を足すのではない。シグネチャは変えない。
  2. `applyAdrSection`(L612-634)の `applySectionChanges` へ渡す body を `normalizeAdrSeparators(body)` にする。責務と隘路の範囲(D1)を明示するコメントを足す。
  3. `buildAdrAddition` の連結(L664)は `\n\n` のまま**据え置く**。区切りは正規化が入れる。
  4. `buildAdrStatusChange` の splice(L766-774)は**据え置く**。T2 で `contentEndIndex` が区切り線の手前を指すようになるため、コードは変えずに直る。
     `continues` の判定(直前が履歴行なら空行を挟まない)も現行のままでよい。
- 完了条件: N1・N2・N5・N6・N7・N8・N9・N11 が緑。`adr.test.ts` が全件緑。
- 依存: T2

#### T4. 既存テストへのアサーション追加(A7)

- 対象ファイル: `plugins/metatron/src/lib/__test__/adr.test.ts`
- 変更内容: §7.1 の U1・U2・U3 を適用する(**U4 は「更新不要」に整理済み。N8 を新規に足すことで代替する**)。
  **期待値の作り替えではなく、区切りの位置を固定するアサーションの追加・延長が主である。**
- 完了条件: `adr.test.ts` が全件緑で、R-A2 / R-A5 / R-A8 の 3 ケースが区切りの位置と `raw` の対称性を見ている。
- 依存: T3

#### T5. 契約節番号の是正(C6 / D7)

- 対象ファイル: `plugins/metatron/src/lib/adr.ts`、`plugins/metatron/src/lib/__test__/adr.test.ts`
- 変更内容: `契約 §5-1` → `契約 §6-1`、`§5-2` → `§6-2`、`§5-3` → `§6-3` をコメントとエラーメッセージで置換する
  (**`adr.ts` 21 件 / 18 行、`adr.test.ts` 6 件 / 5 行**。1 行に 2 つ並ぶ箇所があるため行数と件数が一致しない)。**`§4-x` と `§11` は触らない。**
  - `adr.ts` L731 のエラーメッセージ本文(`契約 §5-1 の書式に直してから…`)も対象である。
    **この文字列を期待値にしているテストは無いことを確認済み**(§0.3。テストは `code: "invalid_entry"` だけを見ている)。
- 完了条件: `grep -n "§5-" plugins/metatron/src/lib/adr.ts plugins/metatron/src/lib/__test__/adr.test.ts` が 0 件。`pnpm run test` が緑。
- 依存: T4
- 備考: **独立したコミットにする。** 振る舞いを変えない機械的な置換であり、本改修の diff に混ぜると読めなくなる。

### フェーズ 2: CLI テスト(直列 1 件)

#### T6. CLI の E2E を 1 本追加

- 対象ファイル: `plugins/metatron/src/cli/__test__/cli.test.ts`
- 変更内容: §7.2 の N10(`stage-adr` → `commit-architecture` を 2 回通し、ADR-001 と ADR-002 の間に `\n\n---\n\n` が入ることと、`get adr` の `raw` に区切りの行が無いことを見る)を**新規に足す**。
  既存の L622-676 は ADR 1 件しか足さないため区切りが出ず、**変更しない**。
- 完了条件: `pnpm exec vitest run plugins/metatron/src/cli/__test__/cli.test.ts` が緑。
- 依存: T3(T4 / T5 とは並行可)

### フェーズ 3: バンドル(直列 1 件)

#### T7. `pnpm run build`

- 対象ファイル: `plugins/metatron/scripts/*.mjs`(生成物)
- 変更内容: `pnpm run build` を実行する。**手で編集しない。**
- 完了条件: `git status --short plugins/metatron/scripts/` に差分があり、`plugins/metatron/dist/` に手作業の差分が無い。`pnpm run test` が緑。
- 依存: T5 / T6

### フェーズ 4: 書式契約と文書(T8 → (T9 / T10 / T11 / T12 は並行 4))

#### T8. 契約凍結文書 §6-1 / §6-2(R6)

- 対象ファイル: `harness-docs/design/2026-08-16-file-contract-freeze.md`(L352-385)
- 変更内容: §6.5 の文面を §6-1 の箇条書き末尾と §6-2 の箇条書き末尾へ追加する。
- 完了条件: **§6-1 に区切りの 5 項目**、§6-2 に追記位置の 1 項目が入っている。§6-3 と §7 以降は無変更。
  5 項目目「エントリ本文の末尾に水平線を置かない」は **N9 の契約上の根拠**であり、落とすとテストの拠り所が無くなる。
- 依存: T0(実装と並行して進めてよいが、T9〜T12 は本タスクの文面に倣うため先に確定させる)
- 備考: この文書は `harness-docs/` 配下だが **metatron の保護対象ではない**(hook が拒否するのは `ARCHITECTURE.md` / `GOTCHAS.md` / `.claude/rules/metatron/*.md`)。Edit で直接編集してよい。

#### T9. 指示層の書式契約(R6)

- 対象ファイル: `plugins/metatron/references/architecture-format.md`(L94-97)
- 変更内容: `## ADR 一覧` の箇条書きへ §6.6 の 1 行を追加する。
- 完了条件: 4 項目になっており、既存 3 行が無変更である。
- 依存: T8

#### T10. 記入例(R8)

- 対象ファイル: `plugins/metatron/docs/ARCHITECTURE.example.md`(L135-173)
- 変更内容: 記入ガイドのコメントへ区切りの 1 行を足し、ADR-001 の後に `---` を挟んで ADR-002 を追加する(§6.7)。
  ADR-001 は末尾に `- 状態変更(2026-06-02): …` を持つため、**「履歴行 → 空行 → `---` → 空行 → 次の見出し」という A3 の見本を兼ねる**。
- 完了条件: 記入例が 2 件になり、その間に前後を空行で挟んだ `---` が 1 本だけある。先頭の前・末尾の後に `---` が無い。
- 依存: T8

#### T11. metatron 設計書 §6-6 の書式の写し(U1)

- 対象ファイル: `harness-docs/design/2026-08-16-metatron-design.md` §6-6(L879-902)
- 変更内容: `## ADR 一覧の書式` の箇条書き(L902 の `- 採番 ADR-NNN は CLI が既存最大値 + 1 で行う(§7-4)。` の周辺)へ、
  §6-1 へ足したのと同じ趣旨の 1〜2 行を追加する。文面案は §6.8。
- 完了条件: §6-6 の箇条書きに区切りの規定があり、契約凍結文書 §6-1 の記述と矛盾しない。§6-6 の雛形ブロック(L886 付近)と §6-3 相当の記述は無変更。
- 依存: T8
- 備考: この文書も metatron の保護対象ではない。Edit で直接編集してよい。

#### T12. 追随先チェックリスト(R7)

- 対象ファイル: `plugins/metatron/docs/format-change-checklist.md`
- 変更内容: §6.9 のとおり「ADR の書式」の節を新設し、既存の「ARCHITECTURE の書式」節(L6-12)へ「ADR は §4 ではなく『ADR の書式』の節を見る」旨の 1 行を足す。
- 完了条件: ADR 専用の節があり、**§6.9 の一覧と項目が一致している**。
  `cli.test.ts` は入れない。書式契約の追随先として E2E のテストファイルは不要である(この一覧は「書式を変えたとき次に何を直すか」を並べるものであり、テストの網羅表ではない)。
- 依存: T8

### フェーズ 5: バージョン(直列 1 件)

#### T13. `0.3.4-dev` へ上げる(R9)

- 対象ファイル: `plugins/metatron/.claude-plugin/plugin.json`、`plugins/metatron/package.json`
- 変更内容: `version` を `0.3.3-dev` → `0.3.4-dev`。
- 完了条件: 2 ファイルの値がともに `0.3.4-dev` で一致している。`README.md` は変更していない(§0.3 の A9 の判断)。
- 依存: T7

### フェーズ 6: 統合検証とコミット(直列。T14 → T15)

#### T14. 通し検証

- 対象ファイル: 無し(実行のみ)
- 変更内容:
  1. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` / `pnpm run build` を通す。
  2. `git status --short plugins/metatron/scripts/` で再ビルド差分が残っていないことを確認する。
  3. **【必須】** §0.4 の隔離手順で `$TMP/docs/ARCHITECTURE.md` を作り、`stage-adr` を 2 回(追加 → 追加)、続けて状態変更を 1 回通して、
     区切りの位置と履歴行の位置を目視する。**確認するのは次の 3 点。**
     - 区切りの直前と直後に空行があり、Markdown プレビューで**水平線として描かれる**(setext heading になっていない)。テキスト比較では見えない性質であり、これが手動検証を必須にしている理由である。
     - 状態変更の履歴行が、区切り線の**手前**(前エントリの本文末尾)にある。
     - 節の先頭の前と末尾の後に区切りが無い。
  4. `git status --short` で `harness-docs/ARCHITECTURE.md` と `.claude/rules/metatron/` に差分が無いことを確認する。
- 完了条件: §9 の Done 条件チェックリストが全項目 ✅。
- 依存: T13

#### T15. コミット

- 対象ファイル: 無し(git 操作)
- 変更内容: 次の単位で分けてコミットする。
  1. `feat(metatron): ADR エントリ間に水平線の区切りを入れる` — `src/lib/adr.ts` + `src/lib/__test__/adr.test.ts` + `src/cli/__test__/cli.test.ts` + `scripts/`(T2 / T3 / T4 / T6 / T7)
  2. `chore(metatron): adr.ts の契約節番号のずれを直す` — T5
  3. `docs(metatron): ADR の区切りを書式契約と記入例へ反映する` — T8 / T9 / T10 / T11 / T12
  4. `chore(metatron): 0.3.4-dev` — T13
- 完了条件: 4 コミットに分かれ、`plugins/metatron/scripts/` の差分が 1 番目に含まれている。無関係の未コミット差分を巻き込んでいない。
- 依存: T14

### 依存関係の要約

```
T0 → T1 → T2 → T3 → T4 → T5 ┐
                  └→ T6 ────┴→ T7 → T13 → T14 → T15
T0 → T8 → (T9 ∥ T10 ∥ T11 ∥ T12) ─────────────┘
```

- **並行できるのは 2 つだけ。** (1) T8 以降の文書系は T1〜T7 の実装系と並行して進められる。(2) T9 / T10 / T11 / T12 は互いに別ファイルなので同時に進められる。
- T6 は T3 完了後なら T4 / T5 と並行できる。
- T1 → T2 → T3 の直列は崩せない。T2 のスタブが無いと T1 のテストは import 解決で落ち、T3 の本実装が無いと正規化系のケースは緑にならない。

---

## 6. タスク間で共有する契約

### 6.1 `adr.ts` へ足す定数と述語(T2 が実装。T3 が使う)

```ts
/**
 * 契約 §6-1。ADR エントリ同士の境界に置く水平線。
 *
 * 前後に必ず空行を伴う。非空行の直後の `---` は水平線ではなく
 * setext heading(H2)として描かれるためである。パーサはこの行を
 * 境界として扱わない(刻み目は `### ADR-NNN:` 見出しだけ)。
 */
export const ADR_SEPARATOR = "---"

/** エントリ間の接着剤。前後の空行を含む。 */
const ADR_SEPARATOR_BLOCK = `\n\n${ADR_SEPARATOR}\n\n`

// 区切り線とみなす行。ハイフンだけの行に限る。
// 表の区切り(`| --- |`)は `|` で始まるので一致しない。
// `***` / `___` は metatron が生成しないため対象にしない。
const ADR_SEPARATOR_LINE_RE = /^ {0,3}-{3,}[ \t]*$/

// 末尾の埋め物(空行と区切り線)。フェンスの中は本文なので対象にしない。
function isTrailingFiller(text: string, insideFence: boolean): boolean {
  if (insideFence) return false
  return text.trim() === "" || ADR_SEPARATOR_LINE_RE.test(text)
}
```

### 6.2 `normalizeAdrSeparators` の全文(T3 が実装)

```ts
/**
 * `## ADR 一覧` の節本文を受け取り、エントリ間の区切りを正規化して返す(純関数)。
 *
 * - エントリの**間**にだけ `\n\n---\n\n` を 1 つずつ置く(契約 §6-1)。
 *   最初のエントリの前と最後のエントリの後には置かない。
 * - 区切りが無い文書も、重複・欠落した文書も、1 回の実行で揃う。
 * - エントリ本文は変えない。改行コードは `\n` に寄せるが、節の再結合時に
 *   architecture.ts の normalizeBody が文書の EOL へ戻す。
 * - エントリが 0 件なら本文をそのまま返す。
 */
export function normalizeAdrSeparators(body: string): string {
  const entries = parseEntries(body)
  if (entries.length === 0) return body

  const scan = scanFences(body)
  const textOf = (from: number, to: number): string =>
    scan.lines
      .slice(from, to)
      .map((line) => line.text)
      .join("\n")

  // 最初のエントリより前(記入ガイド等)。末尾の空行と区切り線は落とす。
  let prologueEnd = entries[0].startIndex
  while (
    prologueEnd > 0 &&
    isTrailingFiller(
      scan.lines[prologueEnd - 1].text,
      scan.insideFence[prologueEnd - 1]
    )
  ) {
    prologueEnd--
  }
  const prologue = textOf(0, prologueEnd)

  const blocks = entries.map((entry) =>
    textOf(entry.startIndex, entry.contentEndIndex)
  )
  const joined = blocks.join(ADR_SEPARATOR_BLOCK)
  return prologue === "" ? joined : `${prologue}\n\n${joined}`
}
```

**実装上の注意。**

- `parseEntries` と `scanFences` で走査が 2 回になるが、対象は 1 節ぶんである。**刻み目の検出を自前で書き直さないことを優先する**(`adr.ts` L12-14 の規律)。
- 未閉フェンスのある文書では `scanFences` の結果が信用できないが、`buildAdrAddition` / `buildAdrStatusChange` はどちらもこの関数に到達する前に `unclosed_fence` で例外を投げる。**この関数に未閉フェンスのガードを重ねて置かない**(拒否の責務を 2 箇所に分けない)。

### 6.3 `applyAdrSection` への組み込み(T3 が実装)

```ts
  // 節の差し替えは architecture.ts に委ねる。対象セクション以外はバイト単位で
  // 不変であること、節が無ければ契約 §4-1 の順序で追加されることが保証される。
  // 区切りの正規化はここで行う。`stage-adr` の追加経路と状態変更経路は、どちらも
  // 必ずこの関数を通る(低位の applySectionChanges を直接呼べば通らないが、
  // CLI の経路はこの 2 つしか無い)。2 箇所に分けると整形が食い違う(契約 §6-1)。
  const result = applySectionChanges(current, [
    { heading: ADR_HEADING, body: normalizeAdrSeparators(body) }
  ])
```

### 6.4 テストの固定データ `THREE_ADRS_SEPARATED`(T1 が追加)

`THREE_ADRS` と**同じ内容で、エントリ間に区切りが入ったもの**を別定数として置く。
`THREE_ADRS` は据え置く(D6)。

```ts
// THREE_ADRS と同じ 3 件。エントリ間に契約 §6-1 の区切りが入った形。
const THREE_ADRS_SEPARATED = THREE_ADRS.replace(
  /\n\n(### ADR-00[23]:)/g,
  "\n\n---\n\n$1"
)
```

- 置換で作ると `THREE_ADRS` との差が「区切りだけ」であることが読んで分かる。
- 置換が 2 箇所に効いたことを `expect(THREE_ADRS_SEPARATED.match(/^---$/gm)).toHaveLength(2)` で 1 度だけ固定しておくと、固定データの取り違えに気づける。

### 6.5 契約凍結文書へ足す文面(T8 が適用)

**§6-1 の箇条書きの末尾へ追加**(L373 の次):

```markdown
- エントリ同士の境界に**水平線**を置く。各エントリの**間**に、前後を空行で挟んだ `---` の行を 1 つずつ置く。最初のエントリの前と最後のエントリの後には置かない。
- 直前に空行を置くことは必須である。非空行の直後の `---` は水平線ではなく setext heading(H2)として描かれる。
- 区切りは**装飾であり、エントリの境界の権威ではない**。刻み目は `### ADR-NNN:` 見出しだけである。本文中に `---` が現れてもエントリは分割されない。
- 区切りは `stage-adr` が `## ADR 一覧` 節**全体**に対して毎回正規化する。区切りが無い文書も、重複・欠落した文書も、実行のたびに揃う。手で足さない。
- **エントリ本文の末尾に水平線を置かない。** 末尾の水平線は区切りと区別できず、正規化で落ちる。
```

**§6-2 の箇条書きの末尾へ追加**(L385 の次):

```markdown
- 追記位置は**エントリ末尾の非空行の直後**である。末尾の空行と区切り線より**前**に入る。区切り線の後ろに置くと、次のエントリの一部として読まれる。
```

### 6.6 `architecture-format.md` へ足す文面(T9 が適用)

`## ADR 一覧` の箇条書き(L95-97)の末尾へ 1 行:

```markdown
- エントリ同士の間には、前後を空行で挟んだ `---` の行が 1 つ入る。`stage-adr` が節全体を毎回揃えるため、手で足さない。
```

### 6.7 記入例へ足す内容(T10 が適用)

1. 記入ガイドのコメント(L137-142)の末尾へ 1 行:
   `エントリ同士の間の `---` は `stage-adr` が入れる。手で足さない。`
2. ADR-001 の最終行(L173 の状態変更行)の後に、空行 → `---` → 空行 → ADR-002 を続ける。
3. ADR-002 は契約 §6-3 の 3 条件(覆すコストが大きい / 選択肢が実在した / 理由が自明でない)を満たす例にする。
   例の題材は ADR-001(テナント分離)と同じ想定プロジェクト上で矛盾しないものを選ぶ。
   書式は §6-1 の雛形どおり(`- 状態:` / `- 決定日:` / `- 決定者:` / `#### 背景` / `#### 検討した選択肢` / `#### 採用した結論` / `#### 理由` / `#### 影響範囲`)。
4. **末尾に `---` を置かない。** 節の最後は ADR-002 の本文で終わる。

### 6.8 metatron 設計書 §6-6 へ足す文面(T11 が適用。U1 の確定内容)

`## ADR 一覧の書式`(L879-902)の箇条書きの末尾へ 1〜2 行:

```markdown
- エントリ同士の間には、前後を空行で挟んだ `---` の行が 1 つ入る(契約 §6-1)。最初のエントリの前と最後のエントリの後には置かない。
- 区切りは装飾であり、エントリの刻み目は `### ADR-NNN:` 見出しのままである。`stage-adr` が節全体を毎回正規化するため、手で足さない。
```

- **雛形のコードブロック(L886 付近)は変更しない。** 1 エントリの書式を示すものであり、エントリ間の話は箇条書き側に属する。
- 文面は契約凍結文書 §6-1(§6.5)と矛盾しない範囲に留める。**正本は凍結文書であり、設計書はその写しである。**

### 6.9 `format-change-checklist.md` へ足す節(T12 が適用)

既存の「ARCHITECTURE の書式」節(L6-12)の末尾へ 1 行:

```markdown
- [ ] ADR エントリの書式はこの節ではなく「ADR の書式」の節を見る(正本は契約 §4 ではなく §6)
```

「rules の書式」節の**前**に新しい節を挿入する:

```markdown
## ADR の書式(`references/architecture-format.md` の `## ADR 一覧`)

- [ ] `plugins/metatron/src/lib/adr.ts` の `ENTRY_HEADING_RE` / `STATUS_LINE_RE` / `STATUS_CHANGE_RE` / `ADR_SEPARATOR` / `ADR_SEPARATOR_LINE_RE` / `normalizeAdrSeparators` / `renderAdrEntryLines`
- [ ] 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の **§6**(ADR の正本は §4 ではない)
- [ ] `plugins/metatron/references/architecture-format.md` の `## ADR 一覧` の節
- [ ] `plugins/metatron/docs/ARCHITECTURE.example.md` の `## ADR 一覧`(記入例は 2 件以上を保ち、区切りの見本を含める)
- [ ] metatron 設計書 `harness-docs/design/2026-08-16-metatron-design.md` §6-6 の書式の写し
- [ ] `plugins/metatron/src/lib/__test__/adr.test.ts` の固定データ(`THREE_ADRS` / `THREE_ADRS_SEPARATED`)
- [ ] `plugins/metatron/scripts/` を `pnpm run build` で再生成する
```

- **この 7 項目が T12 の完了条件である。** `cli.test.ts` は入れない(§5 T12 の完了条件を見る)。
- 一覧の順序は「実装 → 正本の契約 → 指示層 → 例 → 設計書の写し → テストの固定データ → 再生成」とし、既存の 4 節と同じ並べ方に揃える。

---

## 7. テスト計画

配置は規約どおり `plugins/metatron/src/lib/__test__/adr.test.ts` と `plugins/metatron/src/cli/__test__/cli.test.ts`(制約 C8)。新規ファイルは作らない。

### 7.1 更新するテスト(T4)

| # | 場所 | 現状 | 何をなぜ更新するか |
| --- | --- | --- | --- |
| U1 | `adr.test.ts` L179-188<br>R-A2「既存エントリはバイト単位で不変」 | `entryRawById(result.text, "ADR-001")` と `entryRawById(THREE_ADRS, "ADR-001")` を比較 | **期待値は変えない。** 両辺とも新しい `raw` の定義(D5)で算出されるため、区切りが入っても一致する。ただし**一致する理由が「区切りが `raw` に入らないこと」だけ**なので、A4 を明示的に固定するアサーションを 1 行足す。**`not.toContain("---")` は使わない**(部分文字列一致であり、Markdown 表の `\| --- \| --- \|` や本文中の `---` に誤反応する)。§7.4 のヘルパ `hasSeparatorLine` を使い、**`ADR_SEPARATOR_LINE_RE` に一致する行が `raw` に無いこと**を見る |
| U2 | `adr.test.ts` L309-330<br>R-A5「エントリ末尾へ履歴行が追記される」 | `at < indexOf("### ADR-003:")` しか見ていない | **履歴行と区切り線の前後関係を足す。** 現行のアサーションは「区切り線の後ろ・次の見出しの前」に入る §1 (A) のバグを**通してしまう**。<br>**`indexOf("---")` を素で使ってはならない。** T3 の全節正規化により、入力が `THREE_ADRS`(区切り無し)でも結果文書には ADR-001/002 間と ADR-002/003 間の**両方**に区切りが入る。`result.text.indexOf("---")` が返すのは**最初の**区切り(ADR-001/002 間)であり、`at`(ADR-002 末尾の履歴行の位置)はその**後ろ**にある。したがって `at < result.text.indexOf("---")` は**常に false** になり、正しい実装を赤にする。<br>検索の起点を ADR-002 の見出しより後ろに置くこと:<br>`const sep = result.text.indexOf("---", result.text.indexOf("### ADR-002:"))`<br>`expect(at).toBeLessThan(sep)`<br>`expect(sep).toBeLessThan(result.text.indexOf("### ADR-003:"))`<br>入力は `THREE_ADRS` のままとし、区切り入り文書からの検証は N2 が担当する |
| U3 | `adr.test.ts` L397-417<br>R-A8「1 行目は本文と空行で区切られ、2 行目以降は履歴として連続する」 | `second.text` に対する `toContain`(完全一致ではなく部分文字列一致) | **期待値の文字列を末尾方向へ延長する。理由は「現行では破損を検出できないから」ではない。**<br>独立検証の結果、典型的な破損(履歴行が区切り線の後ろへ回る / 履歴 1 行目と 2 行目の間に区切りが入る)では、期待している文字列の**窓の内側に `---` が入り込む**ため、**現行のアサーションでも落ちる**。<br>延長する目的は **A6 の固定**である。現行は「区切りが正しい形(`\n\n---\n\n` = 前後を空行で挟む)で置かれていること」までは見ていない。期待値の末尾へ `"", "---", "", "### ADR-003: 3 番目の判断"` を足すと、履歴行の位置と区切りの形を同じアサーションで押さえられる。前半(`永続化層。` → 空行 → 履歴 2 行)は変えない |

**更新が不要と判断したもの(実装後に実行して確認する)。**

- `adr.test.ts` L54-97 `THREE_ADRS` — 据え置く(D6)。区切りが無い既存文書の入力として A5 の検証に要る。
- `adr.test.ts` L775-788 CRLF(旧 U4) — **更新不要に整理した。** 「区切りが無い CRLF 文書」の後方互換ケースとしてそのまま残し、区切り入り CRLF の検証は **N8 を新規に足すことで代替する**。既存ケースを書き換えると、区切り前後の CRLF と「区切りが無い文書の CRLF」のどちらを見ているのかが曖昧になる。
- `adr.test.ts` L332-347 R-A5「他のフィールドは不変」 — 差分の除去後に `before` と一致する構造は `raw` の定義変更後も保たれる見込み。
- `adr.test.ts` L665-669「`#### 背景` などの小見出しはエントリを切らない」 — `raw` の範囲が縮んでも `#### 影響範囲` は本文内にある。
- `adr.test.ts` L847-935 `stageAdr` の各ケース — `fs.readFileSync(file) === THREE_ADRS`(stage は書かない)の確認であり、整形に関わらない。
- `cli.test.ts` L622-676 — ADR を 1 件しか足さないため区切りが出ない。
- `architecture.test.ts` L417-496 — 低位 API の検証で `adr.ts` を通らない。
- `inject-context.test.ts` — ADR はタイトル + 状態に縮退するため区切りが現れない。
- `section-reference-inventory.test.ts` — 走査対象から metatron 自身を除外している(§0.3)。

> **いずれも「落ちない見込み」であって保証ではない。** T3 の直後に `pnpm run test` を全件流し、落ちたものがあれば
> 落ちた理由が本改修の意図どおりかを判定してから期待値へ触る。**緑にするために期待値を緩めない。**

### 7.2 追加するテスト(N1〜N9 / N11 は T1 が書き T3 で緑にする。N10 は T6 が書いて緑にする)

| # | ケース名(日本語) | 検証すること | 対応 |
| --- | --- | --- | --- |
| N1 | 区切りが無い文書へ追加すると、既存エントリの間にも区切りが入る | `buildAdrAddition(THREE_ADRS, …)` の結果で、**`\n\n---\n\n` が期待する位置に 3 箇所現れる**(001/002 間・002/003 間・003/004 間)。`\n\n---\n\n` を含む形で位置を確かめること。**本数だけを数えるアサーション(`match(/^---$/gm)` の長さ)で済ませない。** `\n---\n`(直前の空行が無く setext H2 になる形)でも本数は 3 になり、F3 を素通りさせてしまう。あわせて節の先頭の前と末尾の後に区切りの行が無いことを見る | R2 / A5 / A6 |
| N2 | 区切り入りの文書で状態変更すると、履歴行が区切り線の手前に入る | `buildAdrStatusChange(THREE_ADRS_SEPARATED, {id:"ADR-002",…})` の結果が `永続化層。` → 空行 → 履歴行 → 空行 → `---` → 空行 → `### ADR-003:` の順で並ぶ(この並びを 1 つの文字列として `toContain` で見る)。`parseAdrDocument` で ADR-002 の `statusChanges` が 1 件、ADR-003 が 0 件 | R4 / A3 |
| N3 | ADR 本文中の `---` があってもエントリが切れない | 本文の途中(見出しと見出しの間、かつ末尾ではない位置)に `---` を持つ 2 件の文書で `entries` が 2 件。追加・状態変更を通しても本文中の `---` が残る。コードフェンス内の `---` も残る | R3 |
| N4 | `raw` に区切りが含まれず、全エントリで対称である | `THREE_ADRS_SEPARATED` の全エントリについて、**`ADR_SEPARATOR_LINE_RE` に一致する行が `raw` に無い**(§7.4 の `hasSeparatorLine` を使う。`not.toContain("---")` は使わない)。どの `raw` も本文の最終行 + 改行で終わり、最後のエントリと同じ形をしている | R5 / A4 |
| N5 | 正規化は冪等で、崩れた区切りも 1 回で揃う | **入力は `## ADR 一覧` の節本文である**(文書全文ではない。`THREE_ADRS` をそのまま渡すと `# ARCHITECTURE` 以下がすべて前書き扱いになり、API を誤解したまま冪等性だけが通る)。`parseAdrDocument(…).sectionBody` から取るか、節本文の文字列を直接組み立てる。<br>冪等性は **`normalizeAdrSeparators` の戻り値の文字列そのもの**で見る(`normalizeAdrSeparators(normalizeAdrSeparators(x)) === normalizeAdrSeparators(x)`)。区切りが重複した本文(`---` が 2 本連続)・一部にだけ区切りがある本文・区切りが無い本文のいずれも、1 回で同じ形になる | R2 |
| N6 | エントリが 1 件以下・見出しだけでも区切りが出ない | `EMPTY_ADR_SECTION` への追加(区切りの行が 0 本)。1 件だけの文書への状態変更(0 本)。`normalizeAdrSeparators("")` が `""`。<br>**見出しだけのエントリ**(`### ADR-001: 判断` の 1 行のみ、本文なし)を 2 件並べた本文を通しても、`raw` が空にならず見出し行が残り、エントリ間に区切りが 1 本入る。これが `contentEndIndex > startIndex + 1` の下限ガード(D3 / F4)の回帰検出である | R1 / エッジ |
| N7 | 前書きのある節で、前書きと 1 件目の間に区切りが出ない | (a) 節の先頭に記入ガイドの HTML コメントを持つ文書へ 1 件追加しても、コメントと `### ADR-001:` の間に区切りが入らない。既に 2 件ある場合はエントリ間にだけ入る。<br>(b) **前書きと 1 件目の間に手で `---` が入っている本文を通すと、その区切りが落ちる**(D2 の前書きの刈り取り)。残ると見た目は「最初のエントリの前に区切りがある」状態になり R1 に反する | R1 |
| N8 | CRLF の文書でも区切りの改行が揃う | `THREE_ADRS_SEPARATED` の CRLF 版で状態変更を通し、結果に `\r\n\r\n---\r\n\r\n` があり `/[^\r]\n/` に一致しない | エッジ |
| N9 | エントリ本文の末尾に書かれた水平線は正規化で落ちる | (a) 2 件以上あるとき、末尾が `---` のエントリの区切りが**1 本に畳まれる**(重複しない)。<br>(b) **1 件だけの文書で末尾に `---` があると、区切りの行が 0 本になる**(畳まれるのではなく消える)。これが R1 の「最後のエントリの後には置かない」を最終エントリについて固定する唯一のケースである。<br>契約 §6-1 の 5 項目目「本文末尾に水平線を置かない」の裏返しを固定する | D3 / D4 / R1 |
| N10 | `cli.test.ts`: ADR を 2 件足すと区切りが入る | `stage-adr` → `commit-architecture` を 2 回通し、ファイル上で ADR-001 と ADR-002 の間に `\n\n---\n\n` が 1 箇所ある。`get adr` の `entries[].raw` に区切りの行が無い。他セクションがバイト単位で不変 | R2 / A4 / E2E |
| N11 | `***` / `___` / `- - -` は区切りとして扱わない | これら 3 種の thematic break をエントリ本文の末尾に持つ文書を通しても、**落とされず本文として残る**(D4 の非対象を固定する)。無いと、後の実装者が「CommonMark に合わせて広げた」ときに §10 残課題 4 の判断が静かに覆る | D4 |

### 7.3 テストの実行

```bash
# タスク内
pnpm exec vitest run plugins/metatron/src/lib/__test__/adr.test.ts
pnpm exec vitest run plugins/metatron/src/cli/__test__/cli.test.ts

# フェーズ境界
pnpm run lint && pnpm run typecheck && pnpm run test
```

### 7.4 テストで共有するヘルパ(T1 が追加)

「区切りの行があるか」を見るときは、**部分文字列一致を使わない**。
`"---"` は Markdown 表の区切り(`| --- | --- |`)や本文中の文字列にも現れるため、
`not.toContain("---")` は誤って落ちる。D4 が行頭アンカー付きの正規表現を定義しているのだから、テストもそれに合わせる。

```ts
// 区切り「行」があるか。D4 の ADR_SEPARATOR_LINE_RE と同じ規則で判定する。
// 正規表現を adr.ts から export しない方針なら、テスト側に同じものを置いて
// 「D4 と同じ規則である」旨のコメントを添える。
function separatorLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => /^ {0,3}-{3,}[ \t]*$/.test(line))
}

function hasSeparatorLine(text: string): boolean {
  return separatorLines(text).length > 0
}
```

- 本数を数えるときも `separatorLines(...).length` を使う。
- ただし **N1 と N10 は本数だけで済ませない**。`\n\n---\n\n` を含む形で位置と前後の空行(A6)を見る。

---

## 8. 想定される失敗と対策

| # | 失敗 | 兆候 | 対策 |
| --- | --- | --- | --- |
| F1 | 履歴行が区切り線の後ろへ入ったまま気づかない | **テストが緑のまま通る。** パーサは見出しでしか切らないので所属は変わらず、エラーも警告も出ない | N2 と U3 で「区切り線との前後関係」を必ず見る。位置を見ないアサーション(`indexOf(次の見出し)` だけ)を新規に書かない |
| F2 | 正規化を `buildAdrAddition` 側だけに入れる | 追加では揃うが状態変更では揃わない。片方の経路でだけ区切りが増える | D1 (b) のとおり `applyAdrSection` に置く。実装後に `grep -n "normalizeAdrSeparators" src/lib/adr.ts` が定義 1 + 呼び出し 1 であることを確認する |
| F3 | 区切りの直前の空行が落ちる | Markdown プレビューで水平線ではなく大きな見出し(setext H2)として描かれる。**テキスト上は正しく見える。本数を数えるテストも通る** | `ADR_SEPARATOR_BLOCK` を唯一の連結子にする。N1 / N10 で `\n\n---\n\n` を含む形で位置を見る(本数だけで済ませない)。T14 の手動検証でプレビューを目視する |
| F4 | `contentEndIndex` の下限ガードを外して見出しだけのエントリが壊れる | `raw` が空になる。`startIndex` を割り込む | ループ条件 `contentEndIndex > startIndex + 1` を変えない。**N6 に見出しだけのエントリのケースを必ず含める**(§7.2 N6) |
| F5 | CRLF の文書に LF が混入する | `not.toMatch(/[^\r]\n/)` が落ちる | 連結には `lines[i].text`(EOL を含まない形)を使い、EOL の復元は `normalizeBody` に任せる。N8 で固定する |
| F6 | `scripts/` を手で直す | `pnpm run build` で差分が出戻る | `src/` だけを編集し、T7 で再生成する(制約 C2) |
| F7 | 検証のつもりでリポジトリルートの ARCHITECTURE に ADR を書いてしまう | `git status` に `harness-docs/ARCHITECTURE.md` の差分が出る。以後 hook が Write を deny する | §0.4 の隔離手順に従う。T14 の最後に `git status --short` で差分が無いことを確認する |
| F8 | `§5-x` の置換で `§5-3`(何を ADR にするか)を取りこぼす | `grep -n "§5-" ` に残る | T5 の完了条件を「`grep` が 0 件」にする。`§4-x` と `§11` を巻き込まない |
| F9 | 契約文書だけ直して指示層・記入例・設計書の写し・チェックリストを忘れる | 書式の正本と実装・例が割れる | T8 を先に確定させ、T9 / T10 / T11 / T12 を同じフェーズに置く。T12 のチェックリスト自身が次回の網になる |
| F10 | 区切りの有無を `toContain("---")` で見てしまう | Markdown 表の `\| --- \| --- \|` や本文中の `---` に誤反応し、正しい実装でも落ちる。あるいは逆に見落とす | §7.4 の `separatorLines` / `hasSeparatorLine` を使い、**行単位**で判定する |
| F11 | `indexOf("---")` を素で使って位置を比べる | **正しい実装が必ず赤になる。** 全節正規化により結果文書には区切りが複数あり、`indexOf` は最初の 1 本を返す | §7.1 U2 のとおり、検索の起点を対象エントリの見出しより後ろに置く |
| F12 | `normalizeAdrSeparators` に文書全文を渡してテストする | 冪等性だけが通り、`# ARCHITECTURE` 以下が前書き扱いになっていることに気づかない | §7.2 N5 のとおり、入力が**節本文**であることをテストの記述とコメントに明記する |

---

## 9. Done 条件チェックリスト

- [ ] `pnpm run lint` が緑(A1)
- [ ] `pnpm run typecheck` が緑(A1)
- [ ] `pnpm run test` が緑で、テスト数が baseline(2242)+ 新規ケース分になっている(A1 / A7 / A8)
- [ ] `pnpm run build` を実行し、`plugins/metatron/scripts/` の差分が実装と同じコミットにある(A2)
- [ ] N2 が緑である = 区切り入りの文書で履歴行が区切り線の**手前**に入る(A3)
- [ ] N4 が緑である = `get adr` の `entries[].raw` に区切りの**行**が無く、全エントリで対称である(A4)
- [ ] N1 が緑である = 区切りが無い既存文書へ `stage-adr` を通すと既存エントリの間にも区切りが入る(A5)
- [ ] 生成される区切りがすべて `\n\n---\n\n` の形である(A6。N1 / N10 が位置ごと見ている。T14 の手動検証でプレビューを目視した)
- [ ] §7.1 の U1・U2・U3 を適用し、「更新不要と判断したもの」が実際に緑であることを確認した(A7)
- [ ] N1〜N11 を追加し、すべて緑である(A8)
- [ ] 契約凍結文書 §6-1(5 項目)/ §6-2(1 項目)と `references/architecture-format.md` に区切りの規定がある(R6)
- [ ] metatron 設計書 §6-6 に区切りの規定がある(U1)
- [ ] `docs/format-change-checklist.md` に「ADR の書式」の節があり、§6.9 の 7 項目と一致している(R7)
- [ ] `docs/ARCHITECTURE.example.md` の ADR が 2 件で、区切りの見本がある(R8)
- [ ] `plugin.json` と `package.json` がともに `0.3.4-dev`(R9)
- [ ] `README.md` は変更していない(A9。§0.3 の根拠を確認済み)
- [ ] T14 の手動 CLI 検証を §0.4 の隔離手順で実施した(U2。任意ではない)
- [ ] `harness-docs/ARCHITECTURE.md` と `.claude/rules/metatron/` に差分が無い(C1 / C3)
- [ ] `grep -n "§5-" plugins/metatron/src/lib/adr.ts plugins/metatron/src/lib/__test__/adr.test.ts` が 0 件(C6 / D7)
- [ ] ブランチを切っていない(C5)
- [ ] コミットが §5 T15 の 4 単位に分かれており、無関係の未コミット差分を巻き込んでいない

---

## 10. 残課題(本改修では解決しない)

1. **このリポジトリの既存 ADR-001〜003 の間に区切りが入るのは、次に誰かが ADR を追加または状態変更した時点である。**
   正規化は `stage-adr` の 2 経路でしか走らない。本改修を ADR として起こさない決定(制約 C3)により、
   **正規化を発火させるトリガーが今回の作業内に存在しない**。
   移行用サブコマンドの新設と手作業による挿入は、どちらもユーザーが明示的に却下している。
   したがって `harness-docs/ARCHITECTURE.md` は当面、区切りが無いまま残る。これは仕様どおりの状態であり、欠陥ではない。
2. **`契約 §11` → `§12` の番号ずれ。** `adr.ts` L337 / L789 / L812、`adr.test.ts` の 4 箇所、`cli/get.ts` L1 / L428 に残る。
   D7 の判断により本改修では直さない。ADR の書式と無関係な範囲へ広がるためである。
3. **`normalizeAdrSeparators` は `scanFences` を 2 回走らせる**(自身と `parseEntries` の内側)。
   対象が 1 節ぶんであり計測可能な影響は無いと判断した。`parseEntries` を「scan を受け取る形」へ切り出す余地は残る。
4. **区切り線として認識するのは `-{3,}` の行だけである。** `***` / `___` で書かれた水平線は落とさず、本文として残る。
   metatron が生成するのは `---` だけであり、認識範囲を広げる必要が出たときに再検討する。
5. **`stage-adr` の diff プレビューに区切り行が現れる。** ユーザーが承認時に見る `diff.sections[].before/after` に
   `+---` の行が混じる。意図した変更であり対処しないが、初回は「なぜ区切りが増えたのか」と見える点だけ留意する。
6. **`get adr` の `entries[].raw` の値が、文書を書き換えなくても変わる。** D5 (a) により、区切り線だけでなく
   **非最終エントリの「次の見出しの直前にある空行」も `raw` から落ちる**。出力の変更である。
   リポジトリ内でこの値を消費しているのは、`adr.test.ts` の `entryRawById` を使うテストと
   `cli/get.ts` の `serializeAdr`(JSON へそのまま載せるだけ)の 2 つに限られる
   (context-map §1 で `plugins/**/*.ts` を走査済み)。どちらも本改修と同じコミットで整合が取れる。
   一方、**リポジトリ外の消費者がこの値を全文比較している場合は影響を受けうる**。
   `get adr --id …` の `raw` をそのまま貼り付けたり差分比較したりしている運用があれば、末尾の空行が 1 行減る。
7. **既に区切り線の後ろへ履歴行が入ってしまった文書は、正規化では救えない。**
   `isTrailingFiller` は**末尾からしか遡らない**。本文の途中にある `---` の後ろに履歴行がある文書では、
   その `---` は「末尾の埋め物」ではなくなるため、履歴行ごとエントリ本文の一部として残る。
   パーサは見出しでしか切らないので所属も変わらず、**エラーにも警告にもならない**。
   今回このような文書は存在しない(正本の ADR 節に `^---` は 0 件。§0.3)ため実害は無いが、
   **将来手で壊れたときに自動復旧しない範囲**として記録する。直すには手編集が要る。
8. **HTML コメントの内側にある単独行の `---` は、コードフェンスと違って filler 判定の対象になる。**
   `scanFences` が `insideFence` を立てるのはコードフェンスだけであり、HTML コメントは素の行として扱われる。
   したがって、前書きの末尾にあれば落ちる。エントリ本文の中にあっても、末尾から連続する位置にあれば落ちる。
   **N3 と N7 の対象外**である(N3 はフェンス内と本文途中、N7 は前書きと 1 件目の境界を見ている)。
9. **`----`(ハイフン 4 本以上)も `-{3,}` に一致する。** filler として扱われ、正規化で `---`(3 本)へ畳まれる。
   CommonMark では `----` も水平線なので描画は変わらないが、原文のバイト列は変わる。

---

## 11. 未解決事項(オーケストレーターの判断が要る)

**なし。** レビューを経て U1(設計書 §6-6 の追随)と U2(手動 CLI 検証)はどちらも確定し、§0.1 へ移した。

---

## 12. 計画との食い違い(実装セッションが追記する)

<!-- 実装中に「計画の記述と実際のコードが違う」ことを見つけたら、ここへ日時・箇所・内容を追記し、オーケストレーターへ報告する。勝手に計画を書き換えない。 -->

### 12.1 context-map §8.2 の予測は成立しない(2026-09-16 / 計画作成時に判明)

context-map `.claude/context-maps/2026-09-16-metatron-adr-separator.md` §8.2 は
`adr.test.ts` L397-417(R-A8)について「区切り線が混ざると**確実に FAIL する**」と書いているが、**これは成立しない**。

- 理由 1: このテストの入力は `THREE_ADRS` であり、**区切り線を含まない**。`contentEndIndex` の遡り挙動は入力側では変わらない。
- 理由 2: アサーションは**完全一致ではなく `toContain`**(部分文字列一致)である。期待している文字列の窓は
  「`永続化層。` → 空行 → 履歴 2 行」で閉じており、その後ろに区切りが足されても窓の外である。

したがって R4 を正しく実装すれば、このテストは**何も直さずに緑のまま通る**。
ただし「窓の内側に `---` が入り込む破損」(履歴行が区切り線の後ろへ回る / 履歴 1 行目と 2 行目の間に区切りが入る)は
**現行のアサーションでも検出できる**。§7.1 U3 で期待値を延長するのは、検出力の不足を補うためではなく
**A6(区切りが前後を空行で挟んだ形であること)を同じアサーションで固定するため**である。

### 12.2 以降(実装セッションが追記する)

(なし)
