# setup-agents の --merge が役割変更後の不要ツール・不要節を落とせない 引き継ぎ書

- 日付: 2026-09-26
- 引き継ぎ元: 運用セッション(原因調査は完了、設計判断は未確定、実装は未着手)
- 引き継ぎ先: 設計・実装セッション
- 対象プラグイン: `plugins/agent-policy`

## 現在地

| 工程 | 状態 |
| --- | --- |
| 事象の再現 | **完了**。本セッションで実際に踏んだ |
| 原因の特定 | **完了**。該当コードの行まで特定済み |
| 設計判断 | **未確定**。選択肢は 3 案あるが決定していない |
| 設計書・実装計画書 | **無し**。規模からいって正式な設計書が要るかは実装セッションの判断に委ねる |
| 実装 | **未着手** |
| テスト | 既存の `describe("automaticKeep", ...)` はこの問題を検知しない(後述) |

## 事象

`agent-policy:setup-agents` の CLI で、既存の Agent 定義から `--roles` を削減して `--write --merge` を実行すると、削除した役割が使っていたツールと本文の節が、`--merge` では絶対に落ちない。

再現した操作(このリポジトリの `.claude/agents/complex-reviewer.md` で発生):

1. `complex-reviewer.md` は当初 `agent-policy-role: e2e-verify, final-review, gate-review` の 3 役割を持ち、`e2e-verify`(impl 役割)のために `tools` に `Write, Edit, Skill, Agent` を含んでいた。
2. `e2e-verify` を専用の新規定義へ切り出すため、`--roles final-review,gate-review` を指定して `--write --merge ...` を実行した。
3. 結果、`agent-policy-role` は正しく `final-review, gate-review` に変わったが、`tools` の `Write, Edit, Skill, Agent` と本文の「## アドバイザーへの相談」節(Agent tool 保有時にだけ合成される断片)は残った。
4. `--keep "section:## アドバイザーへの相談"` を明示指定しても、`tools:Write` 等は相変わらず残った(`--keep` を絞り込みには使えない)。
5. 唯一効いた回避策は `--merge` を外した完全上書き(`--write` のみ)。この場合は ツールも節も両方消え、望んだ状態になった。ただし完全上書きは、ユーザーが本当に手で加えた独自の節やツールも無差別に失う。

## 原因の特定

`plugins/agent-policy/src/setup-agents.ts` の `write()` 関数(623〜653行)。

```
const selectors = unique([
  ...(exists && options.merge ? automaticKeep(difference) : []),
  ...options.keep
])
```
(631〜634行)

`--merge` かつ既存ファイルがあるとき、`automaticKeep(difference)`(582〜597行)の戻り値が無条件で保持セレクタに加わる。`automaticKeep` は次を保持リストに入れる。

- `toolsOnlyInExisting` のうち `mcp__` 以外全部
- `keysOnlyInExisting` のうち `disallowedTools` 以外全部
- `sectionsOnlyInExisting` 全部

`--keep` は `options.keep` として同じ配列に**追加**されるだけで、`automaticKeep` の結果を絞り込む・除外する手段が無い(`parseKeep` 自体は selector を集合に変換するだけで、除外指定の構文を持たない)。

MCP 系(`mcp__*` ツールと `disallowedTools`)だけ自動保持から除外されているのは GOTCHA-001 の対応が入っているため(587行・591行のコメント参照)。今回踏んだのは、その対応が及んでいない非 MCP のツール・節・フロントマターキーの経路である。

## 検討した設計選択肢(未確定・要判断)

1. **役割由来かどうかを区別して自動保持から除外する。** 各 roleId が要求するツール一覧は `--list-roles` の出力(`kind`・`tools`)としてすでに CLI 内部にある。既存ファイルの `agent-policy-role`(旧 roles)と今回の `--roles`(新 roles)を突き合わせ、「旧 roles だけが要求していたツール・節」は自動保持しない。ユーザーが独自に加えたものは、どの roleId にも属さないので保持され続ける。実装コストは中。
2. **`automaticKeep` を廃止し opt-in 化する。** 保持は `--keep` で明示したものだけにする。デフォルトの安全策(うっかり消さない)を失うので、GOTCHA-001 相当の事故が非 MCP 項目でも起きやすくなる。
3. **`--keep` に除外方向の構文を追加する(例: `--drop tools:Write`)。** `automaticKeep` はそのままに、ユーザーが個別に取り消せるようにする。構文とドキュメントの追加が要る。

3 案とも一長一短があり、`setup-agents` スキル本文(`skills/setup-agents/SKILL.md`)側の「差分方針は保持マージ、選択した項目の保持、完全上書き、スキップから尋ねる」という運用と整合するかも合わせて検討すること。特に案1は「役割由来の断片」をコードから機械的に判定できる保証が要る(テンプレート合成ロジックが roleId ごとに閉じているかを先に確認する)。

## テストの現状

`plugins/agent-policy/src/__test__/setup-agents.test.ts:2226` の `describe("automaticKeep", ...)` は「既存の mcp__ ツールと disallowedTools を保持しない」ことだけを検証している。非 MCP のツール・節を無条件保持する挙動を仕様として固定するテストは無い。修正時は、この describe ブロックに「roles を削減したら不要なツール・節を保持しない」ケースを追加すること。

## 実装時に踏みやすい点

- `.claude/agents/` はこのリポジトリで git 未追跡。現在の 15 定義(`e2e-tester` を含む)は実例として手元にあるので、修正の動作確認にそのまま使える。
- disallowedTools・mcp__ 系の除外(GOTCHA-001 対応)は正しく動いている。この部分の挙動は変えない。
- `merge()` 関数(534〜580行)自体は `keep` に渡された内容をそのまま反映するだけで、`keep` の組み立て(`write()` の631〜634行)側に問題がある。関数の呼び分けを混同しないこと。
- 修正後は `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` のバージョンをパッチで上げ、`pnpm run build` で `plugins/agent-policy/scripts/setup-agents.mjs` を再生成し、同じコミットに含める。
- 修正が入ったら GOTCHAS への記録(`metatron:recording-gotchas`)を検討する。GOTCHA-001 と対になる事例になる。

## スコープ外

- 今回の運用で生成した `.claude/agents/` の 15 定義自体の役割・モデル割当の見直し(確定済み、対象外)。
- `--keep` の selector 構文(`<kind>:<value>`)自体の変更は必須ではない。

## 参照

- 該当コード: `plugins/agent-policy/src/setup-agents.ts`(`merge` 534行、`automaticKeep` 582行、`write` 623行)
- 既存テスト: `plugins/agent-policy/src/__test__/setup-agents.test.ts:2226`
- GOTCHA-001: `harness-docs/GOTCHAS.md`(全文は `node plugins/metatron/scripts/metatron.mjs get gotchas --query GOTCHA-001`)
- 今回の運用記録: `docs/chat/2026/0926/phyllis998/2224-agent-definition-role-validation.md`
