# skill-creator からの取り込み判断(2026-08-02)

Anthropic 公式 marketplace の `skill-creator` プラグイン(Apache 2.0)を分析し、optimize-agents に取り込む観点を選別した記録。

設計書は `docs/design/2026-08-02-skill-creator-intake-design.md`(リポジトリルート配下)。

## 分類

| 判定 | 件数 | 内訳 |
| --- | --- | --- |
| 採用 | 6 | 静的検査 / description の方針 / eval 先行 / assertion 基準 / train-test 分割 / commands 対象化 |
| 既に充足 | 3 | 非識別 assertion の検出 / with-without 比較 / ばらつきの扱い |
| 不採用 | 5 | 自動最適化ループ / HTML ビューア / パッケージング / ブラインド比較 / 本文執筆スタイル |

## 既に充足していた項目

| skill-creator | optimize-agents の該当箇所 |
| --- | --- |
| `analyzer.md`「両構成で常に pass する assertion は識別力がない」 | skill-eval §出力契約を測る |
| `analyzer.md`「高分散な eval は flaky を疑う」 | skill-eval §ばらつきを疑う |
| with_skill / without_skill の baseline 比較 | `run-output-eval.ts` に実装済み |

skill-eval の「連続測定では先に走った方が高く出る傾向がある」は skill-creator 側にない知見である。

## 不採用の理由

| 項目 | 理由 |
| --- | --- |
| description 自動最適化ループ(`improve_description.py` + `run_loop.py`) | 生成プロンプトが `references/description-guide.md` と正面衝突する。skill-creator は「100-200 words に抑える」「個別クエリの列挙を避ける」と指示するが、当リポジトリの基準は「長さを理由に削らない」「例示は一致のためにある」。取り込むには生成プロンプト全体の書き直しが要り、実質は新規実装。加えて 5 反復 × 20 問 × 3 runs = 300 回の `claude -p` 実行がコスト規律と衝突する |
| HTML eval ビューア(1325 行) | `benchmark.md` の平均 ± 標準偏差表で足りている。TypeScript 移植コストが効用に見合わない |
| `package_skill.py`(`.skill` zip 化) | 配布は marketplace 経由。zip アーカイブを配る経路がない |
| ブラインド比較(`comparator.md` + `analyzer.md` 前半) | 主観評価が要る場面向けの器。当プラグインの測定対象(発火率・出力契約)はどちらも客観指標が取れる |
| 本文の執筆スタイル | ユーザー判断により現行 `prompt-smith` を優先(下記) |

### 本文執筆論の対立

| 論点 | skill-creator | prompt-smith(採用) |
| --- | --- | --- |
| 根拠の記述 | why を必ず説明する | 根拠は削り、指示だけを残す |
| 強い禁止形 | ALWAYS / NEVER は黄信号。理由の説明に置き換える | 望ましい動きの言い切りで書く |
| 冗長さ | 500 行以下が理想だが必要なら超えてよい | 冗長度を評点化して削る |

prompt-smith は根拠を `docs/` へ退避する仕組みを持つ。skill-creator は分離先を持たないため 1 ファイルに同居させる。前提条件の差から来た対立であり、どちらかが誤っているわけではない。

## SKILL.md frontmatter 仕様の分岐

分析の過程で、SKILL.md の frontmatter 仕様がサーフェスごとに異なることが判明した。

| | Claude API / claude.ai | Claude Code |
| --- | --- | --- |
| 出典 | platform.claude.com `agent-skills/overview` | code.claude.com `skills` |
| `name` | 必須。64 字以内、小文字英数字ハイフン、予約語 `anthropic`/`claude` 不可 | 任意。表示名。省略時はディレクトリ名 |
| `description` | 必須。1024 字以内 | 推奨。省略時は本文の第 1 段落 |
| 長さの上限 | `description` 単体で 1024 字 | `description` + `when_to_use` の合算で 1536 字 |
| 許容キー | 6 種 | 17 種 |

skill-creator の `quick_validate.py` は前者を検査する。`package_skill.py` による zip 化 → claude.ai アップロードとセットで設計されているため。

このリポジトリは Claude Code プラグインの Marketplace であり claude.ai へのアップロード経路を持たないため、`check-skill-definition` は後者のみを検査する。

判明の経緯: `skills/claude-model-policy/` が予約語 `claude` を含みながら正常動作していたことから、API 仕様の予約語制限が Claude Code に適用されないことが分かった。

### `name` とディレクトリ名の不一致は仕様

プラグインスキルでは frontmatter `name` がコマンド名の最終セグメントを決める。ディレクトリ名と `name` の不一致は不正ではない。

ただし `skills/setup-gpt/` は 0.12.0 で `name: setup` → `setup-gpt` に揃えた。仕様上は許されるが、README・他スキルの description・外部文書の 4 箇所で `setup` と `setup-gpt` の表記が混在し、どちらが正かを追えなくなっていたため。仕様として許されることと、参照する側が迷わないことは別である。

