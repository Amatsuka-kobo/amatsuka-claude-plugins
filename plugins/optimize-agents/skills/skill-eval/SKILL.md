---
name: skill-eval
description: SKILL.md の frontmatter にある description を書く・直す・レビューするときに必ず使用する。あわせてスキルの発火精度と出力契約の測定も担当する。「この SKILL.md の description を直して」「description を書いて」「description 直して」「description をレビューして」「発火精度を測って」「eval を回して」「eval セットを作って」「このスキル、狙った依頼で発動しない」「誤発火するので抑えたい」のような依頼で使う。description の改稿と測定は一体の作業として扱い、直したら測る。本文の改稿は prompt-smith、Agent 定義は agent-creator が担当する。測定対象は skill に限り、Agent 定義の発火は測らない。スキルや Claude Code の仕組み・使い方を説明するだけの質問には使わない。
---

# スキルの description と測定

対象は SKILL.md の frontmatter にある description である。本文は `optimize-agents:prompt-smith` が扱う。

## description の書き方

`../../references/description-guide.md` に従う。`prompt-smith` の削る基準は description に当てない。

## 3 種を同時に測る

| 種別 | 依頼 | 期待 |
| --- | --- | --- |
| substantive | 固有名・パス・背景を含む長い依頼 | 発火する |
| short | 実運用に多い一言の依頼 | 発火する |
| fp | 担当が近い別スキルが正解の依頼 | 発火しない |

3 種すべてを毎回測る。除外を足すと fp は改善するが substantive と short が落ちる。例示を足すとその逆になる。

## 測る

```bash
node plugins/optimize-agents/scripts/run-trigger-eval.mjs \
  --skill <SKILL.md のパス> \
  --eval-set <クエリ JSON> \
  --runs 2 --workers 6
```

eval セットは測定対象スキルの隣の `evals/{trigger,short,fp}/<skill>.json` に置く。形式は `[{query, should_trigger}]`。

出力の `environment` は測定に使った認証経路を示す。過去の測定と比べるときは、この値が一致していることを確かめる。

## 直す

3 種の内訳を見る。合計だけで判断しない。

| 症状 | 直す方向 |
| --- | --- |
| substantive が落ちる | 何をするスキルかを具体的に書く |
| short が落ちる | 口語・省略形の言い回しを例示に足す |
| fp が落ちる | 担当が近いスキルの名前と、そちらが担当する場面を書く |

除外の記述と発火の例示は同じ改稿で入れる。除外だけを足さない。

## eval セットの書き方

クエリに指示語(「この」「さっきの」「あの」)を入れない。参照先が無いまま単体で投げられるので、対象不明と判断されて発火しない。実運用の会話には先行文脈があるため、この差は測定だけに現れる。

対象を示すときは具体名かパスで書く。

| 書き方 | 発火 |
| --- | --- |
| 「この SKILL.md の description を直して」 | 1/4 |
| 「chat スキルの SKILL.md の description を直して」 | 4/4 |

## ばらつきを疑う

1〜2 問の差で description を直さない。同じ実装・同じ条件でも結果は動く。

差が気になるときは、そのクエリだけを `--runs 10` 以上で測り直す。連続測定では先に走った方が高く出る傾向がある。

スコアが動かないときは description ではなく測定系を疑う。実績のある description で測って発火するかを先に確かめる。

## 出力契約を測る

description ではなくスキルの出力を測るときに使う。

```bash
node plugins/optimize-agents/scripts/run-output-eval.mjs \
  --eval-file <output-evals.json> \
  --run-dir <出力先> --runs 1

node plugins/optimize-agents/scripts/aggregate-benchmark.mjs --run-dir <出力先>
```

`with_skill` と `without_skill` の 2 構成で測り、差を見る。`with_skill` だけでは assertion が緩いのかスキルが効いているのか区別できない。両構成が同じ点数なら、その assertion に識別力はない。

`output-evals.json` の形式:

| キー | 内容 |
| --- | --- |
| `skill_name` | 測定対象スキル名 |
| `skill_root` | サンドボックスへ配置するディレクトリ。この JSON からの相対 |
| `checker` | 採点コマンド。インタプリタを含める |
| `evals[]` | `{id, name, prompt, expected_output, assertions[], fixtures[]}` |

`fixtures` は開始状態に要るファイルを指定する。`{path, content}` か `{path, from}` で書く。

## チェッカーを書く

採点は測定対象スキル側が持つ。`<outDir> <evalId>` を受け取り、stdout に `grading.json` 形式の JSON を出す。

```json
{
  "eval_id": 0,
  "expectations": [{"text": "...", "passed": true, "evidence": "..."}],
  "summary": {"total": 9, "passed": 9, "failed": 0}
}
```

`<outDir>` はスキルが作業したディレクトリのルートである。

新しく書くときは Python を使う。プロジェクトがスクリプト言語を指定していればそれに従う。測定器は言語を知らないので、`checker` に実行コマンドを書けば何語でも動く。
