# agent-policy context-map 共有モデル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 確定設計 v4 の「圧縮 × チェックポイント・宣言的規則」モデルを agent-policy の guide・2つの SKILL・テンプレートへ反映し、論点メモとプラグイン版を更新する。

**Architecture:** `plugins/agent-policy/references/context-map-guide.md` を共有モデルの唯一の定義元(source of truth)とし、所在通知・読む深さ・蒸留・上流要約・3チェックポイントをそこへ集約する。2つの SKILL は順番付きフローを4つの独立した事前条件へ置換し、テンプレートは上流報告先と guide 参照だけを保持する。設計根拠は `docs/design/2026-07-20-agent-policy-context-map-sharing-design.md:54-117,130-169`。

**Tech Stack:** Markdown、JSON、POSIX shell utilities(`grep` / `git`)、Python 3(不変節の機械比較と JSON 検証)

## Global Constraints

- 作業ディレクトリは `/home/hiro0209/amatsuka-kobo/amatsuka-claude-plugins`。以下のパスはリポジトリルートからの相対パス。
- `docs/chat/**` は読まない・変更しない。
- Anthropic API クライアント・`ANTHROPIC_API_KEY` 前提・ユーザーによる CLI 直接操作を追加しない。
- 共有モデルの唯一の定義元は `plugins/agent-policy/references/context-map-guide.md`。SKILL 2件とテンプレートには共有モデルの詳細表・用語定義を複製しない。
- 規範文の主語は役割名(`最上位オーケストレーター` / `戦術オーケストレーター` / `設計担当` / `実装担当` / `map 作成者`)とする。モデル名は各 SKILL の既存担当表と guide の作成者対応表にのみ残す。
- SKILL 2件では「設計・実装計画のフロー」節とコードベース探索節の共有文だけを変更する。基本原則・担当表・実装フェーズ・レビュー運用・アドバイザー運用・フォールバック・役割 Agents 併用は変更しない。
- `plugins/agent-policy/.claude-plugin/plugin.json` は Task 5 でのみ `0.1.0-dev` から `0.2.0-dev` へ更新する。メジャーバージョンは上げない。
- `plugins/*/src/` は変更しないため `pnpm build` は不要。各タスクは `git diff --check` と対象 Markdown/JSON の機械検証を通してから1コミットにする。
- 肥大 map の数値上限は追加しない。断片転記と未解決事項差分は具体例のみを guide に置き、長い changelog や新たな運用機構を作らない。

## File Structure

| ファイル | 責務 | この計画での扱い |
|---|---|---|
| `plugins/agent-policy/references/context-map-guide.md` | context-map の作成・圧縮・消費・通知を定義する唯一の規範 | 全文を置換し、用語、4事前条件、生産規律、読む深さ、3チェックポイント、強制語置換、断片/差分例を集約 |
| `plugins/agent-policy/skills/with-codex/SKILL.md` | Claude+Codex 構成の役割割当と横断規律 | 行37-46の順番付きフローを宣言的規律へ置換し、行53を所在通知+guide参照へ置換 |
| `plugins/agent-policy/skills/claude-only/SKILL.md` | Claude-only 構成の役割割当と横断規律 | 行27-34の順番付きフローを宣言的規律へ置換し、行47の自己共有を所在通知+guide参照へ置換 |
| `plugins/agent-policy/assets/context-map-template.md` | context-map の記入雛形 | 行69-73の上流報告先列と行106の共有文だけを変更 |
| `plugins/agent-policy/.claude-plugin/plugin.json` | agent-policy プラグインの manifest | バージョンを `0.2.0-dev` へ更新 |
| `docs/design/2026-07-20-agent-policy-context-map-sharing.md` | 設計前の論点メモ | 行4を「設計済み（確定設計書に集約）」へ更新 |

---

### Task 1: context-map-guide を共有モデルの唯一の定義元へ改訂

**Files:**
- Modify: `plugins/agent-policy/references/context-map-guide.md:1-51`

**Interfaces:**
- Consumes: 確定設計 `docs/design/2026-07-20-agent-policy-context-map-sharing-design.md:37-117,130-155`
- Produces: 後続の2つの SKILL とテンプレートが参照する唯一の共有モデル。規範語は `所在通知` / `(全文)参照` / `蒸留` / `要約(上流報告)`、事前条件は4件、チェックポイントは3件。

- [ ] **Step 1: 変更前全文が計画作成時点と一致することを確認**

現在の `plugins/agent-policy/references/context-map-guide.md:1-51` は次の全文である。内容が異なる場合(既に変更済み・行数ずれ等)は、**当該タスクを中断し、現物と計画の差分を人間に報告して判断を仰ぐ**。現物に勝手に合わせて実装を続行しない。

```markdown
# context-map 作成ガイド

`agent-policy` の各方針が共有する、context-map の作成タイミング・置き場所・記入手順を定める文書である。

## context-map とは

セッションの探索成果物である。現在の構造・関連モジュール・影響範囲・既存契約・未解決事項・テスト方法を整理し、オーケストレーター(Fable / Opus)へ共有する材料とする。

## 作成契機

- コードベース探索を伴う設計・実装タスクの着手時のみ作成する。
- 雑談・単発質問・軽微修正では作らない。
- 同一セッション内で追加タスクが発生した場合は、新規作成せず同じファイルを更新する。

判定の具体例:

- 作成する: 新機能の設計、複数ファイルにまたがる改修、影響範囲が不明な変更、既存構造の理解が前提となるリファクタリング。
- 作成しない: 単発の質問への回答、typo・文言修正などの軽微修正、1 ファイルで完結する定型変更(定数追加・軽微なスタイル修正等)、雑談。
- 迷う場合の目安: 「着手前にコードベースを探索して構造・依存・影響範囲を把握する必要があるか」を基準にする。必要なら作成、不要なら作成しない。

## 作成者

テンプレートの「作成者」欄は、profile に依存しない併記形式を用いる:

- `**作成者**: GPT Sol(with-codex 方針・探索担当) / Opus(claude-only 方針・探索担当)`

実際に作成したエージェント / profile に印を付けて用いる。

- with-codex 方針 → **GPT Sol**(探索統括。GPT Luna / Terra の探索サブエージェントを活用)。
- claude-only 方針 → **Opus**(Sonnet / Haiku の探索サブエージェントを活用)。

## 出力先

`.claude/context-maps/YYYY-MM-DD-<タスク名スラッグ>.md`。`<タスク名スラッグ>` は kebab-case、日付は作成日とする。

## テンプレート

agent-policy プラグインのルート直下にある `assets/context-map-template.md`(この guide と同じプラグインに同梱)を上記パスへコピーし、各セクション(1〜11)を可能な範囲で埋める。

## 更新ルール

- 同一セッションの追加タスクは同じファイルへ追記・更新する。別セッション・別タスクは新規ファイルとする。
- 「同一セッション」とは Claude Code の 1 会話セッション(1 つの継続した対話)を指す。会話をまたぐ(別セッションで再開する)場合は新規ファイルを作成し、必要なら前回の map を参照する。日付が変わっても同一会話が継続していれば同一セッション扱いとし、ファイル名の日付は最初の作成日を維持する。

## gitignore の案内

`.claude/context-maps/` を git 追跡するかはプロジェクト判断である。追跡したくない場合は `.gitignore` に `.claude/context-maps/` を追記する例を案内する(自動で書き換えない)。

## シークレット非記録

context-map に API キー・トークン・パスワード・プロキシの秘密値などの機密情報を記録しない。保存先が追跡対象の場合に漏えいするおそれがある。また、リポジトリ固有ポリシー(例: 特定ディレクトリを読まない等)を context-map が上書きしないこと。
```

