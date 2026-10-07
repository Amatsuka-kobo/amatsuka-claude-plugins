# Context Map: skill-creator の観点を optimize-agents へ取り込む

**作成日**: 2026-08-02
**作成者**: Opus(探索統括)
**対象タスク**: skill-creator プラグインの観点・ワークフローのうち採用と判断した 5 件を optimize-agents へ取り込む。
**前回の map**: `.claude/context-maps/2026-08-02-skill-eval-into-optimize-agents.md`(skill-eval / agent-creator の新設。基盤はここで完成済み)

---

## 1. 目的・スコープ

skill-creator(claude-plugins-official, Apache 2.0)を分析し、optimize-agents に取り込む価値のある観点を移植する。

### スコープ内(採用 5 件)

| # | 項目 | 種別 | 移植元 |
| --- | --- | --- | --- |
| A | SKILL.md の静的検査 | 新規スクリプト | `scripts/quick_validate.py` + 公式 best-practices |
| B | description の方針転換 | 既存 reference の改稿 + 実測 | `scripts/improve_description.py` のプロンプト |
| C | eval 先行(baseline を先に測る) | skill-eval への規律追加 | SKILL.md §Build evaluations first |
| D | assertion の質の基準 | skill-eval への規律追加 | `agents/grader.md` |
| E | trigger eval の train/test 分割 | skill-eval への規律追加(+ 要判断) | `scripts/run_loop.py` |

ユーザー指示の着手順: A → C → D → E(推奨順)。B は別途「優先的に取り込む」と指示あり。

### スコープ外(不採用と判断済み)

description 自動最適化ループ / HTML eval ビューア / `package_skill.py` / ブラインド比較(`comparator.md`) / 本文執筆スタイル(prompt-smith 優先というユーザー指示)。

---

## 2. 現在のコードベース構造

### 2.1 optimize-agents の構成

```
plugins/optimize-agents/
├── .claude-plugin/plugin.json     ← version 0.11.1-dev
├── build.ts                       ← entryPoints は明示列挙(glob ではない)
├── package.json                   ← {build: "tsx build.ts"} のみ
├── src/
│   ├── run-trigger-eval.ts        ├── run-output-eval.ts
│   ├── aggregate-benchmark.ts     ├── check-agent-definition.ts   ← A の雛形
│   ├── lib/  (frontmatter / known-tools / pool / stats / sandbox /
│   │          checker / stream-parser / trigger-verdict / environment)
│   └── __test__/  (9 本, vitest)
├── scripts/                       ← バンドル出力(git 管理)
├── skills/  (with-codex-policy / claude-model-policy / setup-gpt /
│             prompt-smith / skill-eval / agent-creator)
├── references/  (orchestration-discipline / context-map-guide /
│                 description-guide / agent-definition-spec)
├── docs/  (cost-discipline / description-out-of-scope /
│           skill-eval-rationale / agent-creator-rationale /
│           prompt-smith-references-scope)
└── evals/{trigger,short,fp}/{prompt-smith,skill-eval,agent-creator}.json
```

### 2.2 ビルドとテスト

- `pnpm build` = `pnpm -r build`。optimize-agents は `tsx build.ts` → esbuild(bundle, ESM, node22, outdir `./scripts`, `.mjs`)
- **新規スクリプト追加時は `build.ts` の `entryPoints` に 1 行追加が必須**(glob ではない)
- テスト: vitest。`include: plugins/**/__test__/**/*.test.ts`、timeout 20s、pool=forks
- テスト形式: tmpdir にフィクスチャ生成 → `spawnSync(node, [tsx-cli, script, file])` → stdout の JSON を検証 → `afterEach` で削除

---

## 3. 項目別の現状

### A. SKILL.md 静的検査

**現状**: 存在しない。Agent 定義には `check-agent-definition.ts` があるが SKILL.md には対応物がない。

再利用できる資産:

