# test-loop の運転

`start-phase test-loop` の直後に読む。worktree と委譲の並べ方は `references/delegation-env.md` に従う。回帰の判定は `running-regression-tests`、修正は `fixing-failures` が定める。

test-loop はテストを書く手順を持たない。記録された全テストの回帰の確認と修正を、全件が通るまで繰り返す。

1. `<testsDir>/**/spec.md` の `tests` に記録された全テストと、プロジェクトの test コマンドを実行する。影響の有無で絞らない。
   - プロジェクトの test コマンドと、ID が `units/` で始まる仕様のディレクトリは、オーケストレーターが run ブランチ上で直列に実行する。
   - ID が `e2e/` で始まる仕様のディレクトリは、ディレクトリごとに 1 回の実行の委譲を出し、出力を `references/e2e.md` の置き場へ出させる。
2. 判定が出ないもの(broken)はテストの欠陥の疑いとし、判定が出て期待と違うもの(NG)はプロダクトのバグとする。理由が環境にある失敗は broken にも NG にも数えず、`references/delegation-env.md` の環境の失敗として扱う。
3. NG は仕様のディレクトリごとにまとめ、`step-add --kind test-loop --id <ID>` で `testLoop.units` に登録し、worktree(名前は `test-loop-<k>`)で修正を委譲する。
   - 前の巡で `merged` になった要素は、次の巡で登録し直す(k は変わらない)。
   - brief と report は `steps/test-loop-<k>/` に置き、登録し直しても同じディレクトリに書き直す。
   - 修正の委譲には、失敗した仕様のディレクトリの最新のレポートの絶対パスを渡す(`references/e2e.md`)。
4. どの仕様のディレクトリにも属さない失敗(プロジェクトの test コマンドだけが見つけた失敗)は、run ブランチ上で直列に修正を委譲する。返答は `steps/test-loop-project/report.md` に書き、次の巡でも同じ置き場に書き直す。
5. broken はテストが保護されているので、`mark-ask test-loop --kind confirm` の後に人に確かめてから直す。直す委譲の書き込みは ask になり、人が承認する。
6. 要素のドメインは、ID が `units/<パス>` のとき、そのパスがドメインマップのどのドメインの glob に収まるかで決め、`step-add --domain` で渡す。E2E の ID と、1 つのドメインに決まらないものには境界を課さない。

## 試行の数え方

- 修正の 1 巡(委譲・マージ・全体の再実行)ごとに、`record-attempt test-loop --slug <slug>` を 1 回呼ぶ。`record-attempt` はオーケストレーターだけが呼び、委譲先には呼ばせない。
- exit code が `3`(試行上限超過・`capExceeded`)なら、`raguel-gating` の ASK と同じ扱いにする。`awaiting_human` は `record-attempt` がセットしている。findings に当たる情報を人に示し、裁定を受けてから続ける。