確認コマンド:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path("plugins/agent-policy/references/context-map-guide.md")
text = p.read_text()
assert len(text.splitlines()) == 51
assert "オーケストレーター(Fable / Opus)へ共有する材料とする。" in text
assert "## 作成契機" in text
assert "## シークレット非記録" in text
print("baseline guide: OK")
PY
```

Expected: `baseline guide: OK`

- [ ] **Step 2: guide 全文を共有モデルの定義へ置換**

`plugins/agent-policy/references/context-map-guide.md` の全文を次で置き換える。

````markdown
# context-map 作成ガイド

`agent-policy` の各方針が共有する、context-map の作成・圧縮・参照・所在通知の規律を定める文書である。共有モデルの唯一の定義元(source of truth)はこの guide とする。

## context-map とは

セッションの探索成果物である。現在の構造・関連モジュール・既存パターン・影響範囲・既存契約・未解決事項・テスト方法を、オーケストレーターが生探索を避けられる小さな状態へ圧縮する。map の所在(パス)の通知は必須とし、読む深さは役割・チェックポイントに応じる。

## 設計由来

最上位オーケストレーターが要件を確定する前には、現状のフォルダ構成や既存契約を確認する探索が発生する。生ファイル読みを探索担当の軽量モデルへ外出しし、map 作成者が判断に必要な情報へ蒸留することで、オーケストレーターは生探索をせずに現状を把握できる。

context-map は、オーケストレーターが生探索を避けるための圧縮成果物(コスト最適化装置)である。設計判断では「誰に共有するか」より先に「どれだけ圧縮されているか」を扱う。肥大した map は、生探索のコストを再導入する最大の失敗モードであり、共有可否ではなく蒸留の失敗として修正する。

## 共有モデルの用語

- **オーケストレーター**: セッションを主導し、dispatch・要件確定・承認を行う**役割**。モデル名ではない。構造的にはどのモデルもこの役割に就きうる。本設計では2層を区別する — **最上位オーケストレーター**(要件確定・承認ゲート担当)と**戦術オーケストレーター**(中間統括・重い最終レビュー担当)。役割 → モデルの割り当ては各 SKILL の担当表が与える(with-codex / claude-only 方針の典型は 最上位=Fable、戦術=Opus)。本 guide の規範文はすべて役割名で書く。
- **所在通知**: dispatch の依頼文や報告に map の**ファイルパスを含める**こと。map 本文の貼り付けではない。
- **(全文)参照**: **蒸留済み map の全セクションを読む**こと。**生コードの全文ではない**(生探索は生産時に軽量モデルへ外注済み)。
- **蒸留**: 生探索の結果を、判断に要る最小限へ要約・構造化して map に落とすこと。ダンプ(全部貼り)の反対。**生産時**(map 作成時)の圧縮を指す。
- **要約(上流報告)**: 蒸留済み map のうち **§未解決事項を上流(オーケストレーター)への報告に載せる**行為。蒸留とは別の瞬間(消費時)に起きる二次圧縮であり、対象は §未解決事項(とその差分)に限る。テンプレートの Open Questions 表がその原文にあたる。

## 作成契機

- コードベース探索を伴う設計・実装タスクの着手時のみ作成する。
- 雑談・単発質問・軽微修正では作らない。
- 同一セッション内で追加タスクが発生した場合は、新規作成せず同じファイルを更新する。

判定の具体例:

- 作成する: 新機能の設計、複数ファイルにまたがる改修、影響範囲が不明な変更、既存構造の理解が前提となるリファクタリング。
- 作成しない: 単発の質問への回答、typo・文言修正などの軽微修正、1 ファイルで完結する定型変更(定数追加・軽微なスタイル修正等)、雑談。
- 迷う場合の目安: 「着手前にコードベースを探索して構造・依存・影響範囲を把握する必要があるか」を基準にする。必要なら作成、不要なら作成しない。

## 成果物ごとの事前条件

以下は独立した条件であり、列挙順に実行順の意味はない。

- **規則: 要件確定の事前条件** — Blueprint(高レベル要件)は暫定として出発してよい。コードベース探索を伴うタスクでは、context-map の §未解決事項の要約(上流報告)を受けて要件を確定する。
- **規則: 設計・実装着手の事前条件** — コードベース探索を伴う設計・実装は、context-map の作成後に着手する(作成契機の判定は guide 既定のまま)。
- **規則: ユーザーレビューの事前条件** — 設計書・実装計画書は、ユーザーレビューの前に Haiku レビュー(理解+暗黙知・矛盾抽出)→ 補足修正(戦術オーケストレーター)を通す(従来方針から継続の必須手順。Haiku レビューはレビュー手法の固有名であり、with-codex 構成でも GPT Luna に置き換えない)。
- **規則: 計画確定の事前条件** — 実装への移行は、最上位オーケストレーターの承認(Approve: 計画が全体要件を満たすことの確認)を経る。

承認(計画フェーズの確定ゲート)と、実装完了後の最終レビューは別の行為である。

## 生産側の規律

- 探索担当の軽量モデルが生ファイルを読み、map 作成者が結果を蒸留して map 化する。役割からモデルへの割り当ては「作成者」の対応表に従う。
- map はダンプではなく蒸留とし、オーケストレーターが一度読んで安い程度に小さく保つ。
- 肥大した map は最大の失敗モードである。map が大きくなった場合は、共有先を減らす前に、判断に不要な生データ・重複・長い引用を除いて再蒸留する。

## 消費側の読む深さ

| 対象 | 読む深さ | 根拠 |
|---|---|---|
| **オーケストレーター**(最上位・戦術) | 圧縮された map を**読む**(= 生探索の代替、設計目標)。チェックポイントごとの主担当・参照セクションは次節の表に従う | map の主要消費者。読むこと自体がコスト削減 |
| **設計担当** | **蒸留済み map の全文**を参照(生コード全文ではない)。多くは**作成者と同一**なので追加ロード不要 | 全体構造が設計判断に直接効く。生ファイル探索は生産時に軽量モデルへ外注済み |
| **実装担当** | map 全体は渡さず**断片(必要セクション)のみ**ブリーフに転記 | 自己完結ブリーフで足り、広域共有はコスト増 |
| **作成者** | 自己共有は不要(既に文脈内)。**作成者 ≠ 下流設計者**になった場合(GPT不在フォールバック等)だけ、次の dispatch にパスを渡す | 作成者としての自己共有と下流設計者への所在通知を区別する |

## オーケストレーターの3チェックポイント

チェックポイントは作業フェーズの進行に沿って自然に現れる。オーケストレーターが明示宣言するものではない。

| チェックポイント | 作業フェーズ | 主担当 | map の役割 | 主に読むセクション | 深さ |
|---|---|---|---|---|---|
| **① 要件精緻化**(map 作成直後) | 要件定義 | **最上位オーケストレーター** | 探索 → 要件確定の入力(要件確定規則) | **§未解決事項(最重要)**・§既存契約・§影響範囲 | 作成者が §未解決事項を**要約で必ず上げる**。最上位オーケストレーターは要約で受け、判断に必要なときだけ該当セクションを参照 |
| **② 計画承認**(設計書/WBS 完成時。計画確定規則の Approve と同一の瞬間) | 設計 | **最上位オーケストレーター**(承認ゲート) | 設計書/WBS の背景資料 | 要約(§未解決事項を前面に) | 所在通知＋オンデマンド全文(承認判断に必要なときだけ map 全文を読む) |
| **③ 最終レビュー**(全実装後) | レビュー | **戦術オーケストレーター優先**(最上位は直接レビュー時のみ) | カバレッジ/契約の**照合リスト** | §影響範囲・§既存契約・§未解決事項・§テスト方法 | 能動参照(one-shot・有界) |

- 上流へ伝わる本体は §未解決事項である。設計担当が map を更新して未解決事項が動いた場合は、その差分だけを要約(上流報告)で上げ、map 全文を再送しない。
- 最終レビューでの map 参照は、通常は作業フェーズ最終段の1回だけとし、dispatch ごとに繰り返さない。

## 強制語の扱い

「必ず共有する」ではなく、次を規律とする。

> map の**所在(パス)の通知は必須**。**読む深さは役割・チェックポイントに応じる**。ただし **map を小さく(蒸留された状態に)保つことが最優先の規律**である。

## 実装担当への断片転記例

実装担当には map 全文ではなく、担当変更に必要なセクションだけをブリーフへ転記する。例えば認証ミドルウェアの改修担当には次のように渡す。

```markdown
Context-map 所在: `.claude/context-maps/2026-07-20-auth-middleware.md`
参照断片:
- §5 変更の影響範囲: `src/auth/middleware.ts` とログイン統合テストが直接影響を受ける。
- §6 守るべき既存契約: 未認証時は HTTP 401 と `{"code":"UNAUTHORIZED"}` を返す。
- §8 テスト戦略: 既存の未認証・期限切れトークン・正常認証ケースを維持する。
```

このブリーフだけで担当作業を開始できるようにし、全体構造が必要になった場合だけ map の該当セクションを追加参照する。

## §未解決事項の差分通知例

差分通知は長い changelog にせず、直前の上流報告から変わった項目だけを書く。

```markdown
§未解決事項の差分:
- 解消: #1 既存 API の 401 応答形式は維持することで確定。
- 追加: #4 期限切れトークンの監査ログ保持期間は最上位オーケストレーターの判断待ち。
- 変更: #2 影響範囲を認証ミドルウェア単体からログイン統合テストまで拡大。
```

## 作成者

テンプレートの「作成者」欄は、profile に依存しない併記形式を用いる:

- `**作成者**: GPT Sol(with-codex 方針・探索担当) / Opus(claude-only 方針・探索担当)`

実際に作成したエージェント / profile に印を付けて用いる。

- with-codex 方針 → **GPT Sol**(探索統括。GPT Luna / Terra の探索サブエージェントを活用)。
- claude-only 方針 → **Opus**(Sonnet / Haiku の探索サブエージェントを活用)。

## 出力先

`.claude/context-maps/YYYY-MM-DD-<タスク名スラッグ>.md`。`<タスク名スラッグ>` は kebab-case、日付は作成日とする。

## テンプレート

agent-policy プラグインのルート直下にある `assets/context-map-template.md`(この guide と同じプラグインに同梱)を上記パスへコピーし、各セクション(1〜11)を可能な範囲で埋める。

## 更新ルール

- 同一セッションの追加タスクは同じファイルへ追記・更新する。別セッション・別タスクは新規ファイルとする。
- 「同一セッション」とは Claude Code の 1 会話セッション(1 つの継続した対話)を指す。会話をまたぐ(別セッションで再開する)場合は新規ファイルを作成し、必要なら前回の map を参照する。日付が変わっても同一会話が継続していれば同一セッション扱いとし、ファイル名の日付は最初の作成日を維持する。

## gitignore の案内

`.claude/context-maps/` を git 追跡するかはプロジェクト判断である。追跡したくない場合は `.gitignore` に `.claude/context-maps/` を追記する例を案内する(自動で書き換えない)。

## シークレット非記録

context-map に API キー・トークン・パスワード・プロキシの秘密値などの機密情報を記録しない。保存先が追跡対象の場合に漏えいするおそれがある。また、リポジトリ固有ポリシー(例: 特定ディレクトリを読まない等)を context-map が上書きしないこと。
````

転記直後に、全文の切れ・欠落・重複を早期検出する構造検証を行う。

```bash
set -euo pipefail
GUIDE=plugins/agent-policy/references/context-map-guide.md
python3 -c "import sys; t=open('$GUIDE').read(); n=len(t.splitlines()); assert n==135, f'lines={n}'; print('guide lines:', n)"
test "$(grep -c '^## ' "$GUIDE")" -eq 17 && echo 'guide ## headings: 17'
```

Expected: `guide lines: 135` と `guide ## headings: 17`。数がずれる場合は転記の切れ・重複を疑い Step 2 をやり直す(この期待値は本計画の置換本文=135行・`##` 見出し17個に基づく)。

