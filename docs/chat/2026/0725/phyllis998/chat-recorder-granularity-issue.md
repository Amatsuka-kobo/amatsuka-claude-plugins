# chat-recorder のグラニュラリティ問題の調査と修正

- 日付: 2026-07-25
- 参加者: phyllis998
- 成果物: (調査・修正の進行中)
- 前提: plugins/task-utility/

---

## セッション 1: 問題の報告と調査着手

# phyllis998

> task-utilityによる新しいバックグラウンドでのチャット記録が、chat-recorderに比べて要約されすぎに感じます。なぜこうなっているのか調査し、修正まで行いたいです。

## セッション 2: 根因分析と修正実装

# AI

**調査の進め方**

agent-policy:with-codex スキルで方針を確認した上で、task-utility のコード全体を読解しました。prepare-chat-recording、extract-conversation、chat-recording-state 各スクリプトのロジック、過去の修正履歴、ヘッドレス recorder のログ出力を追跡。

**問題の仮説検証**

当初「新背景エージェント（chat-recorder）が モデルの要約設定で粗くなっているのでは」と考えていましたが、chat-reader エージェントに「同じ prepare JSON から出発した2つの記録ファイルを比較」させたところ、複雑な構造 — 削除されたセッション、抽出ツールのバージョン、記録先など — が目に入りました。その後、実装層に降りて直接測定に切り替えました。

**根因の発見**

バグは `src/extract-conversation.ts:53` の1行、`let seenUser = sinceLine <= 0` でした。

メカニズム：
1. 記録の抽出区間は `(recordedLine, targetLine]`。targetLine は check-chat-recorded.ts が書く「最後のユーザー発言行」なので、区間内容は **先頭に AI の応答 → 末尾に今回のユーザー発言** という必然的な順序になります
2. 増分抽出時(`sinceLine > 0`)、`seenUser` は `false` で始まり、`if (!seenUser) continue` が最初の USER 行まで全 ASSISTANT を捨てる
3. その USER 行は区間の末尾にあるため、AI の作業本体がすべて消えます

実測による A/B 比較（同一トランスクリプト、ゲート有無のみ変動）：

| 窓 | 現行（ゲート有） | 修正後（ゲート除去） |
|---|---|---|
| 0→91 | 4,297字 | 4,297字 |
| 91→261 | **48字** | 6,976字 |
| 261→445 | **22字** | 7,137字 |
| 445→588 | **97字** | 4,701字 |

window 91→261 の現行出力は全文がこれだけです：

```
## USER

> 修正2に進んでください

> 一旦コミットし、その後修正2に進んでください
```

これは chat-reader が「ファイルA2のAIセクションが空」と報告したものと完全に一致。初回だけ無傷なのは `sinceLine=0` でゲートが不活性だったからで、これが「chat-recorder より要約されすぎ」に見えた正体です。

**背景：混入経緯**

バグは commit `29c8808`（7/24 12:37）で混入。コメント「前回記録済みターンの末尾断片を差分に混ぜない」とありますが、commit-chat-recording.ts:242 が `recordedLine = targetLine`（=そのユーザー発言行）を書くため、その行より後は全部未記録です。守るべき「記録済み断片」は存在しないまま本文だけが落ちていました。

**修正と検証**

- `src/extract-conversation.ts` — ゲート削除。区間の形状ごとコメントに根拠を明記（再発防止）
- `src/__test__/extract-conversation.test.ts` — 既存テストが誤った前提を固定していたので反転させ、実際の window 形状の回帰テストを追加。修正前にこのテスト2件が失敗することを確認
- `pnpm build` で bundle 再生成（extract-conversation.mjs と、抽出器を inline 展開している prepare-chat-recording.mjs）
- `plugin.json` 0.6.3-dev → **0.6.4-dev**

全体検証：task-utility 全117テスト passing、バンドルスクリプトを実トランスクリプトで再実行して上表の数値を確認。

**補足と教訓**

既存の薄い記録3件（chat-recorder-headless-tempdir-fix.md など）は復元していません。トランスクリプトは残るので再生成可能ですが、ファイル上書きは破壊的なため判断をお任せします。

