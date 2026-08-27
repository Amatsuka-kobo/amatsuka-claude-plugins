# agent-policy 外部 Agent モデル割当・合成 実装引き継ぎ

- 日付: 2026-08-27
- 引き継ぎ元: 設計セッション（設計・レビュー 3 巡・実機検証・実装計画作成まで完了）
- 引き継ぎ先: 実装セッション

## 現在地

| 工程 | 状態 |
| --- | --- |
| 設計書（第 4 版） | **承認済み**。レビュー 3 巡（Haiku / Grok 独立 / 監査引き継ぎ書突き合わせ）+ ユーザー決定 2 件を反映済み |
| 実機検証 §8.1〜8.7 | **完了（2026-08-27）**。前提との食い違いなし。結果は設計書 §8「実測結果」に記録。§8.8・8.9 は実装後検証（計画 Task 8） |
| baseline | HEAD `74071e6` で lint / typecheck / test（1878 件）全通過を記録済み |
| 実装計画書（第 3 版） | 作成済み。レビュー**第 2 巡まで完了・反映済み**（Haiku / Grok 独立 / 設計書突き合わせ(GPT Sol) × 2 巡）。第 2 巡で設計書側も 2 点是正済み（適用除外 3 の allow-list へ `color` / `agent-policy-role` を追加、断片の軽量帯条項の扱い） |
| 実装 | 未着手 |

## 正本文書（この順で読む）

1. 実装計画書: `harness-docs/plans/2026-08-27-agent-policy-external-agent-model-assignment.md` — Task 1〜8、テスト先行、確定済みの実装仕様（parser 規則・照合規則・fail-open・切り詰め）
2. 設計書: `harness-docs/design/2026-08-27-agent-policy-external-agent-model-assignment-design.md` — 判定フロー・起動形態 3 種・適用除外・配布機構・不採用案・監査対応
3. 監査引き継ぎ書: `harness-docs/handover/2026-08-26-agent-policy-external-agent-compatibility-handoff.md` — 背景の監査所見と移行期の安全運用条件

## 実装セッションが最初にやること

1. 最新 `git status` と HEAD を確認する。**計画の「ファイル構成」に無いファイルには一切触れない**（作業ツリーに無関係な未コミット変更・未追跡ファイルが多数ある。revert・削除・上書き・コミット混入すべて禁止）
2. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` で baseline が再現することを確認する
3. 計画の Task 0（着手時再確認）から順に、**テスト先行**で実装する。タスク順は Task 0 → 1 → 5 → 2 → 3 → 4 → 6 → 7 → 8（Task 5 が Task 2 より先。計画「タスク依存」を参照）

## 落とし穴（設計・レビューで実証済みのもの）

- `tools:` の値が空文字のとき `[]` に解釈してはならない（block 配列の先頭行。`[]` にすると Agent 保有定義が deny され P0 を取りこぼす）
- 適用除外 3 の allow-list には `color` と `agent-policy-role` を含める（第 2 巡で是正済み。含めないと生成器・ウィザードが書くこの 2 フィールドで大半の Agent が適用除外に落ち、モデル注入も合成も発火しない）
- frontmatter parser の block 配列収集は `tools` キー限定。他キーへ広げると SessionStart の対応表・警告の挙動が変わる
- SubagentStart のプロジェクトディレクトリ解決は `CLAUDE_PROJECT_DIR` のみ（`cwd` フォールバック禁止 — SessionStart との対応表同一性を優先する意図的な逸脱）。stdin は 2 秒タイムアウト付きで読む
- 対応表は **project 走査の結果だけ**から生成する。同梱定義を混ぜると SessionStart と不一致になり、子が同梱プリセットへ再委譲する
- `session-start.ts` の `LABELS` はモジュールスコープのキャッシュ。フックのテストは in-process ではなく既存の `runTs` 子プロセス慣行で書く（stdin は `input` オプション）
- `scanAgents` は存在しないディレクトリで throw しないこと。`CLAUDE_PLUGIN_ROOT` / `CLAUDE_PROJECT_DIR` 欠落時も exit 0 を守る（欠落時は該当走査をスキップして注入継続）
- 方針スキルの旧文「定義ファイルを持つ Agents は本文を同梱して担当 GPT/Grok へ dispatch」は**常時合成**を意味するため、役割ベース dispatch 限定へ書き直す（残置すると判定フローと矛盾する）
- `orchestration-discipline.md` L14（Agent tool 許可帯）と L15（相談先は常に Fable）は現行のままだと新断片と食い違う。Task 5 Step 2 の是正を落とさない
- AI 向け指示書（references / SKILL.md / README）の文面確定は規約どおり `prompt-smith:prompt-smith` を起動する。計画のドラフトは入力素材
- hooks.json の変更は新セッションから効く。発火確認は Task 8 で行う（設計 §8.6 の残項目 = プラグイン定義の `agent_type` 形式確認を含む）

## 完了条件（Done）

計画 Task 7・8 のとおり: lint / typecheck / test / build 全通過、`scripts/` 差分の同コミット化、バージョン 0.13.0-dev へ揃え上げ、README（plugin + ルート）反映、`/metatron:update` で ARCHITECTURE 追随（hooks 構成 + 配布物 → 参照層の新依存）、実装後検証（Task 8）の完了。完了報告に「移行期の運用条件のうち緩和されるのは親子 map 非仮定のみ」を明記する。

## スコープ外（このセッションで手を出さない）

- 監査所見 1・2（discovery 拡張）と 4〜11 の修正 — 別課題
- setup-agents への 1 サーバー追加専用経路 — 見送り済み（将来課題）
- 割当マップ / 派生定義生成 / CLAUDE.md 焼き込み / 反転注入 — 設計で不採用確定。再提案しない
