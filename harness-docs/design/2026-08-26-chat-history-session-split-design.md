# chat-history: 記録ファイルを 1 セッション 1 ファイルにする

- 日付: 2026-08-26
- 対象プラグイン: `plugins/chat-history`
- 状態: 設計（実装前）
- 関連: `.claude/context-maps/2026-08-26-chat-history-session-split.md`

## 背景と問題

`docs/chat/` の記録ファイルには、複数の Claude Code セッションが同居する。

実例として `docs/chat/2026/0826/phyllis998/agent-policy-codex-model-setup.md` には、`session_id` が異なる 5 つのセッション（`d8053e30…` / `c4cc632d…` / `6731d3f0…` / `922fe0f3…` / `94444b59…`）の会話が入っている。前日の `2026/0825/phyllis998/agent-policy-claude-model-setup.md` にも 3 セッションが同居している。扱った主題も、Codex モデル定義の確認・ARCHITECTURE の `scripts` / `tools` 節の変更・Grok エイリアスの調査と、セッションごとに異なる。

原因は 2 層ある。

**層 1（直接原因）** — `plugins/chat-history/src/prepare-chat-recording.ts:171`:

```ts
const selected =
  resumable ?? (candidates.length === 1 ? (candidates[0] as string) : null)
```

`resumable` は「同一セッションが既に書いた記録ファイル」（`state.recordPath`）である。新しいセッションではこれが `null` になり、右辺の「その日・その作業者のディレクトリに `.md` が 1 件だけならそれに追記する」というフォールバックへ落ちる。別セッションであることは判定に使われていない。

**層 2（なぜそうなっているか）** — `plugins/chat-history/skills/chat/SKILL.md` の「保存場所」節が、分割軸をトピックとして規定している。

> 直前の記録と同じ成果物・同じ目的の作業を続けるときは、新規ファイルを作らず既存ファイルにセッション見出しを増やして追記する。成果物も目的も変わったときは新規ファイルを作る。

「同じ目的の作業か」は LLM にしか判定できず、判定は揺れる。`docs/rationale.md` が記すとおり、このプラグインは記録先の決定を LLM から外す方針を採ってきた。その結果、揺れる判定の代わりに「候補が 1 件なら追記」という機械的な近似が置かれ、別セッションの同居を生んだ。

分割軸が曖昧であることが根であり、層 1 はその症状である。

### 既に出ている実害

同居は記録の断片化にとどまらない。`agent-policy-codex-model-setup.md` には `## セッション 16` と `## セッション 19` がそれぞれ 2 つある。`prepare` は記録ファイル全文から `lastSessionNumber` を読んで次の番号を決めるため、別々のセッションが同時に同じファイルを読むと同じ番号を振る。セッション単位でロックを持っていても、ファイルは共有されているため競合を防げない。

分割軸をセッションに変えると、ファイルがセッション単位で排他されるため、この採番の破壊も同時に解消する。

## 目的

記録ファイルの分割軸を、トピックから **Claude Code のセッション** へ変える。1 セッションの会話は 1 ファイルに収め、別セッションの会話が同じファイルに入らないようにする。

セッションは `session_id` で機械的に判定でき、状態ファイルは既に `sessionKey`（`session_id` のハッシュ）単位で分かれている。判定に必要な情報は揃っており、記録先の選択で使っていないだけである。

## 非目標

- **会話記録の粒度の変更**。本文は従来どおり `prepare-chat-recording` が transcript から機械生成し、ユーザー発言・AI 発言ともに原文のまま残す
- **`## セッション N` の採番方式・文言の変更**。同一ファイルへの追記回を区切る見出しとして維持する
- **既存の同居ファイルの分割移行**。過去の記録は改変しない
- **`reconcileGeneration`（世代交代判定）の変更**。compaction では transcript ファイルも `session_id` も変わらないことを確認しており、触ると記録重複のリスクを持ち込む
- **worktree 移転時の記録先の扱い**。`type: relocated` を含む transcript は同一 `session_id` のまま cwd が変わるため、記録が worktree 側の `docs/chat/` に書かれる。現行と挙動は変わらないため本設計では扱わない
- **`--body-file` 差し替え経路の閉塞**。`docs/rationale.md` が残課題として挙げている構造的保証は、本設計とは別の変更として扱う

## 前提の実測

設計判断の根拠として、transcript・状態ファイル・CLI の契約を確認した。初版で誤っていた 2 点を独立レビューの指摘により訂正している。

