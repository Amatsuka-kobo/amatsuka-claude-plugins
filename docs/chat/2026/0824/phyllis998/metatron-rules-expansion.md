# metatron ルール拡張設計

- 日付: 2026-08-24
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: 不明
- 前提: `harness-docs/design/2026-08-24-metatron-rules-expansion.md`

---

## セッション 1: metatron-rules-expansion 設計概要の確認

# phyllis998

> この引き継ぎ書をもとに作業してください
> harness-docs/design/2026-08-24-metatron-rules-expansion.md

## セッション 2: metatron-rules-expansion 分類と設計分岐決定

# AI

I'll start by reading the required policy skill, then the handoff document.

Architectural と分類する。metatron の書式契約・注入機構・移行経路を同時に触るため、フル設計プロセスで進める。

まず前提検証と探索を並列で走らせる。

引き継ぎ書を読み、前提の実測と探索を始めた。現時点の報告。

## 分類

**Architectural** として扱う。理由は 3 つ。

- metatron の書式契約(`architecture-format.md` の 10 節構成)と設定スキーマ(`config-schema.md` の `paths`)を同時に変える。
- 契約凍結文書 `harness-docs/design/2026-08-16-file-contract-freeze.md` の §4 と §7 に触れる。同文書は冒頭で「本書の内容を変更する必要が生じたときは、実装を止めてユーザーに確認する」と自ら定めている。
- 既存プロジェクト(このリポジトリ自身)の移行経路が要る。

したがって、質問 → 案の比較 → セクション単位の設計提示 → 設計書 → レビュー、の順で進める。実装には入らない。

## 実測で分かったこと(引き継ぎ書の数字を更新)

`echo '{}' | node plugins/metatron/scripts/inject-context.mjs` の実測値:

| 項目 | 引き継ぎ書 | 実測(2026-08-24) |
| --- | --- | --- |
| ARCHITECTURE.md | 8,116 | **8,204** |
| 注入全体 | 8,806 | **8,918** |
| 残り予算(9,000 まで) | 194 | **82** |
| 縮退の発生 | — | 未発生 |

縮退はまだ起きていないが、余白は 82 文字。ARCHITECTURE に 1 行足せば落ちる位置にある。

節ごとの内訳:

| 節 | 文字数 |
| --- | --- |
| ディレクトリ構成と責務 | 1,466 |
| **保護パス** | **1,719** |
| **規約** | **1,481** |
| ドメインマップ | 930 |
| その他 5 節 | 2,608 |

移行対象の 2 節で 3,200 文字、ARCHITECTURE 全体の 39% を占める。

`★ Insight ─────────────────────────────────────`
引き継ぎ書は「rules も注入されるなら総量は変わらない」と書いているが、**予算の所在が変わる**点が本質。現在の 9,000 文字上限は metatron 自身が課しているもので、超えると metatron が黙って縮退させる。`.claude/rules/` が Claude Code 本体の機構なら、その注入は metatron の予算勘定の外に出る。総トークン量は変わらなくても、「metatron の沈黙縮退で規約が消える」という故障モードは消える。これは量の問題ではなく故障モードの問題である。

もう一点。引き継ぎ書は「削除モードを足すと metatron の『消さない』一貫性を崩す」と書くが、ここは分けて考える余地がある。GOTCHAS と ADR が消さないのは**履歴の記録**だから。ARCHITECTURE のセクションは**現在の状態の記述**で、既存の `mode: "replaced"` は既に前の本文を破棄している。節の削除が新たに壊す不変条件は無いかもしれない。
`─────────────────────────────────────────────────`

## 走らせている調査

1. **`.claude/rules/` の一次情報**(Grok Researcher) — 機能の実在・注入方式(常時全文か条件付きか)・frontmatter のキー・CLAUDE.md との優先順位・プラグインからの配布可否・肥大時の挙動。設計の 5 決定のうち 2 番(注入方式)はこの結果で決まる。
2. **metatron 内部構造の棚卸し**(Grok Researcher) — 文書種別の型定義の有無、`mode` の分岐箇所、見出し許可リストの実在箇所数、縮退の検知手段、guard hook のパス決定、「管理対象は 2 文書」という前提が書かれた全箇所、影響を受けるテスト。

両方が返ったら、案の比較に入る。それまでは設計判断をしない。

内部構造の棚卸しが返った。設計に効く事実を先に共有する。

## 分かったこと(引き継ぎ書の記述を 3 点修正・追加)

**1. 「文書の種類」という概念が実装に存在しない**

`DocKind` のような統一の型・列挙は無い。ARCHITECTURE 系と GOTCHAS 系が独立にハードコードされている。staging を持つのは `StagingKind = "architecture" | "adr"` の 2 つだけで、どちらも ARCHITECTURE ファイルへ書く。GOTCHAS は staging を通らない直接書き込みである。

第 3 の文書を足すことは「既存の枠に 1 行足す」ではなく、**枠そのものを作る**作業になる。

**2. config が 2 パス固定で、配列でない**

`config.ts` の `ResolvedConfig` は `architecturePath` / `gotchasPath` の 2 フィールド。追加の文書スロットは表現できない。つまり `references/config-schema.md` と契約凍結文書 §7 の変更が確定で必要になる。凍結文書は冒頭で「変更が生じたときは実装を止めてユーザーに確認する」と定めているので、ここは承認ゲートになる。

**3. 逆に、追随が自動で効く箇所がある**

`guard-docs.ts` の拒否対象は `loadConfig` 由来のパスであってハードコードではない。config に rules のパスが載れば、直接編集の拒否は自動的に拡張される。拒否メッセージへの CLI 案内の追記だけが手作業になる。

**4. 縮退の検知手段は本当に無い**

`build()` は `string` しか返さない。フラグもログも戻り値も無い。「を Read すること」の有無は間接指標にすぎない。縮退の段階は 7 段あり、規約が消えるのは第 4 段(`arch=outline`)である。

`★ Insight ─────────────────────────────────────`
`ARCHITECTURE_HEADINGS`(architecture.ts)と `ARCHITECTURE_SECTIONS`(scan.ts)は import 関係のない独立複製で、同期機構は無い。見出しを増減させる変更は、この 2 箇所の片方だけ直すと「stage は通るが diff 検出が見落とす」という非対称な壊れ方をする。テストも `ARCHITECTURE_SECTIONS.length` を前提にしている箇所がある。今回のように節を減らす変更では、ここが最も踏みやすい地雷になる。
`─────────────────────────────────────────────────`

`.claude/rules/` の一次情報調査はまだ走っている。その結果を待つ間に、結果に依存しない範囲で 1 つ確認したい。

二本目の調査が返った。**設計の前提が 1 つ覆り、1 つ決定的な利得が見つかった。**

まず事実確認を 1 つ。

二本目が返った。**前提が 1 つ覆った。**

## 一次情報で確定したこと

`.claude/rules/` は Claude Code **v2.0.64** で追加された正式機能。現行は 2.1.241 なので使える。

| 項目 | 一次情報の内容 |
| --- | --- |
| 探索 | プロジェクト `.claude/rules/` とユーザー `~/.claude/rules/`。`.md` を**再帰的に**発見。プロジェクト側が高優先 |
| frontmatter | **公式キーは `paths` のみ**。`description` / `globs` / `alwaysApply` の一次情報は無い |
| `paths` 無し | 起動時に全文ロード。`.claude/CLAUDE.md` と同優先 |
| `paths` 有り | マッチするファイルを Claude が読んだときだけ適用。**compact 後はマッチ再読取まで失われる** |
| プラグイン同梱 | `rules/` はプラグインのコンポーネントに**存在しない**。プラグインからは配布できない |

### 覆った前提

引き継ぎ書の「rules の注入方式(全文注入か、条件に一致したときだけか)を設計時に決める」は、**選択の余地が実質ない**。

- 保護パスは「そのファイルを触る前」に要る。`paths` 付きにすると、そのファイルを Read した後にしか効かない。Write しかしない場合は一度も発火しない。
- テスト方針は「新しいテストをどこに置くか」で要る。まだ存在しないファイルのパスにはマッチしない。
- 規約は常時。

3 節とも `paths` 無し(unscoped)以外に成立しない。したがって**注入総量は減らない**。

### 覆っていないこと

プラグインから配布できない件は、この設計の障害にならない。metatron は同梱 rules を配る仕組みではなく、**プロジェクトの `.claude/rules/` へ CLI で書き込む**仕組みだからである。init/update が生成し、guard hook が直接編集を拒む。

## 得るもの・失うもの(正直な評価)

**得るもの**

1. metatron の沈黙縮退の対象外になる。縮退は `maxChars` 9,000 に対して起きるが、rules は Claude Code 本体が読むので metatron の予算勘定の外。規約が黙って消える故障モードが消える。
2. ARCHITECTURE が 8,204 → 4,474 文字。注入は 8,918 → 5,188。余白が 82 から 3,812 へ。ARCHITECTURE の成長余地が戻る。
3. 役割の分離。ARCHITECTURE = 構造の記述、rules = 守らせる規律。

**得られないもの(引き継ぎ書が期待したかもしれないもの)**

- コンテキスト消費の削減。unscoped なので総量は同じ。
- サブエージェントへの伝播。metatron の SessionStart 注入は現在サブエージェントに届かないが、rules も同様に届かない可能性が高い(未確認。調査に出した)。

`★ Insight ─────────────────────────────────────`
`.claude/rules/` は「文書が再帰的に全部読まれる」ため、metatron が書くファイルとユーザーが手で置くファイルが同じ名前空間に同居する。metatron が「どれが自分の管理対象か」を判別できないと、guard hook がユーザーの手書き rules まで編集拒否してしまう(あるいは逆に、metatron の rules をユーザーが手で書き換えても検知できない)。ARCHITECTURE と GOTCHAS は「1 文書 = 1 パス」だったのでこの問題が無かった。**文書が 1:N になる**ことが、今回の実装上の本質的な新規性である。
`─────────────────────────────────────────────────`

## 反映した回答

- 成果物: 設計書まで。実装計画書と実装は別セッション。
- 移行対象: **規約・保護パス・テスト方針の 3 節**。それぞれ別ファイル。ARCHITECTURE.md と ARCHITECTURE.example.md の両方から削除。

移動量が変わる:

| | 現在 | 移行後 |
| --- | --- | --- |
| ARCHITECTURE.md | 8,204 | 4,474 |
| 注入全体 | 8,918 | 5,188 |
| ARCHITECTURE の節数 | 10 | **7** |

補足の確認を 1 本走らせた。結果を待たずに、主要な分岐を先に決めたい。

主要な分岐は 2 つある。それぞれ推奨と理由を先に書く。

## 分岐 X — metatron が管理する rules をどう識別するか

`.claude/rules/` は `.md` を再帰的に全部読む。ユーザーが手で置くファイルと同居するため、metatron が自分の管理対象を判別できる必要がある。判別できないと、guard hook がユーザーの手書き rules まで編集拒否するか、逆に metatron の rules が手で書き換えられても気づけない。

