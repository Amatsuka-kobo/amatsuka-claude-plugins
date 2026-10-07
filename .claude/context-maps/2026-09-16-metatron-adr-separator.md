# Context Map: metatron の ADR を水平線(`---`)で区切る

**作成日**: 2026-09-16
**作成者**: Claude Opus 5 (1M context)(コードベース探索統括の役割)
**対象タスク**: metatron が管理する ARCHITECTURE の `## ADR 一覧` において、ADR 同士の境界に Markdown の水平線(`---`)を引く。変更が要る箇所を漏れなく洗い出す。
**関連するBlueprintセクション**: 契約凍結文書 §6(ADR の書式) / §4(セクション分割) / metatron 設計書 §7-4

---

## 1. 目的・スコープ

- as-is: ADR エントリ同士の境界が「空行 1 行 + `### ADR-NNN:` 見出し」だけで、視覚的な区切りがない。
- to-be: ADR ごとの境界に水平線(`---`)が入る。
- スコープ内: `plugins/metatron/src/lib/adr.ts` の直列化・分割、書式契約文書、既存 ADR への遡及適用の可否、テスト。
- スコープ外: GOTCHAS・rules の書式、ドメインマップ、他プラグイン(ADR を読む実装は metatron 以外に存在しない — 全 `plugins/**/*.ts` を grep 済み、ヒットは `node_modules` の誤検出のみ)。

## 2. 現在のコードベース構造

### 2.1 ADR の実体はどこにあるか

**ADR 全文は独立ファイルを持たない。ARCHITECTURE.md 本体の `## ADR 一覧` 節に直書きされる。**

- このリポジトリでの実体: `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins/harness-docs/ARCHITECTURE.md` の 123-217 行(ファイル末尾まで)。
- `get adr` の `path` もこのファイルを指す。`harness-docs/adr/` も `.metatron/` も存在しない。
- 現在 3 件。すべて `- 状態: 採用`、状態変更履歴行は 0 件。
- 現在の区切り(実測):

```
151|`--mcp-servers` はサーバー名、`--mcp-deny` はツール名を受ける。MCP の付与単位は役割ではなく定義になる。
152|
153|### ADR-002: [metatron] GOTCHAS の台帳は init が承認を得て生成する
154|
155|- 状態: 採用
```

  → 見出しレベルは `###`、エントリ間は**空行 1 行のみ**、区切り文字なし。
- `grep -n '^---' harness-docs/ARCHITECTURE.md` は **0 件**。ファイル内の `---` は Markdown 表の区切り(10 / 30 / 112 行、いずれも ADR 節の外)だけ。

### 2.2 重要なファイル一覧

| ファイルパス | 役割・内容の概要 | 重要度 | 備考 |
|--------------|------------------|--------|------|
| `plugins/metatron/src/lib/adr.ts` | ADR の分割・採番・追加・状態変更。933 行 | **High** | 変更の本丸 |
| `plugins/metatron/src/lib/architecture.ts` | 節分割・フェンス走査・節本文の正規化 | High | 直接の変更は不要な見込み(§5.3) |
| `plugins/metatron/src/cli/get.ts` L350-414 | `get adr` の直列化 | Medium | `raw` をそのまま返すだけ |
| `plugins/metatron/src/cli/stage.ts` L185-303 | `runStageAdr` | Low | 整形には関与しない |
| `plugins/metatron/src/cli/commit.ts` L135 | `acceptedKinds: ["architecture","adr"]` | Low | 変更不要 |
| `plugins/metatron/src/inject-context.ts` L287-303 | `renderAdrSummary` | Low | 全文を載せないので区切り無関係 |
| `plugins/metatron/src/guard-docs.ts` | ARCHITECTURE の直接編集を deny | High | 遡及適用の制約(§6) |
| `harness-docs/design/2026-08-16-file-contract-freeze.md` §6(350-395 行) | **ADR 書式の正本** | **High** | エントリ間区切りは未規定 |
| `plugins/metatron/references/architecture-format.md` L94-97 | 指示層向けの書式契約 | High | 同上 |
| `plugins/metatron/docs/format-change-checklist.md` | 追随先チェックリスト | High | **ADR 専用節が存在しない(穴)** |
| `plugins/metatron/src/lib/__test__/adr.test.ts` | 952 行、R-A1〜R-A9 | High | 落ちるケースあり(§8) |
| `plugins/metatron/docs/ARCHITECTURE.example.md` L135-173 | ADR 記入例 1 件 | Medium | 複数エントリが無く区切り見本なし |

