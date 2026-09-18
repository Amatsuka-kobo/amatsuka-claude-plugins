# prompt-smith の改善ループを改善する引き継ぎ書

- 日付: 2026-09-18
- 引き継ぎ元: `prompt-smith` の測定基盤改善を完了し、改善ループの出力を測定したセッション
- 引き継ぎ先: 改善ループが生成する description の品質を検証し、必要な改修を行うセッション
- 対象プラグイン: `plugins/prompt-smith`

## 現在地

| 項目 | 状態 |
| --- | --- |
| 測定基盤 | **確認済み**。改善ループと単発測定が、同じ description・同じ問で一致する |
| `agent-creator` の改善ループ | **未改善**。3 回の反復のいずれも原文を上回らなかった |
| 原因 | **未確定**。description の書き方と語の列挙に関する仮説を次セッションで検証する |
| 次の目的 | 改善ループが生成する description の品質を上げる |

測定基盤、eval セット、`SKILL.md` の長さの規律は前の改修で完了している。本件では変更しない。

## 次セッションが最初にやること

1. 本引き継ぎ書、`plugins/prompt-smith/docs/measurement-2026-09-17.md`、`improve-description.ts` の `buildImprovePrompt` を読む。
2. 優先順 1 の仮説を、同じ内容を用途の形に書き直した description で測る。
3. 結果を踏まえ、改善プロンプトの本文と失敗した問の提示方法が、規則の形を誘導していないかを調べる。
4. ループ案から除外すべき語の列挙だけを外した description を測る。

---

## 1. 観測結果

`agent-creator` の eval 20 問に対して、`--max-iterations 3`、`--holdout 0.4`、`--runs-per-query 3`、`--model sonnet` で改善ループを実行した。

| 反復 | 測った description | バイト | train の true 6 問の合格 |
| --- | --- | ---: | --- |
| 1 | 原文 | 1154 | 1/6 |
| 2 | ループ生成 | 712 | 1/6 |
| 3 | ループ生成 | 1106 | 1/6 |

`exit_reason` は `max_iterations (3)` だった。`best_description` は反復 1 の原文であり、どの反復も原文を上回らなかった。

同じ description を単発測定へかけ直した全 20 問の結果は次のとおりである。

| 案 | バイト | true 平均 | false 平均 | passed |
| --- | ---: | ---: | ---: | --- |
| 原文 | 1154 | 0.20 | 0.00 | 12/20 |
| ループ生成 | 712 | 0.17 | 0.00 | 12/20 |
| 人手 | 613 | **1.00** | 0.00 | **20/20** |

712 バイトのループ生成案と 613 バイトの人手案では、長さが近い一方で true 平均が 6 倍異なる。長さは要因ではない。

反復の順序は「測定 → 記録 → 改善」である。したがって、`history[N].description` はその反復で測った description、`improve_iter_N.json` の `final_description` はその反復で生成し、次の反復で測る description を表す。

---

## 2. 測定基盤について確認済みのこと

次の事項はすべて確認済みであり、測定基盤の改修対象ではない。

- `runLoop` は `description: currentDescription` を `runEval` へ渡す。`currentDescription` は `run-loop.ts` L386 で反復ごとに `newDescription` へ更新される。
- 測定対象は `allQueries = [...trainSet, ...testSet]` であり、全 20 問である。
- `replaceDescription` はブロックスカラーの description を正しく置換する。実際の試験で確認済みである。
- `buildSandboxSkillMd` は frontmatter を組み直す。このため、`skillContent` に frontmatter を含む `run-loop` の経路と、含まない `run-trigger-eval` の経路は、同じサンドボックスの `SKILL.md` を生成する。
- 同じ description・同じ問について、`run-loop` 経由と `run-trigger-eval` 経由の結果は完全に一致した。train の true 6 問では、どちらも 0.17 だった。

---

## 3. 検証する仮説

以下は観測から得た仮説であり、結論ではない。

ループ生成の 712 バイト案は、対象パスに `agents/` が含まれるなら話題を問わず必ず skill を使い、業務内容では判定しないという**判定規則**を冒頭に置く。一方、人手の 613 バイト案は、`.claude/agents/` と `plugins/*/agents/` の subagent 定義を作成・点検・修正するときに使い、作成、レビュー、監査、権限の最小化、責務の分割、agent 間の境界・受け渡し・model 継承の整理を頼まれたときにも使うという**用途**を冒頭に置く。

落ちた 5 問はすべてパスを含むため、ループ案の規則に照らせば発火すべきである。また、ループ案は「保険金請求、契約書、不動産、経費」という除外すべき語を列挙し、これらは落ちた問の題材でもある。反復 2 で 1106 バイトへ戻した案も、「パスが出る」「agent という言葉で頼まれている」というより詳しい規則を記した。

