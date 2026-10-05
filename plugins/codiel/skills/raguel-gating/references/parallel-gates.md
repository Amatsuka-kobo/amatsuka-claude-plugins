# 並列に進めるフェーズの ASK・STOP

test-spec と dev-plan のゲートでは、ASK・STOP・degraded の ASK のすべてに次の規則を当てる。Raguel の不通や `pass-gate` の拒否の繰り返しで `mark-ask --kind confirm` を呼ぶときにも、同じ規則を当てる。

- もう片方の委譲の待ちが残っている間は、`mark-ask` を呼ばない。`mark-ask` は run を `awaiting_human` にし、その間は guard-write の境界が外れるためである。
- もう片方のゲートの結果が出てから、2 つのゲートの結果をまとめて人に示す。
- 2 つとも ASK・STOP のときは、次の順に進める。
  1. 両方に `mark-ask` する。
  2. 人に聞く。
  3. 裁定ごとに `record_outcome` を記録する。
  4. `resume` を 1 回だけ呼ぶ。`resume` は awaiting_human のフェーズを一括で戻すので、片方の裁定だけでは呼ばない。
  5. 裁定ごとに続きを行う(修正して再提出なら再評価、承認なら `pass-gate`)。
- 裁定 A の「`resume` → `record_outcome`」の順は、並列に進めるフェーズでだけ、この順に読み替える。