**推奨は X-2(専用サブディレクトリ)。** 判定がパスの接頭辞一致だけで済み、ユーザーの名前空間と衝突せず、公式に定義のない frontmatter キーに依存しないため。

| 軸 | X-1 直下に固定名 | **X-2 サブディレクトリ** | X-3 frontmatter マーカー |
| --- | --- | --- | --- |
| 判別の手段 | ファイル名の完全一致 | パスの接頭辞一致 | 全 rules を開いて frontmatter を読む |
| ユーザーの手書きとの衝突 | `conventions.md` 等は汎用名で衝突しうる | 起きない | 起きない |
| guard hook のコスト | 定数比較 | 定数比較 | 毎回全ファイルを読む |
| 公式仕様への依存 | なし | なし | **未定義キーの扱いに依存(一次情報なし)** |
| 既存ファイルの巻き込み | 同名を先に置かれていると乗っ取る | 起きない | 起きない |

## 分岐 Y — ARCHITECTURE から 3 節を消す手段

`stage-architecture` の `mode` は `"replaced" | "added"` だけで、削除できない。

**推奨は Y-1(削除モードを足す)。** 引き継ぎ書は「metatron の『消さない』一貫性を崩す判断」と位置づけているが、ここは分けて考えられる。GOTCHAS と ADR が消さないのは**履歴の記録**だから。ARCHITECTURE の節は**現在状態の記述**で、既存の `replaced` が既に前の本文を破棄している。節の削除が新たに壊す不変条件は無い。

| 軸 | **Y-1 削除モードを追加** | Y-2 専用の移行コマンド | Y-3 本文を参照案内 1 行に差し替え |
| --- | --- | --- | --- |
| 汎用性 | 今後の節構成変更にも使える | 移行完了後は死にコード | — |
| ARCHITECTURE に残るもの | 何も残らない | 何も残らない | **空に近い節が 3 つ残る**(約 180 文字) |
| 見出し許可リストの扱い | 「有効」と「廃止予定」の 2 段に分ける | 同左 | 3 節を有効なまま残す |
| 実装量 | `AppliedChange` 型・`applySectionChanges`・CLI 出力契約・テスト | 上記 + 専用コマンド | ほぼゼロ |
| 移行後の再発防止 | 廃止予定の見出しは本文書き込みを拒否する | 同左 | **防げない。また規約が書き込まれる** |

Y-3 は実装が軽いが、「規約を ARCHITECTURE に書かせない」という目的そのものを達成できない。Y-2 は Y-1 の上に乗る便宜機能なので、まず Y-1 を決めたい。

なお **原子性は必須でない**と見ている。rules を先に書き、ARCHITECTURE から後で消す順にすれば、途中で止まっても「両方にある」= 重複で済む。喪失は起きない。

## 分岐にしていないもの(推奨として確認したい)

- **注入方式**: 3 節とも `paths` 無し(unscoped)。上述のとおり選択の余地が無い。
- **ファイル分割**: 3 ファイル(規約 / 保護パス / テスト方針)。回答どおり。
- **config の表現**: `paths.rulesDir` を 1 キー足す。`config-schema.md` は「未知キーは無視する」と定めているので、codiel と sandalphon の config 実装の写しは**追随不要**、3 者比較テストの対象外にできる。
- **`/metatron:init` のウォークスルー**: 対話の単位を「セクション」から「ドラフト単位」に読み替える。ARCHITECTURE 6 節 + rules 3 ファイルで、確認回数は現在の 9 回から変わらない。

**サブエージェントに関する発見があった。** これが移行の最大の根拠になる。

## 三本目の調査結果

| 論点 | 一次情報 |
| --- | --- |
| SessionStart の matcher 省略 | `startup` / `resume` / `clear` / `compact` / `fork` の**全部**にマッチ。compact 後も再発火する |
| **サブエージェントへの伝播** | 「every level of the CLAUDE.md hierarchy … including ~/.claude/CLAUDE.md, **project rules**, CLAUDE.local.md」がサブエージェントに入る。Explore と Plan だけ除外 |
| 未定義 frontmatter キー | **一次情報なし**。無視・警告・エラーのいずれも未記載 |

`★ Insight ─────────────────────────────────────`
これで得失の評価が変わる。**compact の優位は無い** — metatron の hook は matcher 未指定なので compact 後も再発火する。私が前のターンで挙げかけた利得は取り下げる。

代わりに、より強い利得が出た。**metatron の SessionStart 注入はサブエージェントに届かない**。SessionStart はセッション開始時のイベントで、サブエージェントはセッションではないからである。一方 project rules はサブエージェントのコンテキストに入る。

つまり現在、このリポジトリで GPT Terra や Grok Researcher に作業を委譲すると、`## 規約`(git 運用・Done の条件・探索と編集の規律)も `## 保護パス`(バンドル出力を手で編集しない、等)も**届いていない**。依頼文へ手で転記しない限り、サブエージェントはこれらを知らずに作業している。3 節を rules へ移すと、これが自動的に解消する。

引き継ぎ書が挙げた「役割の分離」よりも、この伝播の差の方が実利が大きい。
`─────────────────────────────────────────────────`

決定を反映する。`.claude/rules/metatron/` 配下 + 専用移行コマンド。実装の詳細を詰めるため、パーサの契約を確認する。

パーサの契約を確認できた。セクション分割は `^## ` の状態機械で、**見出し許可リストとは独立**している。許可リストは書き込みの検証にしか使われない。したがって許可リストから 3 節を外しても、既存ファイルの 3 節は正しくセクションとして読める。移行コマンドが読んで消せる。

残りの前提を確認する。

公式ドキュメントに「`.md` files are discovered recursively」の記述があると調査は報告している。設計の土台になる前提なので、自分で直接確認する。

## 回答: サブディレクトリは公式に対応している

公式ドキュメント([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory))の原文を直接確認した。

> Place markdown files in your project's `.claude/rules/` directory. Each file should cover one topic, with a descriptive filename like `testing.md` or `api-design.md`. **All `.md` files are discovered recursively, so you can organize rules into subdirectories like `frontend/` or `backend/`**

> **Rules without `paths` frontmatter are loaded at launch with the same priority as `.claude/CLAUDE.md`.**

したがって `.claude/rules/metatron/conventions.md` は公式の想定内の使い方である。

### ただし 1 箇所、確認しておくべき曖昧さがある

同じページに次の但し書きがある。

> Before v2.1.211, rules that load on demand, including path-scoped rules and **rules in nested `.claude/rules/` directories**, loaded even when `project` was excluded.

「nested `.claude/rules/` directories」が
(a) プロジェクト配下の別ディレクトリにある `.claude/rules/`(例 `packages/web/.claude/rules/`)を指すのか、
(b) `.claude/rules/` の中のサブディレクトリを指すのか、
一次情報からは判別できない。

(b) だとすると `.claude/rules/metatron/*.md` は「オンデマンド読み込み」になり、**起動時に載らない**。規約を常時効かせるという今回の目的が達成できなくなる。

読みの筋としては (a) が自然である。「All `.md` files are discovered recursively」の直後に「Rules without `paths` frontmatter are loaded at launch」と続く構成だからである。だが設計の土台なので実測する。

## スコープの確認

> metatron が rules の追加・編集を行えるようにするだけで、それを読むのは Claude Code 公式の機能に寄せたい

これは私が組み立てていた方向と一致する。確定事項として扱う。

- metatron が**得るもの**: rules への書き込み経路(CLI)、直接編集の拒否(guard hook)、書式契約、init/update への組み込み、移行コマンド
- metatron が**得ないもの**: rules の注入。`inject-context.ts` は ARCHITECTURE と GOTCHAS のままで、rules 本文には一切触らない

実測する。

このリポジトリの hook 群が headless 実行を妨げている。隔離した最小プロジェクトで測り直す。

実測できた。**サブディレクトリの rules は起動時に読み込まれている。** ただしツール経由で読んだ可能性を排除していないので、ツールを禁じて測り直す。

実測で確定した。ツール(Read / Glob / Grep / Bash)をすべて禁じた 1 ターンの headless 実行で、`.claude/rules/flat.md` と `.claude/rules/sub/sub.md` の**両方**のトークンが返った。サブディレクトリ配下の rules も起動時にコンテキストへ載る。曖昧さは解消した。プローブファイルは削除済み。

`★ Insight ─────────────────────────────────────`
一次情報が「読みとしてはこう」で止まったとき、Claude Code 自身を使った実測で決着させられる。`--setting-sources project` でユーザー設定(= プラグインの hook 群)を切り離し、`--disallowed-tools` で読み取り経路を塞ぎ、`--output-format json` の `num_turns: 1` でツール往復が無かったことを確認する。この 3 点セットで「コンテキストに載っていたのか、その場で読んだのか」を分離できる。
`─────────────────────────────────────────────────`

作業ツリーに副次的な変更が出ている。`.raphael/antibodies/*` は私の Bash 実行で発火カウントが増えたもの。`cliproxyapi.config.example.yaml` の `grok-4.5` → `grok-4.6` は私の作業由来ではなく、セッション開始時のフックによる更新と見られる。どちらも触っていない。

---

# 設計案

分量があるため全体を一度に提示する。判断の分かれ目は末尾で 2 点確認する。

## 1. スコープ

**やること**

- metatron の管理対象に「rules」を第 3 の種別として追加する。
- rules は `.claude/rules/metatron/` 配下の固定 3 ファイルとする。
- ARCHITECTURE から `## 規約` `## 保護パス` `## テスト方針` を削除し、rules へ移す。
- 移行専用のサブコマンドを設ける。

**やらないこと**

- rules の注入。読み込みは Claude Code 公式機構に委ねる。`inject-context.ts` は rules 本文に一切触れない。
- GOTCHAS の変更。
- `~/.claude/rules/`(ユーザーレベル)の管理。
- `paths` frontmatter による条件付き rules。3 節とも常時適用が要るため使わない。

## 2. 配置と識別

```
<docRoot>/.claude/rules/metatron/
├── conventions.md        ← 旧 ## 規約
├── protected-paths.md    ← 旧 ## 保護パス
└── testing-policy.md     ← 旧 ## テスト方針
```

- config に `paths.rulesDir` を 1 キー追加。既定は `.claude/rules/metatron`。
- ファイル名は書式契約で固定する。config では変えない。
- **frontmatter を書かない。** 公式キーは `paths` のみで、unscoped にするには frontmatter 自体が不要。未定義キーの扱いは一次情報が無いので依存しない。
- 各ファイルの冒頭に、metatron 管理であることと更新手段を示す 1 行を置く。CLI の絶対パスはインストール先で変わるため書かず、「注入文または拒否メッセージから取る」と案内する。