- **1 transcript = 1 `session_id`**。プロジェクト内のトップレベル jsonl は調べた範囲すべてで単一 `sessionId` であり、同一 ID が複数ファイルに分かれた例は無い
- **`--resume` / `--continue` は元の `session_id` を再利用する**。`claude --help` の `--fork-session` は「When resuming, create a new session ID **instead of reusing the original** (use with --resume or --continue)」と述べており、新しい ID を作るのは `--fork-session` を明示したときに限られる。したがって再開しても `sessionKey` は変わらず、`state.recordPath` により**同じ記録ファイルへ追記が続く**
  - 初版はこれを「再開後は別ファイルになる」と記述していたが誤りだった。同居していた 5 セッションはいずれも `entrypoint: cli` の新規起動であり、`--resume` の連鎖ではない
- **compaction のマーカーは `type: "system", subtype: "compact_boundary"`**。プロジェクト内に `type: "summary"` の行は 1 件も無く、`compact_boundary` を含む transcript が 6 件ある。いずれも `session_id` は変わらず、行も削除されずその後の追記が続く。したがって `reconcileGeneration` は発火せず `state.recordPath` は保持される
  - 初版は同じ結論を `type: summary` を根拠として述べていたが、観測したラベルが誤りだった。結論は変わらない
- **transcript の `timestamp` は UTC**（例 `2026-08-25T21:59:21.651Z`）。一方 `prepare-chat-recording.ts` の日付ディレクトリは `new Date()` のローカル基準である。同じセッションを UTC で見ると 8/25、ローカル（JST）で見ると 8/26 になる
- **先頭の数行は `timestamp` を持たない**。`last-prompt` / `mode` / `permission-mode` のほか `atis-latch` なども現れ、行数は一定しない。ただし最初の `timestamp` はいずれのファイルでも先頭 6 KiB 以内に現れる。「先頭 N 行をスキップする」実装は誤りであり、「最初に `timestamp` を持つ行を採る」のが正しい
- **`SubagentStop` が子 transcript に張られる**。サブエージェントの jsonl は `<sessionId>/subagents/agent-*.jsonl` に置かれ、親と同じ `sessionId` を持つ。本プラグインの `hooks.json` は `Stop` のみを購読しているため現状は影響しない

## 方針

記録先の決定を、これまで以上にスクリプト側へ寄せる。

新しいセッションでは必ず新しいファイルを作る。ファイル名は `HHMM-<トピックのケバブケース>.md` とし、`HHMM` はセッション開始時刻をローカルタイムゾーンへ変換したものを `prepare-chat-recording` が確定する。chat-recorder（LLM）が決めるのはトピックのスラッグだけで、プレフィックスにも日付ディレクトリにも触れられない。

代替案として「選択ロジックだけを直し、プレフィックスは `newRecordPathExample` に埋めて LLM にパスを組ませ、`commit` が正規表現で検証する」形も検討したが採らない。プレフィックスは `prepare` が確定できる値であり、LLM が決める必然性がない。LLM に組ませれば「プレフィックスを付け忘れた」「別の時刻を書いた」という失敗経路が残り、検証で弾かれるたびに記録が次ターンへ持ち越される。

## 設計

### 1. セッション開始時刻の確定

`prepare-chat-recording` に、セッション開始時刻を求める処理を置く。

1. transcript を読み、**最初に有効な ISO 8601 `timestamp` を持つ行**の値を採る。行の `type` は判定に使わない
2. 見つからない場合は transcript ファイルの `birthtime` を採る
3. `birthtime` が無効（`birthtimeMs === 0`、またはエポック相当）なら `mtime` を採る
4. いずれも取得できない場合は `new Date()` を採る。この経路に落ちてもファイル名の意味が劣化するだけで、記録の成否には影響しない

**transcript は全文を読む。** 初版は先頭 64 KiB / 1 MiB の二段窓を提案していたが採らない。`prepare` は直後に `extractConversationFile` が transcript 全文を読むため窓読みに性能上の利益がなく、一方で「1 行が窓を超える場合に、その行の先頭にある `timestamp` を取りこぼす」という境界バグを持ち込む。最初のユーザー発言に大きな貼り付けがあると現実に起こる。

**確定した値を状態ファイルへ保存しない。** 毎回 transcript から計算する。

初版は `RecordingState` に `sessionStartedAt` を足し、`prepare` が初回に 1 回だけ書く設計だったが、これは採らない。Stop フック（`check-chat-recorded.ts`）は記録の要否を判定する前に、読み込んだ state を無条件で `atomicWriteJson` する。`atomicWriteJson` は一時ファイル経由の `rename` でアトミックではあるが CAS ではなく、後に書いた側が勝つ。`prepare` が読み取り時点のスナップショットを書き戻すと、その間にフックが更新した `attemptedLine` / `attemptId` / `transcriptIdentity` を巻き戻す。`prepare` は `extractConversationFile` で長い transcript を読むため、競合の窓は数秒に及びうる。書き手を増やす変更そのものが競合を生む。

