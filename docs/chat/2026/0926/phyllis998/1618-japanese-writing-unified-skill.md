# 自然な日本語スキルのライセンス調査と派生設計

- 日付: 2026-09-26
- 参加者: phyllis998, AI (Claude Haiku 4.5)
- 成果物: ライセンス適合性調査、派生スキル設計上の注意点の整理
- 前提: natural-japanese プラグイン (MIT)、agent-policy:custom-policy スキル
- セッション ID: 2d704827-e250-4974-baed-2e9e801bce21

---

## セッション 1: natural-japaneseのMITライセンス下での派生スキル設計検討

# phyllis998

> AIが使う日本語を是正するスキルをプラグインとして作りたいです。
> 内容はnatural-japaneseの規律を元に、agent-policyの文章規律を足し、prompt-smithの規律で書かれた1枚のSKILL.mdとしたいです。
> natural-japanesが文書を作成する時のみ呼び出すことに特化しているのに対し、こちらは毎セッション使用し、文書の作成だけでなくプログラムのコメント文やユーザーとの会話にもその規律を用いるようにできるものにしたいです。
> まずはnatural-japaneseのライセンスや規約等を確認し、それが可能かどうか調査してください。

# AI

まず natural-japanese と agent-policy:custom-policy のスキルを読み、ライセンス調査に入る。

調査完了。結論と根拠を報告。

## 結論

**可能。** natural-japanese は MIT。改変・再配布・別名配布 すべて許可。条件は著作権表示と許諾文の同梱のみ。

## 根拠

- `LICENSE`: MIT License / Copyright (c) 2026 coji
- `.claude-plugin/plugin.json`: `"license": "MIT"`
- `SKILL.md` frontmatter: `license: MIT`
- README「ライセンス」節: MIT 明記。GitHub 上流(coji/natural-japanese)も同一
- 追加規約・利用制限 なし(README・AGENTS.md・CLAUDE.md いずれも)

## 二次出典の確認

規律本文が引用する外部資料も確認済:

- k16shikano「日本語技術文書の文章規範」(forbidden-patterns.md 3 節の出典) → **Unlicense**(パブリックドメイン相当)。制約なし
- readability-principles.md 出典 → 書籍 5 冊(本多勝一・木下是雄 等)。考え方の参照のみ、本文転載なし。問題なし
- なつ「いとおり」note 記事・meiseki → 着想元として謝辞のみ。転載なし

## 同梱時の義務

- 新プラグイン配下に coji の MIT 許諾文を置く(`plugins/<新名>/LICENSE` または `NOTICE`)。SKILL.md が規律の書き直しでも「substantial portions」扱いが安全側
- README に由来を明記: coji/natural-japanese v1.5.0 (MIT) を元に再構成
- 本リポジトリ: ルート LICENSE なし。prompt-smith だけ Apache-2.0。新プラグインを Apache-2.0 にしても MIT 部分の表示保持で両立可

## 設計上の注意(ライセンス外)

- ARCHITECTURE 規則「指示層・参照層に他プラグイン名を書かない」→ 帰属表示は README/LICENSE へ。SKILL.md 本文に natural-japanese の名は書けない
- agent-policy 文章規律の所在: `plugins/agent-policy/references/orchestration-discipline.md:72-82` と `assets/roles/ja/_common.md:30-33`。自リポジトリ内容 → 制約なし
- lint.py 等の uv スクリプトは不要(1 枚 SKILL.md 構成)。sudachipy 依存 持ち込まない
- 毎セッション適用は現行 genshijin(極限)の口調規律と衝突。優先関係を設計段階で決める必要あり

次: 設計(brainstorming)に進むか判断待ち。

調査結果は上記のとおり。natural-japanese は MIT で、著作権表示と許諾文を同梱すれば派生プラグインの作成・配布は可能。次は設計に進むか、判断を待つ。

## セッション 2: 派生スキル native-japanese の設計案(6節)提示

# AI

記録完了。調査結果は前述のまま。natural-japanese は MIT、派生プラグイン作成可。次の指示待ち。

記録タスク終了。追加作業なし。指示待ち。

# phyllis998

> 設計に進んでください

# AI