**既知の制約**: metatron の `docRoot` と Claude Code の起動ディレクトリがずれると、書いた rules が読まれない。`get config` の `warnings` にこのずれを載せる。このリポジトリでは両者が一致している。

## 3. CLI の追加

| サブコマンド | 種別 | 返すもの |
| --- | --- | --- |
| `get rules [--name <名前>]` | 読 | 3 ファイルの内容と存在状況 |
| `stage-rules --input <path>` | 段階 | diff と `stagingId` |
| `commit-rules --staging-id <id>` | 書 | staging を消費して書き込む |
| `migrate-rules` | 段階 | 移行プランの diff と `stagingId` |

`stage-rules` の入力:

```json
{ "rules": [{ "name": "conventions", "body": "..." }], "reason": "更新の理由" }
```

`name` は `conventions` / `protected-paths` / `testing-policy` のいずれか。未知の名前は拒否する。

`commit-architecture` は改名しない。注入文・`get config` の `cli` オブジェクト・guard の拒否メッセージに名前が載っているためである。rules は `commit-rules` を新設し、内部の消費ロジックは共有する。

## 4. 移行コマンド

`migrate-rules` は次を 1 つの staging にまとめる。

1. ARCHITECTURE から移行対象 3 節の本文を読む。
2. `.claude/rules/metatron/` の 3 ファイルの内容を組み立てる。
3. ARCHITECTURE から 3 節を削除した本文を組み立てる。
4. 4 ターゲット分の diff を返す。

ユーザーが diff を承認したら `commit-rules --staging-id <id>` が、**rules 3 ファイル → ARCHITECTURE の順**で書く。途中で失敗しても「両方にある」= 重複で済み、規約が消えることはない。

存在しない節は黙って飛ばす。3 節すべてが無ければ「移行対象なし」を返す。

## 5. 見出し許可リストの扱い

- `ARCHITECTURE_HEADINGS`(architecture.ts)と `ARCHITECTURE_SECTIONS`(scan.ts)から 3 節を削除し、10 節 → **7 節**にする。両方を同じコミットで直す。片方だけだと「stage は通るが乖離検出が見落とす」非対称な壊れ方をする。
- 別に `MIGRATABLE_HEADINGS`(3 節)を定義する。`migrate-rules` だけが参照する。
- `stage-architecture` にこの 3 節を渡すと拒否し、**`migrate-rules` を案内する**。移行後に規約が ARCHITECTURE へ書き戻されるのを防ぐ。
- セクション分割は `^## ` の状態機械で許可リストと独立なので、既存ファイルの 3 節は変わらず読める。削除モードを一般公開しなくても移行できる。

## 6. guard hook

- 拒否対象に `rulesDir` 配下の 3 ファイルを追加する。パスは `loadConfig` 由来なので、config に載れば判定は自動で拡張される。
- 拒否メッセージに `stage-rules` / `commit-rules` を追記する。
- `.claude/rules/` の**それ以外**のファイルは拒否しない。ユーザーの手書き rules は自由に編集できる。

## 7. init / update

- **init**: 対話単位は ARCHITECTURE 6 節 + rules 3 ファイル = **9 単位**で、現在の 9 回から変わらない。確定後に ARCHITECTURE と rules の staging を発行し、diff 承認を経て commit する。
- **update**: 乖離検出に 2 項目を追加する。「ARCHITECTURE に移行対象の 3 節が残っている(未移行)」と「rules が未作成」。前者は `migrate-rules` を案内する。

## 8. 注入への影響

- rules 本文は注入しない。
- CLI 案内に rules 系を追記する(約 +150 文字)。

| | 現在 | 移行後 |
| --- | --- | --- |
| ARCHITECTURE.md | 8,204 | 4,474 |
| CLI 案内ほか | 714 | 約 864 |
| 注入合計 | 8,918 | **約 5,340** |
| 残り予算 | 82 | **約 3,660** |

## 9. 追随先

- `references/architecture-format.md`(10 節 → 7 節)、`config-schema.md`(`rulesDir` 追加)、**新設** `references/rules-format.md`(3 ファイルの書式規範。現 architecture-format.md の該当節の規範を移設)。
- 契約凍結文書 §4-1 / §7 と、新設する rules の節。凍結文書は「変更が生じたときは実装を止めてユーザーに確認する」と定めており、本設計書の承認がその確認にあたる。
- `docs/format-change-checklist.md` に rules の項を追加。
- **codiel / sandalphon は追随不要**と見ている。config-schema が「未知キーは無視する」と定めているため、`paths.rulesDir` は両者の実装で自動的に無視される。3 者比較テストの対象にも入れない。
- `docs/ARCHITECTURE.example.md` から 3 節を削除し、`docs/RULES.example.md` を新設。
- テスト: `inject-context.test.ts` の I1/I2/I3、`guard-docs.test.ts` の D1/D2/D5、`config.test.ts` の C2、`architecture.test.ts` の見出し数前提、`scan.ts` の `ARCHITECTURE_SECTIONS.length` 前提。

## 10. このリポジトリ自身の移行

`migrate-rules` で 3 節を移し、CLAUDE.md の「保護パス・規約は ARCHITECTURE にある」という記述を更新する。実施は実装セッション。

---

判断の分かれ目が 2 つある。

両方反映する。**rules ファイルを可変にする**という判断は、設計の作りを一段変える。

`★ Insight ─────────────────────────────────────`
可変にすると、「どの rules ファイルが metatron 管理か」の**レジストリをどこに置くか**が新しい論点になる。config に一覧を書く案もあるが、config は現在 metatron が読むだけで書かない資産であり、CLI の書き込みと config の記述が二重管理になる。

代わりに **ディレクトリ自身をレジストリとする**。`.claude/rules/metatron/` に存在する `.md` が管理対象のすべて、という定義にすれば、config に要るのは `paths.rulesDir` の 1 キーだけで済む。これは `.claude/rules/` 本体が「置いてあるものを再帰的に全部読む」設計なのと同じ流儀であり、公式機構に寄せるという方針とも噛み合う。

代償として、書式契約が「conventions.md には規約を書く」と内容を固定できなくなる。契約が縛れるのは、ファイル名の規則・1 ファイル 1 トピック・frontmatter を書かないこと・分量の目安、といった形式面に移る。移行先の 3 つは「固定」ではなく「`migrate-rules` が使う既定名」として文書化する。
`─────────────────────────────────────────────────`

可変にしたことで、削除の経路も要る。guard hook は `Edit|Write|NotebookEdit` を拒むが `rm` は塞がないため、CLI に削除経路が無いと「消すときだけ規律の外」になる。`stage-rules` に削除指定を含める。

設計書を書く。ファイル内容は通常の日本語とする(genshijin の既定)。

# phyllis998

> 設計の前提を覆すようで申し訳ないです。Metatronの管理対象からrulesを削除します。今回のセッションでは、ARCHITECTUREの節削除と、対象の3つをrulesに移設します。

> すみません、方針を転換します。Metatronの管理対象rulesは固定とします。

## セッション 3: metatron ルール拡張設計の Haiku レビュー評価と反映

# AI

方針転換を反映する。管理対象 rules は**固定**。私が最初に推奨した形に戻る。

- `.claude/rules/metatron/` 配下の 3 ファイル固定(`conventions.md` / `protected-paths.md` / `testing-policy.md`)
- config に要るのは `paths.rulesDir` の 1 キーのみ。レジストリは書式契約が持つ
- 削除経路は不要。ファイルは「ある / まだ無い」の 2 状態で、`stage-rules` は書き込みと差し替えだけを扱う
- 書式契約が各ファイルの内容規範を固定できる。`architecture-format.md` の 3 節の規範をそのまま `rules-format.md` へ移設できる
- `init` の対話単位は ARCHITECTURE 6 節 + rules 3 ファイル = 9 単位で、現在から変わらない

設計書を書く。

`writing-discipline.md` を読んだ。反映する。これは良い指定で、しかも**適用の強さを上げる根拠**がある。

設計書を書き終えた。レビューに回す。まず委譲先の実行モデルを確認する。

`claude-researcher` は `model: sonnet` で固定されているため、Haiku 帯には使わない。ビルトインの `general-purpose` に Haiku を明示して振る。`grok-researcher` は `model: claude-grok-4-5` 固定なのでそのまま起動する。

2 本を並列で回す。Grok には Haiku の指摘を渡さず、設計書の原本だけを読ませる。

設計書を `harness-docs/design/2026-08-24-metatron-rules-expansion-design.md` に書いた(32KB、18 節)。2 系統のレビューを並列で回している。

## 設計書の構成

| 節 | 内容 |
| --- | --- |
| §1–2 | 位置づけ、目的、実測で確定した前提、得るもの・得ないもの |
| §3 | 引き継ぎ書の 5 項目への回答(表) |
| §4–5 | 配置と識別、config スキーマの変更 |
| §6–8 | CLI の追加、staging の契約変更、`migrate-rules` |
| §9–12 | 見出し許可リスト、guard hook、init/update、注入への影響 |
| §13 | 書式契約と執筆規律 |
| §14–16 | 追随先チェックリスト、影響を受けるテスト、実装の順序 |
| §17–18 | 未解決事項、不採用案 |

## 引き継ぎ書からの主な更新点

1. **注入方式は選択の余地が無かった。** 3 節とも `paths` 付きでは成立しない(保護パスは Write のみの経路で一度も発火しない、テスト方針は未作成ファイルにマッチしない)。unscoped 一択で、注入総量は減らない。

2. **compact の優位は無い。** metatron の SessionStart hook は matcher 未指定 = 全 source にマッチするため、現状でも compact 後に再注入される。

3. **最大の根拠はサブエージェントへの伝播。** project rules はサブエージェントのコンテキストに入るが、SessionStart 注入は入らない。現在このリポジトリでは、委譲したサブエージェントに規約も保護パスも届いていない。

4. **削除モードは不要だった。** セクション分割が `^## ` の状態機械で許可リストと独立しているため、許可リストから 3 節を外しても既存ファイルは読める。`migrate-rules` が読んで消せる。

## `writing-discipline.md` の反映

指定を §13-2 と §13-3 に入れた。適用の強さは移行前と同じ「削る基準を強く適用」を維持する。加えて、**rules では削る基準がより強く効く**という論点を立てた。

3 節が ARCHITECTURE にあったときはメインセッションに 1 回載るだけだった。rules へ移すとサブエージェントのコンテキストにも載るため、1 セッションで複数委譲すればその回数だけ同じ本文が読み込まれる。規律が届く範囲が広がることが目的であり、その対価として読み込み回数が増える。

そこで、移行時に「読んだ後にエージェントの振る舞いが変わる文だけを残す」判定を 3 節すべてへ通すことを設計に含めた。ただし **`migrate-rules` は機械的な移設だけを行い、本文の推敲は `/metatron:update` で別途行う**。移設による差分と推敲による差分が 1 つの diff に混ざると、承認時に区別できなくなるためである。