保存しなくても実害は小さい。プレフィックスが使われるのは記録ファイルを**新規作成する 1 回だけ**であり、2 回目以降は `state.recordPath` が記録先を決めるためプレフィックスは参照されない。`timestamp` が採れる通常経路では計算は冪等である。`mtime` フォールバックに落ちた場合は再試行ごとに値が動きうるが、その時点ではまだファイルが作られていないため、別の名前で作られるだけで記録は成立する。

### 2. 日付ディレクトリとプレフィックスの基準を揃える

日付ディレクトリの基準を「初回記録が走った瞬間のローカル日付」から「**セッション開始のローカル日付**」へ変える。プレフィックスも同じ値から導く。

現状の実装は `new Date()` を使うため、23:50 に始まり 00:05 に初回記録が走ったセッションでは、ディレクトリが翌日、プレフィックスが `2350` となって食い違う。両方を単一の基準から導けば `2026/0826/2350-topic.md` の形で整合する。

変換は純関数として切り出す。

```ts
// 与えられた Date のローカル年・月日・時分を返す
// getFullYear / getMonth / getDate / getHours / getMinutes を使う
function localRecordParts(at: Date): {
  year: string      // "2026"
  monthDay: string  // "0826"
  hhmm: string      // "0712"
  date: string      // "2026-08-26"
}
```

`prepare` が返す `date`（chat-recorder がヘッダーに書く日付）も、この関数の `date` を使う。ヘッダーの日付・ディレクトリ・プレフィックスがすべてセッション開始日に揃う。

日をまたぐセッションが記録開始日のディレクトリへ追記を続ける挙動は、`state.recordPath` の優先によって従来どおり保たれる。

### 3. 記録先の選択

単一候補フォールバックを削除する。

```ts
const selected = resumable
```

同一セッションが既に書いたファイルがあればそこへ追記し、無ければ新規ファイルを作る。それ以外の分岐を持たない。

返り値の `recordCandidates` は意味を失うため削除する（chat-recorder の手順でも参照されていない）。

このフォールバックは、意図せず「`state` を失ったセッションが元のファイルへ戻る」回復経路としても働いていた。削除するとその経路が消えるため、代わりに §6 で記録ファイル自身へ `session_id` を刻み、後から再結合できるようにする。

### 4. ファイル名の合成を `commit` に閉じる

`commit-chat-recording` の引数を変える。

- 廃止: `--record-path`（プロジェクト相対のファイルパス全体）
- 新設: `--record-slug`（トピックのケバブケース。拡張子もディレクトリもプレフィックスも含まない）

`commit` は新規記録のとき、plan の確定値からパスを組み立てる。

```
<plan.allowedNewRecordDir>/<plan.recordFilePrefix>-<slug>.md
```

**スラッグの検証**:

