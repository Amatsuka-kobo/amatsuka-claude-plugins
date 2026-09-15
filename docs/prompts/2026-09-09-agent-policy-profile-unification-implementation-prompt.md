# agent-policy プロファイル統合 実装セッション起動プロンプト

以下を /goal コマンドの入力として使う。

---

agent-policy プラグインのプロファイル統合を、承認済みの設計書と実装計画書に従って実装まで完遂する。

## 入力文書

1. 実装計画書(正本): `harness-docs/plans/2026-09-09-agent-policy-profile-unification-implementation.md`(第 2 版)— タスク分割・順序・依頼文の生成規則・検証方法・Done 条件
2. 設計書(正本): `harness-docs/design/2026-09-09-agent-policy-profile-unification-design.md`(第 2 版)— 各変更の「変更前」「変更後」と根拠。§1 が旧決定の上書きを記録している
3. context-map: `.claude/context-maps/2026-09-09-subagent-discipline-removal.md`(第 2 版)

両文書は 3 本のレビューとユーザー承認を経た確定版である。**設計判断を問い返さず、記述を正として実装する。** 文書と実物が食い違う事実を見つけたときだけ、実装を止めてユーザーへ報告する。

## 進め方

- 実装は **Workflow ツール(Dynamic Workflow)** で行う。スクリプトを書く前に `workflow-authoring` スキルをロードする。
- フェーズは計画書のフェーズ 0〜8 に対応させる。完了条件は計画書 §2 にある。
- **フェーズ境界はすべて緑である。赤はタスク内部に閉じている。境界で緑にならなければ止めて報告する。**
- 並列に投げられる組は計画書 §2 と §3 にある。**それ以外を勝手に並列化しない。**
- **依頼文は計画書 §1 の生成規則 7 項目を守って書く。** 特に §6「想定される失敗と対策」のうち、そのタスクの ID が挙がっている行を必ず転記する。**実装担当は設計書の全文を読まない前提で書く。**
- 担当役割は計画書 §4 にある。スキルをロードするタスクを「軽量な実装」へ割り当てない。
- 着手時に baseline を記録する。計画書 §0.1 に従い **staged / unstaged / 未追跡の 3 分割**で取る。
- **`discipline-role-table.test.ts` が 8 件失敗している。原因は 2 段で、見出しの `## 役割` → `## 担当表` の改名と、担当表の区切り行の整形である。見出しの正規表現だけを直しても緑にならない。** フェーズ 0(T1)で両方を直し、緑から始める。
- 各タスクはテストを先に書いてから実装する。

### T7 は分割しない

11 行の CLI 改修に、既存 42 ケース(39 宣言)の scope 前提の棚卸しが乗る。`--scope` が無い状態で `--scope custom` を先に足すとエラーになり、CLI 実装を先に入れると 42 ケースが赤になる。緑 → 緑の切れ目が無いため 1 タスクに閉じる。棚卸しは `--scope custom` を足す機械的作業で判断を伴わない。対象一覧は計画書 §2 フェーズ 4 にある。**実行時間が長いのでタイムアウトに注意する。**

### 実機検証(T18)

新しいセッションを開く必要があり、Workflow のサブエージェントからは開けない可能性がある。**実行手段が無いときは、ユニットテストや復唱結果で代替完了にせず、該当 Done(#26 / #28 / #29)を未検証として報告する。** 検証できたときは、プラグインのパス・`plugin.json` の `version`・環境変数の値を証拠に添える(計画書 §5.6)。

## 制約

- **未コミット差分を revert しない。** `references/orchestration-discipline.md`、`skills/claude-model-policy/SKILL.md`、`skills/custom-policy/SKILL.md` の差分は本改修の前提である(計画書 §0.3)。他ディレクトリ(`docs/chat/` など)の無関係な差分と未追跡ファイルにも触らない。
- `plugins/*/scripts/` と `dist/` は手で編集しない。`src/` を変更し `pnpm run build` で再生成して同じコミットに含める。
- **ルートの build は `pnpm -r build` で全 workspace が対象である。build 後はリポジトリ全体を baseline と比較し、許可対象外の新規差分を検出する。**
- コミットは計画書の変更一覧にあるパスだけを明示指定する。**`git add -A` と `git add .` を使わない。**
- **`.serena/memories/` は Serena の `write_memory` / `edit_memory` で、ARCHITECTURE は metatron の CLI で更新する。どちらも直接編集せず、オーケストレーター自身が行う**(T20)。
- ブランチを切らない。必要なら git worktree を使う。`git push` に `--force` 系を付けない。
- Anthropic API のクライアントを追加しない。`ANTHROPIC_API_KEY` を前提にしない。
- フックは fail-open(例外時 stderr + exit 0、ファイルを書かない)を維持する。deny-list と `NO_MARKERS` の文言も変えない。
- 指示書の改稿は `prompt-smith` 系を使う(タスクごとの指定は計画書 §2)。**評価工程は回さない。設計書が決めた文面が書き換わる。**
- バージョンは `0.17.1-dev` → `0.18.0-dev`。`plugin.json` と `package.json` を揃える。
- **設計書 §11 の不採用案に手を出さない。** 次の 2 件をバグと判断して直そうとしない。custom フォールバック時に SessionStart と SubagentStart の候補範囲が食い違うのは、SubagentStart が環境変数しか見られないための**既知の受容**である(設計書 §10 リスク 4)。`none` 構成でサブエージェントへ規律が届かなくなるのは**意図的な縮退**である(同 リスク 12)。

## Done 条件

**計画書 §7 の 31 項目**を満たす。確認者と手段も同表にある。特に次を落とさない。

- `pnpm run lint` / `typecheck` / `test` / `build` が通り、**テストは 0 failed**。
- **リポジトリ全体**で、baseline に無い差分が計画書の変更一覧に収まっている。
- `.serena/memories/agent_policy/core.md` と ARCHITECTURE の追随が済んでいる。

完了報告に、フェーズ 0〜8 の完了状況、lint / typecheck / test / build の最終結果、未検証として残した Done の番号と理由、T17 の指摘と採否を含める。
