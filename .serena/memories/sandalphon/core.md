`plugins/sandalphon` (0.1.1-dev) — **Issue が生まれる前の上流区間**(願い → intent 文書 →
起票 → 実行系への引き渡し)を担うオーケストレーター。2026-08-16 新規追加(commit 9a121c6)。
codiel の**前段**であり置き換えではない。書式の正本は `mem:file_contract`。
設計根拠は `plugins/sandalphon/docs/rationale.md`。

成果物は `docs/intents/YYYY-MM-DD-<slug>.md` の intent 文書(ASIS / TOBE / 受け入れ基準 /
実装方針 / 合意済み事項 / 非スコープ / 未確定事項)。**コミットせず作業ツリーに残す。**
issue はその派生物。

## 3 フェーズ = 3 スキル

```
Phase 1  capturing-intent    TOBE ヒアリング → ASIS 探索 → 分岐の合意 → intent 文書ドラフト
                             ★ ゲート 1: intent 文書の承認 → docs/intents/ へ保存
Phase 2  bridging-execution  起票可否の判定 → 実行経路の質問(1 回) → issue 起票 → 引き渡し
Phase 3  executing-intent    テスト仕様(基盤が無ければ手動検証手順)の作成
                             ★ ゲート 2: ケース一覧・実行コマンド・作業ブランチの承認
                             → TDD 実装 → ドキュメント更新 → 報告
```

- command 1: `/sandalphon:run [やりたいこと | 既存 intent 文書のパス]`。**hooks も agents も持たない。**
- 3 スキルはいずれも `references/sandalphon-common.md` を**併読する**(共通規律の正本)。
  他に `references/intent-format.md` / `handoff-contract.md`。`evals/` に 3 本の JSON。

## 承認ゲートは 2 点だけ

「取り消しコストが跳ね上がる直前」にのみ置く、が基準。ゲート 2 を過ぎたら自律実行するが、
secrets への接触・DB マイグレーション・破壊的操作・依存パッケージの追加は承認後でも都度確認する。

**issue の起票はゲートとは別に必ず承認を取る。** 外部公開行為なので本文を全文提示し明示承認を得る。
**この承認は環境がどれだけ縮退しても省略されない。**

基本方針: **経路の選択はグレースフルデグラデーション、承認はフェイルクローズド。**
使えない経路は選択肢に出さず理由を 1 行添えて畳む(エラーで止めない)。
**経路の欠落を承認の省略に流用しない。**

## `scripts/check-intent-env.mjs`(`src/check-intent-env.ts`)

- **判断を持たない。** STOP するか・どの経路を畳むかはスキル側の責務。常に exit 0 で事実 JSON のみ返す。
- **読み取り専用。** ファイル・ディレクトリの作成も更新もしない。`docs/intents/` の作成も
  intent 文書の `status` 更新もスキルの責務(検出のたびに副作用が出るのを避けるため)。
- 最初のフェーズで 1 回だけ実行し、得た JSON を後続フェーズで使い回す。
- `configWarnings` は**設定由来と文書構造由来の両方**を返す唯一の口である(既定値へ落とした理由に
  加え、`metatron:domains` の重複ブロック・未閉フェンス・マーカーを呑み込む未閉フェンスの警告)。
  3 者比較では metatron の `loadConfig().warnings` + `extractDomains().warnings` の合計と照合する。
- **3 つのルート基準を使い分ける。どれか 1 つに寄せない。**

| 対象 | 基準 | 起点 | フィールド |
| --- | --- | --- | --- |
| intent 文書 (`docs/intents/`) | git ルート | `startDir`(realpath 化) | `repoRoot` |
| ARCHITECTURE / GOTCHAS | 契約 §3 の `docRoot` | `startDir`(realpath 化) | `docRoot` / `projectDocs` |
| `.codiel/` の有無と `runDirs` | 上方向探索 | **`logicalStartDir`(realpath 化しない)** | `codielHarness.codielRoot` |

3 者が別ディレクトリを指すのは**正常な状態**。`.codiel` の探索を `docRoot` 直下に限定すると、
`repo/.codiel` + `repo/sub/metatron.config.json` の構成で codiel は動くのに sandalphon が
「無い」と判定し、正当な委譲経路を塞ぐ。

**`.codiel` だけ realpath 化しない理由(知らずに揃えると壊す)。** 同一ファイル内で 2 つの
前処理を持つのは意図的で、それぞれ**合わせる相手が違う**。
`docRoot` / git は契約 §3 規則 1 の細目が realpath を要求する — 段 2 の
`git rev-parse --show-toplevel` が実体パスを返すため、揃えないと 3 実装の docRoot が割れる。
`.codiel` が合わせる相手は codiel の `findProjectRoot` であり、**それは渡された論理パスを
そのまま上方向へ辿る**。ここで実体パスへ寄せると、`/tmp/link → /repo/sub` で `/repo/.codiel`
がある構成で sandalphon だけが `.codiel` を見つけ、「委譲できる」と案内した先で codiel が
run 資産を発見できない。合わせる先は codiel であって実体パスではない。
(回帰テストは `src/__test__/check-intent-env.test.ts` の「契約 §3」群。link が `.codiel` 保有
ディレクトリ自身を指す場合と、その子を指す場合の両方で `findProjectRoot` と一致を要求する。)

## 状態永続機構を持たない(意図的な決定)

`.codiel/` 相当の state 機構を持ち込むと sandalphon は「小さい Codiel」に育ち、状態遷移の検証・
不整合の修復・再開時の整合確認が芋づるで必要になる。いずれも intent を固定する価値に寄与しない。

- 再開は `/sandalphon:run <intent 文書のパス>` を渡す形で行う。intent 文書は承認済みの合意そのもので、
  セッションの中間状態より価値が高く寿命も長い。
- **再開の粒度はフェーズ単位で、中間状態は復元されない**(Phase 2 の途中で一部だけ起票済み、
  Phase 3 で 3 件中 1 件だけ実装済み、などは復元されない)。中間状態の復元が要る規模は Codiel 委譲が適する。

## プラグイン導入の有無をスクリプトで検出しない

`~/.claude/plugins/installed_plugins.json` は内部形式で、`--plugin-dir` や `enabledPlugins` を
反映しない。知りたいのは「導入されているか」ではなく「**このセッションで実際に呼べるか**」なので、
検出は二段構えにする。

- 呼べるか(プラグイン・MCP): スキル本文が「自分の利用可能なスキル・コマンド・ツールの一覧を
  確認する」と指示する。Raguel MCP の可用性(`mcp__raguel__*` の有無)も同じ手法。
- 対象プロジェクトが受け入れ可能か: ファイルシステムの事実なので `check-intent-env.mjs` が決定的に返す。

## 連携

- 起票は gh-utility `issue-craft` の**持ち込みモード**へ委譲(本文は sandalphon が組み立て、
  `issue-craft` は改変せず起票)。`issue-craft` が無ければ自前で `gh issue create --body-file`。
- Codiel 委譲は `/codiel:run <番号>` を提示して**そこでセッションを終える**(引き渡し先は新セッション推奨。
  文脈は issue に外部化済み)。`/codiel:run` は issue 番号を取るため**委譲を選ぶなら起票が必須**。
  ハーネス未初期化なら委譲を選択肢に出さず初期化コマンドを 1 行案内する。Raguel 未接続は
  選択肢を出したうえで注記する(新セッションでは接続済みかもしれないため)。
- **契約 §13 のケース 16f 3 者比較テストはここにある**
  (`src/__test__/check-intent-env.test.ts`)。詳細と削除禁止の理由は `mem:file_contract`。