## 3. 関連モジュール・データフロー

### 3.1 書き込み経路(`stage-adr` → `commit-architecture`)

```
CLI stage-adr (cli/stage.ts runStageAdr L185)
  └→ adr.ts stageAdr L863            ロックを取り、書き込まずに nextText を算出
       ├→ buildAdrAddition L643       ★ 連結点: L664
       │    └→ renderAdrEntryLines L535   1 エントリの行配列を生成
       │    └→ applyAdrSection L612 → architecture.ts applySectionChanges
       └→ buildAdrStatusChange L700   ★ 挿入点: L766-774
  └→ staging.ts createStaging          nextText を保管、stagingId を発行
CLI commit-architecture (cli/commit.ts)  →  ここで初めてファイルへ書く
```

**整形の要点(2 箇所だけ):**

- `adr.ts:664` — 新規 ADR の連結。
  `const body = existing === "" ? rendered : ${existing}\n\n${rendered}`
  → **エントリ間の接着剤は `\n\n` のリテラル 1 箇所**。ここに区切りを入れる。
- `adr.ts:766-774` — 状態変更の履歴行を `entry.contentEndIndex` の位置へ splice する。

### 3.2 読み出し経路(`get adr`)

```
CLI get adr (cli/get.ts runGetAdr L369)
  └→ adr.ts parseAdrDocument L291
       └→ architecture.ts parseArchitecture / findSection(ADR_HEADING)
       └→ parseEntries L193   ★ 分割ロジックの本体
  └→ serializeAdr L350   entry.raw をそのまま JSON に載せる
```

**分割ロジック(`parseEntries` L193-283):**

- 刻み目は `ENTRY_HEADING_RE = /^( {0,3}###[ \t]+ADR-(\d+):)(.*)$/`(L75)**だけ**。
- `endIndex` = 次のエントリ見出し行、無ければ節末。
- `contentEndIndex` = `endIndex` から**空行だけを**遡って除いた終端。
- `raw` = `joinRaw(lines, startIndex, endIndex)`。
- **`---` を区切りとして扱う既存ロジックは無い。`---` を frontmatter として扱う箇所も ARCHITECTURE 経路には無い**(唯一 `src/lib/rules.ts:154` の `if (lines[0]?.trim() === "---")` が frontmatter 判定だが、これは rules 3 ファイル専用で ARCHITECTURE/ADR には適用されない)。

### 3.3 ARCHITECTURE.md 側の「ADR 一覧」

**別管理ではなく、`## ADR 一覧` そのものが ADR 全文の置き場である。**要約表や目次は存在しない。
`get adr` が返す `path` = ARCHITECTURE のパス、`entries[].raw` = 同ファイル内の当該範囲の原文。
サマリを生成する箇所は SessionStart 注入だけで、`inject-context.ts:287 renderAdrSummary` が
`- ADR-001: タイトル(採用)` の 1 行に落とす。全文は注入しない。

## 4. 既存の実装パターン・規約

