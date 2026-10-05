# ファイル契約(metatron / codiel / gh-utility)

正本: `harness-docs/design/2026-08-16-file-contract-freeze.md`(2026-08-16 凍結)。
実装者はこの文書を**直接読む**。要約を経由すると実装ごとに契約が割れる。
2026-09-27 に上流の intent 用プラグインを codiel へ吸収した。凍結文書は書き換えず、上書きの内容は
`harness-docs/design/2026-09-27-codiel-intent-driven-design.md` §7.5 にある(3 プラグイン → 2 プラグイン、
3 者比較 → 2 者比較、intent 書式の正本は `plugins/codiel/references/intent-format.md`)。

## 構造上の要点(これを失うと壊れる)

- metatron と codiel は互いのインストールパスを解決できない。したがって**ソースを共有せず、同じ規則を
  独立に 2 回実装する**。写しが 2 つある状態が正常であり、共通ライブラリへの統合は不可能。
- **唯一の機械的担保は codiel の 2 者比較テストとテスト R4**
  (`plugins/codiel/src/__test__/check-intent-env.test.ts` の `expectTwoWayMatch`、metatron 側は
  `plugins/metatron/src/lib/__test__/config.test.ts` の R4-a〜f)。metatron の `loadConfig` / `extractDomains` と
  codiel の `resolveDocPaths` / `readDomainsResult` はテストから直接呼び、codiel の `check-intent-env` は
  トップレベル副作用を持つため子プロセスで起動して出力 JSON を突き合わせる。`check-intent-env` は
  `lib.ts` を import するので、実装としては metatron と codiel の 2 つを比べている。
  **このテストを消すと 2 実装のずれを検出する手段がゼロになる。**「重複テストだから」と削らない。
- 契約を変更したら §15 のチェックリスト(2 実装 + metatron references 3 本 + codiel の
  `references/intent-format.md` / `handoff-contract.md` と `preparing-design-agendas` の写し(codiel の `recording-gotchas` は
  2026-09-27 に削除し、GOTCHAS の記録は metatron の `recording-gotchas` に委ねた) +
  gh-utility `issue-craft` の写し + 2 者比較テスト)を同じコミットで更新する。

### 2 者比較テストが実際に比較している項目

`expectTwoWayMatch` が突き合わせるのは以下。**ここに無いものは担保されていない。**

| 項目 | metatron 側の出所 | codiel `lib.ts` 側 | codiel `check-intent-env` 側 |
| --- | --- | --- | --- |
| `docRoot` | `loadConfig().docRoot` | `resolveDocPaths().docRoot` | `out.docRoot` |
| ARCHITECTURE / GOTCHAS の解決パス | `architecturePath` / `gotchasPath` | `architecture` / `gotchas` | `projectDocs.*` |
| 設定警告の有無と**件数** | `warnings` | `warnings` | `configWarnings`(下記の合算) |
| ドメインマップの**値の deep equality** | `extractDomains().domains` | `readDomainsResult().domains` | (返さない) |
| ドメインマップの可読性(真偽) | `extractDomains().ok` | `readDomains() !== null` | `projectDocs.domainsReadable` |
| ドメイン**件数** | キー数 | — | `projectDocs.domainCount` |
| 重複ブロック / 未閉フェンス警告の件数 | `extractDomains().warnings` | `readDomainsResult().warnings` | `configWarnings` に合算 |

- **警告の文言までは一致を求めない**(同期コストが釣り合わないため、意図的)。
- `check-intent-env` は設定警告と文書構造警告を `configWarnings` の 1 本で返すため、比較相手は
  metatron の `loadConfig().warnings` + `extractDomains().warnings` の**合計**である。
- 個別ケースは旧 16f 群(設定の位置、絶対パス / ルート脱出、ネスト git、git バイナリ無し、symlink 経由、
  CRLF、正当な Windows 区切り、壊れた設定、ドメインブロックを呑み込む未閉フェンス、無効な形状、重複ブロック)
  をすべて残した。`.codiel` の探索と `testRunner` のケースは、対応する出力を削ったので消した。

### 構造上の限界(これを誤解するとテストを過信する)

2 者比較は**実装間の差**しか見ない。**同じ誤実装が両方に入れば全項目が一致して通る。**
契約文書に対する正しさは検証していない。したがって契約を変えるときは、テストが通ったことを
根拠にせず §15 のチェックリストで写しを 1 つずつ突き合わせる。

## 条項の要点

