# skill-creator 移植の根拠

## 移植の経緯

Anthropic 公式 `skill-creator` は、description を測定し、改善し、測り直して最良案を選ぶ閉じたループを持つ。一方、移植元の `run_eval.py` には、このリポジトリで使う際に次の問題があった。

1. 実リポジトリを cwd にするため、プロジェクト内のスキルとの発火競合が測定へ混入する。
2. 元の SKILL.md を使わず、description だけを載せた薄いファイルを測定する。

2026-08-02 の設計書 §6 では、公式コードを流用せず独立実装する方針を採っていた。本移植ではこの判断を明示的に覆した。測定だけの独自実装では description の提案まで含む閉じたループにならず、公式実装を読んで移植する方が挙動を保ちやすいためである。移植したコードとアセットには Apache License 2.0 の条件を適用した。

登録先については、設計初版の診断も覆した。初版では `.claude/commands/` への登録が自然文からの発火を妨げると考えたが、2026-08-09 の対照実験では、条件を揃えた `.claude/skills/` と `.claude/commands/` がともに 10/24 だった。登録先は発火率の判別要因ではなく、実リポジトリを cwd にしていたことが過去の比較を交絡させていた。

移植先で `.claude/skills/` を使う判断は維持した。本番の配置と一致し、`disable-model-invocation` を明示できるためである。ただし、登録先の違い自体は移植理由に含めない。

## `run_eval.py` に加えた 4 修正

| # | 修正 | 根拠 |
| --- | --- | --- |
| 1 | 登録先を `<project>/.claude/commands/<clean>.md` から `<tmp>/.claude/skills/<clean>/SKILL.md` へ変え、`disable-model-invocation` を `false` にする | 本番の配置と一致させ、測定対象が `disable-model-invocation: true` でも発火測定できるようにする。登録先そのものが発火率を変えるという根拠にはしない |
| 2 | 累積 JSON への `clean_name` の部分文字列照合を、`<skill-name>-skill-` の前方一致へ変える | 実行時に末尾側が変形した名前を許容しつつ、`Skill` ツールに判定対象を限定することで偽陽性の経路を狭める |
| 3 | cwd を実リポジトリのルートから run ごとの一時ディレクトリへ変える | プロジェクトスキルとの競争を測定から隔離する |
| 4 | `Skill` と `Read` の両方を発火とみなす判定を、`Skill` だけを発火とみなす判定へ変える | 測定対象を `.claude/skills/` に登録するため、コマンドファイルを `Read` する間接経路を発火として扱う必要がない |

修正 1 では、`disable-model-invocation` が既に存在するときは値を置換し、存在しないときだけ追加する。二重キーは作らない。

## 前方一致の限界

前方一致で許容できるのは、`<skill-name>-skill-` より後ろが変形する場合だけである。プラグインの名前空間のような接頭辞が前に付く変形には効かない。

hash を判定に使わないため、この run 専用インスタンスであることの同一性は判定から失われる。ただし run ごとに一時ディレクトリを分けるので、同じ接頭辞を持つ別インスタンスは同席しない。

前方一致は、移植元より偽陽性側へ緩める変更である。判定対象を `Skill` ツールの `content_block` に限定する修正と組み合わせることで成立しており、前方一致だけを単独で採用する判断ではない。

## サンドボックスで隔離できない範囲

run ごとの一時ディレクトリで隔離できるのは、cwd から祖先を探索して読み込まれるプロジェクトスキルだけである。

| 種別 | 場所 | 隔離 |
| --- | --- | --- |
| プロジェクトスキル | cwd から祖先の `.claude/skills/` | できる |
| ユーザースキル | `~/.claude/skills/` | できない |
| プラグインのスキル | 有効なプラグイン | できない |
| 同梱スキル | Claude Code 本体 | できない |

したがってスコアは description 単独の発火率ではなく、測定環境に常駐するスキル群との競争に勝った率である。`environment` が記録する認証経路とモデルに加え、有効なプラグインやユーザースキルの変化も比較時に考慮する必要がある。

## 測定のばらつき

同一クエリを同条件で 10 回測った実測では、発火回数が 0/10 から 3/10 まで振れた。このため 1〜2 問の差だけで description や実装の良否を判断せず、同じ条件で測り直す規律を SKILL.md に置いた。

## 移植前の `description-guide.md` §直したときの確かめ方

移植前は次の内容を `references/description-guide.md` に置いていた。移植後は eval セット、改善ループ、改善プロンプトの実体と重なるため、同 guide から削除する。

