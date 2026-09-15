# codiel / sandalphon のドメインマップ依存解消 設計セッション起動プロンプト

以下を goal コマンドの入力として使う。

---

codiel と sandalphon から、ARCHITECTURE のドメインマップへの**必須依存**を解消せよ。方針は確定済み(案G＋)であり、このセッションの成果物は**設計書と実装計画書(WBS)**である。実装まで進めてよいかは、実装計画書の承認後に判断する。

## 入力文書

1. 引き継ぎ書: `harness-docs/handover/2026-09-15-codiel-domain-map-decoupling-handover.md` — **これ 1 本で足りる。**現在地・確定方針・却下された案・事実の出典(`path:line`)・作業単位・未解決事項・リスク 8 点がすべてここにある
2. (参照のみ)契約凍結: `harness-docs/design/2026-08-16-file-contract-freeze.md` §1 — 引き継ぎ書 §6-5 の判定で必要になったときだけ開く

context-map や過去の会話記録を読み直す必要はない。事実は引き継ぎ書に蒸留済みである。

## 進め方

1. `git status` と HEAD を確認する。**作業ツリーに本件と無関係な未コミット変更がある。触らない**(revert・削除・上書き・コミット混入すべて禁止)
2. `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` で baseline を再現する
3. **引き継ぎ書 §6 の未解決事項 5 件をユーザーと詰める。**ここが埋まるまで設計書を書き始めない(特に §6-1 は自動縮退の形を決める前提、§6-5 はユーザー確認が要る可能性がある)
4. 設計書 → 実装計画書の順に起こす。作業単位の棚卸しは引き継ぎ書 §5 の W1〜W13 を出発点にする
5. **設計書は Haiku レビューを先に通す**(プロジェクトの必須手順)。ユーザーレビューはその後
6. 指示書(SKILL.md / agents / references / CLAUDE.example.md)の文面確定は `prompt-smith:prompt-smith` を起動して行う。設計書のドラフトは入力素材

## 制約(違反しない)

- **却下済みの案に手を出さない。**正本の移動(`.codiel/config.json` 新設 / `raguel.config.yaml` 最上位 / `rules.<id>` 配下 / metatron へ完全移管)はすべて却下済み。理由は引き継ぎ書 §3。再提案しない
- **docRoot → codielRoot のルート基準変更を混ぜない**(引き継ぎ書 §7-5)
- **`domains: null` を一括で generic へ自動縮退させない。**「マップを使わない」と「使うはずのマップを読めない」を分けることが案G＋ の核心である(引き継ぎ書 §2.2・§3.4)
- **`plugins/sandalphon/skills/capturing-intent/SKILL.md:81` の任意参照を消さない。**「必須依存の解消」と「任意参照の全廃」は別である
- オーケストレーターだけが実行モードを知り、planner が ARCHITECTURE を読み直す設計にしない。**実行に使うモード・マップは明示した入力として渡す**(引き継ぎ書 §5 の設計上の注意)
- 契約凍結文書の変更が必要と判定したら、**実装を止めてユーザーに確認する**(`file-contract-freeze.md:18`)
- ブランチを切らない。`git push` に `--force` 系を付けない
- `plugins/*/scripts/` を手で編集しない(`pnpm run build` で再生成し、`src/` 変更と同じコミットに含める)
- 並行改修との衝突に注意する。GOTCHAS 所有権の改修(`harness-docs/design/2026-09-15-metatron-init-gotchas-design.md`)が `recording-gotchas/SKILL.md` と `CLAUDE.example.md` を触りうる(引き継ぎ書 §7-7)

## 完了報告に含めること

- 設計書・実装計画書のパスと、レビューの通過状況
- 引き継ぎ書 §6 の未解決事項 5 件それぞれの決着内容
- 契約凍結文書(`file-contract-freeze.md:64-75`)への追随の要否と、ユーザー確認の結果
- 節名参照の登録簿(分類 B 12 件)の扱い方針
- 実装へ進んでよいかの判断材料
