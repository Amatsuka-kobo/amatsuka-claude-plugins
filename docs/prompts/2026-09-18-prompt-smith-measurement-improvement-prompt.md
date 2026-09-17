# prompt-smith の測定基盤を改善する起動プロンプト

以下を goal コマンドの入力として使う。

---

prompt-smith と metatron の測定基盤改善を実装せよ。`harness-docs/plans/2026-09-17-prompt-smith-measurement-improvement-implementation.md` を最初に全文読み、S1-1 から S6-4 までを順に実行して Done 条件を満たす。判断の根拠が必要なときは `harness-docs/design/2026-09-17-prompt-smith-measurement-improvement-design.md` を参照する。

## 進め方

1. 実装計画書のステップ順と、各ステップの受け入れ条件に従う。確定済みの設計を覆さない。
2. `prompt-smith` を `0.4.0-dev`、`metatron` を `0.3.6-dev` に上げる。各プラグインで `plugin.json` と `package.json` のバージョンを揃える。
3. 段 5 の測定は最大 1140 回の `claude -p` を伴う。測定中は他の作業を行わず、同じホームを使う他のプロセスも動かさない。
4. 測定の生データはリポジトリ外の `~/prompt-smith-measure-2026-09-17/` に置く。判定と集計値だけを `plugins/prompt-smith/docs/measurement-2026-09-17.md` にコミットする。
5. `plugins/*/src/` を変更した後は `pnpm run build` を実行し、生成された `plugins/*/scripts/` の差分を同じコミットに含める。`plugins/*/scripts/` は手で編集しない。
6. `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` をすべてパスさせる。

## 承認が必要な箇所

- 比較 B の 600 バイト案(S5-1 Step 5)
- eval 問の差し替え(S4-3、S4-4)

これらは該当ステップで提案を示し、承認を得てから進める。

## 制約

- `SKILL.md` を編集するときは、prompt-smith プラグインの規律に従う。
- 実装計画書で定めた隔離、CLI、ループ、eval、測定、規律の順を崩さない。
- 比較 A と比較 B が同じ方向を示す場合だけ規律を確定する。片方だけの場合は設計書 §13 の 2×2 表に従う。
- 本件と無関係な作業ツリーの変更を revert・削除・上書き・コミット混入しない。

## 完了報告に含めること

- S1-1 から S6-4 の実施結果と受け入れ条件の充足状況
- 承認を得た比較 B の 600 バイト案と eval 問の差し替え
- 測定の判定、集計値、規律を確定したかどうか
- 実行した検証と結果
- 文書・メモリ・生成物の追随結果、変更後のプラグインバージョン、コミット一覧
- 残る未解決事項
