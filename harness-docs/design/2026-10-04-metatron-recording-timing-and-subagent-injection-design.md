# metatron の記録のタイミング・GOTCHAS 候補の取り込み・サブエージェントへの注入 設計書

- 日付: 2026-10-04
- 引き継ぎ書: `harness-docs/handover/2026-10-03-metatron-recording-timing-and-subagent-injection-handover.md`
- 対象: `plugins/metatron`、`plugins/codiel` の書式の契約(`references/intent-format.md`・`docs/format-change-checklist.md`)
- バージョン: 上げない。metatron は未リリースの `0.4.0-dev` に含める(ユーザー指示)。codiel は指示層を変えず、契約の文書だけを直す

## 決定の一覧

引き継ぎ書の未決 4 件は、2026-10-03〜04 にユーザーが次のとおり決めた。

| 未決 | 決定 |
| --- | --- |
| 作業の完了の検出 | hook で検出しない。SessionStart の注入文に、作業を終えたら記録の要否を確かめるよう書く |
| 毎ターンの抑止 | Stop hook を置かないので要らない |
| SubagentStart で注入できるか | できる(Context7 で確認)。すべてのサブエージェントに注入する。除外の設定キーは足さない |
| 移したエントリの持続層での扱い | 台帳へ移した候補も、移さないと決めた候補も、持続層から消す |

SubagentStart の仕様は Context7(`/websites/code_claude` の hooks)で次を確かめた。

- 入力は共通のフィールド(`session_id`・`transcript_path`・`cwd`・`hook_event_name`)と `agent_id`・`agent_type` である。
- 出力の `hookSpecificOutput.additionalContext` は、サブエージェントの最初のプロンプトの前にコンテキストへ足される。
- ブロックはできない。
- 同じサブエージェントで再び発火しても、既に注入した写しがあれば Claude Code が重ねない。metatron は重複を防ぐ仕組みを持たない。

## 1. 記録のタイミングは SessionStart の注入文に書く

`src/inject-context.ts` の `buildGuide` に、記録のタイミングの行を足す。hook は足さない。

- 足す位置は、CLI 案内(`cliLines`)の後とする。縮退で削らない部分に入れ、どの縮退段階でも残す。
- `cliLines` には入れない。`cliLines` は文書が無いときの `buildInitGuide` と共有しており、文書が無いうちは記録先が無い。
- 載せる内容は次の 4 点とし、合計 200 文字以内に収める(文言は実装時に決める)。
  - 依頼された作業を終えて完了を報告する前に、そのセッションで下した判断と踏んだ失敗に、ADR か GOTCHAS に残すものが無いか確かめる。
  - 残すものがあれば、ADR は `updating-architecture`、GOTCHAS は `recording-gotchas` で記録する。承認の手順は各スキルに従う。
  - codiel の run の結果レポートや完了報告に候補の一覧が出たときは、run の中では確かめず、次のターンの初めに確かめる。
  - 持続層(`docs/intents/domains/*.md`)の候補は `/metatron:update` で取り込める。

codiel の finalize は「結果レポートを出したら終了し、ほかの作業をしない」と定めている(`plugins/codiel/skills/orchestrating-runs/references/phase-finalize.md:28-31`)。そのため run の候補は、run の外の次のターンで確かめる。次のターンが来ないまま終わると確かめないが、候補は run の手元の記録に残る。codiel の指示層は変えない。

## 2. 持続層の GOTCHAS 候補を台帳へ移し、エントリを消す

ADR-007 の ADR 候補の取り込み(`scan-adr-candidates` → 承認 → ADR へ追加 → `shrink-adr-candidate`)と同じ形にする。違いは、縮約の代わりにエントリを消すことと、候補 ID が無いことである。

### 2-1. CLI のサブコマンド

`src/lib/gotcha-candidates.ts` と `src/cli/gotcha-candidate.ts` を新設し、サブコマンドを 2 つ足す。`src/cli/main.ts` の名前一覧と switch、`src/cli/paths.ts` の USAGE に登録する。

