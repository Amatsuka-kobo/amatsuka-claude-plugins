# outcome の自動同期

`/codiel:run` や `/codiel:test` などすべての codiel コマンドは、起動時に 1 回以下を行う。

1. `node <plugin-root>/scripts/codiel-state.mjs get --active` を実行する。この実装は
   `active` / `awaiting_human` / `awaiting_outcome` の run をすべて `runs` に含めて返す。
   ただし codiel 0.x の run(`state.version` が 1)は、`awaiting_outcome` のものだけが含まれる。
   同期対象はそのうち `state.status === "awaiting_outcome"` の run に絞り込む
   (それ以外の run はここでは何もしない)。
2. 絞り込んだ各 run を `state.integration` で分岐する。
   - github: `state.pr.url` が null でない run だけを対象にし、`gh pr view <state.pr.url>
     --json state,mergedAt` で PR の現況を確認する。マージ済み(`mergedAt` が非 null)なら取り込み済み、
     マージされずクローズ(`state: "CLOSED"` かつ `mergedAt` が null)なら却下とする。オープンのまま
     (`state: "OPEN"`)なら何もせず、次回の起動時にまた確認する。
   - local: `git merge-base --is-ancestor <state.branch> <state.baseBranch>` を実行する。
     終了コードが真(0)なら取り込み済みとする。偽なら、この run を取り込み済みとして扱うかを
     ユーザーに聞く。回答が「取り込み済み」なら取り込み済み、「却下」なら却下とし、判断が
     付かなければ何もせず次回の起動時にまた確認する。
3. 取り込み済みと判定した run は `mcp__plugin_codiel_raguel__record_outcome`(`outcome: "approved"`、
   `evaluationId` は下記の選定順)を呼び、続けて
   `node <plugin-root>/scripts/codiel-state.mjs record-outcome --slug <slug> --outcome approved`。
   却下と判定した run は同様に `outcome: "rejected"`(`evaluationId` は下記の選定順)で両方を記録する。
   run 全体の結末には `ruling` を付けない(`ruling` はフェーズのゲートでの人の裁定を表す)。
4. incident(PROCEED したのに実害が出た)は自動検知できない。人が明示的に申告したときのみ、
   `mcp__plugin_codiel_raguel__record_outcome`(`outcome: "incident"`、`evaluationId` は下記の選定順)+
   `codiel-state record-outcome --slug <slug> --outcome incident` を記録する。最も価値の高い失敗判例
   なので、申告を勝手に補ったり省略したりしない。
   記録の前に `<plugin-root>/skills/orchestrating-runs/references/gotcha-candidates.md` を Read する。記録したら、その手順で GOTCHAS 候補を書き、この同期の報告に一覧する。

run 全体の結末(`approved` / `rejected` / `incident`)を記録する際の `evaluationId` は、
「最後にコードを検査した evaluate」の evaluationId を使う。優先順は次のとおり:
`state.phases["fix-loop"].evaluationId` → なければ `state.phases["test-loop"].evaluationId` →
なければ `state.phases["implement"].evaluationId` → なければ `state.phases["test-code"].evaluationId`。

`state.version` が 1 の run は、次のとおり読む。

- `state.integration` を持たないので、github として扱う。
- `state.pr.url` と、選定順に挙げたフェーズのうち fix-loop・test-loop・implement の 3 つは version 2 と同じ名前で持つので(test-code は version 1 に無い)、そのまま読む。
- `record-outcome` の `--slug` には `state.runId`(`issue-<N>` の形)を渡す。
