# better-agentics 起動モード改修の実装 引き継ぎ書

- 日付: 2026-11-11
- 引き継ぎ元: better-agentics の起動モード改修の設計と実装計画のセッション(計画書のコミットまで完了)
- 引き継ぎ先: 実装計画書に従って実装するセッション
- 作業場所: main のチェックアウト `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins`。ブランチと worktree を作らない。PR は作らない

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | 完了(`harness-docs/design/2026-11-10-better-agentics-launch-modes-and-subagent-performance-design.md`、コミット `5040b9ad`〜`ad3db392`。決定 D1〜D29、執筆者の判断 J1〜J40) |
| 実装計画書 | 完了(`harness-docs/plans/2026-11-11-better-agentics-launch-modes-plan.md`、コミット `a8ffae2e`。16 タスクと条件付きの 5 タスク) |
| 実装 | 未着手。T1(試作)から始める |
| agent-policy・codiel の設計書 | 同じ事項の扱いをそろえ済み(agent-policy は `a6c1a213`・`d57ac911`、codiel は `c463e252` まで)。agent-policy の実装計画は別の担当が書いている |

## 決まったこと

再検討しない。

- 設計書の 0 章の決定(D1〜D29)と 11 章の判断(J1〜J40)。12 章の採らなかった案を再提案しない。とくに、委譲先をバックグラウンドのメインセッションにする案と、役割の定義をプラグインに同梱する案。
- 計画書が「計画の判断」と明記した事項。前置きを `src/lib/preamble.ts` に置く、設定ファイルを setup の `--write-config` で書く、前置きの言語を全体で揃える、など。
- バージョンは `0.0.2-dev` のまま上げない。`-dev` のプラグインは上げないというユーザーの方針で、規約の Done の条件より優先する。
- 規律の文面(`skills/**`・`references/**`・`assets/roles/**`・前置き)に、codiel の名前も codiel 固有の語も書かない。

## 未決のこと

- 試作の結果。T1 の結果で、条件付きのタスク(T7a・T7b・T7c・T8b・T8c)を行うかが決まる。分岐は計画書の T1 の表に従う。
- S1 と S4 の effort は `/tasks` でしか見えないので、ユーザーに対話のセッションでの確認を頼む(T1 の Step 6)。`-p` で取れなかった項目も同じ Step で頼む。
- T8b(When to invoke の書き換え)は、案をユーザーに示して決める。
- T7c を行ったときは、ARCHITECTURE の `scripts/` の記述を `/metatron:update` で追随させる(T16)。

## 実装で踏みやすい点

- このセッション自身は、インストール済みの better-agentics(プラグインのキャッシュの `0.0.2-dev`)の規律で動く。リポジトリの変更はこのセッションに反映されない。試作と実機の確認は、計画書 §1 のとおり、スクラッチのプロジェクトで `claude --plugin-dir <リポジトリ>/plugins/better-agentics` を使う。
- スクラッチのプロジェクトには、このリポジトリの `.claude/settings.local.json` の `env` にある `AMATSUKA_AGENT_ENABLE_ORCHESTRATION` と `TYPESAFE_API_KEY` を写す。値を記録やコミットに書かず、タスクの終わりにスクラッチを消す。
- 出力のキーが `agent` から `agentType` に変わる T6 と、fork を足す T7 では、`skills/orchestration/SKILL.md` の `pick-delegate` の呼び出しのセクションを同じコミットで合わせる。合わせないと、main から更新した利用者の委譲が壊れる。
- 既存のテストのうち、前提が変わるものを計画書が行番号つきで列挙している(T3・T6・T10)。テストの意図を保って書き換える。
- hook と CLI のテストは、上書きの環境変数 5 つを親の環境から消してから動かす(T5)。開発者の環境で結果が変わるのを防ぐため。
- `plugins/better-agentics/scripts/` は手で編集しない。`src/` か `assets/` を変えたら `pnpm --filter better-agentics-scripts build` を実行し、差分を同じコミットに入れる。
- 指示書と `harness-docs/**` の Markdown は `prompt-smith:prompt-smith` の規律で書く。規律の文面を変えたら、計画書 §1 の禁止語の grep を当てる。
- `.claude/settings.local.example.json` はセッションの開始前からステージされていることがある。`.claude/settings.json` にも本件と無関係な変更がある。コミットは必ずパスを指定し、これらと `docs/chat/` を混ぜない。新しいファイルは `git add <パス>` してから、`git commit -- <パス>` でコミットする。

## 環境と運用の注意

- agent-policy の実装計画と引き継ぎは、Orca の worker が別に進めている。agent-policy と codiel のファイルは、このセッションでは変えない。
- `pick-delegate` が Jev を呼ぶので、`TYPESAFE_API_KEY` が要る。試作の T8 は実際の Jev を 2 回ずつ呼ぶ。
- 文書の日本語は native-japanese の規律に従う。「節」「段」「版」「契機」を使わない。

## 参照

- 設計書: `harness-docs/design/2026-11-10-better-agentics-launch-modes-and-subagent-performance-design.md`
- 実装計画書: `harness-docs/plans/2026-11-11-better-agentics-launch-modes-plan.md`
- 現行の設計書と計画書: `harness-docs/design/2026-10-26-better-agentics-design.md`、`harness-docs/plans/2026-10-26-better-agentics-plan.md`
- 食い違いの文書: `harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md`
- 会話記録: `docs/chat/2026/1110/phyllis998/0810-better-agentics-background-delegation.md`
