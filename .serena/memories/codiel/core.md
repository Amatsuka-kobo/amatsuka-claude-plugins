`plugins/codiel` (0.5.2-dev) — GitHub-issue-driven orchestrator: takes an issue and drives it
through analysis, design discussion, planning, implementation, testing, PR and review, gated by the
bundled `raguel` MCP server. The largest plugin here. Flow spec: `plugins/codiel/docs/DESIGN.md`
(§0 states the no-Anthropic-API invariant, `mem:core`); flowcharts were pulled out into
`docs/skill-flowcharts.md` (commit 86b9483). MCP internals: `mem:codiel/raguel_mcp`.

## 2026-08-16 の再編 — ARCHITECTURE / GOTCHAS は metatron の管轄になった

- **`docs/ARCHITECTURE.example.md` / `docs/GOTCHAS.example.md` は codiel から削除され metatron へ移った**
  (`plugins/codiel/docs/` に残るのは `DESIGN.md` と `skill-flowcharts.md` の 2 本だけ)。
- **ドメインマップのマーカーは ` ```json metatron:domains ` に変わった。旧 `codiel:domains` は読まない**
  (互換読みを一切設けない)。書式・ルート解決の正本は `mem:file_contract`。
- **GOTCHAS は新書式**: 本文は `タスク / 失敗内容 / 原因 (推測) / 対策 / 昇格候補` の 5 フィールドのみ。
  関連ファイル欄・関連エントリ欄・Codiel フェーズ名欄は**持たない**(必要ならすべて `対策` の本文へ)。
  タグは `[解決済み]` / `[対象外]` の 2 種だけを `GOTCHA-NNN:` の直後に置く。
- `install-harness.sh` は **`.codiel/{specs,runs,reports}` を作るだけ**になった。GOTCHAS の雛形も
  配置しない(失敗を記録する時点で `recording-gotchas` が台帳ごと作る)。
- `recording-gotchas` は **metatron のインストール有無を検出しない**。使ってよい CLI パスは
  「コンテキストに現れた注入の案内」と「hook の拒否メッセージに載っていた絶対パス」だけ。
  案内が無ければ直接追記し、拒否されたら拒否メッセージの CLI で実行し直す。

## `/codiel:init` — 散文インタビューを廃止、単体で完結する

**「8 テーマの対話インタビューから ARCHITECTURE を生成する」は過去の姿。** 現在は 4 点
(ARCHITECTURE / `CLAUDE.md` の `## Codiel ハーネス運用ルール` 節 / `raguel.config.yaml` /
`.codiel/` 3 ディレクトリ)の不足分だけを埋める。GOTCHAS は確認対象に含めない。

- ARCHITECTURE のパスは固定値にせず `scripts/lib.mjs` の `resolveDocPaths` で解決する。
- **metatron のインストール検出をしない。** 見るのは「解決したパスのファイルが契約を満たすか」と
  「`/metatron:init` が自分の利用可能コマンドにあるか」の 2 点だけ。
- `/metatron:init` が使えるなら 2 択で提示し、選ばれたら完了後の `/codiel:init` 再実行を案内して終了。
- 使えない/選ばれなかったときは**ドメイン分割だけ**を聞いて、`# ARCHITECTURE` +
  `## ドメインマップ` だけの最小 ARCHITECTURE を生成する。技術スタック・ディレクトリ構成・
  コマンド定義・テスト方針・規約は聞かない。散文セクションを足さない。
- **移行作業はゼロ。** 最小ファイルは正当な ARCHITECTURE で、後から `/metatron:init` が
  既存の `## ドメインマップ` をそのまま活かして残りの節を足す。変換もマーカー書き換えもしない。

## 2 つのルート概念(混同しない)

| 関数 (`src/hooks/lib.ts`) | 基準 | 用途 |
| --- | --- | --- |
| `findDocRoot(startDir)` | 契約 §3 規則 1(`metatron.config.json` を持つ祖先 → git ルート → 開始ディレクトリ) | **文書**(ARCHITECTURE / GOTCHAS)の解決 |
| `findProjectRoot(startDir)` | `.codiel` を持つ祖先 | **codiel 固有資産**(`.codiel/runs` 等)の解決 |

