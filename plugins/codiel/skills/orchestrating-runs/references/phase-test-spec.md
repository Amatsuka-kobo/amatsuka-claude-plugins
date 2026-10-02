# test-spec と dev-plan の運転

`start-phase test-spec` の直後に読む。dev-plan も、この手順の中で進める。

## 軽量の経路の入力

軽量の経路(`scale: light`)では、test-spec と dev-plan は `design.md` の代わりに、intent の `## 受け入れ基準` と `## 実装方針`、関係する持続層を入力にする。

## 仕様のディレクトリの同定(軽量の経路)

軽量の経路では、`start-phase test-spec` の直後に、オーケストレーターが仕様のディレクトリを同定する。同定ではファイルを書かない。

- intent・持続層(`docs/intents/domains/<領域>.md`)・コード・`<testsDir>` の現状を読み、対象の仕様のディレクトリの一覧を作る。ID と置き場、作る仕様、画面名の候補は `writing-test-specs` の規則に従う。
- 新しい画面があれば、`mark-ask test-spec --slug <slug> --kind confirm` の後に、画面ごとの名前の候補を AskUserQuestion で聞く。候補の外の答えはケバブケースの 1 セグメントに直して確かめ、名前が決まったら `resume` する。新しい画面が無ければ聞かない。
- 決まった一覧は、dev-plan の執筆と spec の委譲の依頼文に同じ値で使う。

## 並列の進め方

design が `passed` か `skipped` になった後、`start-phase test-spec` を行ってから、次の順で並列に進める。

1. 仕様のディレクトリを同定する。軽量でなければ `design.md` の一覧を使う。
2. spec.md / cases.md の委譲を出し、`wait-add` する。
3. 委譲の完了を待つ間に、`start-phase dev-plan` の後で dev-plan.md を自分で書き、`evaluate_plan` でゲートする。
4. spec の委譲の待ちが消えたら、spec の `evaluate_plan` でゲートする。

- 2 つのゲートの判定は互いに独立で、一方の verdict は他方の判定を変えない。dev-plan が `ASK`/`STOP` でも spec の委譲は止めず、完了したら spec のゲートまで進める。
- spec の委譲の待ちが残っている間は、dev-plan が `ASK`/`STOP` でも `mark-ask` を呼ばない。`mark-ask` は run を `awaiting_human` にし、その間は guard-write の境界が外れる。
- spec のゲートの結果が出てから、2 つのゲートの結果をまとめて人に示す。2 つとも `ASK`/`STOP` なら、両方に `mark-ask` し、両方の裁定を `record_outcome` で記録してから `resume` する。`resume` は `awaiting_human` のフェーズを一括で戻すので、両方の裁定が出てから呼ぶ。
- test-code へ進むのは、dev-plan と test-spec の両方が `passed` になってからにする。

## 再開

test-spec の再開は、標準でも軽量でも、次の順で分ける。

1. 裁定待ちの `ASK`/`STOP` があれば、先に人の裁定を受ける(`STOP` の後に再評価しない)。
2. dev-plan が `passed` でなく裁定待ちでもなければ、dev-plan を書いてゲートする。
3. spec の委譲の出し直しは `references/resume.md` の手順に任せる。その後で、受け取り済みの返答があれば spec のゲートへ進み、無ければ出し直した委譲を待つ(待つ間に 2. を進めてよい)。
4. 両方 `passed` なら、次のフェーズへ進む。

一覧が手元に無いときは、dev-plan が `passed` なら `dev-plan.md` の各ステップの通すテストから取り直し、そうでなければ同定し直す。
