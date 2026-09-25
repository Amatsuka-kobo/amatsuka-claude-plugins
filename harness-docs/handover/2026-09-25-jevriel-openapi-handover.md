# jevriel OpenAPI 拡張 引き継ぎ書

- 日付: 2026-09-25
- 引き継ぎ元: 設計・計画セッション(実装は未着手)
- 引き継ぎ先: 実装セッション(初版の実装完了後)
- 対象プラグイン: `plugins/jevriel`(`0.1.0-dev` → `0.2.0-dev`)

## 現在地

| 工程 | 状態 |
| --- | --- |
| 前提 | 初版(`harness-docs/plans/2026-09-25-jevriel-plan.md` の T0〜T16)の実装完了が前提。未完了なら初版の引き継ぎ書 `harness-docs/handover/2026-09-25-jevriel-handover.md` に従い、先に初版を終える |
| 設計書 | 完成。理解レビューと独立レビューの指摘を反映済み。ユーザー承認済み |
| 実装計画書 | 完成。T0〜T12。理解レビューと独立レビューの指摘を反映済み。ユーザー承認済み |
| 実装 | 未着手 |
| 未解決事項 | 設計書 §17-1(SDK の choice が選択肢 1 個を受けるか。T3 で確認、結果に依らず扱いは変えない)のみ |

設計書は `harness-docs/design/2026-09-25-jevriel-openapi-design.md`、実装計画書は `harness-docs/plans/2026-09-25-jevriel-openapi-plan.md`。どちらもコミット `3b12c0d` に含まれる。同コミットで初版の設計書 §8-4(`reason: "budget_exceeded"`)と初版計画書 T7 / T10 の検証にも追随を入れている。

作業ツリーには本件と無関係な未コミット変更がある。`cliproxyapi.config.example.yaml`、`.raphael/`、`docs/chat/` 配下には触れない。

## 次セッションが最初にやること

1. この引き継ぎ書、拡張設計書 §1〜§5・§16、実装計画書 §0〜§2 の順に読む。初版設計書 §5-1・§5-11・§6-2・§8・§9 も前提として読む。
2. T0 として、初版の 10 ツールが `tools/list` に出ること、`pnpm run lint` / `typecheck` / `test` / `build` が通ることを確認し、初版の export 名が初版計画書の produces と一致するかを確かめる。違えば consumes を実名へ直してから T1 に入る。
3. T1(`ApiGoalInput.requests` → `source: RequestSource` のリファクタ)は初版計画 §1 の契約凍結に対する明示的な例外である。許可する差分は計画書 T1 に限定列挙してあり、それ以外を変えない。
4. T2 から計画書の順序とコミット単位で実装する。確定した設計を実装中に再検討しない。

## 確定した決定

拡張設計書を正本とする。実装では次の要約だけで判断を補わず、詳細は該当節に従う。

| 項目 | 決定 |
| --- | --- |
| 露出形 | 既存 `api_run_goal` に `spec` / `include` / `headers` を追加(`spec` と `requests` は排他)。補助ツール `api_list_operations` を新設(Jev 不使用、キー不要)。ツール数 11 |
| 対応範囲 | OpenAPI 3.0.x / 3.1.x、JSON / YAML(`yaml ^2.9.0` を追加)。ローカル `$ref` のみ。Swagger 2.0、外部 `$ref`、OAuth2 / OpenID、cookie、JSON 以外の本文、deepObject 等の style は非対応 |
| 信頼境界 | spec を信頼しない。`baseUrl` は必須のまま、`servers` は表示のみ。spec の URL 取得は redirect を追わず、5MiB 超で打ち切り。ローカルパスは `projectDir` 配下限定 |
| 値埋め | 候補集合方式。パラメータごとに choice(候補 = inputs キー / spec の example・default・enum / 直近 5 応答の葉値 / omit)。候補 1 個はコードが採る。本文は inputs のオブジェクトか配列、または spec の example から choice。必須で候補ゼロなら `stuck`(`missing_input`) |
| 認証 | securitySchemes の apiKey / bearer / basic。Security Requirement は OR of AND。inputs で満たせる最初の要素だけ付与 |
| 既定メソッド | get / post / put / patch。delete / head / options は `include.methods` 明示時のみ |
| ループ | `RequestSource`(`templateSource` / `specSource`)を初版ループへ注入。`BuildResult` に `skip` / `missing_input` / `budget_exceeded` / `inputPathSegments` |
| 秘密 | `headers` 引数は名前不問で伏字。inputs 由来の path セグメントは証跡と state で `[redacted]`(初版の同じ穴もこの拡張で塞ぐ)。spec の example 値は Jev へ送られる(README に明記) |
| 上限 | 操作 253(`api_run_goal`)/ 255(`api_list_operations`)。候補 255。葉値の深さ 6、1 応答 200、配列 20。inputs のキー 253 |
| `$ref` | 3.1 の Reference Object は summary / description だけ上書き、他の兄弟は無視。Schema の `$ref` は浅いマージをしない。循環は解決スタックで判定、16 段まで |
| バージョン | `0.2.0-dev`(plugin.json / package.json / `McpServer` の version 文字列) |