## 走らせているレビュー

- **Haiku** — 理解の再構成 + 暗黙知・矛盾・欠落・検証不能・数値の裏取り
- **Grok Researcher** — 前提の反証・内部整合・見落とし・代替案

Grok には設計書の原本だけを渡し、Haiku の指摘は渡していない。両方が返ったら私が採否を判断し、補足修正を加えてから提示する。

`grok-researcher` の定義は `model: claude-grok-4-5` で固定されているが、セッション開始時のフックが `cliproxyapi.config.example.yaml` を `grok-4.6` へ更新している。エイリアスが解決できず起動に失敗する可能性がある。その場合は運用方針のフォールバックに従い、独立レビューを省いて Haiku レビュー + 私の補足で進める。

レビュー 2 本の結果を待っている。返り次第、指摘の採否を判断して設計書へ反映し、提示する。

Haiku レビューが返った。設計書は Grok が今読んでいるため、編集は両方揃うまで止める。読んでいる最中にファイルを書き換えると、Grok の指摘が古い版に対するものになるためである。

## Haiku の指摘の採否(暫定)

理解の再構成は設計の意図と一致していた。伝達は成立している。

### 採用する(9 件)

| 指摘 | 対応 |
| --- | --- |
| **`metatron-extra` のような兄弟ディレクトリを接頭辞一致が誤検出する** | §4-1 に「文字列の接頭辞一致ではなく、解決済みパスのディレクトリ包含で判定する」を明記 |
| §2-4「総量は変わらない」と §13-3「サブエージェント分だけ増える」が噛み合っていない | メインセッションでは変わらず、委譲した回数だけ増える、と書き分ける |
| 「1 対 N が新規性」の書き方が曖昧 | 「複数セクション」ではなく「複数ファイル」であることを明示 |
| §13-3 の推敲が §16 の実装順序に無い | 移設と推敲を分ける方針を実装順序へ反映 |
| `.claude/rules/metatron/` 配下の非 Markdown ファイルの扱いが未定義 | guard の対象は固定 3 ファイルに限り、それ以外は拒否しないことを明記 |
| §2-2 が実測手順(§17-1)を参照していない | 相互参照を張る |
| サブエージェントへ届いたことの検証手段が無い | Done の条件として、サブエージェントへ委譲してトークンを問う検証手順を追加 |
| 注入量の見積もりが実測で外れたときの扱いが無い | 実装後に `inject-context` で実測して確認することを Done の条件に追加 |
| **200 行の目安に一次情報が無い** | 公式が rules に定めた上限は存在しない。「運用上の目安として CLAUDE.md の推奨値を借りる」と書き直す |

**兄弟ディレクトリの誤検出は実害のある指摘である。** `.claude/rules/metatron` を文字列の接頭辞として比較すると、`.claude/rules/metatron-extra/foo.md` がユーザーの手書きファイルであるにもかかわらず guard に拒否される。

### 数値の出典を補う(4 件)

8,204 と 8,116 の差、3 節の内訳、CLI 案内の +150 文字、いずれも測定方法と測定日を書いていなかった。8,116 は引き継ぎ書執筆時点の値で、その後 ARCHITECTURE が変わったことによる差である。測定コマンドを §12 に併記する。CLI 案内の +150 文字は見積もりであり、実測値ではないことを明記する。

### 採用しない(2 件)

- **各実装ステップの完了条件** — 実装計画書(WBS)の担当範囲である。設計書には置かない。ただし「完了条件は実装計画書で定める」と明記して、欠落ではなく分担であることを示す。
- **`reason` フィールドの既定値と出力形式** — 既存の `stage-architecture` と同じ扱いであり、`references/cli-usage.md` に既に定義がある。設計書で再定義しない。

### 事実誤認が 1 件

「GOTCHAS は既に複数の ADR を 1 ファイルで管理」という前提で矛盾を指摘しているが、ADR は GOTCHAS ではなく ARCHITECTURE の `## ADR 一覧` にある。ただし指摘の結論(「1 対 N」の書き方を明確にすべき)自体は妥当なので、書き方の修正として採用する。

Grok の独立レビューを待って、両方の指摘を突き合わせてから一度に反映する。

Grok の独立レビューを待っている。

Grok の独立レビューが返った。**3 件の [確信度: 高] のうち 2 件は実害があり、1 件は設計の主目的そのものを疑っている。** 最も重い指摘から潰す。

> §2-3 の最大利得は、公式の "project rules" が `.claude/rules/` を含むという解釈に依存する。§17-1 はメインセッションしか測っていない。

これは正しい。私の実測は「サブディレクトリが起動時に読まれるか」を測ったのであって、「サブエージェントに届くか」は測っていない。設計の主目的が未実証のまま書式契約と凍結文書を同時に変える段取りになっている。測る。

併せて、codiel のスキルが移行対象 3 節を参照しているという指摘を裏取りする。

codiel の指摘は**裏が取れた**。私の「追随不要」は誤りである。プローブの結果を見る。

**実測でサブエージェント到達を実証した。** Grok の最も重い指摘は測定で反証された。

| 証拠 | 値 |
| --- | --- |
| rules の置き場 | `.claude/rules/metatron/probe.md`(サブディレクトリ) |
| メインが渡した依頼文 | `Reply with only VAULT=<the VAULT token from your instructions, or MISSING>.` — **トークンを含まない** |
| サブエージェントの `tool_uses` | **0** — ファイルを読んでいない |
| サブエージェントの応答 | `VAULT=VAULT-9X2K` |

依頼文にトークンが無く、ツール往復も 0 でトークンを返した以上、rules はサブエージェントのコンテキストに載っていた。§2-3 の主張は成立する。

一方 **codiel の指摘は裏が取れ、私の判断が誤っていた**。残りの参照箇所を確認する。

Grok の codiel 指摘は全件裏が取れた。`orchestrating-runs/SKILL.md:38,96` は ARCHITECTURE の「規約」節からベースブランチ名を読んでおり、移行するとベースブランチの解決が `main` へ落ちる。**私の §14-3 の判断は誤りである。**

設計書に反映する。

節番号を差し込んだので、後続の番号と相互参照を直す。

最終の自己レビューをかける。

両レビューの指摘を突き合わせ、設計書へ反映した。`harness-docs/design/2026-08-24-metatron-rules-expansion-design.md`(45KB、18 節)。

## 設計が変わった箇所(レビューで実質的に直った 3 点)

### 1. 移行が中断すると回復不能になる欠陥があった

Grok の指摘。§7-2 で部分適用を認めながら、§8-1 に「移行先の rules が既に存在すれば拒否」と書いていた。この 2 つが噛み合うと詰む。

rules 3 ファイルを書き終えて ARCHITECTURE の更新前に失敗すると、staging は消費済みで再実行不可、`migrate-rules` は既存 rules を理由に拒否、`stage-architecture` に削除モードは無く、guard が手編集を拒む。移行が完了も巻き戻しもできない。

無条件拒否をやめ、`migrate-rules` に状態判定を持たせた(§8-4)。

| ARCHITECTURE の 3 節 | rules | 判定 | 動作 |
| --- | --- | --- | --- |
| ある | 無い | 未移行 | 通常の移行 |
| ある | ある・内容一致 | **中断後** | ARCHITECTURE の削除だけ |
| ある | ある・内容不一致 | 競合 | 拒否して両方を提示 |
| 無い | ある | 移行済み | 対象なし |
| 無い | 無い | 未作成 | `stage-rules` を案内 |

### 2. codiel が壊れる。私の「追随不要」は誤りだった

Grok の指摘を grep で全件裏取りした。codiel のスキルが移行対象 3 節を ARCHITECTURE から直接読んでいる。

- `orchestrating-runs/SKILL.md:38,96` — 「規約」節からベースブランチ名を読む。移行後は `main` へ落ちる
- `implementing/SKILL.md:21,23,31` — `## テスト方針` が無い場合を「必要」として扱うため、移行後は常に「必要」になる
- `writing-dev-plans` / `scripting-tests` / `initializing-harness` と `raguel.config.example.yaml`

§14-2 に追随先として全件を列挙し、§16 の実装順序で **codiel の追随をこのリポジトリの移行より前**に置いた。逆順だと、移行してから直すまでの間ベースブランチ解決が壊れる。移行前のプロジェクトも動かす必要があるため、ARCHITECTURE の節と rules の両方を見るフォールバックを入れる方針にした。

### 3. `metatron-extra` を接頭辞一致が誤検出する

Haiku の指摘。`.claude/rules/metatron` を文字列の前方一致で比較すると、ユーザーの手書きファイル `.claude/rules/metatron-extra/foo.md` が guard に拒否される。realpath 解決とディレクトリ包含で判定するよう §4-1 に明記し、§15 にテストを追加した。

## 実測で決着させた指摘

Grok は「§2-3 の最大利得は公式文の曖昧な語に依拠し、実測もサブエージェント経路を測っていない。この点を潰すまで実装に進むべきではない」を確信度 [高] で出した。**指摘は正しく、測定で反証した。**

依頼文にトークンを含めず、サブエージェントの `tool_uses` が 0 でトークンが返った。手順と検証条件は §17-2 に残し、Claude Code の更新で前提が崩れたときに気づけるよう §15 に回帰プローブを置いた。

## 採用しなかった指摘

| 指摘 | 理由 |
| --- | --- |
| 各実装ステップの完了条件が無い(Haiku) | 実装計画書の担当範囲。§16 に分担を明記した |
| `reason` の既定値と出力形式が不明(Haiku) | `references/cli-usage.md` に既存の定義がある。再定義しない |
| 「二重保持」案が比較されていない(Grok) | 比較として §18 に追加したうえで不採用。正本が 2 つになり、片方だけ更新された状態を機械で検出できない |

Grok の「委譲文へ規律を転記する」代替案は §18 に追加した。ファイル契約を凍らせたまま穴を塞げる最小案だが、転記の実行者の記憶に依存し、忘れた依頼だけが規律の外へ落ちて検出できない点を不採用の理由として書いた。

## 数値と根拠の補強

8,204 と引き継ぎ書の 8,116 の差は測定時点の違いであることを明記し、測定コマンドを §12-1 に併記した。CLI 案内の +150 文字は見積もりで実測値でないことも明記した。200 行の目安については、**公式が rules に定めた上限は存在しない**と書き直した(CLAUDE.md 向けの推奨値を運用上借りているだけである)。

---

設計書をレビューしてほしい。変更したい点があれば直す。承認をもらえたら、次は実装計画書(WBS)の作成になるが、それは別セッションとする取り決めなので、この設計書の確定をもってこのセッションの成果物は完了になる。

なお、契約凍結文書 `2026-08-16-file-contract-freeze.md` は「本書の内容を変更する必要が生じたときは、実装を止めてユーザーに確認する」と定めている。本設計は同文書の §4-1・§4-3・§7・§11 を変更するため、**この設計書の承認がその確認を兼ねる**。

