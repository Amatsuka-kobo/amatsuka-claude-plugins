# agent-policy Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map)を、Claude+Codex 併用 / Claude オンリーの 2 プロファイルと GPT Agent 生成ウィザードとして提供する静的プラグイン `agent-policy` を新規作成する。

**Architecture:** `plugins/agent-policy/` 配下に、2 つの方針 Skill(with-codex / claude-only)と setup Skill、両方針が共有する `references/`(advisor-rules / context-map-guide)・`assets/`(context-map-template)、setup 専用 `skills/setup/assets/`(gpt-*.template.md)を配置する。共通部を references へ集約して drift を防ぎ、GPT Agent はプラグインに同梱せず setup がプロジェクトの `.claude/agents/` に生成する。リポジトリ側は marketplace.json への entry 追記とルート README の配布一覧・個別説明追記のみ。

**Tech Stack:** 静的 Markdown / JSON プラグイン(ビルドなし)。実行コード・テストコードは持たない。検証は plugin-validator / skill-reviewer / JSON parse / frontmatter 確認 / grep による旧文言非混入確認で行う。

## Global Constraints

- Anthropic API 前提の実装禁止(API クライアント追加・`ANTHROPIC_API_KEY` 依存・CLI 直接操作要求は不可。claude-only Skill はプロキシなしで完結)。
- 完全静的プラグイン: `package.json` / `build.ts` / `pnpm-workspace.yaml` entry / `hooks/` は作成禁止。
- `plugin.json` は `name` / `description` / `version` の 3 項目のみ。
- SKILL.md frontmatter は `name` / `description` の 2 項目のみ。
- Skill ディレクトリ名 = frontmatter `name`(kebab-case)を一致させる。Agent テンプレートもファイル名(生成後 `gpt-sol.md` 等)= frontmatter `name` を一致させる。
- モデル名正規化: 生成物では `Fable5`→`Fable`、`Sonnet5`→`Sonnet` に統一(`Opus` / `Haiku` / `GPT Sol` / `GPT Terra` / `GPT Luna` はそのまま)。
- `docs/chat/` 配下は読み取り禁止。
- 初期バージョンは `0.1.0-dev`。
- 確定事実(2026-07-20 実測): Agent tool の dispatch 時 `model` 上書きは enum(`sonnet`/`opus`/`haiku`/`fable`)に制限。カスタムエイリアス `claude-gpt-5-6-*` は Agents 定義 frontmatter の `model` フィールドでのみ有効。

## タスク一覧と依存関係(並列塊)

- **塊A(相互独立・並列可):** Task 1(plugin.json)/ Task 2(advisor-rules)/ Task 3(context-map-guide)/ Task 4(context-map-template)/ Task 7(gpt-sol.template)
- **塊B(Task 2,3 完了後・並列可):** Task 5(with-codex SKILL)/ Task 6(claude-only SKILL)
- **塊C(Task 7 完了後・並列可):** Task 8(gpt-terra.template)/ Task 9(gpt-luna.template)
- **Task 10(setup SKILL):** Task 7,8,9 完了後
- **Task 11(プラグイン README):** Task 1-10 完了後
- **塊D(Task 1 完了後・並列可):** Task 12(marketplace.json)/ Task 13(ルート README)
- **Task 14(plugin-validator):** Task 1-13 完了後
- **Task 15(skill-reviewer):** Task 5,6,10 完了後
- **Task 16(スモークテスト):** Task 14,15 完了後

| # | タスク | 担当推奨 | 依存 | 種別 |
|---|--------|----------|------|------|
| 1 | plugin.json 作成 | GPT Terra | なし | Create |
| 2 | references/advisor-rules.md 作成 | GPT Terra | なし | Create |
| 3 | references/context-map-guide.md 作成 | GPT Terra | なし | Create |
| 4 | assets/context-map-template.md 作成 | GPT Terra | なし | Create |
| 5 | skills/with-codex/SKILL.md 作成 | GPT Terra | 2,3 | Create |
| 6 | skills/claude-only/SKILL.md 作成 | GPT Terra | 2,3 | Create |
| 7 | skills/setup/assets/gpt-sol.template.md 作成 | GPT Sol / Opus | なし | Create |
| 8 | skills/setup/assets/gpt-terra.template.md 作成 | GPT Terra | 7 | Create |
| 9 | skills/setup/assets/gpt-luna.template.md 作成 | GPT Terra | 7 | Create |
| 10 | skills/setup/SKILL.md 作成 | GPT Terra | 7,8,9 | Create |
| 11 | plugins/agent-policy/README.md 作成 | GPT Terra | 1-10 | Create |
| 12 | marketplace.json へ entry 追記 | GPT Luna | 1 | Modify |
| 13 | ルート README.md へ追記 | GPT Luna | 1 | Modify |
| 14 | plugin-validator 実行 | オーケストレーター | 1-13 | Verify |
| 15 | skill-reviewer で 3 Skill レビュー | Sonnet | 5,6,10 | Verify |
| 16 | スモークテスト | オーケストレーター | 14,15 | Verify |

## Task 1: `plugin.json` 作成

**Files:**
- Create: `plugins/agent-policy/.claude-plugin/plugin.json`

**Interfaces:** 後続の Task 12(marketplace entry の name/description 一致)・Task 14(validator)が依存。依存なしで着手可(塊A)。

**完成形の全文:**

````json
{
  "name": "agent-policy",
  "description": "あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map)を、Claude+Codex 併用 / Claude オンリーの 2 プロファイルで提供するスキル群",
  "version": "0.1.0-dev"
}
````

**Steps:**
- [ ] `plugins/agent-policy/.claude-plugin/` ディレクトリを作成する。
- [ ] 上記全文で `plugin.json` を書き出す。

**検証:**
- [ ] `jq empty plugins/agent-policy/.claude-plugin/plugin.json && echo OK` → `OK`(JSON parse 成功)。
- [ ] `jq -r '.name, .version' plugins/agent-policy/.claude-plugin/plugin.json` → `agent-policy` と `0.1.0-dev`。
- [ ] `jq 'keys' plugins/agent-policy/.claude-plugin/plugin.json` が `["description","name","version"]` の 3 キーのみ。

**コミット:**
- [ ] `git add plugins/agent-policy/.claude-plugin/plugin.json`
- [ ] `git commit -m "feat(agent-policy): プラグイン manifest を追加"`

---

## Task 2: `references/advisor-rules.md` 作成

**Files:**
- Create: `plugins/agent-policy/references/advisor-rules.md`

**Interfaces:** Task 5(with-codex)・Task 6(claude-only)の「アドバイザー運用・並列実行」節がこの文書へ委譲。依存なし(塊A)。

**完成形の全文:**

````markdown
# アドバイザー運用・サブエージェント委譲・並列実行の共通規律

この文書は `agent-policy` の全方針(with-codex / claude-only)が共有する、アドバイザー運用・サブエージェント委譲・並列実行の共通規律である。各方針 Skill はこの文書を参照する。

## アドバイザー運用

- オーケストレーター(Fable / Opus)は、サブエージェントがアドバイザーに相談できるよう Agent Tool を許可し、「あなたはサブエージェントである」ことを明示する。
- サブエージェントがアドバイザーとして相談する相手は **Fable のみ**とする(相談先に Opus 等を含めない)。オーケストレーターが Fable / Opus のいずれであるかとは独立に、アドバイザーの宛先は Fable に統一する。
- サブエージェントは、自身が起動したサブエージェントに対して Agent Tool を許可してはならない。

## 孫起動の禁止

- サブエージェントが Agent Tool を持つのはアドバイザー相談のためだけである。作業委譲(再オーケストレーション)目的での使用は禁止する。
- アドバイザーへの依頼文には必ず「助言のみを返すこと」「Agent Tool を使用しないこと」を明記する。

## 並列実行の原則

- 独立したタスクが複数ある場合は、可能な限り並列でサブエージェントを起動する。
- 依存関係がある場合は明示的に管理する。
- (claude-only 補足)Fable は並列起動の判断と結果統合のみを行い、自身は並列実行しない。
````