- 形式は `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
- 長さの上限は 80 文字
- **先頭が 4 桁の数字で始まるものを拒否する**（`/^\d{4}($|-)/`）。`0712-topic` だけでなく `0712` 単体も拒否する。後者を通すと `0712-0712.md` になる

3 番目の規則には理由がある。`skills/chat/SKILL.md` の全文は `skillContract` として chat-recorder へ渡る。SKILL.md に `HHMM-<kebab-case>.md` というパス例を書けば、LLM はスラッグ自体に `0712-topic` を入れうる。基本の正規表現は数字を許すためこれを通してしまい、`0712-0712-topic.md` が検証を素通りして生成される。検証に落ちないため次ターンへの持ち越しも起きず、静かに歪んだ名前が残る。先頭 4 桁数字を拒否すれば、この経路は検証エラーとして表面化する。

あわせて SKILL.md には**プレフィックスを含まないスラッグの例だけ**を書き、プレフィックスは `commit` が付けると明記する（§契約文書の変更）。

**追記時の扱い**: `plan.recordTarget.relativePath` が非 `null` のとき、`--record-slug` は**無視する**。現行の `--record-path` は追記時に渡すと拒否されるが、同じ扱いにすると、chat-recorder が習慣的にスラッグを付けただけで追記が失敗する。パスは plan 側で確定しているため、無視して問題ない。

### 5. INDEX 行の合成を `commit` に閉じる

ファイル名の合成を `commit` に移すと、chat-recorder は新規記録時に最終的なパスを知らない。現行の契約では chat-recorder が INDEX 行（パス・日付・作業者・要旨）を丸ごと書くため、このままではパスを二重に組み立てることになり、`commit` 側の合成結果と食い違えば検証で落ちる。

そこで INDEX 行の組み立ても `commit` に移す。

- 廃止: `--index-line-file`（INDEX 行全体）
- 新設: `--index-summary-file`（要旨 1 行のみ）

`commit` は自身が持つ確定値から行を合成する。

```
- `<docs/chat からの相対パス>` | <plan.recordDate> | <plan.workerName> | <要旨>
```

**要旨の検証**: 1 行であること・空でないこと・上限バイト数に加え、**`|` を含まないこと**を検証する。`find-chat-records.ts` は INDEX 行を `split(" | ")[3]` で分解して要旨を取り出すため、要旨に区切り文字が混ざると検索結果の表示が壊れる。chat-recorder が旧来の習慣で INDEX 行全体を書いてしまった場合も、この検証が捕まえる。

**追記時の既存行の更新**: 既存行を部分的に書き換えるのではなく、**行全体を再合成して置き換える**。日付は `plan.recordDate`（セッション開始日）を使い、セッションが日をまたいでも変わらない。ディレクトリの日付と一致した状態が保たれる。要旨は毎回の記録で上書きされ、常に最新の要旨がファイル全体を代表する（1 ファイル 1 行の不変条件は現行どおり）。

**`prepare` 側の返り値も揃える。** `prepare` は現在 `indexLineFile`（一時ファイルの絶対パス）・`indexLine`（既存の INDEX 行）・`indexLineExample`（書式の見本）を返しており、chat-recorder はこれらを使って INDEX 行を組み立てる。`commit` が行を合成するようになると 3 つとも役目を失う。`indexLineFile` は `indexSummaryFile` へ改名し、`indexLine` と `indexLineExample` は削除する。

`indexLineExample` は特に残してはならない。書式の見本にはパスが含まれるため、プレフィックス付きのパス表記を載せると、SKILL.md からパス例を消しても `prepare` の返り値経由で二重プレフィックスを誘導してしまう。

これは案の必然的な帰結としてのスコープ拡大であり、副作用として INDEX の形式が LLM の出力から独立する。

### 6. 記録ファイルへ `session_id` を刻む

`commit` は新規記録の作成時、ヘッダーの箇条書きの末尾に 1 行を機械的に追加する。

```markdown
# <題名>

- 日付: 2026-08-26
- 参加者: phyllis998, AI (Claude Opus 5)
- 成果物: …
- 前提: …
- セッション ID: cfa925f8-d36b-4dad-8b79-47bdddf1a653

---
```

この行は LLM を経由せず、`prepare` が plan へ格納した値を `commit` が書く。目的は 2 つある。

1. **`state` 喪失時の再結合**。§3 でフォールバックを削除したため、`state` を失ったセッションは新しいファイルを作る。ファイルに `session_id` が刻まれていれば、後から同一セッションの記録だと判定して人手で結合できる
2. **`--fork-session` の追跡**。fork は新しい `session_id` を発行するため新しいファイルになる。分岐したセッションは別セッションであり分割自体は正しいが、元の会話との関係は `session_id` からしか辿れない

`prepare` は返り値と plan に `sessionId` を追加する。ヘッダー本体（題名とメタ情報）は従来どおり chat-recorder が書き、`commit` はその末尾に 1 行を足すだけとする。

`sessionId` は `commit` が書き込む前に検証する。改行を含む値をそのまま埋めるとヘッダーの箇条書き構造が壊れるため、改行を含むもの・長すぎるものは行を足さずに省く。`state.sessionId` が無い場合（フックが `session_id` を渡せなかった場合）も同様に省く。

### 7. plan スキーマ

`prepare` が書き、`commit` が読む plan に確定値を追加する。

| フィールド | 内容 | 備考 |
| --- | --- | --- |
| `version` | `2` | スキーマ変更のため 1 から上げる |
| `recordFilePrefix` | `"0712"` | セッション開始のローカル時分 |
| `recordDate` | `"2026-08-26"` | セッション開始のローカル日付 |
| `workerName` | `"phyllis998"` | INDEX 行の合成に使う |
| `sessionId` | `"cfa925f8-…"` | ヘッダーへ刻む値。取得できなければ省略 |
| `allowedNewRecordDir` | 既存 | セッション開始日から算出 |
| `recordTarget` | 既存 | `{ relativePath, appendMode }` |
| `sessionNumber` | 既存 | 追記回の採番 |
| `recordCandidates` | 削除 | 選択ロジックから消えるため |

**`version` を 2 に上げる主体は `prepare` である。** plan を最初に作るのは Stop フック（`check-chat-recorded.ts`）であり、そこでは `version: 1` が書かれる。`prepare` は現在 `{ ...plan, … }` の形で既存フィールドを引き継いで書き戻すため、明示的に上書きしなければ `version` は 1 のまま残り、`commit` が全件を拒否して記録が完全に停止する。`prepare` が `version: 2` を明示的に書き、フックの型定義も揃える。

`commit` は `plan.version !== 2` を検証エラーとして扱う。バンドル更新の途中で旧 `prepare` が書いた plan と新しい `commit` が組み合わさる事故を防ぐ。既存の `sessionNumber` 検証（`## セッション undefined` を防ぐガード）と同じ趣旨である。

