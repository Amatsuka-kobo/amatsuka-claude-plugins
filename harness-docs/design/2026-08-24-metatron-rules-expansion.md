# metatron: 管理対象文書を .claude/rules/ へ拡大する

作成日: 2026-08-24
状態: 未着手(引き継ぎ)

## 何をするか

metatron が管理する文書を、ARCHITECTURE と GOTCHAS の 2 つから `.claude/rules/` 配下へ拡大する。`/metatron:init` が rules の追加にも対応する。

## なぜそうするか

ARCHITECTURE の `## 規約` と `## 保護パス` は、性質としては「セッションを通して守らせたいこと」である。Claude Code はこの種の指示を `.claude/rules/` で扱う。ARCHITECTURE は「プロジェクトの構造を記述する文書」であり、規律の置き場としては役割が違う。

CLAUDE.md へ移す案も検討したが不採用とした。CLAUDE.md は metatron の管理外にあり、書式検証も承認ゲートも効かない。規律が勝手に書き換わることを防げない。

## 現在の状態(2026-08-24 時点)

移行は未着手である。現行の metatron に則り、`harness-docs/ARCHITECTURE.md` に `## 規約` と `## 保護パス` を残した。バージョンの上げ方も `## 保護パス` に入れた。

CLAUDE.md は概要と参照案内だけを持つ 11 行の文書へ縮小した。

## 着手前に知っておく制約

### stage-architecture にセクション削除機能が無い

`plugins/metatron/src/lib/architecture.ts` の `mode` は `"replaced" | "added"` の 2 種類だけである。`"removed"` が無いため、CLI 経由でセクションを消せない。

ARCHITECTURE から `## 規約` を rules へ移すには、次のいずれかが要る。

- `stage-architecture` に削除モードを追加する。
- 本文を参照案内 1 行へ差し替え、節だけ残す。

metatron の設計は「消さない」で一貫している(GOTCHAS は追記のみ、ADR は削除せず `廃止` の状態で残す)。削除モードを足すかは、この一貫性を崩してよいかの判断を伴う。

### 注入予算が逼迫している

`injection.maxChars` の既定値は 9000 である。2026-08-24 時点の実測は次のとおり。

| 項目 | 文字数 |
| --- | --- |
| `harness-docs/ARCHITECTURE.md` | 8,116 |
| CLI 案内(削れない) | 690 |
| 合計 | 8,806 |
| 残り予算 | 194 |

予算を超えると段階縮退が起き、ARCHITECTURE は「目次 + 各節の要約 1 行」へ落ちる。**縮退は警告もエラーも出さない。** 気づくには `inject-context.mjs` を実行して出力を実測するしかない。

`## 規約` と `## 保護パス` を rules へ移せば ARCHITECTURE は約 3,000 文字減る。ただし rules も注入されるなら総量は変わらない。rules の注入方式(全文注入か、条件に一致したときだけか)を設計時に決める。

### セクション構成を変えるときの追随先

`plugins/metatron/references/architecture-format.md` のセクション構成を変更したときの追随先は `plugins/metatron/docs/format-change-checklist.md` にある。

`ARCHITECTURE_HEADINGS` に相当する定数は 2 箇所にある。

- `plugins/metatron/src/lib/architecture.ts`
- `plugins/metatron/src/lib/scan.ts`

### 後方互換

`ARCHITECTURE_HEADINGS` から `規約` を削除すると、既に `## 規約` を持つ ARCHITECTURE は `stage-architecture` で更新できなくなる(未知の見出しとして拒否される)。移行経路を用意する。

### metatron の CLI は inject-context で予算を測れる

注入後の実際の文字数は次で測れる。設計時の見積もりではなく、この実測で判断する。

```bash
echo '{}' | node plugins/metatron/scripts/inject-context.mjs
```

出力の `hookSpecificOutput.additionalContext` の文字数が、実際にセッションへ注入される量である。文字列 `を Read すること` が含まれていれば縮退している。

## 検討して不採用にした案

| 案 | 不採用の理由 |
| --- | --- |
| 規約を CLAUDE.md へ集約する | CLAUDE.md は metatron の管理外で、書式検証も承認ゲートも効かない |
| `harness-docs/ARCHITECTURE.md` を削除して規約なしで作り直す | 「CLI 経由でのみ書く」規律を自ら破ることになる |

## 設計時に決めること

1. rules のファイル分割の単位(1 ファイルか、規約と保護パスで分けるか)。
2. rules の注入方式(全文注入か、条件一致時のみか)。
3. `stage-architecture` に削除モードを足すか、参照案内へ差し替えるか。
4. 既存プロジェクトの移行経路。
5. `/metatron:init` のウォークスルーで rules をどう扱うか(ARCHITECTURE のセクションと同じく 1 つずつ確認するか)。