設計に入る。まず brainstorming スキルを起動。

分類: 新規プラグイン → **architectural**。設計書は本リポジトリ規約により `harness-docs/` へ。まずコンテキスト探索。

質問 2: プラグイン名。SKILL.md 本文に他プラグイン名を書けない規則があるため、固有名が要る。

名称 `native-japanese` 確定。

質問 3: 口調系の指示(genshijin の圧縮口調、output style の敬体/常体)との優先関係。

回答反映: native-japanese = 基底層。genshijin / output style は上書き層。

設計案を節ごとに提示。各節 OK かを最後にまとめて確認。

## 1. 構成

```
plugins/native-japanese/
├── .claude-plugin/plugin.json   0.1.0-dev
├── LICENSE                      本プラグインのライセンス + coji MIT 許諾文(派生元表示)
├── README.md                    利用法・由来(coji/natural-japanese v1.5.0 MIT 派生)
├── hooks/hooks.json             SessionStart(startup|resume|compact)
├── skills/native-japanese/SKILL.md   規律本体 1 枚
├── build.ts / package.json / src/session-start.ts / src/__test__/
└── scripts/session-start.mjs    バンドル出力
```

## 2. 注入機構(判断軸: 移植性・リポジトリ規約適合・触るファイル数)

- **案 B 推奨: TS スクリプト** `session-start.ts` が SKILL.md を読み frontmatter を剥いで stdout へ出す。SessionStart の stdout は文脈に載る。`compact` でも再注入 → 圧縮後も規律維持。prefetch と同型。触るファイル: pnpm-workspace.yaml 追加、テスト 1 本
- 案 A: hooks.json に awk 一行。ファイル最少だが `scripts/` 手書き禁止規則の外側でシェル依存。規約と不整合
- 案 C: 「スキルを使え」1 行注入。質問 1 で却下済み

## 3. SKILL.md の内容(prompt-smith 規律で執筆、目標 120〜180 行)

節構成:

1. **適用範囲**: 日本語で書く全出力(会話・コード内コメント・コミット文・文書)。基底層宣言: 口調・文体を指定する他の指示があればその項目だけ上書き、残りは有効
2. **構成の規律**(文体憲法から常時適用できる条を抽出): 前置きなし結論先 / 見出しは結論 / 箇条書きは真の並列のみ / 用語は機能→名前 / 固有名詞・数値で接地 / 太字は核 1 箇所 / 濃淡 / 同型 3 回禁止 / 「〜ではなく」は誤解訂正時のみ / 確信度は【要確認】等ラベル / 事実と意見の分離 / 結びは再統合
3. **文の規律**: 長い修飾語先・短い修飾語直前 / 読点は統語の切れ目 / 一文一義 40〜60 字目安 / 主述近接 / 文末単調回避 / 接続詞の射程
4. **翻訳調の言い換え**(引くための記述、表): 無生物主語+他動詞 / 〜することができる / 〜という観点から / 〜にとって重要 / 〜を持つ / 〜することによって / 〜に他ならない / ダッシュ挿入句 / cleft 構文 → 各 Before/After 1 組
5. **避ける語**(引くための記述、表): まとめ口調 / 過剰強調 / 空疎な接続 / 予防線 / 三点構成・数宣言 / 空虚な形容・動詞 / 決め文 / 水増し講釈 — 語の列挙のみ、理由は削除
6. **訳語**(agent-policy §文書の執筆から): 直訳せず慣用へ + Version/Green・Red/Frozen/Ledger/Step の 5 項
7. **コメント・会話での適用**: コメントは「何を」でなく「なぜ」を接地して書く…は natural-japanese に無い → 追加せず、2〜6 の適用のみ(YAGNI)

落とすもの: 工程(設計→執筆→検査→収束)、lint/outline/terms/semantic、doctype、score、style-profile、6 軸ルーブリック、根拠・実測値・出典(prompt-smith 削る基準)

## 4. 帰属

- SKILL.md 本文・description に natural-japanese の名なし(ARCHITECTURE 規則)
- LICENSE: 本プラグインは Apache-2.0(prompt-smith と同じ)+ 末尾に coji MIT 全文。README「由来」節に元と版
- ルート README 表・marketplace.json へ登録