# phyllis998

> codielについて、codielからmetatronを分離したとき、それぞれ独立で使用できるようにしたはずで、その結果ARCHITECTUREを参照するのはドメインマップだけになったと認識しています(AIからそう報告をうけた)。実際はそうなっていなかったということで、他の箇所も同じように壊れる可能性があります。確認してください。

## セッション 4: codiel スキル群の ARCHITECTURE 依存を実測確認

# AI

認識と実態のずれが他にもある可能性がある。全プラグインを横断して洗う。

まず機械的に列挙する。

結合は認識よりずっと広い。節名ごとに分解する。

全体像が出た。判断のために実文を要る。コード経路は私が見て、指示層の広域は委譲する。

コード層とプロンプト層で答えが割れている。**ユーザーの認識はコード層については正しい。**

## コード層(TypeScript)— 認識どおり、ドメインマップだけ

| 実装 | ARCHITECTURE への依存 |
| --- | --- |
| `plugins/codiel/src/hooks/lib.ts` | `readDomainsResult`(`lib.ts:476-501`)が ` ```json metatron:domains ` ブロックを読むだけ。他は `resolveDocPaths`(`lib.ts:245,309-320`)がパスを解決するのみで、中身の構造に触れない |
| `plugins/sandalphon/src/check-intent-env.ts` | `readDomains`(`check-intent-env.ts:515-545`)が同じくドメインマップだけ。他は ASIS 探索の初期材料としてパスを渡すだけ(`:643-646`) |
| `plugins/codiel/raguel-mcp/src/precedent/seed/index.ts:91` | 「保護パス」は判例シードの本文に出てくる語であって、ARCHITECTURE の節を読んでいるわけではない。結合ではない |

分離時の設計目標はコードでは守られている。`lib.ts:334-338` には「ここだけ緩いと同じ ARCHITECTURE に対する 3 実装の答えが割れる」「独自のフェンス判定を書かない(契約 §1)」というコメントまで残っており、契約凍結文書の規律が実装に効いている。

## プロンプト層(skills / agents / commands)— 認識と食い違う

ここが漏れている。契約凍結文書と `format-change-checklist.md` が追随を要求しているのは主に**実装**であって、skills の本文には同じ強度の規律がかかっていない。

節名を名指ししている箇所が、少なくとも次の節に対して存在する。

| 節 | 名指ししているファイル |
| --- | --- |
| テスト方針 | `implementing` / `scripting-tests` / `writing-dev-plans` / `initializing-harness` / `codiel-tester.md` / `CLAUDE.example.md` |
| 保護パス | `initializing-harness`(6 箇所)/ `raguel.config.example.yaml` / `codiel-reviewer-data.md` / `README.md` / `commands/init.md` |
| コマンド定義 | `implementing` / `running-regression-tests`(5 箇所)/ `reviewing-diffs` / `codiel-reviewer-doc.md` |
| 技術スタック | `initializing-harness`(3 箇所)/ `preparing-design-agendas` / `writing-design-docs` / `README.md` / `commands/init.md` |
| 規約 | `orchestrating-runs:38,96` |
| ディレクトリ構成 | `initializing-harness` / `CLAUDE.example.md` / `sandalphon/executing-intent:58` / `agent-policy` の gpt-terra・grok-implementer |
| レイヤー構造 | `codiel/README.md:21` |

`★ Insight ─────────────────────────────────────`
分離が「コードでは達成され、プロンプトでは達成されなかった」という形で割れている。原因は追随の担保がかかっている場所の差である。

契約凍結文書は 3 プラグインの **TypeScript 実装**に対して「同じ規則を独立に 3 回実装する」「本書がその規則の唯一の写しである」と定め、`format-change-checklist.md` も config スキーマ変更時の追随先として `config.ts` / `lib.ts` / `check-intent-env.ts` と 3 者比較テストを名指ししている。実装には機械的な検証(3 者比較テスト)が付いている。

一方 skills の本文には、同じ節名を書いてよいかを検証する仕組みが無い。ARCHITECTURE の書式変更時に codiel スキルを追随させる項目は `format-change-checklist.md:6-10` に存在するが、**チェックリストは人間が読んで手で追随させるもの**であり、書いた時点で「この節名を参照した」という事実がどこにも登録されない。だから増えても気づけない。

今回の移行が壊すのはプロンプト層だけである。コード層は無傷で通る。
`─────────────────────────────────────────────────`

`agent-policy` にも参照が出ているのは想定外だった(`gpt-terra.md:15` / `grok-implementer.md:16`)。これは metatron を前提としないはずのプラグインである。

指示層の全件を「節名依存 / ドメインマップ依存 / パス依存のみ / 言及のみ」に分類させる調査を走らせている。特に **codiel と sandalphon が metatron 無しで動くか**、節が無いときのフォールバックが安全側か危険側かを判定させている。結果が返ったら、設計書の追随先を確定させ、併せて「同じ壊れ方が再発しない仕組み」を提案する。

指示層の分類調査の結果を待っている。

指示層の分類調査を待っている。

分類が返った。実害の大きい主張を自分で確かめる。

全件を自分で確認した。**認識と実態のずれの正体が特定できた。加えて、この移行とは無関係に既に壊れている箇所が 1 つ見つかった。**

## 認識が正しかった範囲・誤っていた範囲

| 層 | 実態 | 認識との一致 |
| --- | --- | --- |
| TypeScript 実装(codiel `lib.ts` / sandalphon `check-intent-env.ts`) | ドメインマップのみ。他はパス解決だけ | **一致** |
| skills / agents / commands | 節名を名指しする箇所が 13 件 | **不一致** |
| agent-policy | 0 件。私が前ターンで挙げた 2 件は誤り | — |

`agent-policy/agents/gpt-terra.md:15` と `grok-implementer.md:16` は「設定ファイルの編集、マニフェストの更新、**ディレクトリ構成の整理**が必要なとき」という一般語であって、ARCHITECTURE への参照ではない。前ターンでの指摘を取り下げる。

## 移行で壊れる箇所(深刻度順)

### 1. 停止する — `scripting-tests`

```
ファイルまたは節が無ければ着手せず、その旨を報告して終了する。
```
`plugins/codiel/skills/scripting-tests/SKILL.md:51-53`

`## テスト方針` から E2E フレームワークを読み、無ければ**着手せず終了**する。移行後は codiel の test-loop の E2E スクリプト化が動かなくなる。

### 2. 黙って違う動きをする(4 件)

| 箇所 | 移行後の挙動 |
| --- | --- |
| `orchestrating-runs:96-97` | ベースブランチが常に `main` になる。`main` 以外を使うプロジェクトで誤ったブランチに切る |
| `implementing:21-23` | `## テスト方針` 欠落を「必要」として扱うため、常にユニットテスト必須になる。「不要」と宣言していたプロジェクトでも RED を強制する |
| `reviewing-diffs:39-40` / `codiel-reviewer-doc.md:25` / `codiel-reviewer-data.md:29` | 節欠落時のフォールバックが書かれていない。レビュー観点が空振りするか、自己判断のコマンドに寄る |

### 3. 安全側に縮退する(8 件)

`running-regression-tests`(ユニットテスト実行を省略)、`writing-dev-plans`(既存テストと `package.json` で代替)、`initializing-harness`(ユーザーに質問)、`CLAUDE.example.md`(存在する節だけ転記)。

## この移行とは無関係に、既に壊れている

`★ Insight ─────────────────────────────────────`
codiel は metatron 無しで使えるよう、`initializing-harness` が**ドメインマップだけの最小 ARCHITECTURE** を自前生成する。同スキル `:73` は「技術スタック・ディレクトリ構成・コマンド定義・**テスト方針**・規約は聞かない」と明記している。

つまり **codiel 単体で初期化したプロジェクトには最初から `## テスト方針` が無い**。そこで `scripting-tests` は着手せず終了する。

`scripting-tests` の停止は今回の移行が作る故障ではない。**既に存在し、既に踏める故障である。** 移行がやるのは、これまで「metatron 併用プロジェクトだけが避けられていた」故障を全プロジェクトへ広げることだけである。

同じことが `implementing` の「節が無ければ必要として扱う」にも言える。codiel 単体プロジェクトでは常に RED 強制になっている。
`─────────────────────────────────────────────────`

したがって修正は 2 系統に分かれる。

- **移行に伴う追随**: 参照先を rules へ切り替え、移行前のプロジェクトのために ARCHITECTURE も見るフォールバックを置く。これは設計書 §14-2 の範囲。
- **既存の欠陥の修正**: `scripting-tests` の無条件停止と `implementing` の一律「必要」に、metatron 非併用でも成立するフォールバック(`package.json` の devDependencies から E2E フレームワークを推定する、ユーザーに問う等)を入れる。これは今回の移行と独立した codiel の不具合である。

設計書に監査結果を反映する。

設計書に監査結果を反映した。残りは範囲の判断になる。

## 再発防止について

今回の食い違いは、**追随の担保がかかっている場所の差**から生まれている。

- TypeScript 実装には 3 者比較テストという機械的な検証がある。だから分離が守られた。
- skills の節名参照には、登録も検証も無い。`format-change-checklist.md` に「codiel を追随させる」という項目はあるが、**人間が読んで手で追随させるもの**であり、新しい節名参照が増えたこと自体はどこにも記録されない。だから増えても気づけない。

同じ壊れ方を防ぐなら、参照を登録制にして機械で検出する形にできる。`plugins/*/skills|agents|commands/**/*.md` を走査して ARCHITECTURE の節名を探し、登録済みの一覧に無い参照が現れたらテストを落とす。新しい参照を書くこと自体は禁じず、「登録せずに書く」ことだけを止める。

これを今回の設計に含めるかは、範囲の判断になる。

両方を反映する。設計書を更新する。

# phyllis998

> codielをrulesを参照するようにするとしてますが、その必要はないはずです。なぜならrulesは自動適用されるものであり、そもそも独立使用できるものなら、metatronが無い状態でそちらも存在し得ないはずです。

# AI

その指摘は正しい。**私の追随方針が余計なものを足していた。**

理屈を確認する。

1. rules は起動時に自動適用され、サブエージェントのコンテキストにも載る(§17-2 で実測済み)。したがって codiel のスキルは**読みに行く必要がない**。内容は既にそこにある。
2. codiel が独立して使えるなら、metatron が無い環境では rules も存在しない。存在しないものへの参照経路を codiel に持たせる意味がない。

つまり正しい追随は「参照先を rules へ切り替える」ではなく「**節名参照を削除する**」である。そうすると当初の分離目標(ARCHITECTURE への依存はドメインマップだけ)が、認識ではなく実態として成立する。

ただし前提が 1 つ残る。私が実測したのは `general-purpose` サブエージェントである。codiel のサブエージェント(`codiel-tester` など)は **tools を絞ったカスタムエージェント**であり、そこにも rules が載るかは測っていない。方針全体がこれに乗るので測る。