> ## 直したときの確かめ方
>
> description を直したときは、発火を測ってから採否を決める。
>
> - 発火を測る問を 20 問作る。発動してほしい問を 8〜10 問、発動してほしくない問を 8〜10 問にする。
> - 問は、ユーザーが実際に打つ形で書く。ファイルパス・仕事の文脈・列名・会社名・URL・短い背景を混ぜる。
> - 小文字だけの文・略語・タイプミス・口語を混ぜる。長さも揃えない。
> - 判定が明確な問より、判定が割れる問を多く作る。
> - 発動してほしくない問は、語や概念を共有しながら別の対応を要するものにする。明らかに無関係な問は作らない。
> - 1 手で終わる問は作らない。多段の作業や専門的な判断を要する問を作る。
> - 各問を 3 回実行し、発火率で判定する。1 回の結果で決めない。
> - 問を 6 対 4 で分け、6 割で直し、4 割で採否を決める。直しに使った問の成績で採否を決めない。
> - 改稿は 5 回までとする。
> - 改稿しても落ちる問が残るときは、語を足さずに文構造と語の選び方を変える。

## 公式 SKILL.md との対応

| 公式 `SKILL.md` の節 | 移植後の所在 |
| --- | --- |
| 冒頭の全体像(10-30 行) | skill-creator SKILL.md §手順 |
| Communicating with the user(32-41 行) | skill-creator SKILL.md §相手に合わせた言葉選び |
| Capture Intent(47-54 行) | skill-creator SKILL.md §手順 1 |
| Interview and Research(56-60 行) | skill-creator SKILL.md §手順 2 |
| Write the SKILL.md(62-69 行) | skill-creator SKILL.md §手順 5-6、§スキルの構造 frontmatter |
| Anatomy(73-84 行) | skill-creator SKILL.md §スキルの構造 三層のロード |
| Progressive Disclosure(86-99 行) | skill-creator SKILL.md §スキルの構造 三層のロード |
| Domain organization(100-109 行) | skill-creator SKILL.md §スキルの構造 三層のロード |
| Principle of Lack of Surprise(111-113 行) | skill-creator SKILL.md §スキルの構造 安全 |
| Writing Patterns(115-135 行) | skill-creator SKILL.md §スキルの構造 書き方のパターン、`prompt-smith:prompt-smith` |
| Writing Style(137-139 行) | `prompt-smith:prompt-smith` §工程・§書き方の基準 |
| Test Cases(141-161 行) | skill-creator SKILL.md §出力の評価 手順 1 |
| Running and evaluating test cases(163-288 行) | skill-creator SKILL.md §出力の評価 手順 2-6 |
| Improving the skill(292-321 行) | skill-creator SKILL.md §出力の評価 手順 7-8・規律 |
| Advanced: Blind comparison(325-329 行) | 移植しない |
| Description Optimization(333-404 行) | skill-creator SKILL.md §手順 8-12・§eval セット・§改善ループの実行、移植済みスクリプト |
| How skill triggering works(396-400 行) | skill-creator SKILL.md §eval セット 形式 |
| Package and Present(408-416 行) | 移植しない |
| Claude.ai / Cowork(420-455 行) | 移植しない |
| 既存スキルの更新(438-441 行) | skill-creator SKILL.md §スキルの構造 既存スキルを更新するとき |

## 移植しない 3 節

| 節 | 理由 |
| --- | --- |
| Advanced: Blind comparison | 2 版の優劣を独立エージェントに判定させる任意機能であり、人のレビューで足りる |
| Package and Present | `.skill` へ固めて渡す経路であり、プラグインとして配るこのリポジトリの運用では使わない |
| Claude.ai / Cowork | 実行環境ごとの手順の読み替えであり、本スキルは Claude Code を前提とする |

## 対照実験の結果

2026-08-09 に、同一 description と 8 問の同一クエリを各 3 回、条件を揃えた一時ディレクトリで測った。

| 経路 | 合計 | 各問の発火回数 |
| --- | --- | --- |
| `.claude/skills/<name>/SKILL.md` | 10/24 | 2, 0, 2, 3, 0, 0, 3, 0 |
| `.claude/commands/<name>.md` | 10/24 | 3, 0, 2, 2, 0, 0, 3, 0 |

差が出た 2 問では方向が逆で、合計は一致した。登録先を発火率の原因とみなさず、cwd と同席するスキル群を測定条件として扱う判断の根拠とした。
