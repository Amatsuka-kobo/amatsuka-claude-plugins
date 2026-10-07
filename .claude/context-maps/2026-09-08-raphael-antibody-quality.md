# Context Map: raphael 抗体の質の改善(検知・trigger 精度・効果フィードバック)

**作成日**: 2026-09-08
**作成者**: Opus (system-planner)
**対象タスク**: raphael の抗体を「意図した失敗を拾わない・trigger が広すぎない・効かない抗体が失効する」状態へ改修する(A 検知の質 / B1 trigger 精度 / B2 効果フィードバック / B3 汎用性ゲート / B4 stats 分離 / C 既存 56 件の棚卸し)。
**関連する Blueprint セクション**: `plugins/raphael/DESIGN.md` §4 抗体データモデル / §5 Infection record と state / §6 感知契約 / §7 設定 / §8 Stop cleanup と蒸留 / §9 Management CLI

---

## 1. 目的・スコープ

- 抗体が「毎 Bash で無関係に 1〜3 件注入され、効果が測れず、意図した失敗から量産される」状態を、質で選別される状態へ変える。
- スコープ内: A(benign 既定化・自己解決・閾値を種類数へ・nag をプロジェクト単位へ)、B1(trigger の再現性と広さ検査)、B2(misses と失効候補、confirmed の永続見直し)、B3(synthesizer の汎用性 1 問)、B4(stats を `.raphael/stats.json` へ分離)、C(既存 56 件の再選別手段)。
- スコープ外: プロジェクト間の抗体共有(DESIGN.md:408 で対象外と明記済み)、GOTCHAS 側との連携実装(棲み分けの規律は維持、raphael の指示層に他プラグイン名を書かない)、Anthropic API クライアントの追加。

## 2. 現在のコードベース構造

### 2.1 構成

```
plugins/raphael/
├── src/
│   ├── detect-infection.ts     # PostToolUse(Failure)/UserPromptSubmit hook
│   ├── inoculate.ts            # PreToolUse hook(注入)
│   ├── check-distill-needed.ts # Stop hook(cleanup + 蒸留催促)
│   ├── update-antibody.ts      # 管理 CLI(6 operation)
│   ├── list-antibodies.ts      # 一覧 CLI
│   ├── lib/                    # types/config/frontmatter/*-store/match/detect-*/redact/atomic/hook-io
│   ├── testing/run-ts.ts       # tsx 子プロセス実行ヘルパー(fixtures/ は無い)
│   └── {,lib/}__test__/        # 17 テスト
├── DESIGN.md README.md hooks/hooks.json build.ts
├── agents/antibody-synthesizer.md  commands/review.md  skills/raphael/SKILL.md
└── scripts/  # ビルド出力(触らない)
.raphael/  # antibodies/(git 追跡) infections/ state.json(gitignore 済み)
```

### 2.2 重要ファイル