**`scan-gotcha-candidates`**(読み取り)

- 走査の範囲・repoRoot の求め方・コードフェンスの除外は `scan-adr-candidates` と同じにする。`DOMAINS_DIR_RELATIVE` と `findRepoRoot` は `lib/adr-candidates.ts` から import する(同じプラグイン内なので層の規則に触れない)。
- 見出し末尾の印 `[GOTCHAS 候補]` を持つ `###` 見出しを候補とする。範囲は次の `###` か `##` の直前までとする。親の `##` 見出しは問わない。
- 出力は `{command, ok:true, repoRoot, candidates[], warnings[]}` とする。失敗時と git の外での振る舞いは `scan-adr-candidates` に揃える。
- 各候補は次のフィールドを持つ。

| フィールド | 内容 |
| --- | --- |
| `file` / `relative` | 領域ファイルの絶対パスと repoRoot からの相対パス |
| `heading` | 見出し行の原文 |
| `title` | 見出しから印を除き、前後の空白を落とした文字列 |
| `fields` | `date`・`run`・`task`・`mistake`・`cause`・`countermeasure`・`promotionCandidate` の値。前後の空白を落とす |
| `problems` | 値が無いキーと、`promotionCandidate` が `Yes`/`No` 以外であることを表す文字列の配列 |
| `hash` | エントリの範囲のバイト列の sha256(`hashContent`) |
| `fileHash` | 領域ファイル全体のバイト列の sha256 |
| `ledgerMatches` | 台帳のエントリのうち、`title` が候補の `title` と一致するものの ID の配列。台帳が無ければ空 |

- 値の行は `- <キー>: <値>` の形で読む。キーの行が無いときと、値が空のときは、`fields` の値を `null` にして `problems` に載せる。
- `- 写し先:` など未知のキーの行は無視する。
- `ledgerMatches` は二重移行を防ぐ手がかりである。前回、台帳へ移した後の削除に失敗した候補は、ここに ID が出る。タイトルの一致だけでは同じ失敗とは限らないので、判断は 2-2 の手順で人が行う。

**`remove-gotcha-candidate --file <path> --hash <hash> --file-hash <fileHash>`**(書き込み)

- `--file` は `docs/intents/domains/` 配下の `.md` に限る。範囲外は `outside_domains_dir` で拒否する。
- ファイルを読み、全体のハッシュが `--file-hash` と違えば `file_changed` で拒否する。走査の後に誰かが書き換えたことを表すので、走査からやり直させる。
- `hash` が一致するエントリを探す。無ければ `candidate_not_found` で拒否する。同じハッシュのエントリが複数あれば先頭の 1 件を消す(バイト列が同じなので、どれを消しても結果は同じ)。
- エントリの範囲だけを消し、範囲の外はバイト列のまま残す。
- 消した後、親の見出しが `## GOTCHAS 候補` で、その配下に空白だけの行しか残らなければ、`## GOTCHAS 候補` の見出し行から次の `##` 見出しの直前(無ければファイル末尾)までを消す。親が別の見出しのときは、エントリの範囲だけを消す。
- 書き込みの直前にファイルを読み直し、全体のハッシュが `--file-hash` と違えば `file_changed` で拒否する。そのうえで一時ファイルに書き、rename する。
- 成功時の出力は `{command, ok:true, written:true, file, title, warnings}` とする。
- 拒否と失敗はすべて終了コード 3(`EXIT_SHRINK_PENDING`)にし、`{ok:false, error, message, written:false, removePending:{file, hash}}` を返す。オプションの欠落だけは終了コード 2 とする。
- エラーコードは `not_git_repository`・`outside_domains_dir`・`file_not_found`・`file_changed`・`candidate_not_found`・`write_failed` とする。