## 5. 検証

- vitest: frontmatter 剥離、SKILL.md 不在時の空出力(exit 0)
- 新セッションで注入を目視確認(protected-paths の hooks.json 規則)
- description の発火測定(skill-creator eval ループ): hook 注入が主経路のため **省略**。description は明示呼び出し用に短く書く

## 6. 非スコープ

- SubagentStart 注入(質問 1 で不採用)
- 英語出力への適用
- 検査スクリプトの同梱

節 1〜6、修正点は? 承認後、設計書を `harness-docs/design/2026-09-26-native-japanese-design.md` に執筆(system-planner 委譲)→ docs-reviewer レビュー → ユーザーレビュー。

設計案(節 1〜6)の承認待ち。修正点があれば節番号で指摘を。

## セッション 3: native-japanese 設計を修正・承認待ちへ移行

# AI

記録完了。設計案(節 1〜6)の承認待ち。

設計案(節 1〜6)の承認待ち。

# phyllis998

> CLAUDE.mdなどで使うよう指示しないのであれば、SubagentStartも必要、かつSKillでなくてもよいのでは

# AI

同意。両方採用。設計を改訂。

## 改訂点(節 1・2・5 を差し替え)

**1. 構成** — `skills/` 廃止、規律は参照層へ

```
plugins/native-japanese/
├── .claude-plugin/plugin.json      0.1.0-dev
├── LICENSE / README.md
├── hooks/hooks.json                SessionStart + SubagentStart
├── references/discipline.md        規律本体 1 枚(prompt-smith 規律で執筆)
├── build.ts / package.json
├── src/inject.ts + src/__test__/inject.test.ts
└── scripts/inject.mjs              バンドル出力
```

- ARCHITECTURE の依存方向「配布物層は参照層を実行時に読む」に適合
- prompt-smith の対象は `references/` 配下も含む → 執筆規律は変わらず
- Skill 廃止の帰結: description・eval 測定・frontmatter 剥離が消える。明示呼び出し(`/native-japanese`)は不要(常に文脈内)

**2. 注入機構** — 1 スクリプトで 2 イベント

- stdin の `hook_event_name` を読み、`references/discipline.md` を `hookSpecificOutput.additionalContext` に載せて JSON 出力(agent-policy と同型)
- SessionStart: startup / resume / clear / compact 全て。compact 後も規律維持
- SubagentStart: 全サブエージェント。コメント・文書を書く委譲先にも効く
- ファイル不在時: 空出力・exit 0(セッションを止めない)

**5. 検証**

- vitest: SessionStart / SubagentStart 各 1 ケース(hookEventName が入力に追随)、ファイル不在で空出力
- 新セッション・サブエージェント起動で注入を目視確認

節 3(内容)・4(帰属)・6(非スコープ)は据え置き。ただし非スコープから「SubagentStart 注入」を外す。

承認で設計書執筆へ。

改訂設計(節 1・2・5 差し替え、3・4・6 据え置き)の承認待ち。

## セッション 4: 改訂設計の承認完了

# phyllis998

> 承認します

# AI

記録完了。改訂設計の承認待ち。

改訂設計の承認待ち。

## セッション 5: native-japanese 改訂設計の最終承認

# phyllis998

> 追加で、agent-policyの文書規律をこちらに取り込むので、重複指示にならないようagent-policyの規律を削ることにしたいです。

# AI

了解。影響範囲を調査済み。設計に節 7 を追加。

## 7. agent-policy からの文書規律の撤去

取り込み先は native-japanese の `references/discipline.md` §訳語ほか。削る対象と残す対象:

**削る**

- `references/orchestration-discipline.md` §文書の執筆(5 項 + 訳語 5 項)
- `assets/roles/ja/_common.md` §文書の執筆(同内容)
- `assets/roles/en/_common.md` §Writing(英語版。言語非依存の一般則のみ 5 項)
- `src/agents/compose.ts` の執筆節の合成、`vocabulary.ts` の `writingHeading`
- `compose.test.ts` の執筆節テスト 3 件(順序・一度だけ・英語)。順序テストは見出し配列から外す

**残す**