- **2 段階コミット**: `stage-*` は書き込まず nextText を算出、`commit-*` が確定する。純関数(`buildAdrAddition` / `buildAdrStatusChange`)とファイル入口(`stageAdr`)が分離されている。
- **フェイルクローズド**: 書き込み経路は `AdrError` で拒否、読み取り経路(`parseAdrDocument`)は例外を投げない。
- **バイト単位の不変性**: 対象セクション以外・既存エントリは書き換えない。テストがこれを固定している。
- **正規表現は先頭 3 スペースまでのインデントを許す**(`^ {0,3}`)。CommonMark に合わせた規約。
- **CRLF 対応**: `scanFences` が EOL を検出し、`normalizeBody` が節の再結合時に EOL を揃える。テスト済み。
- **節分割の規範アルゴリズムは architecture.ts に一本化**。adr.ts は `##` を自前で解析し直さない(adr.ts 冒頭コメント L12-14 の明示的な規律)。

## 5. 変更の影響範囲(Impact Analysis)

### 5.1 直接影響を受ける箇所 — `---` 導入で壊れる(実測で確認済み)

**(A) `buildAdrStatusChange` の履歴行が「次の ADR 側」に入る — 確定的なバグ**

`contentEndIndex` は空行しか遡らない(`lines[contentEndIndex-1].text.trim() === ""`)。
`---` は非空行なので走査がそこで止まり、splice 位置が**区切り線の後ろ**になる。

実測(区切り入りの ARCHITECTURE に対して `stage-adr --input '{mode:status, id:ADR-001, ...}'` を実行した diff):

```
@@ -18,6 +18,8 @@
 
 ---
 
+- 状態変更(2026-09-16): 採用 → 廃止。要件が変わったため
+
 ### ADR-002: 2 番目の判断
```

→ ADR-001 の履歴行が ADR-002 の直前・区切り線の後に置かれる。読み手には ADR-002 の一部に見える。
`parseAdrDocument` は見出しでしか切らないため**パース上は ADR-001 に属したまま**で、エラーにならず気づけない。

**(B) `entry.raw` に後続の `---` が混入する**

`raw` は次の見出しまでを丸ごと取るため、区切り線が**前のエントリ**の末尾に付く。実測:

```
ADR-001 | raw 末尾: "...#### 背景\n\n最初の背景。\n\n---\n\n"
ADR-002 | raw 末尾: "...#### 背景\n\n2 番目の背景。\n"
```

→ `get adr` の消費者に区切り線が漏れる。最後のエントリだけ付かないため非対称になる。
→ テストヘルパ `entryRawById`(adr.test.ts L112)を使う「バイト単位で不変」系のアサーションに効く。

**(C) `buildAdrAddition` が区切りを入れない**

`adr.ts:664` の連結は `\n\n` 固定。区切り入りの文書へ ADR を追加すると、新しいエントリの前にだけ
区切りが無い不揃いな文書になる。実測(区切り入り 2 件へ ADR-003 を追加した diff):

```
 2 番目の背景。
+
+### ADR-003: 3 番目の判断
```

**(D) setext heading の罠**

Markdown では非空行の直後の `---` は水平線ではなく **H2(setext heading)** になる。
`HEADING_RE = /^ {0,3}## (.*)$/` は setext を検出しないのでパーサは無傷だが、レンダリングが壊れる。
→ 区切り線の**直前に必ず空行を置く**こと。`\n\n---\n\n` の形が必須。

### 5.2 間接的に波及する可能性がある箇所

- `normalizeBody`(architecture.ts L680-685)/ `buildSectionText`(L687-699)は節本文の先頭・末尾の空白のみを trim する。**`---` は trim されない**ので、「各 ADR の後ろに置く」設計にすると節末に孤立した水平線が残り、`## ADR 一覧` の次の節との間に余分な線が出る。「各 ADR の前」または「エントリ間のみ」なら発生しない。
- `stage-adr` が返す `diff.sections[].before/after`(`cli/stage.ts` L286-294)は節本文をそのまま載せるため、承認時にユーザーへ提示される文面が変わる。
- `plugins/metatron/docs/ARCHITECTURE.example.md` の記入例(L135-173)は ADR 1 件のみで区切りの見本がない。契約化するなら 2 件に増やす必要がある。