- [ ] **Step 3: guide 単体の構造と禁止語を検証**

```bash
set -euo pipefail
GUIDE=plugins/agent-policy/references/context-map-guide.md
for term in '所在通知' '(全文)参照' '蒸留' '要約(上流報告)'; do
  grep -Fn -- "$term" "$GUIDE" >/dev/null
done
test "$(grep -c '^- \*\*規則: .*の事前条件\*\* —' "$GUIDE")" -eq 4
test "$(grep -c '^| \*\*[①②③] ' "$GUIDE")" -eq 3
grep -F 'Blueprint(高レベル要件)は暫定として出発してよい' "$GUIDE" >/dev/null
grep -F '§未解決事項の要約(上流報告)を受けて要件を確定する' "$GUIDE" >/dev/null
grep -F '肥大した map は最大の失敗モード' "$GUIDE" >/dev/null
grep -F '所在(パス)の通知は必須' "$GUIDE" >/dev/null
! grep -nE '逆流|橋渡し|必ず共有' "$GUIDE"
git diff --check -- "$GUIDE"
```

Expected: 終了コード0。`逆流` / `橋渡し` / `必ず共有` の出力なし。事前条件4件、チェックポイント3件。

- [ ] **Step 4: 差分を確認してコミット**

Run: `git diff -- plugins/agent-policy/references/context-map-guide.md`

