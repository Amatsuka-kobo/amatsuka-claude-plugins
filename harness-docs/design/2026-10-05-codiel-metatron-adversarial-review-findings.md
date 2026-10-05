# codiel・metatron 敵対的レビュー 所見一覧

2026-10-05 に codiel と metatron を 5 区分に分けて敵対的レビューにかけ、所見 54 件を得た(重複 2 組を除くと 52 件、既知の限界と重なるもの 9 件)。修正の設計は `harness-docs/design/2026-10-05-codiel-metatron-adversarial-fixes-design.md`(以下「修正設計」)にある。

- 行番号は HEAD `52a005c`(コードは `656b4a5` でも同じ)のものである。実装の前に該当箇所を読み直して位置を確かめる。
- ID の接頭辞は区分を表す。M1 = metatron の保護機構、R2 = Raguel ゲート、C3 = codiel run の状態機械とガード、I4 = intent 層、B5 = codiel と metatron の境界。
- 「確認」列の値は次の 4 つである。
  - 実行: レビュアーか修正の設計のセッションが /tmp の使い捨て環境で再現した
  - テスト: 既存テストがその挙動を検証していた
  - 照合: ソースの該当行を読んで裏を取った
  - 未実行: コードまたは指示書を読んだだけ(【要確認】に当たる)
- 「既知」は、設計書に既知の限界・不採用として書かれている内容と重なるものである。重なっても穴としては残る。
- 「採否」は修正設計で決めた扱いである。採用は修正設計のセクション番号を、不採用は理由を書く。
- 3-a の不採用の理由にある「安全網」は、修正設計の第 2 セクションの方針(ガードは AI の誤操作を止め、意図的な回避は防がない)を指す。

## 1. 最優先: コードゲートを痕跡なしで無効にできる

| ID | sev | 既知 | 確認 | 箇所 | 内容 | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| R2-01 | critical | | 実行・照合 | raguel-mcp/src/subject/code.ts:15-26, :278-296; rules/code/patternScan.ts:56 | `FIXED_CONFIG` に `--text` と attributes の上書きが無い。未追跡の `.gitattributes`(`* -diff`)や `.git/info/attributes`、NUL を含むファイルで差分が `Binary files … differ` になり、secrets・destructive-ops・unsafe-exec が働かず PROCEED になる。HEAD が変わらないので pass-gate も通る。guard-write / guard-bash は `.gitattributes` と `.git/info/` を見ていない | 採用(4.1)。diff に `--text` を付ける。`--text` はすべての attributes の源と NUL の判定より優先するので、guard 層で `.gitattributes` と `.git/info/` を守る必要は無くなる |
| R2-02 | medium | | 実行 | rules/code/newDependency.ts(manifestKind) | submodule の参照先の変更は `Subproject commit` の 1 行しか見えず、`.gitmodules` の追加も依存として扱わない。任意のコードを検査なしで取り込める | 採用(4.2) |

## 2. 通常の運用でも起きる穴

敵対的な操作を前提にしない。修正の優先度を高く置く。

