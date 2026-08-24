# agent-policy 役割ベース setup 改修 引き継ぎ書

作成日: 2026-08-24
対象ブランチ: `agent-policy-change`(worktree: `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-change`)
base: `main`(未マージ)

## この文書の使い方

改修の本体は完了している。残っているのは、ブランチ全体の最終レビューが指摘し「マージ後でよい」と判断した課題である。**それらを片付けてから `main` へマージする**、という前提で書いてある。

- §1〜§3 を読めば現状が分かる
- §4 が残課題。**ここが次のセッションの作業対象**
- §5 がマージ手順。残課題を片付けたあとに実行する
- §6 が作業上の規律と検証コマンド

## 1. 完了している内容

`agent-policy` プラグインを「役割断片から定義を合成する方式」へ作り替えた。23 コミット、バージョン `0.8.0-dev`。

| 変更 | 内容 |
| --- | --- |
| 役割 ID | 10 種を `src/agents/roles.ts` に定義。tools の導出規則と `Agent` の可否判定を持つ |
| 役割断片 | `assets/roles/` に 12 ファイル。`_common.md` + 役割 10 件 + ベンダー別 1 件 |
| 合成器 | `src/agents/fragments.ts` / `compose.ts`。断片を読み、選ばれた役割の節を積んで定義を組む |
| 同梱プリセット | `agents/` は `gpt-sol` / `gpt-terra` / `gpt-luna` / `grok` の 4 件。**ビルド生成物**(`pnpm build` で再生成) |
| 廃止 | `claude-researcher` / `gpt-researcher` / `grok-researcher` の 3 定義。`grok-implementer` は `grok` へ統合 |
| MCP 除去 | 同梱定義の `tools` から `mcp__*` を全削除。本文の「ツール運用」節も廃止 |
| フック | `src/hooks/session-start.ts` はファイルを書かない。役割マーカーを走査して帯を注入し、エイリアス不一致を検知して setup を促すだけ |
| setup | `setup-gpt` / `setup-grok` が役割選択式で復活。差分確認と保持マージ付き |
| CLI | `src/setup-agents.ts`。`--check` が構造化差分を返し、`--write --keep <selector>` が選択的に既存を残す |
| 方針スキル | 4 本の担当表・実行帯の解決順・dispatch 節を改訂 |
| エイリアス | Grok の既定を `claude-grok-4-5` → `claude-grok-4-6` |

## 2. ブランチの状態

```
$ git log --oneline main..HEAD | wc -l
23
```

最終検証の結果(すべて緑):

- `pnpm build` OK。ビルド後に `plugins/` 配下へ未コミット差分が出ないことを確認済み
- `pnpm lint` OK
- `pnpm typecheck` OK
- `pnpm test` 1653/1653(141 files)

`.raphael/antibodies/` と `docs/chat/` に未コミットの変更があるが、**本改修とは無関係**である。この改修のコミットには一切含めていない。

## 3. 設計と計画の所在

| 文書 | パス |
| --- | --- |
| 設計書 | `harness-docs/design/2026-08-24-agent-policy-role-based-setup-design.md` |
| 実装計画書 | `harness-docs/plans/2026-08-24-agent-policy-role-based-setup-implementation.md` |

どちらも実装中に複数回修正している。**現在の内容が正**であり、実装と一致している。

設計書で特に読む価値がある節:

- §2「0.7.0 から反転させる判断」— 何を捨てたかの記録
- §5「tools の導出規則」— `Agent` の可否判定
- §6「役割断片」— 断片の配置・フォーマット・合成の順序
- §7.2 / §7.3 — 権限規律の退避先と、Agent 規律を権限と連動させる判断(実装中の最終レビューで訂正した箇所)
- §10.2「差分確認」— 「テンプレートに存在し得ない情報」の定義

## 4. 残課題

ブランチ全体の最終レビューが Critical 1 / Important 9 / Minor 15 を返し、うち 8 点はマージ前に修正済みである。以下は「マージ後でよい」と判断して残したもの。

### 4.1 優先度: 高(設計の目的に直接触れる)

#### I4. `allowed-tools` は制限ではなく事前承認である

**場所**: `plugins/agent-policy/skills/setup-gpt/SKILL.md:4` / `setup-grok/SKILL.md:4`、設計書 §10.3

公式ドキュメント(`code.claude.com/docs/en/skills` の frontmatter reference)の定義は次のとおり。