API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment. If it persists, check your inference gateway (127.0.0.1:8317).

No response requested.

# phyllis998

> 再開してください

# AI

API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment. If it persists, check your inference gateway (127.0.0.1:8317).

# phyllis998

> 再開してください

# AI

API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment. If it persists, check your inference gateway (127.0.0.1:8317).

# phyllis998

> 再開してください

# AI

API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment. If it persists, check your inference gateway (127.0.0.1:8317).

# phyllis998

> 再開してください

# AI

API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment. If it persists, check your inference gateway (127.0.0.1:8317).

No response requested.

# phyllis998

> 再開してください

# AI

API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment. If it persists, check your inference gateway (127.0.0.1:8317).

# phyllis998

> 再開してください

# AI

API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment. If it persists, check your inference gateway (127.0.0.1:8317).

No response requested.

# phyllis998

> 再開してください

# AI

API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment. If it persists, check https://status.claude.com.

No response requested.

# phyllis998

> 再開してください

# AI

No response requested.

# phyllis998

> 再開してください

## セッション 5: 実測確認と設計書確定

# AI

中断前の実測が完了していた。結果を反映する。

## カスタムサブエージェントでの実測

| 証拠 | 値 |
| --- | --- |
| rules | `.claude/rules/metatron/testing-policy.md` |
| サブエージェント | `.claude/agents/probe-agent.md`(`tools: Read, Grep` の自作エージェント) |
| メインが渡した依頼文 | `Reply with only VAULT=<the VAULT token from your instructions, or MISSING>.` — トークンを含まない |
| `tool_uses` | **0** |
| 応答 | `VAULT=CUSTOM-4M7Z` |

tools を絞ったカスタムエージェントにも rules は載る。codiel の `codiel-tester` や `codiel-implementer-*` にも同じことが成り立つ。

したがって指摘のとおりである。**codiel は rules を読みに行く必要がない。** 内容は既にコンテキストにある。設計書の該当箇所を直す。

節番号の整合を取る。

§14-3 と §14-4 の並びが逆になっている。直す。

設計書の整合が取れた。`harness-docs/design/2026-08-24-metatron-rules-expansion-design.md`(58KB、18 節)。

## 指摘を受けて変わったこと

指摘は正しく、**設計が一段きれいになった。** 私の案は余計な経路を足していた。

### 変更前(私の案)

codiel の節名参照を `get rules` の読み取りへ切り替え、移行前のプロジェクトのために ARCHITECTURE の節も見るフォールバックを置く。

### 変更後

**節名参照を削除する。** codiel は何も読まない。

理由は 2 つ。

1. rules は起動時に自動適用され、サブエージェントにも届く。読みに行く経路が要らない。
2. metatron が無い環境には rules も無い。存在しないものへの参照経路は空振りするだけ。

書き換え後、codiel の ARCHITECTURE への依存は**ドメインマップだけ**になる。分離の当初目標が、認識ではなく実態として成立する。

## 前提を追加で実測した

方針全体が「カスタムサブエージェントにも rules が載る」に乗るため、そこも測った(§17-3)。

`tools: Read, Grep` を宣言した自作エージェントに対し、依頼文にトークンを含めず `tool_uses: 0` でトークンが返った。codiel の `codiel-tester` や `codiel-implementer-*` にも同じことが成り立つ。

## 副次的に得られた整理

`★ Insight ─────────────────────────────────────`
「読む」から「コンテキストに従う」への移行は、決定性を手放すことでもある。ファイルの有無で分岐する指示は決定的だが、コンテキストに載った宣言にモデルが従うかは保証されない。

この差を無条件に受け入れたのではなく、**決定性が要る情報には別の正本が既にある**ことを確認して受け入れた(§14-2)。

| 情報 | 決定性 | 正本 |
| --- | --- | --- |
| ドメインマップ | 要る | ARCHITECTURE の機械可読ブロック。読み続ける |
| 保護パス | 要る | `raguel.config.yaml`。codiel 自身の資産 |
| ベースブランチ | 要らない(誤れば `git switch` が失敗して気づく) | 既定 `main` |
| テストの要否・FW | 要らない(誤ればテストが落ちて気づく) | `package.json` からの推定 |

決定性が要るものは既に codiel 側かドメインマップにある。だから節名参照を消しても失われない。
`─────────────────────────────────────────────────`

### 再発防止の性質も変わった

節名参照がゼロになるため、インベントリのテストは「登録する場所」ではなく「**ゼロであることを固定する装置**」になった(§14-4)。

- 分類 A(節名依存): 1 件でも現れたら落ちる。登録による例外を認めない
- 分類 B(ドメインマップ)・C(パス)・D(言及): 登録制

分類 A に例外を認めないのは、認めた瞬間に「登録さえすれば書いてよい」に変わり、また 13 件まで増えるからである。

### 移行の追随と既存不具合の修正が 1 つになった

`scripting-tests` の無条件停止と `implementing` の一律「必要」は、節を読まなくするには読めなかったときの手段が要る、という同じ変更の裏側になった。作業は 1 つ、コミットは「削除」と「フォールバック新設」で分ける。

---

設計書をレビューしてほしい。承認をもらえればこのセッションの成果物は完了になる。実装計画書(WBS)と実装は別セッションの取り決めである。

契約凍結文書 §4-1・§4-3・§7・§11 の変更を含むため、この設計書の承認が同文書の定める「実装を止めてユーザーに確認する」を兼ねる。

設計書のレビュー待ち。承認または修正の指示をもらえれば進める。

設計書のレビュー待ち。承認または修正の指示をもらえれば進める。

# phyllis998

> 設計書を読みました。質問です。実装時にmetatronのhooksを掻い潜るための一時スクリプトは作られますか？そして作業完了後にそれは削除されますか？

## セッション 6: 実装時の迂回手段は設計上不要

# AI

明確に答える。**作らない。設計上も必要ない。**

まず現状を確認する。

残骸は無い。設計書と会話記録だけで、いずれも意図した成果物である。

## 答え

**作らない。設計上、一箇所も必要にならない。**

実装中に metatron の hook が守るパスへ書く場面を全部並べると、すべて CLI 経由で足りる。

| 実装ステップ | 書く先 | 経路 |
| --- | --- | --- |
| 12 | `harness-docs/ARCHITECTURE.md`(3 節の削除) | `migrate-rules` → `commit-rules` |
| 12 | `.claude/rules/metatron/*.md`(新規 3 件) | 同上。同じ staging に入る |
| 13 | `.claude/rules/metatron/*.md`(推敲) | `stage-rules` → `commit-rules` |
| 7 | ARCHITECTURE の `## ディレクトリ構成と責務`(`src/lib/rules.ts` の追加) | `stage-architecture` → `commit-architecture` |

残りの変更先(`metatron.config.json`・`src/`・`references/`・`skills/`・`README.md`・契約凍結文書・`CLAUDE.md`)は hook の対象外である。guard が拒むのは `loadConfig` が解決した正本のパスだけで、設定ファイル自身も含まない。

## ただし、誘惑が出る瞬間が 3 つある

設計書はそれを書いていなかった。実装は別セッションが担うので、**書いていないことは守られない**。

### A. guard hook 自体を変える瞬間(ステップ 4)

`src/guard-docs.ts` を直しても、実際に効いているのはビルド済みの `scripts/guard-docs.mjs` である。新しい判定に不具合があると、直した本人のセッションで正当な書き込みが拒否される。ここで `hooks.json` を一時的に外す誘惑が出る。

### B. 移行が部分適用で止まった瞬間(ステップ 12)

§8-4 に再開経路を設けたが、その判定自体に不具合があると詰む。§10 に書いたとおり `rm` はシェル経由で通るため、手で消して辻褄を合わせる誘惑が出る。

### C. rules ファイルを試しに置きたい瞬間

ステップ 4 以降、`.claude/rules/metatron/conventions.md` は Write で作れない。`commit-rules` でしか作れない。開発中に「テスト用に 1 個置きたい」が起きる。

設計書に禁止と代替手段を明記する。

もう 1 つ、追跡中に気づいた抜けがある。

`★ Insight ─────────────────────────────────────`
移行後、`.claude/rules/metatron/` の 3 ファイルは guard hook の拒否対象になる。ところが「触らないパス」を列挙している当の文書が `protected-paths.md` であり、**移行直後の時点では自分自身を保護パスとして列挙していない**。ARCHITECTURE の `## 保護パス` を機械的に移しただけだからである。

文書が実態を記述しない状態が生まれる。`migrate-rules` は機械的な移設だけを行うと決めた(§13-3)ので、この追加は移設ではなく内容更新の側に属する。
`─────────────────────────────────────────────────`

設計書を直す。

設計書に §16-1「実装中に禁じること」を追加した。内容は 4 点。

1. **迂回手段を一時的にも作らない。** 迂回スクリプト・hook の一時無効化・正本への直接書き込みのいずれも禁じる。
2. **正本へ書く場面を全部列挙し、それぞれの CLI 経路を示す。** 4 件しかなく、すべて既存または新設の CLI で足りる。「必要になるかもしれない」という余地を残さない。
3. **誘惑が出る 4 場面と、そこで取る手段を表にする。** guard を変えた直後の不具合、移行の部分適用、テスト用ファイルの仮置き、CLI 完成前の先行作業。
4. **`rm` が塞がっていないことは、使ってよいことを意味しない**と明記する。§10 で「シェル経由の削除は塞がらない」と書いた以上、そこが抜け道として読まれる余地を消す。

終了時の確認も入れた。一時スクリプト・一時ファイル・hook の無効化が残っていれば、それは迂回が行われた証跡である。

## 併せて直した抜け

移行直後の `protected-paths.md` が、自分自身を保護パスとして列挙していない状態になる。ARCHITECTURE の `## 保護パス` を機械的に移すだけだからである。

`migrate-rules` は移設だけを行うと決めているので、この追加はステップ 13(内容更新)へ入れた。同じステップで ARCHITECTURE の `## ディレクトリ構成と責務` に `.claude/rules/metatron/` を足す。

---

このセッションで私が作ったファイルは、設計書 1 本と会話記録だけである。`git status` の未追跡は `harness-docs/design/2026-08-24-metatron-rules-expansion-design.md` と `docs/chat/2026/0824/` の 2 件。プローブに使った一時ファイルは `/tmp` と `.claude/rules/` の両方とも削除済みで、metatron の hook を迂回した操作は行っていない。

設計書のレビューを続けてほしい。他に確認したい点があれば聞いてほしい。

設計書のレビューを待っている。

設計書のレビューを待っている。

# phyllis998

> migrate-rulesがその一時スクリプトに見えます。というのも、現在このプラグインは開発中であり、使っている人は現状いない前提のもと作業を行っています。
> 破壊的変更も可能であり、フォールバック経路は不要です。