### 別件の調査と突き合わせて見えた構図

同じ改修で `prompt-smith` の短縮案を調べたところ(記録は `plugins/prompt-smith/docs/measurement-2026-09-17.md` の「短縮で誤発火が増えた要因」)、**除外の書き方に関して、独立した 3 つの観測が同じ方向を指した。**

| 案 | 除外の書き方 | 結果 |
| --- | --- | --- |
| `prompt-smith` 短縮 658 バイト | 対象の列挙と除外の宣言が同じ語を共有する | true 0.93 / **false 0.30(誤発火が増えた)** |
| `agent-creator` ループ生成 712 バイト | 除外すべき業務語を明示的に列挙する | **true 0.17(発火しない)** / false 0.00 |
| `agent-creator` 人手 613 バイト | 除外は 2 文に抑え、用途を主に書く | **true 1.00** / false 0.00 |

**除外を厚く書いた 2 案がいずれも悪化し、用途を主に書いた案だけが良い。** ただし悪化のしかたは逆向きで、一方は誤発火が増え、もう一方は発火しなくなった。

この構図は、次の仮説を示唆する。**description は判定規則としてではなく、依頼との照合に使われる。** 除外の記述は照合の材料としては働きにくく、書きすぎると本来の用途の記述を薄める。

**3 件とも別々の目的で測ったものであり、この仮説を検証するために設計した測定ではない。** 確かめるには、除外の量だけを変えた案を複数作って測る必要がある。

### 検証の優先順

1. 規則の形と用途の形の違いが、発火率の差の要因かを測る。同じ内容を用途の形に書き直した案を作る。
2. `buildImprovePrompt` の本文と失敗した問の提示方法が、規則の形を誘導していないかを調べる。
3. ループ案から除外すべき語の列挙だけを外した案を測る。
4. 上表の構図を検証する。除外の量だけを変えた案を 3 段階ほど作り、同じ eval で測る。

各検証では、仮説を断定に格上げしない。

---

## 4. 改善プロンプトの現状

`improve-description.ts` の `buildImprovePrompt` は、失敗した問と長さの予算を提示する。移植元である Anthropic 公式 skill-creator の tips は次の 4 点である。

- 命令形で書く。
- ユーザーの意図に焦点を当てる。
- 他スキルと区別がつくようにする。
- 失敗が続くなら書き方を変える。

予算は `Math.max(byteLength(selectBest(history).description), 680)` である。「短い方が強い」という主張は本文に意図的に書かれていない。

---

## 5. 測定手順

各案は次のコマンドで測る。

```bash
node plugins/prompt-smith/scripts/run-trigger-eval.mjs \
  --skill-path plugins/prompt-smith/skills/agent-creator \
  --eval-set plugins/prompt-smith/evals/agent-creator.json \
  --description "$(cat <案のテキスト>)" \
  --model sonnet --runs-per-query 3 --out <出力先>
```

- 1 回は 60 spawn で、通常は約 40 秒で終わる。毎回 `errors` が 0 であることを確認する。
- 出力はリポジトリ外へ置く。測定の前後で `git status --porcelain=v1` が一致することを確認する。
- 測定は隔離されており、リポジトリを汚さない。
- WSL がフリーズしていると全問がタイムアウトする。タイムアウトは `not_triggered` に分類され、`errors` には計上されないため、全問 0 発火・`errors` 0 となる。通常約 36 秒に対して 10 分以上かかるときは異常である。
- CLI の自動更新がフリーズの原因になりうるため、`claude --version` を測定の前後で控える。
- `history[].results` は train / test に分割された部分集合であり、元の eval セットのインデックスと対応しない。問は query 文字列で突き合わせる。
- `--holdout 0.4` では基準 6 の問が holdout 側へ入ることがあり、反復ごとの結果に現れない。衝突を観測するときは `--holdout 0` を使う。

---

## 6. スコープ外

- 測定基盤の隔離、`errors` の分離、`--help`、長さの予算、`parseSkillMd` の改修
- eval セットの問の差し替え
- `SKILL.md` の長さの規律。600 バイト前後で確定している

---

## 7. 参照

- 測定の記録: `plugins/prompt-smith/docs/measurement-2026-09-17.md`
- 設計書: `harness-docs/design/2026-09-17-prompt-smith-measurement-improvement-design.md`
- 実装計画書: `harness-docs/plans/2026-09-17-prompt-smith-measurement-improvement-implementation.md`
- 生データ: `~/prompt-smith-measure-2026-09-17/`。リポジトリ外にあり、コミットしない
- 直前の改修のコミット範囲: `c92f29d..c24b989`
