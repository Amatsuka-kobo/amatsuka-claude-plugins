# GOTCHAS 候補の書き残し

run の中で次のいずれかが起きたら、GOTCHAS の台帳へ移す候補を書き残す。codiel は台帳へ書かず、metatron の CLI も呼ばない。台帳へ移すか、解決済みや対象外として扱うかは、移すときに人が判断する。

| 条件 | 書く時点 |
| --- | --- |
| 人が Raguel の STOP を妥当と裁定した | `stop --reason raguel-stop` の直後 |
| `record-attempt` の上限超過の後、人が中止を選んだ | `stop --reason attempts-exceeded` の直後 |
| implement・test-code の修正ループが 5 ラウンドで通らず、人が中止を選んだ | `stop --reason attempts-exceeded` の直後 |
| `record_outcome(incident)` を記録した | 記録の直後 |
| review で、設計時に想定していなかった仕様漏れ・考慮漏れが見つかった | fix-loop の最後の pass-gate の後 |

- 上の条件に 1 回当たるごとに 1 件書き、書くかどうかを判断しない。
- STOP を誤検知と裁定したときは書かない。その裁定は `record_outcome` の `false-positive` として Raguel の記録に残る。

## 手元の記録

- 候補は `knowledgeTarget` の値によらず、まず `.codiel/runs/<slug>/try-<n>/reports/gotcha-candidates.md` に追記する。
- incident では、incident を記録する run の slug(`record-outcome` に渡すものと同じ)で `codiel-state get --slug <slug>` を呼び、返った `statePath` と同じディレクトリの `reports/gotcha-candidates.md` に追記する。completed・rejected の run は `get --active` に出ないので、`get --active` は使わない。
- ファイルが無ければ、先頭行を `# GOTCHAS 候補(<slug> try-<n>)` にして作る。
- エントリの形は `<plugin-root>/references/intent-format.md` の「GOTCHAS 候補」に従う。
- 既存のエントリは消さず、書き換えるのは次の `写し先` の行を足すときだけにする。
- `.codiel/runs/` は git に載せないので、このファイルはコミットしない。

エントリの末尾の `- 写し先:` の行は、持続層へ写したかを表す。この行の無いエントリが、まだ写していない候補である。

- 持続層へ写したら、`- 写し先: <領域ファイルのパス>` を足す。足すのは、領域ファイルをコミットした後である。intent-sync ではゲート通過後のコミットの後、finalize では intent のコミットの後に足す。ASK の再提出・STOP・再開で領域ファイルの変更が失われうる間は足さない。
- incident のエントリには、書くときに `- 写し先: 写さない(incident)` を付ける。incident の候補を持続層へ写す扱いは決まっていない。

## 持続層への写し(`knowledgeTarget` が `intents` のときだけ)

`metatron` のときは写さず、手元の記録と一覧だけにする。写す時点は intent-sync と finalize の 2 つである。

- intent-sync: 同じ slug のすべての try の `reports/gotcha-candidates.md` から、`写し先` の行の無いエントリを集めて写す。stop で終わった前の try の候補も対象に入る。
  - 写し先の領域は、`references/phase-intent-sync.md` の分岐で決めた取り込み先から選ぶ。取り込みを行わないときは写さない。
  - 写した領域ファイルは、intent-sync の評価の `paths` に含め、ゲート通過の直後の intent-sync のコミットに入れる。
- finalize: 同じ slug のすべての try の `reports/gotcha-candidates.md` から、`写し先` の行の無いエントリを写す。最後の intent-sync より後に出た候補と、前の try で写されなかった候補が当たる。
  - 写し先の領域は、`steps/intent-sync/report.md` に記録された、この try の intent-sync が取り込んだ領域ファイルから選ぶ。
  - 取り込んだ領域ファイルが無いときは写さず、手元の記録に残す。
  - 写した領域ファイルは、`references/phase-finalize.md` の intent をコミットする手順のコミットに入れる。

領域ファイルの選び方と書き方は次のとおりである。

- 候補の `task` と `mistake` が関わる領域を 1 つ選ぶ。決められないときは、取り込み先の領域のうち intent の `domains` で最初に挙がっているものを選ぶ。
- 領域ファイルの `## GOTCHAS 候補` の末尾に、エントリを全文で書き足す。見出しが無ければ、`intent-format.md` の持続層の書式の位置に作る。
- 手元の記録のエントリの `写し先` の行は、領域ファイルへ写さない。

## 一覧

- finalize の結果レポートと、stop したときの完了報告には、この try の `reports/gotcha-candidates.md` のエントリと、前の try のエントリのうち `写し先` の行が無いものを一覧する。
- 一覧には、エントリごとのタイトルと `写し先` の値(行が無ければ「未」)と、手元の記録のパスを書く。
- `写し先` の行の無いエントリには、持続層へ写さなかった理由(`metatron` の run、または取り込んだ領域が無い)を添える。
- 候補が無ければ「なし」と書く。
- incident の候補は、outcome の同期の報告に、タイトルと手元の記録のパスで一覧する。
