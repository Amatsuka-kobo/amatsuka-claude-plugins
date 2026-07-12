# basic-design プラグイン 設計ドキュメント

- 日付: 2026-07-12
- ステータス: 設計承認済み(実装計画は未着手)
- 参考: `plugins/task-utility/skills/issue-craft/SKILL.md`(ブレインストーミング型進行の参考元)

## 1. 目的

基本設計フェーズの成果物(ER図・画面遷移図・システム構成図・シーケンス図・API/IF 一覧・非機能要件チェックリスト)を、ユーザーとのブレインストーミングで練り上げて生成する Claude Code プラグイン。図は Draw.io 形式(.drawio)とインタラクティブ HTML の 2 形式で出力できる。

## 2. 決定事項(要件確認の結果)

| 論点 | 決定 |
| --- | --- |
| Draw.io の閲覧環境 | Web 版(app.diagrams.net)を想定 |
| インプット | ゼロからのブレインストーミングが基本(issue-craft と同じスタイル) |
| 保存先 | リポジトリの `docs/design/` がローカル保存の基本。Google Drive アップロードはオプトイン設定 |
| Drive 認証 | Google Drive 系 MCP Tool(ユーザーが別途導入)に閉じる。プラグイン自身は認証情報を扱わない |
| Drive MCP 不在時 | ローカル保存の結果と、導入案内+手動アップロード手順を伝えて STOP |
| 初期スキル | 図 4 種 + API/IF 一覧 + 非機能要件チェックリスト + 入口オーケストレーション |
| プラグイン名 | `basic-design` |
| 生成方式 | spec JSON → 同梱 Node スクリプトで変換(Claude が XML/SVG を直接書かない) |
| 出力形式 | .drawio と単一 HTML(インタラクティブ)の 2 系統。同じ spec JSON から生成 |

## 3. 制約(リポジトリ方針の継承)

- **Anthropic API・外部 API キーを前提にしない**(CLAUDE.md の Codiel 制約と同水準)。LLM 処理は Claude Code の機構に閉じ、Drive 認証は MCP Tool に委ねる
- 変換スクリプトは **依存ゼロ(Node 標準ライブラリのみ)**。テストは `node --test` でリポジトリ既存方針に合流
- ディスカッションはユーザーの言語を厳守。取り消しの効きにくい操作(git push、Drive アップロード)は明示承認制

## 4. プラグイン構成

```
plugins/basic-design/
├── .claude-plugin/plugin.json      # version 0.1.0-dev から開始
├── README.md
├── skills/
│   ├── basic-design/SKILL.md       # 入口: 全体オーケストレーション
│   ├── er-diagram/SKILL.md         # ER図
│   ├── screen-flow/SKILL.md        # 画面遷移図
│   ├── system-architecture/SKILL.md # システム構成図
│   ├── sequence-diagram/SKILL.md   # シーケンス図
│   ├── api-list/SKILL.md           # API/IF 一覧 (Markdown)
│   └── nfr-checklist/SKILL.md      # 非機能要件チェックリスト (Markdown)
└── scripts/
    ├── design-gen.mjs              # エントリ CLI: spec JSON → .drawio / .html
    ├── lib/
    │   ├── layout/                 # 図種ごとのレイアウト計算(出力形式非依存)
    │   │   ├── er.mjs / screen-flow.mjs / architecture.mjs / sequence.mjs
    │   ├── render/
    │   │   ├── drawio.mjs          # レイアウト結果 → mxGraph XML
    │   │   └── html.mjs            # レイアウト結果 → SVG 埋め込み単一 HTML
    │   ├── validate.mjs            # spec スキーマバリデーション
    │   └── xml-util.mjs            # エスケープ・ID採番などの共通処理
    └── *.test.mjs                  # node --test
```

- スキルは図種ごとに分割する。Claude Code のスキルは description による発動判定で選ばれるため、「ER図を作って」で er-diagram を直接呼べる粒度にする
- **レイアウト層と出力層の分離**が構成の核。配置計算(`lib/layout/`)は 1 系統で、シリアライザ(`lib/render/`)だけが mxGraph XML / HTML に分かれる。両モードで図の見た目が一致し、テストはレイアウト層に集中できる

## 5. スキル共通フロー

issue-craft の型を踏襲する:

```
1. 環境チェック(Node の有無、出力形式の確認 — Draw.io / HTML / 両方)
2. ブレインストーミング(不足観点だけ 1 問ずつ、選択式は AskUserQuestion)
3. ドラフト提示 → 明示承認(図の内容をテキスト表現で全文提示)
4. spec JSON を書き出し → node design-gen.mjs で生成
5. 保存(ローカルは常に実行、Drive はオプトイン設定があるときのみ提案)
```

