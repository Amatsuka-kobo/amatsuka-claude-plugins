# agent-policy SubagentStart 実装後検証（Task 8）起動プロンプト

以下を goal コマンドの入力として使う。事前準備の節にある `.claude/settings.json` への追記を済ませ、セッションを開き直してから渡す。

---

# agent-policy SubagentStart 実装後検証（Task 8）

## 現在地

`plugins/agent-policy` の「外部 Agent へのモデル割当と最適化定義の合成」は実装・コミット済みである（`ede0481`、バージョン 0.13.0-dev、21 ファイル）。残っているのは実装計画の Task 8（実装後検証）だけで、これは `hooks.json` の変更がセッション開始時にしか読まれないため、実装セッションでは実施できなかった。

実装セッションで済んでいること:

- Task 0〜7 完了。lint / typecheck / build 通過、agent-policy のテストは 288 passed
- バンドル出力へ直接 stdin を与える範囲の実測は完了済み。`gpt-sol-lead-implementer` → 注入あり（748 字）、`haiku-reviewer` / `Explore` / `Plan` / `agent-policy:gpt-luna` → 注入なし、`chat-recorder` → 注入あり（847 字、走査対象外の未知 type）
- 全体テストのうち 4 件（codiel 2・metatron 1・sandalphon 1）が 20 秒タイムアウトで落ちるが、agent-policy を除外しても同じ 4 件が落ちるため本改修とは無関係な環境由来のフレーキーと確定済み

## 読む文書

1. 実装計画書 `harness-docs/plans/2026-08-27-agent-policy-external-agent-model-assignment.md` の Task 8
2. 設計書 `harness-docs/design/2026-08-27-agent-policy-external-agent-model-assignment-design.md` の §8（実機検証項目・実測結果）、§5（配布機構）、§1（判定フロー）
3. 実装 `plugins/agent-policy/src/hooks/subagent-start.ts`（照合規則と deny-list）

## 事前準備（未了ならここから）