Expected: `context-map-guide.md` だけが全文置換され、4用語・4事前条件・生産規律・消費表・3チェックポイント・強制語置換・断片転記例・差分通知例を含む。数値上限は追加されていない。

```bash
git add plugins/agent-policy/references/context-map-guide.md
git commit -m "docs(agent-policy): context-map共有モデルをguideへ集約"
```

---

### Task 2: with-codex の順番付きフローを宣言的規律へ置換

**Files:**
- Modify: `plugins/agent-policy/skills/with-codex/SKILL.md:37-46,53`

**Interfaces:**
- Consumes: Task 1 の `../../references/context-map-guide.md`。4事前条件の詳細定義・共有モデル表は guide に置く。
- Produces: with-codex 構成の4つの独立した事前条件と、context-map の所在通知+guide参照。

- [ ] **Step 1: 変更前の正確な2箇所を確認**

`plugins/agent-policy/skills/with-codex/SKILL.md:37-46`:

```markdown
## 設計・実装計画のフロー

1. **Fable**: 高レベル要件・全体アーキテクチャ・主要インターフェースを定義(System Blueprint)。
2. **GPT Sol**: コードベース探索を行い context-map を作成(現在の構造、関連モジュール、既存パターン、影響範囲、未解決事項、既存契約、テスト方法を整理)。
3. **GPT Sol**: Fable の Blueprint を基に、詳細設計(クラス/API/DB)+ 実装計画(ステップバイステップ WBS)を作成。
4. **Haiku**: 設計書・計画書をレビューし「理解したこと」+ 暗黙知・矛盾点を抽出。
5. **Opus**: Haiku のフィードバックを受け、設計書・計画書の補足修正・アップデートを行う。
6. **Fable**: 完成した計画が全体要件を満たしているか軽く最終確認(Approve)のみ行う。

> Haiku レビューは Claude+Codex 構成でも Claude Haiku が担い、GPT Luna に置き換えない。
```

`plugins/agent-policy/skills/with-codex/SKILL.md:53`:

```markdown
- 作成した context-map は Fable / Opus に必ず共有する。
```

Run:

```bash
grep -nF '## 設計・実装計画のフロー' plugins/agent-policy/skills/with-codex/SKILL.md
grep -nF '作成した context-map は Fable / Opus に必ず共有する。' plugins/agent-policy/skills/with-codex/SKILL.md
```

Expected: それぞれ行37、行53に1件ずつ。一致しない場合(行番号ずれ・既に変更済み・0件または複数件等)は、**当該タスクを中断し、現物と計画の差分を人間に報告して判断を仰ぐ**。現物に勝手に合わせて続行しない。

- [ ] **Step 2: フロー節全体を4つの宣言的規律へ置換**

上記行37-46の全文を次で置き換える。

```markdown
## 設計・実装計画の規律

以下は成果物ごとの独立した事前条件であり、列挙順に実行順の意味はない。用語・作成契機・読む深さ・チェックポイントの詳細は `../../references/context-map-guide.md` に従う。

- **規則: 要件確定の事前条件** — Blueprint(高レベル要件)は暫定として出発してよい。コードベース探索を伴うタスクでは、context-map の §未解決事項の要約(上流報告)を受けて要件を確定する。
- **規則: 設計・実装着手の事前条件** — コードベース探索を伴う設計・実装は、context-map の作成後に着手する(作成契機の判定は guide 既定のまま)。
- **規則: ユーザーレビューの事前条件** — 設計書・実装計画書は、ユーザーレビューの前に Haiku レビュー(理解+暗黙知・矛盾抽出)→ 補足修正(戦術オーケストレーター)を通す(従来方針から継続の必須手順。Haiku レビューはレビュー手法の固有名であり、with-codex 構成でも GPT Luna に置き換えない)。
- **規則: 計画確定の事前条件** — 実装への移行は、最上位オーケストレーターの承認(Approve: 計画が全体要件を満たすことの確認)を経る。
```

- [ ] **Step 3: コードベース探索節の共有文を所在通知へ置換**

行53の旧文を次の全文へ置き換える。

```markdown
- 作成した context-map の所在(パス)を、次の dispatch または上流報告で通知する。所在通知は必須とし、読む深さは `../../references/context-map-guide.md` の共有モデルに従う。
```

- [ ] **Step 4: 4規律・guide参照・旧フロー除去を検証**

```bash
set -euo pipefail
FILE=plugins/agent-policy/skills/with-codex/SKILL.md
test "$(grep -c '^- \*\*規則: .*の事前条件\*\* —' "$FILE")" -eq 4
test "$(grep -cF '../../references/context-map-guide.md' "$FILE")" -ge 2
grep -F 'Claude+Codex 構成でも GPT Luna に置き換えない' "$FILE" >/dev/null
grep -F '所在通知は必須' "$FILE" >/dev/null
! grep -nE '設計・実装計画のフロー|^[1-6]\. \*\*(Fable|GPT Sol|Opus|Haiku)\*\*:|逆流|橋渡し|必ず共有' "$FILE"
git diff --check -- "$FILE"
```

Expected: 終了コード0。4事前条件。旧見出し、モデル名を主語にしたstep 1-6、禁止語は出力なし。

- [ ] **Step 5: 変更範囲を確認してコミット**

Run: `git diff --unified=3 -- plugins/agent-policy/skills/with-codex/SKILL.md`