読み直しから rename までの間に別のプロセスが書くと、その変更は失われる。領域ファイルを書くのは codiel の run(intent-sync と finalize)と metatron の取り込みだけで、どちらも人が起動する。この隙間は排他で埋めず、運用で同時に動かさない前提に置く(`shrink-adr-candidate` と同じ前提)。

### 2-2. 台帳へ移す手順

手順は `skills/recording-gotchas/SKILL.md` に「持続層の GOTCHAS 候補の取り込み」として足す。

`updating-architecture`(`/metatron:update`)と `capturing-architecture`(`/metatron:init`)は、ADR 候補の取り込みの後に `scan-gotcha-candidates` を実行する。1 件以上あれば recording-gotchas のこの手順に従う。

- `capturing-architecture` では、ADR 候補が 0 件のとき・却下されたとき・失敗したときのどれからも、GOTCHAS 候補の走査へ進むように手順の番号と行き先を直す。
- `capturing-architecture` の完了報告で台帳を「空」と報告するのは、GOTCHAS 候補を移さなかったときに限る。移したときは件数と、付けたタグと、削除の保留を報告する。

取り込みの手順は次のとおりである。

1. 候補を 1 件ずつ、`title`・`fields`・`problems`・`ledgerMatches` を添えて提示する。
2. `ledgerMatches` が空の候補は、次の 4 つから選ばせる。
   - 台帳へ移す。
   - 台帳へ移してから `tag-gotcha` で `[解決済み]` か `[対象外]` を付ける(理由はユーザーに聞く)。
   - 移さずに持続層から消す(陳腐化した候補)。
   - 何もせず持続層に残す。
3. `ledgerMatches` が空でない候補は、一致した台帳のエントリ(`get gotchas --query`)と、候補の `mistake`・`countermeasure`・`run` を並べて提示する。
   - 同じ失敗なら「移し済みとして持続層から消す」を勧め、要ればタグも付ける。台帳には追記しない。
   - 別の失敗なら、2 の 4 つから選ばせる。
4. 台帳へ移すときは、`append-gotcha` の入力を次のとおり組み立てる。
   - `title`・`date`・`mistake`・`cause`・`countermeasure`・`promotionCandidate` は候補の値をそのまま使う。
   - `task` は、候補の `task` の末尾に `(codiel run <run の値>)` を足す。
   - `problems` が空でない候補は、欠けた値をユーザーと決めてから組み立てる。
   - 記録の判断(`references/gotchas-format.md` の記録の判断)は、移すと選ばれた時点で済んだものとして扱う。
5. 持続層から消すのは、台帳への書き込み(`append-gotcha`、タグを付けるときは `tag-gotcha` も)がすべて成功した後とする。
6. `remove-gotcha-candidate` には、走査の結果の `hash` と `fileHash` を渡す。`file_changed` なら走査からやり直す。それ以外の終了コード 3 なら 1 回だけやり直し、それも失敗したらユーザーに報告する。台帳へは移っているので、次の走査で `ledgerMatches` に ID が出て、3 で消すだけを選べる。
7. `append-gotcha` が失敗したときは持続層に触れない。`tag-gotcha` だけが失敗したときは、台帳のエントリの ID を伝え、タグを付け直してから消す。

持続層の変更はコミットしない。コミットは利用者の作業の単位に任せる(ADR 候補の縮約と同じ)。

### 2-3. 書式の契約の追随

候補の書式の正本は codiel の `references/intent-format.md` の「GOTCHAS 候補」にある。次を追随させる。

- `plugins/codiel/references/intent-format.md` の「GOTCHAS 候補」に、metatron が台帳へ移した候補と、移さないと決めた候補をエントリごと消すことを書く。`## GOTCHAS 候補` が空になれば見出しも消えることを書く。codiel の指示層(`gotcha-candidates.md` など)は変えない。
- `plugins/metatron/references/gotchas-format.md` に「GOTCHAS 候補の取り込み」の見出しを足し、走査と削除に要る最小限(印・範囲・キー・削除の範囲)だけを写す。正本が codiel にあることを書く。
- `plugins/metatron/docs/format-change-checklist.md` に「GOTCHAS 候補の取り込み」の項目を足す(追随先は `intent-format.md` の「GOTCHAS 候補」)。
- `plugins/codiel/docs/format-change-checklist.md` の「持続層と ADR 候補の書式」に、`[GOTCHAS 候補]` の書式を metatron の `gotchas-format.md` の写しに揃える項目を足す。
- `plugins/metatron/references/cli-usage.md` のサブコマンド一覧に 2 つを足し、`### remove-gotcha-candidate` を足す。

