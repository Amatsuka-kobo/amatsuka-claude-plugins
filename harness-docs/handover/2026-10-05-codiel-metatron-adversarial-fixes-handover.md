# codiel・metatron 敵対的レビューの所見の修正 引き継ぎ書

- 日付: 2026-10-05
- 引き継ぎ元: codiel・metatron の敵対的レビューのセッション(所見一覧のコミットまで完了)
- 引き継ぎ先: 所見の修正を設計・実装するセッション
- 作業場所: worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`、ブランチ `intent-driven-development`。PR は作らない

## 現在地

| 工程 | 状態 |
| --- | --- |
| 5 区分の敵対的レビュー | 完了。所見 54 件(重複 2 組を除いて 52 件、既知の限界と重なるもの 9 件) |
| 所見一覧 | 完了(`harness-docs/design/2026-10-05-codiel-metatron-adversarial-review-findings.md`、コミット `469d3e2`) |
| 修正の設計 | 未着手 |
| 修正の実装 | 未着手 |

## 決まったこと

再検討しない。

- 所見一覧を修正の入力にする。一覧の「採否」列は修正の設計で埋める。
- 優先度は一覧の章の順とする。R2-01(critical)を最優先にし、次に「通常の運用でも起きる穴」(一覧の 2 章)、その後に「意図すれば抜けられる穴」(3 章)を扱う。
- 既知の限界と重なる 9 件は、設計書に書かれた判断を覆さない。直すかは組み合わせで新しい経路になるもの(B5-03)だけ検討する。
- 不採用案を再提案しない。とくに metatron の hook で Bash を捕捉する案(M1-07、2026-08-16-metatron-design.md:1224-1230)は既知の不採用である。

## 未決のこと

- どの所見を今回直し、どれを既知の限界として記録に回すか。設計書の冒頭でユーザーに確かめる。
- 3-a(ガードの文字列一致)は、穴をすべて塞ぐか、「AI の誤操作を止める安全網であり、意図的な回避は防がない」と保証範囲を文書に明記して一部を受け入れるか。方針を先に決めないと、修正の量が決まらない。
- 一覧の 5 章「根が同じ組」を 1 つの変更で扱えるか。

## 所見の扱いで踏みやすい点

- 「確認」列が「未実行」の所見は、指示書やコードを読んだだけの判定である。直す前に再現するか、該当行を読んで裏を取る。とくに I4-01・I4-02・I4-05・C3-02・C3-05・C3-06。
- R2-01 は git の出力の問題と guard の対象範囲の問題の 2 層ある。`subject/code.ts` の `FIXED_CONFIG` に `--text` と attributes の上書きを足すだけでは、guard-write / guard-bash が `.gitattributes` と `.git/info/` を見ない点が残る。
- C3-01 は `guard-github-mcp.test.ts:63-89` が init 直後の許可を検証している。挙動を変えるならテストも変える。
- M1-01 と B5-01 は書き込みの原子性の問題である。一時ファイルへ書いて rename する形に揃えるかを、GOTCHAS の書き込み(`gotchas.ts:943`・`:1031`)も含めて決める。
- I4-04 / B5-04 と I4-07 / B5-05 は指示書(`gotcha-candidates.md`・`adr-candidates.md`)の判定規則の問題である。書式の契約(`intent-format.md`)に触れるなら、`plugins/codiel/docs/format-change-checklist.md` の項目をすべて追随させる。
- 再現スクリプトは /tmp にあり、再起動で消える(一覧の 4 章)。消えていたら一覧の再現手順から作り直す。

## 環境と運用の注意

- `adversarial-reviewer`(GPT)は、「破る」「偽造」「回避」などの攻撃寄りの語を含む依頼文を、OpenAI 側がサイバーセキュリティ上のリスクとして拒否する。「文書が述べる保証とコードの食い違いを探す」と書くと通る。
- このセッションに登録された `mcp__plugin_codiel_raguel__evaluate_code` は旧スキーマだった(R2-11)。インストール済みの codiel が worktree より古い。Raguel を実機で使う確認の前に、プラグインを更新する。
- codiel の guard-bash は、active run が無くても `state.json` 宛ての文字列を含むコマンドを拒否した(C3-15)。テスト用の入力を Bash に直接書くと止まる。入力は Write でファイルにしてから渡す。

## 踏みやすい点

- `plugins/*/scripts/` は手で編集しない。`src/` を変えて `pnpm run build` を実行し、差分を同じコミットに入れる。
- `harness-docs/ARCHITECTURE.md`・`harness-docs/GOTCHAS.md`・`.claude/rules/metatron/` は Edit しない。metatron の CLI を使う。
- 指示書は `prompt-smith:prompt-smith` の規律で書く。`orchestrating-runs/SKILL.md` の §2.1・§2.4 は他のスキルから番号で参照されているので、番号を変えない。
- `config-schema.md` を変えるときは、metatron と codiel の 2 実装を追随させ、2 者比較テストを通す。
- 文書の日本語は native-japanese の規律に従う。「節」「段」「版」「契機」を使わない。

## 参照

- 所見一覧: `harness-docs/design/2026-10-05-codiel-metatron-adversarial-review-findings.md`
- ADR-003・ADR-007・ADR-009・ADR-011・ADR-012・ADR-013・ADR-014
- 既知の限界の出典: `harness-docs/design/2026-08-16-metatron-design.md`、`2026-09-28-raguel-redesign-design.md`、`harness-docs/plans/2026-09-29-raguel-redesign-plan.md` §11.3、`2026-10-05-codiel-run-structure-followups-design.md`
- 会話記録: `docs/chat/2026/1005/phyllis998/1133-codiel-metatron-adversarial-review.md`
