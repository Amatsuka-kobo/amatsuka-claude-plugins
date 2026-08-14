# issue-split スキル 設計

task-utility プラグインに、既存の GitHub Issue をタスク分解して子 Issue を作成するスキル `issue-split` を追加する。基本方針・挙動は issue-craft スキルに倣い、ユーザーとのディスカッションで内容を練り上げる。

## 決定事項

| 論点 | 決定 |
| --- | --- |
| スキル名 | `issue-split`(issue-craft と対になる命名) |
| 親子の表現 | GitHub 公式の Sub-issues 機能でリンクする |
| 入力 | 既存 Issue の番号または URL をユーザーが指定 |
| 分解の進め方 | 親 Issue を読んだら AI がまず分解たたき台を提示し、それを叩き台にディスカッション |
| 子 Issue 本文 | タスク型の軽量本文(目的・完了条件・親への参照)。分解設計の合意に重点を置く |
| 親 Issue 本文 | 更新しない(Sub-issues リンクのみで完結。副作用がなく他人の親 Issue でも安全) |
| 操作手段 | GitHub 操作系 MCP Tool を優先し、なければ `gh` にフォールバック(issue-craft と同じ構造) |

## 配置と構成物

```
plugins/task-utility/
├── skills/issue-split/SKILL.md          # 新規: スキル本体
├── scripts/link-sub-issue.mjs           # 新規: Sub-issues リンク用スクリプト(gh フォールバック時のみ使用)
├── scripts/link-sub-issue.test.mjs      # 新規: 上のテスト(node --test)
└── scripts/check-issue-env.mjs          # 既存を再利用(変更なし)
```

- `.claude-plugins/plugin.json` のバージョンを `1.1.0-dev` → `1.2.0-dev` に上げる(マイナー更新の範囲)
- `README.md` に issue-split の節を追記する

## スキルのフロー(SKILL.md の骨子)

issue-craft と同じ大原則を踏襲する:

- ディスカッションはユーザーが使用する言語を厳守する
- ユーザーの明示的な承認を得るまで起票しない
- STOP するときは必ず「理由+次にユーザーがすべきこと」を伝えて終了する

手順:

1. **環境チェック** — `check-issue-env.mjs` を実行。git リポジトリでない / GitHub リモートなしなら STOP(issue-craft と同一)。
2. **操作手段の決定** — GitHub 操作系 MCP Tool(Issue 作成 + Sub-issue リンクの両方ができるもの)があればそれを優先。なければ `gh`(未導入/未認証なら案内して STOP)。Issue 作成だけできる MCP Tool の場合は、作成は MCP・リンクは `link-sub-issue.mjs` の併用とする(スクリプトは gh を使うため、この併用は gh が使える場合のみ。gh も使えなければ Sub-issues リンクを張れない旨を説明して STOP)。
3. **親 Issue の取得** — ユーザー指定の番号/URL から本文・タイトル・既存の Sub-issues を読み取る。存在しなければ STOP。既に Sub-issues がある場合はその旨を伝えて続行確認する。
4. **最初の確認(1 回の質問にまとめる)** — Issue 本文の言語(リポジトリから推定して推奨提示)。テンプレートは子がタスク型軽量本文なので「使わない」を推奨としつつ、`blankIssuesEnabled: false` のリポジトリではテンプレート選択を必須にする。
5. **分解たたき台の提示 → ディスカッション** — AI がまず分解案(各子のタイトル+スコープ 1 行+依存関係)を提示し、対話で修正する。分解の適切さの目安(独立してクローズできる / 粒度が揃っている / 親の完了条件を子の合計がカバーする)をスキル内にチェックリストとして持つ。
6. **全ドラフト一覧提示 → 一括承認** — 各子 Issue のタイトル・軽量本文(目的 / 完了条件 / `Parent: #親番号`)・ラベル案を一覧で提示し、一括で承認を得る(「2 番だけ直して」のような個別修正に対応)。ラベルはリポジトリの既存ラベルから提案し、存在しないラベルを勝手に作らない。
7. **起票 + リンク** — 子を順に作成し、作成のたびに Sub-issue リンクを張る。全件完了で子 Issue の URL 一覧+親 Issue の URL を報告する。親本文は更新しない。
8. **途中失敗時** — どこまで作成/リンク済みかを報告して停止。ロールバックしない。生のエラーをそのまま報告し、勝手なリトライや代替手段への切り替えをしない(issue-craft と同一)。

## link-sub-issue.mjs の仕様

gh フォールバック時の Sub-issues リンクは REST API の 2 ステップで型ミスが起きやすいため、スクリプトに閉じ込める。リポジトリの設計方針「事実はスクリプト・判断はスキル」に従い、成否の JSON を返すだけで STOP 判断はスキル側が行う。

```
使い方: node link-sub-issue.mjs <owner/repo> <親番号> <子番号>
```

- 内部処理: `gh api repos/{slug}/issues/{子番号}` で子 Issue の内部 ID(`.id`)を取得 → `gh api -X POST repos/{slug}/issues/{親番号}/sub_issues -F sub_issue_id=<数値>` で親にリンク
- `sub_issue_id` は Issue「番号」ではなく内部「ID」。数値型で送る必要があるため `-F`(型付きフィールド)を使う — この 2 つがスクリプト化で守られる不変条件
- 成功/失敗を JSON で stdout に返す。Sub-issues API が使えない環境(古い GHES 等)ではエラーをそのまま JSON に載せて返し、スキルは生エラーを報告して停止する
- テストは `node --test` で実行できる形にする(gh のモック、または引数検証・出力形式の単体テスト)

## issue-craft との棲み分け

- **issue-craft**: ゼロから Issue を練って起票する(単一/複数)
- **issue-split**: 既存の親 Issue を分解して子 Issue を起票し、Sub-issues でリンクする
- issue-craft 側の変更はなし(SKILL.md の description で相互に言及するかは実装時に判断)

## 制約(リポジトリ方針の再確認)

- Anthropic API を直接使う実装は採用しない(LLM 処理は Claude Code の機構に閉じる)
- スクリプトは常に exit 0 で JSON を stdout に返し、判断はスキル側が行う(check-issue-env.mjs と同じ方針)

## テスト

```bash
node --test plugins/task-utility/scripts/link-sub-issue.test.mjs
```

既存のテストコマンド(README の「動作確認」)に link-sub-issue.test.mjs を追加する。