| ID | sev | 既知 | 確認 | 箇所 | 内容 | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| M1-01 | high | | 実行・照合 | metatron/src/lib/staging.ts:539-548; cli/commit.ts:112-118; lib/gotchas.ts:943, :1031 | 正本へ `writeFileSync` で直接書き、失敗時に復元しない。ENOSPC の注入で ARCHITECTURE が 8 バイトに切り詰められた。`references/cli-usage.md:40-42` の「非 0 なら 1 バイトも変わらない」に反する。staging は消費済みになり再実行できない | 採用(4.3)。`gotchas.ts:914` の `initGotchasLedger` も含める |
| B5-01 | high | | 実行 | metatron/src/lib/adr-candidates.ts:483-487, :527-595 | ADR 候補の縮約が、最初に読んだ領域ファイル全体を元に書き戻す。書き込み直前の再照合も排他も無く、間に入った候補外の変更を巻き戻す | 採用(4.4)。再照合を足し、ロックは足さない |
| B5-02 | high | | 実行 | metatron/src/lib/adr-candidates.ts:311-318, :361-367, :424, :549-563 | `candidateIdsIn` がコードフェンスを区別しない。ADR 本文のコード例にある `ADR 候補 ID: x` を取り込み済みの証拠とし、未移送の候補全文を縮約で消す | 採用(4.5) |
| R2-05 | medium | | 実行 | raguel-mcp/src/rules/common/secrets.ts:174-176 | 削除行と文脈行の秘密情報でも STOP になる。秘密を取り除く修正や、既存の高エントロピーな固定データの隣の変更で run が止まる | 採用(4.6)。code の diff は追加行だけを判定する。伏せ字は全行に当てたまま |
| I4-01 | high | | 実行 | skills/capturing-intent/SKILL.md:156-160; references/intent-only.md:5-9 | intent-only の退避手順の `git restore`(`--source` 無し)が、直前に `git add` 済みの index を戻すだけになる。base への switch が拒否され、正常な終了が commit-failed になる | 採用(4.7)。2026-10-05 に git 2.43 で再現し、`--source=HEAD --staged --worktree` で switch が通ることを確かめた |
| I4-02 | high | | 照合 | skills/capturing-intent/SKILL.md:52-57, :68, :146; references/carry-over-intent.md:3, :9, :17 | intent-only で base に残した新しい intent を、次の try が先に切り替えた古い run ブランチの本文で上書きする。追加した原文が後続フェーズの入力から消える | 採用(4.8)。C3-05 と同じ変更 |
| I4-12 | medium | | 実行 | skills/capturing-intent/references/uncommitted-changes.md:9 | 「退避する」の `git stash push -- <path>` は未追跡ファイルを含めず、`-u` は禁止されている。未追跡ファイルを退避できない | 採用(4.9)。2026-10-05 に git 2.43 で pathspec のエラーを再現した |
| C3-11 | medium | | 照合 | src/codiel-state.ts:275-298, :315-354; src/hooks/stop-guard.ts:5-8, :25 | 無関係な過去 run の state が 1 つ壊れているだけで `findActiveRun` が例外になり、全ガードが内部エラーの ask になる | 採用(4.10)。stop-guard は try/catch を持たず ask にならない(未処理の例外で終わる)点も直す |
| I4-10 | medium | | 実行 | src/check-intent-env.ts:43-48, :253-254 | `metatronRules` が `isDirectory` だけを見る。読めない rules ディレクトリで true になり、knowledgeTarget を metatron に誤判定する。設計書 2026-10-05-codiel-run-structure-followups-design.md:155 は false と定める | 採用(4.11) |

## 3. 意図すれば抜けられる穴

### 3-a. ガードがツール名や文字列の一致に頼っている