## ユーザー指摘・レビューによる改定

| 段階 | 改定 |
| --- | --- |
| 露出形 | X(既存拡張のみ)から Z(X + `api_list_operations`)へ。理由は inputs 不足による stuck を減らすため |
| `servers` | 承認済みセクションでは `baseUrl` 省略時に `servers[0].url` を使う案だったが、取得した spec が送信先と認証の宛先を決める安全上の反証を採り、`baseUrl` 必須に戻した。再提案しない |
| メソッド | 全メソッド許可から、delete を既定から外す形へ |
| `$ref` | 「3.1 は兄弟が上書き」を仕様(summary / description のみ)に合わせて修正 |
| style / explode | 読まない設計から、既定と主要な組合せに対応し、非対応 style の必須パラメータを持つ操作は選択肢から除外する形へ |
| `reason` | 予算超過時の `reason: "budget_exceeded"` を初版設計書 §8-4 で確定し、両経路で揃えた |

## 再提案しない不採用案

設計書 §13 を再提案しない。特に次を実装中の代替案にしない。

- 新ツール `api_run_spec_goal` やループの複製。
- `servers[0].url` を `baseUrl` や `allowedHosts` の既定にすること。
- 本文のフィールド単位の埋め、ajv 等による応答検証、Swagger 2.0 対応、外部 `$ref`。
- `inputs` の型をオブジェクトへ広げること(JSON 文字列として読む)。

## 実装時に踏みやすい点

- T1 の「振る舞い不変」は `RunRecord` と証跡について。Jev へ送る state の `requests` は `description` → `summary`、`requiredParams` / `body` の追加分だけ変わる。既存テストの更新はその差分と入力の `requests` → `source` に限る。
- `openapi.ts` / `fill.ts` は T5 で `server.ts` から到達するまで dist に入らない。T2〜T4 のコミットに dist 差分が無いのは正常。`yaml` の追加と `pnpm-lock.yaml` は T2 のコミットに含める。
- security の分類と継承は T2(`loadSpec` / `listOperations`)の責務。T4 の `selectSecurity` は解決済み配列だけを扱う。
- 5MiB はちょうどで成功、1 バイト超で `invalid_input`。
- `suggestedInputs` のキーは 64 文字以内(操作名 59 + `_body`)。
- `SystemOneResult` は `SystemOneResult<Questions>`。
- `notes` は `string[]` で返し、`note` へ書くときに `", "` で結合する。
- スキルの追記(T7)は `prompt-smith:prompt-smith` を使う。`dist/` と ARCHITECTURE を手で編集しない。ブランチを切らない。

## スコープ外

- ADR の追加(初版 ADR の範囲内)。ARCHITECTURE の変更要否は T9 で確認する。
- JSON 派生メディアタイプ(`application/vnd.api+json` 等)、YAML マージキー(`<<:`)。

## 参照

- 拡張設計書: `harness-docs/design/2026-09-25-jevriel-openapi-design.md`
- 拡張計画書: `harness-docs/plans/2026-09-25-jevriel-openapi-plan.md`
- 初版設計書: `harness-docs/design/2026-09-25-jevriel-design.md`
- 初版計画書: `harness-docs/plans/2026-09-25-jevriel-plan.md`
- 初版の引き継ぎ書: `harness-docs/handover/2026-09-25-jevriel-handover.md`
- 会話記録: `docs/chat/2026/0924/phyllis998/2352-jevriel-design.md`