Expected: 差分は旧行37-46と旧行53の2ハンクだけ。`基本原則`、`モデル別役割`、`GPT Sol / Terra / Luna の担当`、`レビュー運用`、`アドバイザー運用・並列実行`、フォールバック、`役割 Agents を持つプラグインとの併用`に差分なし。

```bash
git add plugins/agent-policy/skills/with-codex/SKILL.md
git commit -m "docs(agent-policy): with-codexを宣言的規律へ更新"
```

---

### Task 3: claude-only の順番付きフローと自己共有を除去

**Files:**
- Modify: `plugins/agent-policy/skills/claude-only/SKILL.md:27-34,47`

**Interfaces:**
- Consumes: Task 1 の `../../references/context-map-guide.md`。Task 2 と同じ役割ベースの4事前条件を使い、モデル割当は claude-only の既存担当表に委ねる。
- Produces: claude-only 構成の4つの独立した事前条件と、作成者=Opus の自己共有を含まない所在通知。

- [ ] **Step 1: 変更前の正確な2箇所を確認**

`plugins/agent-policy/skills/claude-only/SKILL.md:27-34`:

```markdown
## 設計・実装計画のフロー

1. **Fable**: 高レベル要件・全体アーキテクチャ・主要インターフェースを定義(System Blueprint)。
2. **Opus**: コードベース探索を行い context-map を作成(現在の構造、関連モジュール、影響範囲、既存契約、未解決事項などを整理)。
3. **Opus**: Fable の Blueprint を基に、詳細設計(クラス/API/DB)+ 実装計画(ステップバイステップ)を作成。
4. **Haiku**: 設計書・計画書をレビューし「理解したこと」+ 暗黙知・矛盾点を抽出。
5. **Opus**: Haiku のフィードバックを受け、設計書・計画書の補足修正・アップデートを行う。
6. **Fable**: 完成した計画が全体要件を満たしているか軽く最終確認(Approve)のみ行う。
```

`plugins/agent-policy/skills/claude-only/SKILL.md:47`:

```markdown
- 作成した context-map は Fable / Opus に必ず共有する。
```

Run:

```bash
grep -nF '## 設計・実装計画のフロー' plugins/agent-policy/skills/claude-only/SKILL.md
grep -nF '作成した context-map は Fable / Opus に必ず共有する。' plugins/agent-policy/skills/claude-only/SKILL.md
```

Expected: それぞれ行27、行47に1件ずつ。一致しない場合(行番号ずれ・既に変更済み・0件または複数件等)は、**当該タスクを中断し、現物と計画の差分を人間に報告して判断を仰ぐ**。現物に勝手に合わせて続行しない。

- [ ] **Step 2: フロー節全体を4つの宣言的規律へ置換**

上記行27-34の全文を次で置き換える。

```markdown
## 設計・実装計画の規律

以下は成果物ごとの独立した事前条件であり、列挙順に実行順の意味はない。用語・作成契機・読む深さ・チェックポイントの詳細は `../../references/context-map-guide.md` に従う。

- **規則: 要件確定の事前条件** — Blueprint(高レベル要件)は暫定として出発してよい。コードベース探索を伴うタスクでは、context-map の §未解決事項の要約(上流報告)を受けて要件を確定する。
- **規則: 設計・実装着手の事前条件** — コードベース探索を伴う設計・実装は、context-map の作成後に着手する(作成契機の判定は guide 既定のまま)。
- **規則: ユーザーレビューの事前条件** — 設計書・実装計画書は、ユーザーレビューの前に Haiku レビュー(理解+暗黙知・矛盾抽出)→ 補足修正(戦術オーケストレーター)を通す。
- **規則: 計画確定の事前条件** — 実装への移行は、最上位オーケストレーターの承認(Approve: 計画が全体要件を満たすことの確認)を経る。
```

- [ ] **Step 3: コードベース探索節の自己共有文を所在通知へ置換**

行47の旧文を次の全文へ置き換える。

```markdown
- 作成した context-map の所在(パス)を、次の dispatch または上流報告で通知する。所在通知は必須とし、読む深さは `../../references/context-map-guide.md` の共有モデルに従う。
```

- [ ] **Step 4: 4規律・guide参照・旧フロー除去を検証**

```bash
set -euo pipefail
FILE=plugins/agent-policy/skills/claude-only/SKILL.md
test "$(grep -c '^- \*\*規則: .*の事前条件\*\* —' "$FILE")" -eq 4
test "$(grep -cF '../../references/context-map-guide.md' "$FILE")" -ge 2
grep -F '所在通知は必須' "$FILE" >/dev/null
! grep -nE '設計・実装計画のフロー|^[1-6]\. \*\*(Fable|Opus|Haiku)\*\*:|逆流|橋渡し|必ず共有' "$FILE"
git diff --check -- "$FILE"
```

Expected: 終了コード0。4事前条件。旧見出し、モデル名を主語にしたstep 1-6、自己共有、禁止語は出力なし。

- [ ] **Step 5: 変更範囲を確認してコミット**

Run: `git diff --unified=3 -- plugins/agent-policy/skills/claude-only/SKILL.md`

Expected: 差分は旧行27-34と旧行47の2ハンクだけ。`基本原則`、`モデル別役割(Claude 限定)`、`実装フェーズ`、`レビュー運用`、`アドバイザー運用・並列実行`、`役割 Agents を持つプラグインとの併用`に差分なし。

```bash
git add plugins/agent-policy/skills/claude-only/SKILL.md
git commit -m "docs(agent-policy): claude-onlyを宣言的規律へ更新"
```

---

### Task 4: context-map テンプレートを上流報告と guide 参照へ整合

**Files:**
- Modify: `plugins/agent-policy/assets/context-map-template.md:69-73,106`

**Interfaces:**
- Consumes: Task 1 の guide にある `要約(上流報告)` と所在通知の定義。
- Produces: §未解決事項の各行に役割ベースの上流報告先を記録でき、ファイル末尾から guide の共有モデルへ到達できるテンプレート。

- [ ] **Step 1: 変更前の正確な2箇所を確認**

設計書 §5 は Open Questions の行71-72を指すが、現物では表の置換単位は `plugins/agent-policy/assets/context-map-template.md:69-73` である。

```markdown
| # | 質問内容 | 影響度 | 誰に確認すべきか | 現状の仮定 |
|---|----------|--------|------------------|------------|
| 1 |          | High   | Fable / Opus     |            |
| 2 |          | Medium | GPT Sol / Opus   |            |
| 3 |          | Low    |                  |            |
```

`plugins/agent-policy/assets/context-map-template.md:106`:

