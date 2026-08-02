# eval セットの汎用性(2026-08-02)

## 何が起きていたか

`evals/{trigger,short,fp}/*.json` の 80 問中 27 問が、このリポジトリ固有の名前に依存していた。

| 種別 | 固有語を含む問 |
| --- | --- |
| trigger | 14/24 |
| short | 4/24 |
| fp | 9/32 |

最も深刻だったのは、`description` と eval クエリに**完全に同一の文字列**が入っていたことである。

| 場所 | 内容 |
| --- | --- |
| `prompt-smith` の description | 「orchestration-discipline.md を評価して」 |
| `evals/short/prompt-smith.json` | 「orchestration-discipline.md を評価して」 |

eval が description を検証しているのではなく、description が eval に答えを書いている状態だった。

## 実測: 固有名を替えると発火しない

文型を変えずファイル名だけを架空のものに替えて測った。

| クエリ | 発火 |
| --- | ---: |
| `deploy-runbook.md を評価して` | 0/3 |
| `coding-standards.md の本文を整えて` | 0/3 |
| `review-checklist.md 見て削れるとこ教えて` | 0/3 |
| `api-conventions.md を評価して評点と指摘を出して` | 0/3 |

文型は description の例示と一字一句同じである。変えたのはファイル名だけ。

### 手がかりが 1 つあれば通る

| クエリ | 発火 |
| --- | ---: |
| `orchestration-discipline.md を評価して`(description に載る名前) | 2/3 |
| `references/deploy-runbook.md を評価して` | 3/3 |
| `AI 向けの指示書 deploy-runbook.md を評価して` | 3/3 |
| `エージェント向けの規律を書いた deploy-runbook.md を評価して` | 0/3 |

パスか対象の明示があれば、description に載る固有名より高く出る。最後の行が示すのは、発火が意味の理解ではなく **description に書かれた語との字面の一致**で決まっていることである。「エージェント向けの規律」は description にない語なので通らない。

## 真因は規律側にあった

eval をこう書かせたのは、このプラグイン自身の規律である。

| 規律 | 欠けていたこと |
| --- | --- |
| `skill-eval` §eval セットの書き方「対象を示すときは具体名かパスで書く」 | 具体名の**出どころ**を指定していない。手元のファイル名を使うのが自然な流れになる |
| `description-guide` §書く内容「ユーザーが実際に使う言い回しで例示する」 | その例示が**特定リポジトリに閉じてはいけない**とは書いていない |

配布されるプラグインの description が開発リポジトリの固有名を含んでも、どの規律も止めなかった。

### 追加した規律

- `skill-eval` §eval セットの書き方: 配布するスキルでは測定対象リポジトリのファイル名を使わない。架空の名前を作り、パスの形と対象の種別で示す。description の例示に固有名が含まれるとき、その例示と同じ文字列をクエリにしない
- `description-guide` §配布するスキルの例示: 例示に開発リポジトリのファイル名・プラグイン名・エージェント名を書かない。置き場所と種別で示す。固有名を書いてよいのは、そのリポジトリでしか使わないスキルに限る

## 汎用化の方針

構造を保ち、名前だけを架空のものに替えた。文型・長さ・具体性の水準を変えると、スコアの変化が何に由来するか切り分けられなくなる。

| 元 | 新 |
| --- | --- |
| `optimize-agents` | `deploy-kit` |
| `task-utility` | `docs-tools` |
| `codiel` | `data-pipeline` |
| `basic-design` | `billing-rules` |
| `gpt-sol` / `gpt-terra` / `gpt-luna` | `test-runner` / `spec-writer` / `release-notes` |
| `chat-recorder` | `log-collector` |
| `orchestration-discipline.md` | `release-discipline.md` |
| `github-issue-common.md` | `api-conventions.md` |
| `agent-definition-spec.md` | `config-spec.md` |
| `description-guide.md` | `coding-standards.md` |
| `catalog.md` | `naming-rules.md` |

残したもの:

