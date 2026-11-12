# codiel 1.1 の実装 セッション起動プロンプト

以下を goal コマンドの入力として使う。作業場所は main のチェックアウト `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins` である。

---

codiel 1.1 を、実装計画書に従って実装する。

## 最初に読む文書

1. `harness-docs/handover/2026-11-12-codiel-1-1-handover.md`(決まったこと・未決のこと・踏みやすい点)
2. `harness-docs/plans/2026-11-12-codiel-1-1-plan.md`(実装計画書)
3. `harness-docs/design/2026-11-08-codiel-1-1-executor-neutral-and-design-layer-design.md`(設計書。計画書の各タスクが引くセクションを読む)

引き継ぎ書の「決まったこと」は再検討しない。

## 進め方

1. 計画書の T1 から T12 を順に進める。T8 と T9 は書き込むファイルが重ならないので、並列に進めてよい。
2. `src/` を変えるタスクは、計画書のステップどおり TDD で進める。タスクごとにコミットする。
3. 設計書と実装の食い違いを見つけたら、実装を止めてユーザーに報告する。
4. T12 のユーザーに頼む確認(github モードのラベル、`-p` で待てないときの実機の確認)は、`AskUserQuestion` で頼む。
5. 計画から外れた判断と T12 の結果は、計画書の §5 に書く。

## 制約

- バージョンは T1 で `1.1.0-dev` に 1 回だけ上げる。`1.1.0` への切り替えはユーザーの判断を仰ぐ。`raguel-mcp` は上げない。
- ブランチと worktree を作らない。PR を作らない。
- hook の締め付けは、それを満たす指示の変更と同じコミットに入れる。
- `plugins/codiel/scripts/` と `raguel-mcp/dist/` は手で編集しない。`src/` を変えたらビルドし、差分を同じコミットに入れる。
- 指示層に better-agentics・agent-policy・basic-design の名前と、設計書の決定の番号を書かない。
- 指示書と `harness-docs/**` の Markdown は `prompt-smith:prompt-smith` の規律で書く。
- `harness-docs/ARCHITECTURE.md`・`harness-docs/GOTCHAS.md`・`.claude/rules/metatron/` は Edit しない。ADR は `metatron:updating-architecture` を起動して扱う。
- agent-policy・better-agentics・gh-utility・basic-design のファイルを変えない。
- `TYPESAFE_API_KEY` の値を、記録・コミット・ファイルに書かない。実機の確認のスクラッチは確認の後に消す。
- コミットはパスを指定して行う。`docs/chat/` の変更を混ぜない。
- 日本語は native-japanese の規律に従う。「節」「段」「版」「契機」を使わない。

## Done の条件

- 計画書の T1〜T12 がすべてコミットされている。
- `pnpm run lint`・`typecheck`・`test`・`build` が通り、`scripts/` と `raguel-mcp/dist/` に未コミットの差分が無い。
- 計画書 3-3 の残存 grep の基準を満たす。
- `plugins/codiel/` の変更に対するコードレビューで、critical・high が残っていない。
- 計画書の §5 に、実機の確認の結果と、計画から外れた判断が書かれている。
- codiel の README・`docs/DESIGN.md`・`docs/skill-flowcharts.md`・ルートの `README.md`・Serena のメモリ `codiel/core.md`・ADR が、計画書の T11 のとおり改まっている。
