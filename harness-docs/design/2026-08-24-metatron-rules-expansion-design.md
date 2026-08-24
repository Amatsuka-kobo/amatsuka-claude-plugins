# metatron: 管理対象文書を `.claude/rules/` へ拡大する(設計書)

- 作成日: 2026-08-24
- 状態: レビュー待ち
- 入力: `harness-docs/design/2026-08-24-metatron-rules-expansion.md`(引き継ぎ書)
- 適用範囲: `plugins/metatron/`、`harness-docs/ARCHITECTURE.md`、`CLAUDE.md`、契約凍結文書

## 1. この文書の位置づけ

引き継ぎ書が「設計時に決めること」として残した 5 項目を確定させる。実装計画書(WBS)と実装は別セッションで扱う。

引き継ぎ書の記述のうち、本書で更新したものが 3 点ある。§2-2 と §18 に記す。

## 2. 目的と前提

### 2-1. 目的

metatron が管理する文書を、ARCHITECTURE と GOTCHAS の 2 つから、`.claude/rules/` 配下を加えた 3 種へ拡大する。

ARCHITECTURE の `## 規約`・`## 保護パス`・`## テスト方針` は、性質としては「セッションを通して守らせたいこと」である。Claude Code はこの種の指示を `.claude/rules/` で扱う。ARCHITECTURE は「プロジェクトの構造を記述する文書」であり、規律の置き場としては役割が違う。

### 2-2. 実測で確定した前提

引き継ぎ書は「rules の注入方式(全文注入か、条件に一致したときだけか)を設計時に決める」としていたが、一次情報の確認により**選択の余地が無い**ことが判明した。

公式ドキュメント([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory))の記述:

- `All .md files are discovered recursively, so you can organize rules into subdirectories like frontend/ or backend/`
- `Rules without paths frontmatter are loaded at launch with the same priority as .claude/CLAUDE.md.`
- `Path-scoped rules trigger when Claude reads files matching the pattern, not on every tool use.`
- 公式に定義された frontmatter キーは `paths` のみである。`description` / `globs` / `alwaysApply` の一次情報は存在しない。

移行対象の 3 節はいずれも `paths` 付き(条件付き)では成立しない。

| 節 | `paths` 付きが成立しない理由 |
| --- | --- |
| 保護パス | そのファイルを触る前に要る。`paths` 付きは Read の後にしか効かず、Write しかしない経路では一度も発火しない |
| テスト方針 | 新規テストの置き場を決めるときに要る。まだ存在しないファイルのパスにはマッチしない |
| 規約 | 常時適用が要る |

したがって 3 節とも frontmatter を持たない(unscoped)ファイルとする。**注入の総量は減らない。**

サブディレクトリ配下の rules が起動時に読み込まれること、およびそれがサブエージェントのコンテキストにも載ることは、いずれも実測で確認した。測定日は 2026-08-24、対象は Claude Code 2.1.241 である。手順と結果は §17-1(サブディレクトリの起動時読み込み)と §17-2(サブエージェントへの到達)に残す。

### 2-3. この変更で得るもの

1. **サブエージェントへ規律が届くようになる。** これが最大の利得である。

   公式ドキュメント([code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents))は、サブエージェントに読み込まれるものとして `every level of the CLAUDE.md hierarchy the main conversation loads, including ~/.claude/CLAUDE.md, project rules, CLAUDE.local.md, and managed policy files. The built-in Explore and Plan agents skip this.` を挙げる。

   一方 metatron の SessionStart 注入はサブエージェントに届かない。SessionStart はセッション開始時のイベントであり、サブエージェントはセッションではないためである。

   現状、実装や探索をサブエージェントへ委譲すると、`## 規約`(git 運用・Done の条件・探索と編集の規律)も `## 保護パス`(バンドル出力を手で編集しない、等)も届いていない。依頼文へ手で転記しない限り、サブエージェントはこれらを知らずに作業している。3 節を rules へ移すと、これが自動的に解消する。

   公式ドキュメントの `project rules` という語が `.claude/rules/` を指すかは文面から確定できないため、実測で裏づけた。手順と結果は §17-2 に残す。この挙動は Claude Code の更新で変わりうるため、§15 に回帰プローブを置く。

2. **metatron の沈黙縮退の対象外になる。** 縮退は `injection.maxChars` に対して起きるが、rules は Claude Code 本体が読むため metatron の予算勘定の外にある。規約が黙って消える故障モードが無くなる。

3. **注入予算に余裕が戻る。** 数値は §12 に示す。

4. **役割の分離。** ARCHITECTURE は構造の記述、rules は守らせる規律となる。

### 2-4. この変更で得ないもの

- **コンテキスト消費の削減。** 3 節とも unscoped で、Claude Code が起動時に全文を読む。メインセッションの消費量は移行前と変わらない。サブエージェントへ委譲すると、委譲した回数だけ同じ本文が追加で読み込まれるため、セッション全体では増える。この増分は §2-3 の 1 と表裏の関係にあり、規律が届く範囲を広げる対価である。執筆上の帰結は §13-3 に書く。
- **compact 耐性の改善。** metatron の SessionStart hook は `matcher` を指定していない。Claude Code の hooks reference は `"*", "", or omitted → Match all → fires on every occurrence of the event` と定めており、source の値域には `compact` が含まれる。したがって現状でも compact 後に再注入される。この点で rules に優位は無い。

## 3. 引き継ぎ書の 5 項目への回答

| # | 引き継ぎ書の項目 | 決定 | 節 |
| --- | --- | --- | --- |
| 1 | rules のファイル分割の単位 | `.claude/rules/metatron/` 配下に 3 ファイル固定 | §4 |
| 2 | rules の注入方式 | metatron は注入しない。読み込みは Claude Code 公式機構に委ねる。ファイルは frontmatter を持たない | §4・§12 |
| 3 | `stage-architecture` の削除モードか参照案内か | 削除を足す。専用の移行コマンドは作らない | §6-2・§8-3 |
| 4 | 既存プロジェクトの移行経路 | **不要。** metatron はまだ利用者を持たない。移行対象はこのリポジトリ 1 つで、§8 の手順を一度実行して終わる | §8-3 |
| 5 | `/metatron:init` のウォークスルーでの扱い | ARCHITECTURE 6 節 + rules 3 ファイルの 9 単位。対話回数は現在と同じ | §11 |

移行対象は当初案の 2 節ではなく、`## テスト方針` を加えた 3 節とする。

## 4. 配置と識別

```
<docRoot>/.claude/rules/metatron/
├── conventions.md        ← 旧 ## 規約
├── protected-paths.md    ← 旧 ## 保護パス
└── testing-policy.md     ← 旧 ## テスト方針
```

### 4-1. サブディレクトリを使う理由

`.claude/rules/` は `.md` を再帰的にすべて読む。metatron が書くファイルとユーザーが手で置くファイルが同じ名前空間に同居するため、metatron が自分の管理対象を判別できる必要がある。判別できないと、guard hook がユーザーの手書き rules まで編集拒否するか、逆に metatron の rules が手で書き換えられても検知できない。

専用サブディレクトリを使うと、判定がパスの接頭辞一致だけで済む。`.claude/rules/` 直下に固定名で置く案は、`conventions.md` のような汎用名がユーザーの既存ファイルと衝突しうる。frontmatter に独自キーを書いて識別する案は、公式に定義のないキーの扱いに一次情報が無く、guard hook が毎回すべての rules を開いて読む必要が生じる。