| ID | sev | 既知 | 確認 | 箇所 | 内容 | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| C3-01 | high | | テスト・照合 | src/hooks/guard-github-mcp.ts:20-38 | GitHub MCP の guard は active run と本文のマーカーしか見ない。Bash の `gh` 経由と違い、phase・test-loop の合格を検査しないので、init 直後でも PR と Issue を作れる。guard-github-mcp.test.ts:63-89 がこの許可を検証している | 採用(4.12.1) |
| C3-06 | high | | 照合 | src/hooks/guard-bash.ts:49-72, :80-115 | git の解析が空白分割で引用符を外さない。force の判定は完全一致。`git "push"`、`git push origin "main"`、`-vf`、`+refspec` で push の禁止を抜ける | 採用(4.12.2)。保護ブランチへの `+refspec` は既に拒否される(先頭の `+` を外して照合する)。抜けるのは非保護ブランチへの `+` の force で、これも force に数える |
| C3-02 | high | | 照合 | src/hooks/guard-bash.ts:698-770, :895-917; src/hooks/guard-write.ts:237-244, :291, :487 | `state.json` の保護が `rm`、`cd` 後の相対パス、symlink の別名を見逃す。state を消すと run が見つからず、全フェーズ制限が外れる | 採用(4.12.3)。4 章の C3-15 の誤検知も同じ変更で消える |
| C3-07 | medium | | 照合 | hooks/hooks.json:6; src/hooks/guard-github-mcp.ts:13-21 | 名前に github を含まない MCP サーバーには guard が発火しない | 不採用。安全網の範囲外とする。サーバー名で絞るのは、別サービスの MCP の同名ツールに掛けないためで、全 MCP に掛けると誤検知になる。README に保証範囲を書く(4.12.5) |
| M1-04 | high | | 実行 | metatron/src/guard-docs.ts:45-54, :77-85, :235-239 | 親ディレクトリが未作成の正本への symlink 経由の Write を見逃す。`alias/../ARCHITECTURE.md` のように `..` と symlink を組み合わせた入力も、`path.resolve` が先に `..` を畳むので素通しする | 採用(4.12.4) |
| B5-03 | high | 既知の組み合わせ | 実行 | metatron/src/guard-docs.ts:214-249; src/hooks/guard-write.ts:459-484; src/hooks/guard-bash.ts:773-820 | `metatron.config.json` を Bash で書き換え、正本のパスを存在しない先へ向けると、metatron の正本保護と codiel のドメイン境界が同時に外れる。設定ファイルを hook 対象外にすること、マップ不読時に素通しすることは個別には既知(2026-08-24-metatron-rules-expansion-design.md:678、2026-09-15-codiel-domain-map-decoupling-design.md:779)だが、組み合わせは書かれていない | 不採用。Bash で設定を書き換える経路は意図的な回避で、安全網の範囲外とする。metatron の hook で Bash を捕捉しない判断(M1-07)と設定を対象外にする判断を覆さない。組み合わせの経路は README の保証範囲に書く(4.12.5) |
| M1-05 | medium | | 実行 | metatron/src/lib/config.ts:190-204; lib/staging.ts:209-213, :497-503; inject-context.ts:194-214 | ルート内の判定が字句的で、symlink の実体がルート外でも CLI の更新と SessionStart への注入が通る。README.md:115 と config-schema.md:77-82 で保証範囲の書き方が分かれる | 文書だけ採用(2)。README を `config-schema.md` に合わせて「字句で判定し、symlink の実体は見ない」と書く。コードと `config-schema.md` は変えない(変えると 2 実装の追随が要る) |
| C3-14 | medium | 既知 | テスト | src/hooks/guard-bash.ts:324-345 | heredoc 内の `gh` 投稿はフェーズ制限も本文検査も抜ける(2026-09-27-codiel-intent-driven-design.md:1283-1288) | 不採用(既知)。出典の設計書の判断を覆さない |
| M1-07 | low | 既知 | 照合 | metatron/hooks/hooks.json:26-34 | Bash と MCP の編集ツールは matcher の対象外(2026-08-16-metatron-design.md:1224-1230) | 不採用(既知)。出典の設計書の判断を覆さない |
| M1-08 | low | 既知 | 実行 | metatron/src/guard-docs.ts:199-254 | hook の例外時は編集を通す(README.md:89) | 不採用(既知)。出典の判断を覆さない |
| R2-10 | low | 既知 | 照合 | raguel-mcp/src/rules/params.ts:46-50 | `.codiel/config.json` の差分は Raguel が見ない。guard-write の拒否で守る(raguel-redesign-design.md:1274) | 不採用(既知)。出典の設計書の判断を覆さない |

### 3-b. STOP と裁定の記録が、実際の状態とずれる

