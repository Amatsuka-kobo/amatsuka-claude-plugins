# codiel / sandalphon から ARCHITECTURE ドメインマップへの必須依存を解消する 設計書

- 作成日: 2026-09-15
- 対象プラグイン: `plugins/codiel`(主)、`plugins/sandalphon`(従)、`plugins/metatron`(登録簿 fixtures のみ)
- 現行バージョン: codiel `0.7.0-dev` → `0.8.0-dev`、sandalphon `0.1.2-dev` → `0.2.0-dev`、metatron `0.3.2-dev` → `0.3.3-dev`(§5.8)
- 状態: 設計(第 1 版)
- 入力: `harness-docs/handover/2026-09-15-codiel-domain-map-decoupling-handover.md`(事実・却下案・リスクの正本)、オーケストレーター確定事項(2026-09-15)
- 採用方針: 案G＋(引き継ぎ書 §2)
- 凍結契約(`harness-docs/design/2026-08-16-file-contract-freeze.md`)の扱い: **`:70` の 1 行のみ改訂が必須**(§7)

---

## 1. 上書きする決定

引き継ぎ書 §6(未解決事項)と §5(作業単位)を、次の 7 件で上書きする。引き継ぎ書そのものは編集しない。上書きの記録はこの節が正本である。

| # | 論点 | 決定 | 本設計での具体化 |
| --- | --- | --- | --- |
| 6-1 | 汎用モード確認の取得時期と記録先 | **run state に記録する。** run 開始時(§0)に 1 回確認し、結果を `.codiel/runs/**/state.json` の新しい optional フィールドへ記録する | §5.1 |
| 6-2 | 「初期化済み」の判定基準 | **B + C + D の 3 点。** `CLAUDE.md` の運用ルール節 / `raguel.config.yaml` / `.codiel/` の 3 ディレクトリ。**A(ARCHITECTURE)は判定基準から外す** | §5.3、§6.1 |
| 6-3 | sandalphon の `codielReady` | **条件と名前の両方を変更する。** 論理積から `domainsReadable` を外し、フィールド名も意味に合わせて改名する | §5.5、§6.9 |
| 6-4 (a) | 任意ドメイン名の行き先が無い穴の塞ぎ方 | **案 2: 汎用担当エージェントを新設する。** `codiel-implementer-generic` と `codiel-reviewer-generic` を作り、backend から兼任記述を外す | §5.4、§6.6、§6.7 |
| 6-4 (b) | 穴埋めの実施時期 | **依存解消と同じ変更単位で行う。** 停止条件を外した瞬間に任意キーのマップで run が始まるため、行き先が無いまま通す状態を一瞬も作らない | §6.7、§13 |
| 6-5 | 契約凍結文書への追随 | **init 手順 5 から ARCHITECTURE 検証を完全に消す。→ 契約変更が必要** | §6.1、§7 |
| 追加 | 作業単位の漏れ | **W14 として本件に含める。** `preparing-design-agendas` と `writing-design-docs` も明示入力へ揃える | §6.14 |

**この 7 件はユーザーが決定済みである。本設計はこれを前提とし、覆さない。別案も提示しない。**

---

## 2. 背景と目的