codiel の手元の記録は、写したかどうかを `- 写し先:` の行で管理する(`plugins/codiel/skills/orchestrating-runs/references/gotcha-candidates.md`)。写した候補は再び写さないので、metatron が持続層から消しても codiel は書き戻さない。

### 2-4. 次の codiel の改修との関係

次の codiel の改修で、GOTCHAS 候補の書き先は ADR 候補と同じ持続層の領域ファイルに揃う(ユーザー決定、2026-10-04)。書き先は今と同じく `knowledgeTarget` が `intents` の run に限る。書式の契約(`intent-format.md` の「GOTCHAS 候補」)の変更は、その改修で行う。

- 走査は親の `##` 見出しを問わないので、置き場所のセクションが変わっても読める。
- 削除は、親が `## GOTCHAS 候補` のときだけ空の見出しを消す。親が別のセクションのときは、エントリの範囲だけを消す。
- 2-3 の追随は、この改修の時点の契約(`## GOTCHAS 候補` に置く形)に対して行う。次の codiel の改修で契約を変えるときは、`plugins/metatron/references/gotchas-format.md` の写しと metatron の実装を追随させる。この項目を codiel の引き継ぎ書(`harness-docs/handover/2026-10-03-codiel-run-structure-followups-handover.md`)に足す。
- `knowledgeTarget` が `metatron` の run の候補は、run の手元の記録と結果レポートの一覧にだけ残り、持続層の走査には出ない。1 の注入文で、結果レポートの候補を次のターンで確かめさせるのはこのためである。

## 3. SubagentStart でサブエージェントへ注入する

### 3-1. 実装の形

新しいスクリプトは作らず、`inject-context.ts` が入力の `hook_event_name` で振る舞いを分ける。

- `hooks/hooks.json` に `SubagentStart` を足し、matcher を付けずに `node "${CLAUDE_PLUGIN_ROOT}/scripts/inject-context.mjs"`(timeout 10)を登録する。
- 入口(`readHookInput` の後)で `hook_event_name` を読み、`SubagentStart` ならサブエージェント向けの出力を組み立てる。それ以外(無い・読めないときを含む)は従来の SessionStart の出力を組み立てる。入力の型(`SessionStartInput`)は両方のイベントを表す名前に改める。
- `lib/emit.ts` の `injectContext` に、イベント名の引数(`"SessionStart" | "SubagentStart"`)を足す。出力の `hookEventName` は入力のイベント名に揃える。
- フェイルオープンと `injection.enabled: false` の扱いは SessionStart と同じにする。

### 3-2. サブエージェント向けの出力

- 載せるのは、ARCHITECTURE の本文、ADR の一覧(タイトルと状態)、GOTCHAS の目次と直近の全文である。
- CLI の案内と、記録のタイミングの行は載せない。
- 先頭は見出し `# metatron: プロジェクトの前提と落とし穴` と、これらの文書を直接編集せずに読むだけにする旨の 1 行とする。
- 直近の全文の件数・縮退の段階・`maxChars` は SessionStart と同じ設定(`injection.gotchasRecentCount`・`injection.maxChars`)を使う。新しい設定キーは足さない。
- SessionStart の出力にある `node M ...` の案内は、サブエージェント向けでは文書のパスを Read する案内に置き換える。
  - ADR の全文: `<architecturePath> の ## ADR 一覧 を Read する`(見出し名は `lib/architecture.ts` の `ADR_HEADING` から組み立てる)
  - 目次から外れた GOTCHAS・一覧の割愛: `<gotchasPath> を Read する`