**バージョンだけでなく、使う確定値の存在も個別に検証する。** `recordFilePrefix` / `recordDate` / `workerName` / `allowedNewRecordDir` のいずれかが欠けたまま合成すると、`undefined-slug.md` というファイル名や `| undefined |` を含む INDEX 行を静かに書いてしまう。既存の `sessionNumber` 検証が個別に置かれているのと同じ形で、新しい確定値にも同じガードを置く。

なお `plan.version` は「新しい `commit` が古い plan を弾く」方向にしか働かない。旧 `commit` は `version` を見ないため、新 `prepare` × 旧 `commit` の組み合わせは検出できない。バンドルと Agent 定義は同じコミットに含めて配布する。

### 8. ファイル名衝突の扱い

同一セッションの記録先は `state.recordPath` で一意に定まるため、衝突は「同じ分に開始した 2 つのセッションが同じスラッグを選んだ場合」に限られる。実測では同居していた 5 セッションの開始時刻は 05:51 / 06:59 / 07:35 / 07:51 / 07:52 で分が割れており、この日は衝突しない。ただし 07:51 と 07:52 は 1 分差であり、起こりうる。

`commit` は新規作成に `flag: "wx"` を使っており、衝突すれば `EEXIST` で失敗する。そのまま失敗させると、再試行しても同じプレフィックスと同じスラッグを選び続けて記録が進まない。

`EEXIST` を検出したら `<prefix>-<slug>-2.md`、`<prefix>-<slug>-3.md` … と、拡張子の直前に連番を付けて再試行する。連番は 2 から始める（サフィックスの無い最初のファイルが実質の 1 番目であるため）。上限は 9 とし、そこまで埋まった場合のみ失敗として `lastError` に残す。

上限に達した場合、chat-recorder は同じスラッグを出し続けるため自動では回復しない。人手でファイルを退避する必要がある。この状態は同一分に 9 セッションが同一スラッグを選んだ場合にのみ起きる。

### 9. 責務分担（変更後）

| 担当 | 生成物 |
| --- | --- |
| `prepare-chat-recording` | 本文（`bodyFile`）、セッション開始時刻、日付ディレクトリ、プレフィックス、セッション番号、`session_id` |
| chat-recorder (haiku) | セッション要旨 1 行、INDEX の要旨 1 行、トピックのスラッグ、ヘッダーの題名とメタ情報（新規時のみ） |
| `commit-chat-recording` | ファイルパスの合成、INDEX 行の合成、`session_id` 行の追記、追記／新規書き込み、検証、状態確定 |

chat-recorder が書くものは、すべて「短い自然言語」に揃う。パス・日付・作業者・採番・`session_id` といった機械的に定まる値は、いずれも LLM を経由しない。

ヘッダーの日付だけは chat-recorder が書くため、`prepare` が返す `date` を無視すればディレクトリとずれる余地が残る。ヘッダー全体を `commit` が合成する形も考えられるが、題名・成果物・前提は LLM にしか書けないため、本設計では扱わない。

## この改修が誘発する副作用への対処

1 セッション 1 ファイルにすると記録ファイル数と INDEX の行数が数倍になる。今日の例では 1 日 5 ファイル、INDEX は現在 84 行でうち `agent-policy` 系が 15 行を占める。

ここで既存の食い違いが顕在化する。`recall` スキルは「`hits` が 15 件を超えるときは上位 15 件（**新しい順**）だけを chat-reader に渡す」と規定しているが、`find-chat-records.ts` の index（キーワード検索）モードは INDEX.md の行順のまま `hits` を返す。INDEX はパス昇順、つまり**古い順**である。ソートしていないため、キャップに掛かると新しい記録から落ちる。

`--latest` モードは日付降順・同日は mtime 降順に正しくソートしており、壊れているのは index モードだけである。

ファイル数が増える前は 15 件に収まっていたため実害が見えにくかったが、本改修はこれを常態化させる。index モードの `hits` を、`--latest` と同じ順序（日付降順、同日は mtime 降順）へソートしてから返すよう修正する。1 箇所の変更で済み、本改修が引き起こす劣化を防ぐために必要である。

## 契約文書の変更

### `skills/chat/SKILL.md`

「保存場所」節の分割軸を書き換える。