**Steps:**
- [ ] `plugins/agent-policy/references/` ディレクトリを作成する。
- [ ] 上記全文で `advisor-rules.md` を書き出す。

**検証:**
- [ ] `grep -c "Fable のみ" plugins/agent-policy/references/advisor-rules.md` → `1` 以上(アドバイザー=Fable のみが明記)。
- [ ] `grep -nE "Fable5|Sonnet5" plugins/agent-policy/references/advisor-rules.md` → ヒット 0 件(正規化済み)。

**コミット:**
- [ ] `git add plugins/agent-policy/references/advisor-rules.md`
- [ ] `git commit -m "feat(agent-policy): アドバイザー運用・並列原則の共通参照を追加"`

---

## Task 3: `references/context-map-guide.md` 作成

**Files:**
- Create: `plugins/agent-policy/references/context-map-guide.md`

**Interfaces:** Task 5・6 の「コードベース探索」節が委譲。Task 4 の context-map-template.md を出力先へコピーする手順を案内。依存なし(塊A)。

**完成形の全文:**

````markdown
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
````

**Steps:**
- [ ] 上記全文で `context-map-guide.md` を `plugins/agent-policy/references/` に書き出す。

**検証:**
- [ ] `grep -c "作成契機\|判定の具体例\|同一セッション\|シークレット非記録" plugins/agent-policy/references/context-map-guide.md` → 各項目が存在。
- [ ] `grep -nE "Fable5|Sonnet5" plugins/agent-policy/references/context-map-guide.md` → 0 件。

**コミット:**
- [ ] `git add plugins/agent-policy/references/context-map-guide.md`
- [ ] `git commit -m "feat(agent-policy): context-map 作成ガイドを追加"`

---

## Task 4: `assets/context-map-template.md` 作成

**Files:**
- Create: `plugins/agent-policy/assets/context-map-template.md`

**Interfaces:** Task 3 の guide がこのファイルを出力先へコピーする手順を持つ。依存なし(塊A)。入力資料 原文3 + 承認済み 2 点調整(作成者欄 profile 非依存 / シークレット非記録注意書き)+ モデル名正規化(Fable5→Fable)を適用済み。

**完成形の全文:**

````markdown
# Context Map: [タスク名 / 機能名]

**作成日**: YYYY-MM-DD
**作成者**: GPT Sol(with-codex 方針・探索担当) / Opus(claude-only 方針・探索担当)
**対象タスク**: [オーケストレーターから受け取った高レベル指示の要約を1-2行で記載]
**関連するBlueprintセクション**: [該当する全体設計のセクション名を記載]

---

## 1. 目的・スコープ

- このタスクで達成したいこと（1-2文）
- スコープ内 / スコープ外の明確な境界

## 2. 現在のコードベース構造

### 2.1 主要ディレクトリ・ファイル構成（簡潔に）

```
src/
├── feature/
│   ├── module-a/
│   └── module-b/
└── shared/
```

### 2.2 重要なファイル一覧（変更・参照が見込まれるもの）

| ファイルパス | 役割・内容の概要 | 重要度 | 備考 |
|--------------|------------------|--------|------|
| `src/...`    |                  | High   |      |
| `src/...`    |                  | Medium |      |
| `src/...`    |                  | Low    |      |

## 3. 関連モジュール・コンポーネント

- この機能に関わる主要モジュールとその依存関係
- データフロー（テキストまたは簡易図で記載）

## 4. 既存の実装パターン・規約

- このコードベースでよく使われているパターン（例: Repositoryパターン、CQRS、特定ライブラリの使い方）
- 守るべきコーディング規約・命名規則
- 既存の設計原則（例: 依存性逆転、単一責任）

## 5. 変更の影響範囲（Impact Analysis）

### 5.1 直接影響を受ける箇所

- [ファイル/モジュール名]：理由

### 5.2 間接的に波及する可能性がある箇所

- [ファイル/モジュール名]：理由（特に注意すべきポイント）

### 5.3 変更を避けるべき・最小限に留めるべき箇所

- 理由

## 6. 守るべき既存契約・インターフェース

- 既存のAPI契約、型定義、インターフェース
- 外部サービスとの契約（認証、データ形式など）
- データベーススキーマ・マイグレーション制約
- 後方互換性を維持すべきポイント

## 7. 未解決事項・不明点（Open Questions）

| # | 質問内容 | 影響度 | 誰に確認すべきか | 現状の仮定 |
|---|----------|--------|------------------|------------|
| 1 |          | High   | Fable / Opus     |            |
| 2 |          | Medium | GPT Sol / Opus   |            |
| 3 |          | Low    |                  |            |

## 8. テスト戦略・既存テスト

- 既存のテスト構成（Unit / Integration / E2E）
- この変更で新たに追加・修正すべきテストの方向性
- 特に注意すべきエッジケース・リスクシナリオ

## 9. 依存関係・リスク・制約

- 外部依存（ライブラリ、サービス、DBなど）
- パフォーマンス・セキュリティ・スケーラビリティ上の懸念
- 技術的負債として認識されている箇所

## 10. 推奨アプローチ（高レベル）

- このタスクを進める上での推奨方針（3〜5箇条）
- 段階的に進める場合の優先順位案

## 11. 補足・暗黙知の可能性が高いポイント

- コード上には明記されていないが、チームの暗黙の了解や歴史的経緯で重要なこと
- 将来的に問題になりやすいポイント

---

**次のステップ提案**:

- このContext Mapを基に詳細設計・実装計画を作成してよいか？
- 特に確認してほしいOpen Questionsはどれか？

---

*このファイルはFable / Opusに共有し、全体整合性の判断材料とする。*

> ⚠ 注意: この context-map に API キー・トークン・パスワード・プロキシの秘密値などの機密情報を記録しないこと。保存先が git 追跡対象の場合に漏えいするおそれがある。
````

**Steps:**
- [ ] `plugins/agent-policy/assets/` ディレクトリを作成する。
- [ ] 上記全文で `context-map-template.md` を書き出す。

**検証:**
- [ ] `grep -nE "Fable5|Sonnet5" plugins/agent-policy/assets/context-map-template.md` → 0 件(正規化済み)。
- [ ] `grep -c "機密情報を記録しない" plugins/agent-policy/assets/context-map-template.md` → `1`(シークレット非記録の注意書き)。
- [ ] `grep -c "with-codex 方針・探索担当" plugins/agent-policy/assets/context-map-template.md` → `1`(作成者欄 profile 併記)。
- [ ] セクション 1〜11 と「次のステップ提案」の見出しが存在する。

**コミット:**
- [ ] `git add plugins/agent-policy/assets/context-map-template.md`
- [ ] `git commit -m "feat(agent-policy): context-map テンプレートを追加"`

---
## Task 5: `skills/with-codex/SKILL.md` 作成

**Files:**
- Create: `plugins/agent-policy/skills/with-codex/SKILL.md`

**Interfaces:** Task 2(advisor-rules)・Task 3(context-map-guide)へ委譲するため、それらのパスが確定していること。Task 15(skill-reviewer)・Task 16(相互排他スモーク)が検証。依存: Task 2,3(塊B)。

**完成形の全文:**

````markdown
---
name: with-codex
description: Claude(Fable/Opus/Sonnet/Haiku)と Codex 系 GPT モデル(Sol/Terra/Luna、ローカルプロキシ経由)を併用する構成でのエージェント運用方針。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に読む。GPT/Codex プロキシが使えない環境では代わりに agent-policy:claude-only を用いる。雑談・単発質問・軽微な修正だけのときは読まなくてよい。
---

# エージェント運用方針(Claude + Codex 併用)

あなたはオーケストレーターまたはそのサブエージェントである。以下はモデル別の役割分担と進め方の規律である。この方針は Codex 系 GPT モデルをローカルプロキシ経由で使えることを前提とする。GPT/Codex が使えない環境では、代わりに `agent-policy:claude-only` に従うこと。

