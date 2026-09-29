# codiel と Raguel の契約

codiel の run が Raguel(`raguel-mcp`)に評価を頼み、結果を記録から読み戻すときの取り決めの正本である。codiel の `codiel-state` は `raguel-mcp` の src を import しない。両者が同じ形を独立に実装し、2 者比較テストで一致を確かめる。この文書を変えるときは `format-change-checklist.md` の「Raguel との契約」に従う。

以下、`R/` は `plugins/codiel/raguel-mcp/src/`、`C/` は `plugins/codiel/src/` を指す。

## 1. フェーズの表

Raguel は codiel のゲート付きフェーズを定数として持つ(`R/codiel/phases.ts` の `GATED_PHASES`)。値は codiel の `STAGES`・`GATED`(`C/codiel-state.ts`)と同じである。

| フェーズ | ステージ番号 | kind | ツール |
| --- | --- | --- | --- |
| intent | 0 | decision | evaluate_decision |
| design | 2 | design | evaluate_design |
| test-spec | 3 | plan | evaluate_plan |
| dev-plan | 3 | plan | evaluate_plan |
| test-code | 4 | code | evaluate_code |
| implement | 5 | code | evaluate_code |
| test-loop | 6 | code | evaluate_code |
| intent-sync | 7 | design | evaluate_design |
| fix-loop | 10 | code | evaluate_code |

- ステージ番号は `STAGES` の添字で、ゲートの無いステージ(discuss・pr・review・triage・finalize)も数える。
- evaluate_* は `phase` を必須で受ける。表の kind とツールが合わなければ入力の誤り(isError)になる。
- あるフェーズの前フェーズは、ステージ番号がそれより小さいゲート付きフェーズすべてである。test-spec と dev-plan は同じステージなので、互いに前フェーズにならない。
- attempt の番号と再提出の比較は、run とフェーズの組ごとに扱う。

## 2. ケースファイルの配置と置き場の解決

### 配置

```
<casesDir>/
  cases/<projectId>/
    evaluations.jsonl                     評価の索引
    outcomes.jsonl                        裁定の記録
    <runId>/<phase>/attempt-NN/
      subject.json  submission.txt  00-synthesis.json  01-rules.json
      02-weight.json  03-adversarial.md  04-steelman.md  05-crosscheck.md
      06-precedents.json  07-context.json(Jev の文脈判定が有効なときだけ)
      08-meta.md  submission-digest.json  verdict.json
  precedents/<projectId>/
    index.json
    <id>.json
```

証拠ファイルの名前は 12 件に固定される(`R/casefile/store.ts` の `EVIDENCE_FILES`)。`verdict.json` は証拠の 12 件に含まれず、その `evidence` の列と `chainHead` が 12 件を束ねる。attempt の番号は run とフェーズの組ごとに 1 から振り、ディレクトリ名の `NN` は 2 桁で、並べるときは数値で比べる。

### 置き場の解決

`casesDir` は次の順で決め、最初に見つかったものを使う。

1. 環境変数 `RAGUEL_CONFIG` が指す JSON ファイルの `storage.casesDir`。中身は `raguel` の値と同じ形のオブジェクトである。
2. プロジェクトルートの `.codiel/config.json` の `raguel.storage.casesDir`。
3. 既定値 `~/.raguel`。`~` はホームディレクトリに展開する(`R/project/root.ts` の `resolveCasesDir`)。

`RAGUEL_CONFIG` を設定すると、設定は 1 のファイルだけを見て、`.codiel/config.json` の `raguel` は読まない。`config.json` が無いとき、または `raguel` キーが無いときは既定値になる。JSON として読めないとき、`raguel` の値がオブジェクトでないときは読み込みの失敗である。Raguel は YAML を読まない。

### プロジェクトルートと projectId

プロジェクトルートは `.codiel/config.json` を探すディレクトリで、codiel の `findMainRoot`(`C/hooks/lib.ts`)と同じ手順で決める。起点は codiel-state ではコマンドの cwd、Raguel ではサーバーの cwd である。

