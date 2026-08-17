# ファイル契約(metatron / codiel / sandalphon / gh-utility)

正本: `harness-docs/design/2026-08-16-file-contract-freeze.md`(2026-08-16 凍結)。
実装者はこの文書を**直接読む**。要約を経由すると実装ごとに契約が割れる。

## 構造上の要点(これを失うと壊れる)

- 3 プラグインは互いのインストールパスを解決できない。したがって**ソースを共有せず、同じ規則を
  独立に 3 回実装する**。写しが 3 つある状態が正常であり、共通ライブラリへの統合は不可能。
- **唯一の機械的担保は sandalphon のケース 16f / テスト R4 の 3 者比較テスト**
  (`plugins/sandalphon/src/__test__/check-intent-env.test.ts` の `expectThreeWayMatch`)。
  metatron の `loadConfig` と codiel の `resolveDocPaths` はテストから直接呼び、sandalphon の
  `check-intent-env` はトップレベル副作用を持つため子プロセスで起動して出力 JSON を突き合わせる。
  **このテストを消すと 3 実装のずれを検出する手段がゼロになる。**「重複テストだから」と削らない。
- 契約を変更したら §14 のチェックリスト 9 項目(3 実装 + metatron references 3 本 +
  codiel `recording-gotchas` / `analyzing-issues` / `preparing-design-agendas` の写し +
  sandalphon references 2 本 + gh-utility `issue-craft` の写し + 16f テスト)を同じコミットで更新する。

### 3 者比較テストが実際に比較している項目(2026-08-17 拡張後)

`expectThreeWayMatch(startDir, label, { withoutGit?, architecture? })` が突き合わせるのは以下。
**ここに無いものは担保されていない。**

| 項目 | metatron 側の出所 | codiel 側 | sandalphon 側 |
| --- | --- | --- | --- |
| `docRoot` | `loadConfig().docRoot` | `resolveDocPaths().docRoot` | `out.docRoot` |
| ARCHITECTURE / GOTCHAS の解決パス | `architecturePath` / `gotchasPath` | `architecture` / `gotchas` | `projectDocs.*` |
| 設定警告の有無と**件数** | `warnings` | `warnings` | `configWarnings`(下記の合算) |
| ドメインマップの**値の deep equality** | `extractDomains().domains` | `readDomainsResult().domains` | (返さない) |
| ドメインマップの可読性(真偽) | `extractDomains().ok` | `readDomains() !== null` | `projectDocs.domainsReadable` |
| ドメイン**件数** | キー数 | — | `projectDocs.domainCount` |
| 重複ブロック / 未閉フェンス警告の件数 | `extractDomains().warnings` | `readDomainsResult().warnings` | `configWarnings` に合算 |

- **警告の文言までは一致を求めない**(同期コストが釣り合わないため、意図的)。
- sandalphon は設定警告と文書構造警告を `configWarnings` の 1 本で返すため、比較相手は
  metatron の `loadConfig().warnings` + `extractDomains().warnings` の**合計**である。
- 個別ケースは 16f 群のほか、`.codiel` の探索結果(`codielRoot` が codiel の `findProjectRoot`
  と一致するか)、正当な Windows 区切りで**警告 0 件で揃う**こと、CRLF、絶対パス / ルート脱出、
  ネスト git、git バイナリ無し、symlink 経由、ドメインブロックを呑み込む未閉フェンスを含む。

### 構造上の限界(これを誤解するとテストを過信する)

3 者比較は**実装間の差**しか見ない。**同じ誤実装が 3 者すべてに入れば全項目が一致して通る。**
契約文書に対する正しさは検証していない。したがって契約を変えるときは、テストが通ったことを
根拠にせず §14 のチェックリストで写しを 1 つずつ突き合わせる。
また sandalphon はドメイン定義の**値を返さない**ため、値の一致は metatron ↔ codiel の 2 者比較で、
sandalphon は件数までしか照合できない。

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
- §4-§7 ARCHITECTURE(10 節・セクション分割の規範アルゴリズム・`unclosed_fence` の 2 層扱い)、
  ADR、GOTCHAS、文書パス既定値(`docs/ARCHITECTURE.md` / `docs/GOTCHAS.md`)。
- §8-§9 intent 文書と intent-issue v1。判定マーカーは本文中の `<!-- intent:v1 -->`(位置は問わない、
  完全一致のみ)。§9-3 に codiel `analyzing-issues` 用の issue.md 写像表。**要約を伴う抽出をしない。**
- §10 gh-utility `issue-craft` 持ち込みモードの固定開始句
  `持ち込みモード: 以下の完成済み本文で起票`。判定は固定句の一致のみ、推測で入らない。
- §11 metatron CLI 入出力規約と staging・ロックの保証。
- §12 hook 出力形式。**フェイル方針はプラグインごとに違う**: metatron の両 hook はフェイルオープン、
  codiel の PreToolUse はフェイルクローズド(`ask`)。混同しない。
  SessionStart 注入の「何も出力しない」は 2026-08-17 に**「文書の内容を出力しない」へ限定**された。
  文書が 1 つも無くても CLI 案内は出す。案内まで落とすのは `injection.enabled: false` と
  設定読み取り自体が例外で失敗したときの 2 つだけ。
- §13 実装間の一致検証(上記 16f)。

## 各実装の場所

| 実装 | 場所 | 位置づけ |
| --- | --- | --- |
| metatron | `plugins/metatron/src/lib/config.ts` | **正本の実装** |
| codiel | `plugins/codiel/src/hooks/lib.ts` の `findDocRoot` / `resolveDocPaths` / `readDomainsResult`(薄い包み `readDomains`) | 独立実装 |
| sandalphon | `plugins/sandalphon/src/check-intent-env.ts` | 独立実装 |