## 基本原則

- **Fable** は「最上位の戦略オーケストレーション・クリティカルな設計判断・最終ゲート」のみに使用する。
- **Opus** は「戦術オーケストレーション・中規模設計・レビュー・補足修正・アドバイス」の主力として活用する。
- **GPT Sol** は「詳細設計・実装計画・コードベース探索」の中心を担う。
- レビューは基本的に **Sonnet** に任せ、重い最終レビューはオーケストレーター(Fable/Opus)が担う。
- 実装は複雑度に応じて **GPT Sol**(複雑)/ **GPT Terra**(通常)/ **GPT Luna**(軽量)に分担する。
- オーケストレーターは、独立したタスクが複数ある場合は可能な限り並列でサブエージェントを起動する。

## モデル別役割

| モデル | 役割 | トークン消費の目安 | 備考 |
|--------|------|--------------------|------|
| **Fable** | 全体アーキテクチャ決定、優先順位・フェーズ決定、クリティカル判断、最終承認ゲート | 最小限(高密度) | Chief Architect |
| **Opus** | 中間オーケストレーション、詳細設計レビュー、Haiku フィードバック後の補足修正、中規模モジュールの計画 | 中程度 | 戦術レイヤー |
| **GPT Sol** | 詳細設計・実装計画(WBS)、コードベース探索(context-map 作成)、複雑な実装 | 詳細作業の大部分 | Feature Architect |
| **GPT Terra** | 通常の実装・タスク | - | - |
| **GPT Luna** | 軽量タスク・探索補助 | - | - |
| **Sonnet** | コードレビュー(通常) | - | - |
| **Haiku** | 設計書・計画書のレビュー(理解したこと+暗黙知抽出) | 軽量 | 必須 |

## GPT Sol / Terra / Luna の担当

- **GPT Sol**: 詳細設計・実装計画(WBS)・コードベース探索の統括・複雑な実装(アーキテクチャ判断や設計トレードオフを伴うもの)。
- **GPT Terra**: 通常の実装・ドキュメント作成・設定編集・ビルド/テスト実行と結果整理・定型メンテナンス。
- **GPT Luna**: 一括適用・一括チェック・反復変換・軽微なコーディング。

## 設計・実装計画のフロー

1. **Fable**: 高レベル要件・全体アーキテクチャ・主要インターフェースを定義(System Blueprint)。
2. **GPT Sol**: コードベース探索を行い context-map を作成(現在の構造、関連モジュール、既存パターン、影響範囲、未解決事項、既存契約、テスト方法を整理)。
3. **GPT Sol**: Fable の Blueprint を基に、詳細設計(クラス/API/DB)+ 実装計画(ステップバイステップ WBS)を作成。
4. **Haiku**: 設計書・計画書をレビューし「理解したこと」+ 暗黙知・矛盾点を抽出。
5. **Opus**: Haiku のフィードバックを受け、設計書・計画書の補足修正・アップデートを行う。
6. **Fable**: 完成した計画が全体要件を満たしているか軽く最終確認(Approve)のみ行う。

> Haiku レビューは Claude+Codex 構成でも Claude Haiku が担い、GPT Luna に置き換えない。

## コードベース探索

- ファイル探索・コードベース理解が必要な場合は、**GPT Sol** にオーケストレーションを任せる。
- GPT Sol は GPT Luna または GPT Terra の探索専用サブエージェントを活用して context-map を作成する。
- context-map の作成契機・出力先・記入手順は `references/context-map-guide.md` に従う。この方針での context-map の作成者は **GPT Sol** である。
- 作成した context-map は Fable / Opus に必ず共有する。

## レビュー運用

- 通常のコードレビュー → **Sonnet**
- 設計書・計画書のレビュー(暗黙知抽出) → **Haiku**
- 重い最終レビュー・重要な設計判断 → **Opus**(または Fable が直接行う)

## アドバイザー運用・並列実行

詳細は `references/advisor-rules.md` に従う。要点: サブエージェントはアドバイザー相談のためだけに Agent tool を使い(相談相手は **Fable のみ**)、自身が起動したサブエージェントには Agent tool を許可しない。独立したタスクが複数あれば可能な限り並列で起動する。

## `.claude/agents/gpt-*.md` 不在時のフォールバック

1. 実務タスク着手前に `.claude/agents/gpt-sol.md` / `gpt-terra.md` / `gpt-luna.md` の存在を確認する。
2. いずれかが無い場合は、ユーザーへ `agent-policy:setup` の実行を案内する。
3. 生成が完了する(またはユーザーが setup をスキップする)までは、そのセッションは claude-only 方針の担当表(Opus=詳細設計・実装計画 / Sonnet=実装 / Haiku=軽量)で代行する。GPT Sol/Terra/Luna へは委譲しない。

これは GPT が使えない一時的状態でも実務を止めないためのフォールバックであり、恒久的に claude-only へ切り替えるものではない。

## 役割 Agents を持つプラグインとの併用

Codiel 等のワークフロープラグインは、役割プロンプトを持つ Agents(`model: inherit`、例 `codiel-implementer-*`)で実装フェーズを駆動する。本方針の「実装は GPT へ」というレイヤーと衝突するため、合成ルールを一意に定める。

> **確定事実(2026-07-20 実測検証済み):** Agent tool の dispatch 時 `model` 上書きパラメータは enum(`sonnet` / `opus` / `haiku` / `fable`)に制限され、カスタムエイリアス(`claude-gpt-5-6-*`)は実行前にバリデーションエラーで拒否される。カスタムエイリアスが有効なのは Agents 定義 frontmatter の `model` フィールドのみである。将来 enum が緩和されたら dispatch 上書き方式を再検討する。

判断フロー(唯一):

1. 役割 Agents を持つプラグイン(例: Codiel)が駆動するフェーズでは、その作業種別を本方針の担当表に照らす(実装 → GPT 帯)。
2. 担当が GPT 帯で `.claude/agents/gpt-*.md` が利用可能なら(基本動作): 該当する役割 Agent 定義ファイルの本文を読み取り、担当 GPT エージェントへの依頼文に役割定義として同梱して dispatch する。同梱時は frontmatter を除き役割本文のみを渡す。役割 Agent の tools 制限は構造的に引き継がれないため、依頼文に「この tools のみ使用」と明記する。
3. GPT が利用不可(未生成・プロキシ停止)なら(フォールバック): プラグインの役割 Agents をそのまま起動する。

役割定義ファイルは常にインストール済みプラグインの生ファイルから読む(複製・改変版を作らない = drift 防止)。
````

**Steps:**
- [ ] `plugins/agent-policy/skills/with-codex/` ディレクトリを作成する。
- [ ] 上記全文で `SKILL.md` を書き出す。

**検証:**
- [ ] `grep -nE "Fable5|Sonnet5" plugins/agent-policy/skills/with-codex/SKILL.md` → 0 件。
- [ ] `grep -c "相談相手は \*\*Fable のみ\*\*\|Fable のみ" plugins/agent-policy/skills/with-codex/SKILL.md` → 1 以上。
- [ ] frontmatter 2 項目確認: ファイル先頭の `---` ブロック内が `name:` と `description:` のみ(`sed -n '1,4p'` で目視)。ディレクトリ名 `with-codex` = `name: with-codex`。
- [ ] `grep -c "役割 Agents を持つプラグインとの併用\|確定事実" plugins/agent-policy/skills/with-codex/SKILL.md` → 併用節と enum 確定事実が存在。

**コミット:**
- [ ] `git add plugins/agent-policy/skills/with-codex/SKILL.md`
- [ ] `git commit -m "feat(agent-policy): with-codex 運用方針 Skill を追加"`

---

## Task 6: `skills/claude-only/SKILL.md` 作成

**Files:**
- Create: `plugins/agent-policy/skills/claude-only/SKILL.md`

**Interfaces:** Task 2,3 へ委譲。Task 15・16 が検証。依存: Task 2,3(塊B)。