- `CLAUDE.md` / `SKILL.md` / `README.md` — どのリポジトリにもある共通名
- `.claude/agents/` / `references/` / `commands/` / `evals/` — 構造を示すディレクトリ名
- `prompt-smith` / `skill-eval` / `agent-creator` / `setup-gpt` — optimize-agents 同梱なので配布先にも存在する

fp の「別スキルが正解」型の問は、正解が同梱スキルのものだけを残した。他プラグインのスキルが正解の問は、配布先で前提が崩れるため架空名へ置換した。

## 汎用化の結果: 影響は 1 セットに局所化した

汎用化した 80 問で現行 description を測り直した(`--runs 2 --workers 6`)。

| スキル | セット | 固有名版 | 汎用版 | 差 |
| --- | --- | ---: | ---: | ---: |
| prompt-smith | trigger | 7/8 | 7/8 | ±0 |
| prompt-smith | short | 7/8 | **4/8** | **-3** |
| prompt-smith | fp | 8/8 | 8/8 | ±0 |
| skill-eval | trigger | 6/8 | 6/8 | ±0 |
| skill-eval | short | 7/8 | 7/8 | ±0 |
| skill-eval | fp | 11/12 | 11/12 | ±0 |
| agent-creator | trigger | 8/8 | 8/8 | ±0 |

**固有名依存 27 問のうち、実際に発火を支えていたのは prompt-smith/short の 3 問だけだった。**

「固有名を含む」と「固有名に依存する」は別である。他の 24 問は、固有名を替えても周囲の語(パス形・対象種別・動作語)で発火していた。

### 例: agent-creator/trigger は固有名 5/8 問でも満点を維持

| クエリ(汎用化後) | 発火を支えている語 |
| --- | --- |
| `test-runner.md の frontmatter に不備がないか検証して` | `frontmatter` `検証` |
| `plugins/docs-tools/agents/ に…エージェント定義を追加して` | `agents/` のパス形 |
| `log-collector.md の tools が広すぎる` | `tools` |

### 落ちた 3 問に共通する形

| クエリ | 手がかり |
| --- | --- |
| `release-discipline.md を評価して` | ファイル名のみ |
| `api-conventions.md の本文を整えて` | ファイル名のみ |
| `config-spec.md 見て削れるとこ教えて` | ファイル名のみ |

`prompt-smith` の description には「ファイル名だけを挙げて評価・整形・削減を頼まれたときも、それが `references/` 配下または上記の指示書なら使う」と書いてある。しかしクエリに `references/` が現れないため、条件節を満たすか判定できない。

**裸のファイル名だけでは、そのファイルが対象範囲にあるか原理的に判定できない。**人間でも同じ判断はできない。description の書き方の問題ではなく、依頼の情報量の限界である。

`skill-eval` と `agent-creator` の short が影響を受けなかったのは、その 8 問が「発火精度を測って」「エージェント作って」のように**動作語**を含むためである。prompt-smith の short だけが、ファイル名しか手がかりを持たない問を 3 つ抱えていた。

## 発火を担うのは対象語か動作語か

「固有名を替えても発火した」からといって「名前という要素が不要」とは限らない。名前を丸ごと消して測った。

| スキル | クエリ | 発火 |
| --- | --- | ---: |
| agent-creator | `エージェント定義の frontmatter に不備がないか検証して` | **3/3** |
| agent-creator | `既存のエージェント定義の tools が広すぎる` | **3/3** |
| agent-creator | `エージェント定義の model を inherit にすべきか` | **3/3** |
| prompt-smith | `references の文書を評価して` | 0/3 |
| prompt-smith | `指示書の本文を整えて` | 2/3 |
| prompt-smith | `規律文書を見て削れるとこ教えて` | 0/3 |

**agent-creator では名前は不要だった。prompt-smith では名前を消しても改善しない。**

差は description の定義の仕方から来る。

| スキル | description の定義 | 発火を担う語 |
| --- | --- | --- |
| agent-creator | 動作で定義(「Agent 定義を作る・検証する」) | `frontmatter` `tools` `model` — Agent 定義固有の語 |
| prompt-smith | 対象の列挙で定義(「対象は CLAUDE.md・SKILL.md・…」) | 対象を示す語。動作語(「評価して」「整えて」)は他スキルと共有 |

