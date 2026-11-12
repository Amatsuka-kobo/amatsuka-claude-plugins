# codiel 1.1 の実装 引き継ぎ書

- 日付: 2026-11-12
- 引き継ぎ元: codiel 1.1 の実装計画のセッション(計画書のコミットまで完了)
- 引き継ぎ先: 実装計画書に従って実装するセッション
- 作業場所: main のチェックアウト `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins`。ブランチと worktree を作らない。PR は作らない

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | 完了(`harness-docs/design/2026-11-08-codiel-1-1-executor-neutral-and-design-layer-design.md`、最終の更新は `c463e252`。決定 D1〜D11、執筆者の判断 J1〜J16) |
| 実装計画書 | 完了(`harness-docs/plans/2026-11-12-codiel-1-1-plan.md`。12 タスク、計画の判断 P1〜P10) |
| 実装 | 未着手。T1 から始める |
| agent-policy・better-agentics | 1.1 に関わる食い違い(G5・G6・G8・G10・G11)は、2026-11-11 の両方針の改修で扱いが決まった。1.1 の実装は両方針の変更を待たない |

## 決まったこと

再検討しない。

- 設計書の 0 章の決定(D1〜D11)と 4 章の判断(J1〜J16)。5 章の採らなかった案を再提案しない。とくに、方針が無いときに全作業を自分で行うと明記する案、`general-purpose` / `Explore` への既定の委譲を残す案、basic-design を削除する案。
- 計画書の 3-4 の計画の判断(P1〜P10)。P1 は設計書 §9 の未決(標準の run で委譲先が決めずに返したときの受け方)への答えで、1.2 の 3.6 と同じ選択肢と止め方にした。P3 は設計書 3.2 を GitHub MCP の制約に当てた結果で、run の中の MCP の PR 作成は常に拒否する。
- バージョンは T1 で `1.1.0-dev` に 1 回だけ上げる。`1.1.0` への切り替えは T12 の後にユーザーが決める。`raguel-mcp` の `1.0.0-dev` は上げない。

## 未決のこと

- github モードのラベルの確認(init での作成、Issue 起点の run での付与、PR への付与、MCP の PR 作成の拒否)。T12 の Step 4 でユーザーに頼む。
- `-p` の実行でバックグラウンドの委譲の完了を待てるか。待てなければ、T12 の実機の確認をユーザーに対話のセッションで頼む。
- ADR の文面。T11 で `metatron:updating-architecture` を起動して決める。

## 実装で踏みやすい点

- このセッション自身は、インストール済みの codiel(キャッシュの 1.0.3)で動く。リポジトリの変更はこのセッションに反映されない。実機の確認は、計画書 T12 のとおりスクラッチのリポジトリで `claude --plugin-dir <リポジトリ>/plugins/codiel` を使う。
- hook の締め付け(T3・T4)は、それを満たす指示の変更と同じコミットに入れる。T4 では、`phase-pr.md` に `--label codiel` を足すまでコミットしない。
- GitHub MCP の `create_pull_request` はラベルを受け取らない。run の中では拒否し、`gh pr create --label codiel` へ誘導する(P3)。
- T4 で前提が反転する既存テストを、計画書が行番号つきで挙げている。期待を変えず、コマンドに `--label codiel` を足して直す。ラベルの検査はフェーズとマーカーの検査の後に置く。前に置くと、既存の拒否の理由を照合するテストが壊れる。
- `codiel:init` は、初期化済みのプロジェクトでは手順 0 で終わる。rules の差分とラベルの確認を手順 0 の判定に入れないと、既存のプロジェクトに 1.1 の変更が届かない(T5 Step 3・T10 Step 7)。
- 並列の待ちが残る間に `mark-ask` しない。run が `awaiting_human` になると guard-write の境界が外れる(P1)。
- `attempts-exceeded` の停止理由と要素の `attempts` は消さない。1.2 が使う。
- 指示層の行番号は HEAD `1bd72ece` の時点のもので、前のタスクの編集でずれる。条項の文面で場所を探す。
- 指示層に better-agentics・agent-policy・basic-design の名前と、設計書の決定の番号を書かない。計画書 3-3 の grep で確かめる。
- `plugins/codiel/scripts/` と `raguel-mcp/dist/` は手で編集しない。`src/` を変えたら `pnpm run build` を実行し、差分を同じコミットに入れる。
- 指示書と `harness-docs/**` の Markdown は `prompt-smith:prompt-smith` の規律で書く。SKILL.md の description は `prompt-smith:skill-creator` で書き換える。

## 環境と運用の注意

- 実機の確認で better-agentics を有効にするときは、このリポジトリの `.claude/settings.local.json` の `env` にある `AMATSUKA_AGENT_ENABLE_ORCHESTRATION` と `TYPESAFE_API_KEY` をスクラッチへ写す。値を記録とコミットに書かず、確認の後にスクラッチを消す。
- コミットはパスを指定して行う。`docs/chat/` と本件と無関係な変更を混ぜない。
- 文書の日本語は native-japanese の規律に従う。「節」「段」「版」「契機」を使わない。

## 参照

- 設計書: `harness-docs/design/2026-11-08-codiel-1-1-executor-neutral-and-design-layer-design.md`
- 実装計画書: `harness-docs/plans/2026-11-12-codiel-1-1-plan.md`
- 後続の設計書: `harness-docs/design/2026-11-08-codiel-1-2-workflow-modes-design.md`(3.6 の返し方を P1 でそろえた)
- 食い違いの文書: `harness-docs/design/2026-11-08-agent-policy-better-agentics-gaps-for-codiel.md`
- 会話記録: `docs/chat/2026/1112/phyllis998/1825-codiel-1-1-implementation-plan.md`