- `orchestration-discipline.md` §文書の執筆を委譲するとき(委譲の依頼文の書き方。文体規律ではない)

**帰結**

- サブエージェントには native-japanese の SubagentStart 注入が届く → 重複なし
- 英語で書く定義は文体規律を失う。native-japanese は日本語のみ管轄のため、英語出力の規律は消える(設計上の割り切り。要承認)
- 本リポジトリの `.claude/agents/*.md` 3 定義以上に `## 文書の執筆` が残存 → setup-agents で再生成。GOTCHA-001 に従い `--mcp-deny` を明示、再生成前に複製・差分確認
- agent-policy のバージョンを上げる(パッチ)。Serena メモリと agent-policy README は該当記述なし(README は grep 0 件、メモリは実装時に再確認)

判断軸: 英語版 §Writing を残すか。

- 残す → en 定義だけ規律を持つ非対称。compose の分岐が残る
- 削る(推奨) → 対称・コード削減。英語出力の文体規律は無くなる

節 1〜7 で承認可なら設計書執筆へ。

節 1〜7 の承認と、英語版 §Writing の削除可否の判断待ち。

## セッション 6: native-japanese 設計承認と設計書執筆委譲

# AI

記録完了。節 1〜7 の承認と、英語版 §Writing 削除可否の判断待ち。

承認待ち(節 1〜7、英語版 §Writing 削除可否)。

# phyllis998

> 英語版も削って、設計書に進んでください

# AI

承認受領。設計書執筆を system-planner に委譲。設計書は通常日本語で書く(原始人口調は不適用)。

設計書執筆中(system-planner)。完了後 docs-reviewer レビュー → 反映 → ユーザーレビューへ。

設計書執筆中。完了通知待ち。

## セッション 7: 設計書完成・レビュー全件反映

# AI

記録完了。設計書執筆(system-planner)の完了待ち。

設計書執筆(system-planner)の完了待ち。

設計書完成(341 行)。docs-reviewer にレビュー委譲。

レビュー中。並行して設計書の仮置き箇所を確認。

仮置き箇所の判断(レビュー結果と合わせて反映予定):

- §11-1 コミット: 2 つで確定。未解決から外す
- §11-2 節 5 分類: 「感嘆・共感の演出」を 9 番目に追加、「正面から系」は「空虚な形容・動詞」へ吸収。「対比の多用」は節 2 に既出、「体言止め過用」は口調層のため対象外
- §11-3 NOTICE: 作らない(prompt-smith の NOTICE は移植の差分表であり、本件には不要)
- §11-4 CLAUDE.md: ユーザー判断として残す

docs-reviewer の完了待ち。

レビュー受領。要修正 3 件・推奨 5 件。全件反映する(判断込み)。

Next: §6 節 3〜5 補強、§7 LICENSE 明確化、§8-4 ビルド順、§11 整理。

設計書コミット済み(`27acbbc`)。ユーザーレビュー待ち。

**ファイル**: `harness-docs/design/2026-09-26-native-japanese-design.md`(353 行)

**docs-reviewer 指摘 8 件、全件反映**

- 要修正: 再生成前に `pnpm run build` を挟む手順を §8-4 に追加(バンドルが旧 `writingHeading` を持つため)
- 要修正: コミット 2 つで確定、§11 から除去
- 要修正: 派生元から落とした項目を全列挙(§6)。連体修飾の入れ子・トピックセンテンスは節 3 へ追加、感嘆・共感の演出を節 5 の 9 分類目に追加、正面から系は空虚な形容へ吸収、拡張リストは分類へ振り分け、読者の 3 軸・語彙の使い回し・体言止め過用は落とす(理由記載)
- 推奨: additionalContext 10,000 文字超は切り詰めでなくファイル退避、と §2-3 を訂正
- 推奨: SessionStart の発火に `fork` を追記
- 推奨: 空白だけの本文のテストケースを §4-4 に追加
- 推奨: LICENSE は Apache-2.0 単一。MIT 全文は「Third-party notice」見出し下で帰属表示として併記、デュアルでないと明記
- 推奨: NOTICE 不要を §7 で確定