判定は**解決済みパスのディレクトリ包含**で行う。文字列の接頭辞一致で比較すると、`.claude/rules/metatron-extra/foo.md` のようなユーザーの手書きファイルが `.claude/rules/metatron` に前方一致し、guard が誤って拒否する。比較の前に両者を `fs.realpathSync` で実体パスへ解決し、区切り文字を `/` へ正規化したうえで、対象が当該ディレクトリの直下にあるかを判定する。既存の guard hook が `architecturePath` / `gotchasPath` に対して行っている realpath 解決と同じ方針である。

ARCHITECTURE と GOTCHAS は「1 文書 = 1 パス」だったためこの問題を持たなかった。**1 つの管理単位が複数のファイルに分かれることが、本変更の実装上の新規性である。** ARCHITECTURE が複数のセクションを持つことと混同しない。セクションは 1 ファイルの中にあり、書き込み先のパスは常に 1 本だった。

### 4-2. ファイル名は固定する

3 ファイルの名前と、それぞれに書く内容は書式契約(`references/rules-format.md`)で固定する。config では変えない。

固定にすると、書式契約が各ファイルの内容規範を持てる。`references/architecture-format.md` が現在 3 節に対して定めている規範を、そのまま移設できる。`/metatron:init` の対話単位も確定する。

3 ファイルに収まらない規律は、`.claude/rules/` 直下にユーザーが自由に置ける。metatron はそれらに干渉しない。

### 4-3. frontmatter を書かない

3 ファイルとも frontmatter を持たない。unscoped にするには frontmatter 自体が不要であり、公式に定義されたキーは `paths` だけだからである。未定義キーの扱いには一次情報が無いため、依存しない。

### 4-4. 冒頭の管理者表示

各ファイルの本文冒頭に、metatron 管理であることと更新手段を示す 1 行を置く。CLI の絶対パスはインストール先で変わるため書かず、「注入文または拒否メッセージから取る」と案内する。

これにより、guard hook が拒否する前の段階で、読んだ AI が編集経路を知れる。

### 4-5. docRoot とプロジェクトルートのずれ

metatron の `docRoot` は `metatron.config.json` を持つ最も近い祖先、無ければ git ルート、それも無ければ開始ディレクトリで解決される(`references/config-schema.md`)。一方 `.claude/rules/` は Claude Code の起動ディレクトリを基準に読まれる。

両者がずれると、metatron が書いた rules が Claude Code に読まれない。`get config` の `warnings` にこのずれを載せる。

このリポジトリでは `docRoot` がリポジトリルートであり、両者は一致している。

## 5. config スキーマの変更

`paths` に 1 キーを追加する。

```json
{
  "version": 1,
  "paths": {
    "architecture": "docs/ARCHITECTURE.md",
    "gotchas": "docs/GOTCHAS.md",
    "rulesDir": ".claude/rules/metatron"
  },
  "injection": {
    "enabled": true,
    "gotchasRecentCount": 5,
    "maxChars": 9000
  }
}
```

| キー | 型 | 既定値 | 意味 |
| --- | --- | --- | --- |
| `paths.rulesDir` | string | `.claude/rules/metatron` | metatron が管理する rules の置き場 |

- `docRoot` からの相対パスとして解決する。既存の `architecture` / `gotchas` と同じ拒否規則(絶対パス・`docRoot` の外へ出るパス・空文字列・文字列でない値)を適用する。
- 拒否したときはこの項目だけを既定値へ落とし、理由を `warnings` へ積む。

`ResolvedConfig` に `rulesDir` フィールドを足し、3 ファイルの絶対パスを導出できるようにする。

## 6. CLI の追加

| サブコマンド | 種別 | 返すもの |
| --- | --- | --- |
| `get rules [--name <名前>]` | 読 | 3 ファイルの内容と存在状況、または指定ファイルの本文 |
| `stage-rules --input <path>` | 段階 | diff と `stagingId`。書き込みはしない |
| `commit-rules --staging-id <id>` | 書 | `stagingId` を消費して書き込む |

併せて `stage-architecture` に**節の削除**を足す。移行専用のコマンドは作らない。理由は §8-3 に書く。

### 6-1. `stage-rules` の入力

```json
{ "name": "conventions", "body": "...", "reason": "更新の理由" }
```

- `name` は `conventions` / `protected-paths` / `testing-policy` のいずれか。未知の名前は拒否する。一覧は `get config` の `inputSchemas["stage-rules"].names` から取る。
- `body` は本文。`# 見出し` を含む完全なファイル内容とする。ARCHITECTURE のセクション本文と違い、見出し行を含む。
- `reason` は任意。
- **1 回の `stage-rules` で扱うのは 1 ファイルだけとする。** 複数ファイルをまとめる案は採らない。理由は §7 に書く。

### 6-2. `stage-architecture` の削除指定

```json
{ "sections": [{ "heading": "規約", "remove": true }], "reason": "rules へ移した" }
```

- `remove: true` のとき `body` を書かない。両方を書いたら拒否する。
- **`remove` の検証は見出し許可リストではなく、対象ファイルに当該セクションが存在するかで行う。** 内容を書くわけではないので、許可リストに載っている必要がない。この規則により、許可リストから外した見出しの節も削除できる。
- 存在しないセクションの削除は拒否する。何も起きなかったことを成功として返さない。
- `AppliedChange` の `mode` に `"removed"` を足す。

### 6-3. `commit-architecture` は改名しない

`commit-architecture` の名前は注入文・`get config` の `cli` オブジェクト・guard hook の拒否メッセージに載っている。改名は波及が大きい割に得るものがない。

rules 用に `commit-rules` を新設し、staging を消費する内部ロジックは共有する。

### 6-4. `get rules` の応答

読み取り経路であり、常に exit 0 で返す。ファイルが未作成であることは `error: "not_created"` として返し、異常として扱わない(既存の読み取り系と同じ規約)。

## 7. staging の契約は変えない

staging レコードは単一の `targetPath` と `nextContent` のままとする。複数ターゲットへは拡張しない。

`StagingKind` に `"rules"` を足すだけである。

### 7-1. 複数ターゲットを採らない理由

当初は rules 3 ファイルを 1 つの staging で扱う案を採っていた。承認を 1 回に減らすためである。これを採らない。

複数ターゲット化は `references/cli-usage.md` の保証を 1 つ壊す。

> 書き込み系が非 0 で終わったとき、対象ファイルは 1 バイトも変わっていない。

複数ファイルを順に書く以上、途中で失敗した状態が生まれる。この保証は metatron の中核であり、失う対価として得られるのは承認回数の削減だけである。

承認回数は次のとおりで、いずれも許容できる。

| 場面 | 承認回数 |
| --- | --- |
| `/metatron:init` | 4 回(ARCHITECTURE 1 + rules 3) |
| rules 1 ファイルの更新 | 1 回 |
| 移行(一度きり) | 4 回(rules 3 + ARCHITECTURE の削除 1) |

`/metatron:init` は既にセクション単位で 9 回の対話を行う。最終の承認が 1 回から 4 回に増えることは、この流れの中で不自然ではない。

## 8. 移行の手順

移行専用のコマンドを作らない。§6 の CLI だけで足りる。

### 8-1. 手順

1. `stage-rules` で `conventions` を書く。diff を提示して承認を得る。`commit-rules`。
2. 同じ手順で `protected-paths`。
3. 同じ手順で `testing-policy`。
4. `stage-architecture` で 3 節を `remove: true` として消す。3 節は 1 つの staging に入る(対象ファイルが 1 つのため)。diff を提示して承認を得る。`commit-architecture`。

本文は ARCHITECTURE の該当節から機械的に写す。推敲は別に行う(§13-3)。

### 8-2. 順序

**rules を先に書き、ARCHITECTURE から後で消す。**

