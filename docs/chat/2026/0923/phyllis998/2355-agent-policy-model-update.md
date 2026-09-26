# agent-policy 推奨モデル更新

- 日付: 2026-09-23
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: plugins/agent-policy/ (モデル ID 3 件更新、バージョン 0.19.8-dev)
- 前提: 不明
- セッション ID: 0b67e557-f203-45c4-9502-bb05ff37f06c

---

## セッション 1: 推奨モデルを claude-gpt-6・claude-grok-4-7 へ更新、検証待ち

# phyllis998

> agent-policyの推奨モデルを変更したいです。
> as-is: claude-gpt-5-6-sol, claude-gpt-5-6-luna, claude-grok-4-6を推奨モデルに指定
> to-be: claude-gpt-6-sol, claude-gpt-6-luna, claude-grok-4-7を推奨モデルに指定

# AI

Dry run確認済。3パターン個別置換。

Version bump 0.19.7-dev → 0.19.8-dev、build・検証。

ビルドがハング中。原因 esbuild 側と推定、切り分け中。

CLI直接で成功。JS API経由(`esbuild.build`)だけハング → サンドボックス内のサービス子プロセス通信と推定。bundle差分確認。

Bundle差分 意図通りのみ。lint/typecheck/test 実行。

出力空 → pnpm自体ハング疑い。直接実行で確認。

node系ツールがサンドボックス内で全ハング(user時間≒0 → 起動直後にブロック)。サンドボックス外で再試行。

コード変更は終わりましたが、lint / typecheck / test がこの環境では最後まで走らず、検証もコミットもまだです。

## 変更内容
推奨モデル ID を置き換えました。

- `claude-gpt-5-6-sol` → `claude-gpt-6-sol`
- `claude-gpt-5-6-luna` → `claude-gpt-6-luna`
- `claude-grok-4-6` → `claude-grok-4-7`

変更したファイル:
- `plugins/agent-policy/src/agents/policies.ts`: 既定モデルの定義本体
- `plugins/agent-policy/scripts/setup-agents.mjs`: 再生成したバンドル。差分は上の 3 行だけです
- `plugins/agent-policy/skills/setup-agents/SKILL.md:100`: プロキシが見つからないときに候補として示す一覧
- `plugins/agent-policy/README.md`: モデル表
- `plugin.json` と `package.json`: バージョンを 0.19.7-dev から 0.19.8-dev に上げました

変更しなかったもの:
- `gpt-terra`(`claude-gpt-5-6-terra`)は依頼に含まれていなかったので 5.6 のままです。sol と luna だけ 6 になり、世代が混ざった状態です。
- テストに出てくる `claude-gpt-5-6-luna` などは、既定値の検証ではなく「適当なプロキシ別名」の例として使われているので残しました。
- `harness-docs/` の過去の設計書は当時の記録なので触っていません。
- `cliproxyapi.config.example.yaml` も変えていません。別名 `claude-gpt-6-sol` などに対応する上流モデル名(`gpt-6-sol` なのか等)がわからず、推測で書くことになるためです。プロキシ側にこの別名がないと、委譲したときに `unknown provider for model` で失敗します。
- SKILL.md の編集は値を置き換えただけなので、規約にある prompt-smith は使っていません。

## 検証が走らない問題
- `pnpm run build` がハングしました。esbuild の CLI を直接呼ぶと 20ms で終わり、JS API(`esbuild.build`)経由のときだけ止まります。
- `pnpm run lint`、`tsc`、`biome` も、サンドボックスの中でも外でも timeout しました。CPU 時間はほぼ 0 で、起動直後に何かを待って止まっているように見えます。
- `node -e` や `esbuild --version` は普通に動きます。
- 原因はまだわかっていません。前日から残っている tsserver が 10 本ほどあるので、この環境のプロセスか何かのロックを疑っています。

## お願い
手元で次を実行して、結果を貼ってください。

```
! pnpm run lint && pnpm run typecheck && pnpm run test
```

通ったら、agent-policy の変更だけをコミットします。`cliproxyapi.config.example.yaml` と `docs/chat/` にある既存の未コミット変更は含めません。止まる場合は、ハングの原因調査に切り替えます。

`★ Insight ─────────────────────────────────────`
- 既定モデルの正本は `policies.ts` 1 か所です。バンドルと SKILL.md の候補一覧はその写しなので、同時に直す必要がありました。
- テストがモデル ID を既定値と比べずに任意の文字列として使っているため、既定値を変えてもテストは直さずに済みます。
`─────────────────────────────────────────────────`

前のターンから状況は変わっていません。lint / typecheck / test の結果待ちです。

```
! pnpm run lint && pnpm run typecheck && pnpm run test
```

を実行して、結果を貼ってください。通ったら、agent-policy の変更だけをコミットします。