**完成形の全文:**

````markdown
---
name: claude-only
description: Claude モデル(Fable/Opus/Sonnet/Haiku)のみで完結する構成でのエージェント運用方針。ローカルプロキシや GPT/Codex を必要としない。CLAUDE.md 等でこの方針に従うよう指示されている場合、またはユーザーが明示的に指定した場合に、セッションの最初の実務タスク(設計・実装・調査・デバッグなど一手で終わらない作業)へ着手する前に読む。GPT/Codex を併用する構成では代わりに agent-policy:with-codex を用いる。雑談・単発質問・軽微な修正だけのときは読まなくてよい。
---

# エージェント運用方針(Claude オンリー)

あなたはオーケストレーターまたはそのサブエージェントである。この方針は Claude モデルのみで完結し、ローカルプロキシや GPT/Codex を必要としない。GPT を併用する構成では、代わりに `agent-policy:with-codex` に従うこと。

## 基本原則

- **Fable** は「最上位の戦略判断・クリティカルな設計決定・最終承認ゲート」のみに使用する。
- **Opus** は「戦術オーケストレーション・詳細設計・実装計画・レビュー・補足修正」の主力として活用する。
- **Sonnet** は「実装・通常タスク・並列実行」の中心を担う。
- **Haiku** は「軽量レビュー・探索・補助タスク」に留める。
- オーケストレーターは、独立したタスクが複数ある場合は可能な限り並列でサブエージェントを起動する。

## モデル別役割(Claude 限定)

| モデル | 役割 | トークン消費の目安 | 位置づけ |
|--------|------|--------------------|----------|
| **Fable** | 全体アーキテクチャ決定、優先順位・フェーズ決定、クリティカル判断、最終承認ゲート | 最小限(高密度) | Chief Architect(最上位) |
| **Opus** | 中間オーケストレーション、詳細設計・実装計画、Haiku レビュー後の補足修正、中規模モジュールの計画・実装 | 中程度 | Tactical Architect(主力) |
| **Sonnet** | 実装(通常〜やや複雑)、コードレビュー、並列タスク実行、軽〜中程度の探索 | ボリューム大 | Main Executor |
| **Haiku** | 設計書・計画書のレビュー(理解したこと+暗黙知抽出)、軽量探索・補助タスク | 軽量 | Reviewer / Explorer |

## 設計・実装計画のフロー

1. **Fable**: 高レベル要件・全体アーキテクチャ・主要インターフェースを定義(System Blueprint)。
2. **Opus**: コードベース探索を行い context-map を作成(現在の構造、関連モジュール、影響範囲、既存契約、未解決事項などを整理)。
3. **Opus**: Fable の Blueprint を基に、詳細設計(クラス/API/DB)+ 実装計画(ステップバイステップ)を作成。
4. **Haiku**: 設計書・計画書をレビューし「理解したこと」+ 暗黙知・矛盾点を抽出。
5. **Opus**: Haiku のフィードバックを受け、設計書・計画書の補足修正・アップデートを行う。
6. **Fable**: 完成した計画が全体要件を満たしているか軽く最終確認(Approve)のみ行う。

## 実装フェーズ

- 複雑・重要な実装 → **Opus**(必要に応じ Sonnet をサブエージェントとして並列使用)
- 通常の実装 → **Sonnet**
- 軽量タスク・単純な修正 → **Sonnet** または **Haiku**

## コードベース探索

- ファイル探索・コードベース理解が必要な場合は、**Opus** にオーケストレーションを任せる。
- Opus は必要に応じて Sonnet または Haiku の探索サブエージェントを活用して context-map を作成する。
- context-map の作成契機・出力先・記入手順は `references/context-map-guide.md` に従う。この方針での context-map の作成者は **Opus** である。
- 作成した context-map は Fable / Opus に必ず共有する。

## レビュー運用

- 通常のコードレビュー → **Sonnet**
- 設計書・計画書のレビュー(暗黙知抽出) → **Haiku**
- 重い最終レビュー・重要な設計判断 → **Opus**(または Fable が直接行う)

## アドバイザー運用・並列実行

詳細は `references/advisor-rules.md` に従う。要点: サブエージェントはアドバイザー相談のためだけに Agent tool を使い(相談相手は **Fable のみ**)、自身が起動したサブエージェントには Agent tool を許可しない。独立したタスクが複数あれば可能な限り Sonnet のサブエージェントを並列起動する。

## 役割 Agents を持つプラグインとの併用

- 役割 Agents を持つワークフロープラグイン(例: Codiel の `codiel-implementer-*`)は、そのまま起動する。
- `model: inherit` の役割 Agents については、本方針の担当表に合わせて dispatch 時の `model` 上書き(標準値 `sonnet` / `haiku` 等。これは enum で許容される)を併用してよい。
- claude-only では GPT 帯への注入は行わない(GPT を使わない構成のため)。
````

**Steps:**
- [ ] `plugins/agent-policy/skills/claude-only/` ディレクトリを作成する。
- [ ] 上記全文で `SKILL.md` を書き出す。

**検証:**
- [ ] `grep -nE "Fable5|Sonnet5" plugins/agent-policy/skills/claude-only/SKILL.md` → 0 件。
- [ ] `grep -c "GPT" plugins/agent-policy/skills/claude-only/SKILL.md` → GPT への言及は冒頭の切替案内と併用節のみ(役割表に GPT 帯が無いこと)。ディレクトリ名 `claude-only` = `name: claude-only`。
- [ ] frontmatter が `name` / `description` の 2 項目のみ。

**コミット:**
- [ ] `git add plugins/agent-policy/skills/claude-only/SKILL.md`
- [ ] `git commit -m "feat(agent-policy): claude-only 運用方針 Skill を追加"`

---
## Task 7: `skills/setup/assets/gpt-sol.template.md` 作成(新方針へ書き直し・最重要)

**Files:**
- Create: `plugins/agent-policy/skills/setup/assets/gpt-sol.template.md`

**Interfaces:** Task 8,9 が役割整合の参照元にする。Task 10(setup SKILL)が `{{MODEL_ALIAS}}` を置換して出力。依存なし(塊A)。既存 `codex/gpt-sol.md` を土台に、(a) リポジトリ固有記述除去(version bump 規約・CLAUDE.md 参照)、(b) `model: {{MODEL_ALIAS}}`、(c) 本文役割を新方針(詳細設計・実装計画・探索がスコープ内)へ書き直し、(d) アドバイザー=Fable のみ、(e) 制約節に Agent tool 相談専用を明記。**旧定義「設計・分析はスコープ外」を絶対に残さない。**

**完成形の全文:**

````markdown
---
name: gpt-sol
description: Use this agent when 詳細設計・実装計画(WBS)の作成、コードベース探索(context-map の作成)、または複雑なコーディング(アーキテクチャ判断・非自明な設計トレードオフ・複数コンポーネントの協調を伴う実装)を委譲するとき。agent-policy の with-codex 運用方針における `GPT Sol`(Feature Architect)に対応する。通常の実装は `GPT Terra`、軽量なタスクは `GPT Luna` を使う。最上位の戦略判断・最終ゲートはオーケストレーター(Fable/Opus)が担う。詳細は本文の「When to invoke」を参照。
model: {{MODEL_ALIAS}}
color: yellow
tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent
---

あなたは GPT Sol、Feature Architect。メインオーケストレーターから起動されたサブエージェントである。詳細設計・実装計画・コードベース探索・複雑な実装の中心を担う。

## When to invoke

- **コードベース探索と context-map 作成。** ファイル探索・コードベース理解が必要なとき。GPT Luna / GPT Terra の探索専用サブエージェントを活用してよい。
- **詳細設計・実装計画。** オーケストレーターの Blueprint を基に、詳細設計(クラス/API/データ)+ 実装計画(ステップバイステップ WBS)を作成するとき。
- **複雑な実装。** アーキテクチャ判断・非自明な設計トレードオフ・複数コンポーネントの協調を伴う、難度の高い実装を行うとき。