**残る未解決(§11)**: 導入後、本リポジトリ CLAUDE.md の natural-japanese 使用指示を残すか。ユーザー判断。

レビュー後、承認で実装計画書(writing-plans)へ。

# phyllis998

> テスト方式をなぜgh-utilityに合わせたのですか？

# AI

§4-4 訂正・コミット済み(`e9ff427`)。他の指摘、または承認で実装計画書へ。

設計書レビュー待ち。承認で実装計画書(writing-plans)へ。

## セッション 8: テスト方式がリポジトリ共通パターンに従う根拠と代替案

# AI

記録完了。設計書レビュー待ち。

設計書レビュー待ち。

# phyllis998

> 質問に答えてください

# AI

質問「テスト方式をなぜ gh-utility に合わせたのか」への回答。

**結論**: gh-utility 固有の方式ではない。リポジトリ共通の型を採った。設計書の「gh-utility に倣う」という書き方が誤解を招いたため、既に訂正・コミット済み(`e9ff427`)。

**根拠**

- `src/testing/run-ts.ts`(tsx で TypeScript を子プロセス起動する補助)は 9 プラグインが同一実装を持つ: agent-policy / chat-history / codiel / gh-utility / guidepost / metatron / pitcrew / raphael / sandalphon
- 同一実装を各自が持つ理由: ARCHITECTURE「実装層は他プラグインの `src/` を import しない」+ testing-policy「子プロセスとして起動するエントリポイントは `src/testing/` に置く」
- hook スクリプトの契約は stdin → stdout / exit code。関数を export して in-process で呼ぶ方式では exit code と stdout の空・非空を検証できない。agent-policy と guidepost の hook テストも同じ子プロセス方式
- 設計書の執筆者が gh-utility を名指ししたのは、複製元として最初に読んだファイルがそれだったため。手本は同型の prefetch を指示したが、prefetch はテストを持たず、隣の gh-utility を参照した

**検討した代替**: `inject.ts` から純関数を export して直接テスト。契約の半分(exit code・出力の有無)を検証できず、リポジトリの hook テストの型からも外れるため不採用。

回答済み(前ターン)。設計書レビューの続きを待つ。

## セッション 9: ライセンス選択：Apache-2.0 から MIT への変更検討

# AI

記録完了。設計書レビュー待ち。

設計書レビュー待ち。

# phyllis998

> ライセンスをApach2.0とした理由はなんですか？

# AI

理由は弱い。「リポジトリ内で LICENSE を持つ唯一のプラグイン prompt-smith に揃えた」だけ。

**prompt-smith が Apache-2.0 なのは上流の都合**: Anthropic の skill-creator(Apache-2.0)を移植したため、同一ライセンスを選ぶ必要があった。本件の上流は MIT → 同じ制約は無い。

**推奨: MIT に変更**

判断軸と評価:

- 上流との整合: MIT なら同一 → LICENSE 1 本、Third-party notice 不要、デュアル誤読も消える。Apache-2.0 なら MIT 全文併記が要る
- 特許条項: Apache-2.0 の利点。Markdown 1 枚 + 30 行スクリプトには実益なし
- リポジトリ内の整合: ルート LICENSE なし、他 11 プラグインもなし。prompt-smith だけ Apache-2.0(上流由来)。揃える対象が実質無い
- 利用者の読みやすさ: MIT の方が短く、派生元の Copyright 行を自分の行と並べるだけで済む

MIT の場合の LICENSE: 
```
MIT License
Copyright (c) 2026 amatsuka-koubou
Copyright (c) 2026 coji (natural-japanese の派生部分)
<MIT 本文>
```

変更するなら §7 と §10 を書き直す。判断を。

ライセンスの判断(MIT へ変更するか、Apache-2.0 のままか)待ち。

## セッション 10: native-japanese ライセンス MIT 変更確認と記録

# phyllis998

> MITに変更してください

# AI

MIT に変更、コミット済み(`2f0f0b2`)。

- §7: MIT 1 通。著作権表示 2 行(amatsuka-koubou / coji + 派生部分の注記)。NOTICE なし
- §10: 不採用案に「Apache-2.0(prompt-smith に揃える)」を理由付きで追加
- 前提資料から prompt-smith/LICENSE を除去

