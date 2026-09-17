# prompt-smith の測定基盤を改善する引き継ぎ書

- 日付: 2026-09-18
- 引き継ぎ元: 測定基盤改善の設計書・実装計画書を確定したセッション
- 引き継ぎ先: 実装計画書に従って prompt-smith と metatron を改修・測定・検証するセッション
- 対象プラグイン: `plugins/prompt-smith`(0.4.0-dev)、`plugins/metatron`(0.3.6-dev)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書 | **完了**。6 回の改訂と 4 回のレビューを経て確定した |
| 実装計画書 | **完了**。31 ステップ、2 回のレビューを経て確定した |
| 実装 | **未着手**。次セッションが実装を担う |
| 改修の構成 | **確定**。段 1 隔離、段 2 CLI、段 3 ループ、段 4 eval、段 5 測定、段 6 規律の 6 段で進める |

改修の対象は `prompt-smith` と `metatron` の 2 プラグインである。判断待ちの事項はない。設計書 §16 の未解決事項 25 件(High 0 / Medium 8 / Low 16)と実装計画書の 3 件はすべて Low であり、進行を止めない。

## 次セッションが最初にやること

1. `harness-docs/plans/2026-09-17-prompt-smith-measurement-improvement-implementation.md` を全文読む。
2. S1-1(`prompt-smith` を `0.4.0-dev` へ繰り上げる)から、計画書の順に着手する。
3. 各ステップの受け入れ条件を満たしてから、次のステップへ進む。

---

## 1. 目的と判断

改修の対象は `plugins/prompt-smith/docs/improvement-backlog.md` の 8 項目である。主要な判断はすべて確定している。

| 項目 | 決定 |
| --- | --- |
| 1. 子プロセスの隔離 | `--setting-sources project`、`--strict-mcp-config`、`--settings '{"disableAllHooks":true}'`、`--no-session-persistence`、リポジトリ外の一時 cwd を使う。**`CLAUDE_CONFIG_DIR` は変更せず、認証情報を複製しない** |
| 2. 環境の記録 | `run-loop` の結果 JSON に `describeEnvironment()` を含める |
| 3・4. モデル | 3 エントリの `--model` の既定をエイリアス `sonnet` にする。既定値はライブラリ層で適用する |
| 5. `--help` | 3 エントリに追加する |
| 6. 採否基準 | **`selectBest` の条件式は変えない。** 打ち切りを `train_failed === 0 || (hasTestSet && test_failed === 0)` にし、train が空になる構成は拒否する |
| 7. 長さ | **UTF-8 バイト数**で規律化する。`LENGTH_TARGET = 600`、`LENGTH_FLOOR = 680`。`buildShortenPrompt` の閾値は `budget` と同一にし、`1024` はコードから除く |
| 8. eval 基準 | `SKILL.md` に 6 基準を追加し、eval 6 本の true 問を各 4 問ずつ差し替える |

---

## 2. 調査で確定した事実

### 隔離方式と認証

- `--bare` は model-invoked skill を切る。実測では発火 0 回であり、測定には使えない。
- 空の `CLAUDE_CONFIG_DIR` は OAuth 環境で `.credentials.json` の複製を要する。トークンのリフレッシュと再利用検知のリスクがあるため採用しない。
- `--setting-sources project` は OAuth 環境で認証に成功した(終了コード 0、コピー 0 件)。cwd のプロジェクトスキルも発火を維持した。10 並列 × 2 バッチ(20 プロセス)でも `~/.claude.json` は壊れなかった(変化 +1 byte / 0 byte、JSON パース成功)。
- 環境変数(`ANTHROPIC_AUTH_TOKEN`)と OAuth は実測で成立した。`apiKeyHelper`、`awsAuthRefresh`、settings の `env` は user ソースを切るため通らない。Bedrock と Vertex は影響を受けない見込みだが、従量課金のため未検証である。

### 長さと対象スキル