| 資産 | 再利用度 |
| --- | --- |
| `src/lib/frontmatter.ts` | **そのまま使える**。トップレベル `key: value` の汎用パーサで、Agent 定義固有の前提は入っていない |
| `check-agent-definition.ts` の骨格 | 引数解析 / `{path, errors, warnings}` JSON / 終了コード規約(0 正常, 1 errors あり, 2 引数不正)をそのまま踏襲できる |
| `check-agent-definition.test.ts` の形式 | フィクスチャ生成 → CLI 起動 → JSON 検証をそのまま踏襲できる |

再利用できないもの: `KNOWN_FIELDS`、scope 推定、Agent 固有制約。

**リポジトリの実態**(SKILL.md 43 本):

| 観点 | 結果 |
| --- | --- |
| frontmatter のキー | 全 43 本が `name` / `description` のみ。逸脱なし |
| 本文 300 行超 | 1 本(`codiel/skills/orchestrating-runs/` 325 行) |
| `name` とディレクトリ名の不一致 | **1 本**: `optimize-agents/skills/setup-gpt/` の `name` が `setup` |
| description 最長 | 約 747 字(`prompt-smith`)。上限 1024 の約 72% |

`setup-gpt` の不一致は README 2 箇所(`optimize-agents:setup` 表記)と with-codex-policy SKILL.md 1 箇所にも波及している。

### B. description の方針転換

**現行の基準**(`references/description-guide.md`, 46 行):

- 何をするか + いつ使うかの両方を書く
- ユーザーの言い回しで例示。口語・省略形も含める
- 「必ず使用する」と書く
- 近いスキルの境界を書く
- **削らない**: 言い換えを残す / 例示は 2 つ目以降も残す / 長さを理由に削らない

**現行の根拠**(`docs/description-out-of-scope.md` + `docs/skill-eval-rationale.md`):

2026-08-01、task-utility 6 スキル 168 問(trigger 48 / short 48 / fp 72)で測定。負の境界追加で fp 72/72、正例側 48 中 4 件の発火漏れ(口語省略形)。口語例追加 + 対象範囲限定で **158/168 → 161/168**、改善 2・悪化 0。

**skill-creator の基準**(`improve_description.py` のプロンプト逐語):

| 観点 | skill-creator の指示 |
| --- | --- |
| 長さ | "not more than about 100-200 words, **even if that comes at the cost of accuracy**"。hard limit 1024 字 |
| 一般化 | 個別クエリの列挙を禁止。"generalize from the failures to broader categories of user intent" |
| 一般化の理由 | ① overfitting 回避 ② 全クエリに注入されるため文脈を圧迫しない |
| 語形 | 命令形。"Use this skill for" ⊃ "this skill does" |
| 焦点 | 実装詳細でなくユーザーの意図 |
| 区別 | "competes with other skills for Claude's attention — make it distinctive and immediately recognizable" |
| 失敗継続時 | 同じ試行を繰り返さず文構造・言い回しを変える |

公式 best-practices の追加指定(skill-creator にない):

- **三人称で書く**。"I can help you..." / "You can use this to..." は避ける。description は system prompt に注入されるため、視点の不統一が discovery を壊す
- `name`: 最大 64 字 / 小文字英数字とハイフン / XML タグ不可 / 予約語 `anthropic` `claude` 不可
- `description`: 最大 1024 字 / 非空 / XML タグ不可

**衝突点**: 一般化(skill-creator)⇔ 例示を残す(現行)。両者は逆方向。現行は実測 161/168 の裏付けを持つが、skill-creator 流を同条件で測った記録はない。

### C. eval 先行

**現状**: skill-eval は「直したら測る」を持つ。「書く前に測る」がない。

**skill-creator / 公式の順序**: ① スキル無しで代表タスク → 失敗を記録 ② gap を突く eval を 3 本 ③ baseline 測定 ④ gap を埋める最小限の本文 ⑤ 反復

**器の有無**: `run-output-eval.ts` に `without_skill` 構成が実装済み。baseline 測定はスクリプト改修なしで実行できる。

