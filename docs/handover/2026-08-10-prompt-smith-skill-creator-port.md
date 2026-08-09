# prompt-smith:skill-creator 移植 引き継ぎ書

- 作成日: 2026-08-10
- ブランチ: `feat/prompt-smith-skill-creator-port`
- 設計書: `docs/design/2026-08-09-prompt-smith-skill-creator-port-design.md`
- 実装計画: `docs/plans/2026-08-09-prompt-smith-skill-creator-port-implementation.md`
- 台帳: `.superpowers/sdd/2026-08-09-prompt-smith-skill-creator-port-implementation/progress.md`

## 1. 何をしている作業か

Anthropic 公式プラグイン `skill-creator` の description 改善ループを TypeScript へ移植し、`prompt-smith` プラグインの独立スキル `skill-creator` として持つ。公式プラグインへの依存を無くす。

## 2. 現在地

Task 14 のうち 12 タスクが完了している。全タスクにレビューを通し、指摘は解消済みか台帳に記録済みである。

| Task | 状態 | コミット |
| --- | --- | --- |
| 1. ライセンス表示とパッケージ基盤 | 完了 | `87d862b` |
| 2. parse-skill-md | 完了 | `aca1097` |
| 3. 発火判定の状態機械 | 完了 | `0ca02c8` |
| 4. サンドボックスの構築 | 完了(修正 1 回) | `eccd3ed` |
| 5. 発火測定 CLI とビルド | 完了(修正 1 回) | `32a6571` |
| 6. 層化分割 | 完了 | `23f1f03` |
| 7. description の改善 | 完了 | `57853b5` |
| 8. 反復ループ | 完了(修正 1 回) | `3b21194` |
| 9. HTML レポートと配線 | 完了(修正 1 回) | `a1f828e` |
| 10. eval レビュー UI | 完了 | `4f7f6a6` |
| 11. skill-creator スキル本文 | 完了 | `1d7ff71` |
| 12. 経路の付け替え | 完了 | `4ead088` |
| 13. eval セットと自己適用 | **eval セットの作成と承認まで完了** | `fbba09d` |
| 14. 文書と抗体の更新 | **未着手** | — |

検証の状態: `pnpm exec vitest run plugins/prompt-smith` が 88 件 PASS。`pnpm build` / `pnpm typecheck` / `pnpm lint` すべて成功。

## 3. 残っている作業

### 3.1 Task 13 の続き — 改善ループの実行

eval セットは 3 本ともユーザーの承認済みで、`plugins/prompt-smith/evals/` にコミット済みである。各 20 問(true 10 / false 10)。

残るのは、3 本の改善ループを回して `best_description` を各 SKILL.md へ適用することである。

```
node plugins/prompt-smith/scripts/run-loop.mjs \
  --eval-set plugins/prompt-smith/evals/skill-creator.json \
  --skill-path plugins/prompt-smith/skills/skill-creator \
  --model claude-opus-5 \
  --max-iterations 5 --verbose
```

`prompt-smith` と `agent-creator` についても同様に回す。**1 本あたり数十分かかる。**

回した後に確かめること。

- ループが完走し、`best_description` と `best_score` が返る
- 3 本とも `environment` の `base_url` と `auth_source` が一致している
- 全問が発火 0 で返ったときは description ではなくタイムアウトを疑い、`--timeout 120` で測り直す

`best_score` が現行の description を下回ったときは、適用するかどうかをユーザーに諮る。

### 3.2 Task 14 — 文書と抗体の更新

実装計画の Task 14 に手順がある。**特に急ぐのは抗体である**(§5 を参照)。

- `plugins/prompt-smith/README.md` の新設
- ルート `README.md` への反映
- 抗体 `ab-2026-0802-001` の本文の書き換え
- `grep -rn "optimize-agents/scripts"` が 0 件になることの確認
- `pnpm build && pnpm test && pnpm typecheck && pnpm lint` の通し実行

### 3.3 最終レビュー

SDD の手順では、全タスク完了後にブランチ全体のレビューを 1 回行う。台帳の deferred minor 22 件をレビュアーに渡し、マージ前に直すべきものを選別させる。

## 4. これを知らないと同じ失敗をする

### 4.1 移植の理由は「登録先」ではない

**設計の初版は診断を誤っていた。** 当初は「公式の `run_eval.py` は測定対象を `.claude/commands/` へ登録するので自然文の依頼から発火しない」としていたが、2026-08-09 の対照実験でこれは否定された。

条件を揃えた一時ディレクトリで `.claude/skills/` と `.claude/commands/` の両方に同じ SKILL.md を置いて測った結果、**両経路とも 10/24 で差が出なかった**。公式ドキュメントも `commands/deploy.md` と `skills/deploy/SKILL.md` について "Both can be auto-invoked by Claude" と明記している。

移植が必要な理由は別の 2 点である。

