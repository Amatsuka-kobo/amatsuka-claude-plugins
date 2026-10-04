# metatron の記録のタイミングとサブエージェントへの注入 引き継ぎ書

- 日付: 2026-10-03
- 引き継ぎ元: codiel:run のコスト改修の残りの改修のセッション(ADR-013 まで完了)
- 引き継ぎ先: metatron を改修するセッション
- 作業場所: worktree `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins-intent-driven-development`、ブランチ `intent-driven-development`。PR は作らない

## 現在地

| 工程 | 状態 |
| --- | --- |
| codiel 側 | 完了。codiel は ADR と GOTCHAS を直接記録せず、候補を出して metatron に渡す(ADR-013) |
| metatron 側 | 完了(2026-10-04)。設計は `harness-docs/design/2026-10-04-metatron-recording-timing-and-subagent-injection-design.md`。記録のタイミングは hook でなく SessionStart の注入文に置いた |

## 決まったこと

再検討しない。

- codiel は ADR と GOTCHAS の台帳に書かず、metatron の CLI も呼ばない(ADR-013)。
- 候補の書き先は codiel の state の `knowledgeTarget`(`metatron` | `intents`)で決まる。
  - どちらのときも、候補は try のローカルレポート(`.codiel/runs/<slug>/try-<n>/reports/adr-candidates.md`・`gotcha-candidates.md`)に書く。
  - `intents` のときは、intent-sync と finalize で持続層の領域ファイル(`docs/intents/domains/<領域>.md`)へ写してコミットする。
  - 候補は finalize の結果レポートと stop の完了報告に一覧する。
- 持続層の GOTCHAS 候補の書式は `plugins/codiel/references/intent-format.md` の「GOTCHAS 候補」が正本である。
  - `## GOTCHAS 候補` の下に `### <タイトル> [GOTCHAS 候補]` の見出しで書く。
  - キーは `date`・`run`・`task`・`mistake`・`cause`・`countermeasure`・`promotionCandidate`。`run` 以外は `append-gotcha` の入力のキーと同じ名前である。
  - 候補 ID は持たない。`[解決済み]`・`[対象外]` のタグも持たない。
- 解決済みか陳腐化したかは、台帳へ移すときに人が判断する。
- バージョンは上げない。この改修は metatron の `0.4.0-dev` のリリースに含める。

## 改修する 4 件

### 1. 作業が完了したときに、記録のタイミングを知らせる hook

- 今の hook は SessionStart で記録の方法(CLI の使い方)を注入するだけで、記録するタイミングを持たない(`plugins/metatron/src/inject-context.ts`)。
- そのセッションで作業が完了したときに、ADR と GOTCHAS に記録すべき判断・失敗が無いかを確かめさせる。あれば `updating-architecture` と `recording-gotchas` で記録させる。
- 作業の完了には、codiel の run が done になったとき(`finalize` の後の結果レポートの出力)を含む。ほかの作業の完了も含む。
- 未決:
  - 「作業の完了」をどう検出するか。Stop などの hook のイベントだけでは、ターンの終わりと作業の完了を見分けられない。codiel の run は state の `awaiting_outcome` で判定できるが、ほかの作業には同じ印が無い。
  - 毎ターン発火させないための抑止。chat-history の Stop hook の通知のように、未処理のときだけ出す形が候補になる。

### 2. 持続層の GOTCHAS 候補の走査と台帳への移行

- ADR-007 の ADR 候補の走査(`scan-adr-candidates` → 承認 → ADR へ追加 → `shrink-adr-candidate`)と同じ形にする。
- 対象は `docs/intents/domains/*.md` の `[GOTCHAS 候補]` のエントリである。
- 1 件ずつ提示し、次の 3 つから人に選ばせる。
  - 台帳へ移す。
  - 移してから `tag-gotcha` で `[解決済み]`・`[対象外]` を付ける。
  - 移さずに縮める(陳腐化した候補を消す)。
- 移したエントリを持続層でどう扱うか(縮約・削除)を決める。codiel の書式の契約に関わるので、決めたら `plugins/codiel/references/intent-format.md` と両プラグインの `docs/format-change-checklist.md` を合わせる。

### 3. SubagentStart でサブエージェントへ注入する

- ARCHITECTURE と GOTCHAS は、サブエージェントにも要る知識である。今は SessionStart の注入だけで、サブエージェントには届かない。
- SubagentStart の hook で、次を注入する。CLI の使い方と記録のタイミングは載せない。
  - ARCHITECTURE の本文
  - ADR の一覧
  - GOTCHAS の目次と直近 2 件
- SubagentStart の hook が `additionalContext` でサブエージェントのコンテキストへ文を足せるかは【要確認】。Context7 で Claude Code の hooks のドキュメントを確かめてから設計する。

### 4. オーケストレーターへの指示

- SessionStart の注入文に、「サブエージェントに ARCHITECTURE と GOTCHAS の原文を渡さない」旨を足す。
- 理由: 3 の注入とオーケストレーターの転記が重なると、同じ指示が二重になる。

## 踏みやすい点

- ADR の追加・状態変更は `metatron:updating-architecture` を起動して行う。`harness-docs/ARCHITECTURE.md` は Edit しない。
- `plugins/metatron/scripts/` は手で編集しない。`src/` を変えて `pnpm run build` を実行し、差分を同じコミットに入れる。
- `plugins/*/hooks/hooks.json` を変えたら、新しいセッションで hook が発火することを確かめる。
- `plugins/metatron/src/__test__/section-reference-inventory.test.ts` は、codiel の文書の ARCHITECTURE への言及を登録簿と照合する。言及を足す・消す・移すと落ちるので、登録簿を合わせる。
- 文書の日本語は native-japanese の規律に従う。「節」「段」「版」「契機」(条件や時点の意味のとき)を使わない。

## 後続(codiel 側)

3 が入った後に、codiel の依頼文テンプレートの「ドメインマップ」の行(JSON の全文)を消す作業がある。codiel の改修の引き継ぎ書(`2026-10-03-codiel-run-structure-followups-handover.md`)で扱う。review の委譲へ ARCHITECTURE のパスを渡す規則は残す(ユーザー決定)。

## 参照

- ADR-013・ADR-007・ADR-003(`node <metatron の CLI> get adr`)
- `plugins/codiel/references/intent-format.md`(GOTCHAS 候補・ADR 候補の書式)
- `plugins/codiel/skills/orchestrating-runs/references/gotcha-candidates.md`・`adr-candidates.md`
- 設計書: `harness-docs/design/2026-10-02-codiel-run-cost-design.md` §1 の K12
