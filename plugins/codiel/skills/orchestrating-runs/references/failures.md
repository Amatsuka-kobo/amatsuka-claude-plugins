# 失敗の記録

次の契機で、オーケストレーターが失敗を GOTCHAS に記録する。記録の判断・エントリの書式・採番・タグは `metatron:recording-gotchas` スキルに従う。

| 契機 | 記録する時点 |
|---|---|
| 人が Raguel の `STOP` を妥当と裁定した | `raguel-gating` の STOP の手順で `stop --reason raguel-stop` を実行した直後 |
| test-loop / fix-loop の `record-attempt` が上限超過(exit 3)を返した | 人の裁定が中止に確定した時点 |
| `record_outcome(incident)` を記録した | incident を記録した直後 |
| レビューで、設計時に想定していなかった仕様漏れ・考慮漏れが見つかった | fix-loop を終えた時点 |

記録の手段は、metatron の CLI の案内がコンテキストにあるかで分ける。記録の手段が無くても run は止めない。

- 案内があるときは、`metatron:recording-gotchas` スキルを名指しで起動して記録させる。
- 案内が無いとき(metatron が無い、または未初期化)は台帳へ書かず、次の順で退避する。
  1. エントリを `## 未記録の GOTCHAS` の見出しの下に書く。書き先は、run があれば `<runsDir>/<slug>/unrecorded-gotchas.md`、無ければ `.codiel/reports/unrecorded-gotchas.md` とする。`<runsDir>/<slug>/` の退避は try で分けずに追記し、既存のエントリを消さない。
  2. 同じエントリを完了報告にも載せる。
  3. 完了報告に台帳へ入れる手段を添える。metatron を導入していれば「次のセッションで注入される CLI の案内から `append-gotcha` で追記する」、導入していなければ「`/metatron:init` で台帳を作ってから追記する」と書く。
- 退避では記録の可否を判断せず、契機ごとに 1 件書く。可否は台帳へ入れるときに判断する。

退避するエントリは、`append-gotcha` の入力にそのまま使える次の 6 つの値だけを持つ。

| キー | 値 |
|---|---|
| `title` | 失敗のタイトル |
| `task` | 何をしようとしていたか |
| `mistake` | 具体的に何を間違えたか |
| `cause` | なぜそうなったか(推測) |
| `countermeasure` | 次のエージェントがそのまま実行できる行動 |
| `promotionCandidate` | `Yes` か `No` |

記録したら、次をコミットする。形式は `codiel(gotchas): <一行要約> (<slug> try-<n>)` とする。

- 台帳へ記録したときは、台帳(§0 で解決した GOTCHAS のパス)をコミットする。run が無いときは `(<slug> try-<n>)` を省く。
- run があって退避したときは、退避先をコミットする。
- run が無いときの退避先 `.codiel/reports/unrecorded-gotchas.md` は `.gitignore` の下にあるので、コミットしない。