### 5.3 変更を避けるべき・最小限に留めるべき箇所 — `---` で壊れないことを確認済み

- `architecture.ts:105 HEADING_RE = /^ {0,3}## (.*)$/` — `---` は節を切らない。
- `architecture.ts:100 FENCE_OPEN_RE = /^ {0,3}(\`{3,}|~{3,})(.*)$/` — `---` はコードフェンスと解釈されない。`scanFences` は無傷。
- `src/lib/rules.ts:154` の frontmatter 判定 — rules 3 ファイル専用。ARCHITECTURE には呼ばれない。
- `inject-context.ts` — ADR は要約 1 行に落とすので区切りが注入に現れない。
- `cli/diff.ts:174` の `--- <label>` は unified diff のヘッダ。本文行には ` ` / `+` / `-` の接頭辞が付くため衝突しない(実測の diff 出力で確認)。
- **architecture.ts の分解器そのものには手を入れない**(adr.ts 冒頭 L12-14 の規律: 同じ規則の実装を 2 つ作らない)。

## 6. 守るべき既存契約・インターフェース

### 6.1 書式契約の該当規定

**正本: `harness-docs/design/2026-08-16-file-contract-freeze.md` §6-1(L352-373)**

```
### 6-1. エントリ書式
（```markdown ブロックに ### ADR-001: [判断のタイトル] / - 状態: 採用/提案/廃止 /
  - 決定日 / - 決定者 / #### 背景 / #### 検討した選択肢 / #### 採用した結論 /
  #### 理由 / #### 影響範囲 の雛形）

- 見出しは `###`、内部の小見出しは `####` で固定する。
- `状態` の値域は `採用` / `提案` / `廃止` の 3 つ。他は拒否する。
- 採番 `ADR-NNN` は `## ADR 一覧` 配下の `### ADR-NNN:` を**全件走査して最大値 + 1**。
- 追加位置は `## ADR 一覧` 節の**末尾**(GOTCHAS と逆向き)。
- **エントリは削除しない。** 覆した判断は `廃止` の状態で残す。
```

§6-2(L375-385)は状態変更の履歴を「**エントリ末尾に 1 行を追記する**」と定める。§5.1(A) はこの条項の実装が壊れるという話である。

**→ エントリ間の区切り文字は §6 のどこにも規定が無い。**

**指示層向け: `plugins/metatron/references/architecture-format.md` L94-97**

```
## ADR 一覧
- アーキテクチャ上の重要な設計判断を `### ADR-NNN: タイトル` のエントリで並べる。
- 追加と状態変更は `stage-adr` で行う。この節を直接編集しない。
- エントリを削除しない。覆した判断は `廃止` の状態で残す。
```

同 L22: 「ADR の追加と状態変更は `stage-adr` で行う。`heading` に `ADR 一覧` を渡すとエラーになる。」
**→ こちらも区切りは未規定。** 文書内の `---` は Markdown 表の区切り(L8 / L29 / L81)のみで `^---` 行は無い。

### 6.2 書き込み口が 1 つしかないという制約(重要)

`## ADR 一覧` に書き込めるのは **`stage-adr` だけ**である。

- `stage-architecture` は `heading: "ADR 一覧"` を `adr_heading` エラーで拒否する
  (`architecture.ts:376 validateHeadingKey` L388-396)。理由も明記されている:
  「節ごとの差し替えを許すと、採番・`状態` の値域・状態変更履歴の追記をすべて迂回できるためです。」
- Edit / Write / NotebookEdit は `src/guard-docs.ts` の PreToolUse hook が deny する。
- `stage-adr` は「末尾へ 1 件追加」と「1 エントリの状態行 + 履歴行」しか行えない。

**→ 既存 3 件の ADR の間に `---` を遡及挿入する手段が、現状の CLI には存在しない。**(§7 の未解決事項 2)

### 6.3 契約変更時の追随先