| ファイルパス | 役割 | 重要度 | 備考 |
|---|---|---|---|
| `src/lib/types.ts` | Antibody / InfectionRecordV1 / RaphaelStateV1 / RaphaelConfig の正本 | High | 全改修が触る |
| `src/lib/frontmatter.ts` | 抗体 frontmatter の parse/serialize/厳密検証 | High | B4 の中心。key 集合・順序が固定 |
| `src/lib/antibody-store.ts` | 抗体 CRUD・ID 採番・`recordAntibodyFire` | High | B4 で stats 更新経路を移す |
| `src/detect-infection.ts` | fingerprint 計算・4 kind の記録 | High | A の中心(`recordFingerprint` L58-68) |
| `src/lib/detect-command.ts` | 失敗判定・benign exit1・正規化 | High | A の benign 既定化 |
| `src/check-distill-needed.ts` | 閾値判定 L134-138・nag digest L139-147・14 日 cleanup | High | A の閾値/nag、B2 の失効候補 |
| `src/lib/state-store.ts` | state.json 正規化・`injected` の畳み込み L146-172 | High | B2 の突合せ元 |
| `src/lib/match-antibody.ts` | trigger マッチ・優先順 L201-233 | High | B1・B4(`last_fired` ソート) |
| `src/lib/config.ts` | 設定 parse。未知 key を無言で無視 | High | 新 key 追加箇所 |
| `src/inoculate.ts` | 注入・`trigger_fingerprint` 生成 L36-42・fire 記録 L79-88 | High | B2・B4 |
| `src/update-antibody.ts` | create/patch/set-status/extend/record-fire/mark-distilled | High | C の移行手段の入口 |
| `src/list-antibodies.ts` | JSON/テーブル出力(`FIRED` `LAST_FIRED` 列 L112-131) | Medium | B4 |
| `agents/antibody-synthesizer.md` | 蒸留の判断フロー | High | B3。L16 の「一問だけ」制約が障害 |
| `commands/review.md` | 一覧/承認/却下。L20,24,53 で stats 参照 | Medium | B2・B4 |
| `src/lib/infection-store.ts` | JSONL 保存・`undistilledDigest`(L52-54) | Medium | A の nag |
| `DESIGN.md` / `README.md` / `skills/raphael/SKILL.md` | 契約文書 | Medium | §5.3 に追随箇所 |

## 3. 関連モジュール・データフロー

- 検知: PostToolUse(Failure) → `detect-infection.ts` → `detect-command.ts` が failed 判定 → `appendRecord` が `fingerprint` を計算 → `infections/session-*.jsonl` へ追記。あわせて `state.recent_commands`(直近 20 件のみ)へ `{normalized_command, failed, exit_code, infection_id}` を push。
- 注入: PreToolUse → `inoculate.ts` → `match-antibody.ts` が候補抽出(active/confirmed・tool・scope・`new RegExp(pattern).test(text)`)→ `last_fired` 降順で上位 `maxInjections`(既定 3)→ `recordAntibodyFire()` が**抗体 Markdown の frontmatter を書き換え** → `state.injected` に `{ts, antibody_id, trigger_fingerprint}` を追加 → `additionalContext` を出力。
- 蒸留: Stop → `check-distill-needed.ts` が全 session JSONL を走査し `distilled===false` の**ID 件数**を数え、閾値以上なら `{"decision":"block"}` で催促。抑止は ID 集合の digest を `state.last_distill_nag_digest` に保存。
- 全 hook は例外を握り潰し stdout を出さない(フェイルオープン)。timeout 15 秒。

## 4. 既存の実装パターン・規約

- lib は `types.ts` にのみ依存する薄いモジュール群。エントリポイントが lib を組み立てる。副作用は store 層に閉じる。
- 書き込みは `atomic.ts` の temp+rename。新規抗体作成のみ `flag:"wx"` の排他作成。
- 抗体の frontmatter は許可 key・出現順序ともに厳密。未知 key は拒否。
- 一方 config は未知 key を**無言で無視**(`config.ts` L92-145 が既知 key を個別参照)。値が不正なら field 単位で既定値へフォールバック。
- CLI は 1 行 JSON(`{ok:true,...}` / `{ok:false,error:{code,message,field?}}`)、exit 1=I/O、2=その他。
- テストは vitest、`fs.mkdtempSync` で一時 project root を作り `CLAUDE_PROJECT_DIR`(必要なら `CLAUDE_PLUGIN_ROOT`)を環境変数で差し替え、`src/testing/run-ts.ts` で子プロセス実行。fixtures はテストファイル内にインライン。

## 5. 変更の影響範囲

### 5.1 直接影響

