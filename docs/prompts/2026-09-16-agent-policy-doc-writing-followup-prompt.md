# agent-policy doc-writing 追加分 未解決事項の後始末 起動プロンプト

以下を goal コマンドの入力として使う。

---

agent-policy 0.19.0-dev の未解決事項 4 件(A〜D)を解消せよ。A・B・C は実装まで進め、D は設計書の承認まで進めたうえで、承認後に実装せよ。

## 入力文書

1. 引き継ぎ書: `harness-docs/handover/2026-09-16-agent-policy-doc-writing-followup-handover.md` — **これ 1 本で足りる。**現在地・A〜D の事実と作業内容・進め方の規律・スコープ外がすべてここにある
2. (参照のみ)設計書: `harness-docs/design/2026-09-16-agent-policy-doc-writing-role-design.md` §10・§4.13 — 引き継ぎ書に書かれた事実の裏取りが必要になったときだけ開く

context-map や過去の会話記録を読み直す必要はない。事実は引き継ぎ書に蒸留済みである。

## 進め方

1. `git status` と HEAD を確認する。**作業ツリーに本件と無関係な未コミット変更がある可能性がある。触らない**(revert・削除・上書き・コミット混入すべて禁止)
2. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` で baseline を再現する
3. A(死んだ配管の除去)・B(stale fixture の修正)・C(cliproxyapi-setup.md の Gemini 追随)を並列にディスパッチする。それぞれ引き継ぎ書 §2 の記述を出発点にする
4. D(en 生成定義と日本語対応表の不整合)は設計書を起こす。案 (a)/(b)/(c) のどれを採るかは**このセッションが勝手に決めない**。3 案を比較した設計書を書き、レビュー(設計書・実装計画書の独立レビューとレビュー)の 2 系統を通してからユーザー承認を得る
5. ユーザー承認後、D を実装する
6. A〜D の実装後、`pnpm run lint` / `pnpm run typecheck` / `pnpm run test` を通し、`src/` を変更したものは `pnpm run build` を実行して `scripts/` の差分を同じコミットに含める
7. A / B / C / D を分けてコミットする

## 制約(違反しない)

- **D の案 (a)/(b)/(c) を勝手に決めない。**設計書で比較し、ユーザーが選ぶ
- 文書(C の手順書、D の設計書)の執筆はオーケストレーターが自分で書かず「文書作成」役へ委譲する。内容の確定はオーケストレーターが行う。`document-writer` が 429 で使えないときは担当表の Claude モデル(Sonnet)へ読み替える
- ブランチを切らない。`git push` に `--force` 系を付けない
- `plugins/*/scripts/` を手で編集しない(`pnpm run build` で再生成し、`src/` の変更と同じコミットに含める)
- `.claude/agents/` は gitignore 対象であり、再生成してもコミットに出ない
- `harness-docs/ARCHITECTURE.md` / `harness-docs/GOTCHAS.md` / `.claude/rules/metatron/` は直接編集せず、metatron の CLI を使う
- C の手順書はログインコマンド名を Context7 または WebSearch で確認してから書く。推測で書かない
- バージョンは `0.19.0-dev` → `0.19.1-dev` を A・B・D の実装で 1 回だけ上げる

## 完了報告に含めること

- A〜D それぞれの決着内容(A・B・C は実装済みか、D は設計書が承認されたか・実装まで進んだか)
- コミット一覧とそれぞれが含む作業単位
- 変更後のプラグインバージョン
- D で採用した案とその理由、却下した案とその理由
- 残っている未解決事項(あれば)