### commands は skills と同一仕様

公式は「Custom commands have been merged into skills」「Files in `.claude/commands/` still work and support the same frontmatter」と明記している。差はコマンド名の由来(skill はディレクトリ名または `name`、command はファイル名)と、付随ファイルを持てるかどうかだけである。

## 実測: 別種の対象を指す例示は正例の発火を落とす(2026-08-02)

commands を対象範囲へ加える改稿(F)で、`prompt-smith` の description に次の 2 つを同時に足した。

1. 対象列挙への追記(「コマンド定義(commands/ 配下の .md)」)
2. 依頼文の例示 3 種(「このコマンドの本文を直して」「commands/review.md が長いので削って」「スラッシュコマンドの中身を整えて」)

結果、`evals/trigger/prompt-smith.json` の発火が落ちた。

| 構成 | 結果 |
| --- | --- |
| 改稿前 | 3/3 |
| 改稿前の description + 改稿後の本文 | 3/3 |
| 改稿後の description(例示 3 種を含む) | 1/3 |
| 対象列挙のみ追記(例示なし) | 8/8 |

本文の改稿は発火に影響しなかった。原因は description に足した別ドメインの例示である。

`description-guide.md` は「例示は 2 つ目以降も残す。一致のためにある」と定めていたが、これが成り立つのは**同じ対象を指す言い換え**の場合である。対象そのものを広げる例示は逆に働く。この区別を §対象を広げるとき として同ガイドに追記した。

## 実測: description の圧縮・一般化は正例だけを落とす(2026-08-02)

skill-creator の description 生成プロンプトが持つ基準を当リポジトリの eval で測った。

**A 案**(現行の `description-guide.md` に従う): 個別の依頼文を例示する。長さを理由に削らない。
**B 案**(skill-creator 流): 個別クエリの列挙を避けカテゴリへ一般化。100-200 words 相当へ圧縮。三人称・命令形。実装でなく意図に焦点。

対象は optimize-agents 自身の 3 スキル、`evals/{trigger,short,fp}` の 80 問。`--runs 2 --workers 6`。

| 種別 | A 案 | B 案 | 差 |
| --- | ---: | ---: | ---: |
| trigger(文脈のある依頼) | 21/24 | 17/24 | -4 |
| short(一言の依頼) | 22/24 | 14/24 | **-8** |
| fp(誤発火) | 30/32 | 30/32 | **±0** |
| **計** | **73/80** | **61/80** | **-12** |

### 観測

- **fp は 32 問すべてで発火回数まで完全一致**した。圧縮は誤発火の抑制に一切寄与しない。
- 落ち込みは short で最大。落ちた 6 問はすべて `0/2`(完全不発火)で、揺らぎではない。
- 落ちたクエリは「orchestration-discipline.md を評価して」「agent-definition-spec.md 見て削れるとこ教えて」など、**A 案の description にほぼそのまま書かれていた例示**である。
- B 案は 3 スキルとも依頼例を 0 個にした(A 案は 11 / 9 / 8 個)。字数ではなく例示の削除が要因である。

### 判断

現行の `description-guide.md` の方針を維持する。skill-creator の一般化は取り込まない。

skill-creator が「個別クエリを列挙するな」と指示する理由は、そのプロンプト本文に明記されている。

> 1. Avoid overfitting
> 2. The list might get loooong and it's injected into ALL queries and there might be a lot of skills, so we don't want to blow too much space on any given description.

どちらも発火精度の主張ではない。①の overfitting は `skill-eval` の §見て直す問と、測る問を分ける で別途扱う。

②のコンテキスト圧迫は実在する。description は発火の有無にかかわらず常時ロードされる(progressive disclosure の Level 1)。2026-08-02 時点の実測は次のとおり。

| 対象 | トークン |
| --- | ---: |
| Skills 全体(63 スキル) | 5.8k |
| 1 スキルあたりの平均 | 約 92 |
| `prompt-smith`(770 字) | 約 260 |
| `skill-eval`(450 字) | 約 150 |
| `agent-creator`(448 字) | 約 160 |

B 案を採ると 3 スキル計で約 170 トークン減る。**この 170 トークンと発火 -12/80 が釣り合わないため A 案を採る。**上限 1536 字に対する余裕とは別の指標である。上限は切り詰めの閾値であり、常時消費するトークン量を示さない。

skill-creator の懸念文は "there might be **a lot of skills**" と書いており、1 スキルあたりの長さではなくスキル総数にスケールする。63 スキルで 5.8k(1M context の 0.6%)だが、200 スキルなら 18.4k、200k context 環境では 9% に達する。**総数が大きく増えるか context が小さい環境では結論が変わりうる。**