`plugins/metatron/docs/format-change-checklist.md` には **ADR 専用の節が無い**。
最も近い「ARCHITECTURE の書式」節(L6-12)の 4 項目のうち、ADR 区切りに関係しうるもの:

| 判定 | 項目 | 指すパス |
|---|---|---|
| 要判断 | 見出し許可リスト(見出し名は変わらないので恐らく不要) | `src/lib/architecture.ts` の `ARCHITECTURE_HEADINGS` / `src/lib/scan.ts` の `ARCHITECTURE_SECTIONS`(scan.ts:38) |
| **必須** | 契約凍結文書。ただし ADR の正本は §4 ではなく **§6** | `harness-docs/design/2026-08-16-file-contract-freeze.md` |
| 除外 | codiel `readDomains` / `initializing-harness` / `orchestrating-runs` | ドメインマップ専用 |
| 除外 | sandalphon `check-intent-env` / `handoff-contract.md` | ドメインマップ専用 |

**チェックリストに未掲載だが追随が要る先:**

- `plugins/metatron/references/architecture-format.md`(L94-97 に区切りの規定を足す)
- `harness-docs/design/2026-08-16-file-contract-freeze.md` §6-1 / §6-2
- `plugins/metatron/docs/ARCHITECTURE.example.md` L135-173(記入例)
- `plugins/metatron/docs/format-change-checklist.md` 自身(ADR 書式の節を新設する)

**契約凍結文書 §15(L861-873)のチェックリスト**のうち該当するのは
`plugins/metatron/src/lib/...adr.ts` と `plugins/metatron/references/architecture-format.md` の 2 項目。
残り(codiel / sandalphon / gh-utility / 3 者比較テスト)は ADR 書式に依存しないため該当しない。

### 6.4 スキル・references 側の ADR 記述(区切りに言及しているものは無い)

`skills/updating-architecture/SKILL.md` L3 / L22 / L24-25 / L29 / L52-58 / L73 / L84、
`skills/capturing-architecture/SKILL.md` L77 / L115 / L189、
`references/writing-discipline.md` L3 / L43 / L62-65 / L67-75、
`references/cli-usage.md` L18 / L23 / L59 / L73-92 / L132-140。
**いずれも「`stage-adr` を使う」「削除しない」「3 条件」等の運用規律で、エントリ間の空行数・区切り文字には触れていない。**
→ 区切りを「実装の出力形式」に留めるなら、これらの追随は不要。契約に昇格させるなら architecture-format.md への追記だけで届く。
`plugins/metatron/agents/` は存在しない。

## 7. 未解決事項・不明点(Open Questions)

| # | 質問内容 | 影響度 | 上流報告先(役割) | 現状の仮定 |
|---|----------|--------|------------------|------------|
| 1 | 区切りの置き方。「各エントリの**間**にだけ挟む」(節の先頭・末尾に線が残らない) / 「各エントリの**前**に置く」(節先頭に線が出る) / 「各エントリの**後**に置く」(節末に孤立した線が残り、次の `##` との間に出る) のどれか | High | 最上位オーケストレーター | 「エントリ間にだけ挟む」。§5.2 の副作用が最も小さい |
| 2 | 既存 ADR 3 件への遡及適用(migration)を行うか。行うなら手段は。**現状の CLI には ADR 節を書き換える口が無い**(§6.2)。選択肢: (a) 適用せず以後の追加分だけ区切る / (b) ユーザーの手で ARCHITECTURE.md を直接編集 / (c) 一度きりの移行コマンドを CLI に足す | **High** | 最上位オーケストレーター | 未定。(a) だと文書が不揃いのまま残る |
| 3 | `---` をパーサの**境界トークンとして扱う**か、**単なる装飾として扱う**か。装飾扱いなら `parseEntries` の刻み目は `### ADR-NNN:` のままでよく、`contentEndIndex` の調整だけで済む。境界トークンにすると本文中の水平線と衝突する | High | 最上位オーケストレーター | 装飾扱い。境界の権威は見出しのままにする |
| 4 | `entry.raw` に後続の区切り線を含めるか除くか(§5.1(B))。除くと `get adr` の出力が対称になるが `raw` の定義(「見出しを含むエントリ全体の原文」adr.ts L150-151)が変わる | Medium | 戦術オーケストレーター | 除く。`contentEndIndex` 方式の調整と同じ判定で実現できる |
| 5 | 契約凍結文書 §6 を改訂するか。凍結文書の変更に ADR を起こす必要があるか(この変更自体が ADR に値するか — §6-3 の 3 条件を満たすか) | Medium | 最上位オーケストレーター | 未定 |
| 6 | `plugins/metatron/docs/format-change-checklist.md` に「ADR の書式」節を新設するか(現状の穴の解消をこの作業に含めるか) | Medium | 戦術オーケストレーター | 含める |
| 7 | バージョンを 0.3.3-dev → 0.3.4-dev(パッチ)と 0.4.0-dev(マイナー)のどちらにするか。書式契約の変更を伴うならマイナー相当 | Low | 戦術オーケストレーター | 変更規模を見て判断 |