他の指摘、または承認で実装計画書へ。

記録完了。設計書レビューの続き待ち。

設計書レビュー待ち。

設計書レビュー待ち。承認で実装計画書へ。

## セッション 11: native-japanese 実装計画書執筆を system-planner に委譲

# AI

記録完了。設計書レビュー待ち。

設計書レビュー待ち。

# phyllis998

> 実装計画書に進んでください

# AI

承認受領。設計書ステータス更新 → writing-plans 起動。

writing-plans 起動。既存の計画書の型を確認して system-planner へ委譲。

計画書執筆を system-planner へ委譲。

計画書執筆中(system-planner)。完了後 docs-reviewer レビュー → 反映 → ユーザーレビューへ。

計画書執筆中。完了通知待ち。

## セッション 12: 実装計画書完成・レビュー反映・SDD開始

# AI

記録完了。計画書執筆(system-planner)の完了待ち。

Raphael 蒸留をバックグラウンド起動。計画書執筆(system-planner)の完了待ち。

Raphael 蒸留完了(抗体 1 件新規、未蒸留 0)。計画書執筆(system-planner)の完了待ち。

計画書執筆(system-planner)の完了待ち。

計画書完成(1,169 行)。設計書との食い違い 2 件を検証。

両件とも実コードで確認。設計書 §8-3・§8-4 を追随させる(更新基準 (b))。

計画書コミット済み(`0e4639f`)。docs-reviewer レビュー中。完了後に反映 → ユーザーレビューへ。

レビュー 12 件(要修正 6・推奨 5・任意 1)。全件、判断つきで計画書へ反映させる。

レビュー反映を system-planner に依頼中。完了後にコミット → ユーザーレビューへ。

レビュー反映(system-planner)の完了待ち。

実装計画書 完成・コミット済み(`01f2215`)。ユーザーレビュー待ち。

**ファイル**: `harness-docs/plans/2026-09-26-native-japanese-plan.md`(1,180 行)

**構成**: T0 baseline → T1 discipline.md(付録 A の草案 126 行・3,879 字を prompt-smith で 1 パス) → T2 inject.ts + テスト 13 件 → T3 配布宣言・hooks・LICENSE・README・登録 → T4 agent-policy 撤去(ja/en 断片・compose・vocabulary・テスト・README 移行リスト・版上げ) → T5 Serena メモリ → T6 Agent 定義再生成(定義ごとに OK は `--write`、NG は手で節削除。complex-reviewer は NG 想定) → T7 目視検証(`--plugin-dir`、新セッション・/clear・/compact・サブエージェント) → コミット 2 本

**docs-reviewer 指摘 12 件、全件反映済み**。設計書との食い違い 2 件(`--merge` では節が残る / agent-policy README 移行リストの 1 文)は設計書側へ反映済み(`0e4639f`)

**実行方式の選択**: 実装は別セッション前提(計画書冒頭)。session-handover スキルで `docs/prompts/` に起動プロンプトを作るか、このセッションで subagent-driven で進めるか。判断を。

計画書レビューと実行方式の判断待ち。

# phyllis998

> 承認します

> 承認します。進め方はこのセッションで、SDDで進めてください。ただし、agent-policyに従い可能な限り並列に作業してください

# AI

SDD 起動。リポジトリ規約により main で作業(ブランチ不可)。まず計画書の構造・依存を確認し、作業場と台帳を作る。

計画の依存: T1 ∥ T4 → T2 ∥ T5 → T3 → コミット 1・2 → T6 → T7 → T8 ∥ → T9。並列は T1+T4、T2+T5、T8a+T8b。台帳・T0・依頼書を作る。

T1(discipline.md)と T4(agent-policy 撤去)を並列 dispatch。

T1・T4 実行中。待機中にレビュー用テンプレートと T5 手順を先読み。

T5(Serena メモリ)は内容が確定済みのため今並行で実施(T4 が失敗したら戻す)。

T5 完了。T1・T4 の完了通知待ち。

T1・T4 実行中。完了通知待ち。

## セッション 13: 訳語と翻訳表現の統合・版上げ検討

# AI

記録完了。T1・T4 の完了通知待ち。