途中で止まっても「規約が rules と ARCHITECTURE の両方にある」= 重複で終わる。逆順にすると、ARCHITECTURE から消した後に止まったとき規約が失われる。

各ステップは単一ターゲットの staging であり、それぞれ「非 0 で終わったら 1 バイトも変わっていない」保証を持つ。中断しても部分的に壊れた状態は生まれない。やり直しは、まだ済んでいないステップから続ければよい。

### 8-3. 専用の移行コマンドを作らない理由

metatron はまだ利用者を持たない。移行の対象はこのリポジトリ 1 つで、一度実行したら二度と使われない。

そのためのサブコマンドを CLI に足すと、実装・テスト・書式契約・参照文書のすべてに、使われないまま残る面が増える。**一度しか使わない処理のために恒久的な口を開けることは、metatron の hook を迂回する一時スクリプトを書くことと、残るものが違うだけで動機は同じである。**

代わりに `stage-architecture` へ節の削除を足す。これは移行装置ではなく、書き込み経路が本来持つべき能力である。節構成を変えるときに再び使う。`replaced` が既に前の本文を破棄している以上、削除が新たに壊す不変条件もない。

利用者を持つ段階に入ってから節構成を変えるときは、そのとき改めて移行の手段を設計する。今それを先取りしない。

## 9. 見出し許可リストの変更

### 9-1. 変更内容

- `ARCHITECTURE_HEADINGS`(`src/lib/architecture.ts`)と `ARCHITECTURE_SECTIONS`(`src/lib/scan.ts`)から 3 節を削除し、10 節から **7 節**にする。
- `MOVED_HEADINGS`(見出し名 → rules ファイル名の対応)を定義する。**検証には使わない。**エラーメッセージを分かりやすくするためだけに使う。
- `stage-architecture` に 3 節の `body` を渡したときは `unknown_heading` で拒否し、メッセージで移行先の rules ファイル名を示す。
- **`remove: true` はこの制限を受けない。** 削除の検証は対象ファイルにセクションが存在するかで行い、許可リストを参照しない(§6-2)。移行時に 3 節を消せるのはこのためである。

### 9-2. 2 箇所を同じコミットで直す

`ARCHITECTURE_HEADINGS` と `ARCHITECTURE_SECTIONS` は import 関係のない独立複製であり、同期機構を持たない。片方だけを直すと「`stage-architecture` は通るが `diff-architecture` が見落とす」という非対称な壊れ方をする。

### 9-3. 既存ファイルは読み続けられる

契約凍結文書 §4-2 が定めるセクション分割は、フェンス状態を持つ状態機械で `^## ` を検出するものであり、見出し許可リストとは独立している。許可リストは書き込みの検証にしか使われない。

したがって許可リストから 3 節を外しても、既存 ARCHITECTURE の 3 節は変わらずセクションとして読める。`stage-architecture` の `remove` が見つけて消せる。

### 9-4. 欠落検出の意味が変わる

読み取り側でも許可リストに依存する箇所が 1 つある。`src/lib/scan.ts` の欠落検出は `ARCHITECTURE_SECTIONS` の全件を走査し、存在しない見出しを `section_missing` として `diff-architecture` に載せる。

7 節化を同じコミットで行わないと、移行を完了したプロジェクトで `/metatron:update` が「3 節が欠落している」と報告し続ける。移行を促す案内と欠落の報告が同時に出るため、利用者は移行が失敗したと読む。

§9-2 で 2 箇所を同じコミットで直すとしたのは、書き込み側の非対称だけでなくこの偽陽性も理由である。

## 10. guard hook の変更

- 拒否対象に `rulesDir` 配下の 3 ファイルを追加する。パスは `loadConfig` 由来であり、config に `rulesDir` が載れば判定は自動的に拡張される。
- 拒否メッセージに `stage-rules` / `commit-rules` を追記する。
- `.claude/rules/` の**それ以外**のファイルは拒否しない。ユーザーの手書き rules は自由に編集できる。
- **拒否対象は固定 3 ファイルのパスに限る。** `rulesDir` 配下であっても、`.md` 以外のファイルや 3 ファイル以外の `.md` は拒否しない。管理対象は 3 ファイルであり、ディレクトリ全体ではないためである。
- matcher は `Edit|Write|NotebookEdit` のまま変えない。`rm` などシェル経由の削除は塞がらない。これは ARCHITECTURE と GOTCHAS でも同じであり、本変更で新たに生じる穴ではない。

## 11. `/metatron:init` と `/metatron:update` の変更

### 11-1. init

対話の単位は次のとおりで、確認回数は現在の 9 回から変わらない。

| 対象 | 単位数 |
| --- | --- |
| ARCHITECTURE(`ADR 一覧` を除く) | 6 |
| rules | 3 |
| 合計 | 9 |

`capturing-architecture` スキルの手順を、「セクション」から「ドラフト単位」へ読み替える。単位ごとにドラフトを提示して確定させ、全単位の確定後に `stage-architecture` と `stage-rules` を発行し、それぞれ diff を全文提示して承認を得てから commit する。

rules の 3 単位はコードベース解析から起草できない(規律は実装から読み取れない)。既定のドラフトを提示して確認する形にする。これは現在の `## 規約` の扱いと同じである。

### 11-2. update

乖離検出に 1 項目を追加する。

| 検出 | 条件 | 案内 |
| --- | --- | --- |
| rules 未作成 | `rulesDir` 配下の 3 ファイルのいずれかが存在しない | `stage-rules` |

「ARCHITECTURE に移行対象の 3 節が残っている」という未移行の検出は置かない。metatron は利用者を持たず、移行の対象はこのリポジトリ 1 つだからである。移行を終えれば、その状態は二度と現れない。

`stage-architecture` が 3 節の `body` を拒否し、移行先を案内する(§9-1)。3 節が書き戻されるのはこれで防げる。

## 12. 注入への影響

metatron は rules 本文を注入しない。`inject-context.ts` は ARCHITECTURE と GOTCHAS のままとする。

CLI 案内に rules 系サブコマンドを追記する(約 +150 文字)。編集を試みて拒否される前に、更新経路が分かるようにするためである。

2026-08-24 時点の実測値と、移行後の見積もり。

| 項目 | 現在 | 移行後 |
| --- | --- | --- |
| `harness-docs/ARCHITECTURE.md` | 8,204 | 4,471 |
| CLI 案内ほか | 714 | 約 864 |
| 注入合計 | 8,918 | 約 5,335 |
| `injection.maxChars` までの残り | 82 | 約 3,665 |

移行後の 4,471 は、3 節を実際に取り除いて測った値である。CLI 案内の増分 150 だけが見積もりである。

ステップ 13 で `## ディレクトリ構成と責務` へ 3 項目を追記する(`.claude/rules/metatron/`・`docs/prompts/`・`docs/` の読み取り例外)。この追記を含めた実測は次のとおりで、縮退は起きない。

| 項目 | 文字数 |
| --- | --- |
| ARCHITECTURE(移行後・追記込み) | 4,677 |
| 注入合計 | 5,391 |
| 残り予算 | 3,609 |

移行する 3 節の内訳は、保護パス 1,719・規約 1,481・テスト方針 530 の計 3,730 文字である。

現在の残り予算 82 文字は、ARCHITECTURE に 1 行足せば縮退が起きる位置にある。縮退は警告もエラーも出さず、第 4 段で ARCHITECTURE が目次と各節の要約 1 行へ落ちる。

### 12-1. 数値の出典

