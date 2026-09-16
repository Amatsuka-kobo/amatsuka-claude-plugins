# agent-policy setup-agents の MCP deny 保持を安全化する引き継ぎ書

- 日付: 2026-09-17
- 引き継ぎ元: setup-agents 再生成時の deny 消失を調査・復元したセッション
- 引き継ぎ先: deny 保持の挙動を見直し、実装・検証・追随を完了するセッション
- 対象プラグイン: `plugins/agent-policy`(0.19.2-dev)

## 現在地

| 工程 | 状態 |
| --- | --- |
| `disallowedTools` が消える挙動の調査 | **完了**。これはバグではなく、意図的な実装である。確定した事実は §2 を参照する |
| このリポジトリの `.claude/agents/` の復元 | **完了**。`--mcp-deny` を明示して再生成し、読み取り専用の 5 定義にあった Serena 書き込み系ツール 11 個の禁止を戻した |
| `GOTCHA-001` の記録 | **完了**。`harness-docs/GOTCHAS.md` に記録済み |
| plugin 本体の修正 | **未着手**。§3 の方針を選んで実装する |

`--write --merge --mcp-servers` だけで再生成すると、`disallowedTools` を持つ 5 定義からその行が消えた。バックアップとの差分で検知した。復元時に使った `/tmp/agents-backup-20260917-025247` は一時領域にあり、次セッションの根拠には使わない。

## 次セッションが最初にやること

1. `git status` と HEAD を確認する。本件と無関係な未コミット変更は revert・削除・上書き・コミット混入をせず、触らない。
2. `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` を実行して baseline を確認する。
3. §2 のコード、テスト、`GOTCHA-001`、README、setup-agents スキルを開く。
4. §3 の推奨と比較を出発点に修正方針を選ぶ。設計判断を残す文書を新規作成するか既存文書へ追記するかも決める。
5. 実装、テストの意図変更、文書・メモリの追随、`GOTCHA-001` の解決済み化を行い、§4 の完了条件を満たす。

---

## 1. 目的と判断

これはバグではなく、切断済み MCP サーバーの設定を残さないために意図して実装された挙動である。それでも修正する。切断済みサーバーに対応する deny を落とす意図は正当だが、現在の手段は既存 deny をすべて廃棄する。`--mcp-servers` で再び利用可能にしたサーバーの deny まで落とす理由はない。読み取り専用役割の禁止が外れるため、安全側の挙動でもない。

さらに、`--check` は `disallowedTools` を `keysOnlyInExisting` に示す。この表示は `--write --merge` でも保持されると利用者に受け取られ得る。実際には保持されないため、診断も改善対象である。

---

## 2. 調査で確定した事実

- `plugins/agent-policy/src/setup-agents.ts:592-607` の `automaticKeep` は、自動保持の対象から `disallowedTools` を明示的に除外する(特に `:599-601`)。直前では `mcp__` で始まる tools も除外する。コメントは、MCP の付与を `--mcp-servers` と再検証で決め、既存値を根拠に残すと切断済みサーバー名が残るためとしている。
- 同ファイル `:363-378` の `composeInputFor` は、`denyTools` に CLI 引数 `--mcp-deny` だけを渡す(`:377`)。既存ファイルと `mcpCurrent` は参照しない。
- `plugins/agent-policy/src/agents/compose.ts:40-64` の `compose` は、`denyTools` が空なら `disallowedTools` 行を出力しない(`:55-57`)。
- `plugins/agent-policy/src/agents/mcp.ts:87-115` の `mcpCurrentOf` は既存定義から `denyTools` を逆算する(`:114`)。この値は診断だけに使われ、書き込み経路へ渡らない。
- `setup-agents.ts:389-471` の `compare` は `--check` と `--write` が共用する。一方、保持判定の `automaticKeep` は `--write` 専用である。よって `--check` は `keysOnlyInExisting` に `disallowedTools` を出すが、`--write --merge` は保持しない。
- 同ファイル `:613-626` の `discarded` は両方にあり値が異なるキーだけを表示する。既存にしかないキーの廃棄は表示しない。
- `plugins/agent-policy/src/__test__/setup-agents.test.ts:2137-2178` の `it("既存の mcp__ ツールと disallowedTools を保持しない")` は、deny が消える現行挙動を正として固定する。
- deny を保持するテストはない。`--mcp-servers` を指定し、`--mcp-deny` を指定しないときに既存 deny が残ることを確かめるケースもない。
- `--keep key:disallowedTools` を明示すれば、コード上は `disallowedTools` を残せる。このケースのテストはない。