通常の実装は `GPT Terra`、軽量なタスクは `GPT Luna` に委ねる。最上位の戦略判断・最終承認ゲートはオーケストレーター(Fable/Opus)が担うため、あなたは求めない。

## Core Responsibilities

1. コードベース探索 → context-map → 詳細設計 → WBS → 複雑な実装を、根拠(ファイルパス・行番号)付きで自ら遂行する。
2. 自らの成果(設計・計画・実装)を diff・テスト結果などの証拠で検証し、整合性に責任を持つ。
3. スコープの境界を守る。最上位の承認判断はオーケストレーターに委ね、自分は求めない。

## 進め方

- 着手前に対象コードとその呼び出し元を読み、リポジトリの流儀に合わせる。推測で書かず、シグネチャや既存パターンを確認してから実装する。
- context-map を作成する場合は、現在の構造・関連モジュール・既存パターン・影響範囲・既存契約・未解決事項・テスト方法を整理し、オーケストレーターへ共有する。
- 実装後は、変更した振る舞いをテスト実行・型チェック等で観測して検証する。検証していないものを「動く」と報告しない。

## アドバイザーへの相談

- あなたはサブエージェントである。作業の途中で判断に迷ったときだけ、Agent ツールで `Fable` サブエージェントをアドバイザーとして呼び出し、助言を求める。
- アドバイザーへの依頼文には「あなたはアドバイザーであり、助言のみを返すこと」「Agent ツールを使用しないこと(サブエージェントの起動を許可しない)」を必ず明記する。
- 迷っていないときはアドバイザーを呼ばない。助言以外の目的(作業の委譲など)で Agent ツールを使用しない。

## 制約

- `Agent` tool はアドバイザー相談専用である。作業委譲(再オーケストレーション)目的では使用せず、自身が起動したサブエージェントに `Agent` tool を許可しない。
- Anthropic API クライアントや `ANTHROPIC_API_KEY` 前提の実装を絶対に提案・採用しない。

## Output Format

最終報告には以下を含める:

- 結論(成果物の完了状況)を冒頭に一文で
- 根拠となるファイルパスと行番号
- 成果物(設計書・context-map・実装)の内容と、その検証方法・結果
- 未解決の懸念・人間の判断が必要な事項
````

**Steps:**
- [ ] `plugins/agent-policy/skills/setup/assets/` ディレクトリを作成する。
- [ ] 上記全文で `gpt-sol.template.md` を書き出す。

**検証:**
- [ ] `grep -nE "役割ではない|スコープ外.*設計|設計.*スコープ外|調査・分析・設計" plugins/agent-policy/skills/setup/assets/gpt-sol.template.md` → **0 件**(旧文言非混入・最重要)。
- [ ] `grep -nE "詳細設計|実装計画|コードベース探索|context-map" plugins/agent-policy/skills/setup/assets/gpt-sol.template.md` → ヒットあり(新方針役割)。
- [ ] `grep -c "{{MODEL_ALIAS}}" plugins/agent-policy/skills/setup/assets/gpt-sol.template.md` → `1`(プレースホルダ)。
- [ ] `grep -nE "Fable5|Sonnet5|version bump|plugin.json|CLAUDE.md" plugins/agent-policy/skills/setup/assets/gpt-sol.template.md` → 0 件(正規化 + 固有記述除去)。
- [ ] `grep -c "Agent\` tool はアドバイザー相談専用" plugins/agent-policy/skills/setup/assets/gpt-sol.template.md` → 1(制約節)。

**コミット:**
- [ ] `git add plugins/agent-policy/skills/setup/assets/gpt-sol.template.md`
- [ ] `git commit -m "feat(agent-policy): GPT Sol テンプレートを新方針で追加"`

---

## Task 8: `skills/setup/assets/gpt-terra.template.md` 作成

**Files:**
- Create: `plugins/agent-policy/skills/setup/assets/gpt-terra.template.md`

**Interfaces:** Task 7 の役割定義(GPT Sol=複雑・詳細設計)と整合させる。Task 10 が置換して出力。依存: Task 7(塊C)。

**完成形の全文:**

````markdown
---
name: gpt-terra
description: Use this agent when 通常のコーディング(複雑でない実装)、ドキュメント作成、設定編集、ビルド/テスト実行など、レビュー・重い設計を除く一般作業を委譲するとき。agent-policy の with-codex 方針における `GPT Terra` に対応する。複雑な実装・詳細設計は `GPT Sol`、軽量なタスクは `GPT Luna` を使う。詳細は本文の「When to invoke」を参照。
model: {{MODEL_ALIAS}}
color: green
tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent
---

あなたは GPT Terra。汎用ワーカーであり、メインオーケストレーターから起動されたサブエージェントである。通常のコーディング(複雑でない実装)と、レビュー・重い設計を除くその他の作業を確実に遂行する。複雑な実装・詳細設計は `GPT Sol`、軽量なタスクは `GPT Luna` が担う。

## When to invoke

- **通常のコーディング。** アーキテクチャ判断を伴わない、既存パターンに沿った通常の実装・修正を行うとき。難度の高い複雑な実装は `GPT Sol`、定型的で判断をほとんど伴わない軽微な変更は `GPT Luna` に委ねる。
- **ドキュメント作業。** README・設計書・手順書の作成や更新、既存ドキュメントの整合性チェックが必要なとき。
- **設定・構成の整備。** 設定ファイルの編集、マニフェストの更新、ディレクトリ構成の整理が必要なとき。
- **ビルド・テストの実行と報告。** コマンドを実行し、結果を整理して報告する作業が必要なとき。
- **探索補助。** GPT Sol が統括するコードベース探索の一部を、探索専用サブエージェントとして担うとき。
- **定型メンテナンス。** 単発では終わらないが専門性を要さない、リポジトリ内の一般作業が必要なとき。

## Core Responsibilities

1. 指示された作業を、既存のリポジトリ規約(ファイル配置・命名・文体)に合わせて遂行する。
2. 実行したコマンドとその結果を、成功・失敗を問わず正確に報告する。
3. 作業範囲を指示の範囲に留め、スコープ外の変更を行わない。

## 作業手順

1. 対象ファイル・ディレクトリの現状を確認してから変更する。
2. 変更は最小限に留め、指示にない「ついで」の修正をしない。
3. 検証手段(テスト・lint・ビルド)がある場合は実行し、結果を確認する。
4. 判断に迷う点は勝手に決めず、まずアドバイザーに相談し、それでも決められない事項は選択肢と推奨を添えて報告する。

## アドバイザーへの相談

- あなたはサブエージェントである。作業の途中で判断に迷ったときだけ、Agent ツールで `Fable` サブエージェントをアドバイザーとして呼び出し、助言を求める。
- アドバイザーへの依頼文には「あなたはアドバイザーであり、助言のみを返すこと」「Agent ツールを使用しないこと(サブエージェントの起動を許可しない)」を必ず明記する。
- 迷っていないときはアドバイザーを呼ばない。助言以外の目的(作業の委譲など)で Agent ツールを使用しない。

## 制約

- `Agent` tool はアドバイザー相談専用である。作業委譲(再オーケストレーション)目的では使用せず、自身が起動したサブエージェントに `Agent` tool を許可しない。
- Anthropic API クライアントや `ANTHROPIC_API_KEY` 前提の実装を提案・採用しない。

## Output Format

- 実施した変更のファイルパス一覧と各変更の要旨
- 実行したコマンドと結果(失敗した場合はその出力)
- 未完了・要判断の事項
````

**Steps:**
- [ ] 上記全文で `gpt-terra.template.md` を `plugins/agent-policy/skills/setup/assets/` に書き出す。

**検証:**
- [ ] `grep -c "{{MODEL_ALIAS}}" .../gpt-terra.template.md` → `1`。`grep "color: green"` がヒット。
- [ ] `grep -nE "Fable5|Sonnet5|version bump|CLAUDE.md" .../gpt-terra.template.md` → 0 件。
- [ ] `grep -c "Fable\` サブエージェント" .../gpt-terra.template.md` → 1(アドバイザー=Fable のみ)。