このバグが長く見逃された理由：失敗が「壊れる」ではなく「静かに薄くなる」。パイプラインは毎回 `ok=true` を返し、記録は「それらしく」見えました。防御的なガードが呼び出し規約と実装層で食い違うと、守るものが無いまま本体を削ることになります。

# phyllis998

> コミットお願いします。また、記録の再生成もお願いします

## セッション 1: seenUser ゲートによる記録削除バグの修正と記録再生成

# AI

**何をしたか**

chat-recorder の根因調査と修正。`src/extract-conversation.ts` の `seenUser` ゲートが記録削除バグを引き起こしていることを発見し、ゲート削除・テスト修正・バンドル再生成を実施。並行して、復元トランスクリプトに対して削減記録の再生成を GPT Terra に委譲しました。

**失敗の経緯と根因**

当初は「chat-recorder エージェントの要約設定で粗くなっているのでは」と仮説を立てていました。ただ chat-reader が返した比較情報を見ると、ファイル削除・抽出バージョン・記録先など複雑な構造が目に入り、調査を実装層に降ろしました。

直接測定の結果、バグは commit `29c8808` で混入した `src/extract-conversation.ts:53` の 1 行、`let seenUser = sinceLine <= 0` に発見：

1. 記録の抽出区間は `(recordedLine, targetLine]`。`targetLine` は最後のユーザー発言行なので、**区間の必然的な構造は「先頭に AI の応答 → 末尾に今回のユーザー発言」**
2. 増分抽出時(`sinceLine > 0`)、`seenUser` は `false` で始まり、`if (!seenUser) continue` が最初の USER 行まで全 ASSISTANT を捨てる
3. その USER 行は区間の末尾にあるため、AI の作業本体がすべて消える

実測による A/B 比較（同一トランスクリプト、ゲート有無のみ変動）：

| 窓 | 現行（ゲート有） | 修正後（ゲート除去） |
|---|---|---|
| 0→91 | 4,297字 | 4,297字 |
| 91→261 | **48字** | 6,976字 |
| 261→445 | **22字** | 7,137字 |
| 445→588 | **97字** | 4,701字 |

window 91→261 の現行出力は全文がこれだけ：
```
## USER

> 修正2に進んでください

> 一旦コミットし、その後修正2に進んでください
```

このバグが長く見逃された理由は、失敗が「壊れる」ではなく「静かに薄くなる」こと。パイプラインは毎回 `ok=true` を返し、記録は「それらしく」見えました。

**修正と検証**

- `src/extract-conversation.ts` — `seenUser` ゲート削除、区間形状ごと根拠をコメントに明記（再発防止）
- `src/__test__/extract-conversation.test.ts` — 既存テストが誤った前提を固定していたので反転させ、実際の window 形状の回帰テスト追加。修正前にこのテスト 2 件が失敗することを確認
- `pnpm build` で bundle 再生成（`extract-conversation.mjs` と `prepare-chat-recording.mjs`）
- `plugin.json` `0.6.3-dev` → **`0.6.4-dev`**

全体検証：task-utility 全 117 テスト passing、実トランスクリプトで再実行して上表の数値を確認。

**記録の再生成**

復元したトランスクリプトから 2 ファイル（`chat-recorder-tempdir-phase2.md`、`chat-recorder-tempdir-finalization.md`）を再生成。agent-policy ポリシーに従い、ドキュメント作業を GPT Terra に委譲しました。

再生成の検証：
- **USER 発言 5 件すべてが原文のまま**（復元会話に対して grep -Fx で完全一致を確認）
- **引用された 6 件のコミットハッシュが全て実在**し、subject も一致（`829ae01` / `9ab688c` / `a0bb75c` / `b99eff4` / `399ca59` / `29b8b17`）
- 記載された数値（テスト件数 110/112/954/106、`ab-2026-0725-001`、`defaultExpiryDays` 等）が復元会話の該当窓に実在。創作は検出されず

内容も 4 スロット（何をしたか/決定と理由/却下された選択肢/失敗・やり直し）が実際に埋まっており、B 群と同等の「失敗の経緯」が復元されました。

**対象外**

`chat-recorder-headless-tempdir-fix.md` は再生成していません。この window は `sinceLine=0` で抽出されておりゲートが不活性だったため、修正前後ともに 4,297 字で同一 — バグの影響を受けていません。

# phyllis998

> マージお願いします