prompt-smith が落ちるのは名前の問題ではない。動作語がこのスキル固有でないため、対象が特定されないと発火できない。

### 規律への反映

この観点は §eval セットの書き方 に無かった。agent-creator の eval が堅牢だったのは意図ではなく偶然である。`skill-eval` に §発火を担う語を確かめる を新設した。

- eval を書く前に、発火が対象語と動作語のどちらで決まるかを見る
- クエリは発火を担う語のバリエーションで作る
- 対象語で発火するスキルでは、対象を示す語を落とした問を 1 つ入れる。落ちたときは description を直さず、取れない問として残す

### あわせて見つかった既存の規律違反

| 箇所 | 問題 | 対応 |
| --- | --- | --- |
| `short/prompt-smith[3]`「この指示書、無駄が多いので整えて」 | 指示語を含む。規律違反。実測 0/2 | 「指示書の本文を整えて」へ差し替え。新規律が求める「対象語を落とした問」として位置づけた |
| fp セットの指示語 8 件 | 違反ではない。fp は発火しないことを測るので、対象不明が条件を満たす | 規律に「fp のクエリには指示語を入れてよい」を明記 |

## 汎用化しすぎた 2 問

汎用化の過程で、置き換えるべきでない語まで置き換えた。

### 1. 同梱スキルが生成する名前

| | クエリ | 発火(fp なので 0 が正解) |
| --- | --- | ---: |
| 元 | `gpt-sol と gpt-terra と gpt-luna を .claude/agents/ に生成して` | 0/2 |
| 置換後 | `setup-gpt で test-runner と spec-writer と release-notes を .claude/agents/ に生成して` | **3/6(50%)** |

`gpt-sol` / `gpt-terra` / `gpt-luna` は同梱スキル `setup-gpt` が生成するエージェント名である。**setup-gpt が配布される以上、これらの名前も配布先に存在する。**汎用化の対象ではなかった。

置換によって「setup-gpt が担当する対象」という手がかりが消え、`.claude/agents/ に生成して` という句だけが残った結果、agent-creator が拾うようになった。元に戻した。

規律に例外を明記した: 同梱スキルの名前と、同梱スキルが生成するファイル名は残す。

### 2. リポジトリの履歴に依存する記述

| | クエリ |
| --- | --- |
| 元 | `新しく作った skill-eval スキルの発火精度を、既存 4 スキルが正解の依頼を fp セットに入れて測定してほしい` |
| 修正後 | `新しく作ったスキルの発火精度を、担当が近い既存スキルが正解の依頼を fp セットに入れて測定してほしい` |

「既存 4 スキル」は optimize-agents が 4 スキルだった時点の状態を指す。同梱スキル名の例外には当たらず、リポジトリの履歴に依存していた。

## `--runs 2` では判定が反転する

`--runs 2` の結果から「裸のファイル名では原理的に取れない」と結論したが、誤りだった。`--runs 10` で測り直した。

| クエリ | 発火率 |
| --- | ---: |
| `release-discipline.md を評価して` | 30% |
| `api-conventions.md の本文を整えて` | 0% |
| `config-spec.md 見て削れるとこ教えて` | **50%** |

`should_trigger: true` の合格ラインは 0.5 以上である。50% はちょうど境界で、測るたびに合否が反転する。`--runs 2` では 0/2 と 2/2 が同程度の頻度で出る。

同様に fp で誤発火と見えた 2 問(`新しいスキルを作りたい` / `Claude Code の subagent の仕組みについて説明して`)も、`--runs 6` で 0/6 だった。揺らぎである。

`skill-eval` の §ばらつきを疑う が「1〜2 問の差で直さない」「差が気になるときは `--runs 10` 以上で測り直す」と定めているとおりだった。判定が変わる問を見つけたら、結論を出す前に runs を増やす。

## 測定が壊れたときの見分け方

`--runs 3 --workers 6` で 9 セットを連続実行したところ、次の結果が出た。

