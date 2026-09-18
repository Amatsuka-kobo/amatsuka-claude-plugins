# 設計書: prompt-smith 発火測定・description 改善ループの改修

- 作成日: 2026-09-17(**第 7 版・最終: 2026-09-18。確定した実装計画書(WBS)と突き合わせて整合させた。** 第 6 版で長さ規律の単位を UTF-8 バイト数へ、第 5 版で対象を metatron へ拡大、第 4 版で隔離方式を CLI フラグへ差し替え、第 3 版で基準 6 を採用、第 2 版でレビュー 14 点を反映)
- 対応する実装計画書: `harness-docs/plans/` の WBS。**実行手順の正本は計画書にある**(§16.1)
- 対象プラグイン: `plugins/prompt-smith`(現行 `0.3.5-dev` → `0.4.0-dev`)
- context-map: `.claude/context-maps/2026-09-17-prompt-smith-improvement.md`
- 要件の出発点: `plugins/prompt-smith/docs/improvement-backlog.md`
- 先行設計: `harness-docs/design/2026-08-09-prompt-smith-skill-creator-port-design.md`(移植の設計) / `harness-docs/design/2026-08-02-skill-creator-intake-design.md`(仕様の分岐)

---

## 1. 背景と目的

2026-09-17 に metatron の 3 スキルを `skill-creator` で監査した際、測定スクリプトに 8 件の欠陥と方針未決が見つかった。本設計書はその 8 項目すべてを対象に、実装方式・ファイル分割・型・テスト方針・移行手順を定める。

欠陥の中心は 2 つある。

**1. 測定が測定対象以外に汚染される。** `callClaudeText`(`src/lib/claude-cli.ts` L48-87)の `spawn`(L57)には `cwd` の指定がない。プロジェクトルートから `run-loop.mjs` を起動すると、そのプロジェクトの hooks・CLAUDE.md・有効なプラグインが子プロセスに効く。改善案生成が `<new_description>` を返さず `improve_failed (iteration 1)` で停止した実害が出ている。さらに子プロセス側の hook が実際にファイルを書き、読み取り専用のつもりの測定が `docs/chat/` に 4 件の記録を作った。**測定がリポジトリを書き換える欠陥である。**

**2. 長さの規律が実測と逆を向いている。** `skills/skill-creator/SKILL.md` L135 は「発火精度より 100〜200 words 相当の範囲を優先する」と書く。実測では 188〜223 字(日本語)の description が 20/20 で、302〜460 字の現行が 13〜15/20 だった。改善プロンプト(`buildImprovePrompt` L159)の「100-200 words」は英語 words 基準であり、日本語 description に対しては上限として機能していない。生成された 15 案はすべて 400 字超で、すべて不採用に終わった。

### 1.1 ユーザー確定事項(設計で覆さない)

| 事項 | 決定 |
| --- | --- |
| 対象 | バックログ 8 項目すべて |
| 実施順 | 1〜5(測定基盤)→ 6・7(ループ改善)→ 8(SKILL.md) |
| 隔離の範囲 | 測定経路も改善案生成経路も、リポジトリ外の一時 cwd + CLI フラグで隔離する。**`CLAUDE_CONFIG_DIR` は変更しない。認証情報を一切複製しない。** HOME も変えない |
| `--bare` | **使わない。** model-invoked skill を切るため測定対象が消える |
| `--model` の既定 | 3 エントリともエイリアス `sonnet`。`run-loop` と `improve-description` の必須チェックを外す |
| holdout の採否 | **`selectBest` の条件式を変更しない。** eval セットの質で解く |
| eval の問数 | 20 問から増やさない |
| 長さの規律 | 長さではなく発火率で立てる。測れないときの目安は **600 バイト前後(UTF-8)**。日本語なら約 200 字、英語なら約 100 words に相当する |
| 長さの単位 | **UTF-8 のバイト数。** 文字数にすると規律が日本語専用になり、`skill-creator` が作るスキルの言語を縛る |
| 項目 8 の適用先 | **6 スキル。** `prompt-smith` の 3 つ(`prompt-smith` / `skill-creator` / `agent-creator`)と、**`metatron` の 3 つ**(`capturing-architecture` / `updating-architecture` / `recording-gotchas`) |
| prompt-smith 3 スキルの主な起動経路 | **3 スキルとも「ユーザーが明示して依頼する」経路が主**(新基準 1 を実施した結果) |
| metatron 3 スキルの主な起動経路 | `capturing-architecture` は明示依頼が主。`updating-architecture` と `recording-gotchas` は**提案への回答も主な経路**(バックログ §8 の記録) |
| 短縮優位の再検証 | 隔離環境・`sonnet` で 2 種類の比較を行う。**metatron は短縮前を git から復元して現行と比べ**、長い 2 スキル(`prompt-smith` / `agent-creator`)は現行と短縮案を比べる |
| バージョン | マイナーを上げる(`0.3.5-dev` → `0.4.0-dev`) |

### 1.2 バックログの記述のうち失効したもの

バックログ §1 の対処案は「`--bare` を付ける。skills は切らないため発火測定にも使える」と書く。**この前提は実測で否定された。** CLI 2.1.274 で `--bare` を付けると model-invoked の `Skill` tool use が 0 回になる。`--help` の「Skills still resolve via `/skill-name`」はスラッシュによる明示起動だけが残る意味だった。`--bare` を `runSingleQuery` に入れると測定対象そのものが消える。

バックログ §1 のこの 1 行は、本改修に合わせて失効させる。バックログは改修時の入力であり、改修後の正本ではない。

### 1.3 実測 1: 新方式の成立と遮断範囲(CLI 2.1.274)

採用する構成は、`CLAUDE_CONFIG_DIR` にも認証機構にも触れず、**リポジトリ外の一時 cwd と CLI フラグだけで隔離する**(§3.2)。

#### OAuth 環境での成立(認証コピー 0 件)

`ANTHROPIC_BASE_URL` と `ANTHROPIC_AUTH_TOKEN` を外した OAuth 環境で、`--setting-sources project` + `--strict-mcp-config` + `--settings '{"disableAllHooks":true}'` を付けて実行した。

| 観測 | 結果 |
| --- | --- |
| 終了コード | **0(2 回とも成功)** |
| 認証ファイルのコピー | **0 件** |
| cwd のプロジェクトスキル | **3 条件すべてで model-invoked 発火を維持** |
| `init.skills` の件数 | 対照 25 件 → 隔離 17 件(**8 件減**)。`~/.claude/skills/` の `SKILL.md` も 8 件で数が一致(**一対一の出所同定は未完**) |
| `--model sonnet` | 使える。解決先は `claude-sonnet-5` |
| `project` と `project,local` | 同一結果 |

#### 4 種の遮断(第 1 回検証、陽性対照付き)

第 1 回の検証は、模擬ホームに識別用のスキル・hooks・プラグイン・`CLAUDE.md` を置いた対照実験である。`--setting-sources project,local` について次が記録されている。

- ユーザースキルが消える
- ユーザー指示(`CLAUDE.md`)が消える
- hooks が消える
- プラグインスキルが消える
- **cwd の probe は発火する**

**`--setting-sources` は読み込み元を絞るフラグであり、認証方式で挙動が変わる理由がない。** 第 1 回(環境変数認証・陽性対照あり)と OAuth 検証(認証の確認)を合わせて成立と判断した。

### 1.4 実測 2: 実ホームへの書き込み・並列・後始末

新方式は実ホームを読み書き可能なまま使う。**そこで何が起きるかを、書き込み可能な条件で測った。**

| 観測 | 結果 |
| --- | --- |
| 単発実行 | exit 0。`~/.claude.json` は +105 bytes / +4 行。JSON パース成功 |
| **10 並列 × 2 バッチ(計 20 プロセス)** | **20/20 が exit 0。** バッチ内の `~/.claude.json` の変化はバッチ 1 が **+1 byte**、バッチ 2 が **0 byte**。全スナップショットで JSON パース成功 |
| 破損・残骸 | `.claude.json.tmp.*` や破損ファイルの残骸は**皆無** |
| リポジトリ | `git status --porcelain=v1` の前後出力が**完全一致**。hooks が切れるため、バックログ §1 が報告した `docs/chat/` への書き込みは起きない |

**並列度 10 を下げる根拠は出なかった。** `--num-workers` の既定 10 を変えない。

#### 副次的な発見

| 発見 | 内容 | 扱い |
| --- | --- | --- |
| CLI 自身のバックアップ機構 | **CLI は書き込み前に `~/.claude/backups/.claude.json.backup.<epoch-ms>` を作る。** 検証中の 13 分で 5 件蓄積し、ローテーションや削除の兆候は確認できなかった | 60 spawn の eval を繰り返すと増え続ける可能性がある。運用注意として §3.6 に置く |
| `--no-session-persistence` | 有無でメタデータ上の有意差は検出できなかった | 害もないため維持する |
| **他プロセスによる書き込み** | テストプロセスが 1 つも動いていない約 15 秒の空白で、`~/.claude.json` が **-2588 bytes / -88 行 縮小した**。タイムスタンプ上、10 並列 spawn の影響ではない。同じ `$HOME` を使う他の稼働中プロセスや常駐デーモンによる書き込みである | **良性のプルーニングかロストアップデートかは、中身を読まない制約により判別できていない。** §3.6 と §16 に残す |

#### 方式差し替えをまたいで有効な観測

次の 2 つは第 1 回検証(旧方式・`--model haiku`)で得たが、プロセスの意味論に関する事実であり、方式の差し替えに影響されない。

| 論点 | 観測 | 設計への反映 |
| --- | --- | --- |
| kill 直後の削除 | `kill()` の返却と終了は同一時点ではない(kill 直後の `/proc/<pid>/stat` が `R` だった) | **後始末は `close` を待ってから行う。** 固定 sleep で代用しない |
| stdin の扱い | 測定側の `stdio: ["ignore", "pipe", "ignore"]` でハングは起きない | 現行の指定を維持する |

#### この実測の限定

- **60 spawn のフル eval は未検証である**(コスト抑制のため 20 spawn まで)。
- `--setting-sources` が全環境・全 CLI バージョンで同じ挙動をするかは未検証である。
- `init.skills` の 8 件減は件数の一致までで、**一対一の出所同定は行っていない。**

### 1.5 隔離は公式の測定思想から外れない

公式 `skill-creator` の `run_eval.py` を読んだ結果、**公式は「他スキルとの競争に勝ったか」を測る設計になっていない**ことが実装から確定した。