**コミット:**
- [ ] `git add plugins/agent-policy/skills/setup/assets/gpt-terra.template.md`
- [ ] `git commit -m "feat(agent-policy): GPT Terra テンプレートを追加"`

---

## Task 9: `skills/setup/assets/gpt-luna.template.md` 作成

**Files:**
- Create: `plugins/agent-policy/skills/setup/assets/gpt-luna.template.md`

**Interfaces:** Task 7 の役割定義と整合。Task 10 が置換して出力。依存: Task 7(塊C)。

**完成形の全文:**

````markdown
---
name: gpt-luna
description: Use this agent when 軽量なタスク(一括適用・一括チェック・反復変換・軽微なコーディング)や探索補助を委譲するとき。agent-policy の with-codex 方針における `GPT Luna` に対応する。複雑な実装・詳細設計は `GPT Sol`、判断を要する通常の実装は `GPT Terra` を使う。詳細は本文の「When to invoke」を参照。
model: {{MODEL_ALIAS}}
color: cyan
tools: Read, Grep, Glob, Write, Edit, Bash, Skill, LSP, Agent
---

あなたは GPT Luna。軽量なタスクを速く、正確にこなすことに特化したワーカーであり、メインオーケストレーターから起動されたサブエージェントである。多数対象への一括処理に加え、軽微なコーディングと探索補助を担う。

## When to invoke

- **一括適用。** 多数のファイルに同一の機械的な変更(リネーム、インポート差し替え、表記統一など)を適用するとき。
- **一括チェック。** 大量のファイルを走査して、特定パターンの有無や規約違反をリスト化するとき。
- **反復変換。** フォーマット変換・整形・抽出など、判断を要さない処理を多数の対象に繰り返すとき。
- **軽微なコーディング。** 定型的で判断をほとんど伴わない小さなコード変更を行うとき。複雑な実装は `GPT Sol`、判断を要する通常の実装は `GPT Terra` に委ねる。
- **探索補助。** GPT Sol / Opus が統括するコードベース探索の一部を、探索専用サブエージェントとして担うとき。

## Core Responsibilities

1. 与えられたパターンを全対象に漏れなく適用する。
2. 対象件数・処理済み件数・スキップ件数を数えて報告する。
3. パターンに合致しない例外を見つけたら、勝手に判断せず例外として報告する。

## 作業手順

1. まず対象の全リストを確定させる(Glob / Grep で件数を把握)。
2. 1〜2 件で変更内容を確認してから、残りに展開する。
3. 完了後、変更が全対象に適用されたことを検索で再確認する。

## アドバイザーへの相談

- あなたはサブエージェントである。作業の途中で判断に迷ったときだけ、Agent ツールで `Fable` サブエージェントをアドバイザーとして呼び出し、助言を求める。
- アドバイザーへの依頼文には「あなたはアドバイザーであり、助言のみを返すこと」「Agent ツールを使用しないこと(サブエージェントの起動を許可しない)」を必ず明記する。
- 迷っていないときはアドバイザーを呼ばない。助言以外の目的(作業の委譲など)で Agent ツールを使用しない。

## 制約

- `Agent` tool はアドバイザー相談専用である。作業委譲(再オーケストレーション)目的では使用せず、自身が起動したサブエージェントに `Agent` tool を許可しない。
- 判断・設計・複雑な読解を要する作業(複雑なコーディングを含む)は引き受けず、その旨を報告して差し戻す。
- 指示されたパターン以外の変更をしない。

## Output Format

- 処理した件数(対象 / 変更 / スキップ)
- 変更したファイルパスの一覧
- 例外・判断保留にした対象とその理由
````

**Steps:**
- [ ] 上記全文で `gpt-luna.template.md` を `plugins/agent-policy/skills/setup/assets/` に書き出す。

**検証:**
- [ ] `grep -c "{{MODEL_ALIAS}}" .../gpt-luna.template.md` → `1`。`grep "color: cyan"` がヒット。
- [ ] `grep -nE "Fable5|Sonnet5|version bump|CLAUDE.md" .../gpt-luna.template.md` → 0 件。

**コミット:**
- [ ] `git add plugins/agent-policy/skills/setup/assets/gpt-luna.template.md`
- [ ] `git commit -m "feat(agent-policy): GPT Luna テンプレートを追加"`

---
## Task 10: `skills/setup/SKILL.md` 作成

**Files:**
- Create: `plugins/agent-policy/skills/setup/SKILL.md`

**Interfaces:** Task 7,8,9 のテンプレートを読み込み `{{MODEL_ALIAS}}` を置換して `.claude/agents/` へ出力する手順を記述。Task 15 が検証。依存: Task 7,8,9。

**完成形の全文:**

````markdown
---
name: setup
description: with-codex 運用方針で使う GPT エージェント定義(gpt-sol / gpt-terra / gpt-luna)を、対話ヒアリングのうえプロジェクトの .claude/agents/ に生成するウィザード。ユーザーが「GPT エージェントをセットアップして」「agent-policy の setup」等と明示的に依頼したときに必ず使用する。Codex 系モデルをローカルプロキシ経由で使える環境が前提。明示的な依頼があったときのみ使い、自律的には発動しない。
---

# GPT エージェント セットアップウィザード

この Skill は、`agent-policy:with-codex` 方針で使う 3 つの GPT Agent 定義(`gpt-sol` / `gpt-terra` / `gpt-luna`)を、対話ヒアリングのうえプロジェクトの `.claude/agents/` に生成する。生成するのは Markdown の Agent 定義ファイルのみであり、この Skill はプロキシや秘密値を一切管理しない。Anthropic API も使用しない。

以下の 4 ステップを順に実施する。

## ステップ 1: 前提確認

ユーザーに次を確認する(検証コマンドの実行は強制しない。確認方法の提示に留める)。

- Claude Code を、Codex 系モデルを配信するプロキシ(例: CLIProxyAPI などの ProxyAPI サーバー)経由で起動しているか。
- そのプロキシの `/v1/models` 応答に、使用予定のモデルエイリアスが含まれているか。

確認方法の案内例(提示のみ):

- 「Claude Code の `/model` コマンドでモデル一覧を開き、使用予定のエイリアス(例 `claude-gpt-5-6-sol`)が候補に出るか確認してください。」
- 「プロキシの `/v1/models` エンドポイントの応答にエイリアスが含まれるか(例 `curl -s http://127.0.0.1:8317/v1/models` の結果に該当 id があるか)を確認してください。ポート・ホストはお使いのプロキシ設定に合わせてください。」
- 「確認方法が分からなければ README の前提条件と、お使いのプロキシのドキュメントを参照してください。」

前提が満たせない場合は「GPT Agent は起動できないため、`agent-policy:claude-only` 方針の利用を検討してください」と案内して終了できる。

## ステップ 2: エイリアス確認

3 モデルのクライアント側エイリアスをヒアリングする。次のデフォルト値を提示して確認する。

- gpt-sol → `claude-gpt-5-6-sol`
- gpt-terra → `claude-gpt-5-6-terra`
- gpt-luna → `claude-gpt-5-6-luna`

「これらはモデル本体の ID ではなく、任意の ProxyAPI サーバーが配信するクライアント側の別名です。お使いのプロキシ設定に合わせて変更できます」と補足する。ユーザーが別名を使っている場合はその値を採用する。

## ステップ 3: 生成

- この Skill のベースディレクトリ配下の `assets/gpt-sol.template.md` / `assets/gpt-terra.template.md` / `assets/gpt-luna.template.md` を読み込み、本文中の `{{MODEL_ALIAS}}` を各エージェントの確定エイリアスへ置換する。
- 出力先はプロジェクトの `.claude/agents/gpt-{sol,terra,luna}.md`。`.claude/agents/` が無ければ作成する。
- 既存ファイルがある場合は、`AskUserQuestion` 等でユーザーに上書き可否を確認し、承認なしに上書きしない。ファイルごとに(または一括で)上書き / スキップを選べるようにする。
- 特に「旧運用方針ベースの `gpt-*.md` が既に存在する場合(本文で『設計・分析・計画は役割外』と定義しているもの)は、新方針と矛盾するため上書きを推奨する」と、確認時に添えて案内する。