1. 起点のパスが `/.codiel/worktrees/` を含むなら、最初に現れるその位置より前を返す。git は呼ばず、実体化もしない。
2. 起点から親へたどり、`.codiel` を持つ最初のディレクトリを返す。
3. 見つからなければ起点を返す。

利用者が自分で作った worktree(パスが `/.codiel/worktrees/` を含まないもの)は、メインの作業ツリーへ付け替えない。その worktree が `.codiel` を持てばそこがプロジェクトルートになり、持たなければ起点になる。

projectId は、ケースファイルと判例を束ねるキーである。プロジェクトルートとは別に決める。

- `raguel.storage.projectId` があればそれを使う。
- 無ければ `<名前>-<sha256(共通ディレクトリの実体パス) の先頭 12 文字>` を作る。共通ディレクトリは `git rev-parse --path-format=absolute --git-common-dir` の実体パスである。`<名前>` は、共通ディレクトリの basename が `.git` ならその親の basename、そうでなければ末尾の `.git` を除いた basename である。
- git の管理外では、プロジェクトルートの実体パスで同じ形を作る。

共通ディレクトリだけから決まるので、どの worktree から評価しても同じ値になる。

### testsDir の読み方と E2E のレポートの判定

`testsDir` は、`RAGUEL_CONFIG` を設定したときも、プロジェクトルートの `.codiel/config.json` から読む。読み方は codiel の `readCodielConfig`(`C/codiel-state.ts`)と Raguel の `resolveTestsDir(projectRoot)`(`R/config/paths.ts`)で同じである。

- `config.json` かキーが無ければ既定値 `docs/codiel/tests` を使う。
- 値が文字列でない・空・絶対パス・`..` のセグメントを含むときは不正とし、読み込みの失敗にする。Raguel だけが既定値で動くと、codiel とは別の場所をレポートとみなす。評価から外す範囲がずれるので、既定値には縮退しない。
- 使うときは `./` と末尾の `/` を落とす。`.` はリポジトリ全体を指す。

E2E のレポートは、`testsDir` の配下で、`testsDir` からの相対パスに `reports/` のセグメントを含むファイルである(R24)。判定は codiel の `isE2eReport`(`C/hooks/guard-write.ts`)と Raguel の `isE2eReport(repoRel, testsDir)`(`R/config/paths.ts`)で同じにする。`testsDir` の外にある `reports/` は、名前が同じでもレポートにならない。

Raguel はこの判定を `classifyPath(repoRel, config, testsDir)` で使い、レポートを先に、次に生成物(`code/protected-paths` の `generated`)を判定する。レポートと生成物には `common/secrets` だけを当て、保護パス・重さ・パネル・Jev の入力から外す。レポートだけの差分は変更なしとして PROCEED にし、`code/no-change` を出す。呼び出し側の入力は要らない。

## 3. 記録の形

すべての記録は `schemaVersion: 2` を持つ。

### evaluations.jsonl

評価ごとに 1 行を `appendFileSync` の 1 回の書き込みで追記する。

| フィールド | 内容 |
| --- | --- |
| `schemaVersion` | `2` |
| `evaluationId`・`runId`・`phase`・`kind`・`attempt` | 識別 |
| `casePath` | attempt のディレクトリの絶対パス |
| `verdict` | `PROCEED` / `ASK` / `STOP` |
| `judgeStatus` | 判定の基盤の状態。`ok` のときだけ判例の材料になる |
| `head` | 評価時点の `git rev-parse HEAD`。取れなければ `null` |
| `at` | ISO 8601 |

読めない行は例外にし、上書きしない。索引に evaluationId が無いときの文言は `評価の記録が無い(掃除済みか、存在しない)` で、改竄とは別に扱う(`R/casefile/store.ts` の `NO_EVALUATION_RECORD`)。

### outcomes.jsonl

`record_outcome` が記録したものごとに 1 行を追記する。

| フィールド | 内容 |
| --- | --- |
| `schemaVersion` | `2` |
| `evaluationId`・`runId`・`phase` | 識別 |
| `outcome` | `approved` / `rejected` / `incident` |
| `ruling` | `as-is` / `false-positive` / `revise`。無ければ `null` |
| `notes` | 任意 |
| `precedentId` | 作った判例の id。無ければ `null` |
| `at` | ISO 8601 |