- **A benign 既定化**: `detect-command.ts` L3-12(組込み benign prefix)、L71-89(failure 判定)。既に `benignExit1Commands` config は存在するので、既定リストの拡張と「意図した失敗」の判定軸追加が本体。
- **A 自己解決**: `detect-infection.ts`(記録時)または `check-distill-needed.ts`(集計時)。突合せに使えるのは `state.recent_commands`(直近 20 件・session 単位)か JSONL 側の再走査。
- **A 閾値を種類数へ**: `check-distill-needed.ts` L37-93,134-138、`infection-store.ts` L52-54(digest)、`config.ts` L119-124。
- **A nag をプロジェクト単位へ**: `state-store.ts` L44-59(session 不一致で state を初期化する挙動)、`types.ts` L58-86。
- **B1 広さ検査**: 新規 lib + `update-antibody.ts` の create/patch preflight。照合材料は `state.recent_commands`(20 件上限)か infections JSONL の `normalized_command`。
- **B2 misses**: `inoculate.ts`(注入記録)、`detect-infection.ts`(失敗記録)、`check-distill-needed.ts`(集計・失効候補)、`state.injected`。
- **B4 stats 分離**: `types.ts` L96-110、`frontmatter.ts` L82-105,128-130,168-196、`antibody-store.ts` L157,248-275、`inoculate.ts` L79-88、`update-antibody.ts` L186-192(extend の基準日)、`match-antibody.ts` L203-204(`last_fired` ソート)、`list-antibodies.ts` L112-131。

### 5.2 間接的に波及

- `.gitignore` に `.raphael/stats.json` の追記が要る(現状は `infections/` `state.json` `log/` `raphael.local.md` のみ)。
- `inoculate.ts` は `recordAntibodyFire()` の成功を注入の前提にしている(L79-88)。stats 分離後もこの結合を残すか要判断。
- 既存 56 件の抗体ファイルは frontmatter に `stats` を持つ。分離後の parser がこれを拒否すると全件が読めなくなる。移行の前後関係が critical path。
- `commands/review.md` の一覧ソートが `stats.last_fired` に依存。
- テスト 17 件のうち frontmatter/antibody-store/match-antibody/inoculate/update-antibody/list-antibodies の 6 件が stats をインライン fixture に持つ。

### 5.3 追随が要る文書(節 + 行)

- `DESIGN.md`: L150-153,168-171,182-184,389,417(stats 分離) / L338-355(config 新 key) / L350,363-367(閾値) / L150-171,178-184,359-367,383-390(misses) / L408(「プロジェクト間共有は対象外」と B3 の整合)。加えて L76 の `node26` は実装 `build.ts:17` の `node22` と食い違っており既存の誤記。
- `README.md`: L36-49(.gitignore) / L57-79(frontmatter 例) / L81-117(config) / L54,95,112,175(閾値) / L139-143,155(失効候補)。
- `agents/antibody-synthesizer.md`: L16(「一問だけ」制約)、L40-45(injected 後の突合せ)、L47-59(判断表)、L59(bad antibody)。
- `commands/review.md`: L20,24,53-55(stats・misses 表示)、L82-90(自動候補とユーザー却下の区別)。
- `skills/raphael/SKILL.md`: L13(蒸留通知の契機)。trigger 粒度・抗体の書き方の記述は現状**存在しない**ので新設判断が要る。

### 5.4 変更を避けるべき箇所

- `plugins/raphael/scripts/`(ビルド出力。`src/` を直し `pnpm run build`)。
- `.raphael/antibodies/`(CLI 経由のみ。C の移行も CLI か専用スクリプトで行う)。
- hook のフェイルオープン契約(`inoculate.ts` L109-114、`detect-infection.ts` L355-357、`check-distill-needed.ts` L149-150、`hook-io.ts` L20-37)。広さ検査や stats 読み込みの失敗で注入や検知が落ちてはならない。

## 6. 守るべき既存契約

