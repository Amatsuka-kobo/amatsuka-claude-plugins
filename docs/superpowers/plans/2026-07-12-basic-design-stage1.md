# basic-design プラグイン Stage 1(変換基盤+ER図)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** basic-design プラグインの変換パイプライン基盤(validate → layout → render)と ER図スキルを、spec JSON から .drawio / インタラクティブ HTML の両方を生成できる状態まで縦一本で実装する。

**Architecture:** spec JSON を `lib/validate.mjs` で検証し、`lib/layout/er.mjs` が出力形式非依存のレイアウト結果(座標・サイズ)を計算し、`lib/render/drawio.mjs` / `lib/render/html.mjs` がそれぞれ mxGraph XML / 単一 HTML にシリアライズする。エントリ CLI `design-gen.mjs` が spec の `type` でレイアウトを振り分け、結果 JSON を stdout に返す。

**Tech Stack:** Node.js 標準ライブラリのみ(依存ゼロ)。テストは `node --test`。スキルは SKILL.md(Markdown)。

**設計書:** `docs/superpowers/specs/2026-07-12-basic-design-plugin-design.md`(以下「設計書」)。本計画は設計書 §13 の段階 (1) に対応する。段階 (2) 残り 3 図種、(3) Markdown 系+入口スキル、(4) Drive 連携は、本計画の完了後に別の計画として作成する。

## Global Constraints

- 変換スクリプトは **Node 標準ライブラリのみ**。package.json も node_modules も作らない(設計書 §3)
- **Anthropic API・外部 API キーを前提にしない**(設計書 §3)
- CLI は **JSON を stdout に返し、成功時 exit 0 / 失敗時 exit 1**(設計書 §7。`plugins/task-utility/scripts/check-issue-env.mjs` と同じ流儀)
- スキルのディスカッションは**ユーザーの言語を厳守**、生成・保存は**明示承認制**(設計書 §5)
- plugin.json のバージョンは `0.1.0-dev` で作成。以後の上げ方はリポジトリ共通規則(CLAUDE.md)に従う
- テスト実行コマンド: `node --test plugins/basic-design/scripts/*.test.mjs`(リポジトリルートから)
- レイアウトの保証ラインは「**矩形が重ならない初期配置**」(設計書 §7)
- コミットメッセージ末尾: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: プラグインの土台

**Files:**
- Create: `plugins/basic-design/.claude-plugin/plugin.json`
- Create: `plugins/basic-design/README.md`

**Interfaces:**
- Consumes: なし
- Produces: プラグインディレクトリ `plugins/basic-design/`(後続タスクはすべてこの配下に置く)

- [ ] **Step 1: plugin.json を作成**

```json
{
  "name": "basic-design",
  "description": "基本設計フェーズの成果物(ER図・画面遷移図・システム構成図など)をブレインストーミングで作成するツール群",
  "version": "0.1.0-dev"
}
```

上記を `plugins/basic-design/.claude-plugin/plugin.json` に書く(既存例: `plugins/task-utility/.claude-plugin/plugin.json`)。

- [ ] **Step 2: README.md を作成**

