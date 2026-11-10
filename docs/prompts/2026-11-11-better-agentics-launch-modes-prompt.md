# better-agentics 起動モード改修の実装 セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所は main のチェックアウト `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins` である。

---

better-agentics の起動モード改修を、実装計画書に従って実装する。

## 最初に読む文書

1. `harness-docs/handover/2026-11-11-better-agentics-launch-modes-handover.md`(決まったこと・未決のこと・踏みやすい点)
2. `harness-docs/plans/2026-11-11-better-agentics-launch-modes-plan.md`(実装計画書)
3. `harness-docs/design/2026-11-10-better-agentics-launch-modes-and-subagent-performance-design.md`(設計書。計画書の各タスクが引くセクションを読む)

引き継ぎ書の「決まったこと」は再検討しない。

## 進め方

1. 計画書の T1(試作)から始める。結果は計画書の §5 に書き、T1 の分岐の表に従って後のタスクを変える。
2. ユーザーの操作が要る確認(S1 と S4 の effort など)は、T1 の Step 6 で `AskUserQuestion` を使って頼む。回答を待つ間に進めてよいのは T2 と T3 だけである。
3. T2 から T16 を順に進める。条件付きのタスクは、T1 と T8 の結果で条件に当たったときだけ行う。
4. 各タスクは計画書のステップどおり TDD で進め、タスクごとにコミットする。
5. 設計書と実装の食い違いを見つけたら、実装を止めてユーザーに報告する。
6. T8b の When to invoke の書き換えと、計画書が「オーケストレーターに報告する」と書く分岐は、ユーザーの判断を仰ぐ。

## 制約

- バージョンは `0.0.2-dev` のまま上げない。
- 規律の文面(`skills/**`・`references/**`・`assets/roles/**`・前置き)に、codiel の名前も codiel 固有の語も書かない。
- ブランチと worktree を作らない。PR を作らない。
- `plugins/better-agentics/scripts/` は手で編集しない。`src/` か `assets/` を変えたらビルドし、差分を同じコミットに入れる。
- 指示書と `harness-docs/**` の Markdown は `prompt-smith:prompt-smith` の規律で書く。
- `harness-docs/ARCHITECTURE.md`・`harness-docs/GOTCHAS.md`・`.claude/rules/metatron/` は Edit しない。変更が要るときは metatron のスキルを使う。
- agent-policy と codiel のファイルを変えない。
- `TYPESAFE_API_KEY` の値を、記録・コミット・ファイルに書かない。試作のスクラッチはタスクの終わりに消す。
- コミットはパスを指定して行う。ステージ済みの `.claude/settings.local.example.json`、`.claude/settings.json`、`docs/chat/` の変更を混ぜない。
- 日本語は native-japanese の規律に従う。「節」「段」「版」「契機」を使わない。

## Done の条件

- 計画書の T1〜T16 と、条件に当たった条件付きのタスクが、すべてコミットされている。
- 計画書の §5 に、試作の結果と、計画から外れた判断が書かれている。
- `pnpm run lint`・`typecheck`・`test`・`build` が通り、`scripts/` に未コミットの差分が無い。
- `plugins/better-agentics/` の変更に対するコードレビューで、critical・high が残っていない。
- ルートの `README.md`、better-agentics の README、Serena のメモリ `core`、食い違いの文書が、計画書の T16 のとおり改まっている。