```markdown
*このファイルはFable / Opusに共有し、全体整合性の判断材料とする。*
```

Run:

```bash
grep -nF '| # | 質問内容 | 影響度 | 誰に確認すべきか | 現状の仮定 |' plugins/agent-policy/assets/context-map-template.md
grep -nF '*このファイルはFable / Opusに共有し、全体整合性の判断材料とする。*' plugins/agent-policy/assets/context-map-template.md
```

Expected: 行69、行106に1件ずつ。一致しない場合(行番号ずれ・既に変更済み・0件または複数件等)は、**当該タスクを中断し、現物と計画の差分を人間に報告して判断を仰ぐ**。現物に勝手に合わせて続行しない。

- [ ] **Step 2: Open Questions 表を役割ベースの上流報告先へ置換**

行69-73の表全体を次で置き換える。

```markdown
| # | 質問内容 | 影響度 | 上流報告先(役割) | 現状の仮定 |
|---|----------|--------|------------------|------------|
| 1 |          | High   | 最上位オーケストレーター |            |
| 2 |          | Medium | 戦術オーケストレーター |            |
| 3 |          | Low    | 戦術オーケストレーター |            |
```

- [ ] **Step 3: 末尾の共有文を所在通知+guide参照へ置換**

行106の旧文を次の全文へ置き換える。

```markdown
*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に定義された役割・チェックポイントに従い、本文は小さく蒸留された状態に保つ。*
```

- [ ] **Step 4: テンプレートが要約+guide参照に留まることを検証**

```bash
set -euo pipefail
FILE=plugins/agent-policy/assets/context-map-template.md
grep -F '上流報告先(役割)' "$FILE" >/dev/null
grep -F '最上位オーケストレーター' "$FILE" >/dev/null
grep -F '戦術オーケストレーター' "$FILE" >/dev/null
grep -F 'references/context-map-guide.md' "$FILE" >/dev/null
grep -F '所在(パス)を通知する' "$FILE" >/dev/null
grep -F '小さく蒸留された状態に保つ' "$FILE" >/dev/null
! grep -nE 'Fable / Opus|GPT Sol / Opus|必ず共有|逆流|橋渡し|共有モデルの用語|3チェックポイント' "$FILE"
git diff --check -- "$FILE"
```

Expected: 終了コード0。旧モデル名の共有先、禁止語、guide の詳細定義の複製は出力なし。

- [ ] **Step 5: 変更範囲を確認してコミット**

Run: `git diff --unified=3 -- plugins/agent-policy/assets/context-map-template.md`

Expected: 差分は Open Questions 表の行69-73と末尾の行106だけ。セクション1-6、8-11、次のステップ提案、機密情報注意書きは不変。

```bash
git add plugins/agent-policy/assets/context-map-template.md
git commit -m "docs(agent-policy): context-mapテンプレートを上流報告モデルへ更新"
```

---

### Task 5: バージョン・論点メモを更新し、設計書 §7 の完了判定を全件実行

**Files:**
- Modify: `plugins/agent-policy/.claude-plugin/plugin.json:4`
- Modify: `docs/design/2026-07-20-agent-policy-context-map-sharing.md:4`
- Verify: `plugins/agent-policy/references/context-map-guide.md`
- Verify: `plugins/agent-policy/skills/with-codex/SKILL.md`
- Verify: `plugins/agent-policy/skills/claude-only/SKILL.md`
- Verify: `plugins/agent-policy/assets/context-map-template.md`

**Interfaces:**
- Consumes: Tasks 1-4 の4コミットと確定設計 §7(`docs/design/2026-07-20-agent-policy-context-map-sharing-design.md:159-169`)。
- Produces: agent-policy `0.2.0-dev`、設計済みと明記された論点メモ、機械検証と Haiku レビューを通過した完了状態。

- [ ] **Step 1: manifest と論点メモの変更前引用を確認**

`plugins/agent-policy/.claude-plugin/plugin.json:4`:

```json
  "version": "0.1.0-dev"
```

`docs/design/2026-07-20-agent-policy-context-map-sharing.md:4`:

```markdown
- ステータス: **論点整理まで。設計・決定は後日**（ユーザー依頼により別途検討する）
```

Run:

```bash
grep -nF '"version": "0.1.0-dev"' plugins/agent-policy/.claude-plugin/plugin.json
grep -nF -- '- ステータス: **論点整理まで。設計・決定は後日**（ユーザー依頼により別途検討する）' docs/design/2026-07-20-agent-policy-context-map-sharing.md
```

Expected: どちらも行4に1件。一致しない場合(行番号ずれ・既に変更済み等)は、**当該タスクを中断し、現物と計画の差分を人間に報告して判断を仰ぐ**。現物に勝手に合わせて続行しない。

- [ ] **Step 2: バージョンを `0.2.0-dev` へ更新**

旧行を次で置き換える。

```json
  "version": "0.2.0-dev"
```

- [ ] **Step 3: 論点メモのステータスを設計済みへ更新**

旧行を次で置き換える。

```markdown
- ステータス: **設計済み（確定設計書に集約）**（`docs/design/2026-07-20-agent-policy-context-map-sharing-design.md` v4）
```

- [ ] **Step 4: §7-1 guide集約・参照関係・重複定義なしを検証**

```bash
set -euo pipefail
GUIDE=plugins/agent-policy/references/context-map-guide.md
WITH=plugins/agent-policy/skills/with-codex/SKILL.md
CLAUDE=plugins/agent-policy/skills/claude-only/SKILL.md
TEMPLATE=plugins/agent-policy/assets/context-map-template.md

grep -F '共有モデルの唯一の定義元(source of truth)はこの guide' "$GUIDE" >/dev/null
test "$(grep -cF '../../references/context-map-guide.md' "$WITH")" -ge 2
test "$(grep -cF '../../references/context-map-guide.md' "$CLAUDE")" -ge 2
grep -F 'references/context-map-guide.md' "$TEMPLATE" >/dev/null
! grep -nE '共有モデルの用語|生産側の規律|消費側の読む深さ|オーケストレーターの3チェックポイント' "$WITH" "$CLAUDE" "$TEMPLATE"
```

Expected: 終了コード0。詳細定義見出しは guide だけにあり、SKILL 2件とテンプレートは guide を参照する。

- [ ] **Step 5: §7-2 強制語置換と3規律を検証**