- §1 ドメインマップのマーカーは ` ```json metatron:domains `。**旧 `codiel:domains` は読まない**
  (互換読み・移行スクリプト・二重マーカーを一切設けない)。同一ファイル内に複数あれば最初を採り警告。
  検証 4 項目: 有効な JSON / トップレベルがオブジェクト(配列不可) / 各値が 1 要素以上の文字列配列 /
  キーが 1 個以上。読み取りで満たさないときは「読めない」扱いで例外を投げない。
  **検証は書き込み経路だけでなく読み取り経路にも適用する**(3 実装とも 2026-08-17 に統一)。
  警告は**経路を問わず返す**(読み取り・注入経路も含む。拒否はしない): 重複ブロック /
  未閉フェンス / **開始マーカーが手前の未閉フェンスに呑まれてブロックとして認識されない場合**。
  3 つ目は返り値が「ブロック無し」と同じ null になるため、警告が無いと書き手は
  自分のブロックが読まれていないことに気づけない(2026-08-17 に §1 へ追加)。
- §2 共有設定 `metatron.config.json` は**任意**。無いことはエラーでも報告対象でもない。
  壊れた JSON(トップレベルが非オブジェクトを含む)と未知 `version` は全項目を既定値へ落として警告 1 行。
  個々のキーの型不整合はその項目だけ既定値へ。
- §3 ルート解決 `docRoot` = 開始ディレクトリから上方向に (1) `metatron.config.json` を持つ最近祖先
  → (2) `git rev-parse --show-toplevel` → (3) 開始ディレクトリ。**開始ディレクトリ自身を含む
  (inclusive)**、探索前に `fs.realpathSync` で実体化、git の失敗は原因を区別せず段 3 へ。
  `.git` の手作業探索で代替しない。解決結果はキャッシュしない。絶対パスと `..` 脱出は拒否。
- §4-§8 ARCHITECTURE(7 節・セクション分割の規範アルゴリズム・`unclosed_fence` の 2 層扱い)、
  rules、ADR、GOTCHAS、文書パス既定値(`docs/ARCHITECTURE.md` / `docs/GOTCHAS.md` /
  `.claude/rules/metatron`)。**旧 `## テスト方針` / `## 保護パス` / `## 規約` は 2026-08-24 に
  rules(§5)へ移った。** rules は 3 ファイル固定、frontmatter を書かない、冒頭に管理者表示行。
  `unclosed_fence` の判定は rules に適用しない。
- §6 に ADR エントリ間の区切り（前後を空行で挟んだ `---`）の規定が 2026-09-16 に加わり、`stage-adr` が節全体に対して毎回正規化する。
- §9-§10 intent 文書と intent-issue v1。判定マーカーは本文中の `<!-- intent:v1 -->`(位置は問わない、
  完全一致のみ)。§10-3 に codiel `analyzing-issues` 用の issue.md 写像表(`analyzing-issues` と `issue.md` は 2026-09-27 に廃止。
  intent 書式 v2 と上書きの記録は `harness-docs/design/2026-09-27-codiel-intent-driven-design.md` §7.5)。**要約を伴う抽出をしない。**
- §11 gh-utility `issue-craft` 持ち込みモードの固定開始句
  `持ち込みモード: 以下の完成済み本文で起票`。判定は固定句の一致のみ、推測で入らない。
- §12 metatron CLI 入出力規約と staging・ロックの保証。staging は単一ターゲットのままで、
  rules も 1 回 1 ファイルである。
- §13 hook 出力形式。**フェイル方針はプラグインごとに違う**: metatron の両 hook はフェイルオープン、
  codiel の PreToolUse はフェイルクローズド(`ask`)。混同しない。
  SessionStart 注入の「何も出力しない」は 2026-08-17 に**「文書の内容を出力しない」へ限定**された。
  文書が 1 つも無くても CLI 案内は出す。案内まで落とすのは `injection.enabled: false` と
  設定読み取り自体が例外で失敗したときの 2 つだけ。**rules 本文は注入しない**(Claude Code が
  起動時に読み、サブエージェントにも渡る)。
- `[ADR 候補]` の書式と参照形(2026-09-28)は、codiel の `references/intent-format.md` の「## 持続層」が正本の
  共有ファイル契約である。metatron は `references/architecture-format.md` の「ADR 候補の取り込み」に、読み取りと縮約に
  要る最小限(印の形、候補 ID の書式、エントリの範囲、5 つの小見出しの名前、参照形、ADR の背景に書く
  「ADR 候補 ID: <候補 ID>」の行)だけを写す。書式を変えたら両プラグインの `format-change-checklist.md` に沿って追随させる。
  書き込みは metatron の `scan-adr-candidates` / `shrink-adr-candidate`(`mem:metatron/core`)。
- §14 実装間の一致検証(上記の 2 者比較)。**`paths.rulesDir` は 2 者比較に含めない**(codiel は
  未知キーとして無視する)。

## 各実装の場所

| 実装 | 場所 | 位置づけ |
| --- | --- | --- |
| metatron | `plugins/metatron/src/lib/config.ts` | **正本の実装** |
| codiel | `plugins/codiel/src/hooks/lib.ts` の `findDocRoot` / `resolveDocPaths` / `readDomainsResult`(薄い包み `readDomains`) | 独立実装 |
