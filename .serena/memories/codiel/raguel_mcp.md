`plugins/codiel/raguel-mcp` — the MCP server backing Codiel's gating (DESIGN.md: 「他の天使たちの
行いを監視する天使 Raguel」). Inspects AI-produced artifacts (decisions, designs, plans, code diffs)
and returns a machine PROCEED / ASK / STOP verdict; the only human touchpoint is ASK/STOP.

Parent plugin: `mem:codiel/core` (codiel 1.0.0-dev). 2026-09-29 に作り直し済み(設計書
`harness-docs/design/2026-09-28-raguel-redesign-design.md`、計画書 `harness-docs/plans/2026-09-29-raguel-redesign-plan.md`、
ADR-011)。2026-10-01 に LLM パネルと重さ判定を撤去し、Jev の内容判定に置き換えた(設計書
`harness-docs/design/2026-10-01-codiel-run-speedup-design.md`、ADR-012)。codiel との取り決めは `plugins/codiel/docs/raguel-contract.md` が正本で、フェーズの表・ケースファイルの配置・
記録の形・裁定の組み合わせ・pass-gate の検査を持つ。食い違ったときは設計書と契約の文書を優先する。

Own workspace package (`raguel-mcp`, 1.0.0-dev in `package.json`; the MCP server reports the same value via
`BUILD_VERSION`, embedded by `build.ts`), but built/tested via the **root** toolchain
(`mem:suggested_commands`). `build.ts` → `dist/server.mjs`, committed and wired as the `raguel`
server in `plugins/codiel/.mcp.json`.

## Source layout (`src/`)

- `core/` — verdict computation(`verdict.ts` の 4 行: ルールの stop → STOP、パイプラインの例外 → ASK(degraded)、
  ルールか Jev の ask → ASK、それ以外 → PROCEED)、cross-rule invariants, logging; `pipeline.ts` runs `evaluateArtifact`.
  Has a golden test (`__test__/pipeline.golden.test.ts`). 重さ判定(tier)と LLM パネル(`panel/`)は 2026-10-01 に撤去した。
- `rules/` — the gating checks by artifact type: `decision/`, `plan/`, `code/`, plus `common/`
  (secrets, injection markers, resubmission-loop detection, max-size). `registry.ts` wires rules
  per artifact type; `params.ts` は規則のパラメータの表。
- `context/` — Jev(`jev.ts`・`judge.ts`)。`TYPESAFE_API_KEY` があれば自動で使い、無ければスキップして
  `contextJudge/unavailable`(info)を残す(有効化の設定は無い)。役割は 2 つで、どちらも同じ 2 本の問い合わせ(候補・本文)に入る:
  ルール層の補正(destructive-ops の stop → ask、語彙の info → ask など)と、kind と phase ごとの固定の内容判定(`judge/<ID>` の ask。
  問いは設計書 §4.2 で較正済み)。Jev は ASK を減らす向きには働かず、失敗しても ASK にも degraded にもしない。jevriel の src は import しない。
- `precedent/` — 判例の保存と検索(`store.ts`・`retrieval.ts`・`seed/`)。判例は `<casesDir>/precedents/<projectId>/` に置く。
- `casefile/` — hash-chained, tamper-evident audit log of evaluations (`hashchain.ts`, `store.ts`, `digest.ts`).
- `subject/` — 評価対象の組み立て(`body.ts`・`code.ts`・`files.ts`)。code は baseRef から HEAD の差分を Raguel が自分で作る。
- `codiel/phases.ts` — フェーズの表。`project/root.ts` — プロジェクトルートと projectId の解決。
- `tools/` — MCP tool entry points. `evaluate_decision`・`evaluate_design`・`evaluate_plan`・`evaluate_code` の 4 本は
  `phase`・`baseRef`(code のみ)・`paths` を受ける。ほかに `record_outcome`・`list_rules`・`list_precedents`・`retire_precedent`(`shared.ts` が共通の入力)。
- `config/` — schema + loader + defaults + paths. 設定は `.codiel/config.json` の `raguel` と `testsDir`。
  `RAGUEL_CONFIG` に JSON のパスを渡すと `raguel` の代わりにそれを読む(testsDir は常にプロジェクトの `.codiel/config.json`)。
  **YAML(旧 `raguel.config.yaml`)は読まない。** 呼び出しごとに mtime で読み直す。
- `server.ts` — MCP server entry.

## ケースファイルと記録

`<casesDir>/cases/<projectId>/<runId>/<phase>/attempt-NN/` に証拠と `verdict.json` を置き、
`<casesDir>/cases/<projectId>/` 直下の `evaluations.jsonl`(評価の索引)と `outcomes.jsonl`(裁定の記録)に 1 行ずつ追記する。
`casesDir` の既定は `~/.raguel`。codiel 側の `codiel-state pass-gate` はこの索引と `verdict.json` を照合して、
記録に無い・古い・書き換えられた評価ではゲートを通さない(検査は契約の文書 §5)。

## Subproject specifics

- Tests live in `__test__/` dirs beside each module.
- Jev はテストで `PipelineDeps.jevCall` に差し替え、`tools/__test__/helpers/harness.ts` の `jevApiKey` の既定を `""` にして本物を呼ばない
  (開発環境に `TYPESAFE_API_KEY` があるため)。撤去した設定キー(`judge`・`weight`・`panel`・`contextJudge.enabled`)は
  loader が取り除いて `reasons` に `retired-config:` の警告を出す。撤去したケースファイル名(`02-weight.json`・03〜05・08)は
  新しい評価では書かないが、`EVIDENCE_FILES` には残す(消すと旧形式の前フェーズが改竄扱いになる)。