- 「注入合計」は `echo '{}' | node plugins/metatron/scripts/inject-context.mjs` を実行し、`hookSpecificOutput.additionalContext` の `String.length` を数えた値である。測定日は 2026-08-24。
- ARCHITECTURE と各節の文字数は、ファイルを UTF-8 で読み、`^## ` で分割して各区間の `String.length` を数えた値である。バイト数ではない。
- 引き継ぎ書は ARCHITECTURE を 8,116 文字としているが、これは引き継ぎ書の執筆時点の値である。その後 ARCHITECTURE が更新されて 8,204 文字になった。測定方法の違いではない。
- 「CLI 案内ほか」の移行後の値 864 は**見積もりである**。追加する rules 系サブコマンドの案内文をまだ書いていないため、実測できない。

### 12-2. 縮退は坂ではなく崖である

このリポジトリで実測した。ARCHITECTURE に **155 文字**を足すと、注入は **8,918 文字から 1,326 文字へ落ちる**。7,592 文字が消える。

段階縮退が滑らかに効かない。このリポジトリは `harness-docs/GOTCHAS.md` が未作成で、ARCHITECTURE に `## ADR 一覧` も無い。縮退の第 1 段(gotchas を直近 0 件へ)と第 3 段(ADR 一覧を削除)は削る対象を持たない。予算を 46 文字超えただけで段を落とし続け、第 4 段(`arch=outline`)まで一気に到達する。

落ちた先の内容は「目次と各節の要約 1 行」であり、要約は各節の先頭の箇条書きをそのまま取ったものである。単独では意味をなさない。

```
- レイヤー構造: 依存の許される方向:
- 規約: コードベースの探索は Serena のシンボルツールで行う。
```

**現状は「ARCHITECTURE に 1 行足すと全文がコンテキストから消える」状態である。**警告もエラーも出ない。§2-3 の 3(注入予算に余裕が戻る)は、快適さの話ではなくこの崖から離れる話である。

再現手順は次のとおり。リポジトリを書き換えずに測れる。

```bash
mkdir -p /tmp/inj-probe/harness-docs
cp metatron.config.json /tmp/inj-probe/
cp harness-docs/ARCHITECTURE.md /tmp/inj-probe/harness-docs/
# /tmp/inj-probe/harness-docs/ARCHITECTURE.md を編集してから
echo '{"cwd":"/tmp/inj-probe"}' | node plugins/metatron/scripts/inject-context.mjs
```

### 12-3. 実装後に実測する

見積もりが外れる可能性があるため、実装の完了条件に次を含める。

- `inject-context.mjs` を実行し、`additionalContext` の文字数が `injection.maxChars` を下回ることを確認する。
- 同じ出力に文字列 `を Read すること` が含まれないことを確認する。含まれていれば縮退している。

縮退は警告もエラーも出さないため、この確認を省略すると気づけない。

## 13. 書式契約と執筆規律

rules の内容は 2 つの文書が規定する。何を書くかは `references/rules-format.md`、どう書くかは `references/writing-discipline.md` が持つ。ARCHITECTURE における `architecture-format.md` と `writing-discipline.md` の関係をそのまま踏襲する。

### 13-1. `references/rules-format.md`(新設)

- ファイル名と、それぞれに書く内容の対応(3 ファイル固定)。
- 各ファイルの本文の書き方。`references/architecture-format.md` が現在 `## 保護パス`・`## 規約`・`## テスト方針` に対して定めている規範をそのまま移設する。
- frontmatter を書かないこと。
- 冒頭の管理者表示行の書式。
- 分量の目安。**公式が rules に定めた上限は存在しない。**公式ドキュメントは CLAUDE.md について `target under 200 lines per CLAUDE.md file` を推奨しており、rules は起動時に同じ優先度で読み込まれるため、運用上の目安としてこの値を借りる。metatron 側の判断であって公式仕様ではない。
- `.claude/rules/` 直下のユーザーの手書きファイルには metatron が干渉しないこと。

`references/architecture-format.md` は 10 節から 7 節へ変更し、削除した 3 節について「rules へ移した」ことと移行手段を注記する。

### 13-2. `references/writing-discipline.md` の適用

rules の本文にも執筆規律を適用する。適用の強さは、移行前に 3 節が受けていたもの(削る基準を強く適用)を維持する。

変更点は次のとおり。

- 表題を `# ARCHITECTURE / GOTCHAS / rules の執筆規律` へ変える。
- 冒頭の適用対象に rules の本文を加える。
- §適用の強さ の表から `## テスト方針` / `## 保護パス` / `## 規約` を外し、rules の 3 ファイルを「削る基準を強く適用」の区分に置く。

| 区分 | 対象 | 適用 |
| --- | --- | --- |
| 削る基準を強く適用 | ARCHITECTURE の残り 6 節(`## ADR 一覧` を除く)、rules の 3 ファイル | 全文が常時読み込まれる。根拠・経緯・言い換えを残さない |
| 根拠系フィールドのみ例外 | `## ADR 一覧` の `背景` / `検討した選択肢` / `理由`、GOTCHAS の `原因 (推測)` | 変更なし |

- §図の基準 の「図は常時注入される」は、rules について「起動時に読み込まれ、サブエージェントにも渡る」と読み替える。rules に Mermaid 図を置くことは想定しないため、基準そのものは ARCHITECTURE 向けのまま据え置く。

### 13-3. rules では削る基準がより強く効く

3 節が ARCHITECTURE にあったときは、メインセッションに 1 回載るだけだった。rules へ移すと、メインセッションに加えてサブエージェントのコンテキストにも載る(§2-3)。1 セッションで複数のサブエージェントへ委譲すれば、その回数だけ同じ本文が読み込まれる。

規律が届く範囲が広がることは本変更の目的であり、その対価として同じ本文の読み込み回数が増える。したがって「読んだ後にエージェントの振る舞いが変わる文だけを残す」という残す基準の判定を、移行時に 3 節すべてへ通す。

移行(§8)は本文を機械的に写すだけとし、この判定は `/metatron:update` から別に通す。移設と推敲を 1 つの diff に混ぜると、承認時に「移設による差分」と「推敲による差分」を区別できなくなるためである。

## 14. 追随先チェックリスト

`plugins/metatron/docs/format-change-checklist.md` に rules の項を追加したうえで、本変更では次をすべて同じコミットで追随させる。

### 14-1. metatron 内

- [ ] `src/lib/config.ts`(`rulesDir` の追加とパス解決)
- [ ] `src/lib/architecture.ts`(`ARCHITECTURE_HEADINGS` を 7 節へ、`MOVED_HEADINGS` の新設、`AppliedChange.mode` への `"removed"` 追加、`applySectionChanges` の削除分岐)
- [ ] `src/lib/scan.ts`(`ARCHITECTURE_SECTIONS` を 7 節へ)
- [ ] `src/lib/staging.ts`(`StagingKind` に `"rules"` を追加するだけ。単一ターゲットの構造は変えない)
- [ ] `src/lib/rules.ts`(新設。読み書きと書式検証)
- [ ] `src/cli/`(`get rules` / `stage-rules` / `commit-rules`、`stage-architecture` の削除指定)
- [ ] `src/cli/paths.ts`(`inputSchemas` に rules を露出)
- [ ] `src/guard-docs.ts`(拒否対象と拒否メッセージ)
- [ ] `src/inject-context.ts`(CLI 案内のみ)
- [ ] `references/rules-format.md`(新設)
- [ ] `references/architecture-format.md`(7 節へ)
- [ ] `references/writing-discipline.md`(表題・適用対象・適用の強さの表)
- [ ] `references/config-schema.md`(`rulesDir`)
- [ ] `references/cli-usage.md`(サブコマンド表、入力 JSON、`stage-architecture` の削除指定)
- [ ] `skills/capturing-architecture/SKILL.md`(ドラフト単位)
- [ ] `skills/updating-architecture/SKILL.md`(未移行検出)
- [ ] `docs/ARCHITECTURE.example.md`(3 節を削除)
- [ ] `docs/RULES.example.md`(新設)
- [ ] `docs/format-change-checklist.md`(rules の項)
- [ ] `README.md`(管理対象が 3 種になったこと)
- [ ] `.claude-plugin/plugin.json` と `package.json` のバージョン(マイナーを上げる)