共通規律(issue-craft から継承):

- ディスカッションはユーザーの言語を厳守
- ユーザーの明示承認を得るまで生成・保存・アップロードしない
- STOP するときは「理由+次にユーザーがすべきこと」を伝えて終了
- 変換スクリプト失敗時は生のエラーを報告し、spec JSON を修正して再実行。勝手な代替手段への切り替えはしない

### 図種ごとの「埋まるべき観点」

| スキル | 埋まるべき観点 |
| --- | --- |
| er-diagram | エンティティ / 属性・キー(PK/FK/ユニーク) / リレーションとカーディナリティ / 命名規約 |
| screen-flow | 画面一覧 / 画面グループ / 遷移とトリガー / 開始・終了点 |
| system-architecture | ゾーン(ネットワーク境界・クラウド) / ノード(サーバー・サービス) / 通信経路とプロトコル / 外部システム |
| sequence-diagram | 登場アクター・システム / メッセージの順序 / 同期・非同期・応答の別 / 対象ユースケース |
| api-list | エンドポイント(メソッド / パス / 概要 / リクエスト / レスポンス / 認証) |
| nfr-checklist | 性能・可用性・セキュリティ・運用保守・拡張性など観点カタログごとの要否と目標値 |

## 6. spec JSON スキーマ

ブレストの成果は図種ごとの spec JSON に落とす。spec は生成物と並置して保存し、「ソースとビルド成果物」の関係にする(再編集は spec を直して再生成が基本線)。

### ER図 (`type: "er"`)

```json
{
  "type": "er",
  "title": "受注管理システム ER図",
  "entities": [
    { "name": "users", "label": "ユーザー",
      "columns": [
        { "name": "id", "type": "BIGINT", "pk": true },
        { "name": "email", "type": "VARCHAR(255)", "unique": true }
      ] }
  ],
  "relations": [
    { "from": "users", "to": "orders", "cardinality": "1:N", "label": "発注する" }
  ]
}
```

### 画面遷移図 (`type: "screen-flow"`)

```json
{
  "type": "screen-flow",
  "title": "...",
  "screens": [
    { "id": "login", "label": "ログイン画面", "group": "認証", "kind": "start" }
  ],
  "transitions": [
    { "from": "login", "to": "home", "trigger": "ログイン成功" }
  ]
}
```

- `kind` は省略可(`start` / `end` / 省略=通常画面)。開始・終了点の観点をスキーマで表現する

### システム構成図 (`type: "architecture"`)

```json
{
  "type": "architecture",
  "title": "...",
  "zones": [
    { "id": "aws", "label": "AWS", "children": ["alb", "app", "db"] }
  ],
  "nodes": [
    { "id": "app", "label": "App Server", "icon": "server" }
  ],
  "edges": [
    { "from": "alb", "to": "app", "label": "HTTP" }
  ]
}
```

### シーケンス図 (`type: "sequence"`)

```json
{
  "type": "sequence",
  "title": "...",
  "actors": [ { "id": "user", "label": "ユーザー", "kind": "actor" } ],
  "messages": [
    { "from": "user", "to": "web", "label": "ログイン要求" },
    { "from": "web", "to": "user", "label": "トークン", "style": "return" }
  ]
}
```

- `style` は省略可(省略=同期 / `async` / `return`)。同期・非同期・応答の観点をスキーマで表現する

## 7. 変換スクリプト(design-gen.mjs)

```
node design-gen.mjs <spec.json> --format drawio   → .drawio
node design-gen.mjs <spec.json> --format html     → .html
node design-gen.mjs <spec.json> --format both     → 両方
```

- spec の `type` を見て `lib/layout/<type>.mjs` に振り分ける単一エントリ
- **バリデーション先行**: 不正な参照(存在しないエンティティへのリレーション等)は変換前に具体的なエラーメッセージで指摘し、Claude が spec を直して再実行する
- **レイアウトは全自動、保証ラインは「重ならない初期配置」**:
  - ER図: グリッド配置(リレーション数の多いエンティティを中央寄せする程度の単純ヒューリスティック)
  - 画面遷移図: 階層レイアウト(左→右)
  - 構成図: ゾーン入れ子+ゾーン内グリッド
  - シーケンス図: 等間隔ライフライン+メッセージ順の縦位置
  - 力学モデルや交差最小化などの凝った自動レイアウトは作らない(Draw.io 側に整列ツールがあるため投資対効果が低い)

## 8. HTML 出力モード

ブラウザでそのまま開ける**単一 HTML ファイル(依存ゼロ)**を生成する。