どちらを使うかは「探しているものが文書か codiel 資産か」で決まる。
`lib.ts` は他に `resolveDocPaths` / `readDomainsResult` / `readDomains` / `DOMAINS_MARKER` /
`globToRegExp` を持つ。

**`guard-write` は 2 つの相対パスを持つ(2026-08-17。同じ `rel` で兼ねない)。**

| 変数 | 基準 | 判定対象 |
| --- | --- | --- |
| `codielRel` | `findProjectRoot(cwd)` = `codielRoot` | `.codiel/` 配下か、`specs/**/(spec\|cases).md` か、文書フェーズの `docs/` 判定、フェーズ外の書き込み |
| `docRel` | `findDocRoot(cwd)` = `docRoot` | **ドメイン境界の glob 照合のみ** |

ドメインマップは ARCHITECTURE に書かれ、ARCHITECTURE の位置は契約 §3 規則 1 の `docRoot` で
決まる。したがってそこに書かれた glob は `docRoot` 相対と読むのが唯一整合する
(metatron の `scan` も同じ)。`codielRel` で照合すると、`docRoot ≠ codielRoot` の構成
(`repo/.codiel` + `repo/sub/metatron.config.json`)で担当範囲内の書き込みが `ask` に落ち、
`docRoot` 外のパスが範囲内として通りうる。

**`readDomains` は契約 §1 の検証 4 項目を行う。** 以前は JSON として parse できただけの値を
返し、形の検証は `guard-write` の `toDomainMap` 側にあった。現在は `lib.ts` の
`validateDomainsValue` が担い、`guard-write` の `toDomainMap` は**プロトタイプなしのマップへの
詰め替えだけ**を行う(`Object.create(null)`。`toString` 等の継承プロパティと `__proto__` 対策)。
`readDomainsResult(startDir)` は `{ domains, warnings }` を返し、`readDomains` はその
`domains` だけを返す薄い包み。警告は重複ブロック・未閉フェンス・マーカーを呑み込む未閉フェンスの
3 種で、metatron の `findDomainsBlock` と**出る条件と件数を揃える**(文言も現状は一致)。

## Flow — 11 stages / 12 named phases

`init → discuss → design → (test-spec ∥ dev-plan) → implement → test-loop → pr → review →
fix-loop → triage → finalize`. `test-spec` と `dev-plan` は 1 つの並列ステージ。
Raguel gates `init`, `design`, `test-spec`, `dev-plan`, `implement`, `test-loop`, `fix-loop`.

**Human touchpoints are not limited to Raguel ASK/STOP.** `discuss` は常時 human-in-the-loop、
`design` は walkthrough + ユーザー承認を Raguel 評価の前に置く、`triage` は常にユーザー主導。
「codiel には固定の人間承認チェックポイントが無い」という旧記述は誤り。

### sandalphon の intent issue を起点にした場合

本文のどこかに `<!-- intent:v1 -->` があれば intent issue。`analyzing-issues` は要件抽出を
一からやり直さず、契約 §9-3 の写像表どおり `issue.md` へ**そのまま転記する**(要約を伴う抽出をしない)。
`discuss` は起票前に合意済みの分岐を論点として再提示せず、`agenda.md` に継承済みとして列挙する。
マーカーが完全一致しない (`intent:v2`、`<!--intent:v1-->`) ものは通常どおり本文から抽出する。

## Agents (13) and domain split

`codiel-analyst`, `codiel-architect` (2 modes), `codiel-planner`, `codiel-test-designer`,
`codiel-tester`, implementers `-frontend/-backend/-data`, reviewers
`-frontend/-backend/-data/-doc/-security`.

3 ドメイン分割が馴染まないプロジェクトは ARCHITECTURE で `generic` を宣言する。
**専用の generic agent は無い** — `codiel-implementer-backend` と `codiel-reviewer-backend` を
汎用ペアとして再利用し、doc/security reviewer は引き続き参加する。