- 文書が 1 つも無いときは何も出力しない(`/metatron:init` の案内はサブエージェントに要らない)。
- 設定の警告(`※注意:`)は SessionStart と同じく載せる。

### 3-3. 縮退の不変条件

`inject-context.ts` の冒頭のコメントにある不変条件を、イベントごとに次のとおり当てる。コメントにもこの違いを書く。

| 不変条件 | SessionStart | SubagentStart |
| --- | --- | --- |
| 0. 文書が無くても案内を出す | 当てる | 当てない(何も出さない) |
| 1. 削れない部分を先頭に置き、縮退で削らない | CLI 案内・記録のタイミング・委譲の依頼文への注意 | 見出しと「読むだけにする」の 1 行 |
| 2. `maxChars` 以下を目標にする | 当てる。削れない部分が `maxChars` を超えるときは、削れない部分を優先する | 同じ |
| 3. セクションの分解は lib のパーサを使う | 当てる | 当てる |

プラットフォームの上限(10,000 文字)は、どちらでも常に守る。

## 4. 委譲の依頼文に ARCHITECTURE と GOTCHAS の原文を転記させない

`cliLines` の最後の行(「※この案内はメインセッション向け。サブエージェントには別途パスが渡される。」)を消し、`buildGuide` の記録のタイミングの近くに次の内容を足す。`buildInitGuide` には足さない。

- サブエージェントには SubagentStart hook が ARCHITECTURE と GOTCHAS を注入する。
- 委譲の依頼文には、両文書の原文も要約も転記しない。

この変更は 3 と同じコミットに入れる。SubagentStart を登録する前に、注入を前提にした案内を出さないためである。

## 5. 文書の追随

- `plugins/metatron/README.md`: 概要と「注入と規律」に、サブエージェントへも注入することを書く。「## 2 つの hook」の表に SubagentStart の行を足し、見出しを実態に合わせる。CLI の一覧に 2 つのサブコマンドを足す。
- `plugins/metatron/docs/rationale.md`: 88〜89 行目(サブエージェントには継承の保証が無いので依頼文にパスを埋める)を、SubagentStart で注入する理由に書き換える。記録のタイミングを hook でなく注入文に置いた理由と、不採用案(下の「不採用案」)を足す。移した GOTCHAS 候補を参照形に縮めず消す理由(失敗の全文を台帳の 1 か所だけに残し、領域ファイルに失敗の索引をためない)も足す。
- `plugins/metatron/references/config-schema.md`: `injection.enabled`・`gotchasRecentCount`・`maxChars` の説明を、SessionStart と SubagentStart の両方に当たる書き方にする。キー・値域・既定値は変えない。説明の変更だけなので codiel の独立実装は変わらないが、規約どおり 2 者比較テストを通す。
- `harness-docs/design/2026-08-16-file-contract-freeze.md`: §12(CLI の入出力規約)に 2 つのサブコマンドを、§13(hook 出力の形式)に SubagentStart の出力を足す。
- ルートの `README.md`: metatron の説明に変更があれば合わせる。
- `.serena/memories/metatron/core.md`: 「2 つの hook」の記述を、SubagentStart を含む形に `edit_memory` で直す。ほかのメモリも、hook と注入と CLI の一覧に触れていれば合わせる。

## 6. ADR

ADR は足さない(ユーザー決定、2026-10-04)。SubagentStart で注入する理由、記録のタイミングを注入文に置いた理由、移した GOTCHAS 候補を消す理由は、5 の `docs/rationale.md` に書く。

## 7. テスト

テスト方針(`.claude/rules/metatron/testing-policy.md`)に従い、vitest で書く。