| ID | sev | 既知 | 確認 | 箇所 | 内容 | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| C3-03 | high | | 照合 | src/raguel-records.ts:464-499; src/codiel-state.ts:1153-1172, :1233-1240 | `resubmittedIds` は note の文型だけを照合する。`complete-phase --note` に `STOP(evaluationId: X)の後の再提出で通した` と書けば、その STOP は次の init で未解決に数えられない。書いたフェーズ・通過評価・HEAD を照合しない | 採用(4.13) |
| C3-04 | high | | 照合 | src/codiel-state.ts:1071-1083, :1120-1135; src/raguel-records.ts:401-414 | STOP 固有の検査は state の `ph.verdict === "STOP"` のときだけ動く。STOP が返ってから `mark-ask` までの間に中断し、再評価で PROCEED を得ると、人の裁定なしに pass-gate を通る | 採用(4.13) |
| C3-08 | medium | | 照合 | src/codiel-state.ts:1129-1135 | 「HEAD が進んだ」を SHA の不一致だけで判定する。内容を変えない amend、reset、別ブランチへの switch で満たせる | 採用(4.13) |
| C3-10 | medium | | 照合 | src/codiel-state.ts:1339-1353 | `record-attempt` が run の状態を見ずに上限超過で awaiting_human にする。stop や completed の run を `resume` で復活させられる | 採用(4.14) |
| R2-03 | medium | | 実行 | raguel-mcp/src/rules/common/resubmissionLoop.ts:30-37; casefile/store.ts:415 | revise も裁定に数えるので、raguel-gating/SKILL.md:131 の手順を踏むと前の attempt が比較から外れる。SKILL.md:85, :136 が当てにする resubmission-loop の検知が、通常の ASK の流れで一度も働かない | 採用(4.15) |
| R2-04 | medium | | 実行 | raguel-mcp/src/core/pipeline.ts:378-383, :829; casefile/store.ts:398-404 | 前回側の askRuleIds は Jev の調整後、今回側は調整前から取る。Jev が info から ask へ上げたルールは「消えた」とみなされ、Jev が効かない再評価では同じ本文が PROCEED になる | 採用(4.15) |
| C3-12 | medium | 既知 | 未実行 | src/codiel-state.ts:293-298 | ロックが無く、全プロセスが同じ `state.json.tmp` を使う(orchestrating-runs/SKILL.md:323) | 不採用(既知)。出典の判断を覆さない |
| C3-13 | medium | 既知 | 未実行 | src/hooks/guard-write.ts:30-42, :355-379 | carry-over の修正でテストと仕様を書き換えられる(2026-10-05-codiel-run-structure-followups-design.md:252) | 不採用(既知)。出典の設計書の判断を覆さない |

### 3-c. 書式の検証が部分だけで、完成した文書を見ていない

| ID | sev | 既知 | 確認 | 箇所 | 内容 | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| M1-02 | high | | 実行 | metatron/src/lib/architecture.ts:750-849, :918-925, :952-978 | `stage-architecture` の body を文字列としか検査せず、差し込んだ後の完成文書を検証しない。body から `## ADR 一覧`・ADR・不正なドメインマップ・閉じていないフェンスを保存でき、閉じていないフェンスの後は CLI 自身が正本を更新できなくなる | 採用(4.16) |
| M1-03 | high | | 実行 | metatron/src/lib/adr.ts:489-524, :603-641, :716-749 | `stage-adr` の散文のフィールドに改行と `### ADR-001:` を入れると、同じ ID の ADR と値域外の状態を保存できる | 採用(4.16) |
| M1-06 | medium | | 実行 | metatron/src/lib/gotchas.ts:178-187, :474-479, :565-578 | `append-gotcha` の title を `[解決済み] …` にすると、理由行なしで解決済みのタグが付き、`--exclude-tagged` から落ちる | 採用(4.16) |
| I4-09 | medium | | 実行 | src/check-intent-env.ts:176-192, :282-295 | テンプレート用の `parseTopLevel` を intent に流用し、契約では解釈しないリストの値を項目値として読む。閉じ区切りの行末も検査しない | 採用(4.17) |
| B5-06 | low | | 実行 | src/codiel-state.ts:1447-1455 | 候補連番が 2^53 を超えると `next-adr-candidate-id` が既存の ID を返す | 不採用。low で、2^53 件の候補は運用で起きない |

### 3-d. 候補の移送で、同一性を正しく判定していない