- `allowed-tools` — スキルを起動したターンの間、**許可を求めずに使えるツール**
- `disallowed-tools` — スキルが有効な間、**利用可能なツールのプールから除去されるツール**

つまり `allowed-tools` に `Write` / `Edit` を書かないことは、それらを**禁じない**。設計書 §10.3 の「ファイル書き込みはスクリプトが行うため Write / Edit は与えない」と §10.2 の「書き込みをスクリプトへ閉じることで再現性を確保する」は、frontmatter によって強制されていない。

同時に、両スキルのステップ 2 にある「プロジェクトに `.claude/agent-policy/roles/*.md` があるときは、その `id` と `label` も選択肢へ加える」は、**どのツールで読むかを指定しておらず、事前承認もされていない**。ウィザードの途中で権限プロンプトが挟まるか、モデルが手段を持たないと判断してステップを飛ばす。設計 §6.1 の「プロジェクト側にしか存在しない役割 ID も setup の選択肢に現れる」が実質機能しない可能性がある。

**修正案**(2 択)

- 最小: `allowed-tools` へ `Glob(.claude/agent-policy/roles/*.md), Read(.claude/agent-policy/roles/*.md)` を追加し、`disallowed-tools: Write Edit` を足して設計の意図を実際に強制する。ステップ 2 に使うツールを明記する
- より良い(I5 も同時に解消): `setup-agents.mjs` に `--list-roles` を足し、組み込み 10 種 + プロジェクト断片の `id` / `label` / `kind` を JSON で返す。スキルは Bash 1 本で役割一覧を得られる

**あわせて設計書 §10.3 を訂正すること。** 現在の記述は `allowed-tools` の意味を取り違えている。

#### I6. フックの setup 促しがプリセット名固定で、名前を変えた利用者に恒久的な誤検知が出る

**場所**: `plugins/agent-policy/src/hooks/session-start.ts` の `setupBlock`

```ts
const byName = new Map(marked.map((entry) => [entry.name, entry]))
...
const existing = byName.get(spec.preset)   // "gpt-sol" 固定
if (existing === undefined) lines.push(`- ${spec.preset}: 定義が無い。${spec.skill} を実行する`)
```

本改修の目的 4 は「利用者が自分で作った定義を、**名前に依存せず**担当表の帯へ結び付けられるようにする」であり、setup は名前を自由に決めさせる(設計書 §10.1 ステップ 4)。ところがエイリアス不一致の検知だけは名前依存のまま残っている。

`AMATSUKA_AGENT_GPT_SOL_ALIAS=my-sol` を設定して `my-heavy-coder.md`(`model: my-sol`)を作った利用者は、**正しく設定できているのに毎セッション「gpt-sol: 定義が無い。setup-gpt を実行する」と促され続ける**。促しは無視されるようになり、本物の不一致も見逃される。

設計書 §9.2-3 が「対応する定義が `.claude/agents/` に無い」をプリセット名で定義しているため、**設計側の欠陥でもある**。

**修正案**: 名前一致に加えて、役割マーカー経由の充足も認める。`AliasSpec` に代表役割(`gpt-sol` → `complex-impl`、`gpt-luna` → `light-impl` 等)を持たせ、「その役割を宣言する定義のいずれかの `model` がエイリアス変数と一致する」なら促さない。マーカー走査は既にあるので追加コストは小さい。設計書 §9.2 も更新する。

### 4.2 優先度: 中

#### I5. `hasMixedKinds` が死にコードで、読み取り/実装の分類が SKILL.md に手書き再掲されている

**場所**: `plugins/agent-policy/src/agents/roles.ts` の `hasMixedKinds`(export・テストあり・**呼び出し元ゼロ**)、両 `SKILL.md` のステップ 3

設計書 §5.3 の警告判定は、SKILL.md 本文が 10 個の役割 ID を読み取り/実装に手で振り分ける形で実装されている。`roles.ts` の `kind` と同じ分類が別の場所に文字列で複製された。

同様に、ステップ 2 の役割一覧(id + label)は `assets/roles/*.md` の frontmatter と `roles.ts` の**3 つ目の写し**、README の役割 ID 表が 4 つ目にあたる。

`hasMixedKinds` にテストがあるのに誰も呼ばないのは、テストが「実際の振る舞い」ではなく未使用 API を検証している状態である。