## 8. テスト戦略・既存テスト

### 8.1 既存テストの所在と検証内容

| ファイル | 内容 |
|---|---|
| `plugins/metatron/src/lib/__test__/adr.test.ts`(952 行) | 契約 §6 の検証本体。R-A1〜R-A9 |
| `plugins/metatron/src/lib/__test__/architecture.test.ts` L417-496 | ADR 節が低位 API で置換できること、`stage-architecture` が `adr_heading` で拒否すること |
| `plugins/metatron/src/cli/__test__/cli.test.ts` L622-670 | `stage-adr` → `commit-architecture` の E2E。採番・末尾追加・既存節の不変 |
| `plugins/metatron/src/__test__/inject-context.test.ts` L131-183 / L584-598 / L786-800 | ADR がタイトル + 状態のみで注入されること、予算超過で全廃されること |

### 8.2 `---` 導入で落ちる/直しが要るテスト

- **`adr.test.ts` L397-417(R-A8「1 行目は本文と空行で区切られ、2 行目以降は履歴として連続する」)** — `second.text` に対する完全一致文字列アサーション。区切り線が混ざると **確実に FAIL する**。§5.1(A) を検出する唯一のテストでもある。
- `adr.test.ts` L309-330(R-A5) — `at < indexOf("### ADR-003:")` しか見ないため、§5.1(A) のバグを**通してしまう**。区切り線の手前であることを見るアサーションの追加が要る。
- `adr.test.ts` L179-188(R-A2「既存エントリはバイト単位で不変」) — `entryRawById` 比較。区切りの置き方(未解決 1)と `raw` の定義(未解決 4)によって期待値が変わる。
- `adr.test.ts` L54-97 の固定データ `THREE_ADRS` — 区切りを契約化するなら区切り入りに更新する必要がある。
- `cli.test.ts` L622-670 の E2E — 節の全文を比較する箇所がある。

### 8.3 追加すべきテストの方向性

1. 区切り入り文書に対する `buildAdrStatusChange`: 履歴行が**区切り線より前**に入ること(§5.1(A) の回帰固定)。
2. 区切り入り文書に対する `buildAdrAddition`: 新エントリの前にも区切りが入り、節末に孤立した線が残らないこと。
3. 区切りが**無い**既存文書(移行前)に対する後方互換 — 未解決 2 の結論次第。
4. `get adr` の `entry.raw` に区切り線が混入しないこと(未解決 4 の結論次第)。
5. CRLF 文書での区切り(`\r\n---\r\n`)。adr.test.ts L775-788 に既存の CRLF ケースがある。
6. ADR 本文中に水平線が書かれた場合にエントリが分割されないこと(未解決 3 で装飾扱いにするなら)。
7. 空の `## ADR 一覧` への 1 件目の追加で、先頭に区切りが出ないこと。