**両者は排他ではなく、適用条件が違っていた。**

### 取り込んだ項目(衝突しない部分)

| 項目 | 反映先 |
| --- | --- |
| 三人称で書く | `description-guide.md` §書く内容 |
| 実装でなくユーザーの意図に焦点を置く | 同上 |
| 隣接スキルと並べて 1 読で選べる語にする | 同上 |
| 改稿が失敗し続けるときは文構造・語の選び方を変える | 同上 §直したときの確かめ方 |

## 方針転換: description を skill-creator へ委譲(2026-08-08)

ユーザー判断により、SKILL.md・コマンド定義の description の担当を `skill-creator` へ移した。上記「実測: description の圧縮・一般化は正例だけを落とす」で不採用としたB 案の基準が、`skill-creator` を使う経路では有効になる。

### 何が変わったか

| 対象 | 2026-08-02 まで | 2026-08-08 以降 |
| --- | --- | --- |
| SKILL.md / コマンド定義の description | `description-guide.md`(A 案) | `skill-creator` を invoke。使えない環境でのみ `description-guide.md` |
| SKILL.md / コマンド定義の本文 | `prompt-smith` | `prompt-smith`(変更なし。`skill-creator` の対象外) |
| Agents 定義 / output style / メモリの description | `description-guide.md` | `description-guide.md`(変更なし) |

`prompt-smith/SKILL.md` に §description の担当 を新設し、`skill-creator` の可否で分岐させた。委ねる範囲は frontmatter の description のみで、本文は渡さない。eval ループ中に本文へ及ぶ提案が出たときは、その提案だけを外す。

### `description-guide.md` の改稿

`skill-creator` の基準へ全面的に寄せた。

| 項目 | 改稿前 | 改稿後 |
| --- | --- | --- |
| 長さ | `description` + `when_to_use` 1536 字。「長さを理由に削らない」 | `description` 1024 字。100〜200 words 相当 |
| 例示 | 個別の依頼文を列挙。「例示は 2 つ目以降も残す」 | 個別依頼文を列挙せず意図のまとまりで書く |
| 語法 | 記述なし | 「〜するスキルである」でなく「〜のときに使う」 |
| 検証 | 記述なし | trigger eval 20 問(正例 8-10 / 負例 8-10)、3 回実行、6:4 分割、5 反復まで |

削除した節は §削らない と §対象を広げるとき。どちらも例示の保持・追加を制御する規律であり、「個別クエリを列挙しない」と正面衝突するため。

### 上記の実測記録との関係

「実測: description の圧縮・一般化は正例だけを落とす」の結論(A 案 73/80 / B 案 61/80、short で -8)は取り消さない。測定自体は有効である。両者が両立する理由は次のとおり。

- 当時の B 案は**実測なしに圧縮した description** を測った。`skill-creator` 経由の B 案は trigger eval で発火率を測りながら 5 反復するため、圧縮によって落ちた問はループ内で検出され、description が修正される。実測の有無が両者の差である。
- ただし `skill-creator` を使えない環境では、実測なしに B 案基準だけが当たる。この場合は 2026-08-02 の実測どおり発火が落ちる可能性がある。**ユーザー判断によりこれを許容する**(2026-08-08)。
- 「不採用の理由」表の「description 自動最適化ループ」の行は、当リポジトリへの**移植**を不採用としたものである。`skill-creator` を外部プラグインとしてそのまま invoke する経路は別であり、この行は取り消さない。

### 残る不整合

`description-guide.md` は `skill-creator` 不在時のフォールバックになったが、そこに書かれた基準は 2026-08-02 の実測で劣位が確認された B 案である。フォールバック経路の精度を戻すには、次のいずれかが要る。

- フォールバック時のみ A 案(個別依頼文の列挙・長さ無制限)を当てる分岐を `description-guide.md` へ戻す
- `evals/trigger` を `skill-creator` 不在環境で回し、B 案基準で書いた description の実測値を取り直す

どちらも未着手。

## 採用した項目の反映先

| # | 項目 | 反映先 |
| --- | --- | --- |
| A | skill / command の静的検査 | `scripts/check-skill-definition.mjs` |
| B | description の方針 | `references/description-guide.md`(三人称・意図焦点・distinctive・1536 字上限) |
| C | eval 先行 | skill-eval §新しいスキルを作るとき |
| D | assertion の質の基準 | skill-eval §assertion の書き方 |
| E | train/test 分割 | skill-eval §見て直す問と、測る問を分ける(規律のみ。自動分割は未実装) |
| F | commands の対象化 | prompt-smith / skill-eval / description-guide |

E で自動分割を実装しなかったのは、1 スキルあたりの eval が 8〜12 問しかなく、40% holdout では test が 3〜5 問になり「1〜2 問の差で直さない」規律と両立しないため。eval セットを拡充してから再検討する。