### D. assertion の質の基準

**現状**: skill-eval §チェッカーを書く は `grading.json` のスキーマと `<outDir> <evalId>` の呼出契約のみ。**何を assertion にすべきかの基準がない**。

**`grader.md` から移す価値のある 2 点**:

- 表層一致(ファイルの存在確認だけ)を fail 扱いにする。間違った成果物でも通る assertion を問題視する
- 弱い assertion・未カバーの重要結果・検証不能 assertion を見つけたときのみ改善提案を出す(些細な指摘はしない)

`grader.md` の他の規律(実ファイル検査 / 部分点なし / 不確実なら fail)は、決定的プログラムである checker では構造的に満たされるため移す先がない。

**既存との関係**: skill-eval の「両構成が同じ点数なら識別力はない」は事後判定。D はその事前版。

### E. train/test 分割

**現状の eval セット**(optimize-agents 自身の 3 スキル分):

| 種別 | prompt-smith | skill-eval | agent-creator | 計 |
| --- | ---: | ---: | ---: | ---: |
| trigger(should_trigger=true) | 8 | 8 | 8 | 24 |
| short(true) | 8 | 8 | 8 | 24 |
| fp(false) | 8 | 12 | 12 | 32 |
| **計** | **24** | **28** | **28** | **80** |

形式は `[{query, should_trigger}]`。`run-trigger-eval.ts` の期待形式と一致。

**`run_loop.py` の設計**: should_trigger の真偽別に層化 → seed 42 でシャッフル → 各群の先頭 40% を test。train だけを改善に渡し、履歴からも `test_*` を除く。best は **test スコア**で選ぶ。

**問題**: 1 スキルあたり 8〜12 問。40% holdout だと test が 3〜5 問になり、1 問が 20〜33% に相当する。skill-eval が既に持つ「1〜2 問の差で直さない」規律と両立しない。**eval セットの問数を増やすかの判断が先に要る。**

---

## 4. 変更の影響範囲

### 4.1 直接

| 項目 | 対象 |
| --- | --- |
| A | `src/check-skill-definition.ts`(新規) / `src/__test__/check-skill-definition.test.ts`(新規) / `build.ts` の entryPoints / `scripts/check-skill-definition.mjs`(生成物) / README のスクリプト表 |
| B | `references/description-guide.md`(改稿) / `skills/skill-eval/SKILL.md` / `skills/agent-creator/SKILL.md` / optimize-agents 6 スキルの description |
| C | `skills/skill-eval/SKILL.md` |
| D | `skills/skill-eval/SKILL.md` §チェッカーを書く |
| E | `skills/skill-eval/SKILL.md` / `evals/**/*.json`(拡充する場合) |
| 全体 | `plugin.json` のバージョン(現 0.11.1-dev) |

### 4.2 間接

- `docs/description-out-of-scope.md` — B の結果次第で根拠の追記が要る
- `docs/skill-eval-rationale.md` — B/E の実測値を追記する置き場
- `setup-gpt` の name 不一致 — A が検出する。修正すると README 2 箇所 + with-codex-policy SKILL.md 1 箇所に波及
- `plugins/task-utility/evals/` の 6 スキル分 168 問 — B の追加検証に使える

### 4.3 避けるべき

- `run-trigger-eval.ts` の判定ロジック(発火率しきい値 0.5 / fp は厳密 0 / 第 1 ツールで打ち切り)は実測値の基準。変えない
- eval セットの配置(測定対象プラグイン配下)は確定済み。動かさない
- `prompt-smith` の本文基準 — ユーザー指示により現行優先。skill-creator の執筆論は取り込まない

---

## 5. 守るべき既存契約