| ID | sev | 既知 | 確認 | 箇所 | 内容 | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| I4-04 / B5-04 | high | | B5 は削除と状態遷移まで実行、I4 は照合 | skills/orchestrating-runs/references/gotcha-candidates.md:28, :40-44, :53-55 | incident を写したかを、写し先 slug の最新 try の status だけで判定する。後続の try によって、写した候補が run ブランチに取り残される経路と、metatron が削除した候補を作り直す経路が両方起きる | 採用(4.18) |
| I4-07 / B5-05 | medium | | 照合 | gotcha-candidates.md:23, :53; adr-candidates.md:18 | GOTCHAS 候補と ADR 候補を見出しだけで同一とみなし、別の失敗や変更後の判断を写し済みにする。metatron 側(recording-gotchas/SKILL.md:109-111)は同じタイトルでも別の失敗かを確かめるが、その前に codiel が捨てる | 採用(4.18) |
| I4-03 | high | | 照合 | skills/capturing-intent/SKILL.md:116; orchestrating-runs/references/adr-candidates.md:5-11; syncing-intents/references/persistent-layer.md:9-18 | 「合意済み事項」の表、design.md の設計判断、carry-over の修正判断が ADR 候補の抽出対象に無い。intent-format.md:306-317 の「3 条件を満たす判断は手元に書き、intents では持続層へ写す」に反する | 採用(4.19) |
| I4-06 | medium | | 照合 | orchestrating-runs/references/phase-carry-over.md:8-17 | carry-over の妥当な STOP を修正して続行する経路に、GOTCHAS 候補を書く手順が無い | 採用(4.20) |
| I4-11 | medium | | 照合 | intent-format.md:314-316; syncing-intents/references/persistent-layer.md:23-26; adr-candidates.md:47 | knowledgeTarget が metatron のとき、書式の正本は「関連 ADR に番号だけを書く」、手順は「関連 ADR の行も作らない」と逆を指示する | 採用(4.21)。手順に合わせて書式の記述を直す |
| I4-13 | low | 既知 | 未実行 | adr-candidates.md:49; gotcha-candidates.md:36 | 旧 `-try-<n>` ブランチへ写した候補は新しいブランチに回収されない(2026-10-05-codiel-run-structure-followups-design.md:107, :250) | 不採用(既知)。出典の設計書の判断を覆さない |

### 3-e. その他

| ID | sev | 既知 | 確認 | 箇所 | 内容 | 採否 |
| --- | --- | --- | --- | --- | --- | --- |
| I4-05 | high | | 照合(経路のみ) | intent-format.md:46, :95-101, :133, :225-233; reviewing-diffs/SKILL.md:32-34; phase-finalize.md:5-12 | 外部 Issue の本文にある AI への命令文が、要約されない原文として後続フェーズへ届く。原文の権威を製品の要望に限る境界の規律が無い。モデルが実際に従うかは確かめていない | 採用(4.22)。境界の規律を足すまでとし、モデルの挙動は確かめない |
| C3-05 | high | | 照合 | skills/capturing-intent/SKILL.md:162; src/codiel-state.ts:908-932; orchestrating-runs/references/delegation-env.md:9-12 | 既存の `codiel/<slug>` ブランチを所有や由来を見ずに再利用し、try-1 なら carry-over を SKIPPED にする。slug `demo-try-1-step-1` の run と slug demo の worktree のブランチ名が衝突する。I4-02 と根が同じ | 採用(4.8) |
| C3-09 | medium | | 照合 | src/codiel-state.ts:340-354, :853-860; src/hooks/guard-write.ts:284; src/hooks/stop-guard.ts:10-14 | init は同じ slug の未完了 try しか検査しない。複数の active run があると、`updatedAt` が最新の run だけが選ばれ、他の run のガードが外れる | 採用(4.23) |
| R2-06 | medium | | 実行 | raguel-mcp/src/tools/shared.ts:24; casefile/store.ts:78-83, :510-516 | runId に `.` を通す。保持期間の掃除で `<projectDir>/.` を消し、プロジェクトの全記録が消える。codiel は `<slug>-try-<n>` しか渡さないので通常は起きない | 採用(4.24)。正規表現は変えない |
| I4-08 | medium | | 正規化のみ実行 | capturing-intent/references/domain-names.md:5-8; syncing-intents/references/persistent-layer.md:7-8 | 領域名の正規化で `API` と `api`、`user/auth` と `user_auth` が衝突し、`認証` だけの名前は空文字になる | 採用(4.25) |
| R2-07 | low | | 実行 | raguel-mcp/src/rules/code/destructiveOps.ts:82-118 | 行を分けた、またはコメントを挟んだ `DROP TABLE` と `DELETE FROM` を取りこぼす | 不採用。low で、今回の範囲(1・2 章、3-b〜3-d、3-e の high と安価な medium)の外 |
| R2-08 | low | | 実行 | raguel-mcp/src/rules/code/testDeletion.ts:14-15; patternScan.ts:19-28 | `it.only(`、`test.skip.each(`、`describe.skipIf(true)(`、`.test.ts` から `.test.ts.bak` への名前変更を拾わない | 不採用。low で、今回の範囲の外 |
| R2-09 | low | 既知 | 実行 | raguel-mcp/src/rules/code/newDependency.ts:150-156 | 見出しが hunk の外にあるとき、GitHub 省略形と `git://` の依存を拾わない(同ファイルの `ponytail:` コメント) | 不採用(既知)。同ファイルの `ponytail:` コメントの判断を覆さない |
| B5-07 | low | | 照合 | metatron/references/architecture-format.md:78-84 | 読み手の表に、ADR-003 より前の codiel の起動条件(マップが読めなければ開始しない)が残る | 不採用。low で、今回の範囲の外 |