同じ evaluationId に複数の行があれば、後の行を正とする。

### verdict.json

| フィールド | 内容 |
| --- | --- |
| `schemaVersion` | `2` |
| `evaluationId`・`runId`・`phase`・`kind`・`attempt` | 識別 |
| `verdict`・`judgeStatus`・`degradedReasons`・`weightTier` | 判定 |
| `findings`・`reasons`・`meta` | 判定の中身 |
| `subject` | `subject.json` と同じ内容 |
| `policy` | `{ configHash, configSource, version: 2, buildVersion }`。`protectedPaths` は含まない |
| `at` | ISO 8601 |
| `prevChainHead` | 同じ run・同じフェーズの 1 つ前の attempt の `chainHead`。無ければ `null` |
| `evidence` | 既知の証拠ファイルの `{ name, sha256 }` の列 |
| `chainHead` | 改竄の検出に使うハッシュチェーンの先頭 |

`configSource` は `env:<パス>`・`cwd:<config.json の絶対パス>`・`defaults` のどれかである。

### subject.json

```jsonc
{
  "repoPath": "/abs/path/to/repo",
  "head": "<40 桁のコミット。git の管理外なら null>",
  "base": "<40 桁のコミット>",        // evaluate_code だけ
  "paths": ["src/a.ts"],               // 指定があったときだけ
  "files": [{ "path": "src/a.ts", "sha256": "<64 桁。削除は null>", "isNew": false }]
}
```

- evaluate_code の `files` は差分に現れたファイルで、`sha256` は HEAD の blob の内容の sha256 である。
- evaluate_plan・evaluate_design の `files` は読んだファイルで、`sha256` は読んだバイト列の sha256 である。pass-gate の検査 9 が、この値と現在のファイルを比べる。
- evaluate_decision は `files` を空にし、`contentSha256` に本文の sha256 を持つ。

## 4. 裁定の組み合わせ

`record_outcome` の `ruling` は、フェーズのゲートでの人の裁定を表す。無いときは run 全体の結末(PR のマージ・却下・incident)を表す。受け付ける組み合わせは次のとおりで、ほかは `recorded: false` と理由で返す。

| ruling | outcome | 受け付ける評価 | 判例 |
| --- | --- | --- | --- |
| `as-is` | approved | verdict が ASK | judgeStatus が ok のときだけ作る |
| `false-positive` | approved | verdict が STOP で、`casefile/tampered` の所見を持たない | 作る。`notes` が必須 |
| `revise` | rejected | verdict が ASK か STOP | judgeStatus が ok のときだけ作る |
| なし | approved / rejected / incident | すべて | judgeStatus が ok のときだけ作る |

- 裁定はすべて `outcomes.jsonl` に書く。判例を作らない組み合わせも記録は残り、pass-gate がそれを読む。
- `casefile/tampered` の STOP は覆せない。改竄は成果物の懸念ではなく、記録の信頼の問題だからである。
- 応答は `{ recorded, precedentId, reason? }` で、判例を作らなければ `precedentId` は `null` である。
- 判例の id は `prec-<evaluationId の先頭 8 文字>-<ruling か run>-<outcome>` である。

## 5. pass-gate の検査

`codiel-state pass-gate` は、次の検査をすべて通ったときだけゲートを通す。番号と順序は `C/codiel-state.ts` の実装と同じにする。