- `src/__test__/inject-context.test.ts`
  - SessionStart: 記録のタイミングと 4 の行が案内に入る(I13 の全文一致を更新する)。縮退の最終段階でも残る。`buildInitGuide` には入らない。
  - 予算: I8 の `BUDGETS` は、削れない部分の長さ以上の予算だけで「上限以下」を確かめる形に直す。削れない部分より小さい予算では、削れない部分だけが出ることを確かめる(I12 と同じ扱い)。
  - SubagentStart: `hookEventName` が `SubagentStart` になる。CLI の案内・`node M`・記録のタイミングが出ない。ARCHITECTURE・ADR 一覧・GOTCHAS の目次と直近が出る。Read の案内に文書の絶対パスと `## ADR 一覧` が出る。文書が無いと何も出ない。`injection.enabled: false` で何も出ない。`maxChars` を超えるときに縮退する。削れない部分より小さい予算でも削れない部分が残る。
  - `hook_event_name` が無い入力は SessionStart として扱う。
- `src/lib/__test__/gotcha-candidates.test.ts`(新設)
  - 走査: 印・範囲・フェンス内の除外・キーの読み取り・値の空白の除去・`problems`・`ledgerMatches`・未知のキーの無視・`## GOTCHAS 候補` 以外の親の下にある候補。
  - 削除: 範囲だけを消す・空になった `## GOTCHAS 候補` を消す・別の親の下では見出しを残す・`file_changed`・`candidate_not_found`・範囲外のパス・同じハッシュが 2 件。
- `src/cli/__test__/cli.test.ts`: 2 つのサブコマンドの成功、終了コード 3 と `removePending`、オプション欠落の終了コード 2。
- `src/__test__/section-reference-inventory.test.ts`: codiel の文書で ARCHITECTURE への言及を足すか消したら、登録簿を合わせる。

## 8. コミットの分け方

1. 設計書
2. SessionStart の記録のタイミング(1)と、そのテスト・ビルド出力
3. SubagentStart の注入(3)と転記の禁止(4)。hooks.json・テスト・ビルド出力・README・rationale・config-schema・ファイル契約・Serena のメモリ
4. GOTCHAS 候補の CLI(2-1)と、そのテスト・ビルド出力・cli-usage・ファイル契約
5. GOTCHAS 候補の手順と書式の契約(2-2・2-3)。metatron のスキル・references・チェックリストと、codiel の `intent-format.md`・チェックリスト、codiel の引き継ぎ書への追記、`docs/rationale.md` の GOTCHAS 候補を消す理由

## 不採用案

記録のタイミングを hook で検出する案は、ユーザーの判断で採らなかった。検討した案と弱点は次のとおりである。

| 案 | 採らなかった理由 |
| --- | --- |
| Stop hook でこのセッションのコミット(reflog)と codiel の run の終了を合図にする | 途中のコミットでも通知する。コミットしない作業は拾えない。状態ファイルによる抑止が要る |
| 合図が出たときだけ `claude -p` で完了かを判定する | 子の Claude Code への hook の再帰、時間切れへの対処が要る |
| prompt 型の Stop hook で毎回判定する | 毎ターン LLM を呼ぶ |
| 作業ツリーが clean に戻ったときを合図にする | 未コミットのまま残すパス(このリポジトリの `docs/chat/`)があると発火しない |
| TaskCompleted を合図にする | TaskUpdate ツールでしか発火しない |
| PreCompact で促す | 注入ができない(`decision` しか返せない) |

## 確かめた事項(2026-10-04)

- SubagentStart の `additionalContext` の上限は公式文書に無い。SessionStart と同じ 10,000 文字とみなし、両イベントとも予算を `maxChars` と 10,000 文字(`PLATFORM_MAX_CHARS`)の小さいほうで頭打ちにする。
- hooks.json に足した SubagentStart は、新しいセッション(`claude -p --plugin-dir plugins/metatron`)で Explore を起動したときに発火した。デバッグログに `Hook SubagentStart:Explore ... success` が出て、サブエージェントは注入文の見出しと「読むだけにする」の行を引用した。