### 14-2. metatron の外

- [ ] `harness-docs/design/2026-08-16-file-contract-freeze.md` の §4-1(10 節 → 7 節)・**§4-3(書き込み経路の列挙に `stage-rules` / `commit-rules` を追加)**・§7(文書パスの既定値に `rulesDir`)・新設する rules の節。§11 の保証は変えない
- [ ] `harness-docs/ARCHITECTURE.md`(3 節の削除。§8 の手順)
- [ ] `CLAUDE.md`(規約と保護パスとテスト方針の在り処)
- [ ] ルートの `README.md`

**codiel のスキルは追随が必要である。** 移行対象の 3 節を ARCHITECTURE から直接読む記述を持つ。既存の `plugins/metatron/docs/format-change-checklist.md:6-10` も、ARCHITECTURE の書式変更時に codiel の追随を要求している。

#### 監査の結果

TypeScript 実装とプロンプト層で結合の度合いが違う。

| 層 | ARCHITECTURE への依存 |
| --- | --- |
| `plugins/codiel/src/hooks/lib.ts` | ドメインマップのみ(`readDomainsResult`)。他はパス解決だけで中身の構造に触れない |
| `plugins/sandalphon/src/check-intent-env.ts` | 同上 |
| `plugins/agent-policy/` | 参照なし |
| codiel の skills / agents / commands | **節名を名指しする箇所が 13 件** |

codiel と metatron の分離は実装では達成されているが、プロンプト層では達成されていない。原因は追随を担保する仕組みの差である。実装には 3 者比較テストという機械的な検証があるが、skills の節名参照には登録も検証も無い。増えても気づけない。

#### 移行で壊れる箇所

| 深刻度 | 箇所 | 移行後の挙動 |
| --- | --- | --- |
| **停止** | `skills/scripting-tests/SKILL.md:32,51-53` | `## テスト方針` から E2E フレームワークを読む。無ければ**着手せず終了**する。test-loop の E2E スクリプト化が動かない |
| 誤動作 | `skills/orchestrating-runs/SKILL.md:38,96-97` | ベースブランチが常に `main` になる |
| 誤動作 | `skills/implementing/SKILL.md:21-23,31` | 節欠落を「必要」として扱うため、常にユニットテスト必須になる |
| 誤動作 | `skills/reviewing-diffs/SKILL.md:39-40` | `## コマンド定義` の欠落時のフォールバックが無い |
| 誤動作 | `agents/codiel-reviewer-doc.md:25` | `## 規約` と `## コマンド定義` との乖離確認が空振りする |
| 誤動作 | `agents/codiel-reviewer-data.md:29` | `## 保護パス` との整合確認が空振りする |
| 安全側 | `skills/running-regression-tests/SKILL.md:42,51,67-69` | ユニットテストの実行を省略し、green 判定が E2E のみへ縮退 |
| 安全側 | `skills/writing-dev-plans/SKILL.md:11,31,42,64` | 既存テストと `package.json` で代替 |
| 安全側 | `skills/initializing-harness/SKILL.md:111,113,150,169,182` | ユーザーへ質問する |
| 安全側 | `skills/initializing-harness/raguel.config.example.yaml:4` | コメントの記述が古くなるだけ |
| 安全側 | `CLAUDE.example.md:32-33,48` | 存在する節だけを転記する |
| 安全側 | `agents/codiel-tester.md:14` | `scripting-tests` 側の停止条件に従う |
| 安全側 | `skills/writing-design-docs/SKILL.md:27` / `skills/preparing-design-agendas/SKILL.md:20` | `## 技術スタック` が空になるだけ |

#### 追随の方針: 節名参照を削除する

codiel を rules へ向け直さない。**節名参照を消し、codiel が ARCHITECTURE の節構造に依存しない状態にする。**

理由は 2 つある。

1. **rules は自動適用される。** frontmatter を持たない rules は起動時にコンテキストへ載り、サブエージェントにも届く(§17-2・§17-3)。読みに行く経路は要らない。内容は既にそこにある。
2. **metatron が無い環境には rules も無い。** rules を書くのは metatron である。codiel が独立して使えるなら、その環境に rules は存在しない。存在しないものへの参照経路を codiel に持たせても、何も解決しない。

したがって各スキルは、次の形へ書き換える。