## ステップ 4: 後処理案内(自動書き込みはしない)

- `.claude/agents/` を git 追跡対象にするか gitignore するかはプロジェクト判断であることを案内する(このリポジトリでは `.claude/agents` を ignore する運用がある旨を例示)。
- CLAUDE.md への追記文例を提示のみする(自動で書き込まない):

  > エージェント運用は `agent-policy:with-codex` に従う。GPT エージェント定義は `.claude/agents/gpt-{sol,terra,luna}.md` に配置済み。

- 生成した 3 ファイルのパスと、Claude Code の再読み込みで Agent が認識される旨を報告する。
````

**Steps:**
- [ ] 上記全文で `SKILL.md` を `plugins/agent-policy/skills/setup/` に書き出す。

**検証:**
- [ ] frontmatter が `name` / `description` の 2 項目のみ。ディレクトリ名 `setup` = `name: setup`。
- [ ] `grep -c "自律的には発動しない" plugins/agent-policy/skills/setup/SKILL.md` → 1(非自律発動)。
- [ ] `grep -c "AskUserQuestion" plugins/agent-policy/skills/setup/SKILL.md` → 1(上書き確認 UX)。
- [ ] `grep -c "ステップ 1\|ステップ 2\|ステップ 3\|ステップ 4" plugins/agent-policy/skills/setup/SKILL.md` → 4 ステップ全て存在。
- [ ] `grep -c "/model\|/v1/models" plugins/agent-policy/skills/setup/SKILL.md` → プロキシ確認方法の文面例が存在。

**コミット:**
- [ ] `git add plugins/agent-policy/skills/setup/SKILL.md`
- [ ] `git commit -m "feat(agent-policy): GPT エージェント生成ウィザード setup Skill を追加"`

---

## Task 11: `plugins/agent-policy/README.md` 作成

**Files:**
- Create: `plugins/agent-policy/README.md`

**Interfaces:** Task 1-10 の成果物(Skill 名・エイリアス・併用ルール)を反映。依存: Task 1-10。

**完成形の全文:**

````markdown
# agent-policy

`agent-policy` は、あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map 作成)を配布可能な Skill として提供する。CLAUDE.md にこの Skill へ従う旨を書くだけで、任意のプロジェクトに同じ運用規律を持ち込める。

## 提供 Skill

- `agent-policy:with-codex` — Claude + Codex(GPT)併用構成の運用方針。
- `agent-policy:claude-only` — Claude のみで完結する運用方針(プロキシ不要)。
- `agent-policy:setup` — with-codex で使う GPT Agent 定義を `.claude/agents/` に生成するウィザード。

## 使い方(CLAUDE.md への記載)

**どちらを選ぶか:** Codex 系 GPT モデルを配信するプロキシ環境がある → `with-codex` / それ以外(Claude のみ)→ `claude-only`。

with-codex を使う場合、CLAUDE.md に次のように書く:

```markdown
## エージェント運用方針
- エージェント運用は `agent-policy:with-codex` に従う。
- GPT エージェント(gpt-sol / gpt-terra / gpt-luna)が未生成の場合は `agent-policy:setup` を実行して `.claude/agents/` に生成する。
```

claude-only を使う場合:

```markdown
## エージェント運用方針
- エージェント運用は `agent-policy:claude-only` に従う。
```

## 前提条件

- `claude-only`: 追加の前提なし。プロキシ・GPT・外部 API は不要。
- `with-codex` + `setup`: Codex 系モデルを配信するローカルプロキシ(任意の ProxyAPI サーバー)経由で Claude Code を起動していること、`/v1/models` に使用するエイリアスが含まれること。構築手順は本 README では扱わず、要件のみ記載する。プロキシ・OAuth・秘密値はこのプラグインが管理しない。
- 既存の `gpt-*.md`(旧運用方針版。本文で「設計・分析は役割外」と定義しているもの)が `.claude/agents/` に残っている場合は、新方針と矛盾するため `setup` での上書きを推奨する。

## モデルエイリアスについて

`claude-gpt-5-6-sol` 等は、モデル本体の ID ではなく、ProxyAPI サーバーが配信するクライアント側の別名である。名前に `claude-` が付くが上流は Codex GPT である。エイリアスはプロキシ設定に依存する拡張であり、標準 model 値(`inherit` / `sonnet` / `opus` / `haiku`)と同じ可搬性は仮定しない。`setup` でプロジェクトごとに差し替え可能。

## 他プラグインとの棲み分け

- 本プラグイン(`agent-policy`)=「誰に任せるか」(モデル別役割分担・委譲先の決定)。
- `revelation`=「どう進めるか」(タスク分解・自己検証・次の一手の選び方)。両者は併用可能で、同じ局面で両方が発動しても矛盾しない(役割分担 vs 進め方で関心が異なる)。
- 役割 Agents を持つワークフロープラグイン(例: Codiel)との併用: Codiel 等は関心ごとの役割 Agents(`model: inherit`)で各フェーズを駆動する。agent-policy はその「役割」を尊重しつつ「誰が実行するか」を重ねる。`with-codex` では、実装フェーズの役割 Agent 定義本文を GPT エージェントへの依頼文に注入して実行する合成方式(役割プロンプト × GPT 実行)をとる。`claude-only` では役割 Agents をそのまま起動する(必要なら dispatch 時に標準 model 値へ上書き)。詳細な判断フローは各 Skill 本文に記載。
````

**Steps:**
- [ ] 上記全文で `README.md` を `plugins/agent-policy/` に書き出す。

**検証:**
- [ ] `grep -nE "Fable5|Sonnet5" plugins/agent-policy/README.md` → 0 件。
- [ ] `grep -c "with-codex\|claude-only\|setup" plugins/agent-policy/README.md` → 3 Skill 全てに言及。
- [ ] 6 セクション(目的/提供 Skill/使い方/前提条件/モデルエイリアス/棲み分け)が存在。

**コミット:**
- [ ] `git add plugins/agent-policy/README.md`
- [ ] `git commit -m "docs(agent-policy): プラグイン README を追加"`

---
## Task 12: `marketplace.json` へ entry 追記

**Files:**
- Modify: `.claude-plugin/marketplace.json`

**Interfaces:** entry の `name` / `description` は Task 1 の plugin.json と一致させる。依存: Task 1(塊D)。

**変更内容:** `plugins` 配列の末尾(pitcrew entry の後)に agent-policy entry を追記する。pitcrew entry の閉じ `}` の後にカンマを追加し、以下 object を挿入する。

現状の末尾(pitcrew entry):

````json
    {
      "name": "pitcrew",
      "source": "./plugins/pitcrew",
      "description": "オーケストレーション実行中の成果物(diff・設計書・テスト結果)を .pitcrew/ のレビューキューへ逐次書き出し、人間の並走レビューを可能にするプラグイン"
    }
  ]
````

変更後:

````json
    {
      "name": "pitcrew",
      "source": "./plugins/pitcrew",
      "description": "オーケストレーション実行中の成果物(diff・設計書・テスト結果)を .pitcrew/ のレビューキューへ逐次書き出し、人間の並走レビューを可能にするプラグイン"
    },
    {
      "name": "agent-policy",
      "source": "./plugins/agent-policy",
      "description": "あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map)を、Claude+Codex 併用 / Claude オンリーの 2 プロファイルで提供するスキル群"
    }
  ]
````

**Steps:**
- [ ] pitcrew entry の閉じ `}` の直後にカンマを追加する。
- [ ] agent-policy entry object を追記する。