- パスを `docs/chat/YYYY/MMDD/<作業者名>/<時刻>-<内容を表すケバブケース名>.md` とする
- `YYYY/MMDD` と `<時刻>` はセッション開始時刻（ローカル）から**スクリプトが決める**こと。chat-recorder が書くのはケバブケースのトピック名だけであること
- **プレフィックスを含むパス例を書かない**。書けば `skillContract` として chat-recorder に渡り、スラッグへ二重に入る（§4）
- **1 ファイル = 1 Claude Code セッション**であり、既存ファイルへの追記は同一セッションが続いている場合に限ること
- トピックが同じでもセッションが違えば別ファイルになること
- `--resume` / `--continue` は同じセッションとして扱われ、同じファイルへ追記が続くこと

「索引(INDEX.md)」節に、行の合成が `commit` の責務であること（chat-recorder が書くのは要旨のみ、`|` を含めないこと）を反映する。

「ファイルの構成」節に、次を明記する。

- `## セッション N` の N は**同一ファイル内の追記回**であり、Claude Code のセッション番号ではないこと。1 ファイル 1 セッションになることで語が二重になるため、混同を防ぐ
- ヘッダーの箇条書き末尾に `commit` が `セッション ID` を追加すること

### `agents/chat-recorder.md`

- 手順 2 の「プロジェクト相対パスを決める」を「トピックのスラッグを決める」へ変える。プレフィックスと日付ディレクトリには触れないこと、スラッグに時刻を含めないことを明記する
- 手順 3 の Write 対象を `indexLineFile` から `indexSummaryFile` へ変える。書くのは要旨 1 行のみで、パスや日付を含めないことを明記する
- 手順 4 のコマンド例を `--record-path` から `--record-slug`、`--index-line-file` から `--index-summary-file` へ変える
- `recordCandidates` / `newRecordPathExample` / `indexLineExample` への言及を `recordSlugExample` に置き換える

## 移行と後方互換

- **既存の記録ファイルは変更しない**。旧形式のファイル名（プレフィックス無し）は `find-chat-records.ts` がパス構造から読むため、recall / resume はそのまま動く
- **進行中のセッションは記録先を変えない**。`state.recordPath` を持つセッションは、それが同居ファイルであっても追記を続ける。セッションが続いている以上それが正しい。したがって採番競合は、同居ファイルを共有する既存セッションが終わるまで残る
- **INDEX の既存行は形式が変わらない**。`commit` が合成しても同じ 4 列の形になる
- **状態ファイルの移行は不要**。`sessionStartedAt` は任意フィールドで、無ければ `prepare` がその場で計算して補う
- **移行期間の検索精度**。旧同居ファイルは「1 ヒットに複数セッション」、新ファイルは「1 ヒット = 1 セッション」となり、`--latest 3` の意味が混在する。旧ファイルの INDEX 要旨は最後に追記したセッションの内容を反映しており、同居した他のセッションを代表しない。この劣化は既存記録を移行しない選択の帰結であり、受け入れる

## テスト方針

`prepare-chat-recording.test.ts`:

- 新しいセッションは、同じディレクトリに候補が 1 件だけあっても新規ファイルとして扱う（現行の「state.recordPath のファイルが無ければ単一候補判定に戻る」テストは仕様変更により置き換え）
- 日付ディレクトリとプレフィックスが、`new Date()` ではなくセッション開始時刻から導かれる。UTC 日付とローカル日付が食い違う入力（`2026-08-25T21:59Z`）で検証する
- 先頭に `timestamp` を持たない行が並ぶ transcript でも、最初の `timestamp` を拾う
- 1 行が非常に長い transcript（数百 KiB のユーザー発言）でも、その行の `timestamp` を拾う
- `timestamp` を持つ行が無い transcript で `birthtime` にフォールバックし、それも無効なら `mtime` を使う
- `state.recordPath` があるセッションは、日をまたいでもそのファイルへ追記する
- plan に `version: 2` と確定値が書かれる
- 返り値に `indexLine` / `indexLineExample` / `recordCandidates` / `newRecordPathExample` が含まれない

`commit-chat-recording.test.ts`:

- `--record-slug` からパスが合成される。ディレクトリとプレフィックスは plan の値が使われる
- 不正なスラッグ（大文字・スラッシュ・拡張子付き・長さ超過・**先頭 4 桁数字**・**4 桁数字のみ**）を拒否する
- 追記時に `--record-slug` を渡しても無視され、plan のパスへ追記される
- `EEXIST` で `-2` 以降のサフィックスを付けて再試行し、既存ファイルを壊さない
- **`EEXIST` で連番を使ったあと INDEX 検証で失敗したとき、作った連番ファイルだけを消し、衝突していた既存ファイルを壊さない**
- `plan.version !== 2` を拒否する。確定値が欠けた plan も拒否する
- INDEX 行が新規・追記の双方で正しく合成され、1 ファイル 1 行の不変条件が保たれる
- 要旨に `|` を含む入力を拒否する
- 新規ファイルのヘッダー末尾に `セッション ID` 行が入る。改行を含む `sessionId` では行を足さない