- 英語 1 word は約 6.2 バイト、英語 100 words は約 620 バイトである。日本語 description の実効は ASCII を含むため 1 字あたり 2.5〜2.8 バイトであり、日本語 200 字は 600 バイトである。同じ量を指す。
- 発火率の最適帯は 504〜589 バイト(20/20)、低下する帯は 766〜1120 バイト(13〜15/20)だった。
- 対象 6 スキルの現状値は、`prompt-smith` 1612、`agent-creator` 1154、`skill-creator` 518、`capturing-architecture` 587、`updating-architecture` 589、`recording-gotchas` 504 バイトである。最適帯にあるのは後ろの 4 スキルで、長いのは前 2 スキルだけである。

### 既存のバグ

- `parseSkillMd` は description を空行で切り捨てる。`agent-creator` を 175 バイトとして読む一方、`replaceDescription` は 1154 バイトとして扱い、測定対象とサンドボックスに置く文字列が異なる。
- `stream-parse.ts` は `result` イベントを無条件に「発火しなかった」と確定する。`close` より先に確定するため、後続の非ゼロ終了で再分類されず、認証失敗が不発火として点数に混ざる。
- `runEval` の集計は `outcomes[index] ? 1 : 0` である。`QueryOutcome` を 3 値のオブジェクトにするとすべて truthy になり、配線を忘れると全問 100% 発火に見える。型検査と純関数テストでは止まらない。

### 公式 skill-creator の位置付け

- 公式の測定は他スキルとの競争に勝ったかを測る設計ではない。UUID 付き decoy を検出する構造のため、競争が起きると測定が壊れる。
- 実プロジェクトで動くのは `find_project_root()` の副作用であり、意図ではない。後発の `claude plugin eval` は throwaway home、working directory、configuration による隔離を明示している。
- 「競争に勝った率」は、公式由来ではなく、このリポジトリが 2026-08-09 に移植した設計で加えた操作的定義である。

---

## 3. 実装・測定の方針

- 改修は 6 段、S1-1 から S6-4 まで計画書の順に実施する。各段の受け入れ条件と具体的な編集箇所は計画書を正とする。
- 測定は最大 1140 回の `claude -p` を実行する。内訳はベースライン 360 回、比較 A 360 回、比較 B 240 回、衝突観測が最大 180 回である。
- 比較 A は、metatron の 3 スキルを git `5325f6f^` から復元した短縮前と現行で比べる。元の実験の再現である。
- 比較 B は、長い 2 スキルの現行と 600 バイト案を比べる。実際の改善を測る。
- 衝突観測では `agent-creator` を `--max-iterations 3` で実行する。
- 規律は、比較 A と比較 B が同じ方向を示した場合だけ確定する。片方だけの場合は設計書 §13 の 2×2 表に従う。

---

## 4. 完了条件と追随

- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` をすべてパスさせる。
- `plugins/*/src/` を変更するため、`pnpm run build` を実行し、生成された `plugins/*/scripts/` の差分を同じコミットに含める。
- `prompt-smith` を `0.4.0-dev`、`metatron` を `0.3.6-dev` に上げる。両プラグインで `plugin.json` と `package.json` のバージョンを揃える。
- ルートの `README.md`、`.serena/memories/agent_policy/core.md` の 4 スクリプト説明、`plugins/prompt-smith/NOTICE` の 9 項目、`plugins/prompt-smith/README.md` の CLI 引数表を改修内容に追随させる。
- `plugins/prompt-smith/docs/skill-creator-port-rationale.md` に、隔離後の定義を追加する。

---

## 5. スコープ外

- ARCHITECTURE の更新と ADR の追加。影響があるかはユーザーが判断し、ある場合は `metatron:updating-architecture` を起動する。CLI 手順はスキルの代替にならない。
- バックログ本文の修正。バックログは改修時の入力であり、改修後の正本ではない。
- 英語 description の最適帯の実測。このリポジトリの実測はすべて日本語である。
- Bedrock、Vertex、keychain、`apiKeyHelper` 環境での隔離の検証。

---

## 6. 参照

- 設計書: `harness-docs/design/2026-09-17-prompt-smith-measurement-improvement-design.md`
- 実装計画書: `harness-docs/plans/2026-09-17-prompt-smith-measurement-improvement-implementation.md`
- context-map: `.claude/context-maps/2026-09-17-prompt-smith-improvement.md`
- 要件の出発点: `plugins/prompt-smith/docs/improvement-backlog.md`
- 会話記録: `docs/chat/2026/0917/phyllis998/1741-prompt-smith-improvement-plan.md`