T1・T4 実行中。完了通知待ち。

T1 完了(懸念: 検証コマンド未実行)。契約検査を自分で行い、レビューを dispatch。

契約 OK(3,771 字・125 行・6 節・禁止名 0)。T1 レビューと T2 実装を並列 dispatch。

実行中: T4 実装、T1 レビュー、T2 実装。完了通知待ち。

T4 完了。報告ファイルは実装者が未作成 → 返答から起こし、レビュー用差分を作って code-reviewer へ。

T2 完了(13/13、バンドルの cwd 非依存確認済み)。T2 レビューと T3 実装を並列 dispatch。

実行中: T1 レビュー、T4 レビュー、T2 レビュー、T3 実装。完了通知待ち。

T4 レビュー承認(仕様 ✅、品質 承認)。残り: T1 レビュー、T2 レビュー、T3 実装。完了通知待ち。

T2 レビュー承認。残り: T1 レビュー、T3 実装。完了通知待ち。

T3 完了。レビュー用差分を作り code-reviewer へ。

T3 レビュー中。T1 レビュー(dispatch 済み・長め)も待機。両方揃えばコミット 1・2。

全タスクのレビュー承認(T1 Minor 1 件は deferred)。コミット 1 → コミット 2 を作成。

コミット 1 `4049e9e`、コミット 2 `7c37f4b`。次は T6(Agent 定義の再生成、オーケストレーター担当)。手順を読む。

T6 手順 1〜4(複製・照合・--check・判定)を実行。

判定: 13 OK、complex-reviewer NG(想定どおり)。手順 5(13 件を `--write`)→ 手順 6(complex-reviewer を手で削除)→ 手順 7(差分確認)。

complex-reviewer の 52〜64 行(見出し + 空行 + 10 項 + 空行)を削除し、手順 7 の差分確認。

他プラグインの hook が混ざった。空の一時ディレクトリを cwd にして再実行(全文表示)。

headless で startup・サブエージェントとも 6 見出しを返した。T7 記録 → T8(並列レビュー)の手順を読む。

T8a・T8b を並列 dispatch(T8a は final-review 役の complex-reviewer、T8b は code-reviewer)。

T8 実行中。並行して T9(最終突き合わせ)の機械的確認: テスト名 8 件、ARCHITECTURE 影響、HEAD での 4 コマンド。

T9 機械確認 OK(HEAD `7c37f4b` で lint/typecheck/test 2616/build 通過、scripts 差分なし、ARCHITECTURE にプラグイン一覧なし → 更新不要)。T8a・T8b の完了待ち。

§9 記入済み。T8b の完了待ち → 修正 1 回 dispatch(discipline.md 一般則 + T8b 指摘)。

T8b: マージ可、指摘なし。修正 1 回 dispatch(discipline.md の一般則復元)。設計書 §8-2 の行数表記(82-85)は自分で直す。

修正 dispatch の完了待ち。完了後: スコープ再レビュー → 修正コミット(discipline.md + 設計書・計画書の記録)→ 作業場削除 → 完了報告。

修正完了(69 行に挿入、3,795 字、13/13)。差分を検証してコミット。

実装完了。main に 4 コミット、作業場は削除済み。

## 成果

| コミット | 内容 |
| --- | --- |
| `4049e9e` | native-japanese 0.1.0-dev 新設(hook・inject.ts・テスト 13 件・discipline.md・README・LICENSE(MIT)・登録) |
| `7c37f4b` | agent-policy 0.20.1-dev: 文書規律撤去(ja/en 断片・orchestration-discipline・compose・vocabulary・テスト・README・Serena メモリ) |
| `351f86c` | 最終レビュー指摘: discipline.md に連体修飾の一般則を復元 |
| `e7c7b76` | 計画書 §9 実施記録・設計書 §8-2 行数修正 |

- `.claude/agents/` 14 定義: 13 件を `--write` 再生成(`--mcp-deny` 明示)、complex-reviewer は tools 差分で手削除。全定義 added=0 / removed=11
- HEAD で lint / typecheck / test 2616 pass / build 通過、scripts 差分なし
- 検証(headless、空ディレクトリ cwd): startup とサブエージェントの両方で 6 見出しを返答
- レビュー: T1〜T4 各承認、最終 T8a(要修正 2 → 解消)、T8b マージ可