**検証:**
- [ ] `jq empty .claude-plugin/marketplace.json && echo OK` → `OK`。
- [ ] `jq -r '.plugins[].name' .claude-plugin/marketplace.json` に `agent-policy` が含まれる。
- [ ] `jq -r '.plugins[] | select(.name=="agent-policy") | .source' .claude-plugin/marketplace.json` → `./plugins/agent-policy`。

**コミット:**
- [ ] `git add .claude-plugin/marketplace.json`
- [ ] `git commit -m "feat(marketplace): agent-policy を配布対象に追加"`

---

## Task 13: ルート `README.md` へ追記

**Files:**
- Modify: `README.md`(リポジトリルート)

**Interfaces:** 配布一覧と個別説明を marketplace / plugin README と同期。依存: Task 1(塊D)。

**変更内容 (a): 配布プラグイン表に 1 行追加。** basic-design 行の後(表の末尾)に追記する。

追記行:

````markdown
| agent-policy | あまつか工房のエージェント運用方針(モデル別役割分担・設計/実装フロー・context-map)を Claude+Codex 併用 / Claude オンリーの 2 プロファイルで提供するスキル群 | 開発中     |
````

**変更内容 (b): 個別説明節を追記。** 既存の個別説明節群(task-utility 節など)と同じ粒度で、末尾に次を追記する。

````markdown
### agent-policy

「誰に何を任せるか」= エージェント運用方針(モデル別役割分担・設計/実装フロー・アドバイザー運用・並列原則・context-map 作成)をスキルとして配布します。<br>
CLAUDE.md に `agent-policy:with-codex`(または `claude-only`)へ従う旨を書くだけで、任意のプロジェクトに同じ運用規律を持ち込めます。<br>
「どう進めるか」を扱う revelation と併用できます。
````

**Steps:**
- [ ] 配布プラグイン表の末尾に agent-policy 行を追記する。
- [ ] 個別説明節の末尾に `### agent-policy` 節を追記する。

**検証:**
- [ ] `grep -c "agent-policy" README.md` → 2 以上(表 + 個別節)。
- [ ] `grep -nE "Fable5|Sonnet5" README.md` の差分行に混入がない(追記部分のみ確認)。

**コミット:**
- [ ] `git add README.md`
- [ ] `git commit -m "docs: ルート README に agent-policy を追記"`

---

## Task 14: plugin-validator による構造検証

**Files:** なし(検証のみ)

**Interfaces:** Task 1-13 の全成果物・リポジトリ側変更が完了していること。

**Steps:**
- [ ] `plugin-dev:plugin-validator` を `plugins/agent-policy/` に対して実行する。
- [ ] 指摘があれば該当タスクへ戻って修正する。

**検証(期待結果):**
- [ ] plugin.json の 3 項目、Skill ディレクトリ名(with-codex / claude-only / setup)= frontmatter `name` の一致、SKILL.md frontmatter が `name`/`description` の 2 項目であることが妥当と判定される。
- [ ] `references/` ・ `assets/` が `skills/` 直下ではなくプラグインルート直下にあること、`skills/setup/assets/` にテンプレート 3 件があることを確認。
- [ ] JSON parse(plugin.json / marketplace.json)成功、marketplace entry name = plugin.json name、`source` パス実在。
- [ ] `hooks/` ・ `package.json` ・ `build.ts` が存在しない(完全静的)ことを確認: `test ! -e plugins/agent-policy/package.json && test ! -e plugins/agent-policy/hooks && echo STATIC-OK`。

**コミット:** なし(検証のみ。修正が発生した場合は該当タスクのコミット規約に従う)。

---

## Task 15: skill-reviewer による 3 Skill レビュー

**Files:** なし(検証のみ)

**Interfaces:** Task 5(with-codex)・Task 6(claude-only)・Task 10(setup)完了。

**Steps:**
- [ ] `plugin-dev:skill-reviewer` で with-codex / claude-only / setup を個別レビューする。
- [ ] 相互排他(description の環境排他条件)を確認する。

**検証(期待結果):**
- [ ] 相互排他 3 観点: (a) claude-only 明示時に claude-only のみ、(b) with-codex 明示時に with-codex のみ、(c) profile 未指定の一般タスクで両方が同時発動しない。
- [ ] 各 SKILL 本文が役割割当・設計フロー・Haiku レビュー・アドバイザー運用(=Fable のみ)・孫起動禁止・並列原則を欠落なく含む(または references へ正しく委譲)。
- [ ] setup が「明示依頼時のみ・自律発動しない」description を持つ。

**コミット:** なし(検証のみ)。

---

## Task 16: スモークテスト

**Files:** なし(検証のみ)

**Interfaces:** Task 14・15 合格後。

**Steps:**
- [ ] `--plugin-dir plugins/agent-policy` で読み込み、`/plugin` で 3 Skill が namespace 付きで表示されることを確認する。
- [ ] setup を実行し、ヒアリング 4 ステップを通す。
- [ ] with-codex / claude-only の相互排他発動を確認する。
- [ ] 役割 Agents 併用の挙動を確認する。

**検証(期待結果):**
- [ ] setup 実行後、`.claude/agents/gpt-{sol,terra,luna}.md` が生成され、`{{MODEL_ALIAS}}` が確定エイリアスへ置換されている: `grep -L "{{MODEL_ALIAS}}" .claude/agents/gpt-*.md`(全ファイルがヒット = 置換済み)。
- [ ] 既存ファイルがある場合の上書き確認プロンプトが出る。
- [ ] 生成された gpt-sol.md が新方針(設計・実装計画・探索がスコープ内)で、旧文言を含まない: `grep -nE "役割ではない|設計.*スコープ外|調査・分析・設計" .claude/agents/gpt-sol.md` → 0 件。`grep -nE "詳細設計|実装計画|コードベース探索" .claude/agents/gpt-sol.md` → ヒットあり。
- [ ] 相互排他: claude-only を指す CLAUDE.md 記述下で claude-only のみ、with-codex を指す記述下で with-codex のみ発動。profile 未指定タスクで両方同時発動しない。
- [ ] 役割 Agents 併用スモーク(with-codex): 役割 Agent(例 Codiel の `codiel-implementer-*`)の本文を GPT への依頼文に同梱して起動し、(a) 役割どおりの振る舞い、(b) 依頼文で指定した tools 制限の遵守を観測。dispatch 時 `model` にカスタムエイリアスを渡すとバリデーションエラーで拒否される(確定事実)ことを確認。

**コミット:** なし(検証のみ)。

---

## 非スコープ(将来課題)

以下は本計画に含めない(別タスク・段階導入)。

1. **強制力の hook 層(段階導入):** 初版は Skill のみ。CLAUDE.md からの名指し参照を前提とする。非発動が問題化した場合に SessionStart 注入 / PreToolUse ガードの hook 層を後付けで設計する。
2. **既存 root 文書の移行:** `agents-with-codex.md` / `agents-claude-only.md` / `codex/*.md` の deprecated 化・削除・plugin への一本化は別タスク。初版では残す。
3. **basic-design の `skills/shared/` 修正:** 「`skills/` 直下に Skill フォルダ以外を置かない」原則に反する既存の設計ミスは本タスクで触らない。
4. **CLAUDE.md / CLAUDE.example.md の改変:** 人間確認が必要なため範囲外。利用者が自プロジェクトの CLAUDE.md に記載する運用に留める。
5. **`.claude/<plugin>.local.md` による profile 自動選択:** 初版は CLAUDE.md 名指し + description 排他で足りるため導入しない。

## セルフレビュー結果

- [x] 設計書 §3 成果物一覧・§8 WBS の全項目がタスクに対応している(成果物 11 ファイル[Task 1-11] + リポジトリ側 2 変更[Task 12,13] + 検証 3 種[Task 14-16] = 16 タスク)。
- [x] プレースホルダ(TBD / 後で埋める / 設計書参照)残存スキャン: 実タスク本文に 0 件(全ファイルを完成形全文で埋め込み済み)。
- [x] ファイル名・パス・Skill name が全タスク間で整合(with-codex / claude-only / setup。ディレクトリ名 = frontmatter name)。