| セット | 結果 |
| --- | --- |
| trigger 3 スキル計 | 1/24 |
| short 3 スキル計 | 0/24 |
| fp 3 スキル計 | **32/32** |

正例がほぼ全滅し、fp が全問正解している。fp は発火しないことで合格するため、**スキルが一度も発火しなければ fp だけ満点になる**。この形は description の問題では起こらない。

確認したこと:

- `environment` は正常(base_url / auth_source / model が従前と一致)
- `check-skill-definition` で 3 スキルとも errors 0 / warnings 0
- 同じ description・同じクエリを単発で測ると 2/2 で発火

直前の測定との差は負荷だけだった。`--runs 2` から 3 に上げ、80 問 × 3 = 240 回の `claude -p` を短時間に集中させた。`--runs 2 --workers 4`、セット間 20 秒の間隔で測り直した。

**正例が一様に落ち fp が満点になる形は、測定系の異常を疑う。**個々のクエリや description を見る前に、単発で 1 問を測って発火するかを確かめる。

## 最終スコア(2026-08-02, `--runs 2 --workers 4`)

汎用化と 4 件の修正を経た 80 問での結果。

| スキル | trigger | short | fp | 小計 |
| --- | ---: | ---: | ---: | ---: |
| prompt-smith | 5/8 | 6/8 | 8/8 | 19/24 |
| skill-eval | 6/8 | 7/8 | 11/12 | 24/28 |
| agent-creator | 8/8 | 8/8 | 12/12 | **28/28** |
| **計** | 19/24 | 21/24 | 31/32 | **71/80** |

**agent-creator は名前を外した eval で満点**である。名前を外した 6 問はすべて `frontmatter` `tools` `model` `agents/` といった動作語・構造語だけで発火した。eval を純粋にしてもスコアは落ちない。

## prompt-smith の description に弱点がある(次の作業)

落ちた 5 問を `--runs 10` で測り直した。揺らぎではなく description の実力である。

| クエリ | 発火率 |
| --- | ---: |
| `CLAUDE.md のエージェント運用方針の節に根拠の説明が混ざっている。指示だけ残す形に整えてほしい` | **40%** |
| `指示書の本文を整えて` | 50% |
| `docs-tools の references/api-conventions.md が長くなってきたので、削れる文がないか見てほしい` | 20% |
| `billing-rules の perf-audit の references/naming-rules.md を評価して、評点と指摘リストを出してほしい` | 10% |
| `api-conventions.md の本文を整えて` | 0% |

1 行目が問題の所在を示す。このクエリは prompt-smith にとって理想的な条件を備えている。

- `CLAUDE.md` — description の対象列挙の筆頭
- 「指示だけ残す」 — §削る基準 の核心そのもの

それでも 10 回中 4 回しか発火しない。**prompt-smith の description は、固有名の助けを外すと発火が不安定である。**

汎用化前に 22/24 のような高得点が出ていたのは、eval クエリと description が同じ固有名を共有していたためである。eval の汎用化は、その依存を取り除くと同時に、**description 側の弱点を可視化した**。

### 改稿は別タスクとする

今回のスコープ(skill-creator の取り込みと eval の汎用化)は完了している。description の改稿は次の作業として切り出す。

着手するときは、今回追加した規律を使う。

- §発火を担う語を確かめる — prompt-smith は対象語で発火する。動作語(「評価して」「整えて」)は他スキルと共有するため、対象を特定する語を増やす方向で改稿する
- §見て直す問と、測る問を分ける — 一部の問を取り置き、改稿後にそれで測る

eval が汎用化されたことで、改稿の効果を正しく測れる土台ができた。

## description の例示との一致について

汎用化後も、description の例示と完全一致するクエリが 7 件残る。

```
CLAUDE.md が冗長なので削って
この指示書、無駄が多いので整えて
references の規律文書をレビューして
発火精度を測って / description 直して / 誤発火するので抑えたい
agent 定義を見てほしい
```

いずれも固有名を含まない。配布先でも同じ文字列の依頼が発生するため、これは「description が答えを書いている」のではなく「よくある依頼を description が拾えている」状態である。規律もこの区別を持たせた。