1. 索引に `--evaluation-id` の行がある。
2. 行の `runId` が state の `raguelRunId`、`phase` がコマンドのフェーズと等しい。
3. その行が、同じ run・同じフェーズの索引の最後の行である。後の評価で ASK が出た後に、前の PROCEED で通さないためである。
4. 行の `verdict` が `--verdict` と等しい。
5. 行の `casePath` の `verdict.json` が読め、`evaluationId`・`runId`・`phase`・`verdict` が索引の行と等しい。
6. `--human-approved` が無ければ、verdict が PROCEED である。
7. `--human-approved` があれば、裁定の記録に同じ evaluationId の行があり、verdict が ASK なら `ruling` が `as-is`、STOP なら `false-positive` である。
8. code 系フェーズ(test-code・implement・test-loop・fix-loop)では、`verdict.json` の `subject.head` が現在の `git rev-parse HEAD` と等しく、`subject.base` がフェーズの `startHead` と等しい。`startHead` は `start-phase` が 4 フェーズで記録する。さらに `subject.paths` が無いことを要り、`paths` で範囲を絞った評価では通さない。空の配列も絞った評価として扱う。
9. 文書のフェーズ(design・test-spec・dev-plan・intent-sync)では、`subject.files` の各ファイルの現在の sha256 が記録と等しい。加えて、フェーズごとに期待するファイルが `subject.files` に含まれる。design は run の文書の置き場の `design.md`、dev-plan は `dev-plan.md`、test-spec は `testsDir` 配下の `spec.md` か `cases.md` が 1 件以上である。intent-sync は書き換えるファイルが run ごとに違うので、期待するファイルを照合しない。
10. state に `raguelContract: 2` が無い run(1.1.0 より前に作った run)では、検査の代わりに次の文言で失敗する。

```
codiel: この run は Raguel の記録の形式が古い(raguelContract なし)ため、この版ではゲートを通せない。`codiel-state stop --slug <slug> --reason migrate` で止めてから、`/codiel:run <intent パス>` で同じ intent の新しい try を始める。
```

`<slug>` と `<intent パス>` は state の値に置き換えて出す。

検査 8 の `subject.base` の照合と `paths` の拒否は、範囲を絞ってフェーズの差分の一部だけを評価させる抜け道を塞ぐ。検査 9 の sha256 の照合は、ゲートの後で文書を書き換える抜け道を塞ぎ、期待するファイルの照合は、無関係なファイルを評価させて通す抜け道を塞ぐ。

pass-gate は、通したときの HEAD を `phases.<phase>.passedHead` に記録する(すべてのゲート付きフェーズ。git の管理外では記録しない)。`start-phase` は、`startHead` を記録するときに、直前に passed になったゲート付きフェーズの `passedHead` と今の HEAD を照らす(フェーズの間の連続性)。照らし方は直前のフェーズの種類で変わる。

- code 系フェーズ: 今の HEAD が `passedHead` と等しいことを要る。等しくなければ「評価の後にコミットがある」旨で失敗する。code 系フェーズの pass-gate の後は、次のフェーズの `start-phase` までコミットしない。
- 文書のフェーズ(design・test-spec・dev-plan・intent-sync): `git diff --name-only --no-renames <passedHead> HEAD` の変更が、すべてそのフェーズの `verdict.json` の `subject.files` にあることを要る。名前の変更は移動元と移動先の両方を照らす。外れたら、許されないファイルのパスを挙げて失敗する。評価した文書だけは、ゲート通過の直後にコミットしてよい。
- 同じステージの test-spec と dev-plan は、両方の `subject.files` を合わせて許す。起点は、2 つの `passedHead` のうち、もう一方の祖先であるほう(先に通したほう)にする。

`skip-phase` で通したフェーズは `passedHead` を持たないので、照合しない。

Raguel の側では、`head` が `null` になる場合がある。プロジェクトルートが git の管理外のとき、または最初のコミットが無いリポジトリで文書と判断を評価したときで、索引の `head` と `subject.head` が `null` になる。evaluate_code は HEAD を解決できなければ入力の誤りにするので、code 系フェーズの `subject.head` は `null` にならない。

差分が空のときと、レポートと生成物しかないときも、Raguel は前フェーズの改竄の検証を行う。改竄があれば `casefile/tampered` の STOP にする。変更なしを理由に、改竄の検証を飛ばさない。

関連する `codiel-state` の変更は 3 つある。`mark-ask --kind raguel` は `--evaluation-id` を必須にし、索引の行があり、`runId`・`phase` が合い、`verdict` が `--verdict`(既定 ASK)と等しいことを確かめる。`init` は、同じ slug の最新の try の索引に、judgeStatus が ok の STOP で `false-positive` の裁定を持たないものがあれば `--human-approved` を要る。また `init` は、新しい state に `raguelContract: 2` を記録する。
