# prompt-smith の改善ループを改善する起動プロンプト

以下を goal コマンドの入力として使う。

---

`prompt-smith` の改善ループ（`run-loop.mjs` と `improve-description.mjs`）が生成する description の品質を改善せよ。測定基盤は健全であることを確認済みであり、改修対象ではない。最初に `harness-docs/handover/2026-09-18-prompt-smith-improve-loop-handover.md` を全文読み、記載された確定事実とスコープを守ること。

## 目的

`agent-creator` の改善ループが、原文を上回る description を生成できなかった原因を検証し、検証結果に基づいて改善ループが生成する description の品質を上げる。仮説を事実として扱わない。

確認済みの観測は次のとおりである。

- 20 問・`--max-iterations 3`・`--holdout 0.4`・`--runs-per-query 3`・`--model sonnet` のループでは、原文 1154 バイトは train の true 6 問で 1/6、ループ生成の 712 バイトと 1106 バイトも各 1/6 だった。`best_description` は原文であり、`exit_reason` は `max_iterations (3)` だった。
- 同じ description の全 20 問の単発測定では、原文は true 平均 0.20・false 平均 0.00・12/20、712 バイトのループ生成案は 0.17・0.00・12/20、人手の 613 バイト案は 1.00・0.00・20/20 だった。712 バイトと 613 バイトは長さが近く、長さは要因ではない。
- `runLoop` は反復ごとの `currentDescription` を全 20 問の `runEval` に渡す。`replaceDescription`、`buildSandboxSkillMd`、ループと単発測定の一致も確認済みである。測定基盤を疑って変更しない。

## 検証の順序

1. ループ案が判定規則の形で、人手案が用途の形で書かれている違いが発火率の差の要因かを測る。同じ内容を用途の形に書き直した案を作り、測定する。
2. `improve-description.ts` の `buildImprovePrompt` と失敗した問の提示方法を読み、規則の形を誘導していないかを調べる。
3. ループ案から「保険金請求、契約書、不動産、経費」という除外すべき語の列挙だけを外した案を測る。これらは落ちた問の題材でもある。

ループ案の規則は、対象ファイルのパスに `agents/` があれば話題を問わず skill を使い、業務内容では判定しないという内容である。落ちた 5 問にはすべてパスが含まれる。人手案は `.claude/agents/` と `plugins/*/agents/` の subagent 定義を作成・点検・修正するときに使うこと、作成、レビュー、監査、権限の最小化、責務の分割、agent 間の境界・受け渡し・model 継承の整理にも使うことを記している。これらの違いは仮説であり、断定しない。

## 測定

各案は次の条件で単発測定する。

```bash
node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
  --skill-path plugins/prompt-smith/skills/agent-creator \
  --eval-set plugins/prompt-smith/evals/agent-creator.json \
  --description "$(cat <案のテキスト>)" \
  --model sonnet --runs-per-query 3 --out <出力先>
```

出力はリポジトリ外に置き、測定の前後で `git status --porcelain=v1` が一致することを確認する。60 spawn は通常約 40 秒で終わる。`errors` が 0 でも、10 分以上かかって全問 0 発火なら WSL のフリーズによるタイムアウトであり、結果として採用しない。`claude --version` を測定の前後で記録する。`history[].results` は元の eval セットとインデックス対応しないため、問は query 文字列で突き合わせる。衝突を観測するときは `--holdout 0` を使う。

## 制約

- 測定基盤の隔離、`errors` 分離、`--help`、長さの予算、`parseSkillMd`、eval セット、`SKILL.md` の長さの規律は変更しない。`SKILL.md` は 600 バイト前後で確定している。
- 反復の順序は測定、記録、改善である。`history[N].description` はその反復で測ったもの、`improve_iter_N.json` の `final_description` は次の反復で測る生成物である。
- 失敗が続いても、規則を詳しくする変更を根拠なく重ねない。検証結果が示す範囲でだけ改善する。
- 本件と無関係な作業ツリーの変更を revert、削除、上書き、コミットに混入させない。

## 完了報告に含めること

- 各仮説の測定条件、所要時間、`errors`、集計結果、および結論か未確定かの区別
- `buildImprovePrompt` と失敗問の提示方法の調査結果
- 実施した改修、その根拠、改善後のループ測定結果
- 実行した検証、変更したファイル、残る未解決事項