**修正案**: `--check` の戻り値に `mixedKinds: boolean` と `readonlyRoles` / `implRoles` を含め、スキルは JSON を見て警告を出す。`--list-roles`(I4)と合わせれば、SKILL.md から役割カタログの写しを 2 つ消せる。

#### I8. `--yes` が既存定義を確認なしで完全上書きする

**場所**: `plugins/agent-policy/skills/setup-gpt/SKILL.md` の非対話モード、`setup-grok/SKILL.md` の同節

非対話モードは `--check` を挟まず `--write`(`--keep` なし)を叩く。既存の `.claude/agents/gpt-*.md` に利用者が足した tools・独自 frontmatter キー・独自節はすべて消える。

設計書 §9.3 は「setup で利用者が足した tools や規律は、次のセッションで消える。書き込みの責務を setup へ一本化することでこの事故が消える」と書いた。フックからは消えたが、`--yes` に残っている。設計書 §10.1 の記述どおりなので**設計側の問題**である。

**修正案**: `--yes` でも各対象に `--check` を先に流し、`exists && !identical` なら次のいずれかにする。

- (a) 保持マージ相当の `--keep` を自動生成して書く
- (b) その 1 件をスキップし「差分があるため対話モードで実行してください」と報告する

少なくとも「上書きしました」ではなく「N 件の利用者追加情報を破棄しました」と報告させる。

### 4.3 優先度: 低(Minor 13 件)

| # | 場所 | 内容 |
| --- | --- | --- |
| M3 | `assets/roles/realtime-research.md` / `code-review.md` の `## 制約` 2 番目 | 役割名の冠を欠く。設計書 §6.5 の規則に対する例外が説明なく存在し、`gpt-terra.md` の制約節で冠あり/なしが混在する |
| M4 | `src/agents/fragments.ts` の `loadFragments` | 1 パス目は `localeCompare`、2 パス目は既定 `sort`。同一 id の重複が無い限り観測差は無い |
| M5 | `src/agents/fragments.ts` の helper `require` | CommonJS の予約名を影に持つ。`requireMeta` へ改名 |
| M6 | `src/setup-agents.ts` の `merge` | `keep.preamble` は既存が空文字列なら保持しないが、`keep.sections` / `keep.keys` は空でも保持する。非対称だが空 preamble を保持する意味が無いので実害なし |
| M7 | `src/hooks/session-start.ts` の `labelOf` | 同じ role に最大 3 回呼ばれ、プロジェクト断片では毎回 `existsSync` + `readFileSync`。`Map` メモ化で回避できる。セッションあたり数十回なので実害は無い |
| M8 | `src/setup-agents.ts` の `parseDocument` | `lines[0] === "---"` を検証しない。frontmatter の無い既存ファイルだと本文を frontmatter として解釈する。ガードを 1 行足すべき |
| M9 | `src/setup-agents.ts` の `parseArgs` | `--name ../../pwned` が `.claude/agents/` の外へ書ける。Claude Code の Agent 名規約(小文字英数とハイフン)を検証すれば解決する |
| M10 | `src/setup-agents.ts` の `parseArgs` | `--roles explore,explore` が重複したまま通り、本文と Output Format が二重に出る。`[...new Set(...)]` で潰す |
| M11 | `agents/*.md` の `color` | GPT 3 種がすべて `yellow` になり、旧版の `cyan`(Luna)/ `green`(Terra)による UI 上の識別が失われた。設計 §6.3 のベンダー固定値どおりだが、意図した損失かは確認価値がある |
| M12 | `src/agents/build-presets.ts` | 生成のみで `agents/` の古いファイルを掃除しない。今回は researcher 4 件を手で削除したが、次にプリセットを減らすと残骸が出る |
| M13 | `src/hooks/session-start.ts` の `markerBlock` | 行順が走査順(ファイル名 → CSV 順)であり、`ROLES` の表順ではない。決定的ではあるが担当表と並びが揃わない |
| M14 | `plugins/agent-policy/README.md` の移行手順 1 | 旧版にあった「SessionStart フックは残骸を検知すると削除を促す通知を出します」の一文が消えた。実装(`retiredBlock`)は今も通知する |
| M15 | `plugins/agent-policy/README.md` の Grok 移行の段落 | 1 文に 6 つの情報が詰め込まれている。内容は完全なので箇条書きに割るだけで可読性が上がる |

### 4.4 最終レビューが挙げた改善提案

残課題とは別に、構造上の提案が 4 件ある。次の改修の判断材料として記録する。