- 抗体 frontmatter: 許可 key `id/created/source/trigger/status/stats/expires/body` のみ、出現順序も固定。未知 key は拒否。ID は `^ab-\d{4}-\d{4}-\d{3}$`。`status` は `active|expired|confirmed`(`retire` という状態は無い)。`body` は 1〜9,000 文字。`trigger.event` は `PreToolUse` 固定、`tool` は `Bash|Edit|Write|*`、`pattern` は 1,000 文字以内かつ有効な JS 正規表現。
- InfectionRecordV1 は `schema_version: 1` の 14 フィールド。`fingerprint` は 64 桁 lowercase SHA-256 hex であることを store が検証する。
- **`fingerprint` は event sequence を含む**: `sha256("${kind}\0${normalizedTarget}\0${eventSeq}")`(`detect-infection.ts` L58-68)。command-failure でも常に `eventSeq` を渡す(L108,L160)ため、**同じコマンドの同じ失敗でも fingerprint は毎回異なる**。「未解決 fingerprint 種類数」で数えるには再発キー(eventSeq 抜きの `sha256(kind\0normalizedTarget)`)を新たに定義する必要がある。
- `state.injected` の `trigger_fingerprint` は `sha256("${tool}\0${path ?? ""}\0${text}")`(`inoculate.ts` L36-42)で、infection の `fingerprint` とは**入力も計算式も異なり直接突合せできない**。B2 は normalized_command を介した間接突合せか、どちらかの計算式の追加が要る。
- `state.recent_commands` は直近 20 件で切り捨て(`detect-infection.ts` L163)。`state.injected` は抗体 ID ごとに最新 1 件へ畳み込まれ、件数上限・保持期限はない。
- CLI の JSON 契約と exit code。`patch` が触れるのは `source/trigger/body` のみ。
- 既存の config key: `detect_*`(4)、`retry_threshold`、`edit_churn_threshold`、`distill_threshold`(1..100、既定 3)、`default_expiry_days`、`max_injections`(既定 3)、`rejection_patterns`、`benign_exit1_commands`、`antibodies_git_policy`。
- 組込み benign exit1 prefix: `grep`, `rg`, `git grep`, `diff`, `git diff --quiet`, `cmp`, `test`, `[`。

## 7. 未解決事項・不明点