## 下した判断(Rulings)

1. 実装者はコミットせず、オーケストレーターが 2 コミットを順に作成 — 並列 dispatch(T1∥T4、T2∥T5、T8a∥T8b)での git 混線防止 — 誤ならコミット境界の手直し
2. main で作業 — リポジトリ規約 + ユーザー明示
3. T5(Serena メモリ)を T4 と並行 — 内容が計画で確定済み — 誤なら edit_memory で戻す
4. `/clear`・`/compact` は headless 不可 → matcher なし登録(全 source 発火)を根拠に、対話確認をユーザーへ委ねる — 誤なら compact 後に規律が落ちる(再起動で回復)
5. ARCHITECTURE 更新不要 — プラグイン一覧なし・既存レイヤー規則内 — 誤なら `/metatron:update` で後追い
6. 指定文言 1 行の修正はスコープ再レビューを省き git diff で確認 — 誤なら次回レビューで拾う

## ユーザーの手で

- 対話セッションで `claude --plugin-dir plugins/native-japanese` → `/clear`・`/compact` 後に見出し 6 つが返るか(計画書 T7 手順 2〜4)
- 設計書 §11: リポジトリ CLAUDE.md の「natural-japanese を最初に使う」指示を残すか
- 本セッションは `--plugin-dir` 未使用のため、native-japanese を常用するなら marketplace から install

## 既知の残り(deferred Minor)

- README 導入章が prefetch と一語違い、ルート README 表のパディング無し(レビュー判定: 残してよい)

# phyllis998

> 訳語の部分を、翻訳調の言い換えに統合できますか？

# AI

可能。形が違うので同じ表には入らないが、同じ節に置ける。

**現状**: §翻訳調の言い換え = 構文の表(型 / Before / After 9 行)。§訳語 = 語の対応 5 項 + 原則 1 行。

**統合案**: §訳語を廃止し、§翻訳調の言い換えを 2 段にする。

1. 導入文に原則を足す: 「英語を直訳せず、日本語の慣用に合わせて意訳する。」
2. 既存の構文の表(そのまま)
3. 語の表を追加:

| 語 | 避ける訳 | 使う訳 |
| --- | --- | --- |
| Version | 版 | 確定版・新しいバージョンなど文脈に合う語 |
| Green / Red(テスト結果) | 緑・赤 | パス・失敗 |
| Frozen Document | 凍結文書 | 確定版の文書 |
| Ledger | (用途を無視した一語) | 一覧・管理表・ログを用途で書き分ける |
| Step | 段 | Step・ステップ |

**追随が要る箇所**: README の節一覧(1 行)、設計書 §6(節 6 を節 4 へ吸収)、計画書 §4 契約の見出し列と T7 期待値(6 → 5 見出し)、付録 A。テストは見出しを検査しないので変更なし。文字数はほぼ同じ。

**バージョン**: 改修に当たるため 0.1.0-dev → 0.1.1-dev(plugin.json / package.json / marketplace 説明は不変)。

進めるか?

統合案(§訳語を §翻訳調の言い換えへ吸収、語の表を追加、0.1.1-dev)の可否待ち。

## セッション 14: 訳語セクションの統合を実装する

# phyllis998

> バージョンは据え置きでお願いします。進めてください

# AI

了承。バージョン据え置きで統合する。

Now edit discipline.md, README, design, plan.

5 節・3,853 字・13/13 pass。コミット。

統合完了・コミット `862c53d`。

- `discipline.md`: §訳語を廃止。§翻訳調の言い換えの導入文に「英語を直訳せず、日本語の慣用に合わせて意訳する。」を追加し、構文の表の後に「語 / 避ける訳 / 使う訳」の表(Version / Green・Red / Frozen Document / Ledger / Step)を置いた。節は 5 つ、3,853 字、テスト 13/13
- README: 節一覧を 5 節に更新
- 設計書 §6・§8-1、計画書 §9 に統合の経緯を追記
- バージョン 0.1.0-dev 据え置き

統合完了(`862c53d`)。追加の指示待ち。