- 図はインライン SVG。レイアウトは Draw.io 版と同じ `lib/layout/` の結果を使う
- JS は CDN 依存なしの vanilla JS をインライン埋め込み。file:// で動作する
- インタラクション(初期リリースの範囲):
  - ズーム・パン(ホイール+ドラッグ)
  - 要素ホバー/クリックでハイライト(ER図: エンティティクリックで関連リレーション強調 / 画面遷移図: 画面クリックで遷移元・先強調 / シーケンス図: メッセージホバーで送受信者強調)
  - 詳細パネル: クリックした要素の spec 上の情報(カラム定義、遷移トリガー等)をサイドパネルに表示
- 編集機能・フィルタ・検索は初期スコープ外

## 9. 保存フロー

```
1. ローカル保存(常に・基本形)
   docs/design/<図種>/ に spec JSON + 生成物を保存
   例: docs/design/er/order-system.spec.json
       docs/design/er/order-system.drawio
       docs/design/er/order-system.html

2. Google Drive アップロード(オプトイン)
   .claude/basic-design.local.md に Drive 設定(フォルダ ID)がある場合のみ、
   アップロードを提案する。設定がなければ Drive の話は一切出さない。
   設定の登録はユーザーが明示的に依頼したときだけ案内する。
   Drive 系 MCP Tool が見つからない場合は、導入案内+手動アップロード手順を
   伝えて STOP(ローカル保存は完了している)。
```

- git コミット・プッシュは通常のフローに任せる(独立した「GitHub モード」は持たない)。Web 版 Draw.io で開く場合の手順(app.diagrams.net → Open from GitHub / Google Drive)は保存完了時に案内する
- `.claude/basic-design.local.md` は plugin-settings パターン(YAML frontmatter + Markdown)。Drive フォルダ ID のような「ユーザー固有・リポジトリに入れたくない」値の定位置
- ローカルを正、クラウドを写しとする。アップロード失敗でブレストの成果が失われる事態を構造的に防ぐ

## 10. 入口スキル(basic-design)

1. 対象システムの概要(名前・一言サマリ・主要ユースケース 2〜3 個)を軽くブレスト
2. 作りたい成果物を AskUserQuestion(multiSelect)で選択
3. 推奨順(画面遷移 → ER → シーケンス → 構成図 → API一覧 → 非機能)を提示しつつ、ユーザーの希望順で各スキルを順に実行
4. **用語の引き継ぎ**: 概要ブレストで出た画面名・エンティティ名・外部システム名を後続スキルのブレストに文脈として渡し、同じ概念に別名がつくのを防ぐ
5. 全成果物完了後、生成ファイル一覧と開き方を最終報告

出力形式・保存先の確認はオーケストレーション全体で 1 回だけ行い、各スキルに引き継ぐ。

## 11. Markdown 系スキル

- **api-list**: エンドポイント一覧表(メソッド / パス / 概要 / リクエスト / レスポンス / 認証)を `docs/design/api/` に Markdown で出力
- **nfr-checklist**: 観点カタログ(性能・可用性・セキュリティ・運用保守・拡張性など)をスキル側が持ち、観点ごとに「対象システムでの要否と目標値」をブレストで埋めて `docs/design/nfr/` に出力
- いずれも「ブレスト → ドラフト全文提示 → 承認 → 保存」の共通規律に従う。変換スクリプトは使わない(Claude が直接 Markdown を書く)

## 12. テスト

- `lib/layout/*.mjs`: spec → レイアウト結果(座標・サイズ)の構造検証
- `lib/render/*.mjs`: レイアウト結果 → XML/HTML の構造検証(整形式性、要素数、エスケープ)
- `lib/validate.mjs`: 不正 spec がエラーメッセージ付きで弾かれることの検証
- 実行: `node --test plugins/basic-design/scripts/*.test.mjs`。CLAUDE.md の開発コマンド表に追記する

## 13. リリース

- `plugins/basic-design/.claude-plugin/plugin.json` を version `0.1.0-dev` で作成
- `.claude-plugin/marketplace.json` に basic-design のエントリを追加
- CLAUDE.md のプラグイン構成表・開発コマンド表に追記

## 14. スコープ外(初期リリースでは作らない)

- 既存コード・設計ドキュメントからの spec 自動生成(叩き台モード)
- .drawio の手修正内容を spec に逆反映する仕組み(手修正後は .drawio が正。スキルは新規ページ追加や別ファイル生成を提案する)
- HTML の編集機能・フィルタ・検索
- 力学モデル等の高度な自動レイアウト
- Google Drive API の直接実装(OAuth を扱わない)