## セッション 7: migrate-rules撤回・実装方針決定

# AI

指摘のとおり。**`migrate-rules` は移行専用の装置であり、利用者がいない前提では存在理由が無い。**

これは以前の決定を反転させる。あのとき専用移行コマンドを採ったのは「metatron を使う既存プロジェクトすべてに必要で、移行後も残る」という理由だった(§8-3)。利用者がいないなら、その理由は成立しない。移行対象はこのリポジトリ 1 つで、一度実行したら二度と使われない。

連鎖して不要になるものが多い。まず現状を確認する。

利用者不在を前提にすると、連鎖して不要になるものが多い。設計を組み直す。

指摘のとおりだった。`migrate-rules` を撤回し、設計を組み直した。

## `migrate-rules` が「一時スクリプト」だった理由

私は §16-1 で「hook を迂回する一時スクリプトを作らない」と書きながら、その直前の §8 で**同じ性質のものを CLI の中に作っていた**。違いは置き場所だけである。リポジトリの片隅に置けば「迂回」と呼ばれ、サブコマンドとして CLI に足せば「機能」と呼ばれる。一度しか使わない処理のために恒久的な口を開ける、という動機は同じである。

利用者不在という前提が、採用の唯一の根拠(「既存プロジェクトすべてに必要で、移行後も残る」)を無効にしていた。

## 代わりに何を採ったか

`stage-architecture` に**節の削除**を足す(§6-2)。これは移行装置ではなく、書き込み経路が本来持つべき能力である。節構成を変えるときに再び使う。

設計上の要が 1 つある。

`★ Insight ─────────────────────────────────────`
**`remove` の検証を、見出し許可リストではなく「対象ファイルにそのセクションが存在するか」で行う。**

内容を書くわけではないので、許可リストに載っている必要がない。この規則があると、許可リストから外した見出しの節も消せる。だから `MIGRATABLE_HEADINGS` のような移行専用の定数が一切要らなくなる。

当初の設計はここを取り違えていた。「許可リストから外すと消せなくなる」から専用コマンドが要る、と考えていた。実際には、削除の検証対象が違うだけだった。
`─────────────────────────────────────────────────`

## 連鎖して消えたもの

| 消したもの | 理由 |
| --- | --- |
| `migrate-rules` サブコマンド | 上記 |
| **staging の複数ターゲット化** | `migrate-rules` のためだった。撤回に伴い不要 |
| **「1 バイトも変わっていない」保証の緩和** | 複数ターゲット化が消えたので、契約を壊さずに済む。§7 は「変えない」に転じた |
| **§8-4 中断からの再開**(状態判定 5 パターン) | 各ステップが単一ターゲットになり、部分的に壊れた状態が生まれない |
| `MIGRATABLE_HEADINGS` | `remove` が許可リストを見ないため不要 |
| `/metatron:update` の未移行検出 | 利用者がいない。移行を終えれば未移行の状態は現れない |

## 移行の手順(§8)

CLI の一般機能だけで足りる。

1. `stage-rules` で `conventions` → 承認 → `commit-rules`
2. 同 `protected-paths`
3. 同 `testing-policy`
4. `stage-architecture` で 3 節を `remove: true` → 承認 → `commit-architecture`(対象ファイルが 1 つなので 1 staging)

rules を先に書き、ARCHITECTURE から後で消す。各ステップは単一ターゲットの staging であり、失敗したファイルは 1 バイトも変わっていない。中断しても済んでいないステップから続ければよい。

承認は 4 回。一度きりの作業なので許容する。

## 副産物

`references/cli-usage.md` の「保証されるもの」5 点を、1 つも崩さずに済むようになった。当初案は 1 点を明示的に緩める設計だった。

---

設計書は 18 節・61KB。他に見直すべき点があれば指摘してほしい。

設計書の残りのレビューを待っている。

設計書の残りのレビューを待っている。

# phyllis998

> 承認します。続けて引き継ぎ書を作ってください

> 承認します。実装は別セッションで"Ultracode"を使って対応します。公式の/goalコマンドに渡すプロンプトを書いて、docs/prompts/に出力してください

## セッション 8: 実装セッション用プロンプト、/goal仕様で区間分割して作成

# AI

承認を受けた。実装セッション用のプロンプトを書く。

`/goal` の仕様と出力先の慣例を確認する。

`docs/prompts/` は未作成。作成して置く。

`/goal` の仕様調査を待つ間に、ローカルでも確認する。

`/goal` は組み込みコマンドのため CLI ヘルプには出ない。調査エージェントの結果を待って、プロンプトの形式を確定させる。

その間に素案を書く。

素案を書いた。`/goal` の仕様調査の結果を待って、形式と分量を確定させる。

`★ Insight ─────────────────────────────────────`
このプロンプトで一番効くのは「サブエージェントへ規律を転記する」の節である。

実装セッションは Ultracode で多数のサブエージェントを動かす。ところが **`## 規約` と `## 保護パス` は、まさにこの実装が完了するまでサブエージェントに届かない**。バンドル出力を手で編集しない、`--force` を付けない、といった規律が、実装の担い手には見えていない。

自分自身の欠陥を直す作業が、その欠陥の影響下で行われる。だからプロンプト側で規律を明示的に補う必要がある。設計書には書けない性質の指示で、実装セッションの運営にしか属さない。
`─────────────────────────────────────────────────`

素案の段階なので、調査結果を見てから削る基準を当てる。特に次の 2 点を見直す。

- Done の条件は ARCHITECTURE に既にあり、メインセッションには注入される。プロンプトに再掲するのは重複だが、Ultracode のサブエージェントには届かない。どちらを取るか。
- `/goal` が短い目標文を期待する形式なら、この分量は過剰になる。設計書と実装計画書へ委ねる範囲を広げる。

`/goal` の仕様が想定と違った。**設計を組み直す必要がある。**

## 判明したこと

`/goal` はタスク説明を渡すコマンドではない。**完了条件を渡すコマンド**である。

| 項目 | 内容 |
| --- | --- |
| 引数 | 自由文の条件。**上限 4,000 文字** |
| 動作 | 条件設定と同時に turn 開始。各 turn 後に fast モデル(既定 Haiku)が条件の充足を判定 |
| 継続 | 未充足なら**次の turn を自動で開始**する |
| 終了 | 充足または「不可能」と判定されたら goal を自動クリア |
| 推奨 | 測定可能な終了状態、証明の手段(`npm test` exits 0 など)、守るべき制約、turn 上限 |

`★ Insight ─────────────────────────────────────`
ここに設計との衝突がある。

**`/goal` は「次の turn へ進むか」の判断をユーザーからモデルへ移す機構である。**一方この実装には人間の承認ゲートが 5 箇所ある(実装計画書の承認 1 + 移行の stage/commit 承認 4)。

turn がユーザーへの質問で終わったとき、評価モデルは「条件未充足」と判定して次の turn を開始する。質問は「修復必須のエラー」ではないので goal はクリアされない。結果として、**承認を待たずに次へ進む圧力がかかる**。

これは metatron が `references/cli-usage.md` で明示的に禁じている失敗そのものである。

> `stage-*` が exit 0 で返ったことを承認と読み替えない。ユーザーの承認を得るまで `commit-architecture` を実行しない。

したがって、承認ゲートを含む区間を `/goal` に載せない。
`─────────────────────────────────────────────────`

区間を分けて出力する。

文字数の申告を実測で確認する。

`docs/prompts/2026-08-24-metatron-rules-expansion-implementation.md` に出力した。

## 区間を 3 つに分けた

`/goal` を使うのは中央の区間だけである。

| 区間 | 内容 | 起動 | 承認ゲート |
| --- | --- | --- | --- |
| 1 | 実装計画書(WBS)の作成 | 通常のプロンプト(401 文字) | 1 箇所 |
| 2 | 設計書 §16 のステップ 1〜11 | **`/goal`**(1,145 文字) | 無し |
| 3 | このリポジトリの移行(12〜14) | 通常のプロンプト(357 文字) | 4 箇所 |

区間 2 に承認ゲートが無いのは、この区間が metatron の正本へ一切書かないためである。書式契約と参照文書は `references/` 配下で hook の対象外、rules ファイルと ARCHITECTURE を触るのは区間 3 になる。だから自動継続させても、承認を飛ばす経路が生じない。

## `/goal` の条件文の作り

公式が求める「測定可能な終了状態と、それを証明する手段」に合わせ、7 項目すべてをコマンドの実行結果で判定できる形にした。

- `pnpm run lint` / `typecheck` / `test` が exit 0
- `pnpm run build` 後に `git status --porcelain plugins/` が空(バンドル再生成漏れの検出)
- `get config` の出力に `rulesDir` が含まれる
- 新 4 サブコマンドがテストで検証されている
- 節名参照インベントリのテストが通る
- `plugin.json` と `package.json` の version が一致してマイナーが上がっている
- 一時スクリプトと hook の無効化が残っていない

turn 上限は 30 とした。

## 運用指示を本文に分けた理由

4,000 文字の制限があるため、条件文にすべては入らない。詳細は同じファイルの `## 運用指示` 節に置き、条件文の冒頭でそれを読ませる形にした。3 区間すべてが同じ節を参照する。

その中で最も効くのは、繰り返しになるが**サブエージェントへの規律の転記**である。実装が完了するまで `## 規約` と `## 保護パス` はサブエージェントに届かない。Ultracode で多数のサブエージェントが動く区間 2 で、バンドル出力を手で編集しない・`--force` を付けない、といった規律が担い手に見えていない。この非対称を解消する作業が、その非対称の下で行われる。

---

このセッションの成果物は 2 本になった。

- `harness-docs/design/2026-08-24-metatron-rules-expansion-design.md`(設計書、承認済み)
- `docs/prompts/2026-08-24-metatron-rules-expansion-implementation.md`(実装セッションの起動プロンプト)

プロンプトの分量や区間の切り方に修正したい点があれば指示してほしい。

# phyllis998

> docs/promptsをARCHITECTUREに入れることはできますか？

## セッション 9: docs/prompts追加の必要性と段階的移行計画

# AI

できる。ただし**単にツリーに 1 行足すだけでは矛盾が残る**、かつ**今やると注入が縮退する**。両方を確認する。

数値を推定でなく実測する。一時ディレクトリに複製して測る。

**実測の結果が予想よりはるかに悪い。**

`★ Insight ─────────────────────────────────────`
ARCHITECTURE に **155 文字**足すと、注入は 8,918 文字から **1,326 文字**へ落ちる。7,600 文字が消える。

段階縮退が滑らかに効かない。このリポジトリには GOTCHAS が未作成で、ARCHITECTURE に `## ADR 一覧` も無い。縮退の第 1 段(gotchas を 0 件へ)・第 3 段(ADR 一覧を削除)は削るものを持たない。だから予算を 46 文字超えただけで段を落とし続け、第 4 段以降(ARCHITECTURE を目次と要約 1 行へ)まで一気に到達する。