フック入力の生の形を記録するため、プロジェクトの `.claude/settings.json`（または `settings.local.json`）へ SubagentStart のデバッグフックを追加する。**プラグインの `hooks.json` は触らない。**

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "hooks": [
          { "type": "command", "command": "cat >> /tmp/subagent-start-input.jsonl" }
        ]
      }
    ]
  }
}
```

`cat >> file` は stdin をファイルへ追記して stdout に何も出さず exit 0 で終わるため、agent-policy のフックと併存しても注入を壊さない。

**追加した時点で一度セッションを開き直す。** hooks はセッション開始時にしか読まれない。開き直した後のセッションで以下を実施する。

## 検証項目

### 1. SubagentStart の発火と注入の到達

実装帯の Agent（`gpt-sol-lead-implementer`）を 1 つ dispatch し、依頼文で次を求める。

> あなたに注入された追加コンテキストに「あなたはサブエージェントである」の宣言と役割マーカーの対応表が含まれているか。含まれるなら、対応表の行をそのまま引用して返せ。ファイルは変更せず、報告のみを返せ。

**期待**: 宣言と、10 行の対応表（複雑または重要な実装 / 通常の実装 / 軽量な実装 / その他のタスク / コードベース探索実働 / リアルタイム情報調査 / 設計書・実装計画書の独立レビュー / 設計書・実装計画書のレビュー / コードレビュー / 設計・計画・実装のアドバイザー）が返る。SessionStart がこのセッションへ注入した対応表と同一の内容であること。

### 2. `agent_type` の実表記（設計 §8.6 の残項目）

`/tmp/subagent-start-input.jsonl` を読み、記録された `agent_type` の表記を種別ごとに確認する。カバーすべき種別は 4 つ:

- project 定義（`.claude/agents/` のもの。例: `gpt-sol-lead-implementer`）
- 同梱プリセット（`agent-policy:gpt-terra` 等）
- **他プラグイン定義**（未測。`chat-history:chat-recorder` を 1 回 dispatch するか、Stop hook の自動記録を発火させて記録を得る）
- **ビルトイン**（未確定。`Explore` を 1 回 dispatch する）

**期待**: 設計 §8.6 の実測（project 定義とビルトインは末段のみ = `"gpt-sol-lead-implementer"` / `"general-purpose"`）と整合すること。

**不一致だった場合の対応**:

- ビルトインの実表記が `Explore` / `Plan` 以外（名前空間付き等）だったら、`subagent-start.ts` の `exactMatches` にある builtin 判定を実表記へ追随させる。**テストを先に直してから実装を直す**（`subagent-start.test.ts` の「ビルトイン Explore には注入しない」「ビルトイン Plan には注入しない」）
- 他プラグイン定義が `plugin:name` 形式だった場合、現行実装は完全形で当たらず末段一致へ落ちる。末段が project / 同梱のどれとも衝突しなければ未知 type として注入される（設計どおり）。衝突する場合は複数ヒットで注入側へ倒れる（これも設計どおり）。**実装の変更は不要**だが、実測した形式を報告に残す

### 3. 機械契約 Agent への注入副作用（重要）

`chat-recorder` は走査対象外（他プラグイン定義）のため注入が届く。これは設計 §5 の「過剰配布側に倒す」判断どおりで、確認すべきは**注入されても機械契約が壊れないこと**である。

手順:

1. 通常どおり 1 ターン会話し、Stop hook 経由の chat-recorder 自動記録を発火させる
2. `docs/chat/` の該当ファイルに記録が正常に追記されたことを確認する
3. chat-recorder が記録以外の行動（再委譲・方針スキルのロード）を始めていないことを、そのエージェントの報告内容から確認する
4. `raphael:antibody-synthesizer`（Agent tool を持たない定義）でも同様に確認する。未蒸留 infection があれば Stop hook が起動を促すので、その 1 回で足りる

**期待**: どちらも正常に完走し、注入された規律に引きずられた余計な行動をしない。

**問題が出た場合**: 注入内容が機械契約 Agent の動作を変えたことになる。設計 §5 の過剰配布判断の再検討が要るため、**実装を独断で変えずに事象を報告する**。

### 4. 合成 dispatch の一連（設計 §8.8）

検証用の外部 Agent 定義を `.claude/agents/` へ一時的に置く。条件は次のとおり。

- `agent-policy-role` マーカーを**持たない**（帯参加はしない）
- `model` を宣言しない
- `tools` は `Read, Grep, Glob` のみ
- frontmatter は `name` / `description` / `tools` だけ（適用除外 3 に落ちないこと）
- 本文に、その作業の役割記述と、検証しやすい禁止条項を 1 つ入れる（例:「出力に箇条書きを使わない」）

この定義を名指しで dispatch する前に、共通規律 `plugins/agent-policy/references/orchestration-discipline.md` の §委譲先の実行モデルの確定 の判定フローを上から評価し、どの行で確定するかを記録する。読み取り帯の作業を割り当てれば判定フロー 7（合成）に落ちるはずである。

合成手順どおりに dispatch する:

- ホストは対応表のその帯の定義
- 依頼文の冒頭でホストが担う役割名を明示
- 外部定義の本文（frontmatter より後の全文）を役割定義として同梱
- 外部本文の禁止条項がホスト本文の同種規定より優先することを明記
- 読み取り帯なので「ファイルを変更しない」「報告のみを返す」を重ねる

**期待**: ホストが差し戻さずに作業し、外部本文の禁止条項（箇条書きを使わない等）を守った出力を返す。

続けて、同じ定義に `model: haiku` を足した版でもう 1 ケース実施する。判定フロー 8 に落ち、合成 + `model` param での宣言値適用になる。**期待**: Haiku で実行される（子の応答の粒度、または起動時の表示で確認）。

### 5. アドバイザー再委譲（設計 §8.9）

実装帯（`gpt-sol-lead-implementer`）へ、判断に迷う要素を含む小さな作業を依頼し、依頼文に「判断に迷ったらアドバイザーへ相談せよ」を含める。

**期待**: 注入された対応表の `fable-adviser` が相談先に選ばれる（`Fable` の直指定ではなく、対応表の定義名が使われる）。サブエージェントの報告で相談先を確認する。

### 6. 移行期の運用条件

設計書の「移行期の運用条件」節を読み、本実装で緩和されるのが「子 Agent が親と同じ custom role map を使う前提を置かない」の 1 点のみであることを確認する。残りの条件（custom Agent のトップ階層配置と active policy の marker 明示、`setup-agents --write --merge` 前の `claude mcp list` 正常確認、Agent 名の他 scope・他 plugin との非重複）は、監査所見 1・2 および 4〜11 の修正まで継続する。

## 後片付け（忘れると次セッション以降に影響する）

1. `.claude/settings.json`（または `settings.local.json`）から追加したデバッグフックを削除する
2. `/tmp/subagent-start-input.jsonl` を削除する
3. 検証用に置いた外部 Agent 定義を `.claude/agents/` から削除する
4. 削除後、`git status` で作業ツリーに検証用の残骸が無いことを確認する

## 制約

- 実装（`plugins/agent-policy/src/`）を変えるのは、項目 2 でビルトインの実表記が不一致だった場合だけである。その場合も**テストを先に直してから実装を直す**
- 実装を変えたら `pnpm run build` で `scripts/` を再生成し、`src/` の変更と同じコミットに含める。`scripts/` を手で編集しない
- ブランチを切らない。`git push` に `--force` 系を付けない
- 作業ツリーには本改修と無関係な未コミット変更（`.raphael/` の抗体、`docs/chat/`）がある。revert・削除・上書き・コミット混入のいずれもしない
- フックは常に exit 0 を守る。stdout に注入 JSON 以外を出さない
- 設計で不採用が確定した案（割当マップ・派生定義生成・CLAUDE.md 焼き込み・反転注入・監査所見 1〜2/4〜11 の修正）に手を出さない

## 完了報告に含めること

- 検証項目 1〜6 それぞれの実測結果
- **`agent_type` の実表記**（4 種別すべて）。設計 §8.6 の残項目がこれで閉じる
- **機械契約 Agent への注入副作用の有無**（chat-recorder と raphael の 2 種）
- 合成 dispatch 2 ケース（未宣言 / enum 宣言）の成否と、判定フローのどの行で確定したか
- アドバイザー再委譲で実際に選ばれた相談先
- 実装を追随させた場合は、その差分と lint / typecheck / test / build の結果
- 「移行期の運用条件のうち、本実装で緩和されるのは親子 map 非仮定のみ」の明記
- 残課題（あれば）とその扱いの提案