### 8.4 エッジケース

- ADR が **1 件だけ**のとき(区切りが 0 本であるべき)。
- 節が**空**のとき(`EMPTY_ADR_SECTION` 相当)。
- ADR 本文のコードフェンス内に `---` があるとき(`scanFences` が `insideFence` を立てるので分割には影響しないが、`contentEndIndex` の遡りは `insideFence` を見ていない)。
- 手編集で区切りが不揃いな文書(移行途中)。

## 9. 依存関係・リスク・制約

- 外部依存なし。Node 標準の `fs` のみ。
- **guard-docs hook により、AI は ARCHITECTURE.md を直接編集できない。** 遡及適用には CLI 側の手当てかユーザーの手が要る(§6.2、未解決 2)。
- **`buildAdrStatusChange` のバグ(§5.1 A)はエラーにならず静かに壊れる。** 実装時にテストで固定しないと気づけない。
- コード内コメントの節番号は **契約凍結文書の実際の節番号より 1 小さい**(コメントの「契約 §5-1」= 文書の §6-1)。既知のずれであり、直す/直さないは別論点。実装時に「§5-1 が見つからない」と混乱しないこと。
- ビルド生成物 `plugins/metatron/scripts/*.mjs` は `src/` から `pnpm run build` で再生成する。`scripts/` を直接編集しない。

## 10. 推奨アプローチ(高レベル)

1. 未解決 1 / 2 / 3 をオーケストレーター経由で確定させてから実装に入る。とくに未解決 2(遡及適用)は必要作業量が大きく変わる。
2. 区切り文字列の生成を `adr.ts` の 1 箇所(定数)に閉じ込め、`buildAdrAddition`(L664)と `buildAdrStatusChange`(L766-774)の両方がそれを参照する形にする。連結点が 2 箇所に分かれたまま別々の文字列を持つと、§5.1(A) と同じ種類のずれが再発する。
3. `contentEndIndex` の算出(`parseEntries` L215-220)を「末尾の空行**および区切り線**を除く」へ拡張する。これで §5.1(A)(B) の両方が同時に解ける見込み。境界の権威は `### ADR-NNN:` 見出しのまま変えない。
4. R-A8 のテスト(L397-417)を先に区切り入りの期待値へ書き換えて赤にしてから実装する(TDD)。
5. 契約文書(freeze §6-1 / architecture-format.md L94-97)と記入例の追随を同じコミットに入れ、`format-change-checklist.md` に ADR の節を新設する。

## 11. 補足・暗黙知の可能性が高いポイント

- 「ADR は削除しない、覆したら `廃止` で残す」ため、`## ADR 一覧` は単調に伸び続ける。区切りの視認性の要望はこの性質から来ている。
- `stage-architecture` が ADR 節を拒む設計は意図的な防壁であり、「区切りを入れるために stage-architecture を通す」という迂回は契約違反になる(`validateHeadingKey` のエラーメッセージに理由が明記されている)。
- 契約凍結文書自身が節の区切りに `---` を多用している(§6 の前後 L348 / L397)。リポジトリの文書スタイルとして `---` による区切りは既に使われており、ADR への導入は様式として整合する。
- `renderAdrEntryLines`(L535-573)は区切りを含まない「1 エントリの中身」だけを返す設計になっている。区切りをこの関数の内側へ入れると、状態変更経路(区切りを生成しない)との責務が食い違う。連結側に置くのが構造に合う。

---

**次のステップ提案**:

- この Context Map を基に詳細設計・実装計画を作成してよいか?
- 特に確認してほしい Open Questions: **#1(区切りの置き方)** と **#2(既存 3 件への遡及適用の可否と手段)**。この 2 つで作業量と設計が大きく変わる。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従い、本文は小さく蒸留された状態に保つ。API キー・トークン・パスワードなどの機密情報を記録しないこと。*