```bash
set -euo pipefail
TARGETS=(
  plugins/agent-policy/references/context-map-guide.md
  plugins/agent-policy/skills/with-codex/SKILL.md
  plugins/agent-policy/skills/claude-only/SKILL.md
  plugins/agent-policy/assets/context-map-template.md
)
! grep -nE '必ず共有|Fable / Opusに共有|Fable / Opus に必ず共有' "${TARGETS[@]}"
grep -F '所在(パス)の通知は必須' plugins/agent-policy/references/context-map-guide.md >/dev/null
grep -F '読む深さは役割・チェックポイントに応じる' plugins/agent-policy/references/context-map-guide.md >/dev/null
grep -F 'map を小さく(蒸留された状態に)保つことが最優先の規律' plugins/agent-policy/references/context-map-guide.md >/dev/null
grep -F '所在通知は必須' plugins/agent-policy/skills/with-codex/SKILL.md >/dev/null
grep -F '所在通知は必須' plugins/agent-policy/skills/claude-only/SKILL.md >/dev/null
```

Expected: 終了コード0。旧強制語は出力なし。所在通知・役割/チェックポイント依存・小さなmapの3規律が guide に存在する。

- [ ] **Step 6: §7-3 stepフロー除去・4事前条件・役割節不変を検証**

```bash
set -euo pipefail
WITH=plugins/agent-policy/skills/with-codex/SKILL.md
CLAUDE=plugins/agent-policy/skills/claude-only/SKILL.md

test "$(grep -c '^- \*\*規則: .*の事前条件\*\* —' "$WITH")" -eq 4
test "$(grep -c '^- \*\*規則: .*の事前条件\*\* —' "$CLAUDE")" -eq 4
! grep -nE '設計・実装計画のフロー|^[1-6]\. \*\*(Fable|GPT Sol|Opus|Haiku)\*\*:' "$WITH" "$CLAUDE"

# base コミットは HEAD~4 の固定参照に頼らず、Task 1〜4 のコミットメッセージを git log から特定する。
# 直近コミットが Task 1〜4 のコミット(計画のコミットメッセージ)を含むことを、まず目視で確認する。
git log --oneline -6

python3 - <<'PY'
from pathlib import Path
import subprocess

# Task 1〜4 のコミットを git log から特定する(HEAD~4 の固定参照に依存しない)。
# これにより、Step 9 の Haiku 修正が新規コミットとして積まれても base が正しく求まる。
task_msgs = [
    "docs(agent-policy): context-map共有モデルをguideへ集約",
    "docs(agent-policy): with-codexを宣言的規律へ更新",
    "docs(agent-policy): claude-onlyを宣言的規律へ更新",
    "docs(agent-policy): context-mapテンプレートを上流報告モデルへ更新",
]
log = subprocess.check_output(["git", "log", "--format=%H%x09%s", "-30"], text=True).splitlines()
found = {}
for line in log:
    h, _, s = line.partition("\t")
    if s in task_msgs and s not in found:
        found[s] = h
missing = [m for m in task_msgs if m not in found]
assert not missing, (
    f"Task 1-4 のコミットを git log から特定できない: {missing}. "
    "HEAD~N の固定参照へフォールバックせず、正しい base を特定するまで検証を止めて人間へ報告する。"
)
# Task 1 コミットの親を out-of-scope 比較の base とする。
task1 = found[task_msgs[0]]
base = subprocess.check_output(["git", "rev-parse", f"{task1}^"], text=True).strip()
checks = {
    "plugins/agent-policy/skills/with-codex/SKILL.md": [
        "## 基本原則",
        "## モデル別役割",
        "## GPT Sol / Terra / Luna の担当",
        "## レビュー運用",
        "## アドバイザー運用・並列実行",
        "## `.claude/agents/gpt-*.md` 不在時のフォールバック",
        "## 役割 Agents を持つプラグインとの併用",
    ],
    "plugins/agent-policy/skills/claude-only/SKILL.md": [
        "## 基本原則",
        "## モデル別役割(Claude 限定)",
        "## 実装フェーズ",
        "## レビュー運用",
        "## アドバイザー運用・並列実行",
        "## 役割 Agents を持つプラグインとの併用",
    ],
}

def section(text: str, heading: str) -> str:
    start = text.index(heading)
    next_heading = text.find("\n## ", start + len(heading))
    return text[start:] if next_heading == -1 else text[start:next_heading]

for path, headings in checks.items():
    before = subprocess.check_output(["git", "show", f"{base}:{path}"], text=True)
    after = Path(path).read_text()
    for heading in headings:
        assert section(before, heading) == section(after, heading), f"changed out-of-scope section: {path} {heading}"
print("out-of-scope SKILL sections: unchanged")
PY
```

Expected: `out-of-scope SKILL sections: unchanged`。4事前条件が両方にあり、旧stepフローは出力なし。base コミットは `HEAD~4` の固定参照ではなく、Task 1〜4 のコミットメッセージを git log から特定して Task 1 コミットの親を base とする(Step 9 の Haiku 修正コミットが積まれても正しく動く)。Task 1〜4 のコミットを特定できない場合は、`git log --oneline -6` の並びが計画のコミットメッセージと一致するか確認し、一致しなければ検証を止めて人間へ報告する。

- [ ] **Step 7: §7-4 Blueprint事前条件と禁止概念の完全除去を検証**

```bash
set -euo pipefail
GUIDE=plugins/agent-policy/references/context-map-guide.md
grep -F 'Blueprint(高レベル要件)は暫定として出発してよい' "$GUIDE" >/dev/null
grep -F '§未解決事項の要約(上流報告)を受けて要件を確定する' "$GUIDE" >/dev/null
grep -F 'context-map の作成後に着手する' "$GUIDE" >/dev/null
! grep -RniE '逆流|橋渡し' plugins/agent-policy --exclude-dir=.git
```

Expected: 終了コード0。Blueprint暫定→§未解決事項要約→要件確定と、map作成後の着手が guide に存在する。`逆流` / `橋渡し` は plugin 配下に出力なし。

- [ ] **Step 8: 用語・3チェックポイント・テンプレート・JSON・差分品質を一括検証**

```bash
set -euo pipefail
GUIDE=plugins/agent-policy/references/context-map-guide.md
TEMPLATE=plugins/agent-policy/assets/context-map-template.md
for term in '所在通知' '(全文)参照' '蒸留' '要約(上流報告)'; do
  grep -Fn -- "$term" "$GUIDE" >/dev/null
done
test "$(grep -c '^| \*\*[①②③] ' "$GUIDE")" -eq 3
grep -F '| **① 要件精緻化**' "$GUIDE" | grep -F '**最上位オーケストレーター**' >/dev/null
grep -F '| **② 計画承認**' "$GUIDE" | grep -F '**最上位オーケストレーター**(承認ゲート)' >/dev/null
grep -F '| **③ 最終レビュー**' "$GUIDE" | grep -F '**戦術オーケストレーター優先**' >/dev/null
grep -F '上流報告先(役割)' "$TEMPLATE" >/dev/null
grep -F 'references/context-map-guide.md' "$TEMPLATE" >/dev/null
python3 -m json.tool plugins/agent-policy/.claude-plugin/plugin.json >/dev/null
grep -F '"version": "0.2.0-dev"' plugins/agent-policy/.claude-plugin/plugin.json >/dev/null
grep -F '設計済み（確定設計書に集約）' docs/design/2026-07-20-agent-policy-context-map-sharing.md >/dev/null
git diff --check
```

