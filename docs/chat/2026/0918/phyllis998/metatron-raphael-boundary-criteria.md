# GOTCHAS と抗体の棲み分けを改訂

- 日付: 2026-09-18
- 参加者: phyllis998, AI (Claude Opus 5)
- 成果物: `plugins/metatron/references/gotchas-format.md`、`plugins/metatron/skills/recording-gotchas/SKILL.md`、`plugins/raphael/skills/raphael/SKILL.md`、`plugins/raphael/agents/antibody-synthesizer.md`、Serena メモリ複数; コミット `426be88`、`da9a86f`
- 前提: agent-policy PR #1（2c1b8ec）での先行作業（`GOTCHA-002` 解決済みタグ付与、規律追加）、既存 GOTCHAS 文書、抗体合成機構

---

## セッション 1: GOTCHAS と抗体の棲み分けを一般性と表現可能性の2軸に改訂

# AI

I'll start by reading the handover docs.

目標を確認。まず agent-policy 側の先行作業の完了確認から。

agent-policy 側は完了済み(L76–78・L112–113 に規律追加、0.19.6-dev、`GOTCHA-002` 解決済みタグ、PR #1 マージ済み)。次に raphael 側の trigger 機構を確認。

証拠が揃った。分析と決定を先に述べる。

`★ Insight ─────────────────────────────────────`
- `plugins/raphael/src/lib/types.ts:1` の `RaphaelToolName = "Bash" | "Edit" | "Write"` が抗体の射程を型で閉じている。`Agent` tool は `trigger.tool` の値域に無く、`hooks/hooks.json:5` の PreToolUse matcher にも無い。`GOTCHA-002` は「正規表現で書けない」以前に「対象ツールが存在しない」。
- `match-antibody.ts:127-140` の `targetText()` は既に tool 引数の中身(Bash→`command`、Edit→`old_string+new_string`、Write→`content`)を pattern の対象にしている。引き継ぎ書が案 3 の候補に挙げた「tool 引数の内容による判定」は新機能ではなく現行動作。
`─────────────────────────────────────────────────`

## 1. 空白の構造

観測: 一般則である `GOTCHA-002` が、基準上どこにも置けないまま GOTCHAS に入った。

**なぜ (第 1 層)** — 両側が互いに受け皿があると仮定して自分の対象外にしている。metatron は `gotchas-format.md:76` で「一般則なら抗体」と外へ投げ、raphael は `skills/raphael/SKILL.md:31-32` で「trigger に識別子を含められないなら抗体にしない / 絞れないなら非採用」と落とす。委譲が閉じていない。

**なぜ (第 2 層)** — 二つの基準が見ている軸の数が違うのに、同じものの写しだと思われている。

| | metatron の軸 | raphael の軸 |
| --- | --- | --- |
| 再発性 (問 1) | 持つ(記録の判断) | 持つ |
| 一般性 (問 2) | 持つ(棲み分けの唯一の軸) | 持つ |
| **trigger の表現可能性** | **持たない** | 持つ(`SKILL.md:30-32`、`antibody-synthesizer.md:126`) |

metatron の「一般則なら抗体」は raphael の問 2 だけを写したもので、raphael が独自に持つ第 3 の軸が写っていない。だから「一般性 Yes × 表現可能性 No」の象限が metatron の視野から消える。`GOTCHA-002` はその象限にある。

## 2. 案の比較と選択

**推奨は案 1 + 案 2 を一体で採る**こと。両者は排他ではなく、同じ規則の「判定の順序」と「受け入れの条件」という二面であり、片方だけでは矛盾が残る(案 1 だけだと `recording-gotchas/SKILL.md` の description・`GOTCHAS.example.md:9`・契約凍結 §7-6 が「一般則は書かない」と言い続ける)。

判断を左右する軸は 4 つ。

| 案 | 空白を閉じるか | 実装変更 | 既存契約 | 判定の決定性 |
| --- | --- | --- | --- | --- |
| **1+2 判定軸に表現可能性を足し、受入条件を明記** | 閉じる | 無し | 壊さない | 高い。raphael に既にある規律を写すだけ |
| 3 trigger 機構の拡張 | **閉じない** | 大(4 箇所) | 壊す | 低い |
| 4 第 3 の置き場 | 閉じるが新設 | 中 | 増設 | 低い |

**案 3 を退ける根拠** — 引き継ぎ書の前提が実装と食い違う点が 2 つある。

1. 候補の「tool 引数の内容による判定」は `match-antibody.ts:127-140` で既に実装済み。案として成立しない。
2. 候補の「PostToolUse への対応」は `GOTCHA-002` に効かない。抗体は依頼文を書く**前**に注入されて初めて意味を持つ(`DESIGN.md:13` の予防接種)。事後イベントでは遅い。PostToolUse 非対応で非採用になった事例は別件の制約であって、この空白の原因ではない。

さらに `trigger.tool` に `Agent` を足しても、根本の「依頼文が説明用の例示を含むかを正規表現で判定できない」は残る。`DESIGN.md:22` が「フックの感知・マッチングに Anthropic API、API キー、外部 API クライアントを用いない」を契約として置いている以上、意味判定の導入は設計そのものの否定になる。案 3 はコストを払って空白を閉じない。

**案 4 を退ける根拠** — 置き場が 3 つになると判定が 3 値分岐になり決定性が落ちる。新しい格納庫・CLI・注入経路が要る一方、得られるものは案 1+2 と同じ。

## 3. 決めた棲み分け基準

```
問 1  別のリポジトリへ持っていっても成立するか
      ├─ No  ──────────────────────→ GOTCHAS (現行どおり)
      └─ Yes → 問 2  抗体の trigger を書けるか
                     ├─ Yes ────────→ Raphael の抗体
                     └─ No  ────────→ GOTCHAS ← 今回開ける口
```

設計上の要点が 2 つある。

- **問 2 の判定は raphael 側に置き、metatron は結果だけを受ける。** trigger の tool 値域も広さの上限(母集団の 10%)も metatron の文書へ写さない。写せば raphael の実装変更で必ず割れる。
- **raphael 未導入の環境では問 2 を立てず、問 1 が Yes のものは記録しない。** 現行の一文をここだけ維持する。未導入環境では全ての一般則が「trigger を書けない」に見え、受けると台帳が汎用知識で膨張するため。

raphael 側は「非採用」の理由を 2 種へ割る。二問のどちらかが No(知識として残さない)と、二問が Yes だが trigger を書けない(知識は有効なまま残る)を区別して報告させる。`harness-docs/ARCHITECTURE.md` の依存禁止(指示層に他プラグイン名を書かない。例外は sandalphon / codiel / metatron / gh-utility の 4 つで raphael は含まれない)があるため、**raphael 側の文書に metatron や GOTCHAS の名前は出さない**。参照は metatron → raphael の一方向のまま保つ。

追随先を確定させるため、残りの検査をかける。

追随先が確定した。metatron 側と raphael 側は独立なので並列に委譲する。

`★ Insight ─────────────────────────────────────`
- `section-reference-inventory.test.ts` は ARCHITECTURE の節名参照だけを固定しており、GOTCHAS の節名も「棲み分け」も検出語に持たない。節見出しを変えてもテストは割れない。
- `recording-gotchas` の description は現在 518 バイト。メモリにある実測(発火率を決めるのは長さ)に従い、不正確になった一文は**足さずに削る**。棲み分けの細目は本文と references が持てばよく、description は短くなる方向に動く。
`─────────────────────────────────────────────────`

2 件の文書作成を並列で走らせた。完了を待つ間に、この turn の成果を報告する。

## 現時点の状態

**agent-policy 側の先行作業 — 完了を確認した。**

| 確認項目 | 結果 |
| --- | --- |
| 規律の反映 | `orchestration-discipline.md:76-78`(依頼文側)と `:112-113`(サブエージェント側)に条項が入っている |
| バージョン | `agent-policy` 0.19.6-dev(`4a3cb47 feat(agent-policy): 委譲依頼に書く例示の扱いを規律化`) |
| `GOTCHA-002` | `[解決済み]` タグ付与済み(`315e41a`)。理由行に 0.19.6-dev への吸収が記録されている |
| ブランチ | PR #1 が `2c1b8ec` で main へマージ済み |

引き継ぎ書が言う「本件が規律へ反映されれば `GOTCHA-002` の内容は規律に吸収され、台帳のエントリがどちらへ分類されるかは実害を持たなくなる」条件は満たされている。棲み分けを今変えてよい。

## 引き継ぎ書の前提に 2 点の食い違い

作業は止めていないが、案 3 の評価が変わる事実なので先に述べる。

1. 案 3 の候補「tool 引数の内容による判定」は**既に実装されている**(`match-antibody.ts:127-140`)。抗体の pattern は tool 名ではなく引数の中身に当たっている。案として新規性がない。
2. 案 3 の候補「PostToolUse への対応」は `GOTCHA-002` を救わない。抗体は操作の**前**に注入されて効く機構であり、事後イベントでは間に合わない。PostToolUse 非対応で非採用になった事例は別種の制約で、今回の空白の原因ではない。

加えて、`GOTCHA-002` が抗体になれない理由は引き継ぎ書の記述より 1 段深い。`types.ts:1` の `RaphaelToolName` が `Bash | Edit | Write` の 3 値であり、`Agent` tool は `trigger.tool` の値域に存在しない。正規表現を工夫する以前に、対象ツールを指定できない。

## 委譲した内容

- **metatron 側** — `gotchas-format.md` の棲み分け節を 2 軸 2 段へ、`recording-gotchas/SKILL.md` の description から不正確になった一文を削除(足さない)、`GOTCHAS.example.md` の記入ガイド、契約凍結 §7-6、`format-change-checklist.md` への追随先 3 項目の追加。
- **raphael 側** — `skills/raphael/SKILL.md` と `agents/antibody-synthesizer.md` に、非採用の理由を「知識として残さない」と「知識は有効だが trigger を書けない」の 2 種へ割る規定を追加。他プラグイン名を書かせない制約を明示した。

両者の完了後に、metatron 0.3.6-dev → 0.3.7-dev、raphael 0.2.0-dev → 0.2.1-dev のバージョン更新(`plugin.json` と `package.json` を同値)と、lint / typecheck / test の実行へ進む。

raphael 側が差し戻してきた。対象パスは渡していたが、prompt-smith の評価フローを「このスキル自体を評価する」と読み違えている。同じエージェントへ訂正を送る。

raphael 側の完了通知が来た。ファイルの実体を確認する。

変更が 0 件。raphael 側は編集に入れていない。prompt-smith の契約を自分で読んで、委譲の枠組みを直す。

原因が分かった。prompt-smith は評価フロー(評点表 → 指摘リスト → 適用可否)を持ち、委譲先がそちらへ入った。加筆モードであることを明示して出し直す。並行して、走行中の metatron 側にも同じ罠を先回りで伝える。

元の raphael エージェントが再開後に完遂していた。重複起動した方を即座に止める。

重複起動を停止した。raphael 側の差分を検証する。

raphael 側の差分は妥当。重複起動による二重編集も無い。metatron 側は走行中なので触らず、独立するバージョン更新を並行で出す。

raphael 側が完了した。metatron 側とバージョン更新が走行中。

## raphael 側に入った変更(検証済み)

`plugins/raphael/skills/raphael/SKILL.md` の `## trigger の粒度` に 2 項目、`plugins/raphael/agents/antibody-synthesizer.md` の 3 箇所。既存 4 項目の文言・順序、二問の原文、広さ検査の値、判断表、CLI の呼び出し方はいずれも変わっていない。他プラグイン名も外部パスも入っていない。

核心は非採用の二分である。

```
非採用 ─┬─ 二問のどちらかが No / 単発 / 修正済み / 証拠不足
        │     → 知識として残す価値がない
        └─ 二問が両方 Yes だが pattern を書けない
              → 知識自体は有効なまま残る  ← 呼び出し側が拾える
```

`PATTERN_TOO_BROAD` で拒否された非採用も後者へ明示的に寄せられた。これは実装上正しい — 広さ検査で弾かれるのは「一般則ではあるが発火条件を絞れない」ケースそのものだから、二問の結果は Yes のまま残る。

## この turn で起きた事故と処理

委譲先が `prompt-smith` の評価フロー(評点表 → 指摘リスト → 適用可否)に入り、加筆せず差し戻してきた。訂正を送った直後に完了通知が来たため、私は「訂正が届かず落ちた」と読み、同じ 2 ファイルへ代替エージェントを起動した。実際には訂正が効いて元のエージェントが完遂しており、代替は重複だった。二重編集になる前に停止し、差分の健全性を確認済み。

原因は、完了通知と再開後の報告が別々に届く順序を、私が report の欠落と取り違えたこと。ファイルへの実害は無い。

## 残り

- metatron 側 5 ファイル(`gotchas-format.md` の棲み分け節、`recording-gotchas/SKILL.md`、`GOTCHAS.example.md`、契約凍結 §7-6、`format-change-checklist.md`)— 走行中。prompt-smith の適用範囲外にあたる 3 ファイルの扱いを追送済み。
- バージョン更新(metatron 0.3.6-dev → 0.3.7-dev、raphael 0.2.0-dev → 0.2.1-dev の `plugin.json` と `package.json`)と lint / typecheck / test — 走行中。

両者の完了後に全差分を突き合わせ、`codiel` 側の `recording-gotchas`(受け皿が Raguel 判例ストアで別系統。現時点の判断は変更不要)の確認結果と併せて報告する。

metatron 側が完了した。報告にある「正体不明の 6 ファイル」は、私が並行起動した raphael 側の文書エージェントとバージョン更新エージェントの成果であり、自動化でも異常でもない。差分の実体を確認する。

3 件すべて完了。検証は lint / typecheck / test とも終了コード 0(テスト 2307 passed)。残る Done 条件を確認する。

`.serena/memories/raphael/core.md` にバージョンの食い違いがある。metatron 側も確認する。

メモリのバージョン記述に食い違いがある(今回の変更で無効化した分に加え、以前からの陳腐化も含む)。更新を委譲する。

文書側の変更はすべて入り、検証も通った。メモリ追随の完了を待つ間に、現時点の成果を報告する。

## 入った棲み分け基準

`plugins/metatron/references/gotchas-format.md` が判定を 2 段に改めた。

```
1. 別のリポジトリへ持っていっても成立するか
   No  → GOTCHAS
   Yes → 2 へ
2. Raphael の抗体の trigger として表現できるか  ← 判定は raphael 側が持つ
   表現できる     → 抗体。GOTCHAS には記録しない
   抗体にできない → GOTCHAS（このプロジェクトで踏んだ失敗として書く）

Raphael 未導入の環境では 2 を判定せず、1 が Yes の知識はどちらにも記録しない
```

意図どおり、**trigger の tool 値域も広さの上限値も metatron 側に書かれていない**。「Raphael 側で抗体にできないと判断されたなら」という結果で受けているため、raphael の実装が変わっても写しが割れない。

raphael 側は非採用を二分した。二問のどちらかが No で落ちたものと、二問が両方 Yes でありながら pattern を書けずに落ちたもの。後者は知識が有効なまま残ると明記され、最終報告で区別される。`PATTERN_TOO_BROAD` による拒否も後者へ寄せられた。

`★ Insight ─────────────────────────────────────`
二つの規律が名指しで参照し合うと循環になるが、今回は片方向で閉じている。metatron は raphael を名指しして「抗体にできないと判断されたもの」を受け、raphael は metatron を一切知らずに「非採用の理由を区別して報告する」だけを負う。raphael 側から見れば呼び出し側が誰であっても成立する規律であり、`ARCHITECTURE.md` の「指示層に他プラグイン名を書かない」制約（例外 4 プラグインに raphael は含まれない）を破らずに済んでいる。
`─────────────────────────────────────────────────`

## 変更したファイル

| 区分 | ファイル | 内容 |
| --- | --- | --- |
| metatron 規律 | `references/gotchas-format.md` | 棲み分け節を 2 段判定へ |
| metatron 規律 | `skills/recording-gotchas/SKILL.md` | description から不正確になった一文を削除、§1 に判定の所在を 1 行 |
| metatron 文書 | `docs/GOTCHAS.example.md` | 記入ガイドを追随 |
| metatron 文書 | `docs/format-change-checklist.md` | 追随先 3 項目を追加（既存 4 項目は保持） |
| 契約 | `harness-docs/design/2026-08-16-file-contract-freeze.md` §7-6 | 2 段判定へ置換 |
| raphael 規律 | `skills/raphael/SKILL.md` | `## trigger の粒度` に 2 項目 |
| raphael 定義 | `agents/antibody-synthesizer.md` | §4・preflight・最終報告の 3 箇所 |
| バージョン | 4 ファイル | metatron `0.3.6-dev`→`0.3.7-dev`、raphael `0.2.0-dev`→`0.2.1-dev`（`plugin.json` と `package.json` 同値） |

`description` は 504 → 432 バイト。メモリの実測（短いほど発火する）に沿って、足さずに削る方向で処理した。

## 検証

`pnpm run lint` / `typecheck` / `test` いずれも終了コード 0。テストは 2307 passed / 2 skipped。lint は `Found 4 infos` を出すが既存コードに対するもので、終了コードは 0。src を変更していないため build は不要。

## 確認して変更しなかったもの

- `plugins/codiel/skills/recording-gotchas/SKILL.md:33` — codiel の受け皿は Raguel 判例ストアであり、LLM 検査のため正規表現の表現可能性という制約を持たない。今回の空白は発生しないので**変更不要**と判断した。`format-change-checklist.md` の既存項目として残す。
- ルートの `README.md` — metatron と raphael の記述はあるがバージョン番号を持たず、棲み分け基準にも触れていない。追随不要。
- `harness-docs/ARCHITECTURE.md` — 棲み分けの記述を持たない（`.raphael/` の配置と docs ドメインへの所属のみ）。`/metatron:update` は不要。
- `src/` のバージョンハードコード — 0 件。

## 残り

Serena メモリのバージョン追随（metatron・raphael の各 core と一覧）が走行中。完了後、内容ごとに分けて commit する。現時点では未コミットである。

質問が 1 点ある。commit の分け方について、**metatron 側 / raphael 側 / バージョン・メモリ** の 3 つに分けるつもりだが、規律の変更が両プラグインで一体である以上 1 コミットにまとめる方がよいなら、そう指示してほしい。指示がなければ 3 分割で進める。

メモリ追随も完了。コミット前に全差分を確認する。

**分け方を変える。** 前ターンで 3 分割（metatron / raphael / バージョン・メモリ）と述べたが、2 分割にする。棲み分け基準は 2 プラグインで一体の変更であり、metatron 側だけを切り出すと「raphael 側で抗体にできないと判断されたなら」という参照先が同じコミットに存在しない状態になる。バージョンも Done 条件により改修と同じコミットに置く。

全差分を確認した。2 コミットに分けて記録する。

完了した。作業ツリーは clean。

## 1. agent-policy 側の先行作業の確認結果

完了している。

| 確認項目 | 結果 |
| --- | --- |
| 規律の反映 | `orchestration-discipline.md:76-78`(依頼文側)、`:112-113`(サブエージェント側) |
| バージョン | `agent-policy` 0.19.6-dev(`4a3cb47`) |
| `GOTCHA-002` | `[解決済み]` 付与済み(`315e41a`)。理由行に 0.19.6-dev への吸収を記録 |
| ブランチ | PR #1 が `2c1b8ec` で main へマージ済み |

「規律へ反映されれば `GOTCHA-002` の内容は規律に吸収され、台帳のエントリがどちらへ分類されるかは実害を持たなくなる」という前提条件は満たされていた。

## 2. 選んだ棲み分け基準と根拠

**案 1 と案 2 を一体で採用**した。

```
1. 別のリポジトリへ持っていっても成立するか
   No  → GOTCHAS
   Yes → 2 へ
2. Raphael の抗体の trigger として表現できるか  ← 判定は raphael 側が持つ
   表現できる     → 抗体
   抗体にできない → GOTCHAS（このプロジェクトで踏んだ失敗として書く）

Raphael 未導入の環境では 2 を判定せず、1 が Yes の知識はどちらにも記録しない
```

**一般則かつ trigger を書けない知識の扱い** — GOTCHAS が受ける。ただし抽象化した一般則としてではなく、このプロジェクトで実際に踏んだ失敗として書かせる。台帳の性格（実際にやってしまった失敗の蓄積）を壊さないため。

**根拠** — 判断を左右する軸は 4 つあった。

| 案 | 空白を閉じるか | 実装変更 | 既存契約 | 判定の決定性 |
| --- | --- | --- | --- | --- |
| **1+2** | 閉じる | 無し | 壊さない | 高い |
| 3 trigger 拡張 | **閉じない** | 大 | 壊す | 低い |
| 4 第 3 の置き場 | 閉じる | 中 | 増設 | 低い |

案 3 を退けた理由は、調査で引き継ぎ書の前提に 2 点の食い違いが出たことによる。

1. 候補の「tool 引数の内容による判定」は `match-antibody.ts:127-140` で**既に実装済み**。pattern は tool 名ではなく引数の中身に当たっている。案として新規性がない。
2. 候補の「PostToolUse への対応」は `GOTCHA-002` に効かない。抗体は操作の**前**に注入されて効く機構であり、事後イベントでは間に合わない。

加えて、`GOTCHA-002` が抗体になれない理由は引き継ぎ書の記述より 1 段深かった。`types.ts:1` の `RaphaelToolName` が `Bash | Edit | Write` の 3 値であり、`Agent` tool は `trigger.tool` の値域に存在しない。正規表現を工夫する以前に対象ツールを指定できない。値域を広げても「依頼文が説明用の例示を含むか」の意味判定は正規表現では不可能で、`DESIGN.md:22` の「マッチングに LLM を用いない」契約がある以上そこへは進めない。コストを払って空白が閉じない。

案 4 は判定が 3 値分岐になり決定性が落ちる一方、得られるものが案 1+2 と同じだった。

**設計上の勘所** — 2 段目の判定条件（trigger の tool 値域、広さの上限 10%）を metatron 側へ**写さなかった**。「raphael 側で抗体にできないと判断されたなら」という結果で受けている。写せば raphael の実装変更で必ず割れるため。逆向きの参照も作っていない。raphael 側は metatron を一切知らず「非採用の理由を区別して報告する」だけを負うので、`ARCHITECTURE.md` の「指示層に他プラグイン名を書かない」制約（例外 4 プラグインに raphael は含まれない）を破っていない。

## 3. 追随内容

**metatron**
- `references/gotchas-format.md` — 棲み分け節を 2 段判定へ
- `skills/recording-gotchas/SKILL.md` — description から不正確になった一文を削除（504 → 432 バイト。短いほど発火するという実測に沿って、足さずに削った）、§1 に判定の所在を 1 行
- `docs/GOTCHAS.example.md` — 記入ガイド
- `docs/format-change-checklist.md` — 追随先 3 項目を追加（既存 4 項目は保持）
- `harness-docs/design/2026-08-16-file-contract-freeze.md` §7-6 — 契約の写し

**raphael**
- `skills/raphael/SKILL.md` `## trigger の粒度` — 2 項目
- `agents/antibody-synthesizer.md` — §4・preflight・最終報告の 3 箇所。`PATTERN_TOO_BROAD` による拒否も「二問は Yes のまま」側へ明示的に寄せた

**Serena メモリ** — `metatron/core` `raphael/core` `core` のバージョン記述と、非採用の二分

## 4. バージョン・検証・変更したファイル

metatron `0.3.6-dev` → `0.3.7-dev`、raphael `0.2.0-dev` → `0.2.1-dev`。いずれも `plugin.json` と `package.json` を同値。

`pnpm run lint` / `typecheck` / `test` はすべて終了コード 0。テストは 2307 passed / 2 skipped。lint は `Found 4 infos` を出すが既存コードに対するもので合格。`src/` を変更していないため build は不要。

コミットは 2 本。`426be88`(棲み分け基準＋両プラグインのバージョン)と `da9a86f`(メモリ追随)。前ターンで 3 分割と述べたが 2 分割へ変えた。基準変更は 2 プラグインで一体であり、metatron 側だけを切り出すと参照先が同じコミットに無い状態になるため。

## 5. 確認して変更しなかったもの

- `plugins/codiel/skills/recording-gotchas/SKILL.md:33` — codiel の受け皿は Raguel 判例ストアで LLM 検査のため、正規表現の表現可能性という制約を持たない。今回の空白が発生しないので変更不要
- ルートの `README.md` — バージョン番号も棲み分け基準も持たない
- `harness-docs/ARCHITECTURE.md` — 棲み分けの記述を持たない。`/metatron:update` 不要
- `GOTCHA-002` の本文と既存の抗体 — スコープ外として不変

## 6. 残る懸念

**この turn で起きた事故** — 委譲先が `prompt-smith` の評価フロー（評点表 → 指摘リスト → 適用可否）に入って加筆せず差し戻した。訂正を送った直後に完了通知が届いたため、私はそれを「訂正が届かず落ちた」と読み、同じ 2 ファイルへ代替エージェントを起動した。実際には訂正が効いて元のエージェントが完遂していた。二重編集になる前に停止し差分の健全性を確認したので実害は無いが、原因（完了通知と再開後の報告が別々に届く順序を report の欠落と取り違えた）は私の側にある。

**未決定 3 件**

1. **raphael 側の「知識は有効なまま残る」非採用の行き先が、規律として書かれていない。** 区別して報告するところまでは入ったが、報告を受けたオーケストレーターがそれを GOTCHAS へ回す動きは、どの規律にも書かれていない。metatron 側は受け口を開けたが、そこへ運ぶ経路は人間かオーケストレーターの判断に委ねたままである。プラグイン名を書けない制約と、運用で埋まるかの見極めが要るため今回は踏み込まなかった。

2. **`.serena/memories/raphael/core.md` の抗体件数が実体と合っていない。** メモリは「56 antibodies as of 2026-09-08」と記すが、`.raphael/antibodies/` の実体は 15 ファイル。今回の変更に起因しない以前からの陳腐化のため、スコープ外として触っていない。

3. **`-dev` の除去判断。** 両プラグインとも開発版のまま据え置いた。

# phyllis998

> プッシュしてPRを作成してください。
> なお、この後追加されるであろうchatファイルもまとめてお願いします