## 4. 環境と運用

- R2-11: このセッションに登録された `mcp__plugin_codiel_raguel__evaluate_code` は旧入力(`diff` / `files`)のスキーマで、worktree の `tools/evaluateCode.ts`(`baseRef` が必須)と異なる。インストール済みのプラグインが古いと推定する。修正の対象外(環境の問題)。
- C3-15: active run が無い状態(`get --active` が `runs: []`)でも、`state.json` 宛ての文字列を含む /tmp のテストデータを Bash の hook が「禁止コマンド: state.json へのシェル経由の書き込み」で拒否した。codiel の guard-bash の誤検知と推定する。区分 2 のレビュアーも、/tmp の `rm -rf` と `curl … | sh` を含む printf を拒否されている。`state.json` の分は C3-02 の変更(修正設計 4.12.3)で消える。
- `adversarial-reviewer`(GPT)は、攻撃寄りの語を含む依頼文を OpenAI 側がサイバーセキュリティ上のリスクとして拒否する(HTTP 400)。「文書が述べる保証とコードの食い違いを探す」と言い換えると通った。
- 再現スクリプトは /tmp にあり、再起動で消える: `/tmp/rg-run.ts`、`/tmp/rg-runid.ts`、`/tmp/rg-*`、`/tmp/b5-review-probe.mts`、`/tmp/b5-transfer-probe.mts`、`/tmp/metatron-review*`。

## 5. 根が同じ組

修正設計で、次の組を 1 つの変更で扱った。

- I4-04 と B5-04、I4-07 と B5-05: 2 人のレビュアーが独立に同じ穴を報告した。同じファイルの判定規則なので 1 コミットにまとめる(4.18)。
- C3-05 と I4-02: capturing-intent が既存の run ブランチを所有を見ずに再利用し、先に切り替える(4.8)。
- C3-03、C3-04、C3-08: STOP の再提出の判定が、note の文型・state の verdict・SHA の不一致だけに頼る(4.13)。
- R2-03 と R2-04: resubmission-loop の比較対象の選び方(4.15)。
- M1-02、M1-03、M1-06: CLI が入力の部分だけを検証し、組み上げた後の文書を検証しない(4.16)。
- R2-01 と 3-a 全体: ガードが特定のツール名・文字列・パスの一致に頼り、同じ効果の別経路を見ない。R2-01 は単独で先に直し(4.1)、3-a は安全網の方針で AI が通常書く形だけを hook ごとに塞ぐ(4.12)。