---

## 3. 修正方針の候補

**推奨は A と C の併用である。**A で切断済みサーバーを残さない意図を保ちながら、利用可能なサーバーの deny を安全に残す。C で `--check` と `--write` の保持差による誤認を防ぐ。

### A. 利用可能なサーバーに対応する deny だけを残す

`--mcp-servers` で指定した利用可能なサーバーに対応する既存 deny だけを残す。切断済みサーバーの deny は従来どおり落とす。元の意図を維持しつつ、安全側の挙動へ寄せられる。

### B. 既存 deny を `--mcp-deny` 未指定時の既定値にする

`--mcp-deny` が未指定なら `mcpCurrent.denyTools` を既定値にする。実装は単純だが、切断済みサーバーの deny も残るため、元の意図に反する。

### C. `--check` に保持の可否を示す

`--check` の診断を、各キーが `--write --merge` で保持されるかまで分かる形にする。deny 消失を単独では防げないが、利用者の誤認を防ぐ。A と併用して再発を防ぐ。

どの案を選んでも、現行テスト `setup-agents.test.ts:2137-2178` は書き換える。テストが通らないことを理由に変更を諦めるのではなく、テストが表す意図から変更する。A を選ぶなら、`--mcp-servers` あり・`--mcp-deny` なしでも利用可能なサーバーの既存 deny が残り、切断済みサーバーの deny は落ちることを検証する。C を選ぶなら、診断も検証する。

---

## 4. 完了条件と追随

- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` をすべてパスさせる。
- `src/` を変更するため、`pnpm run build` を実行する。生成された `scripts/` の差分を同じコミットに入れる。
- `plugins/agent-policy/.claude-plugin/plugin.json` と `package.json` のバージョンを揃えて上げる。開始時点は `0.19.2-dev` である。
- `GOTCHA-001` に `[解決済み]` タグを付ける。GOTCHAS を直接編集せず、`node <metatron の CLI> tag-gotcha --id GOTCHA-001 --tag 解決済み --reason "<理由>"` を使う。理由には、採用方針と修正内容を書く。
- 挙動変更を `plugins/agent-policy/README.md` の移行節へ 1 項追加する。
- 手順が変わるなら `plugins/agent-policy/skills/setup-agents/SKILL.md` を追随させる。現行スキルは、denylist を確定してから `--mcp-deny` を渡す手順である。
- 設計判断を記録する。設計書を新規作成するか既存設計書へ追記するかを選ぶ。
- `.serena/memories/agent_policy/core.md` と食い違うなら追随させる。

---

## 5. スコープ外

- このセッションで追加した「文書作成の依頼文に完成文を載せない」規律は完了済みであり、対象外である。
- `.claude/agents/` を git 追跡下に置くかどうかは別の判断であり、対象外である。

---

## 6. 参照

- 実装: `plugins/agent-policy/src/setup-agents.ts:363-378,389-471,592-626`、`plugins/agent-policy/src/agents/compose.ts:40-64`、`plugins/agent-policy/src/agents/mcp.ts:87-115`
- テスト: `plugins/agent-policy/src/__test__/setup-agents.test.ts:2137-2178`
- 記録: `harness-docs/GOTCHAS.md` の `GOTCHA-001`
- 利用者向け文書: `plugins/agent-policy/README.md` の 101 行目付近
- 手順: `plugins/agent-policy/skills/setup-agents/SKILL.md`