- 「ARCHITECTURE の `## テスト方針` 節を読む」→ 削除する。テストの要否・フレームワーク・配置は、コンテキストに宣言があればそれに従い、無ければ codiel 自身の手段で決める。
- 「ARCHITECTURE の「規約」節からベースブランチ名を読む」→ 削除する。コンテキストに宣言があればそれに従い、無ければ `main` とする。
- 「ARCHITECTURE の `## 保護パス` を読み、`raguel.config.yaml` と突き合わせる」→ 削除する。`raguel.config.yaml` を正本とし、初期化時にユーザーへ問う。
- `## ドメインマップ`(` ```json metatron:domains ` ブロック)への参照だけを残す。これは機械可読ブロックであり、実装が決定的に読む必要がある。

書き換え後、codiel の ARCHITECTURE への依存はドメインマップだけになる。分離の当初目標が、認識ではなく実態として成立する。

#### 「読む」から「コンテキストに従う」への変化

節を読む指示は決定的である。ファイルが在るか無いかで分岐が決まる。コンテキストに従う形はそうではない。宣言が載っていても、モデルがそれに注意を向けるとは限らない。

この差は受け入れる。理由は、決定性が要る箇所には別の正本が既にあるためである。

| 情報 | 決定性が要るか | 正本 |
| --- | --- | --- |
| ドメインマップ | 要る(実装のディスパッチ先を決める) | ARCHITECTURE の機械可読ブロック。読み続ける |
| 保護パス | 要る(Raguel の判定に効く) | `raguel.config.yaml`。codiel 自身の資産 |
| ベースブランチ | 要らない(誤れば `git switch` が失敗して気づく) | 既定 `main` |
| テストの要否・フレームワーク | 要らない(誤ればテストが落ちて気づく) | `package.json` からの推定とユーザーへの確認 |

#### 移行と独立に既に壊れている箇所

`skills/initializing-harness/SKILL.md:73` は、codiel 単体での初期化について「技術スタック・ディレクトリ構成・コマンド定義・テスト方針・規約は聞かない」と定める。ドメインマップだけの最小 ARCHITECTURE を生成するためである。

したがって **codiel 単体で初期化したプロジェクトには最初から `## テスト方針` が無い**。`scripting-tests` の無条件停止と `implementing` の一律「必要」は、そこで既に踏まれている。

この 2 件は本移行が作る故障ではない。本移行がするのは、これまで metatron 併用プロジェクトだけが避けられていた故障を全プロジェクトへ広げることである。

**修正を本設計に含める。** 同じスキルを追随で触るため、別扱いにすると同じファイルを 2 回開くことになる。ただしコミットは分ける。移行の追随と既存不具合の修正が同じ diff に混ざると、レビュー時に「移行に伴う変更」と「不具合の修正」を区別できなくなる。

修正の方針は次のとおり。metatron を併用しないプロジェクトでも成立させる。

- [ ] `skills/scripting-tests/SKILL.md` — E2E フレームワークの解決順を「コンテキストに宣言があればそれ → `package.json` の devDependencies から推定 → ユーザーへ問う」とする。無条件停止をやめる。推定で決めた場合はその旨をレポートに書く
- [ ] `skills/implementing/SKILL.md` — ユニットテストの要否も同様にする。宣言が見つからないときに「必要」として扱う既定は維持する(安全側であるため)が、フレームワークと配置は推定へ落とす

この修正は §14-2 の「節名参照を削除する」と同じ作業になる。節を読まなくするには、読めなかったときの手段を用意する必要があるためである。移行の追随と既存不具合の修正は、別々の変更ではなく 1 つの変更の表と裏である。それでもコミットは分ける。移行に伴う削除と、フォールバックの新設は、レビューで区別できた方がよい。

### 14-3. 追随が不要と判断したもの

**codiel と sandalphon の config 実装の写し**(`plugins/codiel/src/hooks/lib.ts` の `findDocRoot` / `resolveDocPaths`、`plugins/sandalphon/src/check-intent-env.ts`)は追随不要とする。`references/config-schema.md` が「未知キーは無視する」と定めているため、`paths.rulesDir` は両者の実装で自動的に無視される。両者は rules のパスを解決しない。3 者比較テスト(metatron の R4 / sandalphon のケース 16f)の対象にも入れない。

**この判断は config 実装に限る。** codiel のスキルは §14-2 のとおり追随が必要である。sandalphon のスキルと参照文書には移行対象 3 節への参照が無いことを確認済みである。`plugins/agent-policy/` にも参照は無い。

契約凍結文書は「本書の内容を変更する必要が生じたときは、実装を止めてユーザーに確認する」と定める。本設計書の承認をその確認とする。

### 14-4. 再発防止: 節名参照のインベントリ

今回の食い違いは、追随を担保する仕組みが層によって違うことから生まれた。

| 層 | 担保 |
| --- | --- |
| TypeScript 実装 | 3 者比較テスト。機械で検証される |
| skills / agents / commands | `format-change-checklist.md` の項目のみ。人間が読んで手で追随させる |

チェックリストは追随のときに読むものであり、**新しい節名参照が書かれたこと自体を記録しない**。だから参照が増えても気づけない。今回 13 件まで増えていたのはこのためである。

参照を登録制にし、テストで検出する。

- 走査対象: `plugins/*/skills/**/*.md`、`plugins/*/agents/*.md`、`plugins/*/commands/*.md`、`plugins/*/references/*.md`、`plugins/*/CLAUDE.example.md`。metatron 自身は除く。
- 検出する語: ARCHITECTURE の 7 節の見出し名、移行した 3 節の見出し名、rules の 3 ファイル名。
- 登録簿: `plugins/metatron/src/fixtures/section-reference-inventory.json`。項目は「ファイルパス」「参照している節または rules ファイル」「分類(節名依存 / ドメインマップ依存 / パス依存のみ / 言及のみ)」。
- 判定: 登録簿に無い参照が見つかったらテストを落とす。登録簿にあるのにファイルが存在しない項目も落とす。
- **行番号は登録しない。** 行番号は編集のたびに動き、登録簿が実体から乖離する。ファイルと節名の組で登録する。

参照を書くこと自体は禁じない。**登録せずに書くこと**だけを止める。登録する行為が「この節名に依存した」という宣言になり、次に節構成を変える人がチェックリストを読まなくても影響範囲を機械で引ける。

テストのコードは走査対象を固定せず、リポジトリに存在するプラグインを走査する。登録簿だけがこのリポジトリ固有のデータになる。metatron を他のリポジトリへ配布したとき、このテストは配布物に含まれない(バンドル対象は `src/` から `scripts/` への出力のみ)。

#### 節名依存はゼロを維持する

§14-2 の書き換えを終えた時点で、metatron 以外のプラグインに残る節名依存(分類 A)は**ゼロになる**。したがって登録簿は「分類 A を登録する場所」ではなく、**分類 A がゼロであることを固定する装置**として使う。

| 分類 | テストの扱い |
| --- | --- |
| A: 節名依存 | **1 件でも現れたら落ちる。**登録による例外を認めない |
| B: ドメインマップ依存 | 登録制。` ```json metatron:domains ` の参照は正当なので、登録すれば通る |
| C: パス依存のみ | 登録制 |
| D: 言及のみ | 登録制。README や説明文で節名に触れるのは害が無いが、登録は要る |

分類 A に例外を認めないのは、認めた瞬間に「登録さえすれば書いてよい」に変わり、また 13 件まで増えるからである。節の中身が要るなら、それは rules としてコンテキストに載せるか、そのプラグイン自身の資産にするかのどちらかである。

初期登録は分類 B・C・D の該当箇所とする。分類 A は登録簿を持たない。

## 15. 影響を受けるテスト

| テスト | 落ちる理由 |
| --- | --- |
| `src/__test__/inject-context.test.ts` の I1 / I2 / I3 | ARCHITECTURE と GOTCHAS の 2 文書前提で注入文を組み立てている |
| `src/__test__/guard-docs.test.ts` の D1 / D2 / D5 | 拒否対象が 2 件前提 |
| `src/lib/__test__/config.test.ts` の C2 | `paths` が 2 キー前提 |
| `src/lib/__test__/architecture.test.ts` の見出し関連(A6 ほか) | 見出し数と許可リストの内容 |
| `src/lib/__test__/scan.test.ts` | `ARCHITECTURE_SECTIONS.length` 前提 |
| `src/lib/__test__/staging.test.ts` | `StagingKind` を限定しているケース |
| `src/cli/__test__/cli.test.ts` | stage → commit の E2E、未知見出しのケース |

`staging.test.ts` の T1〜T8d は、単一ターゲットの構造を変えないため落ちない。**落ちないことを確認する**(§7 の判断が守られている証拠になる)。

新規に要るテスト。

- `rulesDir` のパス解決と拒否(絶対パス・`docRoot` の外・空文字列)。
- `stage-rules` の `name` 検証(未知の名前の拒否)。
- **`stage-architecture` の `remove: true`**。存在するセクションを消せること、存在しないセクションの削除が拒否されること、`body` と `remove` の同時指定が拒否されること。
- **許可リストに無い見出しの削除**。`規約` のように `ARCHITECTURE_HEADINGS` から外した見出しでも `remove: true` で消せること(§6-2)。
- **許可リストに無い見出しへの `body` 書き込みの拒否**と、`MOVED_HEADINGS` に載る見出しでのメッセージに移行先が含まれること(§9-1)。
- guard hook が rules 3 ファイルを拒否し、`.claude/rules/` の他のファイルを拒否しないこと。
- **guard hook が `.claude/rules/metatron-extra/foo.md` を拒否しないこと**(接頭辞一致の誤検出。§4-1)。
- `docRoot` と起動ディレクトリのずれの警告。
- **`commit-rules` に `kind: "architecture"` の `stagingId` を渡したときの拒否**。逆も同様。
- **移行後の `diff-architecture` が 3 節を `section_missing` として報告しないこと**(§9-4)。

回帰として次を置く。

- **rules がサブエージェントへ届くことのプローブ**。§17-2 と §17-3 の手順をテストとして残し、Claude Code の更新でこの前提が崩れたときに気づけるようにする。設計の主目的と、codiel から節名参照を削除する判断の両方がこの挙動に依存するためである。
- **節名参照のインベントリ**(§14-4)。metatron 以外のプラグインの指示層に節名依存(分類 A)が 1 件でも現れたら落ちる。分類 B・C・D は登録簿と照合し、未登録の参照と、登録簿にあるのに存在しないファイルの両方で落ちる。

## 16. 実装の順序

1. config に `rulesDir` を足す(他のすべての前提)。
2. `StagingKind` に `"rules"` を足す。staging の構造は変えない。
3. `src/lib/rules.ts` と `get rules` / `stage-rules` / `commit-rules`。
4. guard hook の拡張。
5. 見出し許可リストを 7 節へ、`MOVED_HEADINGS` の新設、許可リストに無い見出しへの `body` 書き込みの拒否。
6. `stage-architecture` の `remove: true`(§6-2)。
7. 書式契約と参照文書の更新。
8. skills(init / update)の更新。
9. 注入の CLI 案内。
10. **codiel のスキルから節名参照を削除する**(§14-2)。併せて `scripting-tests` と `implementing` のフォールバックを新設する。コミットは「削除」と「フォールバック新設」で分ける。
11. **節名参照のインベントリのテストを追加する**(§14-4)。10 の完了を機械で固定する。
12. このリポジトリ自身の移行(§8 の 4 ステップ、`CLAUDE.md` の更新)。
13. 移行した 3 ファイルの内容更新。`/metatron:update` から `stage-rules` で行い、移設の diff と混ぜない。次の 2 つを含める。
    - `protected-paths.md` に **rules の 3 ファイル自身**を「触らないパス」として追記する。移行直後は自分自身を列挙していない状態になっており、文書が実態を記述していない。
    - §13-3 の推敲(「読んだ後にエージェントの振る舞いが変わる文だけを残す」判定)を 3 ファイルすべてに通す。
    併せて ARCHITECTURE の `## ディレクトリ構成と責務` を `stage-architecture` 経由で更新する。ツリーへ 2 行を追加する。

    ```
    ├── .claude/rules/metatron/       metatron が管理する規律を置く
    ├── docs/                         人間向けの文書と会話記録を置く
    │   └── prompts/                  別セッションの起動プロンプトを置く
    ```

    併せて箇条書きの「`docs/` は読まない。」を、`docs/prompts/` を例外として読める形に書き換える。`docs/chat/` と同じ扱いにする。

    ツリーへ挙げるのはこの 2 つに限る。書式契約が「実装エージェントが置き場を迷うディレクトリに絞る。全ディレクトリを網羅しない」と定めているためである。`.claude/` 配下の `settings.json`・`output-styles/`・`worktrees/` は Claude Code の規約どおりの位置にあり、迷いが生じない。`.claude/agents/` は SessionStart フックが生成するもので、人が置き場を選ぶ対象ではない。

    **`.claude/context-maps/` はツリーへ載せない。** context-map の存在意義そのものを見直す判断が別途進んでおり、その結論が出るまで ARCHITECTURE に位置づけを固定しない。`.gitignore` からの除外も現状のまま維持する。

    この追記をこのステップまで遅らせるのは、注入予算の制約による。移行前に足すと §12-2 の崖に落ちる(実測で 155 文字の追加が 7,592 文字の喪失を招いた)。移行で 3,730 文字が空いた後であれば、206 文字の追記を入れても残り 3,609 文字あることを実測で確認している。
14. 契約凍結文書と README の追随。

依存関係は次のとおり。

- 2 は 1 に依存する。
- 6 は 2 と 5 に依存する。
- **10 は 12 より前に置く。** 順序を逆にすると、移行してから codiel を直すまでの間、ベースブランチの解決とテストフレームワークの解決が壊れる。
- 11 は 10 の直後に置く。間を空けると、その間に新しい節名参照が入りうる。
- 12 は 1〜11 がすべて済んでから行う。
- 13 は 12 の後に、別のコミットで行う。

各ステップの完了条件(どのテストを通すか、既存挙動をどう保証するか)は、この設計書では定めない。実装計画書(WBS)で定める。

### 16-1. 実装中に禁じること

**metatron の hook を迂回する手段を、一時的にも作らない。** 迂回スクリプトも、hook の一時無効化も、正本への直接の書き込みもしない。

本設計の実装で正本へ書く場面はすべて CLI で足りる。

| 書く先 | ステップ | 経路 |
| --- | --- | --- |
| `harness-docs/ARCHITECTURE.md`(3 節の削除) | 12 | `stage-architecture`(`remove: true`)→ `commit-architecture` |
| `.claude/rules/metatron/*.md`(新規作成) | 12 | 同じ staging に含まれる |
| `.claude/rules/metatron/*.md`(推敲) | 13 | `stage-rules` → `commit-rules` |
| ARCHITECTURE の `## ディレクトリ構成と責務`(`.claude/rules/metatron/` の追加) | 13 | `stage-architecture` → `commit-architecture` |

これ以外の変更先(`metatron.config.json`・`src/`・`references/`・`skills/`・`hooks/hooks.json`・`README.md`・契約凍結文書・`CLAUDE.md`)は hook の対象外であり、通常の編集でよい。

迂回の誘惑が出る場面と、そこで取る手段を次に定める。

| 場面 | 誘惑 | 取る手段 |
| --- | --- | --- |
| ステップ 4 で guard を変えた直後、新しい判定に不具合があり正当な書き込みが拒否される | `hooks/hooks.json` から guard を外す。`scripts/guard-docs.mjs` を手で旧版へ戻す | `src/guard-docs.ts` を直して `pnpm run build` をやり直す。hook の設定と配布物には触れない |
| ステップ 12 の移行が途中で止まる | `rm` や `sed` で ARCHITECTURE と rules を直接直す | 各ステップは単一ターゲットの staging であり、失敗したファイルは 1 バイトも変わっていない。済んでいないステップから続ける(§8-2) |
| 開発中に rules ファイルを試しに置きたい | プロジェクトの `.claude/rules/metatron/` へ Write する | 一時ディレクトリに置く。テストは `<tmpdir>` で完結させる |
| CLI がまだ無い段階で rules を作りたい | 先に手で作っておく | 実装順序(§16)が CLI の完成を先に置いている。順序を入れ替えない |

`rm` などシェル経由の削除は hook で塞がっていない(§10)。塞がっていないことは、使ってよいことを意味しない。

**実装セッションの終了時、リポジトリに一時スクリプト・一時ファイル・hook の無効化が残っていないことを確認する。** 残っていれば、それは迂回が行われた証跡である。

## 17. 未解決事項

### 17-1. サブディレクトリの起動時読み込みの実測(記録)

`.claude/rules/` のサブディレクトリに置いた rules が起動時に読み込まれることは、次の手順で確認した。実装時に環境が変わっていれば再実行する。

```bash
mkdir -p /tmp/rules-probe/.claude/rules/sub
printf '# Sub\n\nThe SUB token is SUBDIR-7Q3.\n' > /tmp/rules-probe/.claude/rules/sub/sub.md
printf '# Flat\n\nThe FLAT token is FLAT-5K9.\n' > /tmp/rules-probe/.claude/rules/flat.md
cd /tmp/rules-probe && claude -p "Reply with exactly two lines. Line 1: SUB=<the SUB token or MISSING>. Line 2: FLAT=<the FLAT token or MISSING>." \
  --model claude-haiku-4-5-20251001 --setting-sources project \
  --disallowed-tools "Read,Glob,Grep,Bash,Agent,WebFetch,WebSearch" --output-format json < /dev/null
```

`--setting-sources project` でユーザー設定(プラグインの hook 群)を切り離し、`--disallowed-tools` で読み取り経路を塞ぎ、応答の `num_turns` が 1 であることを確認する。両トークンが返り、`num_turns: 1` であれば、ファイルはコンテキストに載っていたのであってその場で読んだのではない。

結果は `SUB=SUBDIR-7Q3` / `FLAT=FLAT-5K9`、`num_turns: 1` であった。

### 17-2. サブエージェント到達の実測(記録)

§2-3 の 1 は本変更の主目的であり、公式ドキュメントの `project rules` という語が `.claude/rules/` を指すという解釈に依存する。この解釈を実測で裏づけた。

```bash
mkdir -p /tmp/sa-probe/.claude/rules/metatron
printf '# Probe Rule\n\nThe VAULT token is VAULT-9X2K.\n' > /tmp/sa-probe/.claude/rules/metatron/probe.md
cd /tmp/sa-probe && claude -p "Launch exactly one general-purpose subagent using the Agent tool. The subagent prompt must be EXACTLY this and contain nothing else: Reply with only VAULT=<the VAULT token from your instructions, or MISSING>. Then output the subagent's reply verbatim and nothing else." \
  --setting-sources project \
  --disallowed-tools "Read,Glob,Grep,Bash,WebFetch,WebSearch" \
  --output-format stream-json --verbose < /dev/null
```

`stream-json` の出力から次の 3 点を確認する。

1. `Agent` の `tool_use` の `input.prompt` に**トークンが含まれていない**こと。含まれていればメインからの漏洩であり、証拠にならない。
2. サブエージェントの応答の `tool_uses` が **0** であること。0 でなければファイルを読んだ可能性が残る。
3. サブエージェントの応答がトークンを含むこと。

実測の結果は次のとおりであった。

- `input.prompt` は `Reply with only VAULT=<the VAULT token from your instructions, or MISSING>.` であり、トークンを含まない。
- サブエージェントの `tool_uses` は 0。
- サブエージェントの応答は `VAULT=VAULT-9X2K`。

したがって、`.claude/rules/` のサブディレクトリに置いた unscoped な rules は、サブエージェントのコンテキストに載る。

この挙動は Claude Code の更新で変わりうる。§15 の回帰プローブでこの前提を監視する。

確認したバージョンは Claude Code 2.1.241、測定日は 2026-08-24 である。

### 17-3. カスタムサブエージェントへの到達の実測(記録)

§17-2 で測ったのはビルトインの `general-purpose` である。codiel のサブエージェント(`codiel-tester` など)は tools を絞ったカスタムエージェントであり、§14-2 の方針(節名参照を削除し、コンテキストに載る rules に委ねる)はこれに rules が届くことを前提にする。別に測った。

`.claude/agents/probe-agent.md`(`tools: Read, Grep` を宣言したカスタムエージェント)と `.claude/rules/metatron/testing-policy.md` を置いた一時プロジェクトで、§17-2 と同じ手順を `subagent_type: probe-agent` に対して実行した。

結果は次のとおりであった。

- メインが渡した依頼文は `Reply with only VAULT=<the VAULT token from your instructions, or MISSING>.` であり、トークンを含まない。
- サブエージェントの `tool_uses` は 0。
- サブエージェントの応答は `VAULT=CUSTOM-4M7Z`。

tools を絞ったカスタムエージェントにも rules は載る。

確認したバージョンは Claude Code 2.1.241、測定日は 2026-08-24 である。

### 17-4. 一次情報が取れていない項目

- `.claude/rules/` のファイル単体のサイズ上限と切り捨て仕様。CLAUDE.md については `loads a CLAUDE.md file of up to 4 MiB in full and skips a larger file` の記述があるが、rules に適用されるかの記述は無い。§13 の 200 行の目安で運用側から抑える。
- rules に公式が定義していない frontmatter キーを書いたときの扱い。本設計では frontmatter を書かないため影響しない。
- SessionStart の `additionalContext` が compact 後の要約を生き延びるかどうか。hook が compact でも再発火することは確認済みであり、本設計の判断には影響しない。

### 17-5. 受け入れる仕様上の制約

- ユーザーは `claudeMdExcludes` 設定で `.claude/rules/**` を除外できる。除外されると metatron の rules は読まれない。metatron 側から防ぐ手段は無く、仕様として受け入れる。
- `--setting-sources` から `project` を外すと project rules は読まれない。同上。
- ビルトインの Explore と Plan エージェントは CLAUDE.md 階層を読み込まない。この 2 つには rules も届かない。

## 18. 検討して不採用にした案

| 案 | 不採用の理由 |
| --- | --- |
| 規約を CLAUDE.md へ集約する | CLAUDE.md は metatron の管理外で、書式検証も承認ゲートも効かない(引き継ぎ書より) |
| `harness-docs/ARCHITECTURE.md` を削除して規約なしで作り直す | 「CLI 経由でのみ書く」規律を自ら破ることになる(引き継ぎ書より) |
| **専用の移行コマンド `migrate-rules` を設ける** | 一度検討して採用したが、撤回した。採用時の理由は「metatron を使う既存プロジェクトすべてに必要で、移行後も残る」だったが、metatron はまだ利用者を持たない。移行対象はこのリポジトリ 1 つで、一度実行したら二度と使われない。一度しか使わない処理のために CLI へ恒久的な口を開けることは、hook を迂回する一時スクリプトを書くのと、残るものが違うだけで動機が同じである。§8-3 |
| staging を複数ターゲット対応にする | `migrate-rules` の撤回に伴い不要になった。「書き込み系が非 0 で終わったとき対象ファイルは 1 バイトも変わっていない」という中核の保証を、承認回数の削減のためだけに手放すことになる。§7-1 |
| ARCHITECTURE の 3 節を参照案内 1 行へ差し替えて節を残す | 「規約を ARCHITECTURE に書かせない」という目的を達成できず、再び書き込まれるのを防げない |
| `.claude/rules/` 直下に固定名で置く | `conventions.md` のような汎用名がユーザーの既存ファイルと衝突しうる。§4-1 |
| frontmatter の独自キーで管理対象を識別する | 未定義キーの扱いに一次情報が無い。guard hook が毎回すべての rules を開く必要が生じる。§4-1 |
| rules ファイルを可変にし、ディレクトリをレジストリとする | 書式契約が各ファイルの内容規範を持てなくなり、`/metatron:init` の対話単位も確定しない。ユーザー判断により固定とした |
| metatron が rules も注入する | 二重注入になる。読み込みは Claude Code 公式機構に委ねるというユーザー判断による |
| `commit-architecture` を汎用の `commit` へ改名する | 名前が注入文・`get config` の `cli`・guard の拒否メッセージに載っており破壊的。§6-2 |
| ARCHITECTURE に 3 節を残したまま rules へも書く(二重保持) | 正本が 2 つになる。書式検証は両方を通せるが、片方だけが更新された状態を機械で検出できない。移行前後で読み手が見る内容が食い違い、どちらが正しいかを判定する規則を新たに要する |
| ファイル契約は変えず、サブエージェントへの依頼文に規律を転記する | §2-3 の穴だけを塞ぐ最小の案であり、凍結文書も staging も触らずに済む。採らない理由は、転記を実行する側の記憶に依存するためである。転記を忘れた依頼だけが規律の外に落ち、落ちたことが検出できない。rules は「置けば全サブエージェントに届く」ため、忘れるという失敗の余地が無い。依頼文の長さも委譲のたびに増える |
| 既存プロジェクトのための移行経路・未移行検出を用意する | 利用者がいない。移行対象はこのリポジトリ 1 つで、移行を終えれば未移行の状態は二度と現れない。§11-2 |
| codiel の節名参照を `get rules` の読み取りへ切り替える | rules は起動時に自動適用されサブエージェントにも届く(§17-2・§17-3)ため、読みに行く経路が要らない。かつ metatron を併用しない環境には rules も存在せず、その経路は空振りする。参照を削除する方が正しい。§14-2 |