Expected: 終了コード0。4用語、主担当付き3チェックポイント、テンプレート参照、JSON構文、`0.2.0-dev`、メモの新ステータスがすべて確認できる。

- [ ] **Step 9: §7-5 Haikuレビュー(理解・暗黙知・矛盾抽出)を実行**

オーケストレーターから Haiku レビュー担当へ、次の依頼文をそのまま渡す。

```text
あなたは agent-policy context-map 共有モデル実装のレビュー担当です。Agent tool は使用せず、助言だけを返してください。

確定設計:
- docs/design/2026-07-20-agent-policy-context-map-sharing-design.md

レビュー対象:
- plugins/agent-policy/references/context-map-guide.md
- plugins/agent-policy/skills/with-codex/SKILL.md
- plugins/agent-policy/skills/claude-only/SKILL.md
- plugins/agent-policy/assets/context-map-template.md
- plugins/agent-policy/.claude-plugin/plugin.json
- docs/design/2026-07-20-agent-policy-context-map-sharing.md

次の順で報告してください。
1. 変更後の共有モデルをあなたがどう理解したか。
2. 設計 §3・§5・§6・§7 に対する欠落、暗黙知、矛盾。ファイルパスと該当文を引用すること。
3. guide が唯一の定義元で、SKILL 2件・テンプレートが要約+参照に留まるか。
4. SKILL の対象外節に意味変更が無いか。
5. 修正必須 / 推奨 / 指摘なし、の判定。

数値上限の新設や対象外機能の提案はしないでください。
```

Expected: 「理解したこと」が設計と一致し、修正必須の指摘が0件。修正必須の指摘がある場合は、設計 §3・§5・§6 の範囲内かを確認し、該当する場合だけ指摘された対象文を修正して Steps 4-8 を再実行する。設計変更を要求する指摘、または対象外節の変更を要求する指摘は適用せず、人間判断が必要な事項として報告して停止する。

修正を反映した場合のコミット戦略:

- 既存の Task 1〜4 コミットを **amend しない**。指摘対応は新規コミット `docs(agent-policy): 計画レビュー指摘の反映` として積む。
- この新規コミットには**指摘対応した guide / SKILL / テンプレートのファイルだけ**を `git add` する。Steps 2-3 で編集済みの `plugin.json` と論点メモは含めず、Step 10 の別コミットに残す。
- 新規コミットにより Task 数と HEAD の対応がずれるため、git log ベースの検証(Step 6 等)は `HEAD~N` の固定参照を使わず、**Task 1〜4 のコミットを git log から特定して読み替える**(Step 6 は既にこの方式)。

- [ ] **Step 10: 最終差分を確認してコミット**

Run:

```bash
git status --short
git diff -- plugins/agent-policy/.claude-plugin/plugin.json docs/design/2026-07-20-agent-policy-context-map-sharing.md
git log --oneline -6
```

Expected:
- 未コミット差分は `plugin.json` と論点メモだけ。Haiku 修正が発生した場合、その対象ファイルは Step 9 で別コミット済みのため、ここには現れない。
- `plugin.json` は `0.1.0-dev` → `0.2.0-dev` の1行差分。
- 論点メモは行4のステータス1行差分。
- 直近コミットは Tasks 1-4(Haiku 修正が発生した場合は `docs(agent-policy): 計画レビュー指摘の反映` の新規コミットも Task 4 の後に並ぶ)。

このコミットには Task 5 自身の変更(`plugin.json` と論点メモ)だけを含める。guide / SKILL / テンプレートは Tasks 1-4 または Step 9 の Haiku 修正コミットで確定済みのため、ここでは `git add` しない。

```bash
git add plugins/agent-policy/.claude-plugin/plugin.json \
  docs/design/2026-07-20-agent-policy-context-map-sharing.md
git commit -m "chore(agent-policy): context-map共有モデル反映版へ更新"
```

- [ ] **Step 11: コミット後の完了状態を確認**

```bash
git status --short
git log --oneline -6
```

Expected: `git status --short` は出力なし。Haiku 修正が不要だった通常時は直近5コミットが Task 1 から Task 5 まで各1件ずつ並ぶ。Step 9 で Haiku 修正コミットが積まれた場合は6コミットになり、並びは Task 1〜4 → `docs(agent-policy): 計画レビュー指摘の反映` → Task 5(`chore(agent-policy): context-map共有モデル反映版へ更新`)となる。

---

## Plan Self-Review Record

- **Spec coverage:** 設計 §3.0 の用語は Task 1、§3.1 の4事前条件は Tasks 1-3、§3.2-3.5 は Task 1、§5 の6ファイルは Tasks 1-5、§6 の非目標と対象外節不変は Global Constraints・Task 1・Task 5、§7 の全完了条件は Task 5 Steps 4-9に対応する。
- **No placeholders:** 実装時に置換する全断片は変更前の正確な引用と変更後の完全な本文を記載した。断片転記・差分通知の guide 例も具体値を使い、未定の記入指示を置いていない。
- **Consistency:** 4事前条件の名称と本文、4用語、3チェックポイントの主担当は guide と両 SKILL で一致する。SKILL とテンプレートは詳細表を持たず guide を参照する。新バージョンは全タスクで `0.2.0-dev` に統一した。
- **Task sizing:** 各タスクは1責務・1検証サイクル・1コミット。最終Taskが設計 §7 の全チェックと Haiku レビューをまとめて完了ゲートにする。

## レビュー記録

- **Haiku レビュー済み・補足修正済み(2026-07-20)。** 反映内容: 各 Task Step 1 の変更前確認が一致しない場合は中断して人間へ報告(Task 1・4・5 も同扱い)、Task 1 Step 2 直後に guide の構造検証(135行・`##`17見出し)を追加、Task 5 Step 6 の base コミットを `HEAD~4` 固定参照から git log 特定へ変更、Step 9 の Haiku 修正は amend せず新規コミットとして積み Step 10/11 の期待コミット数を更新。baseline 数値(旧 guide=51行・8見出し等)は現物と一致することを確認済み。