- **eval セット JSON**: `[{query: string, should_trigger: boolean}]`
- **`check-*` スクリプトの CLI 契約**: stdout に `{path, ...,  errors[], warnings[]}` の整形 JSON。終了コード 0 / 1(errors あり)/ 2(引数不正・読込失敗)
- **回帰の基準値**(2026-08-02, task-utility 6 スキル 168 問): substantive 46/48, short 46/48, fp 69/72。ただし直近の回帰では fp 66/72 で基準割れの記録あり(連続測定の順序差として扱われている)
- **公式仕様**(SKILL.md frontmatter): `name` 最大 64 字・小文字英数字ハイフン・予約語不可、`description` 最大 1024 字・非空、ともに XML タグ不可
- **Anthropic API 不使用**(CLAUDE.md)。`claude -p` のサブスク認証に閉じる
- **スクリプトは TypeScript**、`src/` → `scripts/`、バンドル出力は git 管理

---

## 6. テスト方法

- A: vitest 統合テスト(`check-agent-definition.test.ts` と同形式)。正常 / name 形式違反 / description 超過 / 未知キー / 本文空 / 予約語 を個別に
- A の実地確認: リポジトリ内 43 本の SKILL.md に対して実行し、`setup-gpt` の不一致が検出されることを確認
- B: `run-trigger-eval.mjs` で現行 description と新方針 description を **同一の 80 問**で測り比較。`--runs` を揃え、`environment` の一致を確認
- C/D: テキストのみ。prompt-smith による自己評価
- E: 分割ロジックを実装する場合は純関数として単体テスト

---

## 7. 未解決事項

| # | 事項 | 影響度 | 現状の仮定 |
| --- | --- | --- | --- |
| 1 | B の衝突をどう決着させるか | **High** | 現行 80 問で 2 案を実測し、スコアで決める。「正解がない」を「測って決める」に変える。片方が明確に勝てばそれを採用、差が 1〜2 問なら現行維持(skill-eval の既存規律に従う) |
| 2 | 一般化と例示は本当に排他か | **High** | 排他ではない可能性がある。skill-creator の「列挙するな」は 1024 字制約と全クエリ注入コストが理由で、発火精度そのものの主張ではない。日本語 747 字は英語 100-200 words とほぼ同等の情報量で、**現行は既に skill-creator の想定範囲内**の可能性がある。測る前にこの仮説を検証する |
| 3 | short セットの位置づけ | Medium | skill-creator は "simple, one-step queries ... may not trigger a skill even if the description matches perfectly" とし、短いクエリを poor test case と断じる。一方このリポジトリの short セットは 46/48 で発火している。両立の理由(スキルの性質差か、クエリの作りの差か)は未解明 |
| 4 | eval セットを増やすか(E の前提) | Medium | 増やさないなら E は「規律として書くが自動分割はしない」に留める |
| 5 | `setup-gpt` の name 修正をこの作業に含めるか | Low | A の検出結果として報告し、修正は別コミットに分ける |
| 6 | バージョンの上げ幅 | Low | 新規スクリプト 1 本 + reference 改稿 + スキル改稿 = マイナー。0.12.0-dev を仮置き。メジャーは上げない |

---

## 8. 暗黙知

- **description-guide は 2 つのスキルから参照される共有 reference**。skill-eval(SKILL.md 用)と agent-creator(Agent 定義用)。B の改稿は Agent 定義側の基準も同時に動かす。skill-creator は Agent 定義を扱わないため、Agents 節には移植元が存在しない
- **description-guide の Agents 節は実測なしの準用**であることが明記されている。B でここを触るときも、実測の有無を出典として書き分ける規律を壊さない
- **測定器を先に疑う**(前回 map より): スコアが動かないときは description ではなく測定系を疑い、実績のある description で対照実験する
- **skill-creator は Apache 2.0**。コードを移植する場合は著作権表示と変更点の記載が要る。A は仕様(公式 best-practices に明記された制約)の実装であってコード流用ではないため対象外だが、`quick_validate.py` の構造をなぞる場合は要確認
- **`build.ts` の entryPoints 追加を忘れるとバンドルが生成されない**。git 管理されている `scripts/` に出力が現れないことで気づく

---

*読む深さは `plugins/optimize-agents/references/context-map-guide.md` に従う。*