1. **「役割断片が唯一の正」をメタデータにも及ぼす** — `id` / `label` / `kind` / `tools` は断片・`roles.ts`・両 SKILL.md・README の 4 箇所に写しがある。三者一致テストは追加済み(`compose.test.ts`)だが、SKILL.md と README は対象外。`roles.ts` の `ROLES` を断片から生成する(ビルド時に `roles.generated.ts` を吐く)案がある
2. **担当表 ↔ `PRESET_ASSIGNMENTS` の突き合わせを自動化する** — 4 つの `SKILL.md` の Markdown テーブルと `PRESET_ASSIGNMENTS` が今も手で維持されている。テーブルをパースして突き合わせるテストは 30 行程度で書ける
3. **役割カタログをスクリプトから配る** — `--list-roles` を足せば I4・I5・SKILL.md の役割一覧の写しが同時に消え、`hasMixedKinds` に呼び出し元ができる
4. **移行の周知をフックからも行う** — Grok 4.6 の移行は最も静かに壊れる経路である。`AMATSUKA_AGENT_GROK_ALIAS` が未設定かつ `.claude/agents/grok-*.md` が存在する(= 旧構成から来た利用者)という条件で 1 度だけ注入する余地がある。プロキシへ問い合わせずに検知できる唯一のシグナル

## 5. マージ手順(残課題を片付けたあとに実行する)

### 5.1 前提の確認

```bash
cd /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-change
pnpm build && pnpm lint && pnpm typecheck && pnpm test
git status --porcelain plugins/     # 出力が無いこと(生成物がコミット済みと一致)
```

`pnpm test` が全件通ること、`plugins/` 配下に未コミット差分が無いことを確認する。ビルド後に差分が出る場合は、生成物をコミットし忘れている。

### 5.2 バージョンの判断

残課題の修正内容によっては、`0.8.0-dev` から上げる必要がある。

- 設計書の訂正(I4 の §10.3、I6 の §9.2、I8 の §10.1)を伴う修正 → パッチ(`0.8.1-dev`)で足りる
- `--list-roles` の追加など機能追加を伴う → マイナー(`0.9.0-dev`)

`plugins/agent-policy/.claude-plugin/plugin.json` と `plugins/agent-policy/package.json` の両方を揃えること。

### 5.3 マージ

worktree からではなく、メインのチェックアウトで実行する。

```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"

git checkout main
git pull
git merge agent-policy-change
```

マージ後、**マージ結果に対してテストを回す**。

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

ここで落ちたら、worktree とブランチはそのまま残して調査する。push していないので回復できる。

### 5.4 後片付け

マージ結果が緑になってから実行する。

```bash
git worktree remove /home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-agent-policy-change
git worktree prune
git branch -d agent-policy-change
```

`worktree remove` が「contains modified or untracked files」で拒否されたら、`--force` を使わずに中身を確認すること。`.raphael/antibodies/` と `docs/chat/` の未コミット変更が残っている可能性がある(本改修とは無関係のもの)。

## 6. 作業上の規律と検証

### 6.1 このリポジトリの規律(CLAUDE.md より)

- `plugins/*/src/` を変更したら `pnpm build` を実行し、**生成物の差分も同じコミットに含める**
- **同梱プリセット `plugins/agent-policy/agents/*.md` もビルド生成物である**。断片や合成器を触ると再生成される
- コミット前に `pnpm lint`・`pnpm typecheck`・`pnpm test` を通す
- TypeScript / Markdown の編集は Serena のツールを使う
- 改修したらプラグインの manifest のバージョンを上げ、`package.json` も揃える
- ルート `README.md` に内容を反映する
- 設計書・実装計画書は `harness-docs/` へ出力する

### 6.2 テストのパス解決(この改修で確立した流儀)

新規テストを書くときは既存の流儀に合わせること。実装中に 3 回踏んだ。

```typescript
import { fileURLToPath } from "node:url"
import { runTs } from "../../testing/run-ts.js"      // .js 拡張子付き

const HOOK = fileURLToPath(new URL("../session-start.ts", import.meta.url))
```

- `import.meta.dirname` は使わない
- `runTs` の import は `.js` 拡張子付き
- 新規テストは `plugins/**/__test__/**/*.test.ts` に置く(`vitest.config.ts` の `include`)

### 6.3 テストの環境隔離