| 観点 | 内容 |
| --- | --- |
| 測定対象 | 公式は本番の SKILL.md を測らない。description だけを載せた薄い command ファイルを `{project_root}/.claude/commands/{skill_name}-skill-{uuid8}.md` へ書き、**その UUID 付き decoy が呼ばれたかだけを検出する**。本番スキルや他スキルが選ばれると検出は外れ、正例は欠測になる。**競争が起きると測定が壊れる構造である** |
| 目的の記述 | 「Tests whether a skill's description causes Claude to trigger (read the skill) for a set of queries」「a description that triggers for relevant queries, and doesn't trigger for irrelevant ones」。競争への言及は無い |
| 実プロジェクトで動く理由 | `find_project_root()` が cwd から祖先を辿るため。コメントは「Claude Code がプロジェクトルートを見つける方法を真似る」とだけ書く。**設計ではなく実装の都合である** |
| 後発の公式機構 | `claude plugin eval`(2.1.269 以降)は隔離を明示する。「Each run gets a throwaway home directory, working directory, and Claude Code configuration … other installed plugins, memory, and skills are absent」 |
| コミュニティ | 実プロジェクト実行を欠陥として報告し、一時プロジェクトへ隔離する修正 PR が 2 本ある(`anthropics/skills` #1298 / #1755。どちらも未マージで、公式メンテナの応答は確認できていない) |

したがって項目 1 は、**公式の思想から外れる改変ではなく、公式が後発機構で明示した方向へ近づける修正である。**

ただし**到達点は同じではない。** `claude plugin eval` は throwaway な home / working directory / configuration の 3 つを捨てる。採用する構成が捨てるのは working directory と**設定の読み込み元**であり、home と configuration は実体をそのまま使う(§3.6)。**「other installed plugins, memory, and skills are absent」という状態は満たすが、その作り方が違う。** 公式は環境を捨てることで、こちらはフラグで読み込みを止めることで同じ状態に達する。ホームへの書き込みが残るのはこの差による(§3.5.1)。

この確認は 2 つの記述の位置づけを変える。

- §13 の再検証は「競争条件を変えた別物を測る」のではなく、**公式の意図に沿った条件で最適値を取り直す**ことにあたる。
- 移植設計が残した「競争に勝った率」という定義は公式由来ではなく、cwd だけを隔離した時点の残差に付けた操作的定義だった(§10.8)。

---

## 2. 全体像

| # | 項目 | 成果物 | 種別 |
| --- | --- | --- | --- |
| 1 | 子プロセスの隔離 | `src/lib/sandbox.ts` + `src/lib/claude-cli.ts` + `src/lib/stream-parse.ts` + `src/run-trigger-eval.ts` + テスト | 挙動変更 |
| 2 | `run-loop` に `environment` を記録 | `src/run-loop.ts` + `src/lib/types.ts` | 出力追加 |
| 3 | `--model` の扱いを揃える | 3 エントリ + `src/lib/types.ts` | 契約変更 |
| 4 | `--model` の既定を `sonnet` に | `src/lib/defaults.ts`(新設) | 契約変更 |
| 5 | `--help` | `src/lib/cli-help.ts`(新設) + 3 エントリの `main` | 機能追加 |
| 6 | 打ち切りと採否の整合 | `src/run-loop.ts` `runLoop` | 挙動変更 |
| 7a | 長さの予算と改善プロンプト | `src/improve-description.ts` + `src/lib/defaults.ts` | 挙動変更 |
| 7b | 長さの規律 | `skills/skill-creator/SKILL.md` L133-136 | 規律改稿 |
| 8a | eval セットの作成基準 | `skills/skill-creator/SKILL.md` + `assets/eval-review.html` | 規律追加 |
| 8b | 既存 eval **6 本**への適用 | `plugins/prompt-smith/evals/*.json` + `plugins/metatron/evals/*.json` | データ差し替え |

**項目 7 を 7a / 7b に分ける。** 7a(予算という仕組み)は測定結果によらず成立するが、7b(600 バイト前後という規律)は §13 の再検証の結果に依存する。同じ段に置くと、測定で方向が反転したときに撤回範囲が切り分けられない。

### 2.1 実行順序と依存

| 段 | 作業 | 依存 |
| --- | --- | --- |
| 1 | 項目 1(隔離)+ 起動失敗の集計分離 + **`SKILL.md` L219-225 の測定の規律** + **バージョン繰り上げ** | なし。**最初に置く** |
| 2 | 項目 2・3・4・5(結果記録と CLI の揃え) | 段 1 |
| 3 | 項目 6・7a(打ち切り条件・長さの予算) | 段 2 |
| 4 | 項目 8a・8b(基準の追加と既存 eval **6 本**の差し替え) | **コードと文書の作成は段 1〜3 と並行可。測定を伴う確認は段 1 の完了後**(下記) |
| 5 | 測定(§13。ベースライン 360 + 比較 A 360 + 比較 B 240 + 衝突観測 最大 180 = **最大 1140 回** / 17 本) | 段 1〜4 の**すべて** |
| 6 | 項目 7b(長さの規律)と残りの追随 | 段 5 |

**`SKILL.md` L223 の書き換えを段 6 から段 1 へ移した。** あれは「有効なプラグインやユーザースキルが変わった後の値を比べない」という条文であり、**項目 1 の追随そのものである。** 段 6 に置くと、段 1 で隔離済みの測定器を出荷してから段 6 まで、**隔離された測定器に対して隔離前提の比較規律が残る。** L131-139(長さの規律 = 項目 7b)だけが段 6 に残る。

**バージョン繰り上げを段 1 へ移した。** 規約は改修時に `plugin.json` と `package.json` を揃えて上げることを求める。段 6 にまとめると、**中間のコミットが `0.3.5-dev` のまま隔離済みの CLI を持つ。** 段 1 で `0.4.0-dev` へ上げ、段 2 以降は同一マイナー内の継続作業として据え置く。`plugins/metatron` は段 4 で `0.3.5-dev` → `0.3.6-dev` へ上げる(§11)。

**段 4 の「並行可」の範囲を限定する。** 区別するのは「書いてよい」と「測ってよい」である。

| 段 4 の作業 | 段 1 の完了前にやってよいか |
| --- | --- |
| `SKILL.md` の基準追加、`eval-review.html` の表示追加 | **よい** |
| eval セットの問を書き、差し替える | **よい**(ファイル編集のみ) |
| 差し替えた問を実際に測って確かめる | **だめ** |

**隔離前に新しい eval を回すと、バックログ §1 の副作用が再発する。** 測定用の `claude -p` が Stop hook を発火させ、`docs/chat/` に記録ファイルが作られる。段 4 の成果を測るのは段 5 である。

**段 4 と段 6 は同じ `SKILL.md` を触る。** 段 4 が L55 / L141-162 / L160 / L185、段 6 が L131-139。段 1 が L219-225。**3 つの段が 1 ファイルに入るので、後の段は前の段の結果を取り込んでから編集する。** 行番号は段を経るごとにずれる。

**段 1 を最初に置く理由**は、項目 1 が直らないと改善ループ自体が `improve_failed` で停止し、項目 6・7 の効果を一度も観測できないためである。加えて、直す前に測定を回すとリポジトリが書き換わる。

**測定を段 5 にまとめ、段 2 の直後に置かない。** 初版では段 2 の直後にベースラインを置いたが、段 4 で eval セットの問を差し替えると、その前に取ったベースラインは即座に無効になる。測定値を非連続にする要因は次の 4 つあり、**すべてを通過してから 1 度だけ測る。**

| 非連続の要因 | 段 |
| --- | --- |
| 隔離により常駐スキル(ユーザースキル・プラグイン)が競争相手から消える | 1 |
| **`readResultError` により、完走してエラー終了した実行が母数から外れる**(§3.4) | 1 |
| 既定モデルが `sonnet` になる | 2 |
| 長さの予算が改善案の生成に効く | 3 |
| eval セットの true 問が差し替わる | 4 |

**段 5 より前に取ったすべての測定値を破棄する。**

### 2.2 本文の執筆基準

`skills/skill-creator/SKILL.md` と `assets/eval-review.html` の改稿(項目 7b・8a)は `prompt-smith:prompt-smith` を使用し、その規律に従う(規約「AI 向けの指示書」)。本設計書が挙げる根拠・実測値・出典は本文へ持ち込まない。設計書と `plugins/prompt-smith/docs/` に置く。

---

## 3. 項目 1: 子プロセスの隔離

### 3.1 現状の非対称

| 経路 | 関数 | cwd | 設定の読み込み元 | タイムアウト時の後始末 |
| --- | --- | --- | --- | --- |
| 測定 | `runSingleQuery`(`run-trigger-eval.ts` L37-119) | `sandbox.dir`(L66)で隔離済み | **絞っていない**(user / project / local を全部読む) | kill 後に `close` を待つ(L83-88)。cleanup は待機後の `finally`(L116-117) |
| 改善案生成 | `callClaudeText`(`claude-cli.ts` L48-87) | **指定なし**(L57) | **絞っていない** | **kill して即 reject(L60-63)。`close` を待たない** |

`buildEnv`(L24-33)が落とすのは `CLAUDECODE` 1 つだけである。cwd を変えても、ユーザー設定・ユーザースキル・ユーザー hooks・有効なプラグイン・MCP サーバは効いたままになる。

**`callClaudeText` には cwd と読み込み元の両方が要る。** 読み込み元を絞っても cwd を変えなければプロジェクト側の設定(プロジェクト hooks・プロジェクトスキル・プロジェクト `CLAUDE.md`)が残るため、隔離が半端になる。逆に cwd だけを変えても、ユーザー層とプラグイン層が残る。**2 つは互いの穴を塞ぐ関係にあり、片方では足りない。**

**後始末の非対称も直す。** 改善案生成にも一時ディレクトリが付く以上、`close` を待たずに reject すると、まだ生きているプロセスの足元でディレクトリを消すことになる(§1.4 の実測: kill の返却と終了は同一時点ではない)。

### 3.2 採用する方式

構成は次のとおりである。

```
env -u CLAUDECODE \
  claude -p "$QUERY" --model sonnet \
    --setting-sources project \
    --strict-mcp-config \
    --settings '{"disableAllHooks":true}' \
    --no-session-persistence \
    --output-format stream-json --verbose
  # cwd = リポジトリ外の一時ディレクトリ
```

| # | 手段 | 何を断つか |
| --- | --- | --- |
| 1 | cwd をリポジトリ外の一時ディレクトリにする | プロジェクトスキル・プロジェクト hooks・プロジェクト `CLAUDE.md`。測定経路ではそこに対象スキルだけを置き、改善案生成経路では空のまま使う |
| 2 | `--setting-sources project` | **ユーザー設定層。** ユーザースキル・ユーザー hooks・ユーザー `CLAUDE.md`・プラグインスキルが消える(§1.3) |
| 3 | `--strict-mcp-config` | `--mcp-config` 以外の MCP サーバ |
| 4 | `--settings '{"disableAllHooks":true}'` | 残る経路の hooks。読み込み元を絞ったうえで、hooks を明示的に止める二重化 |
| 5 | `--no-session-persistence` | セッションのディスク保存。CLI の help は「only works with `--print`」と書き、両経路とも `-p` を使うので条件を満たす |
| 6 | `CLAUDECODE` を環境から除去する | 親が Claude Code であることの継承(既存の `buildEnv` のまま) |

**`CLAUDE_CONFIG_DIR` は変更しない。認証情報を一切複製しない。HOME も変えない。** これがこの方式の要点である(§3.5 に旧案との比較を置く)。

**ただし「認証機構にまったく触れない」とは言えない。** `--setting-sources project` は user ソースを切るため、`~/.claude/settings.json` に置かれた認証ヘルパ(`apiKeyHelper` / `awsAuthRefresh` / settings の `env`)を使っている環境では**認証が通らない**。設定と認証は独立していない(§3.6)。

`--setting-sources` の値は **`project` とする。** `project,local` との差は今回の cwd では出ず(§1.3)、`settings.local.json` を使わない測定で読み込み元を広げる理由がない。

`--settings '{"disableAllHooks":true}'` を `--setting-sources project` と併用する理由は、両者が別の層に効くためである。`--settings` は置換ではなく**追加**であり単独では隔離にならないが(§3.5)、`disableAllHooks` は hooks を明示的に止めるので、読み込み元を絞ったあとの取りこぼしに対する二重化として働く。

後始末は、子プロセスの `close` を待ってから一時 cwd を `finally` で削除する。**削除対象は cwd だけである。**

**並列度は下げない。** §1.4 の実測で 10 並列 × 2 バッチが 20/20 で完走し、`~/.claude.json` の破損も残骸も出なかった。`--num-workers` の既定 10 を変えない。

### 3.3 モジュール構成と型

#### `src/lib/sandbox.ts`

**`Sandbox`(L22-25)も `createSandbox`(L132-146)のシグネチャも変えない。** 一時ディレクトリを 1 つ作るだけの下層関数を足し、`createSandbox` をその上へ載せ替える。

```ts
// 既存。変更しない
export interface Sandbox {
  dir: string
  cleanup(): Promise<void>
}

export async function createIsolatedWorkspace(): Promise<Sandbox>   // 新規。SKILL.md を書かない
export async function createSandbox(skillMd: string, cleanName: string): Promise<Sandbox>
```

- `createIsolatedWorkspace` は `mkdtemp(join(tmpdir(), "prompt-smith-cwd-"))` を作って返す。**`callClaudeText` が使う。**
- `createSandbox` は `createIsolatedWorkspace` の結果へ `.claude/skills/<cleanName>/SKILL.md` を書き足すだけにする。

**第 3 版にあった `Workspace` 型(`dir` + `configDir` + `cleanup`)は要らなくなった。** 設定ディレクトリを作らないため、既存の `Sandbox` と形が同じになる。型を 1 つ増やさない。

#### `src/lib/claude-cli.ts`

純関数を切り出す。**プロセスを起こさずに固定できる範囲を、ここで最大化する。**

```ts
export const ISOLATION_ARGS = [
  "--setting-sources", "project",
  "--strict-mcp-config",
  "--settings", '{"disableAllHooks":true}',
  "--no-session-persistence"
] as const

export function buildEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv   // 既存。変更しない
export function buildSpawnOptions(cwd: string, env?: NodeJS.ProcessEnv): { cwd: string; env: NodeJS.ProcessEnv }
export function buildEvalArgs(query: string, model: string | undefined): string[]
export function buildTextArgs(model: string | undefined): string[]
export function killThenSettle(child: ChildProcess, settle: () => void): void
```

- **`buildIsolatedEnv` は作らない。** 環境変数に足すものが無くなったので、`env` は `buildEnv()` のままでよい。
- `buildSpawnOptions` は `Sandbox` ではなく **cwd の文字列**を取る。env が sandbox に依存しなくなったためで、`claude-cli.ts` から `sandbox.ts` への型の依存も消える。
- **隔離の主役が引数配列へ移った。** `buildEvalArgs` / `buildTextArgs` が組み立てる argv に `ISOLATION_ARGS` が入る。したがって**隔離が効いているかを固定するテストの主戦場は `buildEvalArgs` / `buildTextArgs`** であり、`buildSpawnOptions` は cwd を固定するだけになる。第 3 版と役割が入れ替わっている。
- `--settings` の値は JSON 文字列を argv の 1 要素として渡す。`spawn` はシェルを経由しないので、引用符の追加は要らない。
- `killThenSettle` は既存 `runSingleQuery` の `finish`(L83-88)と同じ判定を持つ。まだ終了していなければ `once("close")` を登録してから SIGKILL し、既に終了していれば即座に `settle` する。**両経路がこの 1 関数を通ることで、後始末の対称性を規約ではなく構造で担保する。**

#### `src/lib/stream-parse.ts`

**L-7 の欠陥を塞ぐために 1 関数だけ足す**(§3.4)。

```ts
/** result イベントが失敗を報告しているなら、その内容を返す。そうでなければ null。 */
export function readResultError(line: string): string | null
```

- `type === "result"` かつ `is_error === true` のときだけ文字列を返す。
- **`subtype` を判定に使わない。** 認証失敗時も `subtype` は `"success"` になる(§3.4)。
- `TriggerDetector.push` の戻り値・コードには手を触れない。

**ただし「意味論を変えない」とは言えない。母数の定義が変わる**(§3.4 の末尾)。

`callClaudeText` は次の形にする。

```ts
export type SpawnFn = typeof import("node:child_process").spawn

export interface ClaudeTextDeps {
  spawn?: SpawnFn
  createWorkspace?: () => Promise<Sandbox>
}

export async function callClaudeText(
  prompt: string,
  model: string | undefined,
  timeoutSeconds = 300,
  deps?: ClaudeTextDeps
): Promise<string>
```

- 先頭で `createWorkspace()` を呼び、`try { … } finally { await workspace.cleanup() }` で包む。
- `spawn("claude", buildTextArgs(model), buildSpawnOptions(workspace.dir))`。
- **`stdio` を指定しない。** 既定の `pipe` を使う。プロンプトを stdin へ書く経路(L84-85)があるため、測定側の `["ignore", "pipe", "ignore"]` をここへ写すと動かなくなる。
- タイムアウト時は `killThenSettle(child, () => reject(timeoutError))` にする。**`close` を待ってから reject し、`finally` の cleanup が待機の内側に入るようにする。**
- `spawn` 自体が失敗した(`error` イベント)ときは `close` が来ないので即座に reject する。プロセスが起きていないため後始末の競合も起きない。
- `deps` は省略時に本番実装へ落ちる。既存の `improveDescription({ callClaude })` の DI と同じ流儀で、`vi.mock` は使わない(既存 11 本のテストに `vi.mock` は 1 つも無い)。

#### `src/run-trigger-eval.ts`

`runSingleQuery`(L37-119)を位置引数 6 個からオプションオブジェクトへ変え、`export` する。呼び出し元は `runEval`(L128-144)の 1 箇所だけである。

```ts
export interface RunSingleQueryOptions {
  query: string
  skillName: string
  skillContent: string
  description: string
  timeout: number
  model: string | undefined
  spawn?: SpawnFn
  createSandbox?: (skillMd: string, cleanName: string) => Promise<Sandbox>
}

export type QueryOutcome =
  | { status: "triggered" }
  | { status: "not_triggered" }
  | { status: "error"; message: string }

export async function runSingleQuery(options: RunSingleQueryOptions): Promise<QueryOutcome>
```

- `spawn` に渡す第 3 引数は `{ ...buildSpawnOptions(sandbox.dir), stdio: ["ignore", "pipe", "ignore"] }` とする。`stdio` の現行指定は維持する(§1.4)。
- 引数配列は `buildEvalArgs(query, model)` が返す。`-p` / `--output-format stream-json` / `--verbose` / `--include-partial-messages` / `--model` の並びは変えず、末尾に `ISOLATION_ARGS` を足す。
- ストリームの各行は、**`readResultError` を先に通してから** `detector.push` へ渡す(§3.4)。
- `finish` を `killThenSettle` の呼び出しへ置き換える。**cleanup を `finally` に置く現行の位置(L116-117)を動かさない。** 待機の外へ出すと §1.4 の実測が示した競合が起きる。
- `RunEvalOptions` に DI の口を足さない。ループ側の型を汚さないためで、テストは `runSingleQuery` を直接呼ぶ。

### 3.4 起動失敗を「不発火」として集計しない仕組み

現状、`child.on("error")`(L109-112)も非ゼロ終了も `finish(false)` に落ち、`runEval` の `catch`(L138-143)も `false` を返す。**認証失敗や起動失敗が「発火しなかった」として点数に入る。** 隔離を入れると認証経路が変わるため、この取り違えは今回いちばん起きやすい誤診になる。

判定を 3 値にする。

| 事象 | 現行 | 改修後 | 根拠 |
| --- | --- | --- | --- |
| `Skill` が観測された | `true` | `triggered` | — |
| ストリームを読み切って `Skill` が無く、`result` が `is_error: false` | `false` | `not_triggered` | — |
| **`result` イベントが `is_error: true`** | **`false`**(`stream-parse.ts` L52-54) | `error` | **下記。今回いちばん重い経路である** |
| `spawn` が失敗した(`child.on("error")` L109-112) | `false` | `error` | 起動失敗 |
| 終了コードが非ゼロのまま判定が確定していない | `false` | `error` | 保険。下記のとおり、単独ではまず届かない |
| **`runEval` の `catch`(L138-143)に落ちる例外** | `false` | `error` | sandbox 作成失敗・予期しない throw が「不発火」のまま残るのを塞ぐ |
| タイムアウト | `false` | `not_triggered`(**変えない**) | さらに下記 |

#### `subtype: success` の罠

OAuth 検証で判明した事実である。**認証に失敗したとき、終了コードは 1、`is_error` は true だったが、結果イベントの `subtype` は `success` だった。**

`subtype` だけで成否を判定すると、認証失敗が「スキルが発火しなかった」として点数に混ざる。**これは項目 1 が潰そうとしている欠陥(基盤の失敗を測定対象の欠陥として記録する)と同じ形である。**

判定は **終了コードと `is_error` に基づかせる。`subtype` を使わない。**

**現行実装はさらに手前で取りこぼしている。** `stream-parse.ts` L52-54 は次のとおりで、`result` イベントを無条件に「発火しなかった」と確定させる。

```ts
if (event.type === "result") {
  return false
}
```

`is_error` を見ていない。そして**この確定は `close` より先に起きる**ため、`finish` の `settled` ガードにより、後続の非ゼロ終了コードは再分類されない。**つまり「終了コードが非ゼロなら `error` にする」だけでは、認証失敗をひとつも捕まえられない。** ストリーム側で先に捕まえる必要がある。

対処は §3.3 の `readResultError` である。`runSingleQuery` は各行をまず `readResultError` へ通し、`null` でなければ `error` として確定させる。`null` のときだけ `detector.push` へ渡す。これにより `TriggerDetector` の判定ロジックには一切触れずに済む。

終了コードによる判定は保険として残す。`readResultError` が拾えなかった異常終了(`result` イベント自体が出ない場合)を受ける。

#### `readResultError` は母数の定義を変える

「分類を足しただけで意味論は変わらない」と書くのは正しくない。**変わるのは、完走したがエラー終了した実行の扱いである。**

`Skill` を使わないまま `is_error: true` の `result` が来るセッションがある(max tokens、途中の API エラー、permission 否認の後始末など)。

| | 現行 | 改修後 |
| --- | --- | --- |
| 分類 | `not_triggered` | `error` |
| `runs` | **入る**(0 発火として数えられる) | **入らない** |

つまり `should_trigger: true` の欠測が減り、**見かけの発火率が上がる。** 正常系(`is_error !== true` の `result`、または `Skill` が先に観測されて確定した場合)は変わらない。

**この母数変更は隔離と同時にベースラインへ入る**(§13.1)。段 5 より前の値と比べられない理由が 1 つ増える。

**タイムアウトを `error` にしない理由を書き直す。** 初版は「合否の校正と過去値の意味が変わる」を理由にしたが、同じ設計書が §2.1 で過去値を破棄すると決めており、理由として成り立たない。正しい理由は次である。

- **遅いモデル・重いクエリによる超過と、起動失敗とを混ぜないため。** タイムアウトは「起動には成功し、時間内に判定が付かなかった」であり、`error`(そもそも測れていない)とは性質が違う。両者を同じ袋に入れると、`--timeout` を伸ばせば直る事象と、認証を直さないと直らない事象が区別できなくなる。
- 新方式は設定ディレクトリを新規に作らないため、**初回起動のゲートでハングする経路そのものが無い。** タイムアウトが起動失敗の代理になる懸念は薄い。起動の失敗は `readResultError` と終了コードが受ける。
- タイムアウトの扱いは SKILL.md L224 の既存の規律(全問 0 なら `--timeout` を疑う)が引き続き担う。

型の追加は次の 2 つに限る。

```ts
export interface EvalResultItem extends EvalItem {
  trigger_rate: number
  triggers: number
  runs: number      // 完了した実行の回数。error は含めない
  errors: number    // 追加: 起動に失敗した実行の回数
  pass: boolean
}

export interface EvalResult {
  skill_name: string
  description: string
  environment: Environment
  results: EvalResultItem[]
  summary: EvalSummary
  errors: number    // 追加: 起動に失敗した実行の総数
}
```

**`EvalSummary` は変えない。** `run-loop.ts` L303-309 が `improveDescription` へ渡すために `EvalSummary` の literal を組み立てており、`buildImprovePrompt` の入力契約(`EvalScores`)でもある。ここを触ると改善経路の型と fixture が連鎖して壊れるわりに、得るものがない。エラーの総数は `EvalResult` の直下に置けば足りる。

#### 3 値化がそのまま持ち込む集計バグ

現行 `runEval` は `outcomes[index] ? 1 : 0` で数える(L128-149)。**`QueryOutcome` は 3 値ともオブジェクトなので、すべて truthy である。** この行を残したまま戻り値だけ 3 値にすると、**`not_triggered` も `error` も発火として数えられ、全問 100% 発火になる。**

**型はこのバグを止めない。** `boolean[]` を `QueryOutcome[]` に変えても truthy 判定は型エラーにならない。**純関数へ切り出してもテストで止まらない。** 純関数のテストが固定するのは関数の中身であって、それを呼ぶ配線ではない。

配線を 2 段で固定する。

| 段 | 手段 | 何を止めるか |
| --- | --- | --- |
| 1 | `EvalResult.errors` を**必須**にし、`aggregateOutcomes` が `{ results, errors }` を返す形にする | 旧コードは `errors` を供給できないので**コンパイルが通らない**。ただし `errors: 0` と手で書けば通ってしまうので、これだけでは足りない |
| 2 | **`runEval` に結合テストを 1 本足す**(下記) | 配線そのものを固定する。truthy バグが入れば落ちる |

結合テストのために、`runSingleQuery` を差し替えられるようにする。**`RunEvalOptions` には足さない。**

```ts
export async function runEval(
  options: RunEvalOptions,
  deps?: { runSingleQuery?: typeof runSingleQuery }
): Promise<EvalResult>
```

第 2 引数にすることで、`runLoop` が組み立てて渡す `RunEvalOptions`(および `RunLoopOptions`)には一切現れない。§12.1 が避けたかったのは「ループ側から見える型がテストのために広がること」であり、この形はそれに当たらない。

テストは 2 問 × 3 実行を与える。1 問は `triggered` と `not_triggered` を混ぜ、もう 1 問は全実行を `error` にする。**truthy バグがあると `not_triggered` が発火として数えられ、`triggers` の期待値が合わずに落ちる。**

集計と停止判断を**純関数へ切り出す**(§3.8 の理由による)。

```ts
export function aggregateOutcomes(
  evalSet: EvalItem[],
  jobs: EvalItem[],
  outcomes: QueryOutcome[],
  triggerThreshold: number
): { results: EvalResultItem[]; errors: number }

export class MeasurementFailedError extends Error {}
export function assertMeasurable(results: EvalResultItem[]): void
```

- `assertMeasurable` は **1 問でも `runs === 0`(その問の全実行が `error`)のとき `MeasurementFailedError` を投げる。** 0 点の結果 JSON を返さない。
- 部分的な失敗(3 回中 1 回が `error`)は投げず、`errors` に残して続ける。移植元が「1 件の失敗で eval 全体を落とさない」(L125-127 のコメント)方針であり、これを全面的には覆さない。
- `runEval` は `pool` → `aggregateOutcomes` → `assertMeasurable` → 組み立て、の 4 手に分かれる。`errors > 0` のときは stderr に警告を 1 行書く。

`runLoop` 側は `runEval` の呼び出し(L215-226)を `try`/`catch` で包み、`exit_reason` を `measurement_failed (iteration N): <message>` にして打ち切る。ただし `history` が空(= 反復 1 で失敗)のときは再 throw する。`selectBest`(L79-86)は `reduce` に初期値を持たないため、空配列を渡すと TypeError になる。既存の `improve_failed` 経路(L320-329)も、記録を push した後にしか起こらないので、同じ形に揃う。

### 3.5 不採用の手段

いずれも実測にもとづく。

| 手段 | 判定 | 理由 |
| --- | --- | --- |
| `--bare` | 不可 | **実測。** model-invoked skill を切る。測定対象が消える |
| `--safe-mode` / `--setting-sources ''` | 不可 | 同上 |
| `--restricted` | 不可 | **実測していない。** 却下の根拠は help の文面である。下記 |
| `--plugin-dir <空ディレクトリ>` | 不可 | 既存プラグインは無効にならない |
| `--settings '{}'` | 不可 | 置換ではなく**追加**であり、単独では隔離にならない |
| HOME 自体の差し替え | 採らない | 認証・PATH・シェル設定まで巻き込む。cwd とフラグで足りる |
| **空の `CLAUDE_CONFIG_DIR`**(第 2・3 版の採用案) | **取り下げ** | §3.5.1 |
| `stdio` を `/dev/null` や即閉じ `pipe` にする | 採らない | 実測で優位性が無く、現行の `["ignore", "pipe", "ignore"]` を変える根拠が無い(§1.4) |

**`--restricted` の却下理由を、`--bare` と同じ束から外す。** CLI 2.1.274 の help は `--restricted` が skills を切るとは書いていない。書いてあるのは「Bash 等のコード実行ツールを外し、user / project / local の settings ファイルを無視する。managed と `--settings` は残る」である。**第 3 版までの「model-invoked が消える」という却下理由は、この文面と一致しない。**

却下の根拠を 2 つに置き換える。

| # | 根拠 | 確度 |
| --- | --- | --- |
| 1 | **project の settings を無視する。** 測定対象はサンドボックスに置いたプロジェクトスキルであり、それが読まれなければ測定そのものが成立しない | help の文面から確実 |
| 2 | Bash 等のコード実行ツールを外すとモデルのツール選択が変わる。`TriggerDetector` は最初の非 Skill ツールで打ち切るため、ツール構成の変化が発火判定に干渉しうる | 推論。未実測 |

根拠 1 だけで却下として十分である。**実測していないことを明記し、「skills が消える」という誤った理由を残さない。**

**単独では不十分だが、組み合わせて採用した手段が 2 つある。**

| 手段 | 単独での限界 | 採用した理由 |
| --- | --- | --- |
| `--setting-sources project` | ホーム内の状態ファイル(`.claude.json`)への書き込みを隔離しない | **ユーザー層(スキル・hooks・`CLAUDE.md`・プラグイン)を断つ主力である**(§1.3)。書き込みの隔離は手放す(§3.6) |
| `--settings '{"disableAllHooks":true}'` | hooks は止まるが、ユーザースキルとプラグインは残る | 読み込み元を絞ったあとの hooks の取りこぼしに対する二重化 |

### 3.5.1 空の `CLAUDE_CONFIG_DIR` を取り下げた理由

**この方式は実測で成立していた。** 「試していない案」ではなく、**成立を確認したうえで採らなかった案**である。

| 空 config 方式で確認できたこと |
| --- |
| ユーザースキル・ユーザー hooks・有効プラグイン・ユーザー `CLAUDE.md` がいずれも無効化される |
| cwd 側のプロジェクトスキルは model-invoked 発火を維持する |
| 環境変数認証(`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`)の環境では、認証ファイルを複製せずに成立する |

取り下げの理由は、**この方式を環境変数認証以外へ広げると認証情報の複製が要る**ことにある。空の config には認証情報が無いため、OAuth 環境では `.credentials.json` の複製が避けられない。複製を伴う実装には次のリスクがある。

| リスク | 内容 |
| --- | --- |
| **トークンのリフレッシュ** | コピー側で更新されると元へ反映されず、逆も起きる。OAuth プロバイダはリフレッシュトークンの再利用を検知して失効させる設計が一般的であり、測定は 60 プロセスを 10 並列で走らせるため、**同じリフレッシュトークンのコピーが多数同時に使われうる。** 空 config の検証は一時 config を読み取り専用でマウントしていたため、**この経路を一度も通っていない** |
| **コピーの残存** | SIGKILL やクラッシュで `finally` が走らないと、`/tmp` に認証情報が残る |
| **配布物としての性質** | 利用者の認証情報を読んでコピーするコードをプラグインが持つこと自体が、利用者に信頼を要求する |

**新方式は認証機構に一切触れないため、これらがすべて消える。**

**手放したものも書いておく。** 空 config 方式でしか得られなかったのは、**ホームへの書き込みの完全な隔離**である。新方式では `~/.claude.json` と `~/.claude/projects/` が更新される(§3.6)。この 1 点と引き換えに、認証情報の複製を避ける判断をした。書き込みの副作用は測定に固有のものではなく、Claude Code を使えば日常的に起きることであり、実測でも破損・残骸は出なかった(§1.4)。**認証情報の複製リスクの方が重いと判断した。**

### 3.6 隔離できない範囲(残存リスク)

**この方式は「対象スキル以外が存在しない環境」を作らない。ホームへの書き込みも隔離しない。** 次は隔離の外にある。

| 層 | 状態 | 扱い |
| --- | --- | --- |
| **実ホームへの書き込み** | **隔離しない。** `~/.claude.json` と `~/.claude/projects/` が更新される | 測定に固有の副作用ではなく、Claude Code を使えば日常的に起きる。実測で破損も残骸も出ていない(§1.4)。**隔離の範囲外であることを明記して受ける**(§3.5.1 で手放した点) |
| **同じホームを使う他プロセスの書き込み** | **隔離できない。** 実測で、テストプロセスが 1 つも動いていない 15 秒の空白に `~/.claude.json` が -2588 bytes 縮小した | 運用注意として扱う。**測定中に他の重い並行セッションを走らせない。** 良性のプルーニングかロストアップデートかは判別できていない(§16) |
| **`~/.claude/backups/` の蓄積** | CLI 自身が書き込み前にバックアップを作る。13 分で 5 件、ローテーションの兆候なし | CLI 自体の挙動であり、こちらから止められない。**60 spawn の eval を繰り返すと増え続ける可能性がある。** 定期的な確認を運用注意として書く |
| 組織管理設定(`/etc/claude-code/managed-settings.json`、managed skills) | **未検証。** `--setting-sources` が取るのは user / project / local であり、管理設定は別層である | `docs/` に残す。管理設定のある環境で測った値を他環境の値と比べない |
| CLI 組み込みスキル(17 件) | 隔離後も残る(`init.skills` が 17 件) | 競争相手として常駐する前提で測る。基準 6 の 2 問目はここを狙う(§9.4.5) |
| 環境変数 | `CLAUDECODE` 以外は継承される | 隔離しない。`ANTHROPIC_*` が設定されている環境ではそれが使われる |
| CLI 版・組み込みスキル・モデル alias | 変化しうる | 現時点の実測は CLI 2.1.274、`sonnet` の解決先は `claude-sonnet-5` |

#### 認証は「触れない」ではなく「経路による」

第 3 版は認証を隔離できない範囲の表に置き、第 4 版の初稿は逆に「触れないので影響を受けない」と書いた。**どちらも不正確である。**

`--setting-sources project` は user ソースを切る。`~/.claude/settings.json` に置かれた認証ヘルパはそこで読まれなくなる。**設定と認証は独立していない。** `--bare` の help が「`apiKeyHelper` は `--settings` 経由でのみ読む」と書くこと自体が、その証拠である。公式 Agent SDK は `project` を cwd の `./.claude/`、`user` を `~/.claude/` と定義している。

| 認証経路 | 成否 | 根拠 |
| --- | --- | --- |
| 環境変数(`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`) | **成立** | 実測(第 1 回検証) |
| OAuth | **成立** | 実測(§1.3。終了コード 0、認証コピー 0 件) |
| `apiKeyHelper` / `awsAuthRefresh` / settings の `env` | **通らない** | user ソースを切るため読まれない |
| Bedrock / Vertex | AWS / GCP 側の機構を使うので原則影響しないが、**`awsAuthRefresh` を併用している場合は影響を受けうる** | 未検証。推論である |
| OS keychain / Foundry | 未検証 | — |

**実測 2 経路の成立は、settings に依存する認証へ一般化できない。** 第 4 版初稿の「影響を受ける理由が無い」という一般化は取り下げる。

**実害は「測定できない」であって「誤った値が出る」ではない。** `MeasurementFailedError`(§3.4)が全問 `error` を検出して止めるため、0 点として記録されることはない。

**利用者への案内は `MeasurementFailedError` のメッセージに載せる。** 「設定ファイルに依存する認証(`apiKeyHelper` / `awsAuthRefresh` / settings の `env`)を使っている場合は、環境変数による認証へ切り替える」を含める。README にも 1 行書く。`--help` には載せない。`--help` はオプションと既定値の一覧であり、環境要件を置く場所ではない(§6.1)。利用者が実際にぶつかるのはエラーの時点である。

### 3.7 `TMPDIR` がリポジトリ配下にある環境

一時ディレクトリは「祖先に `.claude` を持たない場所」に作る必要がある(移植設計 §4.1)。プロジェクトスキルの探索が cwd から上へ辿るためで、この前提が崩れると隔離の中で測定対象以外のスキルが復活する。

**新方式ではこの検出がより重要になる。** `--setting-sources project` は project 層を**意図して生かしている**(サンドボックスのスキルを読ませるため)。cwd の隔離はフラグで代替できない。

**ただし、`project` がどこを指すかは確定できていない。** 公式 Agent SDK は `project` を **cwd の `./.claude/`** と定義する(git root ではない)。一方、移植設計 §4.1 は「スキル探索が cwd から祖先を辿る」と書いており、**フラグの project ソースとスキル探索の walk-up は別機構の可能性がある。** 2 つの場合分けが立つ。

| 仮定 | `TMPDIR` がリポジトリ配下のとき何が起きるか |
| --- | --- |
| A: `project` = cwd の `./.claude/` | project ソースはサンドボックス自身になる。リポジトリのスキルが project 層として読まれるわけではない。**混入が起きるとすれば walk-up 側である** |
| B: `project` = git root の `.claude/` | **測定対象(cwd 配下)が project として見えず、リポジトリのスキルだけが project になる。** 測定が成立しない |

**どちらでもガードは正しい。** A なら walk-up による混入を、B なら測定対象の消失を防ぐ。**仮定を確定させなくても、「`TMPDIR` がリポジトリ配下なら拒否する」という安全側の形は両方をカバーする。** 確定は §16 未解決へ回す。

`sandbox.test.ts` L184-199 はこの前提をテスト時に確かめているが、**実行時には誰も確かめていない。** `TMPDIR` がリポジトリ配下に設定されている環境では、前提が黙って崩れる。

**検出する。** `createIsolatedWorkspace` が作ったディレクトリの**親**から祖先を辿り、`.claude` が見つかったら次の内容で throw する。

- 見つかった `.claude` の絶対パス
- `TMPDIR` を `.claude` を持たない場所へ変える、という対処

実装上の条件を 3 つ課す。**どれを外しても、本番が動かなくなるか、既存テストが無効になる。**

| # | 条件 | 外すとどうなるか |
| --- | --- | --- |
| 1 | **走査の起点を、作った一時ディレクトリの「親」にする。自分自身を含めない** | 測定は自分の `.claude/skills/<name>/SKILL.md` を書く。self を含めると**測定用の `.claude` 自身で throw し、本番の 60 spawn が 1 つも動かない**。既存 `sandbox.test.ts` L189 も `join(sandbox.dir, "..")` から walk しており、同じ起点である |
| 2 | 比較は `realpath` で行う | `TMPDIR` がシンボリックリンクのとき、祖先を正しく辿れない |
| 3 | **キャッシュのキーを `realpath(tmpdir())` にする。「このプロセスは安全」という boolean にしない** | `vitest.config.ts` の `pool: "forks"` はファイル単位であり、`sandbox.test.ts` は同一プロセスで `createSandbox` を L167 と L185 の 2 回呼ぶ。**boolean キャッシュだと、先の成功が後段の「`TMPDIR` を偽装して throw」を無効化する。** キーを tmpdir の realpath にすれば、偽装で別キーになり検査が走る |

条件 1 と条件 3 は、走査を `.claude` の作成前に行っても解けない。作成前でも `createSandbox` は同じプロセスで何度も呼ばれるので、キャッシュの粒度の問題は残る。**キーを tmpdir にする方が、粒度としても意味としても正しい**(判定対象は「この tmpdir が安全か」であって「このプロセスが安全か」ではない)。

判定を毎回辿らない理由は変わらない。`createSandbox` は 1 反復で 60 回走る。

**黙って前提として書くだけにしない。** 隔離の成立条件が壊れたときに測定値が出てしまうと、値が正しく見えるぶん誤診が重い。

### 3.8 テスト

`.claude/rules/metatron/testing-policy.md` に従い、対象ソースと同じ `src/__test__/` に置く。

| ファイル | 追加する検証 |
| --- | --- |
| `src/__test__/claude-cli.test.ts`(既存を拡張) | **`buildEvalArgs` / `buildTextArgs` が `ISOLATION_ARGS` の 5 要素を正しい順序と組で含む**(`--setting-sources` の値が `project`、`--settings` の値が `{"disableAllHooks":true}`、`--strict-mcp-config` と `--no-session-persistence` が付く)。`--model` の位置を変えない。**`buildEnv` の結果に `CLAUDE_CONFIG_DIR` を足さない。** `buildSpawnOptions` が `cwd` に渡された文字列を返す。`killThenSettle` が未終了なら `close` を待ち、終了済みなら即座に settle する。`callClaudeText` が `stdio` を指定しない(stdin が書ける)。タイムアウト時に `close` を待ってから reject する。正常時・reject 時のどちらでも `cleanup` が 1 回だけ呼ばれる |
| `src/__test__/sandbox.test.ts`(既存を拡張) | `createIsolatedWorkspace` が一時ディレクトリを 1 つ作り、`SKILL.md` を書かない。`cleanup` で消える。祖先に `.claude` があるとき throw する(`TMPDIR` を偽装して確かめる)。既存 L184-199 は変えない |
| `src/__test__/stream-parse.test.ts`(既存を拡張) | **`readResultError` が `is_error: true` の `result` で文字列を返し、`is_error: false` では `null` を返す。`subtype` の値に依存しない**(`subtype: "success"` かつ `is_error: true` で文字列を返すことを明示的に固定する)。`TriggerDetector.push` の既存ケースは変えない |
| `src/__test__/run-trigger-eval.test.ts`(**新規**) | `runSingleQuery` が `spawn` へ渡す第 2 引数に `ISOLATION_ARGS` が入り、第 3 引数の `cwd` と `stdio` が期待どおり。**`is_error: true` の `result` 行が `{ status: "error" }` になる**(`subtype: "success"` でも)。`error` イベントと非ゼロ終了も `error` に、`is_error: false` の完走が `not_triggered` に、タイムアウトが `not_triggered` になる。例外が出ても `sandbox.cleanup` が呼ばれ、それが `close` の後である。`aggregateOutcomes` が `error` を `runs` に数えず `errors` に数える。`assertMeasurable` が「1 問の全実行が error」で throw し、部分失敗では throw しない |
| `src/__test__/helpers/fake-child-process.ts`(**新規**) | `spawn` の戻り値を模す最小の EventEmitter。`stdout` / `stderr` / `stdin`(`write` / `end`)、`kill`、`exitCode`、`signalCode` を持つ。`kill` を呼んでも自動では `close` を出さず、テストが明示的に発火させる(待機の有無を区別するため)。`callClaudeText` と `runSingleQuery` の両テストから使う |

**隔離が効いているかを固定する主戦場が移った。** 第 3 版では `buildSpawnOptions` が返す `env.CLAUDE_CONFIG_DIR` が主役だったが、新方式では隔離の実体が argv にある。**`buildEvalArgs` / `buildTextArgs` の出力を固定するテストが、隔離の回帰を防ぐ唯一の自動的な砦になる。**

**集計を純関数へ切り出す理由がここにある。** `runEval` は `runSingleQuery` を直接呼び、DI を転送しない(L128-144)。`RunEvalOptions` に DI を足さない方針・`vi.mock` を使わない方針・実 `spawn` を使わない方針の 3 つが揃うと、`runEval` 経由では `MeasurementFailedError` と部分失敗の 2 つを固定できない。`aggregateOutcomes` と `assertMeasurable` を分けることで、合成した `QueryOutcome[]` を直接渡して両方を固定できる。

`claude` の実起動はテストしない(移植設計 §10 の方針を維持する)。

### 3.9 隔離が効いていることの確認手順

自動テストは `spawn` の引数を固定するだけで、CLI が実際に設定を読まないことは示さない。**リポジトリを書き換える欠陥だったため、修正後は実機で確認する。**

前提: **リポジトリルートを cwd にして実行する。** 一時ディレクトリから起動すると、直っていなくても症状が出ない(バックログ末尾の回避策がまさにこれである)。

| # | 手順 | 合格条件 |
| --- | --- | --- |
| 1 | 実行前に `git status --porcelain=v1` を控え、`~/.claude.json` のコピーを取る | — |
| 2 | **フラグの到達確認。** 隔離フラグを付けた `claude -p` と付けない `claude -p` を直接叩き、`--output-format stream-json --verbose` の `init` イベントの `skills` の件数を比べる | **件数が減る。** 減らなければフラグが効いていない。減った差分が `~/.claude/skills/` の `SKILL.md` の件数と一致することも見る(§1.3 では 25 → 17 で 8 件差) |
| 3 | 改善案生成の再現確認。`improve-description.mjs` が呼ぶのと同じ経路で、`<probe>OK</probe> とだけ返せ` という趣旨のプロンプトを**リポジトリルートを cwd にして**通す | `<probe>OK</probe>` が返る。バックログ §1 が観測した「SessionStart hook の通知への応答」が返らない |
| 4 | 陽性対照。曖昧さのない description を持つ probe スキルを対象に `run-trigger-eval.mjs --runs-per-query 1` を 3 問で回す | すべて発火する。発火しないなら隔離が行き過ぎている |
| 5 | 実行後に `git status --porcelain=v1` を取り直す | **実行前と完全一致する。** `docs/chat/` に新規ファイルが無い |
| 6 | `~/.claude.json` を見る | **JSON としてパースできる。** `.claude.json.tmp.*` や破損ファイルの残骸が無い。**内容が変わっていること自体は正常である**(§3.6) |
| 7 | 出力 JSON を見る | `errors` が 0(起動が成功している)。`environment` の 3 キーが測定環境の認証経路とモデルを記録している |

**手順 5 が新方式の中心的な合格条件である。** hooks が切れるため、バックログ §1 が報告した `docs/chat/` への書き込みは起きない。実測でも `git status --porcelain=v1` の前後出力は完全一致した(§1.4)。

**`~/.claude.json` の不変は合格条件にしない。** 第 3 版では mtime の不変を `CLAUDE_CONFIG_DIR` が効いた証拠に使っていたが、新方式は実ホームを使うので変化するのが正常である。代わりに**壊れていないこと**を見る。

手順 2 が落ちた場合は、フラグの綴りと値、`--settings` の JSON がシェルを経由せず 1 要素として渡っているかを疑う。手順 4 が落ちた場合は、疑う順を「`--setting-sources` の値(`project` になっているか)→ cwd が一時ディレクトリか → CLI 版」とする。手順 7 の `errors` が 0 でないときは §3.4 の分類を見て、認証失敗と発火失敗を取り違えていないかを確かめる。

---

## 4. 項目 2: `run-loop` の結果に `environment` を記録する

`run-trigger-eval` は `describeEnvironment()` の結果を `EvalResult.environment` に記録する(L182)が、`run-loop` は記録しない。どの環境で測った数値かを後から照合できず、ベースラインを既定モデル、ループを明示モデルで回した実害が出ている。

- `LoopResult`(`types.ts` L61-74)に `environment: Environment` を足す。位置は `exit_reason` の直後とし、`EvalResult` の並び(`skill_name` / `description` / `environment`)と読み口を揃える。
- `runLoop`(L171-360)の冒頭で `describeEnvironment(model)` を 1 回だけ呼び、`makeLoopResult`(L98-129)へ引数で渡す。反復ごとの `onIteration`(L258-269)にも同じ値が載るので、`--report` のライブ出力にも入る。
- 形は `run-trigger-eval` と同一にする。`base_url` / `auth_source` / `model` の 3 キーで、**トークンやキーの値は記録しない**(移植設計 §4.6)。

`generate-report.ts` は `environment` を表示しない。レポートの表示項目を増やすのは要件に無いため足さない。`LoopResult` が必須キーを増やすことで `generate-report.test.ts` L4-15 の fixture が型検査に落ちるので、同じコミットで `environment` を足す。

これで `skills/skill-creator/SKILL.md` L222「過去の測定と比べるときは `environment` の一致を確かめる」が、存在しない出力を参照している状態が解ける。

### 4.1 `environment.model` の表記ゆれ

`environment.model` は `--model` へ渡した文字列そのものになる。`sonnet` と `claude-sonnet-5` は同じモデルへ解決されても文字列が一致しない。L222 の「`environment` の一致を確かめる」が、別名どうしで偽陰性(比べられるのに比べない)を出す。

**解決済みのモデル名を記録せず、比較の規律側で吸収する。** 理由は 2 つある。

- 解決済み名を得るには `claude -p --output-format stream-json` の init イベントを読む必要がある。`stream-parse.ts` の `TriggerDetector` は最初のツール呼び出しで打ち切る作りで、init の読み取りを足すと打ち切り経路に手が入る。この判定ロジックは変えない制約がある(§15)。
- 規律側で吸収したときの失敗は**偽陰性**である。比べられたものを比べないだけで、比べてはいけないものを比べる事故は起きない。安全の向きが正しい。

SKILL.md の測定の規律へ次を足す。

- `environment` は文字列として比べる。`sonnet` と `claude-sonnet-5` を同じものとして扱わない。
- `--model` は毎回同じ書き方で渡す。

既定を `sonnet` に固定したので、実運用では 3 エントリとも同じ文字列が載る(§5)。表記ゆれは、利用者が明示的に別の書き方を混ぜたときにだけ起きる。

---

## 5. 項目 3・4: `--model` の既定を揃える

### 5.1 現状の割れ

| エントリ | `--model` | 型 |
| --- | --- | --- |
| `run-trigger-eval` | 任意(L239 で定義、L284 で受け渡し) | `RunEvalOptions.model?: string`(types.ts L40) |
| `run-loop` | **必須**(L418 で throw) | `RunLoopOptions.model: string`(L67) |
| `improve-description` | **必須**(L382 で throw) | `ImproveOptions.model: string \| undefined`(L59) |

### 5.2 決定

- `src/lib/defaults.ts` を新設し、`DEFAULT_MODEL = "sonnet"` を置く。エイリアスのまま渡し、解決は CLI に委ねる。実測時点で `sonnet` は `claude-sonnet-5` に解決される。
- `run-loop` L418 と `improve-description` L382 の必須チェックを外す。
- **既定の適用は、ライブラリ関数の側で行う。** `runEval` / `runLoop` / `improveDescription` の分割代入で `model = DEFAULT_MODEL` とする。`main` は `values.model` をそのまま渡す。
- `RunLoopOptions.model` を `model?: string` にし、`RunEvalOptions.model?: string` と揃える。

**初版は「既定を `main` で当てる」としていた。これを覆す。** `main` だけで当てると、ライブラリとして `runLoop` / `runEval` / `improveDescription` を直接呼ぶ経路、テストの一部、将来の利用で `model` が `undefined` のまま子プロセスへ渡り、`--model` 無しの `claude -p` が起動する。そのとき使われるのは**利用者の `~/.claude/settings.json` の既定**であり、多くの環境で opus 系になる。**測定が黙ってユーザー設定のモデルに落ちる穴が残る。**

項目 4 の目的は「能力の高いモデルが description の欠陥を覆い隠すのを防ぐ」ことである。その目的に照らすと、ユーザー設定へ落ちる経路は 1 つも残してはならない。「`undefined` = CLI の既定に委ねる」という移植元の意味は失われるが、その意味が守る価値より、穴を塞ぐ価値が大きい。

副次的な利点として、`environment.model` が常に具体値になる。`null` が載る経路が消える。

### 5.3 既定値の一本化

`defaults.ts` には数値既定もまとめる。現在は `parseNumericOption` の呼び出し側(`run-trigger-eval.ts` L266-283、`run-loop.ts` L473-498)と `runLoop` の分割代入(L178-184)に同じ値が二重に書かれている。項目 5 の `--help` が既定値を表示するため、三重になると必ずずれる。

```ts
export const DEFAULT_MODEL = "sonnet"
export const DEFAULTS = {
  runsPerQuery: 3,
  numWorkers: 10,
  timeout: 30,
  triggerThreshold: 0.5,
  holdout: 0.4,
  maxIterations: 5,
  improveTimeout: 300
} as const

/** 長さの予算(§8)。単位は UTF-8 のバイト数。段 5 の再検証で見直しうる暫定値である。 */
export const LENGTH_TARGET = 600
export const LENGTH_FLOOR = 680

/** description の長さは常にこれで測る。String.length は使わない。 */
export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}
```

`byteLength` を 1 箇所に置き、`improve-description.ts` と `run-loop.ts` の両方がこれを使う。**`String.length` で長さを測る箇所を残さない。** 混在すると、英語 description だけ予算が 3 倍近く厳しくなる。

副次的な効果として、第 5 版が §8.2 に書いていたサロゲートペアの注意(絵文字・異体字で `.length` が多めに出る)が不要になる。`Buffer.byteLength` は符号化後の実寸を返す。

`parseNumericOption` の呼び出しと `runLoop` の分割代入と help の表示が、すべてこの 1 箇所を参照する。数値既定の値そのものは変えない。

---

## 6. 項目 5: `--help`

3 エントリとも `parseArgs` が `strict: true` / `allowPositionals: false` のため、`--help` は `Unknown option '--help'` で落ちる(`run-trigger-eval.ts` L242-243、`run-loop.ts` L412-413、`improve-description.ts` L377-378)。

### 6.1 方式

`src/lib/cli-help.ts` を新設する。

```ts
export interface HelpOption {
  flag: string          // "--runs-per-query"
  value?: string        // "<回数>"
  required?: boolean
  defaultValue?: string // 既定値の表示。defaults.ts から渡す
  summary: string
}

export interface HelpSpec {
  command: string       // "run-trigger-eval.mjs"
  summary: string
  options: HelpOption[]
}

export function renderHelp(spec: HelpSpec): string
```

- 各エントリは自分の `HelpSpec` を定義し、`defaultValue` には `DEFAULTS` / `DEFAULT_MODEL` の値を**文字列リテラルで書かず参照で**入れる。既定値の表示がずれる余地を構造として消す。
- `main` の先頭、`parseArgs` の直後・必須チェックの**前**に `if (values.help) { process.stdout.write(renderHelp(spec)); return }` を置く。
- 出力は stdout、終了コードは 0。
- 各エントリの `options` に `help: { type: "boolean", default: false }` を足す。短縮形(`-h`)は足さない。

**`--help` は単独指定でのみ動く。** `--help --bogus` のような組み合わせは `parseArgs` が先に例外を投げる。`parseArgs` を 2 度呼んで先に help を拾う作りにはしない。得る利便より、引数解析が 2 系統になる害の方が大きい。

### 6.2 スモークテストへの影響

`src/__test__/bundle-cli-smoke.test.ts`(45 行)は 3 本を**引数なし**で起動し、必須フラグ不足の stderr を照合する。

**必須チェックの削除(項目 3・4)では既存の 3 ケースは壊れない。** `--model` のチェックはいずれも他の必須チェックより後ろ(`run-loop` L416-418、`improve-description` L380-382)にあり、引数なしで最初に出るメッセージは変わらないためである。

追加するケース:

- 3 本それぞれに `--help` を渡すと終了コード 0 で stdout に usage が出て、stderr が空になること。
- help の本文に自分のエントリ名が含まれ、他エントリの必須フラグ文言(`--eval-results` / `--eval-set`)が含まれないこと。`isDirectRun` のファイル名ディスパッチ(L296-301 / L516-521 / L437-442)が help でも効いていることを確かめる。

`runWithoutArguments` の隣に `runWithArguments(name, args): { stdout, stderr, status }` を足す。**`scripts/` を `pnpm run build` で再生成しないとこのテストは落ちる。** 各段で `build` → `test` の順に実行する。

---

## 7. 項目 6: 打ち切り条件と採否条件の整合

### 7.1 現状

```ts
function score(record: IterationRecord, hasTestSet: boolean): number {
  return hasTestSet ? (record.test_passed ?? 0) : record.train_passed
}

export function selectBest(history: IterationRecord[], hasTestSet: boolean): IterationRecord {
  return history.reduce((best, candidate) =>
    score(candidate, hasTestSet) > score(best, hasTestSet) ? candidate : best
  )
}
```

打ち切りは `record.train_failed === 0`(L276)、採否は test のみ(L75-77)。**採否を決める数値が、打ち切りの判断にまったく現れていない。**

### 7.2 初版の案(置換)は誤りだった

初版は打ち切り条件を `hasTestSet ? test_failed === 0 : train_failed === 0` へ**置き換える**と決め、「`best_description` は変わらない」と主張した。**この主張は 2 つのケースのうち片方でしか成立しない。**

| ケース | 現行 | 置換案 | best |
| --- | --- | --- | --- |
| A: train 満点・test 未満点 | 打ち切る | **打ち切らない** | **変わりうる**(後続が test を上げれば、その反復が採用される) |
| B: train 未満点・test 満点 | 打ち切らない | 打ち切る | 変わらない |

初版の証明は Case B だけを見ていた。さらに Case A で反復を続けると、train の失敗が 0 なので `buildImprovePrompt` に FAILED / FALSE のどちらの節も積まれない。**初版が §7.4 で AND 条件案を退けた理由(失敗を見ない当てずっぽうの案を 60 回かけて測る)を、採用案自身が踏んでいた。**

加えて、`split-eval-set.ts` L52-53 の `Math.max(1, …)` は各群から最低 1 問を test へ取る。`--holdout` を大きくする、または正例・負例が偏ると train が空になり、`trainResultList.length === 0` から `train_failed === 0` が恒真になる。置換案ではこの状態で打ち切りが効かず、**Case A が常態化する。**

### 7.3 決定: 置換ではなく OR にする

```ts
if (record.train_failed === 0) {
  exitReason = `all_passed (iteration ${iteration})`
  break
}
if (testSet.length > 0 && record.test_failed === 0) {
  exitReason = `holdout_maxed (iteration ${iteration})`
  break
}
```

論理的には `train_failed === 0 || (hasTestSet && test_failed === 0)` である。`exit_reason` を分けるために 2 つの guard として書く。`all_passed` は現行と同じ条件・同じ意味(train 全問合格)を保つ。

### 7.4 OR が両ケースで best を変えないことの確認

`selectBest` は `score` の狭義の `>` で畳み込み、初期値を持たない。**同点なら履歴の先(= 古い反復)が残る。** `history` は反復順に push される(L256)。この 2 点から次が言える。

| ケース | 現行の停止 | OR の停止 | best が変わらない理由 |
| --- | --- | --- | --- |
| A: train 満点・test 未満点 | 反復 N で停止 | **反復 N で停止(第 1 guard)** | 現行と同一の停止点・同一の history。best も同一 |
| B: train 未満点・test 満点 | 停止しない | 反復 N で停止(第 2 guard) | 反復 N の `test_passed` は `test_total` で最大値である。以後のどの反復も超えられず、同点は古い方が勝つ。したがって最大を最初に達成した反復は N 以下にあり、**その反復は truncate された history にも含まれる。** 現行と同じ record が選ばれる |
| C: 両方満点 | 反復 N で停止 | 反復 N で停止(第 1 guard) | 同一 |
| D: 両方未満点 | 停止しない | 停止しない | 同一 |

**OR は現行の停止条件の上位集合である。** 現行が止まる場面では必ず止まり、追加で止まるのは Case B だけで、そこでは best が不変である。したがって **OR はどのケースでも `best_description` を変えない。** 変わるのは `iterations_run` / `final_description` / `history` / `exit_reason` と、消費するコストである。

Case B で節約できるのは、停止した反復から `max_iterations` までの残り回数 × 60 回(20 問 × 3 回)の `claude -p` である。

### 7.5 「整合を取る」をどう満たすか

2 つの条件は、別々の正当な問いに答えている。

| 条件 | 答えている問い |
| --- | --- |
| `train_failed === 0` | **改善の入力が尽きたか。** 改善器の入力は train の失敗だけである(L302-309 が `trainResultList` を渡し、`blindHistory` が test を隠す)。失敗が 0 なら、次の反復に渡す材料が無い |
| `test_failed === 0` | **採否の結論が確定したか。** `selectBest` の値が上限に達し、以後どの案も採用されえない |

要件が指した矛盾は「採否を決める数値が打ち切りの判断に**一度も現れない**」ことだった。OR は後者を条件へ加えることでそれを解く。前者を削らないのは、削ると「材料が無いまま 60 回かけて当てずっぽうを測る」経路が開くためである。

### 7.6 train が空になる場合の扱い

`splitEvalSet` の結果 `trainSet.length === 0` になったとき、現行も OR も反復 1 で `all_passed` と称して停止する。**合格したのではなく、測る対象が無い。**

`runLoop` の反復に入る前に guard を置き、`--holdout` を下げるか問を増やすよう促すメッセージで throw する。既存の挙動(黙って反復 1 で停止し、元の description を最良として返す)を意図的に変える。誤った成功報告を出すより、止まった方がよい。

### 7.7 テスト

| 検証 | 内容 |
| --- | --- |
| **Case A の停止** | train 満点・test 未満点 → 反復 1 で停止、`exit_reason` が `all_passed`、`improveDescription` が呼ばれない。**既存 `run-loop.test.ts` L94-111 は train / test とも満点(Case C)なので、このケースを検出できない** |
| **Case B の停止** | train 未満点・test 満点 → 反復 1 で停止、`exit_reason` が `holdout_maxed` |
| Case B の best 不変 | test 満点に達した反復より後に、より高い train を出す反復が続く履歴でも、`best_description` が最初に test 満点へ達した反復のものになる |
| Case D の継続 | 両方未満点 → `max_iterations` まで回る |
| `holdout: 0` の退化 | test 無しのとき `train_failed === 0` で `all_passed` になる |
| train が空 | `holdout` を大きくして train が空になる eval で throw する |
| `selectBest` の不変 | L30-45 の 3 ケースを変更しない。**変更が入ったら要件違反の合図とする** |

---

## 8. 項目 7a: 長さの予算と改善プロンプト

### 8.1 3 種の制約を分けて扱う

| 種類 | 値 | 単位 | 性質 | 効く場面 |
| --- | --- | --- | --- | --- |
| 最適値 | **600 バイト前後** | **UTF-8 バイト** | 発火率が最大化する帯。実測で 504〜589 バイトが 20/20 | 測定しないとき、または初版を書くとき |
| 動作上限 | `description` + `when_to_use` の合算で **1536 字** | **文字** | Claude Code の実上限。超過分は一覧で黙って切り詰められ、発火判断が壊れる。エラーは出ない | 常に |
| 移植上限 | `description` 単体で **1024 字** | **文字** | Claude.ai へ昇格させる場合にのみ効く。`when_to_use` は Claude.ai に存在しない | 昇格の見込みがあるスキルだけ |

#### 単位が混在する理由

**最適値だけがバイト数で、2 つの上限は文字数である。** 意図的な混在なので、理由を残す。

| | なぜその単位か |
| --- | --- |
| 最適値 = バイト | **こちらで決められる規律だから。** 文字数にすると日本語専用の規律になる。UTF-8 バイト数なら、日本語 200 字と英語 100 words がほぼ同じ値(600 前後)を指し、言語に依らず 1 つの数で書ける |
| 2 つの上限 = 文字 | **プラットフォームの仕様だから。** Claude Code は一覧を文字数で切り詰め、Claude.ai の上限も文字数で規定されている。こちらの都合で単位を変換すると、実際の切り詰め位置とずれる |

実務上、両者が衝突することはない。600 バイトは日本語で約 200 字、英語で約 600 字であり、どちらも 1536 字の上限から遠い。**目安に従って書けば上限には触れない。** 上限が効くのは、目安を大きく超えた description を測っているときだけである。

#### バイト数を単位に選ぶ根拠

2 つの基準が同じ軸に乗ることを、換算と実測の両方で確かめた。

| 基準 | 文字数 | バイト数 |
| --- | ---: | ---: |
| 英語 100 words | 約 600 | **約 620** |
| 日本語 200 字 | 200 | **600** |
| 英語 200 words | 約 1200 | 約 1240 |
| 日本語 400 字 | 400 | 1200 |

英語 1 word あたりのバイト数は、`~/.claude/plugins/` 配下の英語 description(30 words 超・ASCII のみ)で中央値 **6.2**(範囲 6.0〜8.2)だった。

**このリポジトリの実測(バイト数で測り直した値)とも整合する。**

| 実測 | 文字数 | バイト数 | 発火率 |
| --- | ---: | ---: | --- |
| 最適帯 | 188〜223 字 | **504〜589 バイト** | 20/20 |
| 落ちる帯 | 302〜460 字 | **766〜1120 バイト** | 13〜15/20 |

公式の 100〜200 words は 620〜1240 バイトに相当する。**公式が幅を持たせた範囲の下限側が実測の最適帯に接し、上限側は実測で発火率が落ちる帯にあたる。** 2 つの基準は矛盾せず、同じ軸の上で重なる。

**バイト換算は「文字数 × 3」ではない。** 日本語 description にも ASCII(バッククォート・技術語・句読点)が混ざるため、実効は 2.5〜2.8 バイト/字である。概算の 3 倍で見積もると最適帯を 564〜669、落ちる帯を 906〜1380 と過大に読む。**上の表は実ファイルを測った値であり、概算ではない。** 実測どうしの間隔(589 と 766)は、概算が示すより狭い。

**動作上限 1536 字はコードで強制されない。** `parse-skill-md.ts` L36-83 は `name` と `description` しか読まず、`sandbox.ts` の `replaceDescription` L88-130 も `description` しか書き換えない。**`when_to_use` は測定にも予算にも一度も入らない。** したがって §8.2 の予算は `description` 単体の字数であり、合算 1536 字は人が守る規律としてのみ存在する。この非対称を、7b の規律にも明記する。

### 8.2 予算の取り方

初版は `budget = currentDescription.length` とし、「反復を重ねるほど単調に縮む」と書いた。**この単調性は次の 3 経路で崩れる。**

| # | 経路 | 何が起きるか |
| --- | --- | --- |
| 1 | `run-loop.ts` L337 は `currentDescription = newDescription`。**最良ではなく最新**を次の現行にする | 不採用に終わった案の字数が次の予算になり、予算が「効いた description」から切り離される |
| 2 | 超過案を 1 回書き直し、なお超過ならそのまま採用する | その出力が次の現行になり、**予算が増える** |
| 3 | 指示は「超えない」であって「短くせよ」ではない | 同等長を許す。単調非増加でも、縮む力は生まれない |

さらに独立レビューの指摘がある。**開始 description が既に短いとき、カバレッジ不足を足す方向が閉じる。** 予算が上限である以上、短い description は伸ばせず、欠けた条件を補えない。

**決定: `budget = max(これまでの最良 description のバイト数, LENGTH_FLOOR)`。**

```ts
const best = selectBest(history, testSet.length > 0)
const budget = Math.max(byteLength(best.description), LENGTH_FLOOR)
```

**単位をバイト数にする理由は、英語 description を不利にしないためである。** 文字数で予算を取ると、同じ情報量でも英語は文字数が 3 倍近くなり、日本語向けに決めた予算では最初から超過する。バイト数なら両者がほぼ同じ値に収まる(§8.1)。

| 経路 | この方式での帰結 |
| --- | --- |
| 1(最新を追う) | **解消。** 予算は `selectBest` の結果だけに依存する。不採用の案は予算を動かさない |
| 2(超過案の採用) | **解消しない。緩和にとどまる。** 超過案は短縮 1 回のあとでも次の反復で測られ、`selectBest` に勝てば最良になり、予算が上がる。上がるのは**測定で最良になったとき**に限られるので、上位の規律(測って高い方を採る)とは整合する。**しかし「単調非増加」は成り立たない** |
| 3(縮む力が無い) | **機構では解消しない。** プロンプトで目標字数 `LENGTH_TARGET` を明示して補う(§8.3)。従うかどうかはモデル次第である |
| 短い description が伸ばせない | **解消。** `LENGTH_FLOOR` までは伸ばせる。床より上では最良を超えられない |

**この方式が保証するのは「単調非増加」ではなく「測定で裏付けられない膨張をしない」である。** 上限は最良に固定して青天井の膨張を止め、床までの範囲は自由に使わせる。床より上へ伸ばす唯一の道は「測定で最良を更新すること」であり、字数ではなく発火率が門になる。これは §1.1 の確定事項(規律は字数ではなく発火率で立てる)と同じ形である。

#### 担保できる範囲と、モデルの従順さに依存する範囲

**予算の初期値は現行 description の長さである。** 現行が 1612 バイト(`prompt-smith`)なら、`budget` も反復 1 で 1612 バイトになる。`LENGTH_TARGET = 600` は**プロンプト上の目標に過ぎず、ハード上限ではない。**

| 項目 7 の目的 | 担保の度合い |
| --- | --- |
| バックログ §7 の「案がすべて現行より長くなる」を止める | **機構で担保する。** 予算が最良の長さを超えさせない |
| 600 バイト帯へ縮める | **担保しない。** プロンプトの目標指示と、短い案が測定で勝つことに依存する |

**この区別を曖昧にしない。** 機構は膨張を止めるだけで、縮める力そのものは持たない。縮むのは「短い案が実際に高いスコアを出し、最良になって予算を引き下げる」経路を通ったときだけである。

§16 未解決 #2((d) 反復ごと 2 案へ進むか)の判断条件を、この限界に合わせる。

- **案の字数が予算(= 最良の長さ)の近傍に張り付き、反復を重ねても下がらない** → プロンプトの目標指示が効いていない。(d) か、予算を反復ごとに一定割合で引き下げるラチェットを検討する。
- 案が予算より明確に短い側へ分布する → 指示が効いている。(d) へ進まない。

#### 予算にフォールバックを置かない

`budget` は `ImprovePromptInput` の**必須フィールド**にする。**省略時に `currentDescription.length` へ落ちる形にしない。** そのフォールバックを置くと、`runLoop` が渡し忘れたときに経路 1(最新を追う)が黙って再開する。呼び出し側は 2 つだけなので、必須にしても負担にならない。

- `runLoop`: `Math.max(byteLength(selectBest(history, hasTestSet).description), LENGTH_FLOOR)`
- `improve-description` 単独 CLI: `Math.max(byteLength(evalResults.description), LENGTH_FLOOR)`(履歴が無いため)

**`runLoop` がどちらを渡しているかをテストで固定する**(§8.6)。

#### 2 つの定数の導出

いずれも**実測したバイト値**から引く。概算(文字数 × 3)は使わない(§8.1)。

| 定数 | 値 | 導出 |
| --- | ---: | --- |
| `LENGTH_TARGET` | **600** | 実測の 20/20 帯は 504〜589 バイト。英語 100 words は約 620 バイト。**両者の間に置く。** 日本語 200 字・英語 100 words のどちらから来ても同じ値を指す |
| `LENGTH_FLOOR` | **680** | 実測の 20/20 帯の上端 589 と、13〜15/20 帯の下端 766 の**中点(677)を丸めた値**。上端より上なので短い description には伸びる余地があり、下端より下なので**実測で落ちた長さを床が許すことはない** |

**英語スキルで床が機能するかを確かめた。** 680 バイトは約 110 words(6.2 バイト/word)にあたる。

| 観点 | 判定 |
| --- | --- |
| 公式の下限(100 words = 約 620 バイト)を上回るか | **上回る。** 100 words 未満の英語 description は、公式の推奨範囲の内側で 110 words まで伸ばせる |
| 公式の上限(200 words = 約 1240 バイト)まで伸ばせるか | **伸ばせない。** ただし 1240 バイトは実測の落ちる帯(766〜1120 バイト)を超えており、**許さないことが意図である** |

つまり床は、英語でも日本語でも「公式範囲の下半分までは自由」という同じ意味になる。**公式の 100〜200 words という幅のうち、実測が支持するのは下半分だけである**、というのがこのリポジトリの立場になる。

**両定数とも、隔離前の測定に由来する暫定値である。** 段 5 の再検証(§13)で見直しうる。`defaults.ts` の定数にして 1 箇所で変えられるようにする。

### 8.3 `buildImprovePrompt` の変更

変更するのは L159 の 1 行だけにする。`ImprovePromptInput` に `budget: number` を足し、次の 4 点を英文で伝える。

1. 現行 description のバイト数(`byteLength(currentDescription)`)。
2. 新しい案が超えてはならないバイト数(`budget`)。
3. 目標とするバイト数(`LENGTH_TARGET`)。
4. 失敗を埋めるとき、節を**足す**のではなく既存の節を言い換える・統合する・削ることで賄うこと。

**単位が UTF-8 バイト数であることを、プロンプトに明示する。** 数値だけ渡すとモデルは文字数と解釈しうる。英語で書くときはバイト数と文字数がほぼ一致し、日本語で書くときは 1 字が約 3 バイトになる、という換算も 1 文添える。**これがあるから、同じプロンプトで日本語のスキルも英語のスキルも扱える。**

**「短い方が強い」という主張は書かない。** その主張は段 5 の再検証にかかっており、反転したときにプロンプト本文の撤回が要る。数値(現行・上限・目標)だけを渡せば、方向の主張をせずに同じ行動を引き出せる。目標値は `defaults.ts` の定数から埋めるので、再検証の結果は定数の変更だけで反映できる。

L154-157 の「個別クエリを列挙せず意図のまとまりへ一般化する」段落は変更しない。L161-165 の 4 つの tips も変更しない。

**L167 行末の `${" "}` を落とさない。** テンプレートリテラルの行末に明示された半角スペース 1 つであり、書き換えの巻き添えで消えやすい。テストで末尾の空白込みの部分文字列を照合して固定する(§8.6)。

改善プロンプトは英文のままとする(移植設計 §2)。ただし L159 の置き換えは移植元との差分になるため、`NOTICE` の変更点一覧へ足す(§11.1)。

### 8.4 `buildShortenPrompt` の変更

現行(L187-197)は 1024 **文字**超のときだけ発火する(L330 の条件)。日本語 description では実質この門しか機能していない。

- 判定の閾値を `1024`(文字)から `budget`(**バイト**)へ差し替える。判定式は `byteLength(description) > budget`。L322 の `over_limit` も同じ基準に揃える。
- `buildShortenPrompt` の本文の `1024` を `budget` に差し替え、単位がバイト数であることを明示し、「削る・統合する方を、言い回しの圧縮より先に試す」を足す。
- **再依頼は 1 回だけ、という移植元の挙動を変えない。** 2 回目もなお予算超過なら、そのまま採用して測る(移植設計 §4.2)。§8.2 のとおり、予算は最良に紐づくのでこの採用が予算を押し上げることはない。
- `1024` という数値はコードから消える。移植上限は 7b の条件付き規律として残る。

`improve-description` を単独 CLI として使うときは履歴が無いので、`budget = max(currentDescription.length, LENGTH_FLOOR)` とする。`--max-chars` のようなオプションは足さない(要件外)。

### 8.5 短縮方向の探索: 4 案の比較

バックログ §7 が挙げた 4 案を、測定コストと合わせて比べる。1 反復の支配的コストは eval の 60 回(20 問 × 3 回)の `claude -p` である。改善案生成は 1〜4 回の text 呼び出しで、桁が 1 つ違う。

| 案 | 追加コスト | 採否 | 理由 |
| --- | --- | --- | --- |
| (a) 現行字数を生成プロンプトへ明示する | 0 回 | **採用** | 「案が現行より長い」ことをモデルが観測できるようにする唯一の手段。現在は字数も語数も渡っていない |
| (b) 上限超過の案は測定せず再生成する | 反復あたり 0〜1 回の text 呼び出し | **採用** | 既存の短縮経路(L330-358)の閾値を差し替えるだけで実現する。超過案が eval へ進む前に止まり、60 回の測定を無駄にしない |
| (c) 言い換え・削除も選択肢だと明示する | 0 回 | **採用** | 失敗クエリを列挙する構造が案を「足す」方向へ押す。反対向きの指示を置かないと釣り合わない |
| (d) 反復ごとに足す案と削る案の 2 通りを測る | **反復あたり +60 回** | **不採用** | 支配的コストが倍になる。加えて `IterationRecord` が 1 反復に 2 つの description を持つ形になり、`selectBest` / `blindHistory` / `generate-report` / results JSON の契約がすべて変わる。**`selectBest` を触らない確定事項とも衝突する** |

(d) は捨てずに保留する。(a)(b)(c) を入れて段 5 の測定を行っても案が縮まないときに、改めて検討する(§16 未解決 #2)。

### 8.6 テスト

`src/__test__/improve-description.test.ts` L74-85 は `"1024 characters"` と `"100-200 words"` を assert しており、必ず落ちる。次へ置き換える。

| 検証 | 内容 |
| --- | --- |
| 現行バイト数の明示 | `buildImprovePrompt` の出力に `byteLength(currentDescription)` の値が含まれる |
| 予算の明示 | 出力に `budget` の値が含まれ、「超えない」趣旨の指示と**単位がバイト数である旨**が付く |
| 目標の明示 | 出力に `LENGTH_TARGET`(600)の値が含まれる |
| 旧文言の消去 | `"100-200 words"` と `"1024 characters"` を含まない |
| 行末の空白 | L167 に当たる行が、末尾の半角スペースを保ったまま出力に現れる |
| 短縮経路の閾値 | 予算 + 1 **バイト**の案で `buildShortenPrompt` が 1 回だけ走り、予算ちょうどの案では走らない |
| 再依頼の回数 | 2 回目も超過のとき、そのまま採用して 3 回目を呼ばない |
| **予算が最良に紐づくこと** | `runLoop` が `improveDescription` へ渡す `budget` が、最新ではなく `selectBest` の結果のバイト数に `LENGTH_FLOOR` を下限として当てた値になる。最新の案がより長い履歴で固定する |
| **床が効くこと** | 最良 description が `LENGTH_FLOOR` より短いとき、`budget` が `LENGTH_FLOOR` になる |
| **単位がバイト数であること(言語非依存)** | 日本語 300 字(900 バイト)の description と、英語 900 字(900 バイト)の description が**同じ `budget` を得る。** `String.length` を使っていると前者が 300、後者が 900 になって落ちる |

---

## 9. 項目 8: eval セットの作成基準と既存 eval への適用

### 9.1 足す 6 基準と、その適用条件

`skills/skill-creator/SKILL.md` の `## eval セット` `### 形式`(L141-162)へ足す。現行の 11 項目は残す。問数 20(L152-154)は変えない。

**基準 2 と 3 は、起動経路が「AI が提案し、ユーザーが答える」であるときにだけ当たる。** 条件を書かずに並べると、経路の合わないスキルに経路外の問を作らせることになる。バックログ §8 末尾が `capturing-architecture` で差し替えを行わなかった理由がこれである。

| # | 内容 | 適用条件 | 既存基準との違い |
| --- | --- | --- | --- |
| 1 | eval を作る前に、そのスキルの主な起動経路をユーザーに聞く。経路は「ユーザーが目的を明示して依頼する」と「AI が提案し、ユーザーがそれに答える」の 2 通りがある | 無条件 | 既存は問の**内容**の基準だけを持ち、**構成を決める前の確認**を持たない |
| 2 | 提案への回答の形を `should_trigger: true` の問に入れる | **経路が「提案への回答」のとき** | 既存基準だけで作ると true 問がすべて「明示した依頼」に偏る。「境界事例を選ぶ」(L159)は 1 つの経路の中の境界しか指さない |
| 3 | 提案への回答を書くとき、AI の発言をなぞる形にしない | **基準 2 を適用するとき** | 「口語を混ぜる」(L157)は語調の話であり、復唱するかどうかを決めない |
| 4 | 短い問を作るとき、下限は対象を指す語が 1 つ残るところとする。測定は会話履歴を持たない単発実行であり、「お願いします」だけの返答はどのスキルへの依頼か判定できない | **短い問を作るとき**(経路を問わない) | 「クエリの長さを混ぜる」(L158)は下限を定めていない |
| 5 | description が使う語だけで true 問を作らない。同じ行為を指す別の語を混ぜる | 無条件 | 「明快な例ではなく境界事例を選ぶ」(L159)は語彙の重なりを扱わない |
| 6 | 別のスキルが担当しそうに見えて、実はこのスキルが担当する依頼を `should_trigger: true` に入れる | 無条件 | L161-162 は `should_trigger: false` 側の near-miss だけを扱う。**true 側の担当境界を扱う条件が既存 11 項目に無い** |

**基準 6 は、ユーザーが採用を決めた追加である**(バックログ §8 の 5 項目の外)。設計は §9.4 に置く。

なお公式の負例の定義は「このスキルが発動してはいけない、紛らわしい依頼」であり、「他スキルが担当すべき依頼」ではない。合格条件は対象スキルが発火しないことで、他スキルが発火したかは見ていない(実装も decoy 名だけを見る)。移植版 L161-162 の「語や概念を共有する near-miss」「別の対応が要る問」はこの趣旨と整合しており、**変更しない。**

**基準 4 の適用条件を「経路」ではなく「短い問を作るとき」にする。** レビューの指示は基準 2〜4 に経路の条件を付けることだったが、基準 4 は**問を増やす指示ではなく、短い問が満たすべき下限を定める制約**である。経路の合わない問を生む余地が無く、明示依頼の経路でも短い問は作られる(「クエリの長さを混ぜる」が既存基準にある)。経路で縛ると、明示依頼のスキルで測れない問が作られたときに止める規律が消える。

基準 3 と 4 は例示が無いと判断基準にならない。**この 2 つだけ Input と Output の対で書く**(SKILL.md L112「例は Input と Output の組で示す」に従う)。他の 3 つは例示なしで書く。

小見出しを新設しない。この節が「eval セットが満たすべき条件」の 1 枚のリストとして読まれる作りになっており、途中に見出しを入れると前半だけを読んで作る動きが出る。

**配置は基準 6 だけを分ける。** 基準 1〜5 は箇条書きの末尾へ続ける。**基準 6 は L161-162(負例の 2 行)の直後へ置き、負例と対であることを配置で示す**(§9.4.2)。

### 9.2 L160「1 手で終わる問は作らない」との衝突

基準 4 が求める短い問(「更新しといて。他もズレてたら一緒に」)は、L160 の字面と衝突して見える。

**衝突は L160 の読み違いから来る。** L160 の出典(移植設計 §6.1)は「Claude が自力で処理できる依頼ではスキルを参照しない」であり、制約の対象は**作業量**であって**問の長さ**ではない。上の例は 15 字だが、求めている作業(ARCHITECTURE の差分検出と更新)は多段である。

L160 を次のように直して衝突を解く。

- 制約の対象が作業であることを明示する(「1 手で終わる**作業**を求める問は作らない」)。
- 問の短さを作業量の基準にしない、という 1 文を足す。

### 9.3 既存 eval 6 本への適用(項目 8b)

#### 対象を metatron まで広げる理由

バックログが数値で示した 2 つの失敗は、**どちらも metatron の eval で起きた。**

| 事例 | 所在 |
| --- | --- |
| 項目 6 の取りこぼし(train 6/12 → 8/12 に改善したが holdout 7/8 同点で不採用) | `updating-architecture` の改善ループ |
| 項目 8 の失敗モード(提案への短い返答を true 問にすると 6 問中 5 問が失敗した) | `updating-architecture` と `recording-gotchas` |

**`prompt-smith` の 3 スキルだけを対象にすると、受け入れ基準をすべて満たしてもこの 2 つは再現も検証もされない。** 直した対象と、欠陥が観測された対象が食い違う。

#### metatron eval の現状(2026-09-17 時点で確認)

3 本とも 20 問 = true 10 / false 10 である。**バックログ §8 の実験による差し替えは、既にファイルへ入っている。**

| ファイル | 基準 2・3(提案への回答) | 基準 4(短さの下限) | 基準 5(別語彙) | 基準 6(担当境界の正例) |
| --- | --- | --- | --- | --- |
| `updating-architecture.json` | **適用済み 3 問**(「更新しといて。他もズレてたら一緒に」「ADR に残して。前提だった方は廃止で」「ARCHITECTURE、今の実装と合ってる? ずれてたら直して」) | 満たす | 一部 | **未整備** |
| `recording-gotchas.json` | **適用済み 3 問**(「残しといて。次も同じとこで止まると無駄」「さっきの罠、記録しといて。…」「メモ残しといて。…」) | 満たす | 「メモ残しといて」が該当。体系的ではない | **未整備** |
| `capturing-architecture.json` | **適用しない**(明示依頼が主。バックログ §8 末尾の判断どおり) | — | 未整備 | 1 問が該当しうる(「`/codiel:init` が作った ARCHITECTURE が `## ドメインマップ` の 1 節しかありません」= 更新に見えて実は最小構成を育てる依頼) |

**足りないのは基準 5 と基準 6 である。** 基準 2・3 は既に入っており、新たに足す必要がない。**prompt-smith の 3 スキルでは適用外だった基準 2・3 が、metatron では既に効いている状態にある。**

#### 差し替えの配分

**6 本すべてに同じ配分を当てる。**

| 種別 | 問数 | 扱い |
| --- | --- | --- |
| 基準 5(description に無い語で言い直した問) | 2 | 差し替え |
| 基準 6(担当境界の正例) | 2 | 差し替え |
| 据え置き | 6 | 変えない |
| 計 | 10 | 差し替え **4 問 / スキル、6 本で 24 問** |

**metatron でも 4 問にする根拠。** 不足しているのが基準 5 と 6 の 2 系統だけで、prompt-smith 側と同じである。基準 2・3 が既に入っているぶんは据え置き 6 問の側に数える(`updating-architecture` と `recording-gotchas` では、据え置き 6 問のうち 3 問が提案への回答になる)。**経路が違っても、足りない基準の数が同じなら問数を変える理由がない。**

差し替え元は、**明示依頼の問から選ぶ。** §8 で入った提案への回答 3 問は据え置く。あれは実運用の主経路を表しており、外すと経路の実態を反映しない eval に戻る。

対象は `plugins/prompt-smith/evals/{prompt-smith,skill-creator,agent-creator}.json` と `plugins/metatron/evals/{capturing-architecture,updating-architecture,recording-gotchas}.json`(各 20 問 = true 10 / false 10)。**問の総数と true / false の内訳は変えない。** 差し替えるのは true 側だけで、false 10 問は触らない。基準 6 は true 側の条件である。

**各種別を 2 問にする根拠。** 1 問だと `--runs-per-query 3` で 3 実行しかなく、その 1 問の振れが種別の判定を支配する。さらに SKILL.md L221 は「1〜2 問の差で description や実装を疑わない」と定めており、**1 問しかない種別は、落ちても規律上「疑ってはいけない」差にしかならない。測る意味が立たない。** 2 問なら種別として 2 問の差を作れ、規律の閾値に届く。

**上限を 2 問にする根拠。** 3 問ずつにすると true 10 問のうち 6 問が新形式になり、据え置き分が 4 問に落ちる。**そのスキルの主な起動経路が eval の主役でなくなる**(§1.1)。`prompt-smith` の 3 スキルでは明示依頼が、`metatron` の 2 スキルでは提案への回答が、それぞれ据え置き側に入っている。経路の実態を反映しない eval になる。

差し替え 4 問はバックログ §8 の実績(metatron で 3 問 / スキル)より多いが、そこでは基準が 1 系統だった。2 系統で 2 問ずつは同じ密度である。

| 項目 | 内容 |
| --- | --- |
| 基準 5 の選定 | 現行 description に現れる語をそのまま含む true 問を挙げ、語の重なりが大きい順に 2 問を採る |
| 基準 5 の差し替え方 | 同じ意図を、description に無い語で言い直す |
| 基準 6 の選定と配分 | §9.4.4 |
| 併せて確かめる | 差し替えた 4 問が基準 4 の下限(対象を指す語が 1 つ残る)を満たすこと。L160 の作業量の条件を満たすこと |

**差し替えは段 5 の測定より前に行う。** 差し替え後の eval がベースラインの対象になる(§2.1)。

### 9.4 基準 6 の設計

#### 9.4.1 位置づけ: 隔離で失う競争耐性の測定を、クエリ設計で代替する

基準 6 は公式条件の単なる移植ではない。**環境側で競争させる代わりに、競争条件をクエリの中へ埋め込む**という設計判断である。

| | 環境側の競争(隔離前) | クエリ側の埋め込み(基準 6) |
| --- | --- | --- |
| 競争相手 | 測定時に同席したユーザースキル・プラグイン | クエリの表層が指す「別の担当らしさ」 |
| 再現性 | **無い。** 測定者の環境・プラグイン構成・CLI 版で顔ぶれが変わる | **有る。** eval セットに固定され、版管理に乗る |
| 測るもの | 実際の勝敗 | 担当境界の明示度 |

隔離は再現性を得る代わりに競争耐性の測定を失う。基準 6 はそれをクエリ側で取り戻す。**隔離の利点(再現性)と、競争測定が見ていた判別力の両方を取る。**

**代替であって同一ではない。** この限定を書かずに「競争に勝った率を測る」とだけ言うと、測れないものを測れると誤解させる。

- 測れる: description が、他所の仕事に見える依頼に対して自分の担当だと主張できているか(**description 側の要因**)。
- 測れない: 自分の description は十分だが、相手の description の方が魅力的で負ける(**相手側の要因**)。

サンドボックスに置かれるのは対象スキル 1 本だけである(`createSandbox` は `.claude/skills/<cleanName>/SKILL.md` を 1 つ書く)。相手が同席しない以上、相手側の要因は原理的に測れない。**唯一の例外が CLI 組み込みスキル 17 件で、ここだけは隔離後も本物の競争が起きる**(§9.4.5)。

#### 9.4.2 負例との対称性

基準 6 と既存の負例 2 行(L161-162)は、description の担当境界を両側から挟む対になる。

| 側 | 条件 | 正解 |
| --- | --- | --- |
| `should_trigger: false` | 語や概念を共有するが、別の対応が要る(L161-162) | 発火しない |
| `should_trigger: true` | 別のスキルが担当しそうに見えるが、このスキルが担当する(基準 6) | 発火する |

矛盾は無い。両者を分けるのは「似ているかどうか」ではなく「正解がどちらか」である。重複も無い。L161-162 は false 側だけを扱い、true 側の担当境界を扱う条件は既存 11 項目に存在しない。

**対であることが読み取れるよう、平行な構文で書き、配置も隣接させる**(§9.1)。「`should_trigger: false` は…で埋める」に対して「`should_trigger: true` には…を入れる」と揃える。

既存 L159「明快な例ではなく境界事例を選ぶ」は種別を問わない一般則で、そのまま前方に残す。基準 6 はその境界のうち「他スキルとの担当境界」を true 側で具体化したものにあたる。

`references/description-guide.md` L12(担当が近いスキルがあるときは、そちらが担当する場面を書いて境界を示す)とも衝突しない。guide は description に境界を**書く**規律、基準 6 はそれを true 側から**測る**条件である。

#### 9.4.3 項目 7(長さの予算)との衝突

**衝突は実在する。** 基準 6 の問が落ちると `buildImprovePrompt` の FAILED TO TRIGGER 節に積まれ、改善案は「別スキルではなくこちらが担当だ」と書き足す方向へ動く。担当境界の明示は description を長くしやすく、予算(§8.2)は短くする方向へ引く。

ただし**衝突の向きは、このリポジトリの実測と逆である。** バックログ §7 は次を記録している。

> 担当が重なっていたスキル間の誤発火も、境界を詳しく書くのではなく双方を短くすることで 1.00 から 0.00 へ解消した。

境界の問題は、境界を書き足すのではなく**薄めるのをやめる**ことで解けた。この観測は false 側で取られたものだが、機構は同じである(希釈が自領域の再現率と隣接領域の適合率を同時に下げる)。**基準 6 の問も、短い description で通る可能性の方が高い。**

3 案の採否は次のとおり。

| 案 | 採否 | 根拠 |
| --- | --- | --- |
| (a) 予算を超えない範囲で境界を書く方法を生成プロンプトに指示する | **採用(追加指示は足さない)** | §8.3 の項目 4「節を足すのではなく既存の節を言い換える・統合する・削る」が既にこの指示である。境界の主張もこの枠内で行われる。種別ごとの分岐をプロンプトに書くことはしない(下記) |
| (b) この形の正例の失敗を他の失敗と区別して改善プロンプトへ渡す | **不採用** | eval セット JSON に種別を持たせる必要がある。現行スキーマは `query` と `should_trigger` の 2 キーのみで、`parseEvalSet`(L202-225)がそれを検証する。**スキーマを変えない制約(§15)に反する** |
| (c) 衝突を許容し、予算を優先する | **部分採用** | 予算は上限として効き続ける。ただし「境界の明示を諦める」形では採らない |

**採る解決は、既に設計に入っている調停機構である。** 追加の機構を入れない。

1. 境界を書き足して予算を超えた案は、`buildShortenPrompt` が 1 回書き直す(§8.4)。
2. それでも長い案はそのまま測る(移植元の挙動)。
3. **勝敗は測定が決める。** 長くなった案が測定で最良を更新すれば採用され、予算の床も上がる(§8.2)。更新しなければ採用されない。

これは「規律は字数ではなく発火率で立てる」(§1.1)の直接の帰結である。**基準 6 と予算が競合したとき、勝つのは発火率であって、どちらの規律でもない。** 予算が最良に紐づく方式(§8.2)にしたことで、この調停が自動的に働く。初版の「最新に紐づく」方式のままなら、境界を書き足して落ちた案が次の予算を決めてしまい、調停が壊れていた。

(b) を退けたことで、改善器は基準 6 の失敗を他の失敗と区別できない。**区別できないことは害にならない。** 改善プロンプトは既に「個別クエリへ過学習せず、意図のまとまりへ一般化せよ」と指示しており(L154-157)、種別を教えると逆にその問だけを狙う動きを誘う。

**衝突が実際に起きたかは段 5 で観測する**(§13.5)。基準 6 の問が落ち続け、かつ案が予算に張り付く症状が出たときにだけ、(b) 相当の対処(スキーマ拡張)を検討する(§16 未解決 #11)。

#### 9.4.4 3 スキル相互の境界と、外部の相手

**どちらのプラグインも、内部に担当の隣接を持っている。**

| プラグイン | 内部の隣接 | 記録 |
| --- | --- | --- |
| `prompt-smith` | `prompt-smith`(本文)/ `skill-creator`(description と測定)/ `agent-creator`(Agent 定義) | 2026-08-02 設計書 §4.3 が既に**負例側**でこれを使っている(担当が近い別スキルが正解の依頼を fp セットに置く) |
| `metatron` | `capturing-architecture` と `updating-architecture` の担当が重なる | バックログ §7 が「担当が重なっていたスキル間の誤発火」として記録している |

正例側にも対称的に張れる。**張る。ただし 2 問のうち 1 問に限る。**

| 基準 6 の 2 問 | 相手 | 例(意図) |
| --- | --- | --- |
| 1 問目 | **同じプラグイン内の他のスキル** | `skill-creator` に対して「本文を整える依頼に見えるが実は description の改善」/ `updating-architecture` に対して「初期化の依頼に見えるが実は既存文書の更新」 |
| 2 問目 | **プラグイン外**(CLI 組み込みスキル、または一般的な作業に見える依頼) | §9.4.5 |

**1 問目を内部境界に限る根拠。** 2 問ともプラグイン内部にすると、eval が「そのプラグイン内部の境界」だけを測る。実運用では利用者の環境にそのプラグイン以外のスキルが多数あり、内部境界を直しても外部の相手に対する境界は改善しない。1:1 で張れば内部の相互参照は 1 スキルあたり 1 問 = 6 本で 6 問にとどまり、true 60 問中 6 問(10%)で偏らない。

**metatron の内部境界は、既に実害が観測された箇所である。** バックログ §7 は `capturing-architecture` と `updating-architecture` の誤発火が 1.00 だったと記録している。負例側でこれを捕まえていた一方、**正例側(「初期化に見えるが実は更新」)は未整備である**(§9.3)。ここに 1 問を置く価値は、prompt-smith 側より高い。

**隔離は、2026-08-02 §4.3 が「3 スキルを一括で書き換える」ことを強制した理由を消している。** あの議論は 3 スキルが同席する前提で、1 つだけ替えると他スキルの問を奪う・譲る動きが起きる、というものだった。隔離後はサンドボックスに 1 本しか置かれないため、**3 スキルの description を別々に変えても相互干渉は起きない。** §13.3 が比較用の案を一括で作る理由は、相互干渉の相殺ではなく、判定をスキル合計の問数で行うため方針の作り方を揃える必要があることである。

#### 9.4.5 隔離環境で意図どおり働くか

隔離後に同席するのは CLI 組み込みスキル 17 件だけである。ここから 2 つの帰結が出る。

**帰結 1: 組み込みスキルの担当に見える依頼は、隔離後も本物の競争になる。** `TriggerDetector` は `<skill-name>-skill-` の前方一致だけを見るため、組み込みスキルが先に発火すれば prefix が一致せず `not_triggered` になる。**正例が実際に競争に負けて落ちる。** §9.4.4 の 2 問目をここへ当てると、疑似ではない競争を 1 問だけ確保できる。

**帰結 2: プラグイン内部の境界(1 問目)では競争は起きない。** 相手が同席しないので、測っているのは「この description が、他所の仕事に見える依頼を自分の担当だと主張できているか」である。相手に負けるのではなく、**自分が名乗り出られないことが失敗として観測される。** これは §9.4.1 の限定そのものである。

**判別力の確認手順(段 5 に組み込む)。**

| # | 手順 | 判定 |
| --- | --- | --- |
| 1 | 基準 6 の **12 問(6 スキル × 2 問)**の合否を `results[]` から手で拾い、他の true 問と分けて記録する | eval スキーマを変えずに種別を追える。どの問がどの種別かは作成時に分かっている |
| 2 | 比較のある対象では、現行と短縮案の両方で合否を比べる | **両案とも 3/3 で通る問は判別力が無い。** 差し替える(既存規律「両構成とも合格する assertion には識別力がない」の eval 版) |
| 3 | 組み込みスキル狙いの問(2 問目)が落ちたとき、`claude -p` を直接叩いて stream を読み、**組み込みスキルが発火したのか、何も発火しなかったのか**を切り分ける | 前者なら本物の競争が測れている。後者なら description が届いていないだけで、帰結 2 と同じ扱いになる |

手順 3 は手作業になる。**現行の `TriggerDetector` は最初のツール使用で打ち切り、一致しなければ false を返すだけで、何が発火したかを記録しない。** 記録する機構を足すのは要件の外なので足さない。切り分けが常時必要になったときに設計し直す(§16 未解決 #13)。

### 9.5 承認 UI と回収手順

`skills/skill-creator/assets/eval-review.html` は現在 query / should_trigger の表だけを出し、**既存 11 項目も新 6 基準も UI に無い。** 承認する人が、何に照らして承認するのかを見られない。

- 既存 11 項目と新 6 基準を、静的な一覧として画面に出す。**判定ロジックは足さない。** 語彙の重なり・作業量・担当境界はいずれも機械的に判定できない。
- `SKILL.md` L185 の回収検査(20 問・内訳・JSON 形式)に、**基準 4・5・6** を満たすかの確認を足す。機械的検査は現行の 3 つのままとし、増やした分は人が見る項目として書く。

**基準 6 を回収検査に入れないと、レビュー工程をすり抜ける。** 基準 6 の問が条件を満たしていないことは、段 5 の §13.5 の観測まで分からない。承認の時点で人が見る項目に含める。
- `eval-review.html` は Apache-2.0 の移植アセットであり、`NOTICE` に「No behavioural changes」と書かれている。**表示を足すのでこの記述を改める**(§11.1)。

### 9.6 既存スキルを直す入り口(L55)

`SKILL.md` L55 は「既存スキルの description だけを直す依頼では、手順 1〜7 を飛ばして手順 8 から始める」と書く。手順 8 は「eval セットの有無を確かめる」であり、**有れば何もせず手順 9 へ進む。** この入り口では新基準が既存 eval に一度も当たらない。

手順 8 を「eval セットの有無と、基準を満たすかを確かめる。満たさない問は差し替える」に変える。手順の追加や順序の変更はしない。L55 の入り口をそのまま使いながら、新基準が効くようになる。

---

## 10. 項目 7b と指示書の追随

### 10.1 `skills/skill-creator/SKILL.md` description の規律(L131-139)

**段 5 の測定結果を受けてから改稿する**(§13 の分岐)。方向が維持された場合の内容を示す。

| 行 | 現行 | 改修後の扱い |
| --- | --- | --- |
| L133 | `description` は 1024 字以内にする | **条件付きに変える。** Claude.ai へ昇格させる見込みがあるスキルに限る |
| L134 | 100〜200 words 相当へ収める | **置き換える。** 測らないときの目安を **600 バイト前後(UTF-8)**とし、日本語なら約 200 字・英語なら約 100 words に相当する、と換算を添える |
| L135 | 発火精度より 100〜200 words 相当の範囲を優先する | **削除して反転させる。** 発火率を優先し、測れるときは測って高い方を採る |
| L136 | 上限に触れたときは、個別の記述を意図のまとまりへ言い換えて縮める | **残す。** 短縮の方向(言い換え・統合・削除)を示す唯一の行である |
| — | (無い) | **足す。** `description` と `when_to_use` の合算を 1536 字以内にする。**この上限はスクリプトが検査しない**(§8.1) |

L135 は実測と正面から逆であり、最も重い。

#### 規律本文を言語非依存に書く

**`skill-creator` は日本語のスキルだけを作るわけではない。** L113 は「英語の本文は imperative で書く」と既に英語のスキルを想定している。長さの規律だけ「200 字前後」と書くと、**そこだけ日本語専用の指示になる。**

方針を 3 つ定める。

| # | 方針 | 理由 |
| --- | --- | --- |
| 1 | **主たる数値はバイト数で書く。** 「600 バイト前後にする」 | 言語に依らない 1 つの数で書ける |
| 2 | **換算を併記する。** 「日本語なら約 200 字、英語なら約 100 words にあたる」 | バイト数は人が数えにくい。書き手が自分の言語で見当をつけられるようにする |
| 3 | **どちらの言語で書くかを規律で決めない。** 長さの節に言語の指示を混ぜない | 言語の選択は L113 が扱う別の論点である |

換算を「根拠」ではなく「読み替えのための補助」として置く。**根拠(実測 504〜589 バイトが 20/20、公式 100 words が約 620 バイト)は本文に書かない。** `prompt-smith` の規律に従い、根拠はこの設計書と `docs/` に残す(§2.2)。

### 10.2 長さの規律を置く場所

**`skills/skill-creator/SKILL.md` に置く。`references/description-guide.md` には置かない。**

`description-guide.md` は現在 22 行で、長さ・字数・語数の記述が 1 つも無い。2026-08-02 の設計書 §4.4 は「1536 字の制約節を guide に足す」と計画したが、実装されなかった。同設計書が言及する `plugins/optimize-agents/scripts/check-skill-definition.ts` も、プラグインごと現存しない。**この計画を今から実装しない。**

理由は、その後 2026-08-09 の移植設計 §8.3 が guide の役割を狭めたためである。guide は SKILL.md・コマンド定義・Agents 定義・output style・メモリに**共通する基準だけ**を持ち、skill 固有の規律は `skill-creator` の本文へ、Agents 固有の規律は `agent-creator` の本文へ移す、と決めた。2026-08-02 の計画は、この決定より前に書かれている。

3 制約はいずれも skill / コマンド定義に固有である。

| 制約 | 根拠 |
| --- | --- |
| 600 バイト前後の最適値 | 実測は skill の発火測定で取った。Agents 定義の発火を測る手段はこのプラグインに無い(移植設計 §8.3) |
| 合算 1536 字 | `when_to_use` は Claude Code の skill / command にしか存在しない。Agent 定義には無い(2026-08-02 設計書 §4.5) |
| 単体 1024 字 | Claude.ai の Agent Skills 仕様。コマンド定義も Agents 定義も Claude.ai へは昇格しない |

したがって `description-guide.md` は変更しない。

### 10.3 測定の規律(L219-225)

| 行 | 現行 | 改修後 |
| --- | --- | --- |
| L221 | 1〜2 問の差で description や実装を疑わない | 変えない |
| L222 | 過去の測定と比べるときは `environment` の一致を確かめる | 変えない。項目 2 で `run-loop` にも `environment` が載る |
| L223 | 有効なプラグインやユーザースキルが変わった後の値を、変わる前の値と比べない | **書き換える。** 項目 1 で前提が消える。残るのは CLI の版・組み込みスキル・モデルの解決先であり、これらが変わった後の値を前の値と比べない、とする |
| L224 | 全問が発火 0 で返ったときはタイムアウトを疑う | 変えない。タイムアウトを `error` に回さない判断(§3.4)と整合する |
| L225 | 公式 `skill-creator` の `run_eval.py` / `run_loop.py` は使わない | 変えない |
| — | (無い) | **足す。** `errors` が 0 でない測定の結果は比較に使わない。原因を直して測り直す |
| — | (無い) | **足す。** `environment` は文字列として比べる。`sonnet` と `claude-sonnet-5` を同じものとして扱わない(§4.1) |
| — | (無い) | **足す。** `--model` は毎回同じ書き方で渡す |
| — | (無い) | **足す。** 既定モデルを変えた後、eval の問を差し替えた後は、それ以前の値を捨ててベースラインを取り直す |

「測定は隔離した一時環境で行う」は本文に書かない。測定器の実装が担保するものであり、スキルを使う側の動きを変えない(移植設計 §8.1 の判断を踏襲する)。

### 10.4 改善ループの実行(L62-85)

- L65-72 のコマンド例から `--model "<model-id>"` を必須の並びから外す。
- 既定を上書きしたいときだけ `--model` を渡す、という 1 行を足す。
- `--help` で一覧と既定値を出せる、という 1 行を足す。

### 10.5 `plugins/prompt-smith/README.md`(L17-22)

| 行 | 変更 |
| --- | --- |
| L19(`run-trigger-eval`) | 任意の並びに `--help` を足す。`--model` の既定が `sonnet` であることを書く |
| L20(`improve-description`) | `--model` を**必須から任意へ移す**。`--help` を足す |
| L21(`run-loop`) | `--model` を**必須から任意へ移す**。`--help` を足す |

`--model` を省略したときの既定を 1 箇所にまとめて書き、3 行に繰り返さない。

### 10.6 ルート `README.md`

§prompt-smith(L123-126)に、発火測定が隔離した一時環境で走ることを 1 文で足す。L60 の一覧表(状態: 開発中)は変えない。

### 10.7 `.serena/memories/agent_policy/core.md`(L426-429)

| bundle | 追随内容 |
| --- | --- |
| `run-trigger-eval.mjs` | 一時 sandbox に加えて `--setting-sources project` ほかのフラグで設定の読み込み元を絞ること、起動失敗を発火 0 と区別すること |
| `improve-description.mjs` | 「shortens >1024 chars」を「最良 description の **UTF-8 バイト数**を予算として超過分を書き直す」へ |
| `run-loop.mjs` | 出力に `environment` が載ること、打ち切り条件が train 全問合格または holdout 満点であること |

Serena の `write_memory` / `edit_memory` で変更する(保護パス)。

### 10.8 「競争に勝った率」という定義の追随先

この句は公式由来ではない。**2026-08-09 の移植設計 §4.1 が、cwd を隔離してもなお切れない残差に付けた操作的定義である**(§1.5)。項目 1 で `--setting-sources project` を足すと、この定義の前提(ユーザースキルとプラグインが同席する)が消える。

リポジトリ内の記述を、性質で 2 つに分けて扱う。

| 性質 | 所在 | 隔離後 | 扱い |
| --- | --- | --- | --- |
| **残差の定義そのもの** | `harness-docs/design/2026-08-09-…-port-design.md` L235 | 前提が消える | **据え置く**(下記) |
| 同上 | `plugins/prompt-smith/docs/skill-creator-port-rationale.md` L46 | 前提が消える | **追随させる** |
| 同上(規律) | `skills/skill-creator/SKILL.md` L223 | 前提が消える | **追随させる**(§10.3) |
| 上流の欠陥の説明(`find_project_root()` が実リポジトリを cwd にするため手元のカタログとの競争になる) | 2026-08-09 設計書 L13 / L49 / L491、`skill-creator-port-rationale.md` L22、`harness-docs/plans/2026-08-09-…-implementation.md` L2629、`harness-docs/handover/2026-08-10-….md` L65 | **隔離後も真** | **変更しない** |

**設計書・実装計画書・handover を据え置く根拠。** これらはその時点の判断と経緯の記録であり、修正履歴を持つ文書形式である。遡って書き換えると、なぜ隔離を足したのかという経緯そのものが消える。上書きの事実は本設計書 §1.5 と §17 が持つ。

**`skill-creator-port-rationale.md` を追随させる根拠。** これは現役の根拠文書であり(規約「プラグインの設計・背景・根拠・経緯・不採用案は `plugins/<plugin>/docs/`」)、読み手は移植版の現在の測定観を知るために読む。ただし経緯の文書でもあるため、L46 を削除せず、**2026-09-17 の隔離までの定義として時点を付けて残し、隔離後の定義を足す。**

`plugins/prompt-smith/NOTICE` にはこの句も英語の同義表現も無い。L38-40 は cwd が一時ディレクトリであることを述べた変更点 3 であり、記述自体は隔離後も真である。隔離フラグ 4 種を足すための更新は §11.1 で別途扱う。

---

## 11. 変更ファイル一覧

| ファイル | 変更 | 項目 |
| --- | --- | --- |
| `plugins/prompt-smith/src/lib/defaults.ts` | **新規**。`DEFAULT_MODEL` / 数値既定 / `LENGTH_TARGET` / `LENGTH_FLOOR` | 4・5・7a |
| `plugins/prompt-smith/src/lib/cli-help.ts` | **新規**。`HelpSpec` と `renderHelp` | 5 |
| `plugins/prompt-smith/src/lib/sandbox.ts` | `createIsolatedWorkspace` の新設、祖先 `.claude` の検出、`createSandbox` の載せ替え。**`Sandbox` 型は変えない** | 1 |
| `plugins/prompt-smith/src/lib/claude-cli.ts` | `ISOLATION_ARGS`(5 要素)/ `buildSpawnOptions` / `buildEvalArgs` / `buildTextArgs` / `killThenSettle` の追加、`callClaudeText` の cwd 隔離・close 待ち・DI | 1 |
| `plugins/prompt-smith/src/lib/stream-parse.ts` | `readResultError` の追加。**`TriggerDetector` と `judge` は変えない** | 1 |
| `plugins/prompt-smith/src/lib/parse-skill-md.ts` | **ブロックスカラーの継続で空行を読み飛ばす**(`replaceDescription` に合わせる)。`agent-creator` の description が第 1 段落で切れる欠陥を直す(§13.2) | 7a |
| `plugins/prompt-smith/src/lib/types.ts` | `EvalResultItem.errors` / `EvalResult.errors` / `LoopResult.environment` の追加、`RunLoopOptions.model?` への変更 | 1・2・3 |
| `plugins/prompt-smith/src/run-trigger-eval.ts` | `runSingleQuery` のオプション化と 3 値化、`aggregateOutcomes` / `assertMeasurable` の分離、`--help`、`--model` の既定 | 1・4・5 |
| `plugins/prompt-smith/src/run-loop.ts` | `environment` の記録、打ち切り条件の OR 化、train 空の guard、`measurement_failed`、予算の算出、`--model` の必須解除と既定、`--help` | 2・3・4・5・6・7a |
| `plugins/prompt-smith/src/improve-description.ts` | `budget` の導入、長さ指示の差し替え、短縮閾値、`--model` の必須解除と既定、`--help` | 4・5・7a |
| `plugins/prompt-smith/src/generate-report.ts` | **変更しない** | — |
| `plugins/prompt-smith/src/__test__/claude-cli.test.ts` | 拡張 | 1 |
| `plugins/prompt-smith/src/__test__/sandbox.test.ts` | 拡張(L184-199 は変えない) | 1 |
| `plugins/prompt-smith/src/__test__/stream-parse.test.ts` | 拡張(`readResultError`。既存ケースは変えない) | 1 |
| `plugins/prompt-smith/src/__test__/parse-skill-md.test.ts` | 拡張(**空行を含むブロックスカラー**。既存ケースは変えない) | 7a |
| `plugins/prompt-smith/src/__test__/run-trigger-eval.test.ts` | **新規** | 1 |
| `plugins/prompt-smith/src/__test__/helpers/fake-child-process.ts` | **新規** | 1 |
| `plugins/prompt-smith/src/__test__/cli-help.test.ts` | **新規** | 5 |
| `plugins/prompt-smith/src/__test__/run-loop.test.ts` | 拡張(Case A / B / train 空 / `environment` / `measurement_failed` / 予算)。`selectBest` の 3 ケースは変えない | 2・6・7a |
| `plugins/prompt-smith/src/__test__/improve-description.test.ts` | L74-85 の置き換えと追加 | 7a |
| `plugins/prompt-smith/src/__test__/bundle-cli-smoke.test.ts` | `--help` のケース追加 | 5 |
| `plugins/prompt-smith/src/__test__/generate-report.test.ts` | fixture に `environment` と `errors` を追加 | 1・2 |
| `plugins/prompt-smith/src/__test__/run-trigger-eval-options.test.ts` | 変更しない | — |
| `plugins/prompt-smith/scripts/*.mjs` | `pnpm run build` の生成物。**同じコミットに差分を入れる** | 全体 |
| `plugins/prompt-smith/skills/skill-creator/SKILL.md` | L55 / L62-85 / L131-139 / L141-162 / L185 / L219-225 | 7b・8a + 追随 |
| `plugins/prompt-smith/skills/skill-creator/assets/eval-review.html` | 基準一覧の表示を追加 | 8a |
| `plugins/prompt-smith/evals/prompt-smith.json` / `skill-creator.json` / `agent-creator.json` | true 問を各 4 問差し替え(基準 5 が 2 問、基準 6 が 2 問)。false 10 問は触らない | 8b |
| `plugins/metatron/evals/capturing-architecture.json` / `updating-architecture.json` / `recording-gotchas.json` | 同上。**基準 2・3 は §8 の実験で適用済みなので触らない**(§9.3) | 8b |
| `plugins/metatron/.claude-plugin/plugin.json` | `0.3.5-dev` → `0.3.6-dev`(eval の差し替えのみなのでパッチ) | 8b |
| `plugins/metatron/package.json` | 同上。**`plugin.json` と揃える** | 8b |
| `plugins/prompt-smith/docs/skill-creator-port-rationale.md` | L46 の「競争に勝った率」に時点を付け、隔離後の定義を足す(§10.8) | 1 |
| `plugins/prompt-smith/references/description-guide.md` | **変更しない**(§10.2) | — |
| `harness-docs/design/2026-08-09-…-port-design.md` / `harness-docs/plans/2026-08-09-…` / `harness-docs/handover/2026-08-10-…` | **変更しない**(記録。§10.8) | — |
| `plugins/prompt-smith/README.md` | L17-22 の CLI 引数表 | 3・4・5 |
| `plugins/prompt-smith/NOTICE` | 変更点の追記 | 1・6・7a・8a |
| `plugins/prompt-smith/.claude-plugin/plugin.json` | `0.3.5-dev` → `0.4.0-dev` | 全体 |
| `plugins/prompt-smith/package.json` | `0.3.5-dev` → `0.4.0-dev` | 全体 |
| `README.md`(ルート) | §prompt-smith に 1 文 | 全体 |
| `.serena/memories/agent_policy/core.md` | L426-429 | 全体 |
| `plugins/prompt-smith/build.ts` | **変更しない**(エントリは 4 本のまま) | — |

### 11.1 ライセンス上の追随

移植部分は Apache-2.0 であり、§4(b) は「変更したファイルに変更した旨の目立つ通知を付す」を求める。各ソース冒頭の「Changes:」コメントと `NOTICE` の変更点一覧に、次を足す。

| 追加する項目 | 対象 |
| --- | --- |
| 子プロセスを、専用の一時 cwd と `--setting-sources project` / `--strict-mcp-config` / `--settings '{"disableAllHooks":true}'` / `--no-session-persistence` で起動する。**上流は cwd も設定の読み込み元も絞らない** | `run_eval.py` → `run-trigger-eval.ts` / `improve_description.py` → `improve-description.ts` |
| 起動失敗を発火なしと区別して `errors` に記録する。**`result` イベントの `is_error` を見る(上流は `result` を無条件に「発火なし」とする)。** 1 問でも全実行が失敗したら結果を返さず失敗させる | 同上 + `stream-parse.ts` |
| 一時ディレクトリの削除を、子プロセスの `close` を待ってから行う | 同上 |
| 打ち切り条件に「holdout が全問合格」を加える。上流は train の全問合格だけを見る | `run_loop.py` → `run-loop.ts` |
| holdout により train が空になる構成を拒否する | 同上 |
| 結果 JSON に `environment` を記録する | 同上 |
| 長さの指示を、最良 description の **UTF-8 バイト数**を予算とする方式へ差し替える。上流の「100-200 words / 1024 characters」は使わない | `improve_description.py` → `improve-description.ts` |
| **ブロックスカラーの description で空行を読み飛ばす。** 上流は字下げのない行で継続を打ち切るため、空行を含む description が第 1 段落で切れる。**`utils.py -> parse-skill-md.ts: No behavioural changes` の記述を改める** | `utils.py` → `parse-skill-md.ts` |
| **`assets/eval_review.html` の「No behavioural changes」を改める。** eval セットの作成基準を静的に表示する | `assets/eval_review.html` → `assets/eval-review.html` |

`banner.js`(`build.ts`)は変更しない。`NOTICE` を指す文言が既に入っている。

---

## 12. テスト方針

`.claude/rules/metatron/testing-policy.md` に従う。vitest。テストは対象ソースと同じ `__test__/` に置き、ファイル名は `<対象ファイル名>.test.ts`。複数のテストから使うヘルパーは `__test__/helpers/` に置き `.test.ts` を付けない。E2E は持たず、`claude` の実起動はテストしない。

### 12.1 DI と純関数の方針

既存 11 本に `vi.mock` は 1 つも無い。子プロセスの遮断は 2 つの optional 引数(`runLoop({ runEval, improveDescription })` と `improveDescription({ callClaude })`)で実現している。**この流儀を崩さない。**

`runEval` は `runSingleQuery` を直接呼び、DI を転送しない。`RunEvalOptions` を広げない方針と合わせると、`runEval` 経由では起動失敗の扱いを固定できない。**そこで、DI で届かない層は純関数へ切り出して固定する。**

| 層 | 固定の手段 |
| --- | --- |
| **隔離フラグ 5 要素** | `buildEvalArgs` / `buildTextArgs`(純関数)。**新方式では隔離の実体が argv にあるので、ここが主戦場である** |
| `spawn` の `cwd` | `buildSpawnOptions`(純関数) |
| `spawn` の `stdio` | `callClaudeText` / `runSingleQuery` の DI テスト(呼び出し側で組まれるため) |
| **`result` イベントの `is_error`** | `readResultError`(純関数)。`subtype` に依存しないことを明示的に固定する |
| kill と `close` の順序 | `killThenSettle`(純関数 + fake child) |
| 起動失敗の集計 | `aggregateOutcomes` / `assertMeasurable`(純関数) |
| ループの打ち切り・予算 | `runLoop({ runEval, improveDescription })`(既存 DI) |

`RunEvalOptions` / `RunLoopOptions` には DI を足さない。ループ側から見える型を、テストのためだけに広げない。

### 12.2 既存テストへの影響

| ファイル | 壊れる理由 | 対応 |
| --- | --- | --- |
| `bundle-cli-smoke.test.ts` | `scripts/` を再生成しないと `--help` のケースが落ちる。既存 3 ケースは必須チェックの削除では壊れない(§6.2) | `pnpm run build` を先に実行し、ケースを追加する |
| `improve-description.test.ts` L74-85 | `"1024 characters"` / `"100-200 words"` を assert している | §8.6 へ置き換える |
| `generate-report.test.ts` L4-15 | `LoopResult` が `environment` を要求する。result item が `errors` を要求する | fixture に足す |
| `run-loop.test.ts` L76-92 ほか | `allPass` / `failing` / `mixed` が組み立てる result item が `errors` を要求する | fixture に `errors: 0` を足す |
| `run-loop.test.ts` L94-111 | 全問合格(Case C)。**OR でも第 1 guard で `all_passed` になり通る。ただしこのケースは Case A を検出しない** | 変更しない。Case A を新規ケースで足す |
| `run-loop.test.ts` L30-45 | `selectBest` の 3 ケース | **変更しない。** 変更が必要になったら確定事項に反した合図 |
| `claude-cli.test.ts` L4-10 | `buildEnv` のシグネチャを変えないので通る | 追加のみ |
| `sandbox.test.ts` L184-199 | 祖先 `.claude` の不在を確かめる。§3.7 の guard と同じ前提 | 変更しない |
| `stream-parse.test.ts` | `judge` と `TriggerDetector` のみ。`readResultError` は新規なので既存ケースは壊れない | 追加のみ |
| `run-trigger-eval-options.test.ts` | `parseEvalSet` / `parseNumericOption` のみ | 変更しない |

---

## 13. 測定計画(段 5)

### 13.1 なぜ短縮の優位を測り直すか

項目 7 の根拠(188〜223 字で 20/20、302〜460 字で 13〜15/20)は、**隔離前の環境で metatron の 3 スキルを対象に取った値**である。そこではユーザースキルとプラグインが同席しており、点数には「常駐スキル群との競争に勝ったか」が混ざっていた(§10.8 の残差)。項目 1 でその競争相手が消える。**短くしなくても点が上がりうる。**

これは「競争条件を変えたので別物になる」という話ではない。§1.5 のとおり、公式の測定はもともと競争を測る設計ではなく、後発の `claude plugin eval` は隔離を明示している。**隔離後の値の方が、測ろうとしていたもの(description 単独の発火のしやすさ)に近い。** したがって段 5 は、条件を変えた再測定ではなく、**公式の意図に沿った条件での最適値の取り直し**である。

**隔離と同時に、母数の定義も変わる。** `readResultError` により、完走してエラー終了した実行が `runs` から外れる(§3.4)。**隔離直後のベースラインには、競争相手の消失と母数変更の 2 つが同時に入る。** どちらがどれだけ効いたかは分離できない。段 5 より前の値と比べられない理由が 2 つあることを、測定の記録に残す。

規律(7b)と定数(`LENGTH_TARGET` / `LENGTH_FLOOR`)は、混ざった値に依存したままである。取り直さずに固定できない。

### 13.2 対象 6 スキルの現状値(2026-09-17 実測)

| スキル | 文字数 | バイト数 | 英語 words 換算 | 帯 |
| --- | ---: | ---: | ---: | --- |
| `prompt-smith` | 694 | **1612** | 260 | **超過**(公式上限 200 words 超) |
| `agent-creator` | 550 | **1154** | 186 | **上限付近** |
| `skill-creator` | 224 | 518 | 84 | 最適 |
| `capturing-architecture` | 211 | 587 | 95 | 最適 |
| `updating-architecture` | 223 | 589 | 95 | 最適 |
| `recording-gotchas` | 188 | 504 | 81 | 最適 |

**6 スキル中 4 つは既に最適帯にある。** metatron の 3 本と `skill-creator` で、バックログ §7 の短縮がファイルに入っているためである。

**長いのは `prompt-smith` と `agent-creator` の 2 つだけで、ここが項目 7 の主な改善対象になる。**

**規律を定めるスキル自身が、6 つの中で最も規律から外れている。** `prompt-smith` は description の書き方を担当するスキルでありながら 1612 バイト(目安の 2.7 倍)を持つ。段 5 で最大の改善余地があるのもここである。

#### `agent-creator` は現状のツールで正しく読めない

`agent-creator` の description は**空行を含むブロックスカラー**である。ここで 2 つの実装が食い違う。

| 関数 | 空行の扱い | `agent-creator` で得られる値 |
| --- | --- | --- |
| `parse-skill-md.ts` `parseSkillMd` L67-73 | 字下げのない行で継続を打ち切る。**空行で止まる** | **101 字 / 175 バイト**(第 1 段落だけ) |
| `sandbox.ts` `replaceDescription` L107-122 | 空行を明示的に読み飛ばし、ブロックの一部として扱う | 550 字 / 1154 バイト(全体) |

`run-trigger-eval` の `main` は `parseSkillMd` で description を取り、それを `runEval` へ渡す。**したがって現状のまま `agent-creator` を測ると、ファイルにある 1154 バイトではなく、切り詰められた 175 バイトを測ることになる。** `run-loop` の `originalDescription` と `budget` も同じ値から計算される。

**`parseSkillMd` を `replaceDescription` に合わせて直す。** 空行をブロックの一部として読み飛ばす。3 行の変更で、空行を含まない description(他の 5 本)では挙動が変わらない。

- これは `utils.py` からの挙動変更になる。`NOTICE` の「utils.py -> parse-skill-md.ts: No behavioural changes」を改める(§11.1)。
- テストに、空行を含むブロックスカラーのケースを足す(§11)。
- **この修正は §13.3 の「長い 2 スキル」の比較の前提である。** 直さないと `agent-creator` の比較が 175 バイト対 600 バイトになり、短縮の測定として成立しない。

### 13.3 測定の構成

**第 5 版の計画は前提が崩れていた。** 「metatron 3 スキルで現行と 600 バイト案を比べる」としていたが、**metatron の現行は既に 504〜589 バイトで最適帯にある**(§13.2)。同じものを比べることになる。

**2 種類の比較を行う。**

| # | 比較 | 対象 | 目的 |
| --- | --- | --- | --- |
| A | **短縮前**(復元)vs **現行**(短い) | metatron 3 スキル | バックログ §7 の実験を、**隔離後・Sonnet で再現する** |
| B | **現行**(長い)vs **600 バイト案** | `prompt-smith` / `agent-creator` | **実際に改善余地のある対象で測る。** この測定はそのまま項目 7 の成果になる |

| 群 | 内容 | 本数 | spawn |
| --- | --- | ---: | ---: |
| ベースライン | 6 スキル × 差し替え後の eval 20 問 × 3 回 | 6 | 360 |
| 比較 A | metatron 3 スキル × 20 問 × 3 回 × 2 案 | 6 | 360 |
| 比較 B | 長い 2 スキル × 20 問 × 3 回 × 2 案 | 4 | 240 |
| **衝突観測** | `agent-creator` の改善ループを `--max-iterations 3` で 1 回 | 1 | **最大 180** |
| 合計 | | **17** | **最大 1140** |

**衝突観測は測定計画の一部である。** §13.5 が定めた「基準 6 と項目 7 の予算の衝突が実在するか」を見るには、改善ループを実際に回して**各反復の案のバイト数と基準 6 の 2 問の合否を並べる**必要がある。ベースラインや比較 A / B は単発の発火測定なので、この観測は取れない。

- 対象を `agent-creator` にするのは、**長い 2 スキルのうち予算が実際に縮む余地があり、かつ `prompt-smith` より短いぶん反復あたりの変化を読みやすい**ためである。
- 180 回は**上限**である。`all_passed` または `holdout_maxed` に達すれば早期に打ち切られる(§7.3)。
- 改善案生成の text 呼び出し(反復あたり 1〜2 回)は、発火測定の 60 回に対して桁が違うので本数に数えない。
- **この観測が §16 未解決 #2((d) 反復ごと 2 案へ進むか)の判断材料になる。** 案のバイト数が予算の近傍に張り付くかどうかを、ここで初めて実データで見られる(§8.2)。

条件: 隔離環境、`--model sonnet`、`--runs-per-query 3`、差し替え後の eval セット。`environment` が全測定で一致することを確かめる。

#### 比較 A の復元元(確認済み)

**短縮前の description は git から完全に復元できる。** コミット `5325f6f`(`fix(metatron): 3 スキルの description を短縮し発火率を改善する`)がその変更であり、**その親 `5325f6f^` に短縮前の値がある。**

| スキル | 短縮前(`5325f6f^`) | 現行 | バックログ §7 の記録と一致するか |
| --- | --- | --- | --- |
| `capturing-architecture` | 460 字 / **1034 バイト** | 211 字 / 587 バイト | 一致(460 字 → 211 字) |
| `updating-architecture` | 302 字 / **766 バイト** | 223 字 / 589 バイト | 一致(302 字 → 223 字) |
| `recording-gotchas` | 448 字 / **1120 バイト** | 188 字 / 504 バイト | 一致(448 字 → 188 字) |

**バックログが記録した字数と、git から取り出した実物の字数が完全に一致する。** 復元元の同定に曖昧さはない。`--description` オプションで短縮前の値を渡して測れるので、ファイルを書き戻す必要もない。

**`updating-architecture` の短縮前は 766 バイトで、落ちる帯の下端にあたる。** これが 13/20 だったという事実は、**600 バイトの目安と落ちる帯の距離が思ったより近い**ことを示す(§8.1)。比較 A で最も差が出にくいのはこのスキルである。

#### 比較 B の案の作り方

`prompt-smith`(1612 バイト)と `agent-creator`(1154 バイト)を 600 バイト前後へ縮めた案を作る。**2 スキル分を一括で作る。** 判定を 2 スキル合計 40 問で行うため、案の作り方が揃っていないと「方針の比較」にならない。

**比較 B は `parseSkillMd` の修正が前提である**(§13.2)。直す前に測ると `agent-creator` の現行側が 175 バイトになる。

#### 共通の注意

**どちらの比較も、現行側をベースラインと重複して測り直す。** `skill-creator` は「連続測定では先に走った方が高く出る傾向がある」を記録している。2 案の比較は同一バッチで測らないと、順序のバイアスと案の差が混ざる。

**相互干渉の相殺のためではない。** 2026-08-02 設計書 §4.3 は「1 つだけ替えると他スキルの問を奪う・譲る動きが起きる」として一括を求めたが、あれは 3 スキルが同席する前提だった。**隔離後はサンドボックスに 1 本しか置かれないため、この干渉は起きない**(§9.4.4)。一括にする理由は入れ替わっている。

測定中は他作業を行わない。同一マシンで `claude -p` を最大 1140 回走らせるため、並行作業がレート制限と測定条件に影響する。**§3.6 のとおり、同じホームを使う他プロセスの書き込みも測定中は避ける。**

### 13.4 判定と分岐

比較の単位は 1 案あたり、**比較 A が 60 問**(3 スキル × 20 問)、**比較 B が 40 問**(2 スキル × 20 問)。

各比較の判定はいずれも次で行う。閾値 3 問の根拠は、SKILL.md L221 の既存規律「1〜2 問の差で description や実装を疑わない」である。この規律を下回る差で規律を書き換えない。**比較 B は問数が少ないぶん分解能が低い**ことを、判定の記録に添える。

| 各比較の結果 | 読み |
| --- | --- |
| 短い側が 3 問以上優位 | **短縮が効く** |
| 差が 1〜2 問 | **判定できない** |
| 長い側が 3 問以上優位 | **短縮が効かない** |

#### 2 つの比較を突き合わせる

**両方が「短縮が効く」を示したときだけ、規律を確定させる。**

| 比較 A(再現) | 比較 B(新規) | 判定 | 項目 7b の扱い |
| --- | --- | --- | --- |
| 効く | 効く | **確定** | §10.1 のとおり改稿する。`LENGTH_TARGET` / `LENGTH_FLOOR` を据え置く |
| 効く | 効かない / 判定不能 | **限定付き** | 効果が metatron の担当重複という条件に依存する疑いがある。規律は「測って決める」を主にし、600 バイトは弱い目安として書く。`LENGTH_FLOOR` は据え置く(実測の落ちる帯より下にあるため害がない) |
| 効かない / 判定不能 | 効く | **新しい実測を採る** | 隔離と母数変更(§13.1)で元の実測の前提が変わったと読む。**比較 B の対象の方が実運用に近い**(実際に長い description)。§10.1 のとおり改稿し、比較 A が再現しなかった事実を `docs/` に残す |
| 効かない | 効かない | **反転** | §10.1 の改稿を撤回する。L135 の反転だけを行い(発火率を優先する、は実測に反しない)、600 バイトの目安は書かない。`LENGTH_TARGET` / `LENGTH_FLOOR` を測定値に合わせて取り直す |
| 判定不能 | 判定不能 | **保留** | 規律を変えない。L135 の反転だけ行う。定数は暫定のまま §16 へ戻す |

**両方を求める根拠。** 2 つの比較は別の失敗モードを潰している。

- **比較 A だけで確定させると、元のデータへの過学習を見逃す。** 短縮が効いたのは metatron の 3 スキルという特定の対象・特定の担当重複においてだけかもしれない。
- **比較 B だけで確定させると、元の実測との食い違いを説明しないまま規律を立てることになる。** バックログ §7 はこのリポジトリの一次資料であり、再現しなかったのなら理由を記録する義務がある。

片方だけが示したときに「保留」で止めないのは、**規律を決めないまま項目 7a を出荷することになるため**である。上の表は、どちらが示したかで採る方針を変える形にしてある。

**項目 7a(予算という仕組み)はどの分岐でも撤回しない。** 予算は「最良を超えない」という相対的な上限であり、最適な絶対字数が何であっても、青天井の膨張を止める働きは変わらない。撤回されうるのは定数の値と 7b の文面だけである(§2 で 7a / 7b を分けた理由)。

### 13.5 基準 6 の判別力と、項目 7 との衝突の観測

段 5 の測定に、通常の合計スコアとは別の観測を 2 つ組み込む。どちらも eval スキーマを変えずに行える。

| 観測 | 方法 | 読み方 |
| --- | --- | --- |
| 基準 6 の判別力 | **12 問(6 スキル × 2 問)**の合否を `results[]` から手で拾う。うち **10 問は 2 案比較ができる**(比較 A の metatron 6 問、比較 B の `prompt-smith` / `agent-creator` 4 問)。`skill-creator` の 2 問はベースライン 1 点のみ(§9.4.5 の手順 1-3) | **両案とも 3/3 で通る問は判別力が無い**ので差し替える。どちらかで落ちるなら、境界の明示度を測れている。1 点しか無い 2 問は合否のみを記録する |
| 項目 7 との衝突 | 改善ループを 1 スキルで 1 回回し、各反復の案の字数と、基準 6 の 2 問の合否を並べる | **基準 6 が落ち続け、かつ案が予算の上限に張り付く**なら衝突が実在する。案が短くなりながら基準 6 が通るなら、バックログ §7 の観測(境界は短くすると解ける)が true 側でも成り立っている |

衝突が実在したときにだけ、§9.4.3 で退けた (b)(eval スキーマへ種別を持たせ、改善プロンプトへ区別して渡す)を検討する。**観測の前に足さない。** スキーマ変更は `parseEvalSet` の契約と 3 本の eval セット、`eval-review.html` の表示に波及する。

---

## 14. 検証方法と Done の条件

| 項目 | 方法 | 合格条件 |
| --- | --- | --- |
| 全体 | `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` | 通る |
| 全体 | `pnpm run build` | `plugins/prompt-smith/scripts/` の差分が同じコミットに入る |
| 項目 1 | §3.9 の実機確認 7 手順 | すべて合格。とくに手順 2(`init.skills` が減る)と手順 5(`git status --porcelain=v1` の前後完全一致) |
| 項目 1 | `TMPDIR` をリポジトリ配下に設定して起動 | 祖先 `.claude` を検出して throw する |
| 項目 1 | `is_error: true` かつ `subtype: "success"` の `result` 行を与える単体テスト | `error` に分類される。**`not_triggered` にならない** |
| 項目 1 | **`runEval` の結合テスト**(`runSingleQuery` を第 2 引数で差し替え) | `triggered` / `not_triggered` / `error` の混在で `triggers` / `runs` / `errors` が期待どおり。**truthy 集計バグが入れば落ちる**(§3.4) |
| 項目 1 | `sandbox.test.ts` を単体で実行 | 既存 L184-199 と、新規の「`TMPDIR` を偽装して throw」が**同一プロセスで両方通る**(§3.7 の条件 3) |
| 項目 2 | `run-loop` の `results.json` | `environment` が `run-trigger-eval` と同じ 3 キーで載る。トークンの値が入っていない |
| 項目 3・4 | 3 エントリを `--model` 無しで起動。加えて `runLoop` / `runEval` / `improveDescription` を `model` 無しで直接呼ぶ単体テスト | いずれも `sonnet` に解決される。`environment.model` が `null` にならない |
| 項目 5 | 3 エントリに `--help` | 終了コード 0、stdout に一覧と既定値、stderr が空 |
| 項目 6 | Case A / B / C / D と train 空の 5 ケース | Case A で停止、Case B で `holdout_maxed` 停止、いずれも `best_description` が現行実装と一致する |
| 項目 7a | §8.6 のテスト | 予算が `selectBest` の結果に紐づく。床が効く。`${" "}` が残る |
| 項目 7a | **単位がバイト数であること** | 日本語 300 字と英語 900 字の description が同じ `budget` を得る。`String.length` で長さを測る箇所が `src/` に残っていない |
| 項目 7a | `parseSkillMd` に空行を含むブロックスカラーを与える | 全段落が連結される。`agent-creator` の実ファイルで 1154 バイトが得られる(修正前は 175 バイト) |
| 項目 7b | §13.4 の分岐 | 測定結果に応じた改稿が済んでいる |
| 項目 8a | `prompt-smith:prompt-smith` による自己評価 | 冗長度・充足度・スタイル適合の 3 軸。既存 11 項目と重複せず、適用条件が書かれている。基準 6 が負例 2 行と平行な構文で隣接して置かれている |
| 項目 8b | 差し替え後の **6 本** | 各 20 問、true 10 / false 10。差し替えた **24 問**が基準 4・5・6 と L160 を満たす。基準 6 の 2 問が内部境界 1 問・外部 1 問に分かれている |
| 項目 8b | metatron の 3 本 | **基準 2・3 の既存 3 問(提案への回答)が据え置かれている**(§9.3) |
| 項目 8b | 段 5 の §13.5 の観測 | 基準 6 の **12 問**のうち、両案とも 3/3 で通る問が無い(あれば差し替える) |
| バージョン | `plugins/prompt-smith` の `plugin.json` と `package.json` | ともに `0.4.0-dev`。**段 1 の時点で上がっている** |
| バージョン | `plugins/metatron` の `plugin.json` と `package.json` | ともに `0.3.6-dev` |
| 追随 | ルート `README.md` / `.serena/memories/` / `NOTICE` | §10・§11.1 のすべてが済んでいる |

---

## 15. リスクと制約

| リスク | 影響 | 対処 |
| --- | --- | --- |
| **権限ルールの消失と、検出器の第 1 ツール打ち切りの合成** | **全問が不発火になりうる。** `TriggerDetector` は Skill 以外の `tool_use` 開始で即 `false` を返す(L63-69)。user ソースを切ると allow ルールが消えて deny が増え、空のサンドボックスでは LS / Bash / Read が先に出る可能性がある。そうなると **description 以前の理由で全問が落ちる** | **§3.9 手順 4 の陽性対照が唯一の検出口である。** 曖昧さのない description が発火しないときは、隔離ではなくツール選択を疑う。段 5 の最初の 1 本で `--verbose` の PASS/FAIL 分布を見る |
| **`-p` は validation に失敗した settings を黙って無視する**(CLI help の記述) | `--settings '{"disableAllHooks":true}'` が argv の扱いで壊れると、**hooks の二重化が静かに死ぬ。** エラーは出ない | §3.9 手順 5(`git status --porcelain=v1` の前後一致)が実質の検出口になる。hooks が生きていれば `docs/chat/` への書き込みが再発する |
| **`--bare` が切って新フラグが切らない層がある** | help 原文が挙げるのは LSP / plugin sync / attribution / **auto-memory** / background prefetches である。改善経路の実害は SessionStart hook だったが、**auto-memory は同等に応答を汚染しうる。** 組み込みスキル 17 件も改善経路に残る | `--bare` は測定経路では使えない(model-invoked が消える)。改善経路だけ `--bare` にすると 2 経路の条件が食い違う。§3.9 手順 3(`<probe>OK</probe>` が返る)で汚染の有無を見る |
| **`--setting-sources` が全環境・全 CLI バージョンで同じ挙動をしない** | 隔離が静かに外れる、または測定対象まで消える | §3.9 手順 2(`init.skills` の件数が減る)と手順 4(陽性対照)が検出口になる。CLI を更新したらベースラインを取り直す |
| **エイリアス `sonnet` のコンテキスト長が 1M でない可能性** | 利用者の settings 既定は `sonnet[1m]` だが、`sonnet` の解決先は実測で `claude-sonnet-5` である。**改善プロンプトは SKILL.md 本文を丸ごと含むため、差は発火測定よりも improve の品質に出る** | 段 5 で `improve_iter_*.json` の往復を見て、打ち切りや劣化が出ていないかを確かめる。出るなら `--model` を明示指定に切り替える(§16 未解決 #18) |
| **実ホームへの書き込みを隔離しない** | `~/.claude.json` と `~/.claude/projects/` が更新される | 隔離の範囲外として受ける(§3.5.1 で手放した点)。実測で破損も残骸も出ていない。§3.9 手順 6 で壊れていないことを確かめる |
| **同じホームを使う他プロセスが独立して書き込む** | 測定と無関係な変化が混ざる。ロストアップデートの可能性を否定できない | 運用注意として「測定中に他の重い並行セッションを走らせない」を添える。§16 に残す |
| **`~/.claude/backups/` が増え続ける** | ディスクを圧迫する | CLI 自体の挙動であり止められない。定期的な確認を運用注意として書く |
| **60 spawn のフル eval が未検証** | 20 spawn では出なかった問題が出うる | 段 5 の最初の 1 本を観察付きで回し、`~/.claude.json` の健全性と `errors` を確かめる |
| 組織管理設定(`managed-settings.json`)は隔離できない | その環境の測定値が他と比較できない | 未検証。§3.6 に残す |
| kill 直後の削除でプロセスが生きたままディレクトリを消す | 後始末の競合 | `close` を待つ実装(`killThenSettle`)で回避する |
| `TMPDIR` がリポジトリ配下 | **`--setting-sources project` が project 層を生かしているため、リポジトリのスキルが読み込まれる** | §3.7 で検出して throw する |
| **短縮優位が隔離後に反転する** | 項目 7b の規律と定数の根拠が消える | §13.4 の分岐で扱う。7a は撤回しない |
| 予算の床が高すぎる / 低すぎる | 短縮が進まない、または必要な条件を足せない | `defaults.ts` の定数 1 箇所で変えられる。段 5 の実測で調整する |
| 既定モデルの変更と eval の差し替えで過去値がすべて無効になる | 比較の基準を失う | 段 5 で 1 度だけ測り直し、それ以前を破棄する |
| train が空になる構成を拒否する変更 | これまで黙って動いていた構成がエラーになる | 意図した挙動変更。`NOTICE` に記載する |
| `runSingleQuery` のシグネチャ変更 | 呼び出し元は `runEval` の 1 箇所のみ | 影響は閉じている |
| `EvalResultItem` の必須キー追加 | 複数の fixture が型検査で落ちる | §12.2 で列挙済み |
| `scripts/` の再生成忘れ | `bundle-cli-smoke.test.ts` が落ちる | 各段で `build` → `test` の順に実行する |
| `${" "}`(L167)の消失 | プロンプトが移植元と 1 文字ずれる | §8.6 のテストで固定する |

### 制約

- Anthropic API 不使用。`claude -p` に閉じる。
- `scripts/` と `dist/` は保護パス。`src/` を直して `pnpm run build` で再生成する。
- `.serena/memories/` は Serena の `write_memory` / `edit_memory` で変更する。
- 移植部分の各ファイル冒頭の著作権表示と「移植時の変更点」コメントを消さない。
- `selectBest`(L79-86)と `splitEvalSet` の seed 既定 42 を変えない。
- `stream-parse.ts` の**発火の判定ロジック**(発火率 0.5 / 第 1 ツールで打ち切り / 前方一致)を変えない。`readResultError` の追加は、発火の意味論に触れずに失敗の検出だけを足すものであり、この制約に反しない(§3.3)。
- `isDirectRun` のファイル名ディスパッチを変えない。
- eval セット JSON のスキーマ(`query` / `should_trigger` の 2 キー、20 問、true 10 / false 10)を変えない。
- `buildSandboxSkillMd` による `disable-model-invocation: false` の強制を変えない。
- 改善プロンプトは英文のままとする。

### 不採用案

| 案 | 不採用の理由 |
| --- | --- |
| 打ち切り条件を置換する(初版の案) | Case A で挙動が変わり、`best_description` が動きうる。train 失敗 0 のまま当てずっぽうの案を測る経路が開く(§7.2) |
| 打ち切り条件を `train_failed === 0 && test_failed === 0` にする | 同じ経路を通る。OR より止まりにくいだけで利点が無い |
| 打ち切った時点の反復を採用に固定する | train 満点だが holdout が前より悪い案を採る |
| `>` を `>=` にする / train をタイブレークに使う / 重み付き和 | **`selectBest` を変更しないという確定事項に反する** |
| `environment` に解決済みモデル名を記録する | `stream-parse.ts` の打ち切り経路へ手が入る。規律側で吸収したときの失敗は偽陰性であり、安全の向きが正しい(§4.1) |
| 既定モデルを `main` だけで当てる(初版の案) | ライブラリ経路で `undefined` が残り、測定が黙ってユーザー設定の opus 系に落ちる(§5.2) |
| 測定モデルと生成モデルを分ける(`--improve-model`) | 要件に無い。確定事項は 3 エントリとも `sonnet` である |
| `generate-report` に `environment` / `errors` を表示する | 要件に無い。JSON に載れば照合はできる |
| `--help` のために `parseArgs` を 2 度呼ぶ | 引数解析が 2 系統になる害の方が大きい |
| タイムアウトを `error` として扱う | 遅いモデル・重いクエリによる超過と、起動失敗とを混ぜることになる(§3.4) |
| `EvalSummary` に `errors` を足す | 改善経路の入力契約(`EvalScores`)と fixture が連鎖して壊れるわりに得るものがない |
| `description-guide.md` に長さの節を足す(2026-08-02 設計書 §4.4 の計画) | 3 制約はいずれも skill / コマンド定義に固有であり、2026-08-09 に狭めた guide の役割に合わない(§10.2) |
| `eval-review.html` に基準の自動判定を足す | 語彙の重なりや作業量は機械的に判定できない。静的表示にとどめる |
| 基準 2・3 を 3 スキルの eval へ適用する | 3 スキルとも主な経路が「明示依頼」であり、経路の合わない問を増やす |
| **空の `CLAUDE_CONFIG_DIR` で隔離する**(第 2・3 版の採用案) | **実測で成立していたが取り下げた。** 環境変数認証以外へ広げると認証情報の複製が要り、トークンのリフレッシュ・コピーの残存・配布物としての信頼要求という 3 つのリスクを負う。手放したのはホームへの書き込みの完全な隔離である(§3.5.1) |
| 過去の設計書・実装計画書・handover の「競争に勝った率」を書き換える | 記録であり、遡って書き換えると隔離を足した経緯が消える(§10.8) |
| サンドボックスへ競合スキルも配置し、本物の競争を測る | `createSandbox` の契約(対象 1 本)と `TriggerDetector` の前方一致の意味が変わり、**すべての過去・将来の測定値の意味が変わる**。要件の外。基準 6 のクエリ側代替で足りるかを段 5 で見てから判断する(§16 未解決 #12) |
| eval セット JSON へ種別を持たせ、基準 6 の失敗を改善プロンプトへ区別して渡す | スキーマを変えない制約に反する(§15 制約)。`parseEvalSet` の検証・3 本の eval・`eval-review.html` に波及する。衝突の実在を §13.5 で観測してから検討する(§9.4.3) |
| 基準 6 の 2 問とも 3 スキル相互の境界に充てる | eval が「このプラグイン内部の境界」だけを測る。外部の相手に対する境界が改善しない(§9.4.4) |
| 移植版 L161-162(false 側の near-miss)を公式の負例定義へ合わせて書き直す | 既に整合している。公式の負例も「対象スキルが発動してはいけない紛らわしい依頼」であり、他スキルの発火は見ていない(§9.1) |
| `--holdout` を下げて train が空になる構成を許容する | 誤った `all_passed` を返すより止める方がよい(§7.6) |
| holdout の問数を増やす / `--holdout` の既定を変える | eval の問数を増やさない、という確定事項に反する |

---

## 16. 未解決事項

context-map §7 の 10 件はすべて確定した。下表は本設計の作成とレビューを経て残った論点である。

| # | 事項 | 影響度 | 現状の仮定 |
| --- | --- | --- | --- |
| 1 | **`--setting-sources project` が settings 依存の認証を巻き込む** | **Medium**(第 3 版 High → 第 4 版初稿 Low → 再修正) | 環境変数認証と OAuth は実測で成立。**`apiKeyHelper` / `awsAuthRefresh` / settings の `env` に依存する環境では認証が通らない**(§3.6)。第 4 版初稿の「認証機構に触れないので影響を受けない」という一般化は取り下げた。Bedrock / Vertex は AWS / GCP 側の機構を使うが `awsAuthRefresh` 併用なら影響を受けうる(推論。未実測)。検証は従量課金のためユーザー判断で見送った(2026-09-17 時点)。**実害は「測定できない」であり `MeasurementFailedError` が止めるので誤った値は出ない。** 案内はエラーメッセージと README に載せる |
| 1b | `--setting-sources` が全環境・全 CLI バージョンで同じ挙動をするか | Low | 未検証。§3.9 手順 2 が検出口 |
| 2 | 段 5 の測定で案が縮まないとき、(d)(反復ごと 2 案)へ進むか | Medium | 進まない。`selectBest` を触らない確定事項と衝突する形でしか実装できない |
| 3 | `LENGTH_TARGET = 600` / `LENGTH_FLOOR = 680`(バイト)の値 | Medium | 隔離前の測定に由来する暫定値。§13.4 の分岐で確定する |
| 4 | 組織管理設定(`managed-settings.json` / managed skills)の層 | Medium | 未検証。除外できない前提で扱う |
| 5 | `improve-description` の生成モデルを `sonnet` にして改善案の質が落ちないか | Medium | 落ちない前提で進める。測定モデルを Sonnet にする根拠(欠陥が数値に現れる)は生成側には当たらない。段 5 の後、案の採用率が下がるなら再検討する |
| 6 | 隔離後も残る CLI 組み込みスキル 17 件との競合 | Low | 常駐する前提で測る。一覧を `environment` に記録する手段を確認していない |
| 7 | 差し替える true 問を 4 問(基準 5 が 2・基準 6 が 2)とした根拠が、metatron での実績 1 件と L221 の規律しかない | Low | 4 問で進める。段 5 のベースラインで欠陥が現れなければ問数を見直す |
| 8 | `when_to_use` を持つスキルの合算 1536 字を、測定器が検査しないままでよいか | Low | 検査しない。`parse-skill-md` が `when_to_use` を読まない構造であり、読ませると測定対象の組み立てにも波及する。規律としてのみ持つ |
| 9 | 基準 6 の採否 | — | **解決済み。** ユーザーが採用を決めた。位置づけは「隔離で失う競争耐性の測定をクエリ設計で代替する」(§9.4.1) |
| 10 | `anthropics/skills` #1298 / #1755 が未マージのままである | Low | 公式が隔離へ寄せるかは確定していない。本改修は `claude plugin eval` の明示(§1.5)を根拠にしており、PR の帰趨に依存しない |
| 11 | **基準 6 と項目 7 の予算が実際に衝突するか** | Medium | 衝突しない見込み(バックログ §7 は境界問題が短縮で解けたと記録している)。§13.5 で観測する。実在したときにだけ eval スキーマの拡張を検討する(§9.4.3) |
| 12 | 基準 6 のクエリ側代替が、環境側の競争の代わりとして足りるか | Medium | 足りる前提で進める。**相手側の要因(相手の description の方が魅力的で負ける)は原理的に測れない**(§9.4.1)。足りないと分かった場合の選択肢はサンドボックスへの競合配置だが、全測定の意味が変わるため要件の外に置いた |
| 13 | 基準 6 の 2 問目(組み込みスキル狙い)が落ちたとき、何が発火したかを機構として記録しないままでよいか | Low | 記録しない。`TriggerDetector` は最初のツール使用で打ち切り、一致しなければ false を返すだけである。切り分けは `claude -p` を直接叩く手作業とする(§9.4.5 手順 3) |
| 14 | **60 spawn のフル eval が未検証である** | Medium | 20 spawn(10 並列 × 2 バッチ)まで確認した。段 5 の最初の 1 本を観察付きで回し、`~/.claude.json` の健全性と `errors` を確かめてから残りへ進む |
| 15 | **測定中に観測された、他プロセスによる `~/.claude.json` の縮小(-2588 bytes / -88 行)** | Medium | 良性のプルーニングかロストアップデートかを判別できていない(中身を読まない制約による)。運用注意として「測定中に他の重い並行セッションを走らせない」を添えるにとどめる |
| 16 | `~/.claude/backups/` にローテーションが無い | Low | CLI 自体の挙動。13 分で 5 件。止める手段を持たないので、定期的な確認を運用注意として書く |
| 17 | `init.skills` の 8 件減が、`~/.claude/skills/` の 8 件と一対一で対応するか | Low | 件数の一致までは確認した。**出所の同定は未完である。** §3.9 手順 2 は件数の減少だけを合格条件にしている |
| 18 | **エイリアス `sonnet` のコンテキスト長が 1M かどうか** | Medium | 未確認。利用者の settings 既定は `sonnet[1m]` だが `sonnet` の解決先は `claude-sonnet-5` である。**改善プロンプトは SKILL.md 本文を丸ごと含むため、差は発火測定より improve の品質に出る。** 段 5 で `improve_iter_*.json` を見て、打ち切りや劣化が出たら `--model` の明示指定へ切り替える。**`run-loop` は `--log-dir` を持たず `logDir` が `--results-dir` からしか埋まらないので、この確認には `--results-dir` の指定が要る**(§16.1) |
| 19 | `skill-creator`(518 バイト)を比較の対象に含めるか | Low | 含めない。既に最適帯にあり、短縮案との差が作れない(§13.2)。ベースラインだけ取る |
| 20 | **`--setting-sources` の `project` が cwd の `./.claude/` か git root か** | Medium | 確定していない。公式 Agent SDK は cwd と定義し、移植設計 §4.1 は walk-up を前提とする。**§3.7 のガードはどちらでも安全側に働くので、確定させずに進む**(§3.7 の場合分け表) |
| 21 | metatron の eval に基準 5 を体系的に当てたとき、`recording-gotchas` の既存の別語彙問(「メモ残しといて」)と重複しないか | Low | 差し替え時に既存の true 問を読んで、語の重なりが大きいものから選ぶ(§9.3)。重複したら別の 2 問を選ぶ |
| 22 | **英語 description での最適帯を実測していない** | Medium | バイト換算は英語 1 word ≈ 6.2 バイトという換算と、公式の 100〜200 words という記述に依っている。**このリポジトリの実測はすべて日本語 description である。** 英語スキルで 600 バイトが最適かは未検証。段 5 の対象 6 本もすべて日本語 |
| 23 | `agent-creator` の実効 description が、修正前後で 175 バイト → 1154 バイトへ変わる | Medium | 過去に `agent-creator` で取った測定値があれば、**それは 175 バイトを測った値である。** 段 5 のベースラインで取り直す。修正前の値と比べない |
| 24 | 比較 A で `updating-architecture` の差が出にくい見込み | Low | 短縮前が 766 バイトで、落ちる帯の下端にあたる(§13.3)。3 スキルのうち 1 つで差が出なくても、判定は 60 問合計で行う |
| 25 | `LENGTH_TARGET` / `LENGTH_FLOOR` をバイト数にしたことで、`when_to_use` を持つスキルの合算上限(1536 **字**)との単位差が運用に残る | Low | 実務上は衝突しない(§8.1)。衝突するのは目安を大きく超えた description を扱うときだけで、そのときは目安違反として先に検出される |

---

### 16.1 実装計画書が解決した、本設計書の記述の不備

**未解決ではない。いずれも実装計画書(WBS)側で解決済みである。** ここに残すのは、本設計書だけを読んだ人が同じところで詰まらないようにするためである。**手順の正本は実装計画書にある。**

| # | 本設計書の記述 | 実行できない理由 | 計画書の解決 |
| --- | --- | --- | --- |
| 1 | §3.9 手順 3(改善案生成の再現確認)を `improve-description.mjs` 越しに行う | **バンドルは `callClaudeText` を再エクスポートしない。** esbuild は entry の export しか残さない | `tsx` でソースを直接叩く |
| 2 | §16 #18 の `improve_iter_*.json` を見る | **`run-loop` は `--log-dir` を持たない。** `logDir` は `--results-dir` からしか埋まらない(`improve-description.mjs` は `--log-dir` を持つので取り違えやすい) | `--results-dir` を必ず指定する |
| 3 | §3.9 の手順全体を、リポジトリルートを cwd にして行う | **対照実行もリポジトリルートで取ると、対照自身が `git status` を汚し、手順 5 の合格条件(前後完全一致)を壊す** | 対照をリポジトリ外で取る 4 相構成へ組み替えた。根拠は「対照が見ているユーザー層とプラグイン層は HOME 由来なので、cwd を変えても比較が成立する」 |
| 4 | §11.1 のライセンス追随項目 | 表は **9 行**である。`run-loop` の `environment` を数え落として 8 項目と読みやすい | 9 項目として扱う |

---

## 17. 修正履歴

**2026-09-17 初版**: バックログ 8 項目とユーザー確定事項、および context-map を入力に作成。

**2026-09-17 第 2 版**: レビュー 2 種に対する採否判断(14 点)を反映した。主な訂正は次の 2 つである。

**訂正 1(§7)。初版が §7.3 で立てた「打ち切り条件の置換は `best_description` を変えない」は誤りだった。** 証明が Case B(train 未満点・test 満点)しか見ておらず、Case A(train 満点・test 未満点)では現行が止まるところを置換案は止めず、後続の反復が採用されうる。加えて Case A では train 失敗が 0 のまま `buildImprovePrompt` が呼ばれ、初版自身が §7.4 で AND 条件案を退けた理由と同じ害を踏んでいた。置換を取り下げ、OR(`train_failed === 0 || (hasTestSet && test_failed === 0)`)へ改めた。OR は現行の停止条件の上位集合であり、4 ケースすべてで best が不変であることを §7.4 で示した。あわせて `splitEvalSet` の `Math.max(1, …)` により train が空になる構成を §7.6 で拒否する。

**訂正 2(§8)。初版が §8.5 で立てた「予算は反復を重ねるほど単調に縮む」も誤りだった。** `run-loop.ts` L337 が最良ではなく最新を次の現行にすること、超過案を 1 回の書き直しの後そのまま採用すること、指示が「超えない」であって「短くせよ」ではないこと、の 3 経路で崩れる。さらに、開始 description が短いときカバレッジを足す方向が閉じるという指摘がある。予算を `max(最良 description の字数, LENGTH_FLOOR)` へ改め、上限を最良に固定しつつ床までの自由度を残す形にした。

その他の反映:

- §1.4 に stdin・並列・後始末の実測と、その限定(`--model haiku`、認証変数を継承)を追加した。
- §3.1 / §3.3 に `callClaudeText` のタイムアウトが `close` を待たない非対称を記し、`killThenSettle` で両経路を揃えた。`callClaudeText` が `stdio` を指定しないことも明記した。
- §3.3 の「`buildSpawnOptions` が spawn の第 3 引数を固定できる唯一の口」という記述を実態に合わせ、`cwd` / `env` / 引数配列 / `stdio` の固定手段を §12.1 の表に分けた。
- §3.4 に `runEval` の `catch` 経路を追加し、タイムアウトを `error` にしない理由を「過去値の意味が変わる」から「遅い超過と起動失敗を混ぜない」へ書き直した(前者は §2.1 で過去値を破棄する決定と両立しない)。
- §3.4 / §3.8 に `aggregateOutcomes` / `assertMeasurable` の切り出しを追加した。`runEval` が DI を転送しないため、純関数にしないと起動失敗の扱いを固定できない。
- §3.7 に `TMPDIR` がリポジトリ配下にある場合の検出を追加した。
- §4.1 に `environment.model` の表記ゆれと、規律側で吸収する判断を追加した。
- §5.2 の既定適用位置を `main` からライブラリ関数へ移した。`main` だけではライブラリ経路がユーザー設定のモデルへ落ちる。
- §8.1 に、`parse-skill-md.ts` が `when_to_use` を読まないため合算 1536 字がコードで強制されないことを明記した。
- §9 を項目 8a / 8b に分け、5 基準の適用条件、L160 との衝突の解消、既存 eval 3 本への適用、`eval-review.html` と回収手順、L55 の入り口の補正を追加した(**問数は第 3 版で 4 問、対象は第 5 版で 6 本へ更新**)。
- §13 を新設し、200 字優位の再検証(360 回)とベースライン(180 回)、判定の分岐を定めた。これに伴い §2.1 の段構成を組み替え、測定を段 5 に集約した。項目 7 を 7a(仕組み)と 7b(規律)に分け、7b を測定の後に置いた。

**公式 `skill-creator` の測定思想の調査結果を、第 2 版に併せて反映した。**

- §1.5 を新設した。公式の `run_eval.py` は UUID 付きの decoy が呼ばれたかだけを見る作りで、**競争が起きると測定が壊れる。** 公式は競争を測っていない。実プロジェクトで動くのは `find_project_root()` という実装の都合であり、後発の `claude plugin eval`(2.1.269 以降)は throwaway な home / working directory / configuration を明示している。項目 1 は公式の思想から外れる改変ではなく、公式が後発機構で示した方向へ寄せる修正である。
- §10.8 を新設した。「競争に勝った率」は公式由来ではなく、2026-08-09 の移植設計が cwd 隔離後の残差に付けた操作的定義である。**残差の定義そのもの**を述べた 3 箇所のうち、現役文書 2 つ(`skill-creator-port-rationale.md` L46、`SKILL.md` L223)を追随させ、記録である設計書は据え置く。**上流の欠陥を説明した 6 箇所は隔離後も真なので変更しない。**
- §9.1 に基準 6(別のスキルが担当しそうに見えて実はこのスキルが正しい true 問)を足した。公式 SKILL.md の should-trigger 条件が移植時に落ちていた。既存 L161-162 は false 側だけを扱うため重複しない。**確定事項の「5 基準」を超える追加であり、§16 未解決 #9 で採否の確認を求める。**
- §13.1 を書き直した。段 5 は「競争条件を変えた別物の測定」ではなく、公式の意図に沿った条件での最適値の取り直しである。

**2026-09-17 第 3 版**: 基準 6 の採用がユーザーにより決まったため、位置づけと設計を §9.4 に書き下ろした。

- §9.4.1 で位置づけを「公式にあったから足す」から**「隔離によって失う競争耐性の測定を、クエリ設計で代替する」**へ改めた。環境側の競争は測定のたびに顔ぶれが変わって再現性が無く、クエリ側へ埋め込めば eval セットに固定される。あわせて**代替であって同一ではない**ことを明記した。サンドボックスに置かれるのは対象スキル 1 本だけなので、相手側の要因(相手の description の方が魅力的で負ける)は原理的に測れない。
- §9.4.2 で負例 2 行(L161-162)との対称性を示し、平行な構文で書いて**配置も隣接させる**ことにした(§9.1 の配置規則を基準 6 だけ分けた)。
- §9.3 の配分を決め直した。true 10 問を「基準 5 が 2 問 / 基準 6 が 2 問 / 据え置き 6 問」とし、差し替えを **3 問から 4 問へ**増やした。各種別 2 問の根拠は L221 の「1〜2 問の差で疑わない」規律で、1 問しかない種別は落ちても疑えず測る意味が立たない。上限 2 問の根拠は、3 問ずつにすると主な起動経路(明示依頼)が eval の主役でなくなること。
- §9.4.3 で項目 7 との衝突を扱った。**衝突は実在するが、解決機構は既に設計に入っている。** (b)(スキーマへ種別を持たせる)はスキーマ不変の制約に反するので退け、(a) は §8.3 の既存指示で足りるとして追加指示を置かず、予算が最良に紐づく方式(§8.2)が調停する形にした。初版の「最新に紐づく」方式のままなら、境界を書き足して落ちた案が次の予算を決めてしまい調停が壊れていた点も記した。
- §9.4.4 で 3 スキル相互の境界を**2 問のうち 1 問に限る**と決めた。2 問とも内部に充てると eval がプラグイン内部の境界だけを測る。あわせて、**隔離は 2026-08-02 §4.3 が「3 スキル一括」を強制した理由を消している**ことに気づき、§13.2 の一括の根拠を「相互干渉の相殺」から「判定を 60 問合計で行うため作り方を揃える」へ訂正した。
- §9.4.5 で隔離環境での測定可能性を整理した。**組み込みスキル 17 件に対しては隔離後も本物の競争が起きる**(前方一致が外れて `not_triggered` になる)ため、2 問目をここへ当てる。3 スキル相互の 1 問目では競争は起きず、測っているのは境界の明示度である。
- §13.4 を新設し、基準 6 の判別力と項目 7 との衝突を段 5 で観測する手順を置いた。どちらも eval スキーマを変えずに行える。

**2026-09-17 第 4 版**: 項目 1 の隔離方式を差し替えた。**空の `CLAUDE_CONFIG_DIR` を取り下げ、リポジトリ外の一時 cwd + CLI フラグ 4 種(`--setting-sources project` / `--strict-mcp-config` / `--settings '{"disableAllHooks":true}'` / `--no-session-persistence`)へ改めた。`CLAUDE_CONFIG_DIR` を変更せず、認証情報を一切複製しない。**

- §1.3 / §1.4 を実測データごと差し替えた。OAuth 環境での成立(終了コード 0、認証コピー 0 件、3 条件すべてで cwd の probe が発火、`init.skills` が 25 → 17)、4 種の遮断(第 1 回検証の陽性対照付き)、実ホームへの書き込みと 10 並列 × 2 バッチ(20/20 が exit 0、`~/.claude.json` の変化は +1 byte と 0 byte、破損・残骸なし、`git status --porcelain=v1` 前後一致)、副次的な発見(CLI 自身のバックアップ機構、他プロセスによる書き込み)を載せた。
- §3.2 を新方式へ全面的に書き換えた。6 つの手段が何を断つかの対応表を置き、`--setting-sources` の値を `project` にする根拠(`project,local` との差が出ず、広げる理由がない)と、`--settings '{"disableAllHooks":true}'` を併用する根拠(別の層に効く二重化)を書いた。
- §3.3 を整理した。**`Workspace` 型が不要になった**(設定ディレクトリを作らないので既存の `Sandbox` と形が同じになる)。`buildIsolatedEnv` を作らない。`buildSpawnOptions` は `Sandbox` ではなく cwd の文字列を取る。**隔離の実体が env から argv へ移ったため、テストの主戦場も `buildSpawnOptions` から `buildEvalArgs` / `buildTextArgs` へ移った。**
- §3.4 に **`subtype: success` の罠**を追加した。認証失敗時に終了コード 1・`is_error` true でありながら `subtype` が `success` になる。**あわせて、現行 `stream-parse.ts` L52-54 が `result` イベントを無条件に「発火しなかった」と確定させており、しかもそれが `close` より先に起きるため、「終了コードが非ゼロなら error」だけでは認証失敗を 1 つも捕まえられないことが分かった。** `readResultError` を足して、ストリーム側で先に捕まえる設計にした。
- §3.5.1 を新設し、**空 config 方式を「成立を確認したうえで採らなかった案」として記録した。** 取り下げの理由(環境変数認証以外へ広げると `.credentials.json` の複製が要る / トークンのリフレッシュ・コピーの残存・配布物としての信頼要求)と、**手放したもの(ホームへの書き込みの完全な隔離)**を明記した。
- §3.6 を書き換えた。実ホームへの書き込み・他プロセスの書き込み・`~/.claude/backups/` の蓄積を隔離できない範囲として追加し、**認証方式をこの表から外した**(この構成は認証機構に触れないため)。
- §3.7(`TMPDIR` の検出)は**残した。** `--setting-sources project` は project 層を意図して生かしているので、`TMPDIR` がリポジトリ配下にあるとそのリポジトリのスキルが読まれる。cwd の隔離はフラグで代替できない。
- §3.9 の確認手順を差し替えた。**`~/.claude.json` の mtime 不変を合格条件から外し**(実ホームを使うので変化が正常)、代わりに `init.skills` の件数減による**フラグの到達確認**と、`git status --porcelain=v1` の前後完全一致を中心に据えた。
- §16 未解決 #1 を **High から Low へ格下げ**し、論点を「認証方式」から「`--setting-sources` の移植性」へ移した。Bedrock / Vertex の検証を見送った理由(従量課金のためユーザー判断)と時点も記録した。

**2026-09-17 第 5 版**: 再レビュー 2 種の指摘 13 点と、対象範囲の拡大を反映した。

実装の欠陥 3 件。

- **3 値化がそのまま持ち込む集計バグを §3.4 に明記した。** 現行 `outcomes[index] ? 1 : 0` は `QueryOutcome` がすべて truthy なので**全問 100% 発火になる。** 型も純関数テストも配線を止めない。`EvalResult.errors` を必須にする(旧コードがコンパイルできない)ことに加え、**`runEval` の第 2 引数に `runSingleQuery` の DI を足して結合テストを 1 本置く。** `RunEvalOptions` を広げないという §12.1 の方針は維持される。
- **祖先 `.claude` 検出のキャッシュに条件を 3 つ課した**(§3.7)。走査の起点を一時ディレクトリの**親**にする(self を含めると測定用の `.claude` 自身で throw し、本番の 60 spawn が動かない)。**キャッシュのキーを `realpath(tmpdir())` にする**(boolean だと `pool: "forks"` の同一プロセスで先の成功が後段の偽装テストを無効化する)。
- **予算の限界を §8.2 に書き分けた。** 経路 2(超過案の採用)は**解消せず緩和にとどまる**。予算の初期値は現行 description の長さなので、**「400 字超への膨張を止める」は機構で担保するが、「200 字帯へ縮める」はモデルの従順さに依存する。** §16 #2 の (d) へ進む条件を、案が予算の近傍に張り付くかどうかで書き直した。`budget` を必須フィールドにしてフォールバックを塞いだ。

記述の不正確 4 件。

- **「認証機構に一切触れない」を取り下げた**(§3.6)。`--setting-sources project` は user ソースを切るので、`apiKeyHelper` / `awsAuthRefresh` / settings の `env` に依存する環境では**認証が通らない**。経路ごとの成否表を置き、§16 #1 を Low から Medium へ戻した。
- **`readResultError` が母数の定義を変えることを明記した**(§3.4)。`Skill` 未使用のまま `is_error: true` の result が来るセッションが `runs` から外れ、**見かけの発火率が上がる。** §2.1 の非連続要因と §13.1 にも追加した。
- **`--setting-sources` の `project` がどこを指すか確定できないことを §3.7 に書いた。** cwd の `./.claude/` と git root の 2 つの場合分けを置き、**ガードはどちらでも安全側に働く**ことを示した。
- **`--restricted` の却下理由を help の文面に合わせた**(§3.5)。「model-invoked が消える」は help と一致しない。却下の根拠を「project の settings を無視するので測定対象が読まれない」に置き換え、**実測していないことを明記した。**

挙げていなかったリスク 4 件を §15 へ追加した。権限ルールの消失と第 1 ツール打ち切りの合成(全問不発火になりうる)、`-p` が validation 失敗の settings を黙って無視すること、`--bare` が切って新フラグが切らない層(auto-memory)、エイリアス `sonnet` のコンテキスト長。

版を重ねた不整合 5 件(§16 #7 の問数、§9.5 の基準数と回収検査、§10.8 と修正履歴の旧用語、`createWorkspace` の型名、修正履歴の問数)を直した。

段の並行制約 3 件を §2.1 へ反映した。**`SKILL.md` L219-225 の書き換えとバージョン繰り上げを段 6 から段 1 へ移し**、段 4 の「並行可」を「書いてよいが測ってはいけない」と限定した。同じ `SKILL.md` を 3 つの段が触ることも明記した。

**対象の拡大(ユーザー決定)。** metatron の 3 スキルを項目 8 の対象に加えた。バックログ項目 6 の取りこぼしも項目 8 の失敗モードも metatron の eval で起きており、prompt-smith だけを直すと**受け入れ基準を満たしても再現も検証もされない。** 現状を確認したところ、**基準 2・3 は §8 の実験で既にファイルへ入っており、足りないのは基準 5 と 6 だけ**だった(§9.3)。配分は 6 本共通で 4 問(基準 5 が 2・基準 6 が 2)、計 24 問。測定は §13.2 のとおり 720 回(ベースライン 6 スキル 360 + 再検証 metatron 3 スキル 360)。`plugins/metatron` のバージョンも `0.3.6-dev` へ上げる。

**2026-09-17 第 6 版**: 長さ規律の単位を変え、段 5 の測定計画を実測にもとづいて組み直した。

- **長さ規律の単位を文字数から UTF-8 バイト数へ変えた。** 「200 字前後」は日本語前提であり、**`skill-creator` が作るスキルの言語を日本語に縛る。** バイト数を取ると、日本語 200 字(600 バイト)と英語 100 words(約 620 バイト)がほぼ同じ値を指し、1 つの数で言語非依存の規律を書ける(§8.1)。
- **定数を `LENGTH_TARGET = 600` / `LENGTH_FLOOR = 680` にした。** いずれも実測バイト値から引いた。**概算(文字数 × 3)は使わない。** 日本語 description にも ASCII が混ざるため実効は 2.5〜2.8 バイト/字であり、実測の最適帯は 504〜589 バイト、落ちる帯は 766〜1120 バイトだった(概算では 564〜669 と 906〜1380 になり、両帯の間隔を過大に見積もる)。
- `byteLength` を `defaults.ts` に置き、`String.length` で長さを測る箇所を残さない方針にした。副次的に、第 5 版が書いていたサロゲートペアの注意が不要になった。
- **単位の混在を §8.1 に明記した。** 最適値はバイト(こちらで決める規律なので言語非依存にできる)、動作上限 1536 と移植上限 1024 は文字(プラットフォームの仕様なので変換できない)。実務上は衝突しないことも書いた。
- §10.1 に**規律本文を言語非依存に書く方針**を足した。主たる数値はバイト、換算は読み替えの補助として併記、言語の選択は長さの節で扱わない。
- **§13.2 を新設し、対象 6 スキルの現状値を載せた。** 6 つ中 4 つ(metatron 3 本と `skill-creator`)は既に最適帯にあり、**長いのは `prompt-smith`(1612 バイト)と `agent-creator`(1154 バイト)の 2 つだけ**である。規律を定めるスキル自身が最も規律から外れている点も記した。
- **`parseSkillMd` の欠陥を発見し、修正を設計に入れた。** ブロックスカラーの継続を字下げのない行で打ち切るため、**空行を含む `agent-creator` の description が第 1 段落(175 バイト)で切れる。** `replaceDescription` は空行を読み飛ばすので、同じファイルに対して 2 つの実装が別の値を返していた。**比較 B の前提**であり、`NOTICE` の「No behavioural changes」も改める。
- **§13.3 の測定計画を組み直した。** 第 5 版の「metatron で現行と 600 バイト案を比べる」は、**metatron の現行が既に最適帯にあるため成立しない。** 比較 A(metatron の短縮前 vs 現行。元の実験の再現)と比較 B(長い 2 スキルの現行 vs 600 バイト案。新規確認)の 2 本立てにし、合計 **960 回**(ベースライン 360 + A 360 + B 240)とした。
- **短縮前の description は git から完全に復元できることを確認した。** コミット `5325f6f` の親に実物があり、**バックログが記録した字数(460 / 302 / 448)と完全に一致する。** `--description` で渡せるのでファイルを書き戻す必要もない。
- §13.4 の判定を 2 比較の突き合わせにした。**両方が「短縮が効く」を示したときだけ規律を確定させる。** 片方だけのときに何を採るかを 2×2 の表で決めた。

**2026-09-18 第 7 版(最終)**: 確定した実装計画書(WBS)と突き合わせ、2 点を整合させた。

- **測定回数を 960 から最大 1140 へ更新した**(§13.3)。ユーザーが**衝突観測の実施を決めた**ためである。`agent-creator` の改善ループを `--max-iterations 3` で 1 回回す群(最大 180 spawn、早期打ち切りあり)を測定計画へ正式に加え、全体を 17 本・最大 1140 spawn とした。§2.1 の段 5 にも反映した。**この観測が §16 #2((d) へ進むか)の判断材料になる**ことも明記した。第 6 版までは §13.5 に観測手順があるだけで、測定回数に含めていなかった。
- **§10.7(Serena メモリの追随内容)の単位を「字数」から「UTF-8 バイト数」へ直した。** 第 6 版で単位を変えたときに追随していなかった箇所である。計画書 S6-3 の記述が正しい。
- **§16.1 を新設した。** 実装計画書が見つけた、本設計書の記述では実行できない 4 箇所(バンドルが `callClaudeText` を再エクスポートしないこと、`run-loop` の `logDir` が `--results-dir` からしか埋まらないこと、§3.9 の対照実行が `git status` の合格条件を自分で汚すこと、§11.1 が 9 行であること)を記録した。**いずれも計画書側で解決済みであり、手順の正本は計画書にある。**

初版の作成中に判明し、context-map に無かった事項(第 2 版〜第 7 版でも維持):

- `generate-report.test.ts` L4-15 の fixture は型注釈が無く、`LoopResult` の必須キー追加で型検査に落ちる。
- `EvalResultItem` への必須キー追加で `run-loop.test.ts` の 3 つの fixture 生成関数も落ちる。
- `bundle-cli-smoke.test.ts` の既存 3 ケースは `--model` 必須チェックの削除では壊れない。`--model` のチェックが他の必須チェックより後ろにあるためで、壊れるのは `--help` の新規ケースだけである。
- `description-guide.md` に長さの記述が無いのは実装漏れではなく、2026-08-09 の移植設計 §8.3 が guide の役割を共通基準だけに狭めた結果である。
- バックログ §1 の対処案「`--bare` を付ける」は、実測で否定された前提に立っている。

第 2 版で「競争に勝った率」の所在を照合した際に判明した差異:

- **`plugins/prompt-smith/NOTICE` L38-40 にこの句も英語の同義表現も無い。** L38-40 は「cwd が run ごとの一時ディレクトリである」と述べた変更点 3 であり、記述自体は隔離後も真である。追随が要るのは隔離フラグを足す点だけで、それは §11.1 で扱う。
- `harness-docs/handover/2026-08-10-….md` L65 と `plugins/prompt-smith/docs/skill-creator-port-rationale.md` L22 は、**残差の定義ではなく上流の欠陥の説明**である。隔離後も真なので変更しない。
- 照合の過程で `harness-docs/plans/2026-08-09-…-implementation.md` L2629 にも同種の記述を見つけた。これも上流の欠陥の説明であり、変更しない。