`harness-docs/ARCHITECTURE.md` の `## ドメインマップ`(` ```json metatron:domains ` ブロック。`:91-101`)に対する codiel と sandalphon の**必須依存**を解消する。

解消する中身は 2 つある。

- **codiel が ARCHITECTURE を書く経路をなくす。** `/codiel:init` が最小 ARCHITECTURE を生成し(`plugins/codiel/skills/initializing-harness/SKILL.md:70-98`)、不正な JSON を修復し(`:163-172`)、`CLAUDE.example.md:48-51` が対象プロジェクトへ「乖離したら ARCHITECTURE を更新せよ」を常駐ルールとして配布している。ARCHITECTURE は metatron の資産であり、codiel が作成・修復する立場にない。
- **ドメインマップが無いと run が始まらない状態をやめる。** `plugins/codiel/skills/orchestrating-runs/SKILL.md:70-72` が `domains: null` を「ハーネスが未初期化である」と断定し、run をそこで終了させる。

**「読むな」ではない。** ユーザーの意向の核心は「codiel が ARCHITECTURE を**書く**な」である。有効なマップがあるときに読んで境界に使うことは、本設計でも維持する。`plugins/sandalphon/skills/capturing-intent/SKILL.md:81` のような**任意参照**も維持する。同行は「ドメインマップが無い環境でも探索は成立するため、これは強化であって前提ではない」と自ら明記しており、必須依存ではない。

**目的**: ドメインマップを metatron の構造記述として正本の位置に残したまま、codiel を「マップがあれば使い、無くても汎用実行で走る」形にし、sandalphon の委譲判定からドメイン可読性を外す。

---

## 3. 前提(実測。2026-09-15 時点の working tree)

### 3.1 baseline

- HEAD: `5c59c87`、作業ツリーはクリーン。
- `pnpm run lint` 通過(biome の info 4 件のみ)、`pnpm run typecheck` 通過、`pnpm run test` は 157 files passed / 1 skipped、2234 tests passed / 2 skipped。

### 3.2 `readDomainsResult` は 5 つの状態を 1 つの `null` に落とす

`plugins/codiel/src/hooks/lib.ts:484-503`。

| 行 | 状態 | `warnings` |
| --- | --- | --- |
| `:487` | ARCHITECTURE のファイルが無い | **空** |
| `:491` | ブロックが無い | 場合により有 |
| `:497` | JSON パース失敗 | 場合により有 |
| `:499`(`validateDomainsValue` が null) | 形式不正(検証 4 項目の 2〜4 に違反。`:451-463`) | 場合により有 |
| `:500-501` | 例外 | **空** |

`:487` と `:500-501` は警告が空である。したがって「warnings を表示して generic にすれば安全」は現状の戻り値では成立しない。

`:446-450` のコメントが判定の一致を宣言している。

> 契約 §1 の検証 4 項目のうち 2〜4(値の形)。1(有効な JSON)は呼び出し元が担う。
> metatron の `validateDomainsValue`、sandalphon の `readDomains` と**同じ判定**にする。
> ここを緩めると、同じ ARCHITECTURE を codiel だけが「読めた」と扱う契約の割れになる。

### 3.3 指示層はフェイルクローズド、コード層は縮退。この非対称は設計である

- 指示層: `orchestrating-runs/SKILL.md:68-72`。`domains` が `null` または形式不正なら run を終了する。
- コード層: `plugins/codiel/src/hooks/guard-write.ts:155-156` のコメント原文 —「ドメイン定義が無い・読めない環境で新たに書き込みを止めるのは配線の目的ではない。」`:156` の `if (domains)` により、読めなければ境界判定ブロックを丸ごと飛ばして `:177` の `pass()` に落ちる。
- テストで固定されている: `plugins/codiel/src/hooks/__test__/guard-write.test.ts:295-306`(マップが在ってドメイン名が無ければ ask)、`:308-316`(マップが読めなければ素通し)、`:318-328`(generic はどのパスでも素通し)。
- 根拠: `plugins/codiel/docs/DESIGN.md:385`(「`domain` が無いとき・ドメインマップが読めないときは境界を課さない」)。

**移管の実害は指示層の側に出る。** コード層は既に縮退設計になっている。

### 3.4 write ゲートが作動する前提条件(4 つすべて必要)

1. アクティブな run がある(`guard-write.ts:104-105`)。
2. フェーズが `CODE_PHASES`(`:116`。implement / test-loop / fix-loop)。
3. `run.state.domain` が設定済み(`:134-136`)。
4. 書き込み先が `.codiel/` 配下でない(`:136`)。

### 3.5 `RunState` は optional フィールド追加の先例を持つ

`plugins/codiel/src/codiel-state.ts:26-48`。`version: number`(`:27`)を持ち、`domain?: string | null`(`:47`)に次のコメントが付く(`:43-46`)。

> 実装・レビューを委譲中のドメイン名(ARCHITECTURE のドメインマップのキー)。委譲していない間は
> null / 未定義。optional なので domain を持たない既存 state はそのまま読める(version 据え置き)。
> 値がドメインマップに存在するかは検証しない — 判断は読む側(guard-write)の責務。

`state.json` は `.codiel/runs/` 配下の **run 単位の運用資産**であり、ARCHITECTURE や `CLAUDE.md` のようなプロジェクトの恒久資産ではない。これが引き継ぎ書 §2.2 の「恒久ファイルの生成はしない」と §7-1 の「in-memory のみでは再開を扱えない」を同時に満たす唯一の置き場である。

`--base-branch` は `codiel-state.ts:241` で `init` の経路が受け取っており、`parseArgs`(`:163-173`)は `--<名前> <値>` の形を一般に解釈する。フラグ追加の先例がある。

### 3.6 現状の generic 縮退は「backend 兼任」で agent 定義に焼き込まれている

- `plugins/codiel/agents/codiel-implementer-backend.md:16`:「縮退モード(ドメインマップが `generic` 1 つ)では、汎用実装担当を兼ね、`[domain: generic]` タグが付いたステップのみを記載順に実施する。」
- `codiel-implementer-frontend.md:16-17` / `codiel-implementer-data.md:16-17`:「generic 縮退時の汎用実装は codiel-implementer-backend の担当である。」「generic 縮退時は呼ばれない。」
- `codiel-reviewer-backend.md:3`(description):「ドメイン縮退時は汎用レビュー担当を兼ねる。」
- `codiel-reviewer-backend.md:26`:「ドメインマップが `generic` 1 つに縮退しているプロジェクトでは、diff 全体を確認する。」
- 対応表は `orchestrating-runs/SKILL.md:203-205` にハードコードされている。

**見落としやすい歪み**: 縮退時に足されるのは「diff 全体を見よ」という**範囲**の指示だけで、**観点は差し替わらない**。`codiel-reviewer-backend.md:20` の観点は「API 設計・エラーハンドリング・パフォーマンス・互換性」で固定されている。任意キーへ一般化すると、本リポジトリの `docs` ドメイン(`ARCHITECTURE.md:99`。`harness-docs/**`・`README.md`・`.serena/**`)の変更を backend 観点でレビューすることになる。

### 3.7 既存の穴: 任意ドメイン名の行き先が無い

- 契約 `file-contract-freeze.md:53-54` と `initializing-harness/SKILL.md:90` は**ドメイン名を任意の文字列**と定める。
- しかし実在する implementer は `frontend` / `backend` / `data` の 3 種のみで、`orchestrating-runs/SKILL.md:197-205` の対応表は `frontend` / `backend` / `data` + `generic` の 4 値しか扱わない。
- **本リポジトリ自身の ARCHITECTURE がこの穴に落ちている**: `ARCHITECTURE.md:95-99` のキーは `impl` / `prompt` / `bundle` / `manifest` / `docs` である。
- 各 implementer は「他ドメインのステップには着手しない」(`codiel-implementer-backend.md:17` ほか同型)という規律を持つため、ルーティングだけを変えても agent 側の規律が拒む。

### 3.8 登録簿テストは節名だけでなく `ARCHITECTURE` の文字列そのものを見る

`plugins/metatron/src/__test__/section-reference-inventory.test.ts:112-116`。

```ts
function referencesIn(text: string): string[] {
  const refs = termsIn(text)
  if (/ARCHITECTURE/.test(text)) refs.push(ANY)
  return refs
}
```

- 検出形は `termsIn`(`:93-106`)の 4 種。(d) は `ARCHITECTURE[^\n]{0,40}` + 節名(`:101`)であり、「ARCHITECTURE のドメインマップ」という書き方はここで拾われる。
- 登録簿 `plugins/metatron/src/fixtures/section-reference-inventory.json` は全 39 件。分類 **B**(`reference: "ドメインマップ"`)は 12 件で、すべて codiel(`:10-14`、`:34-38`、`:46-50`、`:58-62`、`:88-92`、`:118-122`、`:136-140`、`:154-158`、`:166-170`、`:178-182`、`:190-194`、`:202-206`)。
- V1(`:122-129`)は分類 A がゼロであること、V2(`:131-145`)は未登録参照で落ちること、V3(`:147-`)は登録済みなのに実体が無いと落ちることを固定する。

### 3.9 3 者比較テストが突き合わせる項目

`plugins/sandalphon/src/__test__/check-intent-env.test.ts:886-984` の `expectThreeWayMatch` が比較するのは次である。

| 項目 | metatron | codiel | sandalphon |
| --- | --- | --- | --- |
| `docRoot`・ARCHITECTURE / GOTCHAS の解決パス | `loadConfig()` | `resolveDocPaths()` | `out.docRoot` / `projectDocs.*` |
| 設定警告の有無と件数 | `warnings` | `warnings` | `configWarnings`(合算) |
| ドメインマップの**値**の deep equality(`:930-933`) | `extractDomains().domains` | `readDomainsResult().domains` | (返さない) |
| ドメインマップの**可読性**(真偽。`:934-937`、`:973-976`) | `extractDomains().ok` | `readDomains() !== null` | `projectDocs.domainsReadable` |
| ドメイン警告の件数(`:940-943`) | `extractDomains().warnings` | `readDomainsResult().warnings` | `configWarnings` に合算 |
| ドメイン件数(`:978-983`) | キー数 | — | `projectDocs.domainCount` |

**比較は `DomainsRead` の個別フィールド(`.domains` / `.warnings`)に対して行われ、オブジェクト全体の `toStrictEqual` ではない。** この事実が §5.2 の判断を支える。

### 3.10 変えない前提

- `plugins/codiel/src/hooks/guard-write.ts:153-175` の境界判定の挙動。
- 検証 4 項目(`file-contract-freeze.md:81-84`)と `validateDomainsValue`(`lib.ts:451-463`)。
- `readDomains`(`lib.ts:509-511`)の戻り値の型と意味。
- `projectDocs.domainsReadable` / `projectDocs.domainCount`(`check-intent-env.ts:795-796`)。3 者比較の比較対象であり、削除も改名もしない。
- docRoot 基準のパス解決(`findDocRoot` / `resolveDocPaths`)。docRoot → codielRoot の変更は本件のスコープ外。

---

## 4. 全体像

案G＋ の 5 項目と、それが解く問題の対応は次のとおり。

| # | 案G＋ の項目 | 解く問題 | 本設計の該当 |
| --- | --- | --- | --- |
| 1 | ARCHITECTURE のドメインマップは metatron の構造記述として残す。codiel は作成・修復しない | codiel が ARCHITECTURE を書く経路(init の生成・修復、`CLAUDE.example.md` の常駐ルール) | W1・W8・W11 |
| 2 | codiel はドメインマップなしでも汎用実行を提供する。ただし境界を設けないモードであることを明示して選択・記録する | `domains: null` で run が始まらない | W2・W3・W4 |
| 3 | 「マップを使わない」と「使うはずのマップを読めない」を分ける。後者を自動で前者に変えない | `readDomainsResult` が 5 状態を 1 つの `null` に落とす(§3.2) | §5.2・§5.3 |
| 4 | 任意ドメイン名でも担当者の選択が必ず決まるようにする。専門担当がなければ汎用担当を使い、元のドメイン名と範囲は維持する | 既存の穴(§3.7) | W5・W6・W7 |
| 5 | sandalphon の委譲判定からドメイン可読性を外す | `codielReady` の論理積 | W9 |

run 開始の流れは次の形になる。

```
/codiel:run
  └─ orchestrating-runs スキル
       §0 前提チェック
          1. パスとドメインマップを 1 回だけ解決(readDomainsResult)★「読めない理由」を受け取る
          2. 初期化の外形を確認(B + C + D。★A = ARCHITECTURE は見ない)
          3. Raguel MCP の可用性を確認
          4. ★実行モードを決める(mapped / unscoped / 停止)
       §1 run の解決
          新規 try を作るとき ★codiel-state init --domain-mode <モード> でモードを記録
          再開のとき         ★state の domainMode を正とし、食い違いを検出したら止める
       §3 ディスパッチ
          ★モードと、使うドメインマップと、担当タグを明示入力として渡す
       §4 ドメインディスパッチ
          ★タグ → codiel-implementer-<タグ> が実在すればそれ、無ければ -generic
```

---

## 5. 設計判断

### 5.1 決定: 実行モードは 2 値とし、run state に記録する

**結論。`RunState` に optional フィールド `domainMode?: "mapped" | "unscoped"` を足す。`version` は据え置く。値は run 開始時(§0)に 1 回だけ決め、以降は記録した値を各所へ渡す。**

| 値 | 意味 |
| --- | --- |
| `"mapped"` | 有効なドメインマップに基づき、ドメイン別の担当・タグ・境界判定を用いる |
| `"unscoped"` | ドメイン別の境界を設けないことを run 開始時に明示選択した |

**名前が `generic` と衝突しない。** `{"generic":["**"]}` は「generic という名前のドメインが 1 つあるマップ」であって、モードではない。このマップを持つプロジェクトは `"mapped"` であり、ステップのタグは `generic`、`set-domain` に渡す値も `generic` である。モード名と、ドメイン名と、ステップのタグは別の概念として保つ。

**記録先の根拠。** §3.5 のとおり `state.json` は run 単位の運用資産であり、`domain?: string | null` という optional 追加の先例がある。`version` 据え置きで、`domainMode` を持たない既存 state はそのまま読める。

**`"unscoped"` への到達経路は 2 つある。** §5.3 の分岐表の行 5 と行 6 (b) である。

| 経路 | 条件 | `domains` が `null` になる理由 |
| --- | --- | --- |
| 行 5 | `unreadable` が `architecture_missing` または `block_missing`。境界なしで実行することをユーザーが確認した | マップが存在しない |
| 行 6 (b) | `unreadable` が `invalid_json` / `invalid_shape` / `read_error`。壊れたマップを修復せず、この run に限り境界なしで進むことをユーザーが明示的に選んだ | ブロックは在るが検証 4 項目(`file-contract-freeze.md:81-84`)を満たさない |

**理由は違うが、帰結は同じである。** どちらの経路でも `readDomainsResult().domains` は `null` になり、hook 層は `guard-write.ts:156` の `if (domains)` で境界判定を飛ばす。**したがって `"unscoped"` の run では、指示層と hook 層が構造として一致する。** 引き継ぎ書 §7-2 の三重状態は生じない。**この性質が §5.7「hook 層を変えない」を支える論拠である。** 到達経路を増やすときは、`domains === null` が保たれるかを必ず確かめる。

**行 6 (b) は自動縮退ではない。** ユーザーが壊れたマップを認識したうえで選ぶ経路であり、`domains: null` を一括で generic へ落とす案G とは別物である。

**`"unscoped"` では `set-domain` を呼ばない。** 宣言する境界が無いため、`domain` を空のまま保つ。`guard-write.ts:136` の `if (domain && ...)` により境界判定へ入らない。これで「hook が実ファイルを読む / オーケストレーターが仮想 generic を使う」というずれも生じない。

**`domainMode` が未記録の state を読んだときは、モード未決と扱う。** §0 の判定をやり直し、ユーザー確認を取ってから記録する。codiel は dev ステータスで実利用者ゼロとみなすため移行の実装は不要だが(引き継ぎ書 §2.3-2)、読みの定義を置かないと未定義値で分岐が割れる。

### 5.2 決定: `readDomainsResult` に「読めない理由」を足す。契約は割れない

**結論。`DomainsRead` へ `unreadable` フィールドを足す。`domains` と `warnings` の意味・値は一切変えない。**

案G＋ の核心「マップを使わないと、使うはずのマップを読めないを分ける」は、区別できる情報が無ければ実現できない。判定を指示層へ散らして `fs.existsSync` を別途呼ぶ形にはしない。hook 層と指示層で解釈が割れ、三重状態の温床になる。

```ts
/** domains が null になった理由。読めたときは null。 */
export type DomainsUnreadableReason =
  | "architecture_missing" // ARCHITECTURE のファイルが無い(lib.ts:487)
  | "block_missing"        // metatron:domains ブロックが無い(:491)
  | "invalid_json"         // ブロック内が有効な JSON でない(:497)
  | "invalid_shape"        // 検証 4 項目の 2〜4 に違反(:499)
  | "read_error"           // 例外(:500-501)

export interface DomainsRead {
  domains: Record<string, string[]> | null
  warnings: string[]
  unreadable: DomainsUnreadableReason | null
}
```

**契約が割れない論証。**

1. `lib.ts:446-450` のコメントが一致を求めているのは**検証 4 項目の判定**である(§3.2 に原文)。本設計は `validateDomainsValue`(`:451-463`)にも、`findDomainsBlocks` の警告生成にも、JSON パースの成否判定にも手を触れない。足すのは**読めなかった理由の細分化**であり、**読めた/読めないの判定そのものは変えない**。
2. したがって `domains !== null` の真偽は全入力に対して現状と同一である。`readDomains`(`:509-511`)は `readDomainsResult(startDir).domains` を返すだけなので、こちらも不変である。
3. 3 者比較(`check-intent-env.test.ts:886-984`)が突き合わせるのは `.domains` の deep equality、`readDomains() !== null` の真偽、`.warnings.length`、sandalphon の `domainsReadable` / `domainCount` である(§3.9)。**いずれもフィールド単位の比較であり、`DomainsRead` オブジェクト全体の `toStrictEqual` ではない。** フィールドを足しても比較結果は変わらない。
4. metatron の `extractDomains` と sandalphon の `readDomains`(`check-intent-env.ts:514-543`)には**一切変更を加えない**。3 実装のうち codiel だけが内部で理由を持つが、それは「読めた/読めない」の外側の情報である。

**唯一の副作用。** `plugins/codiel/src/hooks/__test__/lib.test.ts:531-537` は `expect(readDomainsResult(root)).toStrictEqual({ domains: null, warnings: [] })` とオブジェクト全体を比較しており、フィールド追加で落ちる。**このテストは更新する**(§9)。`guard-write.test.ts` ではないため、禁止事項に抵触しない。

### 5.3 決定: 引き継ぎ書 §2.2 の 5 状態を run §0 の分岐へ落とす

**結論。「初期化の外形(B + C + D)」と「`unreadable` の値」の 2 軸で、どの行を採るかが機械的に決まる分岐にする。**

**「機械的」が指すのは行の選択だけである。** 採った行の中の手順まで全自動という意味ではない。

初期化の外形は `initializing-harness/SKILL.md:30-35` の判定をそのまま使い、**A(ARCHITECTURE)を外す**(§1 の 6-2)。

| 記号 | 確認対象 | 「揃っている」の判定 |
| --- | --- | --- |
| B | `CLAUDE.md` | ファイルが存在し、`## Codiel ハーネス運用ルール` 見出しを含む |
| C | `raguel.config.yaml` | ファイルが存在し、YAML としてパースできる |
| D | `.codiel/specs` / `.codiel/runs` / `.codiel/reports` | 3 ディレクトリが存在する |

分岐表は次のとおり。上から順に評価し、最初に当たった行を採る。

| # | 条件 | 判断 | 引き継ぎ書 §2.2 の対応行 |
| --- | --- | --- | --- |
| 1 | Raguel MCP(`mcp__raguel__*`)が使えない | **止める。** ARCHITECTURE の欠落とは別の理由を示す | 5 行目 |
| 2 | B / C / D のいずれかが欠けている | **止める。** 欠けている項目を名指しし、`/codiel:init` を案内する。**ARCHITECTURE には言及しない** | 5 行目 |
| 3 | `unreadable === null`(マップが読める) | **`mapped` で開始する。** 担当は §5.4 のルーティングで必ず決まるため、ここでの追加確認は要らない | 3 行目 |
| 4 | `unreadable` が `architecture_missing` または `block_missing`、かつ state に `domainMode` の記録がある | 記録された値で開始する。再確認しない | 1 行目 |
| 5 | `unreadable` が `architecture_missing` または `block_missing`、かつ記録が無い | **境界なしで実行することを確認してから `unscoped` で開始する。** 恒久ファイルは生成しない。記録先は run state のみ | 2 行目 |
| 6 | `unreadable` が `invalid_json` / `invalid_shape` / `read_error` | **一旦止めて確認する。** 読めない理由と `warnings` の全文を提示し、(a) マップを修復して再実行する、(b) この run に限り `unscoped` へ切り替える、のどちらかをユーザーに選ばせる | 4 行目 |
| 7 | 記録が `mapped` なのに再開時に `unreadable !== null` | **止めて確認する。** run 中のマップ消失を暗黙のモード変更にしない | 4 行目 |

**ユーザー確認を伴うのは行 5 と行 6 だけである。** 行 5 は境界なしで実行してよいかの可否 1 点、行 6 は修復か `unscoped` への切り替えかの二択を問う。他の行は確認を挟まない。

**`domains: null` を一括で generic へ自動縮退させない。** 行 5(正当な不在。汎用モードの候補)と行 6(異常。止めて確認する)を必ず別の分岐に保つ。これが案G と案G＋ を分ける唯一の点である。

**行 6 の (b) を選んだ場合も `unscoped` を記録し、選択の事実を完了報告に残す。** この経路が自動縮退でないこと、および hook 層と一致することは §5.1 に示す。

**警告の提示は残す。** `warnings` が空でなければ全文を提示してから進む規律(`orchestrating-runs/SKILL.md:73-74`)は維持する。これが §7 で契約の `:70` から `orchestrating-runs` の名指しを外さない根拠である。

### 5.4 決定: 任意ドメイン名のルーティング規則

**結論。ステップのドメインタグ `X` に対し、`codiel-implementer-X` が自分の利用可能なエージェント一覧に実在すればそれへ、しなければ `codiel-implementer-generic` へディスパッチする。タグと glob は書き換えない。**

- **実在の判定は「自分の利用可能なエージェント一覧に `codiel-implementer-X` があるか」だけで行う。** プラグインルート・`agents/` ディレクトリ・定義ファイルを探索しない。`initializing-harness/SKILL.md:53-55` が `/metatron:init` に対して取っている判定(「インストール検出をしない。見るのは…自分の利用可能コマンドにあるかの 2 点だけ」)と同型である。
- reviewer も同型とする。diff が触れたドメイン `X` に対し `codiel-reviewer-X` が実在すればそれ、無ければ `codiel-reviewer-generic`。`codiel-reviewer-doc` / `-security` は従来どおり常時参加する(`orchestrating-runs/SKILL.md:202`)。
- `set-domain` に渡す値は**タグの値そのまま**である。汎用担当へ送るときも `X` を渡す。エージェント名から別名を作らない。これにより `guard-write.ts:157` の `domains[domain]` が正しい glob を引き、**元のドメイン名と範囲が維持される**(案G＋ 4)。
- `unscoped` では `set-domain` を呼ばない(§5.1)。
- 対応表をドメイン定義側に持たせない。「ドメイン名 → スキル名」の対応をドメインマップへ入れると、本リポジトリ自身のキー(`impl` / `prompt` / `bundle` / `manifest` / `docs`)が `frontend` / `backend` / `data` のどれでもないという既存の穴を、新しい形で再生産する。対応は codiel のディスパッチ層に置く。

### 5.5 決定: 汎用担当エージェントを新設し、backend の兼任を解く

**結論。`codiel-implementer-generic` と `codiel-reviewer-generic` を新設する。`codiel-implementer-backend` と `codiel-reviewer-backend` から汎用担当を兼ねる記述を外す。**

**兼任を解く理由。** §3.6 のとおり、現状の縮退で足されるのは「diff 全体を確認する」という**範囲**の指示だけで、**観点は差し替わらない**。`codiel-reviewer-backend.md:20` の観点は「API 設計・エラーハンドリング・パフォーマンス・互換性」に固定されている。任意キーへ一般化すると、本リポジトリの `docs` ドメイン(`harness-docs/**`・`README.md`・`.serena/**`)の変更を backend 観点でレビューすることになる。ルーティングだけを直しても、観点の誤りは残る。

新設する 2 体の要件。

| 項目 | `codiel-implementer-generic` | `codiel-reviewer-generic` |
| --- | --- | --- |
| 担当タグ | **ディスパッチプロンプトで指定されたタグ**のステップのみ。特定のドメイン名をハードコードしない | 指定されたドメインに関わる diff |
| 観点 | `implementing` スキルの手順に従う。ドメイン固有の観点を持たない | 正しさ・不整合・回帰リスクといったドメイン非依存の観点に限る。backend / frontend / data の専門観点を名乗らない |
| 範囲 | `unscoped` では dev-plan の全ステップ、`mapped` では指定タグの glob 配下 | 同左 |
| ツール | 既存 implementer / reviewer と同じ最小構成に揃える | 同左 |

**作成は `prompt-smith:agent-creator` で行う**(規約)。description の文面と frontmatter の検証は同スキルが担当する。

### 5.6 決定: `codielReady` の条件と名前を変える

**結論。`codielReady` を廃し、`codielHandoffCandidate` を出す。値は `codielDirExists` のみとする。**

- 現状: `plugins/sandalphon/src/check-intent-env.ts:593-594` が `const codielReady = codielDirExists && domains.domainsReadable`。出力は `:798`。
- 変更後: `const codielHandoffCandidate = codielDirExists`。出力は同じ位置。
- **`projectDocs.domainsReadable` と `domainCount` は残す。** 3 者比較(`check-intent-env.test.ts:973-983`)の比較対象であり、削除も改名もしない。事実として返し続け、**判断に使うのをやめる**だけである。
- 名前の根拠: 環境スクリプトは事実を返し、実行可否は codiel の preflight(§5.3)が決める。`ready` は「実行できる」と読めるが、スクリプトはそれを保証できない。`handoffCandidate` は「委譲先の候補として検出した」という検出事実を表す。
- `codielHandoffCandidate` が `codielHarness.dirExists`(`:800`)と同値になる冗長は意図的に残す。`codielHarness` は生の事実を束ねる場所、トップレベルの 1 件は「委譲判断が読む値」を名指しする場所として役割を分ける。

**`rationale.md:51-68` の論拠は前提が崩れる。** `:56-60` は「`/codiel:run` が実際にフェイルクローズドする条件は、ドメイン別 implementer / reviewer のディスパッチが依存する ARCHITECTURE のドメイン定義が読めることにある」「選ばせた選択肢が必ず失敗するのは、選択肢を出さないことより体験として悪い」と書く。本設計で codiel が `unscoped` でも通るようになるため、**ドメイン定義が読めないことは「必ず失敗する」を意味しなくなる**。§6.9 で書き換える。`:62-65`(文書と Codiel 固有資産をフィールドとして分けた理由)と `:67-68`(記法変更に対して安全側へ倒れる)は本設計でも真であり、残す。

### 5.7 決定: hook 層を変えない

**結論。`guard-write.ts:153-175` の挙動を据え置く。`guard-write.test.ts:295-328` が固定する 3 つの振る舞いはそのまま通る。**

- §3.3 のとおり、指示層のフェイルクローズドとコード層の縮退という非対称は設計であって事故ではない。移管の実害は指示層に出る。
- §5.1 の 2 つの帰結(`unscoped` は必ず `domains === null`、`unscoped` では `set-domain` を呼ばない)により、hook を変えずに指示層と一致する。
- **既存の `guard-write.test.ts` を書き換えない。** 書き換えが要ると判断した時点で実装を止め、オーケストレーターへ報告する。

### 5.8 決定: バージョン

| プラグイン | 現行 | 新 | 根拠 |
| --- | --- | --- | --- |
| codiel | `0.7.0-dev` | **`0.8.0-dev`** | `src/` 2 ファイル・スキル 7 本・agent 定義 7 本・`CLAUDE.example.md`・`README.md`・`commands/init.md` に及ぶ。変更が多いためマイナーを上げる |
| sandalphon | `0.1.2-dev` | **`0.2.0-dev`** | 出力 JSON のフィールド名変更(消費側 3 箇所の追随を伴う)。変更が多いためマイナーを上げる |
| metatron | `0.3.2-dev` | **`0.3.3-dev`** | 変更は登録簿 fixtures の 1 ファイルだけだが、規約を成果物の変化を問わず適用する(下記) |

**据え置きを検討した経緯(結論は覆された)。** 変更するのは `plugins/metatron/src/fixtures/section-reference-inventory.json` の 1 ファイルだけである。

- 同ファイルは `plugins/metatron/build.ts` の entryPoints に含まれず、バンドル出力 `plugins/metatron/scripts/` に入らない(grep で 0 件)。
- `plugins/metatron/package.json` に `files` フィールドは無く、`plugins/metatron/.claude-plugin/plugin.json` も fixtures を参照しない。
- 唯一の読み手は `src/__test__/section-reference-inventory.test.ts` であり、**テスト専用のデータである**。

この事実から、当初は「配布物にも挙動にも変化が無いため版を上げる意味がない」と判定し、規約「改修したプラグインの `plugin.json` と `package.json` のバージョンが揃って上がっている」を、利用者へ届く成果物が変わることを前提とした条件と解した。

**この判定は 2026-09-15 のユーザーレビューで覆された。** fixtures がテスト専用であるという事実認識は正しいが、**規約は成果物の変化を問わず適用する**というのがユーザーの判断である。したがって metatron はパッチを上げて `0.3.3-dev` とする。上記の事実関係は、次に同じ検討を一からやり直さないために残す。

現行値は実測である(`plugins/codiel/package.json:3` / `plugins/codiel/.claude-plugin/plugin.json:4` / `plugins/sandalphon/package.json:3` / `plugins/sandalphon/.claude-plugin/plugin.json:4` / `plugins/metatron/package.json:3` / `plugins/metatron/.claude-plugin/plugin.json:4`)。

---

## 6. 各変更の詳細

### 6.1 W1 — init から ARCHITECTURE の生成・修復を外す

対象: `plugins/codiel/skills/initializing-harness/SKILL.md`

| 箇所 | 現状 | 変更 |
| --- | --- | --- |
| `:3`(description) | 「(.codiel/・raguel.config.yaml・CLAUDE.md の運用ルール節・最小 ARCHITECTURE)を初期化・補完する」 | 「最小 ARCHITECTURE」を外す。description の文面確定は `prompt-smith:skill-creator` が担当する |
| `:19`(チェックリスト 1) | 「**ARCHITECTURE の確認**(不足していれば最小生成)」 | **行ごと削除。** 以降の番号を繰り上げる |
| `:28`・`:30-32`(現状調査) | 「次の 4 点」と行 A(ARCHITECTURE) | **3 点**にし、行 A を削除する。B / C / D を残す(§5.3) |
| `:39` | 「GOTCHAS は確認対象に含めない。台帳の生成は metatron が行う」 | ARCHITECTURE についても同型の 1 行を足す。「ARCHITECTURE は確認対象に含めない。作成と更新は metatron が行う。codiel は ARCHITECTURE を書かない」 |
| `:42-98`(手順 1 全体) | パス解決・2 択提示・最小 ARCHITECTURE の生成 | **節ごと削除。** 雛形(`:77-88`)と規約(`:90-94`)も消える |
| `:129-150`(手順 5 検証) | `readDomainsResult` で読めることを確認するコマンド、`WARN:` の扱い、検証失敗時の再検証 | **ARCHITECTURE 検証を完全に削除する**(§1 の 6-5)。`:148-149` の `raguel.config.yaml` の glob 確認は残す |
| `:152-161`(完了報告) | `:157`「手順 5 の検証コマンドが出した `WARN:` 行」、`:159-160`「最小 ARCHITECTURE を生成した場合は…」 | 両方を削除する。残りの報告項目は維持する |
| `:163-172`(修復の例外) | ARCHITECTURE の JSON 不正時にブロックを置換する / 拒否されたら `/metatron:update` を案内 | **ARCHITECTURE に関する記述を削除する。** `raguel.config.yaml` の YAML 不正の修復は残す |
| `:180-181`(HARD-GATE) | 「聞いた内容をコードベースの解析結果で置き換えない。**ドメインマップと保護パス**はユーザーの回答からのみ生成する」 | 対象を「保護パス」だけにする |
| `:188`・`:191`・`:193`(Red Flags) | ドメイン分割の聞き取り / domains の検証 / 「ARCHITECTURE が最小なので技術スタックも足しておこう」 | 3 行を削除する。`:192`(metatron のインストール検出をしない)は保護パスの文脈でも有効なので残す |
| `:8`・`:18`・`:26`・`:37` | 「4 点」「全部揃っていれば」等の件数表現 | 3 点へ揃える |

**AskUserQuestion で聞く対象は保護パス(`:113`)だけになる。** ドメイン分割は聞かない。

### 6.2 W2 — run §0 の停止条件を実行モードの決定に置き換える

対象: `plugins/codiel/skills/orchestrating-runs/SKILL.md:52-78`

| 箇所 | 現状 | 変更 |
| --- | --- | --- |
| `:54` | 「ひとつでも欠けていれば **run を開始しない**」 | 「ドメインマップの不在それ自体は欠落に当たらない」を明示する |
| `:56-65`(手順 1) | `resolveDocPaths` + `readDomainsResult` を 1 回だけ呼ぶコマンド | **残す。** 出力へ `unreadable` を追加する(§6.15) |
| `:68-69`(手順 2) | 「`domains` が `null` でなく、各ドメインが 1 つ以上の glob を持つことを確認する」 | §5.3 の分岐表の入力として読み替える |
| `:70-72`(手順 3) | 「**`domains` が `null` または形式不正の場合**: ハーネスが未初期化である。…**この run はここで終了する**」 | **§5.3 の分岐表に置き換える。** 停止条件の削除ではなく、代替の実行規則の導入として行う |
| `:73-74`(手順 4) | `warnings` の全文提示 | **残す**(§7 の根拠) |
| `:75`(手順 5) | `architecture` / `gotchas` をディスパッチプロンプトで使う | 「実行モードと、使うドメインマップ」も渡す旨を足す(W3) |
| `:76-77`(手順 6) | Raguel MCP の可用性 | **残す。** 分岐表の行 1 に対応する |
| 新規 | — | 初期化の外形(B + C + D)の確認手順を足す。ARCHITECTURE は見ない |
| `:35`(チェックリスト 0) | 「**前提チェック**(下記)。満たさなければここで終了する」 | 「実行モードを決める」を含む表現へ改める |

### 6.3 W3 — ディスパッチプロンプトへ実行モードを明示入力として渡す

対象: `plugins/codiel/skills/orchestrating-runs/SKILL.md:156-193`

- `:174-179` の `## 前提` ブロックへ 2 行を足す。
  - 実行モード(`mapped` / `unscoped`)
  - `mapped` のとき: §0 で解決したドメインマップの全文(JSON)と、このディスパッチで担当するタグ
- `:178-179` の「上記のファイルが存在すれば、作業前に必ず読んでください」「ドメインマップ・過去の落とし穴を踏まえて作業してください」を、**ARCHITECTURE をドメインマップの取得元として読ませない**形へ改める。ARCHITECTURE は読み物として渡し、実行に使うマップは明示入力で渡す。
- `:190`「ARCHITECTURE / GOTCHAS のパスは §0 で解決した値をそのまま埋める。サブエージェントに解決させない。」へ、モードとマップも同じ扱いである旨を足す。

**オーケストレーターだけが実行モードを知り、planner / architect が ARCHITECTURE を読み直す設計にしない**(引き継ぎ書 §5 の設計上の最重要注意)。

### 6.4 W4 — ドメイン設定・解除と再開処理をモード対応にする

| 対象 | 変更 |
| --- | --- |
| `orchestrating-runs/SKILL.md:207-239`(§4.1) | `mapped` のときだけ `set-domain` / `clear-domain` を運用する。`unscoped` では `set-domain` を呼ばず、ディスパッチ前に `clear-domain` を呼んで `domain` を残さない |
| 同 `:223-225` | 「`--domain` にはドメインマップのキー(`frontend` / `backend` / `data`、縮退時は `generic`)をそのまま渡す」を、「**ステップに付いたタグの値をそのまま渡す**。汎用担当へ送るときもタグの値を渡し、エージェント名から別名を作らない」へ改める |
| 同 `:271-283`(§6 再開手順) | 手順 1 と 3 の間へ、`state.domainMode` を読んでモードを復元する手順を足す。§5.3 の行 4・行 7 を適用する |
| `plugins/codiel/src/codiel-state.ts:26-48` | `RunState` へ `domainMode?: "mapped" \| "unscoped"` を足す。`domain?`(`:43-47`)と同型のコメントを添え、`version` は据え置く |
| 同 `:241` 周辺(`init` の経路) | `--domain-mode` フラグを受け取り `state.domainMode` に入れる。`--base-branch`(`:241`)と同じ形にする。未指定なら未記録のままとする |
| `orchestrating-runs/SKILL.md:39`・`:102`(`codiel-state init` の呼び出し) | `--domain-mode <モード>` を足す |
| `plugins/codiel/src/hooks/guard-write.ts` | **変更しない**(§5.7) |

### 6.5 W5 — planner の入力と、マップ不在時の分類規則

対象: `plugins/codiel/skills/writing-dev-plans/SKILL.md`

| 箇所 | 現状 | 変更 |
| --- | --- | --- |
| `:30-32`(チェックリスト 2) | 「ディスパッチプロンプトで指定された ARCHITECTURE(指定が無ければ `docs/ARCHITECTURE.md`)の ` ```json metatron:domains ` ブロック(ドメインマップ)を読む。無ければスキップする。**ファイルがあれば必ず読む**」 | **「ディスパッチプロンプトで渡された実行モードとドメインマップを使う。ARCHITECTURE をドメインマップの取得元として読み直さない」**へ改める |
| `:33-34` | 「ドメインマップが `{ "generic": ["**"] }` に縮退している場合、以降の domain タグはすべて `generic` を使う」 | `mapped` かつマップが `generic` 1 つのとき、という条件に限定する |
| 新規 | — | **`unscoped` の分類規則を定める。** 全ステップに `[domain: generic]` を付け、ドメインによる分割を行わない。ステップの分割は依存関係だけで決める |
| `:35-37`(チェックリスト 3) | glob と突き合わせてグルーピングする | `mapped` のときの手順であることを明示する |
| `:76-77` | 「`domain` の値はドメインマップのキー(`frontend` / `backend` / `data`、縮退時は `generic`)のいずれか一つ」 | 「`mapped` では渡されたドメインマップのキー、`unscoped` では `generic`」へ改める。**固定語彙の列挙をやめる** |
| `:81-86`(未分類ファイル規則) | どの glob にも当たらない共有コードを利用側のドメインへ入れる。主たる利用側が一意に決まらないときは `data` → `backend` → `frontend` の順 | 固定語彙の優先順位をやめ、「渡されたマップのキーのうち、依存の起点になるもの」へ一般化する。**あわせて §10 のリスク 3 の扱いを書く** |

### 6.6 W6 — implementer / reviewer の汎用条件と兼任記述の除去

| 対象 | 変更 |
| --- | --- |
| `plugins/codiel/skills/implementing/SKILL.md:34-36` | 「自ドメイン(`[domain: frontend/backend/data]` または縮退時 `generic`)」を「ディスパッチプロンプトで指定された担当タグ」へ改める |
| 同 `:37-39` | 「ディスパッチプロンプトで指定された ARCHITECTURE の `## ドメインマップ` を読む(指定が無ければ `docs/ARCHITECTURE.md`)」を、「ディスパッチプロンプトで渡された実行モードと、担当タグの glob を使う」へ改める。ARCHITECTURE を読み直させない |
| 同 `:91-97`(ドメイン規律) | `:93`「ARCHITECTURE のドメインマップで自分のドメインに割り当てられた glob 配下にのみ書き込む」を「渡された担当タグの glob 配下にのみ書き込む」へ改める。`unscoped` では glob による制限を課さない旨を足す |
| 同 `:10-12`(概要) | 担当エージェントの列挙に `codiel-implementer-generic` を加える |
| `agents/codiel-implementer-backend.md:16` | 「縮退モードでは汎用実装担当を兼ね、`[domain: generic]` タグが付いたステップのみを実施する」を**削除** |
| 同 `:3`(description) | 変更なし(兼任の記述を持たない) |
| 同 `:15`・`:20` | 「`[domain: backend]` タグ」「ARCHITECTURE のドメインマップの backend パス」は、backend 専任として残す |
| `agents/codiel-implementer-frontend.md:16-17` / `codiel-implementer-data.md:16-17` | 「generic 縮退時の汎用実装は codiel-implementer-backend の担当である」「generic 縮退時は呼ばれない」を、`codiel-implementer-generic` を指す形へ書き換える |
| `agents/codiel-reviewer-backend.md:3` | description の「ドメイン縮退時は汎用レビュー担当を兼ねる。」を**削除** |
| 同 `:26` | 「ドメインマップが `generic` 1 つに縮退しているプロジェクトでは、diff 全体を確認する。」を**削除** |
| `agents/codiel-reviewer-doc.md:25` | 「ARCHITECTURE のドメインマップと実装が乖離していないことを確認する。」を、**乖離を報告し、所有者による更新へ引き渡す**形へ改める(§10 のリスク 8) |
| 同 `:26` | 「README、API ドキュメント、ARCHITECTURE など、今回の変更で更新すべきドキュメントの更新漏れを確認する」から ARCHITECTURE を外すか、「更新は所有者が行う」を添える |

### 6.7 W7 — 任意ドメイン名のルーティングと汎用担当の新設

| 対象 | 変更 |
| --- | --- |
| `orchestrating-runs/SKILL.md:195-205`(§4) | `:197` の「ドメインタグ(`frontend` / `backend` / `data`)が付く」という固定語彙をやめる。`:200-202` の対応表を §5.4 のルーティング規則へ置き換える |
| 同 `:203-205`(generic 縮退) | 「implementer は `codiel-implementer-backend` を汎用実装者として使う」「reviewer は `codiel-reviewer-doc` + `-security` + `-backend`(汎用担当)の 3 体で回す」を、`codiel-implementer-generic` / `codiel-reviewer-generic` を使う形へ置き換える |
| 同 `:118`(フェーズ進行表 implement 行) | 担当エージェントの `codiel-implementer-{frontend,backend,data}` に generic を加える |
| 同 `:122`(review 行) | 同型 |
| 同 `:129` | 「ドメインマップが `generic` のみの場合の縮退運用は『ドメインディスパッチ』節を参照」を、実行モードの語へ揃える |
| 新規ファイル | `plugins/codiel/agents/codiel-implementer-generic.md`、`plugins/codiel/agents/codiel-reviewer-generic.md`。**`prompt-smith:agent-creator` で作成する**(要件は §5.5) |

### 6.8 W8 — 常駐用運用ルールから ARCHITECTURE 書き込み指示を外す

| 対象 | 現状 | 変更 |
| --- | --- | --- |
| `plugins/codiel/CLAUDE.example.md:25-27` | 「ARCHITECTURE を更新するときは、コンテキストに更新用 CLI の案内があればその CLI を経由する。**案内が無ければ直接編集する。** 直接編集が hook に拒否されたときは、拒否メッセージに示された CLI で実行し直す。」 | **GOTCHAS 側(`:28-29`)と同型にする。** 「ARCHITECTURE は直接編集しない。更新用 CLI の案内があればその CLI を経由する。案内が無いときは乖離の内容を報告に残し、所有者による更新へ引き渡す」 |
| 同 `:33-35`(規則 1) | 「すべてのフェーズ(init〜finalize)の作業開始前に、**ARCHITECTURE のドメインマップを確認し**、…」 | ドメインマップの確認を必須の前提から外す。渡された前提を使う形へ改める |
| 同 `:48-51`(規則 5) | 「実装の過程でドメインマップが ARCHITECTURE の記述と食い違っていることに気づいたら、**その場で ARCHITECTURE を更新する**。更新せず気づかないふりをして進めた場合、後で発覚した際に GOTCHAS へ記録される対象になる。」 | **「更新する」を「報告する」へ反転する。** 乖離に気づいたら報告し、所有者による更新へ引き渡す。黙って進めることが GOTCHAS 行きである点は残す |
| 同 `:3-13`(記入ガイドの HTML コメント) | `:11`「7 項目は DESIGN.md §9 に定義された規則そのままです」 | 規則の本数が変わらなければそのまま。DESIGN.md 側を追随させる |
| `plugins/codiel/docs/DESIGN.md:389-396`(§9) | `:391-394`「ARCHITECTURE(ドメインマップだけの最小構成)/ CLAUDE.md / raguel.config.yaml は聞き取り(ドメイン分割と保護パス)の回答から生成する」 | ARCHITECTURE を生成物から外す。`:395` の GOTCHAS と同型の 1 文にする |
| 同 `:396` | 「`/codiel:run` は資産配置を行わず、未初期化を検出したら `/codiel:init` を案内して終了する」 | 「未初期化」の定義が B + C + D であることを明示する |
| 同 `:385`(hook の表) | 「`domain` が無いとき・ドメインマップが読めないときは境界を課さない」 | **変更しない。** hook の挙動は据え置くため事実のまま |

### 6.9 W9 — sandalphon の `codielReady` の意味を変える

| 対象 | 変更 |
| --- | --- |
| `plugins/sandalphon/src/check-intent-env.ts:593-594` | `const codielReady = codielDirExists && domains.domainsReadable` を `const codielHandoffCandidate = codielDirExists` にする。コメント「「Codiel の器がある」かつ「ドメイン定義が読める」の論理積(設計書 §7-3)」を、検出事実を返す旨へ書き換える |
| 同 `:798` | 出力キー `codielReady` を `codielHandoffCandidate` へ改名する |
| 同 `:792-797` | `projectDocs.domainsReadable` / `domainCount` は**変更しない**(§3.10) |
| `plugins/sandalphon/skills/bridging-execution/SKILL.md:39` | 「`/codiel:run` が自分の利用可能コマンド一覧にあるか、かつ `codielReady`」→ `codielHandoffCandidate` |
| 同 `:48-49` | 「**委譲を選択肢に出すのは `codielReady` が true のときだけである。**」→ 同上の改名 |
| 同 `:51-53` | 「**`domainsReadable: false` の案内先は、`/metatron:init` が自分の利用可能コマンドにあるかで分岐する。**」以下 3 行を**削除**する。ドメインマップが無くても委譲できるため、案内自体が不要になる |
| 同 `:54` | 「`/codiel:run` が利用可能コマンド一覧に無いときは、案内も出さず委譲に言及しない」は**残す** |
| `plugins/sandalphon/references/sandalphon-common.md:42` | 「`projectDocs.domainsReadable: false` \| Codiel 委譲 \| …」の行を**削除**する。`:41`(`codielHarness.dirExists: false`)は残す |
| 同 `:29` | 「ARCHITECTURE / GOTCHAS のパスは固定値で持たず、`projectDocs` の解決結果を使う」は**残す** |
| `plugins/sandalphon/docs/rationale.md:51-68` | 見出し「## ハーネス初期化の判定を複合条件にした理由」を改題し、`:53-60` を「単一条件にした理由」へ書き換える。`:62-65` と `:67-68` は残す(§5.6) |
| `plugins/sandalphon/skills/capturing-intent/SKILL.md:81` | **変更しない。** 任意参照であり、必須依存ではない |

`src/` を変更するため `pnpm run build` を実行し、`plugins/sandalphon/scripts/` の差分を同じコミットに含める。

### 6.10 W10 — 節名参照の登録簿を追随させる

`plugins/metatron/src/fixtures/section-reference-inventory.json` を 3 方向で更新する(§3.8)。

**(1) V3 で落ちる — 削除する。** ドメインマップ参照を消したファイルの `reference: "ドメインマップ"` エントリを消す。分類 B の 12 件のうち、本設計で「ドメインマップ」の語が消える見込みは次のとおり。実装時に `termsIn` の 4 形(特に (d) `ARCHITECTURE[^\n]{0,40}` + 節名)で再判定する。

| 登録簿の行 | 対象 | 見込み |
| --- | --- | --- |
| `:10-14` | `CLAUDE.example.md` | 消える(W8) |
| `:34-38` | `codiel-implementer-backend.md` | 残る(`:20` の backend パス記述を維持するため) |
| `:46-50` | `codiel-implementer-data.md` | 残る(`:21` 同型) |
| `:58-62` | `codiel-implementer-frontend.md` | 残る(`:21` 同型) |
| `:88-92` | `codiel-reviewer-doc.md` | 判定が要る(W6 の書き換え後に語が残るか) |
| `:118-122` | `commands/init.md` | 消える(W11) |
| `:136-140` | `implementing/SKILL.md` | 判定が要る(W6) |
| `:154-158` | `initializing-harness/SKILL.md` | 消える(W1) |
| `:166-170` | `orchestrating-runs/SKILL.md` | 残る(§0 で解決を続けるため) |
| `:178-182` | `preparing-design-agendas/SKILL.md` | 判定が要る(W14) |
| `:190-194` | `writing-design-docs/SKILL.md` | 判定が要る(W14) |
| `:202-206` | `writing-dev-plans/SKILL.md` | 残る(W5 でマップの語は残る) |

**(2) V2 で落ちる — 追加する。** 新設する `codiel-implementer-generic.md` / `codiel-reviewer-generic.md` が `ARCHITECTURE` の語を含むなら、分類 C として登録する(既存 agent の `note`「ディスパッチプロンプトで指定されたパスを読むだけ」に倣う)。ドメインマップの語を含むなら分類 B も要る。

**(3) ANY の残存を確認する。** 「ドメインマップ」の語を消しても `ARCHITECTURE` の文字列が残れば `(ARCHITECTURE への言及)` エントリは維持する。逆に ARCHITECTURE の語ごと消したファイルは分類 C / D のエントリも削除する。特に `initializing-harness/SKILL.md`(`:159-164` に分類 D)と `commands/init.md`(`:129-134` に分類 D)は W1・W11 で ARCHITECTURE の語が大きく減るため、要判定である。

`plugins/metatron/src/__test__/section-reference-inventory.test.ts` は**変更しない**。V1 / V2 / V3 がそのまま通ることを確認する。

### 6.11 W11 — README・コマンド説明の追随

| 対象 | 現状 | 変更 |
| --- | --- | --- |
| `plugins/codiel/README.md:15-19` | 「ARCHITECTURE(既定 `docs/ARCHITECTURE.md`)が無い場合は、run の開始に必要な最小構成(ドメインマップだけを持つファイル)を生成します。」 | 削除し、`/codiel:init` が生成するものから ARCHITECTURE を外す |
| 同 `:21-26` | `:21`「Codiel は単体で完結します。」 | **残す。** 本設計は単体完結性を強める。ただし `:22-24`「併用時は最小構成の ARCHITECTURE をそのまま活かして残りの節を足せます」は前提が消えるため書き換える。`:25-26` の GOTCHAS の記述に倣い、ARCHITECTURE も metatron が管理する旨を書く |
| `plugins/codiel/commands/init.md:2`(description) | 「…対話で聞き取るのはドメイン分割と保護パスだけで、ARCHITECTURE が無ければドメインマップだけの最小構成を生成する(技術スタックや規約まで含む ARCHITECTURE が要るときは /metatron:init を先に使う)。GOTCHAS は生成しない(台帳の生成は metatron が行う)」 | 聞き取り対象を保護パスだけにし、ARCHITECTURE の生成に関する記述を GOTCHAS と同型へ揃える |
| ルート `README.md:71` | 「`/codiel:init` はドメイン分割と保護パスの聞き取りだけを行い、ARCHITECTURE の散文や GOTCHAS は生成しません。Metatron が無くても最小の ARCHITECTURE を自前で作って動きますが、…」 | 「最小の ARCHITECTURE を自前で作って動きます」を削除し、「ドメインマップが無くても動きます」へ改める |
| 同 `:146` | 「Codiel は Metatron が無くても最小の ARCHITECTURE を自前で作り、…」 | 同型に改める |

### 6.12 W12 — ADR を切る

`harness-docs/ARCHITECTURE.md:123` の `## ADR 一覧` に追加する。現在 ADR-001(`:125`)と ADR-002(`:153`)があるため、CLI が **ADR-003** を採番する。

| 項目 | 内容 |
| --- | --- |
| タイトル | `[codiel] ドメインマップは metatron の資産とし、codiel は無くても汎用実行する` |
| 状態 | 採用 |
| 背景 | `/codiel:init` が ARCHITECTURE を生成・修復し、`orchestrating-runs` §0 が `domains: null` を「未初期化」と断定して run を終了させていた。ドメインマップは metatron の構造記述であり、codiel が作成・修復する立場にない |
| 選択肢 | ① 正本を `.codiel/config.json` へ移す ② `raguel.config.yaml` 最上位へ置く ③ `rules.<ruleId>` 配下へ置く ④ metatron へ完全移管し codiel を metatron 必須にする ⑤ 正本を動かさず writer だけ止め、`domains: null` を generic へ自動縮退させる ⑥ 正本を動かさず writer を止め、「読めない理由」で正当な不在と異常を分ける(採用) |
| 結論 | ⑥ を採用。ドメインマップは ARCHITECTURE に残し、codiel は作成・修復しない。run は実行モード(`mapped` / `unscoped`)を決めて開始し、モードを run state に記録する |
| 根拠 | 独自ドメイン境界の設定は必須要件ではない(ユーザー判断)ため、新しい恒久設定・契約・ルート探索を導入する必要が無い。`domains: null` は 5 状態の混合であり(§3.2)、一括縮退は「正当な不在」と「壊れたマップ」を同一視する |
| 影響 | codiel は ARCHITECTURE を書かなくなる。任意ドメイン名は汎用担当へルーティングされる。sandalphon の委譲判定からドメイン可読性が外れる。凍結契約 `:70` の 1 行を改訂する |

**将来設計(Agents → Skills)とは別の ADR にする。** ドメインマップの消費責務は Agents 削除では自動的に減らない。削除されるのは担当者定義の置き場所であって、計画の分割・実装範囲の指定・レビュー観点の選択・write ゲートという責務ではない。

ADR の追加は ARCHITECTURE の直接編集ではなく `stage-adr` → `commit-architecture` で行う。

### 6.13 W13 — 契約凍結文書の変更を実施する

§7 に全文案と §15 チェックリストの要否判定を置く。

### 6.14 W14 — architect 系スキルを明示入力へ揃える

| 対象 | 現状 | 変更 |
| --- | --- | --- |
| `plugins/codiel/skills/preparing-design-agendas/SKILL.md:20-23` | 「ディスパッチプロンプトで指定された ARCHITECTURE(ドメインマップ)と GOTCHAS(既知の落とし穴)を読む。指定が無ければ `docs/ARCHITECTURE.md` / `docs/GOTCHAS.md` を使う。ファイルが無ければスキップする。**存在するファイルは必ず読む**」 | ドメインマップは**渡された値**を使う形へ改める。ARCHITECTURE 自体は読み物として読んでよい。既定パスへのフォールバックをやめ、渡されなければ使わない |
| `plugins/codiel/skills/writing-design-docs/SKILL.md:27-30` | 同型の記述 | 同型に改める |

両者とも `writing-dev-plans/SKILL.md:30-32` と同じ「ファイルを読ませる」形であり、これを残すと planner だけを直しても三重状態が再発する。

### 6.15 実装層の変更(まとめ)

| ファイル | 変更 |
| --- | --- |
| `plugins/codiel/src/hooks/lib.ts:465-503` | `DomainsUnreadableReason` を追加し、`DomainsRead` へ `unreadable` を足す。`readDomainsResult` の 5 つの return に理由を入れる。`validateDomainsValue`(`:451-463`)と `findDomainsBlocks` の警告生成は**変更しない**。`readDomains`(`:509-511`)も**変更しない** |
| `plugins/codiel/src/codiel-state.ts:26-48`・`:241` 周辺 | `RunState.domainMode` の追加と、`init` の `--domain-mode` 受け取り |
| `plugins/codiel/src/hooks/guard-write.ts` | **変更しない** |
| `plugins/sandalphon/src/check-intent-env.ts:593-594`・`:798` | §6.9 |

`plugins/codiel/build.ts:5-12` の entryPoints は `lib` と `codiel-state` を含むため、**`pnpm run build` で `plugins/codiel/scripts/lib.mjs`・`guard-write.mjs`・`codiel-state.mjs` が再生成される**。`plugins/*/scripts/` を手で編集しない。

**`guard-write.ts` のソースは不変だが、`lib.ts` を import している(`guard-write.ts:11`)ためバンドル出力 `guard-write.mjs` は再生成される。** §5.7 と矛盾しない。据え置くのは hook の挙動とソースであって、バンドル成果物の再生成は避けられない。

---

## 7. 契約凍結文書の変更案と §15 チェックリストの要否判定

### 7.1 変更が要るのは 1 行だけである

契約 15 節を走査した結果、本設計の影響を受けるのは `harness-docs/design/2026-08-16-file-contract-freeze.md:64-75`(例外: PreToolUse hook の限界)のうち **`:70` の 1 行だけ**である。

影響を受けない箇所(確認済み): `:30`(旧マーカー)、`:77-86`(検証 4 項目)、§2(`metatron.config.json`)、§3(ルート解決。docRoot → codielRoot はスコープ外)、§4(ARCHITECTURE の書式)、§5〜§14。

### 7.2 変更案(全文)

変更前(`:68-71`):

```
  警告が届く経路は次の 3 つである。
  - CLI(`readDomainsResult` を直接呼ぶ経路)
  - skills の検証コマンド(codiel `initializing-harness` の手順 5、`orchestrating-runs` の §0)
  - `ask` の理由(境界判定が誤っているかもしれない文脈に添える)
```

変更後:

```
  警告が届く経路は次の 3 つである。
  - CLI(`readDomainsResult` を直接呼ぶ経路)
  - skills の検証コマンド(codiel `orchestrating-runs` の §0)
  - `ask` の理由(境界判定が誤っているかもしれない文脈に添える)
```

**`orchestrating-runs` の §0 は名指しを残す。** W2 で停止条件は変わるが、`readDomainsResult` を呼んで `warnings` を提示する処理(`orchestrating-runs/SKILL.md:56-65`・`:73-74`)は実行モードの決定に必須であり、警告の到達経路として存続する(§5.3)。

**`initializing-harness` の手順 5 は名指しを外す。** §1 の 6-5 の決定により ARCHITECTURE 検証を完全に消すため(§6.1)、この名指しが事実と食い違う。

`file-contract-freeze.md:18` は「本書の内容を変更する必要が生じたときは、実装を止めてユーザーに確認する」と定める。**この変更文面は 2026-09-15 にユーザーへ提示し、承認を得た**(同条の規定に基づく確認)。**実装時にそのまま適用してよい。**

### 7.3 §15「契約を変更したときのチェックリスト」9 項目の要否

`file-contract-freeze.md:861-873`。

| # | チェック項目 | 要否 | 根拠 |
| --- | --- | --- | --- |
| 1 | metatron `src/lib/config.ts`(および `architecture.ts` / `gotchas.ts` / `adr.ts`) | **不要** | 検証 4 項目(読めた/読めないの判定規則)を変えないため |
| 2 | metatron `references/config-schema.md` / `architecture-format.md` / `gotchas-format.md` | **不要** | 同上 |
| 3 | codiel `src/hooks/lib.ts` の `findDocRoot` / `resolveDocPaths` / `readDomains` | **要** | §5.2 の `readDomainsResult` 拡張が該当する。`findDocRoot` / `resolveDocPaths` / `readDomains` 自体は変えない |
| 4 | codiel `skills/recording-gotchas/SKILL.md` の書式の写し | **不要** | GOTCHAS の書式であり本件と無関係 |
| 5 | sandalphon `src/check-intent-env.ts` | **要** | §6.9 の `codielReady` 変更が該当する |
| 6 | sandalphon `references/intent-format.md` / `handoff-contract.md` | **不要** | **一次確認済み。** §7.4 |
| 7 | gh-utility `issue-craft` の持ち込みモードの写し | **不要** | 契約 §11 の持ち込みモード契約であり本件と無関係 |
| 8 | codiel `analyzing-issues` / `preparing-design-agendas` の写し | **不要** | このチェック項目が指すのは契約 §10-3(issue.md への写像表)の写しであり、ドメインマップと無関係。`preparing-design-agendas` は W14 で別途変更するが、写像表の写しとしての変更ではない |
| 9 | テスト R4 / 16f(3 者比較) | **不要** | **一次確認済み。** §7.5 |

### 7.4 項目 6 の一次確認結果 — 追随不要

`plugins/sandalphon/references/intent-format.md` と `plugins/sandalphon/references/handoff-contract.md` の全文を確認した。

- **`handoff-contract.md`** は gh-utility `issue-craft` の持ち込みモード(`title` / `body` / `labels` の 3 フィールドと承認ゲート)だけを定める。codiel への委譲条件にも `codielReady` にも一切触れない。全 26 行に該当記述は無い。
- **`intent-format.md`** に `codielReady` / `domainsReadable` / `codielHarness` の語は 1 件も無い(grep で 0 件)。`ARCHITECTURE` の語は `:111` の 1 箇所だけで、「ARCHITECTURE 側のフェンス除外と規律が異なるのは意図した非対称であり、揃えない」という**マーカー検知規律の対比**として現れる。`:91` の「Codiel へ委譲したときは `issued` のまま残す」は委譲**後**の status の扱いであり、委譲の**可否条件**ではない。

したがって、本改修(`codielReady` の条件と名前の変更)はこの 2 ファイルのどの記述も偽にしない。**追随不要。**

なお `intent-format.md` は登録簿に分類 D で載っている(`section-reference-inventory.json:214-218`。`note`「マーカー検知の説明で例として触れているだけ」)。本設計は同ファイルを変更しないため、この登録も変わらない。

### 7.5 項目 9 の一次確認結果 — 影響なし

`plugins/sandalphon/src/__test__/check-intent-env.test.ts:886-984` の `expectThreeWayMatch` を読み、`readDomainsResult` への `unreadable` 追加が 3 者比較に影響しないことを確認した。

比較箇所は次の 3 つで、いずれも**フィールド単位**である。

- `:930-933` — `codielDomains.domains` を `toStrictEqual` で metatron の `extractDomains().domains`(または `null`)と比較する。**比較対象は `.domains` プロパティであり、`DomainsRead` オブジェクト全体ではない。**
- `:934-937` — `readDomains(startDir) !== null` を `metatronDomains.ok` と比較する。`readDomains`(`lib.ts:509-511`)は `.domains` を返すだけで、本設計では変更しない。
- `:940-943` — `codielDomains.warnings.length` を比較する。`warnings` の生成規則は変更しない。

sandalphon 側(`:973-983`)は `projectDocs.domainsReadable` と `domainCount` を比較するが、`check-intent-env.ts` の `readDomains`(`:514-543`)には手を触れないため不変である。

**したがって「3 者比較の対象が検証 4 項目(読めた/読めないの判定)だけなら影響しない」という見立ては妥当である。** ただし補足が要る。3 者比較は判定の真偽だけでなく **ドメイン定義の値そのものの deep equality** と **警告の件数** も突き合わせている(`.serena/memories/file_contract.md:24-32` の表と一致)。本設計はそのいずれも変えないため、結論は変わらない。

**影響を受けるのは 3 者比較ではなく codiel 単独のテストである。** `plugins/codiel/src/hooks/__test__/lib.test.ts:531-537` がオブジェクト全体を `toStrictEqual` で比較しており、フィールド追加で落ちる。§9 で扱う。

---

## 8. 影響ファイル一覧

### 8.1 codiel(実装層)

- `plugins/codiel/src/hooks/lib.ts`(`DomainsRead` の拡張)
- `plugins/codiel/src/codiel-state.ts`(`RunState.domainMode` と `--domain-mode`)
- `plugins/codiel/scripts/lib.mjs` / `guard-write.mjs` / `codiel-state.mjs`(`pnpm run build` による再生成)

### 8.2 codiel(指示層)

- `skills/initializing-harness/SKILL.md`(W1)
- `skills/orchestrating-runs/SKILL.md`(W2・W3・W4・W7)
- `skills/writing-dev-plans/SKILL.md`(W5)
- `skills/implementing/SKILL.md`(W6)
- `skills/preparing-design-agendas/SKILL.md`・`skills/writing-design-docs/SKILL.md`(W14)
- `agents/codiel-implementer-{backend,frontend,data}.md`・`agents/codiel-reviewer-{backend,doc}.md`(W6)
- `agents/codiel-implementer-generic.md`・`agents/codiel-reviewer-generic.md`(**新規**。W7)
- `CLAUDE.example.md`(W8)
- `commands/init.md`(W11)

### 8.3 codiel(文書)

- `docs/DESIGN.md`(W8)
- `README.md`(W11)

### 8.4 sandalphon

- `src/check-intent-env.ts` と `scripts/check-intent-env.mjs`(再生成)
- `skills/bridging-execution/SKILL.md`・`references/sandalphon-common.md`・`docs/rationale.md`(W9)

### 8.5 metatron

- `src/fixtures/section-reference-inventory.json`(W10)
- `.claude-plugin/plugin.json` / `package.json`(§5.8。`0.3.3-dev`)

### 8.6 リポジトリ共通

- `harness-docs/design/2026-08-16-file-contract-freeze.md`(W13)
- `harness-docs/ARCHITECTURE.md` の `## ADR 一覧`(W12。`stage-adr` → `commit-architecture` 経由)
- ルート `README.md`(W11)
- `plugins/codiel/.claude-plugin/plugin.json` / `package.json`、`plugins/sandalphon/.claude-plugin/plugin.json` / `package.json`(§5.8)
- `.serena/memories/codiel/core.md`(`:19-33` が `/codiel:init` の最小 ARCHITECTURE 生成を記述しており、本改修で偽になる)、`.serena/memories/sandalphon/core.md`(`codielReady` の記述があれば追随)

---

## 9. テスト方針

### 9.1 既存テストを書き換えない範囲

- **`plugins/codiel/src/hooks/__test__/guard-write.test.ts` を書き換えない。** `:295-306`(マップが在ってドメイン名が無ければ ask)、`:308-316`(マップが読めなければ素通し)、`:318-328`(generic はどのパスでも素通し)がそのまま通ることを確認する。**書き換えが要ると判断したら、その時点で実装を止めてオーケストレーターへ報告する。**
- **`plugins/sandalphon/src/__test__/check-intent-env.test.ts` の 16f 群を書き換えない**(`:886-984` と `:986` 以降のケース)。§7.5 のとおり影響しない。
- **`plugins/metatron/src/lib/__test__/config.test.ts` の R4-a〜R4-f(`:274`-`:338`)を書き換えない。** metatron 単独のルート解決テストであり、ドメインマップに触れない。
- **`plugins/metatron/src/__test__/section-reference-inventory.test.ts` を書き換えない。** V1 / V2 / V3 が通るよう fixtures 側を直す。

### 9.2 更新が要る既存テスト

| 対象 | 理由 |
| --- | --- |
| `plugins/codiel/src/hooks/__test__/lib.test.ts:531-537` | `expect(readDomainsResult(root)).toStrictEqual({ domains: null, warnings: [] })` がオブジェクト全体を比較しており、`unreadable` 追加で落ちる。`unreadable: "architecture_missing"` を含む形へ更新する |
| 同 `:405-501` の R11 群 | `.domains` / `.warnings` をフィールド単位で見ているため原則そのまま通る。実行して確認する |
| `plugins/sandalphon/src/__test__/check-intent-env.test.ts` のうち出力キーを名指しするケース | `codielReady` を参照するアサーションがあれば `codielHandoffCandidate` へ改名する。16f 群は対象外 |

### 9.3 新規テスト

| # | 対象 | 内容 |
| --- | --- | --- |
| 1 | `lib.test.ts` | `unreadable` が 5 状態を区別する。ARCHITECTURE 不在 → `architecture_missing`、ブロック不在 → `block_missing`、JSON 不正 → `invalid_json`、形式不正(検証 4 項目の 2〜4 それぞれ)→ `invalid_shape` |
| 2 | `lib.test.ts` | 読めたときは `unreadable === null` かつ `domains !== null` である |
| 3 | `lib.test.ts` | **`unreadable` の追加前後で `domains` と `warnings` が不変であること。** 既存の R11 群(`lib.test.ts:405-501`)の入力を流用し、検証 4 項目の判定が変わっていないことを固定する(契約が割れないことの機械的担保) |
| 4 | `codiel-state` のテスト | `init --domain-mode mapped` / `unscoped` が `state.json` へ記録される。未指定なら `domainMode` を持たない。`version` が変わらない |
| 5 | `codiel-state` のテスト | `domainMode` を持たない既存 state をそのまま読める(optional 追加の後方互換) |
| 6 | `check-intent-env.test.ts` | `codielHandoffCandidate` が `.codiel/` の有無だけで決まる。**ドメインマップが読めなくても true になる**(本改修の核心の回帰テスト) |
| 7 | `check-intent-env.test.ts` | `projectDocs.domainsReadable` / `domainCount` は従来どおり返る |

テストは対象ソースと同じディレクトリの `__test__/` に置き、`<対象ファイル名>.test.ts` とする(テスト方針)。

### 9.4 登録簿テストの 3 方向(W10)

`pnpm run test` で V1 / V2 / V3 が通ることを確認する。落ちたときの出力がそのまま登録簿の候補一覧になる(`section-reference-inventory.test.ts:143-144`)。

1. **V3(削除)** — 参照を消したファイルのエントリが残っていないか。
2. **V2(追加)** — 新設 agent 2 本の参照が登録されているか。
3. **ANY の残存** — 「ドメインマップ」の語だけ消して `ARCHITECTURE` が残るファイルの分類 C / D エントリを消していないか。

### 9.5 実装順序

行き先が無いまま run が通る状態を一瞬も作らないため、次の順で進める(§1 の 6-4 (b))。

1. 実装層(`lib.ts` の `unreadable`、`codiel-state.ts` の `domainMode`)とそのテスト → `pnpm run build`。
2. **W7 の汎用担当エージェント 2 体の新設と W6 の兼任解除**(穴を先に塞ぐ)。
3. W2・W3・W4(停止条件を実行モードへ置き換える)。
4. W5・W14(planner / architect の明示入力化)。
5. W1・W8・W11(writer の停止と配布物の追随)。
6. W9(sandalphon)→ `pnpm run build`。
7. W10(登録簿)→ `pnpm run test`。
8. W13(契約。**ユーザー承認後**)・W12(ADR)。

---

## 10. リスクと受容

引き継ぎ書 §7 の 8 点それぞれに、本設計での扱いを書く。

| # | リスク | 本設計での扱い |
| --- | --- | --- |
| 1 | **run 中・再開時のモード変化。** 最初はマップなしで汎用実行し、後から有効なマップが出現すると hook が再読して `generic` 未登録の `ask` を返しうる。逆にマップ消失で境界が消える | **解消する。** モードを run state に記録し(§5.1)、再開時は記録を正とする。§5.3 の行 4・行 7 で、記録と実測の食い違いを止めて確認する。`unscoped` では `set-domain` を呼ばないため、マップが出現しても `guard-write.ts:136` の `if (domain && ...)` に入らず `ask` は起きない |
| 2 | **指示と hook の入力が別物になる三重状態** | **解消する。** 実行に使うモードとマップは明示入力として渡す(W3)。planner / architect / implementer は ARCHITECTURE をマップの取得元として読み直さない(W5・W6・W14)。`unscoped` では hook 側も必ず `domains === null` になる(§5.1) |
| 3 | **未分類ファイルの既存矛盾。** `writing-dev-plans/SKILL.md:81-86` の「どの glob にも当たらない共有コードを利用側のドメインへ入れる」は、`guard-write.ts:167-174` の範囲外 `ask` と衝突する | **受容し、扱いを明記する。** タグは付くが glob に一致しないため `ask` になる。この `ask` は正当な合図であり、握り潰さない。W5 で「どのドメインにも属さないパスへ書くときは `ask` が返る。止まったら、そのパスを担当ドメインの glob に含める変更を ARCHITECTURE の所有者へ報告するか、ステップを再計画する」を書く。**codiel 自身が ARCHITECTURE を直しに行かない**ことが本改修の趣旨である |
| 4 | **A を将来採る場合の設定自己変更。** `.codiel/` 配下へ境界設定を置くと作業者が境界自体を変更できる | **発生しない。** 案A は却下済みで、本設計は新しい恒久設定ファイルを作らない。`state.json` は `codiel-state` 経由でしか書けず(`CLAUDE.example.md:40-43`)、Edit / Write は hook が deny する |
| 5 | **ルート変更は独立した破壊的変更。** docRoot → codielRoot の切替は同じ glob の意味を変える | **混ぜない。** 本設計は `findDocRoot` / `resolveDocPaths` に手を触れない(§3.10)。`guard-write.ts:137-151` の座標系の使い分けもそのまま |
| 6 | **`generic` はプロジェクト外への隔離を保証しない。** `globToRegExp`(`lib.ts:42-56`)で `**` が `.*` になり、親方向の相対パスを排除しない | **受容する。** 本設計は `globToRegExp` を変えない。`unscoped` を「プロジェクト内で自由」と説明せず、「**ドメインによる境界を課さない**」と書く。パス安全性は別の層(Raguel の保護パス、`guard-bash`)が担う |
| 7 | **GOTCHAS の所有権は別途残る** | **解消済み。** §12 |
| 8 | **文書レビューによる間接的な書き込み要求。** ARCHITECTURE 更新漏れを「修正必須の所見」にすると、実装担当が更新へ戻る | **解消する。** `codiel-reviewer-doc.md:25-26` を「乖離を報告し、所有者による更新へ引き渡す」形へ改める(W6)。`CLAUDE.example.md:48-51` の規則 5 も同じ向きへ反転する(W8) |

### 10.1 本設計が新たに持ち込むリスク

| # | リスク | 受容の判断 |
| --- | --- | --- |
| 9 | `unscoped` では write ゲートのドメイン境界が一切効かない | 受容する。もともと `guard-write.ts:156` はマップが読めなければ境界を課さない設計であり(§3.3)、`unscoped` はその状態を**明示的に選んだ**ものである。フェーズ境界(`:108-115`)・`.codiel/specs/**` の保護(`:117-121`)・Raguel の保護パスは従来どおり効く |
| 10 | 汎用担当エージェントの観点が薄く、レビュー品質が下がりうる | 受容する。backend 観点を無関係なドメインへ当てる現状(§3.6)より悪化はしない。`codiel-reviewer-doc` / `-security` の常時参加は維持される |
| 11 | `unreadable` の値を指示層が読み違え、正当な不在を異常として止める | §5.3 の分岐表を機械的に決まる形で書き、5 つの理由値すべてに行き先を与えることで抑える。テスト 1・2(§9.3)で理由値の対応を固定する |

---

## 11. 不採用案

再提案を防ぐため、却下の理由を残す。

| 案 | 内容 | 却下理由 |
| --- | --- | --- |
| A | 正本を `.codiel/config.json` へ移し、codiel / sandalphon から `metatron:domains` 読み取りを削除する。glob の基準を docRoot から codielRoot へ切り替える | ユーザーが「metatron 不在でも利用者が独自の複数ドメイン境界を設定できることは必須要件ではない」と判断したため、新しい恒久設定・契約・ルート探索・自己変更保護を導入する必要が消えた。前提の 1 つ(「Agents → Skills で消費者が 3 系統のうち 2 つ消える」)は 2 名の助言者から否定されている |
| B | `raguel.config.yaml` の**最上位**に `domains:` を置く | **不成立。** `plugins/codiel/raguel-mcp/src/config/schema.ts:75-85` の `configSchema` は素の `z.object()` で `.strict()` も `.passthrough()` も無い。zod の既定は未知キーの strip であり、エラーも出ず結果から黙って消える |
| C | `raguel.config.yaml` の `rules.<ruleId>` 配下に置く | 意味論が「ルールのパラメータ」であり構造記述ではない。さらに `rules."plan/scope-keywords".domains` が既存で、意味は**キーワード文字列の配列**である(`plugins/codiel/raguel-mcp/src/rules/plan/scopeKeywords.ts:39-41`)。名前が衝突する |
| D | ドメインマップを metatron へ完全に寄せ、codiel を metatron 必須にする | codiel の write ゲート・implementer / reviewer 選択が metatron 必須になり、metatron 無しでは run が起動不能になる。`plugins/codiel/README.md:21`「Codiel は単体で完結します」と正面衝突する |
| G | 正本を動かさず writer だけ止め、`domains: null` を in-memory で `generic` へ一括縮退させる | **方向は採用、核心部を修正。** `domains: null` は 5 状態の混合であり、うち 2 つは `warnings` も空である(§3.2)。「警告を出して generic にすれば安全」は現状の戻り値では成立しない。「明示された generic」と「null」は同じではない |
| — | 「ドメイン名 → スキル名」の対応をドメイン定義に持たせる | 本リポジトリ自身の ARCHITECTURE のキー(`impl` / `prompt` / `bundle` / `manifest` / `docs`)は `frontend` / `backend` / `data` のどれでもない。持たせると既存の穴を新しい形で再生産する。対応は codiel のディスパッチ層に置く(§5.4) |
| — | 汎用担当を新設せず、`codiel-implementer-backend` の兼任を任意キーへ拡張する | 縮退時に足されるのは「diff 全体を見よ」という範囲の指示だけで、**観点は差し替わらない**(§3.6)。`docs` ドメインの変更を backend 観点でレビューすることになる |
| — | `orchestrating-runs` §0 で `fs.existsSync` を直接呼んで ARCHITECTURE の有無を判定する | 判定ロジックを指示層へ散らすと hook 層と指示層で解釈が割れ、三重状態の温床になる。判定は `readDomainsResult` の内側に閉じる(§5.2) |
| — | `capturing-intent/SKILL.md:81` の任意参照も削除する | 「必須依存の解消」と「任意参照の全廃」は別である。同行は自ら「これは強化であって前提ではない」と明記している |

---

## 12. 並行改修との関係

**GOTCHAS 所有権の metatron 移管は完了・コミット済みであり、衝突リスクは解消している。**

- コミット `0fa7820 feat(metatron): GOTCHAS の台帳を init で生成する` で入っている。
- `init-gotchas` CLI は実在する(`plugins/metatron/src/cli/paths.ts:59-60`)。`get gotchas-template` も同ファイル `:77` に載っている。
- `plugins/codiel/CLAUDE.example.md` は GOTCHAS 側が既に「GOTCHAS は直接編集しない。更新用 CLI の案内があればその CLI を経由する。案内が無いときは記録内容を報告に残し、台帳へ入れる手段を添える。」(`:28-29`)へ書き換わっている。
- 残っているのは **ARCHITECTURE 側の `:25-27`**(「案内が無ければ直接編集する」)だけであり、これを本設計が引き取る(W8)。
- `plugins/codiel/docs/DESIGN.md:395` も GOTCHAS 側は「`/codiel:init` の対象ではない。台帳の生成は metatron が行う」へ更新済みで、ARCHITECTURE 側(`:391-394`)が残っている。
- 先行改修により codiel は既に `0.7.0-dev` へ到達しているため、**バージョンは条件付きではなく固定値で書ける**(§5.8)。

したがって、引き継ぎ書 §7-7 の「別改修で対応中。着手順とコンフリクトに注意する」は**古い情報である**。本設計は着手順の制約を受けない。

**残る非対称は本設計で解消される。** 改修後、ARCHITECTURE と GOTCHAS はどちらも「codiel は直接編集しない。所有者(metatron)の CLI 経由か、報告して引き渡す」で揃う。

---

## 13. Done 条件

- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` が通る。
- `plugins/codiel/src/` と `plugins/sandalphon/src/` を変更するため `pnpm run build` を実行し、`plugins/codiel/scripts/` と `plugins/sandalphon/scripts/` の差分が同じコミットにある。
- `plugins/*/scripts/` を手で編集していない。
- `plugins/codiel/src/hooks/__test__/guard-write.test.ts` を書き換えていない。`:295-328` の 3 つの振る舞いが通る。
- 3 者比較テスト(`check-intent-env.test.ts` の 16f 群、`config.test.ts` の R4-a〜R4-f)を書き換えていない。通る。
- 登録簿テスト V1 / V2 / V3 が通る。
- codiel の `plugin.json` と `package.json` が `0.8.0-dev`、sandalphon が `0.2.0-dev`、metatron が `0.3.3-dev` で、それぞれ 2 ファイル揃っている。
- ルート `README.md` と `plugins/codiel/README.md` に反映されている。
- ADR-003 を `stage-adr` → `commit-architecture` で追加し、ARCHITECTURE に影響する変更を `/metatron:update` で追随させている。
- 契約凍結文書 `:70` の変更(§7.2。**2026-09-15 に承認済み**)を適用している。
- 指示書(SKILL.md / agents / references / `CLAUDE.example.md`)の文面確定を `prompt-smith:prompt-smith` で行っている。新規 agent 定義の作成を `prompt-smith:agent-creator` で行っている。description の作成・改善を `prompt-smith:skill-creator`(スキル・コマンド)と `agent-creator`(agent)で行っている。
- `.serena/memories/codiel/core.md` の `/codiel:init` に関する記述(`:19-33`)を更新している。

---

## 14. オーケストレーターへの差し戻し

**なし。** 設計の枠(確定事項 §3-1〜§3-5)はすべて具体化できた。枠を変更した箇所は無い。

枠の内側で解釈を決めた点が 2 つあるため、記録しておく。どちらも枠と矛盾せず、追加の判断を要しない。

1. **`unscoped` への到達経路を 2 つに定め、どちらでも `domains === null` になることを設計の不変条件にした**(§5.1・§5.3 の行 5 と行 6 (b))。行 5 はマップが存在せず、行 6 (b) は壊れたブロックが検証 4 項目を満たさないため、理由は違っても hook 層の見え方は同じである。これにより hook 層を変えずに指示層と一致する(§3-4 の要求を満たす)。
2. **`domainMode` が未記録の state は「モード未決」と読み、§0 の判定をやり直す**(§5.1)。codiel は dev ステータスで移行実装は不要だが、読みの定義が無いと未定義値で分岐が割れるため、定義だけを置いた。