| # | 質問内容 | 影響度 | 上流報告先 | 現状の仮定 |
|---|---|---|---|---|
| 1 | 「未解決 fingerprint 種類数」で数えるには、eventSeq を含まない**再発キー**の新設が必要。既存 `fingerprint` の意味を変える(schema_version を上げる)か、`recurrence_key` フィールドを追加するか | High | 最上位オーケストレーター | 追加フィールド案を仮置き(既存 177 件の record を壊さない) |
| 2 | B2 の突合せ: infection の `fingerprint` と state の `trigger_fingerprint` は計算式が別で直接比較できない。何を鍵に「注入後の同種失敗」を認定するか(normalized_command か、抗体 id × 再発キーか) | High | 最上位オーケストレーター | 抗体 id × 再発キーの組を新たに記録する |
| 3 | benign 既定リストの中身。TDD の red テスト(68 件)・lint/typecheck(36 件)を exit code だけで benign と判断できるか。`pnpm run lint` の exit 1 は「意図した失敗」でも「直すべき失敗」でもありうる | High | 最上位オーケストレーター | コマンド prefix ベースの既定リスト + config で上書き |
| 4 | 「自己解決」の観測窓。`state.recent_commands` は直近 20 件・session 単位で、後続の成功を取り逃す。窓を広げるか JSONL 側へ成功も記録するか(記録量が増える) | High | 最上位オーケストレーター | Stop 時に session 内 recent_commands で判定する軽量案 |
| 5 | 広さ検査の閾値と照合母集団。「直近コマンド履歴への一致率上限」の母集団を何にするか(recent_commands は 20 件しかない)、上限は何 % か、超過時は拒否か警告か | High | 最上位オーケストレーター | infections JSONL の全 normalized_command を母集団、上限 30%、create/patch を拒否 |
| 6 | misses の時間窓と失効の自動性。misses/fired の閾値、`expired` へ自動遷移させるか review での候補提示に留めるか。ユーザー却下の `expired` と区別するか | High | 最上位オーケストレーター | 自動遷移させず候補提示のみ。区別する |
| 7 | `confirmed` の永続見直しの具体。現状 synthesizer は confirmed を一切更新・失効できない(agent L17,45,103)。misses が高い confirmed をどう扱うか(格下げ・警告・据え置き) | High | 最上位オーケストレーター | review での警告表示に留める |
| 8 | stats 分離の移行順序。既存 56 件は frontmatter に `stats` を持ち、parser を厳格化すると全件が読めなくなる。移行スクリプトを先に走らせる前提にするか、parser に猶予期間(読めるが書かない)を置くか | High | 最上位オーケストレーター | 猶予期間を置かず、移行スクリプトを同一コミットで提供 |
| 9 | `.raphael/stats.json` の粒度と競合。単一 JSON か抗体ごとのファイルか。PreToolUse は並行しうるので atomic 更新の単位、抗体削除時の孤児 entry の cleanup、欠損時の初期化規約 | Medium | 戦術オーケストレーター | 単一 JSON + atomic 置換。欠損は 0 とみなす |
| 10 | C の既存 56 件の移行方式。決定的な移行スクリプト(stats 移設 + 広さ検査で候補フラグ)と、synthesizer による再蒸留(LLM 判断)のどちらを正とするか。両方なら実行順 | Medium | 最上位オーケストレーター | スクリプトで機械的に移設し、広さ検査に落ちたものを review キューへ |
| 11 | B3 の「別リポジトリで成立するか」が DESIGN.md L408「プロジェクト間共有は対象外」と衝突しないか。この 1 問は共有の導入ではなく汎用性の品質検査である旨を明記する必要 | Medium | 戦術オーケストレーター | 品質検査として位置づけ、DESIGN.md に注記 |
| 12 | nag をプロジェクト単位にすると `state.json` の session 単位初期化(`state-store.ts` L44-59)と衝突する。nag digest を別ファイルへ出すか state を session-keyed にするか | Medium | 戦術オーケストレーター | nag digest を `.raphael/stats.json` か別の永続ファイルへ移す |
| 13 | config の未知 key を無言で無視する現仕様のまま新 key を足すと typo が発覚しない。厳格化するかどうか | Low | 戦術オーケストレーター | 現仕様を維持(スコープ外) |
| 14 | `inoculate.ts` L79-88 は fire 記録の成功を注入の前提にしている。stats 分離後、stats 書き込み失敗で注入を止めるか、注入は通すか | Low | 戦術オーケストレーター | 注入は通す(フェイルオープン優先) |

## 8. テスト戦略・既存テスト

- vitest のみ。E2E なし。テストは対象と同じディレクトリの `__test__/`、`<対象>.test.ts`。node 環境、forks、20 秒。`plugins/**/__test__/**/*.test.ts` の外は実行されない。
- 定石: `fs.mkdtempSync` で一時 project root → `.raphael/{antibodies,infections}` と `state.json` を組み立て → `CLAUDE_PROJECT_DIR` を設定して `src/testing/run-ts.ts` で子プロセス実行。`src/fixtures/` は無い。
- 新規に要るテスト: (a) benign 判定の分類表(TDD red / lint / 探索 exit 2 / kill exit>=128)、(b) 再発キーが同一コマンドの複数失敗で一致すること、(c) 自己解決で蒸留対象から外れること、(d) 種類数閾値と件数閾値の違いが出る fixture、(e) 広さ検査の一致率計算と境界、(f) misses の加算条件と失効候補判定、(g) stats 分離後の frontmatter round-trip と旧形式の移行、(h) nag のプロジェクト単位抑止(session を跨ぐ)。
- エッジケース: 抗体 0 件、stats.json 欠損/破損、抗体ファイルと stats.json の ID 不一致、同一 session 内の並行 PreToolUse、`.raphael/` が読めない環境(フェイルオープンの維持)。