## Skills (17) and commands (3)

Commands: `/codiel:init`, `/codiel:run`, `/codiel:test`.
Skills: `analyzing-issues`, `preparing-design-agendas`, `facilitating-design-discussions`,
`writing-design-docs`, `writing-test-specs`, `writing-dev-plans`, `implementing`, `scripting-tests`,
`running-regression-tests`, `fixing-failures`, `reviewing-diffs`, `fixing-review-findings`,
`filing-followup-issues`, `recording-gotchas`, `orchestrating-runs`, `raguel-gating`,
`initializing-harness` (+ その `raguel.config.example.yaml`)。
全スキルは commit 86b9483 で prompt-smith 標準に書き直され、2026-08-16 に契約追随の改訂が入った。

## Hooks — phase-scoped, ask-by-default with hard denies

`hooks/hooks.json`: `PreToolUse(Bash)` → `guard-bash.mjs`; `PreToolUse(Edit|Write)` →
`guard-write.mjs`; `SubagentStop` → `subagent-stop.mjs`; `Stop` → `stop-guard.mjs`.
codiel の PreToolUse は**フェイルクローズド**(catch で `ask`)。metatron 側と方針が逆なので混同しない。

- 制限は**フェーズ単位でエージェント単位ではない**。フェーズ不一致は `ask`(偽陽性を許容)。
  無条件 `deny` は `rm -rf`、`curl | sh`、force push、main/master への push、
  shell からの `state.json` 書き込み、条件外の PR/issue 作成。
- `guard-write` は `init`/`discuss`/`design`/`test-spec`/`dev-plan` を文書フェーズとして扱う。
- Phase state: `src/codiel-state.ts`(CLI エントリは `src/codiel-state-cli.ts` に分離。esbuild が
  ライブラリを hook へインライン化しても自己実行しないようにするため)。共有ヘルパは `src/hooks/lib.ts`。

### ドメイン境界の配線(2026-08-16、設計書 §16-5)

`RunState` に **optional な `domain?: string | null`** を追加した(version 据え置き。既存 state は
そのまま読める)。値がドメインマップに存在するかは**検証しない** — 判断は読む側 `guard-write` の責務。

- `codiel-state set-domain --domain <名前>` / `clear-domain` で操作する。**`clear-domain` は状態を
  問わず通る**(委譲中に run が `awaiting_human` へ落ちても解除できないと古い domain が残るため)。
- `guard-write` は CODE_PHASES(`implement`/`test-loop`/`fix-loop`)で `domain` が入っているときだけ
  境界を課す。判定は `readDomains(cwd)`(契約 §1 の 4 項目はこの中で検証済み)→ `toDomainMap` で
  プロトタイプなしへ詰め替え → `globToRegExp` で **`docRel`(docRoot 基準)** を照合。
- 判定は **`deny` ではなく `ask`**(境界の誤りは人間が通せる余地があり、ドメインマップの記述漏れで
  正当な書き込みを止めたくないため)。ドメイン定義が無い・読めない環境では**新たに止めない**。
  ドメイン名がマップに無いときだけは材料が無いので `ask` で止める。
- **`.codiel/` 配下はドメイン境界の対象外。** 判定は **`codielRel`** で行う(運用資産の位置が
  基準であり、`docRel` ではない)。ハーネス自身の運用資産でありどのドメインにも属さない。
  免除が無いと、test-loop で domain 非紐付けと紐付けを往復するとき `clear-domain` の呼び忘れで
  tester の `.codiel/specs/**/scripts/` への正当な書き込みが黙って `ask` になる。

## Assets copied into target projects

`CLAUDE.example.md` と `settings.json` がプラグインルートに、`scripts/install-harness.sh` が
`.codiel/` 3 ディレクトリの機械的配置を担う(hand-written、esbuild 出力ではない)。
ARCHITECTURE / GOTCHAS のテンプレートは**もうここには無い**(metatron へ移設)。