1. `find_project_root()` が**実リポジトリのルートを cwd にする**。このリポジトリで走らせると 45 のプロジェクトスキルが同席し、スコアは description の質ではなく手元のカタログとの競争結果になる
2. 本文を捨てた **description だけの薄いファイル**を測定対象にする。本番の SKILL.md とは別物を測っている

抗体 `ab-2026-0802-001` が記録する 2026-08-01 の実測(登録先を変えると 1/8 → 8/8)は、**登録先と cwd の 2 変数が同時に変わった交絡した比較**である。旧測定器は一時ディレクトリを cwd にしていた(`git show 239f2a3^:plugins/optimize-agents/scripts/run-trigger-eval.mjs` の 93 行と 117 行)。効いていたのは cwd の方だったと読むのが自然である。

### 4.2 抗体 `ab-2026-0802-001` が誤った規律を注入し続けている

現在この抗体は、毎セッション「`run_eval.py` は登録先が `.claude/commands/` なので発火を検出できない」と注入する。**この主張は上記のとおり否定されている。**

Task 14 で本文を書き換える。ユーザーの承認は取得済みである。書き換える内容は実装計画の Task 14 Step 3 にある。手で `.raphael/antibodies/*.md` を編集せず、`node plugins/raphael/scripts/update-antibody.mjs patch ab-2026-0802-001` を使う。

### 4.3 バンドル CLI の自己起動は出力ファイル名に依存する

`run-loop.ts` は `improve-description.js` と `run-trigger-eval.js` を静的に import する。esbuild が 1 ファイルにまとめると `import.meta.url` が 3 つとも同じになるため、自己起動のガードが同時に真になる。**正しい引数で成功しても終了コードが 1 になる**という実害が出た。

現在は `isDirectRun(expected)` がエントリファイル名で判定している。**`build.ts` の entry 名を変えるときは、対応する `isDirectRun("...")` も同時に変える。** `src/__test__/bundle-cli-smoke.test.ts` がこれを守っている。

### 4.4 GPT 系のサブエージェントは Markdown の報告書を作れない

`gpt-sol` / `gpt-terra` は定義上、報告用の Markdown ファイルを作成できない。SDD の実装報告はレビュアーが読む契約なので、**依頼文で「報告書の中身を最終メッセージにそのまま書いて返す」よう指示し、オーケストレーターがファイルへ転記する**。台帳の隣にある `task-N-report.md` のうち、転記であるものは冒頭にその旨を書いてある。

### 4.5 `.superpowers/` は git 管理外

台帳 `progress.md` だけを `git add -f` で例外的に追跡に入れてある。ブリーフ・実装報告・review の diff は追跡していない。別マシンで作業を再開する場合、それらは手元に無い。

## 5. 決定済みの事項

| 事項 | 決定 | 日付 |
| --- | --- | --- |
| 実行系 | 公式プラグインへの依存を無くし、改善ループを全面移植する | 2026-08-09 |
| 移植の言語 | TypeScript | 2026-08-09 |
| eval セット | skill-creator が生成するものと完全に同一の形式 | 2026-08-09 |
| 出力の評価 | 測定器は作らないが、手作業の手順として本文に書く | 2026-08-09 |
| packaging | 対象外。`package_skill.py` は移植しない | 2026-08-09 |
| `description-guide.md` の扱い | 共通の基準だけを持つ。skill 固有は `skill-creator` の本文、Agents 固有は `agent-creator` の本文へ移す | 2026-08-10 |
| 前提の訂正 | 移植は続け、登録先ではなく cwd 汚染と薄いファイルを理由として書き直す | 2026-08-10 |
| 抗体 | 本文を実測に合わせて書き換える | 2026-08-10 |
| eval セット | 起草した 3 本をそのまま承認 | 2026-08-10 |
| 「explain the why」 | **放置する。** 公式 `skill-creator` の Writing Style と `prompt-smith` の「根拠は削り指示だけ残す」は方向が逆で、後者を優先する | 2026-08-10 |
| タグ無し応答のフォールバック | **移植元どおりのままとする。** `<new_description>` が無い応答は全文を採用する | 2026-08-10 |

## 6. 観測した異常(未解決だが判断済み)

Task 9 の実地確認で、`improve-description` の `claude -p` が eval と無関係な日本語テキストを返し、`<new_description>` タグも無かったため全文が新 description として採用された。多数のサブエージェントが並行していた時間帯である。

翌日の健全性確認では `claude -p` は正常に応答した(`PONG`)。一過性と判断し、フォールバックは移植元どおりのままとする決定をユーザーから得ている。

ループの最良選択は正しく機能し、スコアの下がった反復は棄却された。**改善ループが機能する限り、この種の異常は結果に残らない。**

## 7. 作業の再開手順

```
git checkout feat/prompt-smith-skill-creator-port
cat .superpowers/sdd/2026-08-09-prompt-smith-skill-creator-port-implementation/progress.md
```

台帳の末尾が現在地である。`Task N: complete` の行があるタスクは完了している。

実装計画の Task 13 の Step 3 から再開する。