**CLI を踏むテストを別に用意する。** 上記はいずれも `commitChatRecording()` を直接呼ぶため、`parseArgs` のフラグ名を差し替え忘れても緑になる。本番経路は chat-recorder が `commit-chat-recording.mjs` をコマンドラインで叩く経路だけであり、フラグ名そのものが契約である。`src/testing/run-ts.ts` を使ってスクリプトを子プロセスで実行し、`--record-slug` と `--index-summary-file` で記録が成立することを検証する（`find-chat-records.test.ts` が既に同じ形を採っている）。

`find-chat-records.test.ts`:

- index モードの `hits` が日付降順で返る
- index モードの `hits` が、同日のときは mtime 降順で返る（日付だけのテストは、単に配列を逆順にした実装でも通ってしまう）

**タイムゾーンの扱い**: `localRecordParts` は `Date` のローカル getter を使うため、プロセスのタイムゾーンに依存する。「TZ 非依存のテスト」と「UTC とローカルの食い違いを検証するテスト」は両立しないため、**テスト実行時に `TZ=Asia/Tokyo` を固定する**。`vitest.config.ts` の環境設定、またはテストファイル単位での指定で行う。固定しなければ CI や他タイムゾーンの環境で期待値が割れる。

## 影響範囲

- `plugins/chat-history/src/prepare-chat-recording.ts`
- `plugins/chat-history/src/commit-chat-recording.ts`
- `plugins/chat-history/src/hooks/check-chat-recorded.ts`（`AttemptPlan` の型定義を揃える）
- `plugins/chat-history/src/find-chat-records.ts`（index モードの並び順）
- `plugins/chat-history/agents/chat-recorder.md`
- `plugins/chat-history/skills/chat/SKILL.md`
- `plugins/chat-history/README.md`
- `plugins/chat-history/docs/rationale.md`（分割軸を変えた理由を追記）
- `plugins/chat-history/src/__test__/prepare-chat-recording.test.ts`
- `plugins/chat-history/src/__test__/commit-chat-recording.test.ts`
- `plugins/chat-history/src/__test__/find-chat-records.test.ts`
- `vitest.config.ts` または該当テスト（TZ の固定）
- `plugins/chat-history/scripts/`（`pnpm run build` で再生成）
- `plugins/chat-history/.claude-plugin/plugin.json` と `package.json`（0.7.0 → 0.8.0。引数契約の変更を含むためマイナーを上げる）

## リスク

- **引数契約の変更**が `commit-chat-recording.mjs` の呼び出し元（chat-recorder の定義）と同期していないと記録が止まる。**Agent 定義の更新とバンドルの再生成は同じコミットに入れなければならない。** 本番経路は chat-recorder が CLI を叩く経路だけであり、片方だけが先に main へ載ると次の Stop フックで `missing --index-summary-file` あるいは `missing --index-line-file` が出て記録が失敗する。しかも失敗時点で `attemptedLine` は既に上がっているため、同じターンでは再試行されない。このリポジトリはブランチを切らず、かつ `docs/chat/` を持つため実装セッション自身が記録対象であり、この不整合は実際に踏む。`plan.version` の検証は「旧 plan × 新 commit」を検出するが、「新 prepare × 旧 commit」は検出できない
- **`plan.version` の上書き漏れ**は記録の全停止に直結する。フックが書く初期値が 1 であるため、`prepare` での明示的な上書きをテストで担保する
- **セッション開始時刻の取得失敗**が続くと `birthtime` フォールバックが常用される。`birthtime` はファイルシステムによっては取れず、その場合 `mtime` になって初回記録時刻に近い値へ寄る。ファイル名の意味としては許容できる劣化であり、記録の成否には影響しない
- **`--fork-session` による分岐**は新しい `session_id` を発行するため、1 つの会話が 2 ファイルに割れる。分岐したセッションは別セッションであり分割自体は正しいが、ヘッダーの `セッション ID` 以外に関係を辿る手段はない
- **1 日あたりのファイル数と INDEX 行数が増える**。recall の 15 件キャップと index モードの並び順の問題は本設計で対処するが、INDEX が長期的に肥大する傾向自体は残る

## 未解決事項

