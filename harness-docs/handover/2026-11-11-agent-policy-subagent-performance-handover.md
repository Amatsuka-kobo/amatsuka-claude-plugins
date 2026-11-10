# agent-policy 改修(サブエージェントの性能策と codiel との食い違いの解消)の実装 引き継ぎ書

- 日付: 2026-11-11
- 引き継ぎ元: agent-policy の改修の設計と実装計画のセッション(設計書の承認と計画書の作成まで完了)
- 引き継ぎ先: 実装計画書の T0〜T8 を進めるセッション
- 作業場所: リポジトリ `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins` の main。ブランチと worktree を作らない

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | 承認済み。`d35d0d0a`・`a2c9a93d`・`a6c1a213`・`d57ac911` |
| 実装計画書 | 承認済み。`harness-docs/plans/2026-11-11-agent-policy-subagent-performance-plan.md` |
| 実装 | 未着手。T0(試作 S1〜S7)から始める |

## 決まったこと

再検討しない。根拠は設計書の 0 章(D1〜D20)・11 章(J1〜J29)・12 章(採らなかった案)にある。

- 外側の手順(このプラグインの外のスキルやコマンドが定める手順)は、「両方に従い、両立しないとき(同じ目的の手順が重なるときを含む)だけ、名前で起動したものを優先する」原則で扱う(D7・D12・J22・J24)。
- 再レビューは、critical・high が残らなくなるまで上限なく回す。最後の巡の medium 以下は判断を仰ぐ(D11)。
- 修正のループは、1〜3 ラウンドは書いた委譲先を再開し、4 ラウンド以上は escalation で 2 ラウンドごとに起動し直す。文書の修正は escalation に回さず、4 ラウンド目からオーケストレーターが直す(D20・J27)。
- fork は complex-impl だけに使い、外側の手順の下では使わない(D2・M2)。
- `_common.md` の 4 条は依頼文を優先する形に改め、役割断片の安全弁は残す。light-impl の hooks の条項だけを外す(D8・D18)。
- delegation gate のコードは変えず、README に両立しないと書く(D10・M6)。
- バージョンは `0.21.8-dev` のまま上げない(D9)。

## 未決のこと

- 試作 S1〜S7 の結果。計画書 T0 の「分岐」の表に、結果ごとに変えるタスクを書いてある。
- S1 で fork が委譲を始め、文面を強めても直らないときは、D2 をユーザーと見直す。
- S2 で、修正の作業全体の費用が、再開のほうが新しい起動より高いときは、両方の数値を添えて D1 の修正の部分を見直すかをユーザーに聞く(計画書 T0 の分岐)。

## 踏みやすい点

- 指示書(`skills/`・`references/`・`assets/`)に、codiel の名前も固有の語も書かない。「Workflow」「Auto Ask」「委譲の指定」「`declined`」も書かない。Jev の名前も書かない。
- 設計書 5.1 の「両立しない例」の表は、規律に写さない。例は閉じた列挙として読まれる。
- codiel 1.2 の設計書の試作 S7(この計画の S7 とは別)は、改修の前の定義で試す。T1 の前に、改修前のプラグインと定義をリポジトリの外の消えない場所へ保存し、パスを計画書 5 章に記録する(T0 の Step 0)。codiel 1.2 の S7 そのものは codiel の実装計画で行う。
- バージョンを上げないので、インストール済みのキャッシュ(`~/.claude/plugins/cache/amatsuka-claude-plugins/agent-policy/0.21.8-dev/`)には改修が入らない。実機の確認(T0・T8)は、リポジトリの外の試験用のプロジェクトで `claude -p --setting-sources project --plugin-dir <プラグインのディレクトリ>` で起動し、写しの規律が読まれていることを最初に確かめる(計画書 1-1)。`-p` では許可の無い操作が確認なしに拒否されるので、試験用のプロジェクトの `permissions.allow` に要る操作を書く。
- setup-agents の 2 キーは、テンプレートに出さない。生成の前に読み、生成の後に行単位で書き戻す。`parseDocument`・`render` の往復は、空行とコメントを落とすので使わない(J17)。
- このリポジトリの `.claude/agents/` の 13 定義は作り直さない。better-agentics の形の本文で、改修の試験には使えない。試験は、リポジトリの外の試験用のプロジェクトで生成した定義で行う(計画書 1-1)。このリポジトリの `.claude/settings.json` は他のプラグインも有効にしているので、試験のセッションは `--setting-sources project` で起動する。
- 指示書には、他プラグインの名前、設計書の D・J の番号、行番号を書かない。設計書の箇条は、条項の文面に書き直して入れる。
- このリポジトリの規約は `plugins/*/hooks/hooks.json` に手順を定めている。そのため、light-impl は D18 の後もここでは hooks の変更を断る。S5 は、そうした規約の無いプロジェクトで試す。
- 実機の確認は、計画書が名指しするモデル(Opus・Fable・Sonnet)で通す。Sonnet で動かないときは、モデルを上げずに規律の文面で直す。
- 規律の箇所は、行番号ではなく条項の文面で指す。T5 の編集で行番号がずれる。

## 環境と運用の注意

- ステージ済みの `.claude/settings.local.example.json`、作業ツリーの `.claude/settings.json`、`docs/chat/` の変更をコミットに混ぜない。コミットはパスを指定する。
- `src/` を変えたら `pnpm --filter agent-policy-scripts build` を実行し、`scripts/` の差分を同じコミットに入れる。
- AI が読む Markdown は、`prompt-smith:prompt-smith` を起動してから書く。

## 参照

- 設計書: `harness-docs/design/2026-11-10-agent-policy-subagent-performance-and-codiel-gaps-design.md`
- 実装計画書: `harness-docs/plans/2026-11-11-agent-policy-subagent-performance-plan.md`
- better-agentics の設計書: `harness-docs/design/2026-11-10-better-agentics-launch-modes-and-subagent-performance-design.md`(試作の結果を共有できる)
- 食い違いの文書: `harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md`
- 規律: `plugins/agent-policy/references/orchestration-discipline.md`