## 9. 依存関係・リスク・制約

- 依存は Node.js 22 以上のみ(esbuild bundle、`target: node22`)。外部ライブラリを増やさない。
- リスク(高): stats 分離の移行で既存 56 件が読めなくなる。frontmatter の厳格さがそのまま破壊力になる。
- リスク(高): 検知を絞りすぎると infection が枯れ、蒸留の材料が無くなる。benign リストは可逆(config で戻せる)にする。
- リスク(中): 広さ検査を create のブロッキング条件にすると synthesizer が抗体を作れず沈黙する。落ちたときの代替行動を synthesizer 側に書く必要がある。
- リスク(中): hook の 15 秒 timeout。広さ検査で JSONL 全走査を PreToolUse で行わない(CLI 側の create/patch 時に限る)。
- 技術的負債: `state.recent_commands` の 20 件上限、`state.injected` の無制限保持、`DESIGN.md` L76 の `node26` 誤記、`fingerprint` に eventSeq を含めた設計(再発の同定を最初から不可能にしている)。

## 10. 推奨アプローチ

1. 先に**再発キー**(#1)と**突合せ鍵**(#2)を決める。A の閾値も B2 の misses もここに乗るので、他のすべてがこの判断に依存する。
2. B4(stats 分離)を独立した先行ステップにし、移行スクリプトと parser 変更を同一コミットに入れる。ここが通れば git dirty 問題が即座に消え、以降の作業が読みやすくなる。
3. A(benign・自己解決・閾値・nag)を次に入れる。検知が静かになってから B1/B2 の効果を測る。
4. B1(広さ検査)は CLI の create/patch preflight に限定し、PreToolUse には一切足さない。
5. B2(misses)→ B3(synthesizer の 1 問)→ C(棚卸し)の順。C は B1 の広さ検査を再利用する。
6. 各ステップで DESIGN.md と README を同じコミットで追随させ、`plugin.json` / `package.json` を揃えて上げる(現行 `0.1.1-dev`。変更量からマイナーの `0.2.0-dev` が妥当)。

## 11. 補足・暗黙知

- 抗体 Markdown は git 追跡対象、infections と state.json は gitignore 済み。stats を frontmatter に置いた設計が「発火のたびに追跡ファイルが dirty になる」問題の直接原因である。
- `status` に `retire` は無い。却下も自動失効も `expired` に集約されるため、B2 の失効候補をユーザー却下と区別したいなら状態か別フィールドの新設が要る。
- synthesizer は Haiku で動き、`agents/antibody-synthesizer.md` L16 が「単一質問」を絶対条件にしている。B3 の 1 問追加はこの絶対条件の書き換えを伴う。
- `commands/review.md` は削除操作を持たない(却下も `set-status expired`)。抗体は増える一方の構造になっている。
- `benign_exit1_commands` config と組込み benign prefix は**既に存在する**。A は「新機能の追加」ではなく「既定リストの拡張と判定軸の追加」として設計できる。
- この map の作成中に実際に `ab-2026-0803-002`(pattern `&&.*[|;]`)が、無関係な読み取り専用コマンドに対して注入された。B1 の問題は再現性がある。

---

**次のステップ提案**:

- #1(再発キーの定義)と #2(突合せ鍵)を先に確定しないと設計書が書けない。ここを最優先で判断してほしい。
- #3(benign 既定リスト)と #8(stats 移行順序)は、ユーザーの運用実態に踏み込む判断なので確認が要る。

---

*このファイルの所在(パス)を通知する。読む深さは agent-policy の `references/context-map-guide.md` に従い、本文は小さく蒸留された状態に保つ。API キー・トークン・パスワードなどの機密情報を記録しないこと。*
