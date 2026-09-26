# setup-agents merge/keep 改修 実装セッション起動プロンプト

以下を goal コマンドの入力として使う。

---

`agent-policy:setup-agents` の CLI(`plugins/agent-policy/src/setup-agents.ts`)で、`--roles` を削減して `--write --merge` を実行しても、削除した役割由来のツールと本文の節が自動保持され続けて落ちない不具合を直す。

## 最初に読む文書

まず `harness-docs/handover/2026-09-26-setup-agents-merge-keep-fix-handover.md` を読む。事象の再現手順、原因(`write()` 関数と `automaticKeep()` 関数、`setup-agents.ts` の 534・582・623行)、検討済みの設計選択肢 3 案がこの文書にある。設計判断はまだ確定していないので、まずこの文書の「検討した設計選択肢」を読み、案を選ぶかユーザーに相談してから実装する。

## 着手と進め方

1. `git status` と HEAD を確認する。本件と無関係な未コミット変更には触れない。
2. `pnpm run lint`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build` が通る baseline を確認する。
3. `plugins/agent-policy/src/setup-agents.ts` の `write()`(623行)、`automaticKeep()`(582行)、`merge()`(534行)、`parseKeep()`(480行)を読み、引き継ぎ書の原因説明と一致するか確かめる。
4. 引き継ぎ書の 3 案(役割由来の判別・opt-in化・`--drop`構文の追加)から方針を決める。規模が小さければ設計書を作らず、この goal の中で方針をユーザーに一度確認してから直接実装してよい。規模が大きいと判断したら、先に軽量な設計メモをこのセッション内で作り、承認を得る。
5. `plugins/agent-policy/src/__test__/setup-agents.test.ts:2226` の `describe("automaticKeep", ...)` に、「roles を削減したら不要なツール・節を自動保持しない」ケースを追加する。既存の「mcp__ と disallowedTools を保持しない」ケースは変えない。
6. 実装後、`.claude/agents/` にある実在の定義(このリポジトリの `complex-reviewer.md` など)を使わず、テスト用の一時ディレクトリで再現・確認する。`.claude/agents/` は本改修の対象ではない。
7. `pnpm run build` で `plugins/agent-policy/scripts/setup-agents.mjs` を再生成し、`plugin.json` と `package.json` のバージョンをパッチで上げ、同じコミットに含める。
8. `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` を通す。

## 制約

- MCP 系(`mcp__*` ツール、`disallowedTools`)の自動保持除外(GOTCHA-001 対応)の挙動は変えない。壊していないことをテストで確認する。
- `--keep` の selector 構文(`<kind>:<value>`、`preamble`)自体を変える必要はない。変えるなら引き継ぎ書の案3との整合を確認する。
- `plugins/*/scripts/` を手で編集しない。`src/` を変更して `pnpm run build` で再生成する。
- ブランチを切らない。切る必要があると判断したら worktree を使い、`scripts/setup-workspace.sh` を使う。
- `.claude/agents/` にある実在の 15 定義は変更しない(本改修の対象外)。

## Done の条件

- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` が通る。
- `pnpm run build` の差分が同じコミットにある。
- `plugin.json` と `package.json` のバージョンが揃って上がっている。
- 引き継ぎ書に書いた再現手順(役割削減 → 不要ツール・節が保持マージで残る)が、修正後に再現しないことをテストで示す。
- 修正内容を GOTCHAS へ記録するかどうかを判断する(`metatron:recording-gotchas`)。GOTCHA-001 と対になる事例になりうる。