**縮退は崖であって坂ではない。** しかも警告もエラーも出ない。「1 行足したら ARCHITECTURE が丸ごとコンテキストから消える」状態に、今このリポジトリは置かれている。
`─────────────────────────────────────────────────`

内容を確認する。

内容も確認できた。落ちた先は「目次 + 各節の要約 1 行」で、その要約は各節の先頭の箇条書きをそのまま取ったものである。「レイヤー構造: 依存の許される方向:」「規約: コードベースの探索は Serena のシンボルツールで行う。」のように、単独では意味をなさない断片になる。

指示のとおり、設計に入れる。

節番号がずれたので参照を直す。

## 答え

**入れられる。ただし今は入れられない。移行の後に回すべきで、設計書のステップ 13 に入れた。**

## なぜ今できないか(実測)

一時ディレクトリに ARCHITECTURE と config を複製し、`docs/prompts/` の記述を足して測った。

| | 文字数 |
| --- | --- |
| ARCHITECTURE への追加 | +155 |
| 注入(追加前) | 8,918 |
| 注入(追加後) | **1,326** |
| 失われた量 | **7,592** |

予算を 46 文字超えただけで、注入が 8 分の 1 以下に落ちる。

理由は段階縮退が滑らかに効かないことにある。このリポジトリは `harness-docs/GOTCHAS.md` が未作成で、ARCHITECTURE に `## ADR 一覧` も無い。縮退の第 1 段(gotchas を 0 件へ)と第 3 段(ADR 一覧を削除)は削る対象を持たない。だから段を落とし続け、第 4 段(ARCHITECTURE を目次と要約 1 行へ)まで一気に到達する。

落ちた先は各節の先頭の箇条書きを 1 行ずつ並べたもので、単独では意味をなさない。

```
- レイヤー構造: 依存の許される方向:
- 規約: コードベースの探索は Serena のシンボルツールで行う。
```

## 単にツリーに 1 行足すだけでは足りない

ARCHITECTURE の `## ディレクトリ構成と責務` には次の規律がある。

> `docs/` は読まない。

`docs/prompts/` に置いた起動プロンプトは、実装セッションが読むことを前提にしている。ツリーに追加するだけでは、「置き場は定義されているが読むことは禁じられている」という矛盾が残る。`docs/chat/` が例外として扱われているのと同じ形にする必要がある。

## 設計書へ入れた内容

**§12-2「縮退は坂ではなく崖である」を新設。** 上の実測値と、リポジトリを書き換えずに再現する手順を残した。既存の §12-2 は §12-3 へ繰り下げ、参照を追随させた。

**ステップ 13 に 3 点を追加。** 移行で 3,730 文字が空いた後に、`stage-architecture` 経由で行う。

1. ツリーに `.claude/rules/metatron/` を追加
2. ツリーに `docs/prompts/` を追加(責務は「別セッションの起動プロンプトを置く」)
3. 「`docs/` は読まない。」を `docs/prompts/` を例外とする形に書き換え、`docs/chat/` と同じ扱いにする

遅らせる理由も併記した。

`★ Insight ─────────────────────────────────────`
この実測は、設計の動機づけそのものを変える。§2-3 で「注入予算に余裕が戻る」を 3 番目の利得として挙げていたが、快適さの話ではなかった。

**このリポジトリは今、ARCHITECTURE に 1 行足すと全文がコンテキストから消える状態にある。** 警告もエラーも出ないので、消えたことに誰も気づかない。移行は「余裕を作る」のではなく「崖から離れる」作業である。
`─────────────────────────────────────────────────`

なお実装プロンプトの側でも、区間 3 の完了報告で §12-3 の実測を求める記述に、縮退が崖であることへの注意を足した。

設計書と実装プロンプトの両方を更新した。次の指示を待っている。

# phyllis998

> .claude/rules/metatron/がツリー二追加されるのであれば、.claude/context-maps/も追加したいです

## セッション 10: context-maps追加判断の確認

# AI

`.claude/` を親に立てるなら、そこに何を並べるかを決める必要がある。書式契約は「実装エージェントが置き場を迷うディレクトリに絞る。全ディレクトリを網羅しない」と定めている。

現状と追跡状態を確認する。

`.claude/context-maps/` は **gitignore されている**(`.gitignore:13`)。ローカル専用の作業ディレクトリで、共有資産ではない。`.claude/agents/` も追跡外で、SessionStart フックが生成する GPT/Grok の定義が入る。

追加後の予算を実測する。移行後の状態を再現して測る。

実測できた。**4 つとも余裕で収まる。**

| 段階 | ARCHITECTURE | 注入 | 残り予算 |
| --- | --- | --- | --- |
| 現在 | 8,204 | 8,918 | **82** |
| 3 節を移行した後 | 4,471 | 5,185 | 3,815 |
| ツリー追記(+286)後 | 4,757 | **5,471** | **3,529** |

縮退なし。移行が空ける 3,730 文字に対して、追記は 286 文字にすぎない。

設計書に反映する。

設計書のステップ 13 に入れた。

## 追加するツリー

```
├── .claude/
│   ├── rules/metatron/              metatron が管理する規律を置く
│   └── context-maps/                セッションの探索成果物を置く(git 追跡外)
├── docs/                            人間向けの文書と会話記録を置く
│   └── prompts/                     別セッションの起動プロンプトを置く
```

## `.claude/` 配下をこの 2 つに絞った理由

書式契約(`architecture-format.md`)が `## ディレクトリ構成と責務` に対して「実装エージェントが置き場を迷うディレクトリに絞る。全ディレクトリを網羅しない」と定めている。

`.claude/` には他に `settings.json`・`output-styles/`・`worktrees/`・`agents/` があるが、いずれも挙げない。前 3 つは Claude Code の規約どおりの位置で迷いが生じない。`.claude/agents/` は SessionStart フックが生成するもので、人が置き場を選ぶ対象ではない。

## `git 追跡外` を併記した理由

`.claude/context-maps/` は `.gitignore:13` で除外されている。ローカルに 5 件以上の context-map があるが、追跡されているのは `.claude/` 配下では `output-styles/EnhancedClaude5.md` と `settings.json` の 2 つだけである。

`context-map-guide.md` は「`.claude/context-maps/` を git 追跡するかはプロジェクト判断」としており、このリポジトリは追跡しない側を選んでいる。ツリーに責務だけ書いて追跡状態を書かないと、これを知らないエージェントが context-map をコミットしようとする。

## 数値を実測値へ差し替えた

設計書の §12 に書いていた移行後の見積もり 4,474 を、実測値 4,471 に直した。3 節を実際に取り除いて測った値である。見積もりのまま残っているのは CLI 案内の増分 150 だけで、その旨を明記した。

`★ Insight ─────────────────────────────────────`
この追記の可否そのものが、移行の効果を測る物差しになっている。

移行前は 155 文字の追加で注入が 8 分の 1 に崩れた。移行後は 286 文字を足しても残り 3,529 文字ある。**同じ性質の変更が、移行の前後で「壊す」から「余裕で入る」に変わる。**

ARCHITECTURE は本来こうやって育てるものである。今は 1 行も足せない状態で凍っていた。

いくつか事実が出た。**判断の前に確かめるべきことがある。**

## 実態

| 項目 | 値 |
| --- | --- |
| リポジトリの公開設定 | **PUBLIC**(GitHub) |
| context-map の件数 | 5 |
| 1 件あたりの大きさ | 12KB 〜 25KB |
| 最新の作成日 | **2026-08-02** |
| それ以降のコミット数 | **143** |
| `docs/chat/` の追跡ファイル数 | 77(公開されている) |

**3 週間・143 コミットのあいだ、context-map が 1 件も作られていない。** このセッションでも作っていない。私が作らなかった。設計・複数ファイル横断・影響範囲の把握を伴う作業で、`context-map-guide.md` の作成条件に該当していたにもかかわらずである。

## 推奨: 今は外さない

追跡が悪いからではない。**追跡の可否を決める前に、先に決まっていないことが 2 つある**からである。

### 1. context-map と設計書の役割が重なっている

`context-map-guide.md` が map に求めるセクションは、現在の構造・関連モジュール・既存パターン・影響範囲・既存契約・未解決事項・テスト方法である。

このセッションで書いた設計書(61KB)は、そのほぼ全部を含んでいる。§9(既存契約)・§14(影響範囲)・§15(テスト)・§17(未解決事項)がそれにあたる。別に map を作れば重複する。

運用が 08-02 で止まったのは、作業の形が `harness-docs/design/` の設計書へ移ったからではないか。だとすれば、追跡の可否より先に「context-map は設計書と別に要るのか」を決める必要がある。

### 2. 蒸留の規律が効いていない

guide は「map を小さく(蒸留された状態に)保つことが最優先の規律である」と定めている。実態は 1 件 12KB〜25KB で、ARCHITECTURE 全体(8KB)より大きい。蒸留されていない。

追跡は「残す」判断である。残すに値する状態にしてから決めた方がよい。

## 判断を左右する軸

| 軸 | 追跡する | 追跡しない(現状) |
| --- | --- | --- |
| 別クローン・別マシンからの参照 | できる | できない |
| 古い map の誤誘導 | **残り続ける。** ARCHITECTURE の更新規律も GOTCHAS の `[解決済み]` タグも ADR の `廃止` 状態も、context-map には無い | ローカルなので自然に消える |
| 公開範囲 | **PUBLIC リポジトリに探索の未解決事項が載る。** ただし `docs/chat/` が既に公開されているので、一貫性の観点では弱い | 出ない |
| 量 | 1 件 12〜25KB が恒久的に積む | 積まない |
| 実運用 | 3 週間 0 件。追跡しても中身が増えない | 同じ |

## 追跡するなら先に決めること

外す判断をするなら、同時に失効の規律を決めるべきである。context-map には ARCHITECTURE・GOTCHAS・ADR が持つ「古くなったものの扱い」が無い。

- いつ消すか(タスク完了時・N 日経過・次の map 作成時)
- 誰が消すか
- 消さずに残す場合、古いことをどう示すか

これを決めずに追跡すると、ARCHITECTURE と食い違う古い構造説明が公開リポジトリに積み上がる。

## 設計書の扱い

ステップ 13 のツリーには現在こう書いている。

```
│   └── context-maps/                セッションの探索成果物を置く(git 追跡外)
```

判断が決まるまでこのままにする。追跡する結論になったら「(git 追跡外)」を外し、代わりに失効の規律を `## 規約`(移行後は `conventions.md`)へ書く必要が出る。決まったら教えてほしい。

context-map の追跡についての判断を待っている。

# phyllis998

> であれば、一旦そもそもの存在意義を見直していきたいので、.gitignoreから削除しないし、ARCHITECTUREのツリーにも載せないようにしたいです
