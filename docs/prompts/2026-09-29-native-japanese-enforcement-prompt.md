# native-japanese 0.2.0-dev 強化 実装セッション起動プロンプト

以下を goal コマンドの入力として使う。

---

`plugins/native-japanese` を 0.2.0-dev に改修する。承認済みの実装計画書の T0 から T22 までを完了し、Done の条件を満たすことをゴールとする。

## 最初に読む文書

1. `harness-docs/handover/2026-09-29-native-japanese-enforcement-handover.md`。確定済みの決定、承認地点、踏みやすい点が書いてある。
2. `harness-docs/plans/2026-09-28-native-japanese-enforcement-plan.md`。タスク、依存関係、契約、コミットの分け方、Done の条件が書いてある。
3. `harness-docs/design/2026-09-28-native-japanese-enforcement-design.md`。計画書が「設計書のセクション N」と参照する先である。

設計書と計画書は、どちらもユーザーが承認済みである。設計判断を蒸し返さない。計画書のセクション 7 に書かれた食い違いの扱いに従う。

## 進め方

- 最初の実務タスクに着手する前に、`agent-policy:custom-policy` を使う。各タスクは、計画書に書かれた担当役割の委譲先へ委譲する。オーケストレーターが自分で担うのは、T0、T7、T13 の判定、T21、T22 と、採否の判断である。
- 計画書のセクション 3 の依存関係を守る。並行してよいと書かれたものは、並列に dispatch する。
- 承認地点では、ユーザーの応答を待ってから先へ進む。
  - A1: T7 の ADR
  - A2: T16 の `discipline.md` の改稿
  - A3: T20 の前に行う IPADIC の NOTICE の扱い
- T15 のうち Serena の編集の確認は、ユーザーに対話セッションでの実施を依頼する。
- 実施記録は、計画書のセクション 9 に追記する。
- コミットは、計画書のセクション 5 の単位で作る。

## 制約

- `plugins/*/scripts/` を手で編集しない。`src/` を変えて `pnpm run build` で作り直し、同じコミットに含める。
- npm の依存を増やさない。lindera の npm パッケージは import しない。`.node` を `createRequire` で直接読み込む(GOTCHA-004)。
- lindera の活用は、添字 `details[4]`(活用型)と `details[5]`(活用形)で読む(GOTCHA-003)。
- `claude -p` による確認は、リポジトリの外で `--setting-sources "" --strict-mcp-config` を付けて実行する。
- ブランチを切らない。切る必要があるときは worktree を使い、`scripts/setup-workspace.sh` で準備する。
- 本件と無関係な未コミットの変更には触れない。

## Done の条件

- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` が通る。
- `pnpm run build` の差分が、対応するコミットに含まれている。
- `plugin.json` と `package.json` のバージョンが、ともに `0.2.0-dev` になっている。
- `description` が、`plugin.json`、`marketplace.json`、ルートの `README.md` の 3 か所で一致している。
- ADR と ARCHITECTURE が、`/metatron:update` で反映されている。
- 新しいセッションで、次の 3 つを実機で確かめてある。
  - 取得(T10)
  - 差し戻し(T15)
  - 注入(T19)
- 計画書のセクション 8 の Done の条件をすべて満たしている。