1. transcript 先頭のメタ行の種類が将来増え、`timestamp` を持つ行がさらに後方へずれる可能性。1 MiB まで探索してフォールバックするため破綻はしない
2. 同一分に開始した 2 セッションが同じスラッグを選ぶ確率は低いが、`-2` 以降のサフィックスが付いたファイルは名前から衝突と区別しにくい。運用で問題になれば別途扱う
3. `SubagentStop` を将来購読する場合、子 transcript は親と同じ `session_id` を持つため `sessionKey` が衝突する。現状は `Stop` のみを購読しているため影響しない
4. INDEX の長期的な肥大。行数が数百に達した場合の分割・アーカイブは本設計では扱わない

## レビューでの指摘と採否

設計の初版に対し、理解と暗黙知の抽出（Haiku）、前提検証と反証提示（Grok）の 2 系統のレビューを実施した。

**採用（前提の訂正）**:

- `--resume` / `--continue` は元の `session_id` を再利用する。初版の「再開後は別ファイルになる」は誤り。`claude --help` で確認して訂正した
- compaction のマーカーは `type: summary` ではなく `system` / `compact_boundary`。プロジェクト内の全 transcript を数えて訂正した。結論（`reconcileGeneration` は発火しない）は変わらない
- 先頭の timestamp 無し行は 3 行とは限らない。行数ではなく「最初の timestamp」で判定する

**採用（設計の追加）**:

- スラッグの先頭 4 桁数字を拒否する（二重プレフィックスのサイレント失敗を防ぐ）
- `plan.version` を上げる主体を `prepare` と明記する（未定義のままだと記録が全停止する）
- 追記時に `--record-slug` を無視する（禁止すると追記が落ちる）
- 要旨に `|` を含めない検証を加える（`find-chat-records` の分解が壊れる）
- 記録ファイルのヘッダーへ `session_id` を刻む（フォールバック削除で失われる回復経路の代替）
- index モードの並び順を日付降順にする（recall の 15 件キャップで新しい記録が落ちる）
- テストで `TZ` を固定する（「TZ 非依存」と「UTC/ローカル食い違いの検証」は両立しない）
- `sessionStartedAt` の書き込み主体・タイミング・競合回避を明記する
- サフィックスの位置と連番の開始値、上限到達時の挙動を明記する

**不採用**:

- 「設計書の記述が現行実装と一致しない」という 8 件の指摘。設計書は実装前の文書であり、現行実装と異なることは欠陥ではない
- ファイル名に `session_id` の断片を含める案。一意性は高まるが可読性を損なう。`session_id` はヘッダーへ刻むことで再結合の目的を満たす
- `--body-file` 差し替え経路の閉塞。`docs/rationale.md` が残課題として挙げているものであり、記録先の分割とは独立した変更として扱う
- worktree 移転（`type: relocated`）への対処。現行と挙動が変わらないため本設計では扱わない

### 実装計画に対する 2 巡目のレビュー

実装計画を書いた後、同じ 2 系統でもう一度レビューを回した。その結果として設計を 2 点変更している。

**変更 1: `state.sessionStartedAt` を廃止した（§1）**

Stop フックが判定前に state を無条件で書くため、`prepare` が読み取り時点のスナップショットを書き戻すと、フックが更新した `attemptedLine` / `attemptId` / `transcriptIdentity` を巻き戻す。`atomicWriteJson` は CAS ではなく後勝ちであり、`prepare` は `extractConversationFile` で長い transcript を読む分だけ競合の窓が開く。保存をやめて毎回計算する形にした。プレフィックスが使われるのは新規作成の 1 回だけなので、保存しなくても実害は小さい。

**変更 2: 先頭 64 KiB / 1 MiB の窓読みをやめ、全文読みにした（§1）**

`prepare` は直後に transcript 全文を読むため窓読みに利益がなく、1 行が窓を超える場合に `timestamp` を取りこぼす境界バグだけを持ち込む。

**あわせて設計へ追加した検証**

- スラッグ検証を `/^\d{4}($|-)/` にした。`0712` 単体を通すと `0712-0712.md` になる
- `prepare` の返り値から `indexLine` と `indexLineExample` を削除し、`indexLineFile` を `indexSummaryFile` へ改名する旨を明記した。`indexLineExample` を残すと、SKILL.md からパス例を消しても返り値経由で二重プレフィックスを誘導する
- `plan` の確定値（`recordFilePrefix` / `recordDate` / `workerName` / `allowedNewRecordDir`）の欠落を個別に検証する
- `sessionId` に改行が含まれる場合はヘッダー行を足さない
- Agent 定義の更新とバンドルの再生成を同一コミットに入れる制約を、リスクの節に明記した
- CLI（`parseArgs`）を踏むテストを別に用意する旨を、テスト方針に明記した