`session-start.test.ts` は `environment()` ヘルパーで `AMATSUKA_AGENT_*` と `CLAUDE_PROJECT_DIR` を除去してから子プロセスへ渡す。**この処理を落とすと、開発者の環境に `AMATSUKA_AGENT_AUTO_INJECTION` が設定されている場合にテストが落ちる。**

### 6.4 CLI テストの非ゼロ終了

`setup-agents.ts` はエラー時に JSON を stdout へ書いてから終了コード 1 で終わる。`runTs`(`execFileSync`)は非ゼロ終了で例外を投げるため、テストの `run()` は例外から `stdout` を取り出す形になっている。この構造を壊さないこと。

### 6.5 実装中に確立した検証コマンド

```bash
# MCP の残存
grep -rn "mcp__" plugins/agent-policy/agents/ plugins/agent-policy/assets/roles/
grep -rn "## ツール運用" plugins/agent-policy/agents/ plugins/agent-policy/assets/roles/

# 廃止した定義名の残存
grep -rn "Claude Researcher\|GPT Researcher\|Grok Researcher\|Grok Implementer\|claude-researcher\|gpt-researcher\|grok-researcher\|grok-implementer" \
  plugins/agent-policy/skills/ plugins/agent-policy/references/

# 断片への固有名の混入
grep -rn "GPT Sol\|GPT Terra\|GPT Luna\|Grok Implementer\|Grok Researcher\|Claude Researcher" \
  plugins/agent-policy/assets/roles/

# 旧エイリアスの残存(README の移行手順と setup-grok の案内の 2 箇所だけが出るのが正しい)
grep -rn "claude-grok-4-5" plugins/agent-policy/ .claude-plugin/ README.md

# プラグイン定義の検証(author 未記載の警告は既存由来)
claude plugin validate plugins/agent-policy --strict
```

## 7. 実装中に下した主要な判断

次のセッションで「なぜこうなっているのか」を問われそうな箇所だけ抜き出す。全 20 件の判断は各コミットメッセージと設計書に記録してある。

| 判断 | 理由 | 誤っていた場合の代償 |
| --- | --- | --- |
| `_common.md` を節単位マージにした | プロジェクト側が 1 節だけ差し替えたとき、残りの節が静かに消えるのを防ぐ。設計書 §6.1 に反映 | 挙動が「マージ」になるだけで全置換より驚きは少ない |
| Agent tool 制約を `_common.md` へ移し、`allowsAgentTool` と同じ条件で出す | `general` だけで作った定義が `Agent` を持ちながら規律を欠く穴があった。設計書 §7.3 に新設 | 読み取り役割だけの定義にも「GitHub へ書き込まない」等が載るが、「行わない」制約なので害がない |
| `--model` を必須にした | 省略すると `model:` が空の定義が終了コード 0 で生成されていた | 1 行の検証が増えるだけ |
| CLI の非ゼロ終了を維持した | スキルが Bash から呼ぶとき終了コードで成否を判定できる | CLI がエラーを黙って 0 で返すと呼び出し側が失敗を検知できない |
| `--keep` セレクタの存在検証を追加した | 一致しないセレクタを渡すと、保持指定した内容を破壊しながら `ok: true` を返していた | 検証が厳しすぎると正当なセレクタが弾かれるが、`--check` の出力をそのまま渡せば起きない |
| `prompt-smith` / `skill-creator` / `agent-creator` をロードさせなかった | 計画に具体値が揃っており作業が転記だったため | **`skill-creator` については代償が出た**(I4 の `allowed-tools` の取り違えと、実行手段を持たないステップ)。次に SKILL.md を新規作成するときは飛ばさないこと |

## 8. この改修で分かった、計画を書くときの弱点

実装中に見つかった計画の欠陥は 6 件で、**実装コードの欠陥は 0 件**だった。内訳は次のとおり。

- テストコード 4 件(パス解決の流儀・環境変数の隔離・非ゼロ終了の扱い・戻り値の型)
- 指示の粒度 1 件(「description の方針名は〜」と書いたため方針名だけが差し替えられた)
- 検査の期待値 1 件(旧エイリアスの残存箇所を README だけと想定した)

**テストコードは実行して初めて分かる領域が多い。** 実装コードは既存ファイルを読んで書けるが、テストは型・環境・プロセス境界の 3 つで必ず躓く。次に計画を書くときは、同種のテストが既にあるならその 1 本を最後まで読むこと。削除済みのファイルでも git 履歴に残っていれば参照する価値がある(今回、旧 `setup-agents.test.ts` に答えがあった)。