```markdown
# basic-design

基本設計フェーズの成果物を、ユーザーとのブレインストーミングで練り上げて生成する Claude Code プラグイン。

- 図(ER図・画面遷移図・システム構成図・シーケンス図)は spec JSON を経由して .drawio / 単一 HTML の 2 形式で生成する
- 設計ドキュメント: `docs/superpowers/specs/2026-07-12-basic-design-plugin-design.md`

## 現在の実装状況

- Stage 1: 変換パイプライン基盤 + ER図スキル

## 開発

テスト: `node --test plugins/basic-design/scripts/*.test.mjs`(リポジトリルートから)
```

- [ ] **Step 3: コミット**

```bash
git add plugins/basic-design/
git commit -m "feat(basic-design): プラグインの土台を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: XML ユーティリティ(xml-util.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/lib/xml-util.mjs`
- Test: `plugins/basic-design/scripts/xml-util.test.mjs`

**Interfaces:**
- Consumes: なし
- Produces: `escapeXml(value: unknown): string` — XML 特殊文字 5 種(`& < > " '`)をエスケープした文字列を返す。非文字列は `String()` で文字列化してから処理する

- [ ] **Step 1: 失敗するテストを書く**

`plugins/basic-design/scripts/xml-util.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml } from './lib/xml-util.mjs';

test('escapeXml: XML 特殊文字 5 種をすべてエスケープする', () => {
  assert.equal(
    escapeXml(`<a & "b" 'c'>`),
    '&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;',
  );
});

test('escapeXml: 特殊文字を含まない文字列はそのまま返す', () => {
  assert.equal(escapeXml('users テーブル'), 'users テーブル');
});

test('escapeXml: 非文字列は文字列化して処理する', () => {
  assert.equal(escapeXml(123), '123');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/xml-util.test.mjs`
Expected: FAIL(`ERR_MODULE_NOT_FOUND` — lib/xml-util.mjs が存在しない)

- [ ] **Step 3: 最小実装を書く**

`plugins/basic-design/scripts/lib/xml-util.mjs`:

```js
const XML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/xml-util.test.mjs`
Expected: PASS(3 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): XML エスケープユーティリティを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: spec バリデーション(validate.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/lib/validate.mjs`
- Test: `plugins/basic-design/scripts/validate.test.mjs`

**Interfaces:**
- Consumes: なし
- Produces: `validateSpec(spec: unknown): string[]` — エラーメッセージの配列を返す。空配列 = 妥当。図種は Stage 1 では `er` のみ対応し、`SUPPORTED_TYPES` 配列(export)で管理する(Stage 2 で図種を足すときはこの配列と `RULES` にエントリを追加する)

検証規則(設計書 §7): 必須フィールドの存在 / ID・name の一意性 / 参照整合性。エラーメッセージは「どの要素のどのフィールドが、何を参照して失敗したか」を含める。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/basic-design/scripts/validate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from './lib/validate.mjs';

const validSpec = () => ({
  type: 'er',
  title: '受注管理 ER図',
  entities: [
    {
      name: 'users',
      label: 'ユーザー',
      columns: [
        { name: 'id', type: 'BIGINT', pk: true },
        { name: 'email', type: 'VARCHAR(255)', unique: true },
      ],
    },
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'BIGINT', pk: true },
        { name: 'user_id', type: 'BIGINT', fk: true },
      ],
    },
  ],
  relations: [
    { from: 'users', to: 'orders', cardinality: '1:N', label: '発注する' },
  ],
});

test('妥当な ER spec は空配列を返す', () => {
  assert.deepEqual(validateSpec(validSpec()), []);
});

test('オブジェクトでない spec はエラー', () => {
  assert.equal(validateSpec(null).length, 1);
  assert.equal(validateSpec('x').length, 1);
});

test('未対応の type はエラー', () => {
  const errors = validateSpec({ ...validSpec(), type: 'flowchart' });
  assert.ok(errors.some((e) => e.includes('flowchart')));
});

test('title が無い・空はエラー', () => {
  const spec = validSpec();
  delete spec.title;
  assert.ok(validateSpec(spec).some((e) => e.includes('title')));
  assert.ok(validateSpec({ ...validSpec(), title: '' }).some((e) => e.includes('title')));
});

test('entities が空配列はエラー', () => {
  const errors = validateSpec({ ...validSpec(), entities: [] });
  assert.ok(errors.some((e) => e.includes('entities')));
});

test('エンティティ名の重複はエラー(重複した名前を含むメッセージ)', () => {
  const spec = validSpec();
  spec.entities.push({ name: 'users', columns: [{ name: 'id' }] });
  assert.ok(validateSpec(spec).some((e) => e.includes('users') && e.includes('重複')));
});

test('カラム name が無いエンティティはエラー(エンティティ名を含むメッセージ)', () => {
  const spec = validSpec();
  spec.entities[0].columns.push({ type: 'TEXT' });
  assert.ok(validateSpec(spec).some((e) => e.includes('users')));
});

test('存在しないエンティティへの relation はエラー(参照名を含むメッセージ)', () => {
  const spec = validSpec();
  spec.relations.push({ from: 'users', to: 'products', cardinality: '1:N' });
  assert.ok(validateSpec(spec).some((e) => e.includes('products')));
});

test('不正な cardinality はエラー', () => {
  const spec = validSpec();
  spec.relations[0].cardinality = '1..*';
  assert.ok(validateSpec(spec).some((e) => e.includes('cardinality')));
});

test('relations は省略可', () => {
  const spec = validSpec();
  delete spec.relations;
  assert.deepEqual(validateSpec(spec), []);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/validate.test.mjs`
Expected: FAIL(`ERR_MODULE_NOT_FOUND`)

- [ ] **Step 3: 実装を書く**

`plugins/basic-design/scripts/lib/validate.mjs`:

```js
export const SUPPORTED_TYPES = ['er'];

const CARDINALITIES = ['1:1', '1:N', 'N:1', 'N:M'];

export function validateSpec(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['spec: JSON オブジェクトではありません'];
  }
  if (!SUPPORTED_TYPES.includes(spec.type)) {
    return [`type: 未対応の図種 "${spec.type}" です(対応: ${SUPPORTED_TYPES.join(', ')})`];
  }
  const errors = [];
  if (typeof spec.title !== 'string' || spec.title.trim() === '') {
    errors.push('title: 必須です(空でない文字列)');
  }
  errors.push(...RULES[spec.type](spec));
  return errors;
}

const RULES = {
  er: validateEr,
};

function validateEr(spec) {
  const errors = [];
  if (!Array.isArray(spec.entities) || spec.entities.length === 0) {
    errors.push('entities: 1 件以上のエンティティが必須です');
    return errors;
  }
  const names = new Set();
  for (const [i, entity] of spec.entities.entries()) {
    const where = `entities[${i}]`;
    if (typeof entity.name !== 'string' || entity.name.trim() === '') {
      errors.push(`${where}.name: 必須です(空でない文字列)`);
      continue;
    }
    if (names.has(entity.name)) {
      errors.push(`${where}.name: "${entity.name}" が重複しています`);
    }
    names.add(entity.name);
    if (!Array.isArray(entity.columns) || entity.columns.length === 0) {
      errors.push(`${where}(${entity.name}).columns: 1 件以上のカラムが必須です`);
      continue;
    }
    for (const [j, column] of entity.columns.entries()) {
      if (typeof column.name !== 'string' || column.name.trim() === '') {
        errors.push(`entities(${entity.name}).columns[${j}].name: 必須です(空でない文字列)`);
      }
    }
  }
  for (const [i, rel] of (spec.relations ?? []).entries()) {
    const where = `relations[${i}]`;
    for (const end of ['from', 'to']) {
      if (!names.has(rel[end])) {
        errors.push(`${where}.${end}: エンティティ "${rel[end]}" は entities に定義されていません`);
      }
    }
    if (!CARDINALITIES.includes(rel.cardinality)) {
      errors.push(`${where}.cardinality: "${rel.cardinality}" は不正です(対応: ${CARDINALITIES.join(', ')})`);
    }
  }
  return errors;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/validate.test.mjs`
Expected: PASS(10 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): spec バリデーション(ER図)を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: ER図レイアウト(layout/er.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/lib/layout/er.mjs`
- Create: `plugins/basic-design/scripts/test-helpers.mjs`
- Test: `plugins/basic-design/scripts/layout-er.test.mjs`

**Interfaces:**
- Consumes: 妥当性検証済みの ER spec(Task 3 の `validateSpec` が空配列を返したもの)
- Produces: `layoutEr(spec): LayoutResult` — 出力形式非依存のレイアウト結果。Task 5・6 のレンダラはこの構造だけに依存する:

```
LayoutResult = {
  type: 'er',
  title: string,
  nodes: [{
    id: string,            // エンティティ name
    label: string,         // 表示名(label があれば「label(name)」)
    x, y, width, height: number,
    headerHeight: number,  // タイトル帯の高さ(30)
    rowHeight: number,     // 1 行の高さ(26)
    rows: [{ text: string, meta: object }],  // meta は spec のカラムをそのまま保持
  }],
  edges: [{
    id: string,            // 'rel1', 'rel2', ...
    from: string, to: string,   // ノード id
    label: string,
    cardinality: '1:1' | '1:N' | 'N:1' | 'N:M',
  }],
}
```

- Produces: `test-helpers.mjs` の `rectsOverlap(a, b): boolean` — `{x, y, width, height}` 2 つの矩形の重なり判定。後続 Stage の全レイアウトテストで再利用する

レイアウト方針(設計書 §7): リレーション接続数の多いエンティティ順に、`ceil(sqrt(n))` 列のグリッドへ配置。行の高さはその行内の最大ノード高+ギャップ。保証ラインは「矩形が重ならない」こと。

- [ ] **Step 1: テストヘルパーと失敗するテストを書く**

テスト対象ではない共有ヘルパー(重なり判定)を先に作ってから、テスト本体を書く。TDD の「先に書くテスト」は layout-er.test.mjs のほうであり、ヘルパーはテストコードの一部として扱う。

`plugins/basic-design/scripts/test-helpers.mjs`:

```js
export function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
```

`plugins/basic-design/scripts/layout-er.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutEr } from './lib/layout/er.mjs';
import { rectsOverlap } from './test-helpers.mjs';

const spec = () => ({
  type: 'er',
  title: '受注管理 ER図',
  entities: [
    { name: 'products', columns: [{ name: 'id', pk: true }, { name: 'name' }] },
    {
      name: 'users',
      label: 'ユーザー',
      columns: [
        { name: 'id', type: 'BIGINT', pk: true },
        { name: 'email', type: 'VARCHAR(255)', unique: true },
      ],
    },
    { name: 'orders', columns: [{ name: 'id', pk: true }, { name: 'user_id', fk: true }] },
    { name: 'order_items', columns: [{ name: 'id', pk: true }] },
  ],
  relations: [
    { from: 'users', to: 'orders', cardinality: '1:N', label: '発注する' },
    { from: 'orders', to: 'order_items', cardinality: '1:N' },
    { from: 'products', to: 'order_items', cardinality: '1:N' },
  ],
});

test('全エンティティがノードになり、サイズは行数から決まる', () => {
  const layout = layoutEr(spec());
  assert.equal(layout.type, 'er');
  assert.equal(layout.title, '受注管理 ER図');
  assert.equal(layout.nodes.length, 4);
  const users = layout.nodes.find((n) => n.id === 'users');
  assert.equal(users.height, users.headerHeight + 2 * users.rowHeight);
  assert.equal(users.label, 'ユーザー(users)');
  const products = layout.nodes.find((n) => n.id === 'products');
  assert.equal(products.label, 'products');
});

test('どのノードのペアも重ならない', () => {
  const layout = layoutEr(spec());
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      assert.ok(
        !rectsOverlap(layout.nodes[i], layout.nodes[j]),
        `${layout.nodes[i].id} と ${layout.nodes[j].id} が重なっています`,
      );
    }
  }
});

test('接続数の多いエンティティが先頭に配置される', () => {
  const layout = layoutEr(spec());
  // orders と order_items が接続数 2、users と products が 1
  assert.ok(['orders', 'order_items'].includes(layout.nodes[0].id));
});

test('行テキストに PK/FK/UQ マーカーと型が入る', () => {
  const layout = layoutEr(spec());
  const users = layout.nodes.find((n) => n.id === 'users');
  assert.equal(users.rows[0].text, '[PK] id : BIGINT');
  assert.equal(users.rows[1].text, '[UQ] email : VARCHAR(255)');
  assert.deepEqual(users.rows[0].meta, { name: 'id', type: 'BIGINT', pk: true });
});

test('エッジが relation の順に採番される', () => {
  const layout = layoutEr(spec());
  assert.equal(layout.edges.length, 3);
  assert.deepEqual(layout.edges[0], {
    id: 'rel1',
    from: 'users',
    to: 'orders',
    label: '発注する',
    cardinality: '1:N',
  });
  assert.equal(layout.edges[1].label, '');
});

test('relations 省略時はエッジが空', () => {
  const s = spec();
  delete s.relations;
  assert.deepEqual(layoutEr(s).edges, []);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/layout-er.test.mjs`
Expected: FAIL(`ERR_MODULE_NOT_FOUND` — lib/layout/er.mjs が存在しない)

- [ ] **Step 3: 実装を書く**

`plugins/basic-design/scripts/lib/layout/er.mjs`:

```js
const ENTITY_WIDTH = 220;
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 26;
const GAP_X = 80;
const GAP_Y = 60;

export function layoutEr(spec) {
  const relations = spec.relations ?? [];
  const degree = new Map(spec.entities.map((e) => [e.name, 0]));
  for (const rel of relations) {
    degree.set(rel.from, degree.get(rel.from) + 1);
    degree.set(rel.to, degree.get(rel.to) + 1);
  }
  const ordered = [...spec.entities].sort(
    (a, b) => degree.get(b.name) - degree.get(a.name),
  );

  const cols = Math.ceil(Math.sqrt(ordered.length));
  const nodes = [];
  let y = 0;
  for (let start = 0; start < ordered.length; start += cols) {
    const rowEntities = ordered.slice(start, start + cols);
    let rowMaxHeight = 0;
    rowEntities.forEach((entity, i) => {
      const height = HEADER_HEIGHT + entity.columns.length * ROW_HEIGHT;
      nodes.push({
        id: entity.name,
        label: entity.label ? `${entity.label}(${entity.name})` : entity.name,
        x: i * (ENTITY_WIDTH + GAP_X),
        y,
        width: ENTITY_WIDTH,
        height,
        headerHeight: HEADER_HEIGHT,
        rowHeight: ROW_HEIGHT,
        rows: entity.columns.map((column) => ({
          text: formatColumn(column),
          meta: column,
        })),
      });
      rowMaxHeight = Math.max(rowMaxHeight, height);
    });
    y += rowMaxHeight + GAP_Y;
  }

  const edges = relations.map((rel, i) => ({
    id: `rel${i + 1}`,
    from: rel.from,
    to: rel.to,
    label: rel.label ?? '',
    cardinality: rel.cardinality,
  }));

  return { type: 'er', title: spec.title, nodes, edges };
}

function formatColumn(column) {
  const marks = [
    column.pk && 'PK',
    column.fk && 'FK',
    column.unique && 'UQ',
  ].filter(Boolean);
  const prefix = marks.length ? `[${marks.join(',')}] ` : '';
  return column.type ? `${prefix}${column.name} : ${column.type}` : `${prefix}${column.name}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/layout-er.test.mjs`
Expected: PASS(6 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): ER図レイアウトエンジンを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Draw.io レンダラ(render/drawio.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/lib/render/drawio.mjs`
- Test: `plugins/basic-design/scripts/render-drawio.test.mjs`

**Interfaces:**
- Consumes: Task 4 の `LayoutResult`、Task 2 の `escapeXml`
- Produces: `renderDrawio(layout: LayoutResult): string` — mxGraph XML(mxfile 形式)の文字列。呼び出し側(Task 7)がファイルに書く

実装上の注意:
- ノードの mxCell id は `n-<node.id>` にプレフィックスする(mxGraph のルートセル id "0"・"1" との衝突回避)。行セルは `n-<node.id>-row<番号>`、エッジは `e-<edge.id>`
- エンティティは swimlane(childLayout=stackLayout)、カラム行はその子セル
- カーディナリティは ER 矢印(ERone / ERmany)にマップする
- **座標系**: エンティティの mxGeometry はキャンバス絶対座標(layout の x, y そのまま)。カラム行の mxGeometry は **親 swimlane からの相対座標**(y = headerHeight + 行番号 × rowHeight、x は省略 = 0)。Task 6 の SVG も行は親 `<g>` 相対だが、あちらは text 要素の縦中央合わせで rowHeight/2 を足す点だけが違う

- [ ] **Step 1: 失敗するテストを書く**

`plugins/basic-design/scripts/render-drawio.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDrawio } from './lib/render/drawio.mjs';

const layout = () => ({
  type: 'er',
  title: 'テスト <ER図>',
  nodes: [
    {
      id: 'users',
      label: 'ユーザー(users)',
      x: 0, y: 0, width: 220, height: 82,
      headerHeight: 30, rowHeight: 26,
      rows: [
        { text: '[PK] id : BIGINT', meta: { name: 'id' } },
        { text: 'email & name', meta: { name: 'email' } },
      ],
    },
    {
      id: 'orders',
      label: 'orders',
      x: 300, y: 0, width: 220, height: 56,
      headerHeight: 30, rowHeight: 26,
      rows: [{ text: '[PK] id', meta: { name: 'id' } }],
    },
  ],
  edges: [
    { id: 'rel1', from: 'users', to: 'orders', label: '発注する', cardinality: '1:N' },
  ],
});

test('mxfile 構造とタイトルのエスケープ', () => {
  const xml = renderDrawio(layout());
  assert.ok(xml.startsWith('<mxfile'));
  assert.ok(xml.includes('<diagram name="テスト &lt;ER図&gt;">'));
  assert.ok(xml.includes('<mxCell id="0"/>'));
  assert.ok(xml.includes('<mxCell id="1" parent="0"/>'));
});

test('エンティティが swimlane セルになり、座標が geometry に入る', () => {
  const xml = renderDrawio(layout());
  assert.ok(xml.includes('<mxCell id="n-users" value="ユーザー(users)"'));
  assert.ok(/id="n-users"[^>]*style="swimlane;/.test(xml));
  assert.ok(/id="n-orders"[^>]*>\s*<mxGeometry x="300" y="0" width="220" height="56"/.test(xml));
});

test('カラム行が親エンティティの子セルになり、テキストがエスケープされる', () => {
  const xml = renderDrawio(layout());
  assert.ok(xml.includes('<mxCell id="n-users-row2" value="email &amp; name"'));
  assert.ok(/id="n-users-row1"[^>]*parent="n-users"/.test(xml));
  // 行の y オフセット: headerHeight + (行番号-1) * rowHeight
  assert.ok(/id="n-users-row2"[^>]*>\s*<mxGeometry y="56" width="220" height="26"/.test(xml));
});

test('エッジがカーディナリティに応じた ER 矢印を持つ', () => {
  const xml = renderDrawio(layout());
  assert.ok(/id="e-rel1"[^>]*source="n-users" target="n-orders"/.test(xml));
  assert.ok(/id="e-rel1"[^>]*startArrow=ERone;[^"]*endArrow=ERmany;/.test(xml));
  assert.ok(xml.includes('value="発注する"'));
});

test('N:M は両端 ERmany', () => {
  const l = layout();
  l.edges[0].cardinality = 'N:M';
  const xml = renderDrawio(l);
  assert.ok(/startArrow=ERmany;[^"]*endArrow=ERmany;/.test(xml));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/render-drawio.test.mjs`
Expected: FAIL(`ERR_MODULE_NOT_FOUND`)

- [ ] **Step 3: 実装を書く**

`plugins/basic-design/scripts/lib/render/drawio.mjs`:

```js
import { escapeXml } from '../xml-util.mjs';

const CARDINALITY_ARROWS = {
  '1:1': ['ERone', 'ERone'],
  '1:N': ['ERone', 'ERmany'],
  'N:1': ['ERmany', 'ERone'],
  'N:M': ['ERmany', 'ERmany'],
};

const ENTITY_STYLE =
  'swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=30;' +
  'horizontalStack=0;resizeParent=0;collapsible=0;rounded=0;';
const ROW_STYLE =
  'text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;' +
  'spacingLeft=8;overflow=hidden;';

export function renderDrawio(layout) {
  const cells = [];
  for (const node of layout.nodes) {
    const nodeId = `n-${node.id}`;
    cells.push(
      `<mxCell id="${escapeXml(nodeId)}" value="${escapeXml(node.label)}" style="${ENTITY_STYLE}" vertex="1" parent="1">` +
        `<mxGeometry x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" as="geometry"/>` +
        `</mxCell>`,
    );
    node.rows.forEach((row, i) => {
      const rowY = node.headerHeight + i * node.rowHeight;
      cells.push(
        `<mxCell id="${escapeXml(`${nodeId}-row${i + 1}`)}" value="${escapeXml(row.text)}" style="${ROW_STYLE}" vertex="1" parent="${escapeXml(nodeId)}">` +
          `<mxGeometry y="${rowY}" width="${node.width}" height="${node.rowHeight}" as="geometry"/>` +
          `</mxCell>`,
      );
    });
  }
  for (const edge of layout.edges) {
    const [startArrow, endArrow] = CARDINALITY_ARROWS[edge.cardinality] ?? ['none', 'open'];
    const style =
      `edgeStyle=entityRelationEdgeStyle;rounded=0;` +
      `startArrow=${startArrow};startFill=0;endArrow=${endArrow};endFill=0;`;
    cells.push(
      `<mxCell id="${escapeXml(`e-${edge.id}`)}" value="${escapeXml(edge.label)}" style="${style}" edge="1" parent="1" source="${escapeXml(`n-${edge.from}`)}" target="${escapeXml(`n-${edge.to}`)}">` +
        `<mxGeometry relative="1" as="geometry"/>` +
        `</mxCell>`,
    );
  }
  return (
    `<mxfile host="basic-design">` +
    `<diagram name="${escapeXml(layout.title)}">` +
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root>` +
    `</mxGraphModel></diagram></mxfile>`
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/render-drawio.test.mjs`
Expected: PASS(5 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): Draw.io レンダラを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: HTML レンダラ(render/html.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/lib/render/html.mjs`
- Test: `plugins/basic-design/scripts/render-html.test.mjs`

**Interfaces:**
- Consumes: Task 4 の `LayoutResult`、元 spec(埋め込み用)、Task 2 の `escapeXml`
- Produces: `renderHtml(layout: LayoutResult, spec: object): string` — 依存ゼロの単一 HTML 文字列

設計書 §8 の要件:
- インライン SVG、vanilla JS インライン埋め込み、file:// で動作
- spec JSON を `<script type="application/json" id="design-spec">` として埋め込む(`<` は `<` にエスケープし script 終端事故を防ぐ)。レイアウト結果も `id="design-layout"` で埋め込み、詳細パネルはここから引く(図種非依存にするため)
- インタラクション: ズーム(ホイール)・パン(ドラッグ)/ クリックで「その要素+直接接続する要素・エッジを強調、他を減光」/ ホバーは同じ対象の薄い強調 / 右固定サイドパネルに詳細 / 背景クリックで解除

- [ ] **Step 1: 失敗するテストを書く**

`plugins/basic-design/scripts/render-html.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from './lib/render/html.mjs';

const layout = () => ({
  type: 'er',
  title: 'テスト ER図',
  nodes: [
    {
      id: 'users', label: 'ユーザー(users)',
      x: 0, y: 0, width: 220, height: 82, headerHeight: 30, rowHeight: 26,
      rows: [
        { text: '[PK] id : BIGINT', meta: { name: 'id', pk: true } },
        { text: 'email </script>', meta: { name: 'email' } },
      ],
    },
    {
      id: 'orders', label: 'orders',
      x: 300, y: 0, width: 220, height: 56, headerHeight: 30, rowHeight: 26,
      rows: [{ text: '[PK] id', meta: { name: 'id' } }],
    },
  ],
  edges: [{ id: 'rel1', from: 'users', to: 'orders', label: '発注', cardinality: '1:N' }],
});

const spec = () => ({ type: 'er', title: 'テスト ER図', entities: [{ name: 'users' }] });

test('単一 HTML として成立し、外部リソース参照が無い', () => {
  const html = renderHtml(layout(), spec());
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!/\bsrc\s*=\s*"https?:/.test(html));
  assert.ok(!/<link[^>]*href\s*=\s*"https?:/.test(html));
});

test('ノードとエッジが data 属性付きで SVG に出る', () => {
  const html = renderHtml(layout(), spec());
  assert.ok(html.includes('<g class="node" data-id="users"'));
  assert.ok(html.includes('<g class="node" data-id="orders"'));
  assert.ok(html.includes('data-from="users"'));
  assert.ok(html.includes('data-to="orders"'));
});

test('spec とレイアウトが JSON として埋め込まれ、script 終端が壊れない', () => {
  const html = renderHtml(layout(), spec());
  assert.ok(html.includes('<script type="application/json" id="design-spec">'));
  assert.ok(html.includes('<script type="application/json" id="design-layout">'));
  // JSON 内に生の </script> が出現しないこと(< エスケープ)
  const jsonPart = html.split('id="design-layout">')[1].split('</script>')[0];
  assert.ok(!jsonPart.includes('</script'));
  assert.ok(jsonPart.includes('\\u003c/script>'));
});

test('行テキストが SVG 内でエスケープされる', () => {
  const html = renderHtml(layout(), spec());
  assert.ok(html.includes('email &lt;/script&gt;'));
});

test('インタラクション用のフックが揃っている', () => {
  const html = renderHtml(layout(), spec());
  assert.ok(html.includes('id="canvas"'));     // ズーム・パン対象の svg
  assert.ok(html.includes('id="panel"'));      // 詳細サイドパネル
  assert.ok(html.includes("addEventListener('wheel'"));
  assert.ok(html.includes("addEventListener('pointerdown'"));
  assert.ok(html.includes("addEventListener('click'"));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/render-html.test.mjs`
Expected: FAIL(`ERR_MODULE_NOT_FOUND`)

- [ ] **Step 3: 実装を書く**

`plugins/basic-design/scripts/lib/render/html.mjs`:

```js
import { escapeXml } from '../xml-util.mjs';

const PAD = 40;

export function renderHtml(layout, spec) {
  const width = Math.max(...layout.nodes.map((n) => n.x + n.width)) + PAD * 2;
  const height = Math.max(...layout.nodes.map((n) => n.y + n.height)) + PAD * 2;
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  const edgeSvg = layout.edges
    .map((edge) => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      const x1 = a.x + a.width / 2 + PAD;
      const y1 = a.y + a.height / 2 + PAD;
      const x2 = b.x + b.width / 2 + PAD;
      const y2 = b.y + b.height / 2 + PAD;
      const label = [edge.label, edge.cardinality].filter(Boolean).join(' ');
      return (
        `<g class="edge" data-id="${escapeXml(edge.id)}" data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}">` +
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
        `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" class="edge-label">${escapeXml(label)}</text>` +
        `</g>`
      );
    })
    .join('\n');

  const nodeSvg = layout.nodes
    .map((node) => {
      const rows = node.rows
        .map((row, i) => {
          const rowY = node.headerHeight + i * node.rowHeight + node.rowHeight / 2;
          return `<text x="8" y="${rowY}" dominant-baseline="middle" class="row">${escapeXml(row.text)}</text>`;
        })
        .join('');
      return (
        `<g class="node" data-id="${escapeXml(node.id)}" transform="translate(${node.x + PAD},${node.y + PAD})">` +
        `<rect width="${node.width}" height="${node.height}" class="node-box"/>` +
        `<rect width="${node.width}" height="${node.headerHeight}" class="node-header"/>` +
        `<text x="${node.width / 2}" y="${node.headerHeight / 2}" text-anchor="middle" dominant-baseline="middle" class="node-title">${escapeXml(node.label)}</text>` +
        rows +
        `</g>`
      );
    })
    .join('\n');

  const embed = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeXml(layout.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; display: flex; height: 100vh; }
  main { flex: 1; overflow: hidden; background: #fafafa; }
  svg { width: 100%; height: 100%; cursor: grab; }
  svg.panning { cursor: grabbing; }
  .node-box { fill: #fff; stroke: #333; }
  .node-header { fill: #e8eef7; stroke: #333; }
  .node-title { font-weight: bold; font-size: 13px; }
  .row { font-size: 12px; fill: #222; }
  .edge line { stroke: #666; stroke-width: 1.5; }
  .edge-label { font-size: 11px; fill: #444; }
  .node, .edge { transition: opacity .15s; }
  svg.has-selection .node:not(.hl), svg.has-selection .edge:not(.hl) { opacity: .25; }
  svg.has-hover .node:not(.pv):not(.hl), svg.has-hover .edge:not(.pv):not(.hl) { opacity: .5; }
  .hl .node-box, .pv .node-box { stroke: #1a63c9; stroke-width: 2; }
  .hl line, .pv line { stroke: #1a63c9; stroke-width: 2.5; }
  aside { width: 280px; border-left: 1px solid #ddd; padding: 12px; overflow-y: auto; background: #fff; }
  aside h2 { font-size: 14px; margin: 0 0 8px; }
  aside table { width: 100%; border-collapse: collapse; font-size: 12px; }
  aside td { border-bottom: 1px solid #eee; padding: 4px 2px; }
</style>
</head>
<body>
<main>
<svg id="canvas" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
<g id="edges">
${edgeSvg}
</g>
<g id="nodes">
${nodeSvg}
</g>
</svg>
</main>
<aside id="panel" hidden>
<h2 id="panel-title"></h2>
<div id="panel-body"></div>
</aside>
<script type="application/json" id="design-spec">${embed(spec)}</script>
<script type="application/json" id="design-layout">${embed(layout)}</script>
<script>
(() => {
  const svg = document.getElementById('canvas');
  const layout = JSON.parse(document.getElementById('design-layout').textContent);
  const panel = document.getElementById('panel');
  const panelTitle = document.getElementById('panel-title');
  const panelBody = document.getElementById('panel-body');
  const vb = svg.viewBox.baseVal;

  // --- ズーム(ポインタ位置を中心に) ---
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const scale = e.deltaY < 0 ? 0.9 : 1.1;
    const rect = svg.getBoundingClientRect();
    const px = vb.x + ((e.clientX - rect.left) / rect.width) * vb.width;
    const py = vb.y + ((e.clientY - rect.top) / rect.height) * vb.height;
    vb.x = px - (px - vb.x) * scale;
    vb.y = py - (py - vb.y) * scale;
    vb.width *= scale;
    vb.height *= scale;
  }, { passive: false });

  // --- パン(ドラッグ) ---
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    drag = { cx: e.clientX, cy: e.clientY, vx: vb.x, vy: vb.y, moved: false };
    svg.classList.add('panning');
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - drag.cx) / rect.width) * vb.width;
    const dy = ((e.clientY - drag.cy) / rect.height) * vb.height;
    if (Math.abs(e.clientX - drag.cx) + Math.abs(e.clientY - drag.cy) > 3) drag.moved = true;
    vb.x = drag.vx - dx;
    vb.y = drag.vy - dy;
  });
  window.addEventListener('pointerup', () => {
    svg.classList.remove('panning');
    setTimeout(() => { drag = null; }, 0);
  });

  // --- 接続集合の計算 ---
  function connected(g) {
    const set = new Set([g]);
    if (g.classList.contains('node')) {
      const id = g.dataset.id;
      svg.querySelectorAll('.edge').forEach((eg) => {
        if (eg.dataset.from === id || eg.dataset.to === id) {
          set.add(eg);
          const otherId = eg.dataset.from === id ? eg.dataset.to : eg.dataset.from;
          const other = svg.querySelector('.node[data-id="' + CSS.escape(otherId) + '"]');
          if (other) set.add(other);
        }
      });
    } else {
      for (const key of ['from', 'to']) {
        const n = svg.querySelector('.node[data-id="' + CSS.escape(g.dataset[key]) + '"]');
        if (n) set.add(n);
      }
    }
    return set;
  }

  // --- 選択(クリック) ---
  function clearSelection() {
    svg.classList.remove('has-selection');
    svg.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl'));
    panel.hidden = true;
  }
  svg.addEventListener('click', (e) => {
    if (drag && drag.moved) return; // パン後のクリックは無視
    const g = e.target.closest('.node, .edge');
    clearSelection();
    if (!g) return;
    svg.classList.add('has-selection');
    connected(g).forEach((el) => el.classList.add('hl'));
    showPanel(g);
  });

  // --- ホバー(プレビュー) ---
  svg.addEventListener('pointerover', (e) => {
    const g = e.target.closest('.node, .edge');
    if (!g) return;
    svg.classList.add('has-hover');
    connected(g).forEach((el) => el.classList.add('pv'));
  });
  svg.addEventListener('pointerout', () => {
    svg.classList.remove('has-hover');
    svg.querySelectorAll('.pv').forEach((el) => el.classList.remove('pv'));
  });

  // --- 詳細パネル(レイアウト JSON から図種非依存に描画) ---
  function showPanel(g) {
    panel.hidden = false;
    panelBody.textContent = '';
    if (g.classList.contains('node')) {
      const node = layout.nodes.find((n) => n.id === g.dataset.id);
      panelTitle.textContent = node.label;
      const table = document.createElement('table');
      for (const row of node.rows) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.textContent = row.text;
        tr.appendChild(td);
        table.appendChild(tr);
      }
      panelBody.appendChild(table);
    } else {
      const edge = layout.edges.find((ed) => ed.id === g.dataset.id);
      panelTitle.textContent = edge.label || edge.id;
      const dl = document.createElement('table');
      for (const [k, v] of [['from', edge.from], ['to', edge.to], ['cardinality', edge.cardinality]]) {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td');
        const td2 = document.createElement('td');
        td1.textContent = k;
        td2.textContent = v || '';
        tr.append(td1, td2);
        dl.appendChild(tr);
      }
      panelBody.appendChild(dl);
    }
  }
})();
</script>
</body>
</html>
`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/render-html.test.mjs`
Expected: PASS(5 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): インタラクティブ HTML レンダラを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: エントリ CLI(design-gen.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/design-gen.mjs`
- Test: `plugins/basic-design/scripts/design-gen.test.mjs`

**Interfaces:**
- Consumes: Task 3 `validateSpec` / Task 4 `layoutEr` / Task 5 `renderDrawio` / Task 6 `renderHtml`
- Produces: CLI 契約(設計書 §7)。スキル(Task 8)はこの CLI だけを呼ぶ:
  - `node design-gen.mjs <spec.json> --format <drawio|html|both>`
  - 出力ファイルは spec と同じディレクトリ・同じベース名(`X.spec.json` → `X.drawio` / `X.html`。`.spec.json` で終わらない場合は拡張子 `.json` を外したもの)
  - 成功: stdout に `{"ok":true,"files":["<絶対パス>", ...]}`、exit 0
  - 失敗: stdout に `{"ok":false,"errors":["...", ...]}`、exit 1(spec 不正・引数不正・ファイル不存在すべて)

- [ ] **Step 1: 失敗するテストを書く**

`plugins/basic-design/scripts/design-gen.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const CLI = new URL('./design-gen.mjs', import.meta.url).pathname;

const validSpec = {
  type: 'er',
  title: 'テスト ER図',
  entities: [
    { name: 'users', columns: [{ name: 'id', pk: true }] },
    { name: 'orders', columns: [{ name: 'id', pk: true }] },
  ],
  relations: [{ from: 'users', to: 'orders', cardinality: '1:N' }],
};

async function writeSpec(spec, filename = 'sample.spec.json') {
  const dir = await mkdtemp(path.join(tmpdir(), 'design-gen-'));
  const specPath = path.join(dir, filename);
  await writeFile(specPath, JSON.stringify(spec));
  return { dir, specPath };
}

// exit 1 でも stdout の JSON を取り出すヘルパー
async function runCli(args) {
  try {
    const { stdout } = await run('node', [CLI, ...args]);
    return { code: 0, json: JSON.parse(stdout) };
  } catch (err) {
    return { code: err.code, json: JSON.parse(err.stdout) };
  }
}

test('--format both で .drawio と .html が生成される', async () => {
  const { dir, specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath, '--format', 'both']);
  assert.equal(code, 0);
  assert.equal(json.ok, true);
  assert.deepEqual(
    json.files.map((f) => path.basename(f)).sort(),
    ['sample.drawio', 'sample.html'],
  );
  for (const f of json.files) await access(f); // 実在する
  const drawio = await readFile(path.join(dir, 'sample.drawio'), 'utf8');
  assert.ok(drawio.startsWith('<mxfile'));
  const html = await readFile(path.join(dir, 'sample.html'), 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
});

test('--format drawio は .drawio のみ生成する', async () => {
  const { specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath, '--format', 'drawio']);
  assert.equal(code, 0);
  assert.equal(json.files.length, 1);
  assert.ok(json.files[0].endsWith('sample.drawio'));
});

test('.spec.json で終わらないファイル名は .json を外してベース名にする', async () => {
  const { specPath } = await writeSpec(validSpec, 'er-diagram.json');
  const { json } = await runCli([specPath, '--format', 'drawio']);
  assert.ok(json.files[0].endsWith('er-diagram.drawio'));
});

test('不正な spec は ok:false・exit 1・エラー配列を返す', async () => {
  const { specPath } = await writeSpec({ type: 'er', title: 'x', entities: [] });
  const { code, json } = await runCli([specPath, '--format', 'both']);
  assert.equal(code, 1);
  assert.equal(json.ok, false);
  assert.ok(json.errors.length >= 1);
  assert.ok(json.errors.some((e) => e.includes('entities')));
});

test('不正な --format は exit 1', async () => {
  const { specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath, '--format', 'pdf']);
  assert.equal(code, 1);
  assert.ok(json.errors.some((e) => e.includes('pdf')));
});

test('--format に値が無い場合も exit 1', async () => {
  const { specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath, '--format']);
  assert.equal(code, 1);
  assert.equal(json.ok, false);
});

test('--format 省略時は both として動く', async () => {
  const { specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath]);
  assert.equal(code, 0);
  assert.equal(json.files.length, 2);
});

test('存在しない spec ファイルは exit 1', async () => {
  const { code, json } = await runCli(['/no/such/file.spec.json', '--format', 'both']);
  assert.equal(code, 1);
  assert.equal(json.ok, false);
});

test('JSON として読めない spec ファイルは exit 1', async () => {
  const { dir } = await writeSpec(validSpec);
  const brokenPath = path.join(dir, 'broken.spec.json');
  await writeFile(brokenPath, '{not json');
  const { code, json } = await runCli([brokenPath, '--format', 'both']);
  assert.equal(code, 1);
  assert.equal(json.ok, false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/design-gen.test.mjs`
Expected: FAIL(CLI が存在しないため spawn エラー、または JSON parse 失敗)

- [ ] **Step 3: 実装を書く**

`plugins/basic-design/scripts/design-gen.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateSpec } from './lib/validate.mjs';
import { layoutEr } from './lib/layout/er.mjs';
import { renderDrawio } from './lib/render/drawio.mjs';
import { renderHtml } from './lib/render/html.mjs';

const LAYOUTS = { er: layoutEr };
const FORMATS = ['drawio', 'html', 'both'];

function fail(errors) {
  process.stdout.write(JSON.stringify({ ok: false, errors }) + '\n');
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const formatIndex = args.indexOf('--format');
  const specArg = args.find((a, i) => !a.startsWith('--') && i !== formatIndex + 1);
  const format = formatIndex === -1 ? 'both' : args[formatIndex + 1];

  if (!specArg) {
    fail(['usage: node design-gen.mjs <spec.json> --format <drawio|html|both>']);
  }
  if (!FORMATS.includes(format)) {
    fail([`--format: "${format}" は不正です(対応: ${FORMATS.join(', ')})`]);
  }

  let spec;
  try {
    spec = JSON.parse(readFileSync(specArg, 'utf8'));
  } catch (err) {
    fail([`spec ファイルを読めません: ${err.message}`]);
  }

  const errors = validateSpec(spec);
  if (errors.length > 0) fail(errors);

  const layout = LAYOUTS[spec.type](spec);

  const dir = path.dirname(path.resolve(specArg));
  const filename = path.basename(specArg);
  const base = filename.endsWith('.spec.json')
    ? filename.slice(0, -'.spec.json'.length)
    : filename.replace(/\.json$/, '');

  const files = [];
  if (format === 'drawio' || format === 'both') {
    const outPath = path.join(dir, `${base}.drawio`);
    writeFileSync(outPath, renderDrawio(layout));
    files.push(outPath);
  }
  if (format === 'html' || format === 'both') {
    const outPath = path.join(dir, `${base}.html`);
    writeFileSync(outPath, renderHtml(layout, spec));
    files.push(outPath);
  }
  process.stdout.write(JSON.stringify({ ok: true, files }) + '\n');
}

main();
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/design-gen.test.mjs`
Expected: PASS(9 tests)

- [ ] **Step 5: 全テストを通しで確認**

Run: `node --test plugins/basic-design/scripts/*.test.mjs`
Expected: PASS(全ファイル。fail 0)

- [ ] **Step 6: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): design-gen CLI を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: ER図スキル(er-diagram)

**Files:**
- Create: `plugins/basic-design/skills/er-diagram/SKILL.md`
- Create: `plugins/basic-design/skills/er-diagram/references/spec-schema.md`

**Interfaces:**
- Consumes: Task 7 の CLI 契約(`${CLAUDE_PLUGIN_ROOT}/scripts/design-gen.mjs`)
- Produces: ユーザーが「ER図を作って」で発動できるスキル。Stage 3 の入口スキルはこのスキルへ委譲する

`${CLAUDE_PLUGIN_ROOT}` は Claude Code がスキル実行時に提供する標準環境変数で、インストールされたプラグインのルートディレクトリを指す。既存の使用例: `plugins/task-utility/skills/issue-craft/SKILL.md` の `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-issue-env.mjs"`。プラグイン側での定義・設定は不要。

スキルはコードを持たないため自動テストなし(設計書 §12)。検証は Step 3 のセルフチェックとドッグフーディング。

- [ ] **Step 1: SKILL.md を書く**

`plugins/basic-design/skills/er-diagram/SKILL.md`:

```markdown
---
name: er-diagram
description: ユーザーが ER図(エンティティ・リレーションシップ図)の作成・更新を依頼したときに必ず使用するスキル。ユーザーとのブレインストーミングでエンティティとリレーションを練り上げ、Draw.io 形式(.drawio)またはインタラクティブ HTML として docs/design/er/ に生成する。明示的な依頼があったときのみ使い、自律的には発動しない。
---

# ER Diagram — ER図の作成

## 目的

ユーザーから与えられた情報を出発点に、ブレインストーミングでデータモデルを練り上げ、ER図として生成する。

## 大原則

- **ディスカッションはユーザーが使用する言語を厳守する**
- **ユーザーの明示的な承認を得るまで生成・保存しない**
- STOP するときは必ず「理由+次にユーザーがすべきこと」を伝えて終了する
- 生成に失敗したら生のエラーをそのまま報告する。spec JSON を修正して再実行する以外の勝手な代替手段への切り替えをしない

## 手順

### 1. 環境チェックと最初の確認(1 回の質問にまとめる)

`node --version` で Node.js が使えることを確かめる(使えなければ導入を案内して STOP)。

AskUserQuestion で次を確認する:

- **出力形式**: Draw.io(.drawio)/ インタラクティブ HTML / 両方
- **保存先**: `docs/design/er/` を既定として提案し、変更希望を確認する

すでに入口スキル(basic-design)から出力形式・保存先を引き継いでいる場合、この確認は省略する。

### 2. ブレインストーミング

自由対話で進めつつ、次の観点がすべて埋まるまで、**不足している観点だけを 1 問ずつ**質問する。選択式で聞ける場面では AskUserQuestion を使う。

| 観点 | 埋まる状態 |
| --- | --- |
| エンティティ | 対象領域の主要エンティティが列挙され、それぞれ一言で説明できる |
| 属性・キー | 各エンティティの主要カラムと PK。必要に応じて FK・ユニーク制約 |
| リレーション | エンティティ間の関係とカーディナリティ(1:1 / 1:N / N:1 / N:M) |
| 命名規約 | テーブル名・カラム名の形式(例: スネークケース複数形)。既存 DB があればそれに合わせる |

先行する成果物・用語集(入口スキルの概要ブレストなど)がある場合、エンティティ名・画面名はそれに従う。

### 3. ドラフト提示 → 明示承認

図を生成する前に、内容をテキストで**全文**提示し承認を得る:

- エンティティ一覧(名前・ラベル・カラム・キー)
- リレーション一覧(from → to、カーディナリティ、ラベル)

### 4. spec JSON の書き出しと生成

承認された内容を `references/spec-schema.md` のスキーマに従って spec JSON にまとめ、保存先に `<図の名前>.spec.json` として書き出す。ファイル名はケバブケース(例: `order-system.spec.json`)。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/design-gen.mjs" <保存先>/<名前>.spec.json --format <drawio|html|both>
```

- 出力 JSON が `ok: true` なら、生成されたファイル一覧を確認する
- `ok: false` なら `errors` を読み、spec JSON を修正して再実行する。2 回修正しても解消しない場合は、エラー全文をユーザーに報告して STOP

### 5. 完了報告

生成したファイルのパス一覧と開き方を報告する:

- `.drawio`: app.diagrams.net で「File > Open from > Device」、または GitHub 連携(「Open from GitHub」)で開ける
- `.html`: ブラウザでそのまま開ける(ダブルクリック / `file://`)

git コミットはユーザーの指示があったときのみ行う。

## 既存図の更新

同名の `.spec.json` が既にある場合は、それを読み込んで現状を把握し、差分をブレストしてから spec を更新・再生成する。`.drawio` に手修正が入っている可能性をユーザーに確認し、手修正があるなら上書きせず別名での生成を提案する(spec が正 / 手修正後は .drawio が正、の原則)。
```

- [ ] **Step 2: references/spec-schema.md を書く**

`plugins/basic-design/skills/er-diagram/references/spec-schema.md`:

```markdown
# ER図 spec JSON スキーマ

`design-gen.mjs` が受け付ける ER図 spec の完全な定義。

## トップレベル

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `type` | string | ✓ | 固定値 `"er"` |
| `title` | string | ✓ | 図のタイトル(空文字不可) |
| `entities` | Entity[] | ✓ | 1 件以上 |
| `relations` | Relation[] | - | 省略時はリレーションなし |

## Entity

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 物理名。全エンティティで一意 |
| `label` | string | - | 論理名(日本語名など)。図では「label(name)」と表示 |
| `columns` | Column[] | ✓ | 1 件以上 |

## Column

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `name` | string | ✓ | カラム物理名 |
| `type` | string | - | データ型(例: `BIGINT`, `VARCHAR(255)`) |
| `pk` | boolean | - | 主キーなら true。図では `[PK]` と表示 |
| `fk` | boolean | - | 外部キーなら true。図では `[FK]` と表示 |
| `unique` | boolean | - | ユニーク制約なら true。図では `[UQ]` と表示 |

## Relation

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `from` | string | ✓ | 起点エンティティの `name`(定義済みであること) |
| `to` | string | ✓ | 終点エンティティの `name`(定義済みであること) |
| `cardinality` | string | ✓ | `"1:1"` / `"1:N"` / `"N:1"` / `"N:M"` のいずれか |
| `label` | string | - | 関係の説明(例: 「発注する」) |

## 記述例

​```json
{
  "type": "er",
  "title": "受注管理システム ER図",
  "entities": [
    {
      "name": "users",
      "label": "ユーザー",
      "columns": [
        { "name": "id", "type": "BIGINT", "pk": true },
        { "name": "email", "type": "VARCHAR(255)", "unique": true }
      ]
    },
    {
      "name": "orders",
      "label": "注文",
      "columns": [
        { "name": "id", "type": "BIGINT", "pk": true },
        { "name": "user_id", "type": "BIGINT", "fk": true }
      ]
    }
  ],
  "relations": [
    { "from": "users", "to": "orders", "cardinality": "1:N", "label": "発注する" }
  ]
}
​```
```

(注: 上記のコードフェンス ` ​``` ` は実ファイルでは通常のトリプルバッククォートで書く)

- [ ] **Step 3: セルフチェック**

次を目視確認する:

- SKILL.md の frontmatter が issue-craft と同じ形式(name / description のみ、description に発動条件と「明示的な依頼があったときのみ」の一文)
- 手順に「承認前に生成しない」「エラー時は spec 修正のみ、2 回で STOP」が含まれる
- spec-schema.md のフィールドが Task 3 で**実装済みの** `plugins/basic-design/scripts/lib/validate.mjs` の検証項目と一致している(type/title/entities/name/columns/relations/from/to/cardinality)。このチェックは「先に存在する validate.mjs に、後から書いた文書を合わせる」方向で行う

- [ ] **Step 4: コミット**

```bash
git add plugins/basic-design/skills/
git commit -m "feat(basic-design): ER図スキルを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: マーケットプレイス登録と実機確認

**Files:**
- Modify: `.claude-plugin/marketplace.json`(plugins 配列に追記)
- Modify: `CLAUDE.md`(プラグイン構成表・開発コマンド表)
- Create: `plugins/basic-design/samples/order-system.spec.json`(実機確認用サンプル)

**Interfaces:**
- Consumes: Task 1〜8 のすべて
- Produces: インストール可能なプラグイン。実機確認済みのサンプル成果物

- [ ] **Step 1: marketplace.json に追記**

`.claude-plugin/marketplace.json` の `plugins` 配列末尾に追加:

```json
{
  "name": "basic-design",
  "source": "./plugins/basic-design",
  "description": "基本設計フェーズの成果物(ER図・画面遷移図・システム構成図など)をブレインストーミングで作成するツール群"
}
```

- [ ] **Step 2: CLAUDE.md を更新**

プラグイン構成表に行を追加:

```markdown
| `basic-design` | 基本設計フェーズの成果物(ER図など)をブレインストーミングで作成。spec JSON 経由で .drawio / HTML を生成 | `skills/`(図種別スキル群)、`scripts/`(design-gen 変換 CLI / TypeScript ではなく素の Node) |
```

開発コマンド表に行を追加:

```markdown
| basic-design テスト | `node --test plugins/basic-design/scripts/*.test.mjs` |
```

- [ ] **Step 3: サンプル spec で実機確認用ファイルを生成**

`plugins/basic-design/samples/order-system.spec.json`:

```json
{
  "type": "er",
  "title": "受注管理システム ER図(サンプル)",
  "entities": [
    {
      "name": "users",
      "label": "ユーザー",
      "columns": [
        { "name": "id", "type": "BIGINT", "pk": true },
        { "name": "email", "type": "VARCHAR(255)", "unique": true },
        { "name": "name", "type": "VARCHAR(100)" }
      ]
    },
    {
      "name": "orders",
      "label": "注文",
      "columns": [
        { "name": "id", "type": "BIGINT", "pk": true },
        { "name": "user_id", "type": "BIGINT", "fk": true },
        { "name": "ordered_at", "type": "TIMESTAMP" }
      ]
    },
    {
      "name": "order_items",
      "label": "注文明細",
      "columns": [
        { "name": "id", "type": "BIGINT", "pk": true },
        { "name": "order_id", "type": "BIGINT", "fk": true },
        { "name": "product_id", "type": "BIGINT", "fk": true },
        { "name": "quantity", "type": "INT" }
      ]
    },
    {
      "name": "products",
      "label": "商品",
      "columns": [
        { "name": "id", "type": "BIGINT", "pk": true },
        { "name": "name", "type": "VARCHAR(200)" },
        { "name": "price", "type": "DECIMAL(10,2)" }
      ]
    }
  ],
  "relations": [
    { "from": "users", "to": "orders", "cardinality": "1:N", "label": "発注する" },
    { "from": "orders", "to": "order_items", "cardinality": "1:N" },
    { "from": "products", "to": "order_items", "cardinality": "1:N" }
  ]
}
```

Run: `node plugins/basic-design/scripts/design-gen.mjs plugins/basic-design/samples/order-system.spec.json --format both`
Expected: `{"ok":true,"files":[".../order-system.drawio",".../order-system.html"]}`、exit 0

- [ ] **Step 4: 実機確認(手動)**

設計書 §12 のとおり手動確認する。**ユーザーに次の 2 点の確認を依頼する**:

1. `plugins/basic-design/samples/order-system.drawio` を app.diagrams.net で開き、4 エンティティ+3 リレーションが崩れず表示されること
2. `plugins/basic-design/samples/order-system.html` をブラウザで開き、ズーム・パン・クリックハイライト・詳細パネルが動くこと

問題があれば該当タスクに戻って修正する(レイアウト崩れ → Task 4、drawio 表示異常 → Task 5、HTML 挙動 → Task 6)。

- [ ] **Step 5: 全テスト通しと最終コミット**

Run: `node --test plugins/basic-design/scripts/*.test.mjs`
Expected: PASS(fail 0)

```bash
git add .claude-plugin/marketplace.json CLAUDE.md plugins/basic-design/
git commit -m "feat(basic-design): マーケットプレイス登録とサンプルを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 完了条件(Stage 1)

- `node --test plugins/basic-design/scripts/*.test.mjs` が全パス
- サンプル spec から生成した .drawio が app.diagrams.net で開ける(手動確認)
- サンプル spec から生成した .html がブラウザで動作する(手動確認)
- 「ER図を作って」で er-diagram スキルが発動し、ブレスト → 承認 → 生成の流れが成立する(ドッグフーディング)

## 後続 Stage(この計画のスコープ外)

- Stage 2: 画面遷移図・システム構成図・シーケンス図(`lib/layout/` にレイアウト追加、`SUPPORTED_TYPES`・`RULES`・`LAYOUTS` にエントリ追加、レンダラはノード/エッジ抽象を再利用)
- Stage 3: api-list / nfr-checklist / 入口スキル basic-design
- Stage 4: Google Drive 連携(`.claude/basic-design.local.md` 読み取り、Drive MCP Tool 経由アップロード)
