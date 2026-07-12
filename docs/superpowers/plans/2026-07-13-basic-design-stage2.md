# basic-design プラグイン Stage 2(画面遷移図・システム構成図・シーケンス図)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stage 1 の変換パイプライン(validate → layout → render)に 3 図種(screen-flow / architecture / sequence)を追加し、それぞれの spec JSON から .drawio / インタラクティブ HTML を生成できるようにする。スキル 3 種も追加する。

**Architecture:** Stage 1 の拡張ポイント(`SUPPORTED_TYPES`・`RULES`・`LAYOUTS`)に図種を追加し、レイアウトは図種ごとの新モジュール、レンダラ 2 つは「ゾーン・図形バリエーション・ライフライン・座標指定エッジ」を扱える汎用シーングラフ対応に拡張する。**ER図の既存出力はバイト単位で不変に保つ**(既存テストが回帰ガード)。

**Tech Stack:** Node.js 標準ライブラリのみ(依存ゼロ)。テストは `node --test`。

**設計書:** `docs/superpowers/specs/2026-07-12-basic-design-plugin-design.md` §5(観点)・§6(スキーマ)・§7(レイアウト方針)。本計画は §13 の段階 (2) に対応。

## Global Constraints

- 変換スクリプトは **Node 標準ライブラリのみ**。package.json も node_modules も作らない
- **既存の 42 テストを 1 件も壊さない**(ER図の .drawio / .html 出力はバイト不変)
- エラーメッセージは「どの要素のどのフィールドが、何を参照して失敗したか」を含める(validate.mjs の既存流儀)
- レイアウトの保証ラインは「**矩形が重ならない初期配置**」— 各レイアウトテストに全ペア重なり判定を入れる(`test-helpers.mjs` の `rectsOverlap` を再利用)
- テスト実行: `node --test plugins/basic-design/scripts/*.test.mjs`(リポジトリルートから)
- コミットメッセージ末尾: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## シーングラフ拡張(全タスク共通の契約)

Stage 1 の LayoutResult を次のとおり拡張する。レンダラ 2 つはこの構造だけに依存する:

```
LayoutResult = {
  type: string,
  title: string,
  zones?: [{ id, label, x, y, width, height }],          // 背景コンテナ(architecture)
  nodes: [{
    id, label, x, y, width, height,
    // ER のみ: rows / headerHeight / rowHeight(rows があれば entity 描画)
    // それ以外: shape: 'box' | 'terminal' | 'actor'(省略時 box)
    rows?, headerHeight?, rowHeight?,
    shape?,
    meta?: object,                                        // 詳細パネル表示用
  }],
  lines?: [{ x, y1, y2, owner }],                         // ライフライン(sequence)
  edges: [{
    id, from, to, label,
    cardinality?,                                         // ER のみ(既存)
    style?: 'arrow' | 'sync' | 'async' | 'return',        // 非 ER
    fromPt?: {x, y}, toPt?: {x, y},                       // 座標指定(sequence)
  }],
}
```

---

### Task 1: validate に 3 図種のルールを追加

**Files:**
- Modify: `plugins/basic-design/scripts/lib/validate.mjs`
- Test: `plugins/basic-design/scripts/validate.test.mjs`(既存 14 テストに追記)

**Interfaces:**
- Consumes: 既存の `validateSpec(spec): string[]` / `SUPPORTED_TYPES` / `RULES` パターン
- Produces: `SUPPORTED_TYPES = ['er', 'screen-flow', 'architecture', 'sequence']`。各図種の検証規則(下記テストが仕様)

- [ ] **Step 1: 失敗するテストを追記**

`plugins/basic-design/scripts/validate.test.mjs` の末尾に追記:

```js
// ---- Stage 2: screen-flow ----

const validScreenFlow = () => ({
  type: 'screen-flow',
  title: 'EC サイト画面遷移',
  screens: [
    { id: 'login', label: 'ログイン', group: '認証', kind: 'start' },
    { id: 'home', label: 'ホーム' },
    { id: 'done', label: '完了', kind: 'end' },
  ],
  transitions: [
    { from: 'login', to: 'home', trigger: 'ログイン成功' },
    { from: 'home', to: 'done' },
  ],
});

test('screen-flow: 妥当な spec は空配列', () => {
  assert.deepEqual(validateSpec(validScreenFlow()), []);
});

test('screen-flow: screens が空はエラー', () => {
  assert.ok(validateSpec({ ...validScreenFlow(), screens: [] }).some((e) => e.includes('screens')));
});

test('screen-flow: id 重複はエラー', () => {
  const spec = validScreenFlow();
  spec.screens.push({ id: 'login' });
  assert.ok(validateSpec(spec).some((e) => e.includes('login') && e.includes('重複')));
});

test('screen-flow: 不正な kind はエラー', () => {
  const spec = validScreenFlow();
  spec.screens[1].kind = 'middle';
  assert.ok(validateSpec(spec).some((e) => e.includes('kind') && e.includes('middle')));
});

test('screen-flow: 存在しない画面への遷移はエラー', () => {
  const spec = validScreenFlow();
  spec.transitions.push({ from: 'home', to: 'nowhere' });
  assert.ok(validateSpec(spec).some((e) => e.includes('nowhere')));
});

test('screen-flow: transitions 省略可・非配列はエラー', () => {
  const spec = validScreenFlow();
  delete spec.transitions;
  assert.deepEqual(validateSpec(spec), []);
  assert.ok(validateSpec({ ...validScreenFlow(), transitions: {} }).some((e) => e.includes('transitions')));
});

test('screen-flow: null 要素でクラッシュしない', () => {
  const spec = validScreenFlow();
  spec.screens.push(null);
  spec.transitions.push(null);
  const errors = validateSpec(spec);
  assert.ok(errors.length >= 2);
});

// ---- Stage 2: architecture ----

const validArchitecture = () => ({
  type: 'architecture',
  title: 'Web システム構成',
  zones: [{ id: 'aws', label: 'AWS', children: ['alb', 'app', 'db'] }],
  nodes: [
    { id: 'browser', label: 'ブラウザ' },
    { id: 'alb', label: 'ALB' },
    { id: 'app', label: 'App Server', icon: 'server' },
    { id: 'db', label: 'DB' },
  ],
  edges: [
    { from: 'browser', to: 'alb', label: 'HTTPS' },
    { from: 'alb', to: 'app', label: 'HTTP' },
    { from: 'app', to: 'db', label: 'SQL' },
  ],
});

test('architecture: 妥当な spec は空配列', () => {
  assert.deepEqual(validateSpec(validArchitecture()), []);
});

test('architecture: nodes が空はエラー', () => {
  assert.ok(validateSpec({ ...validArchitecture(), nodes: [] }).some((e) => e.includes('nodes')));
});

test('architecture: zone の children が未定義ノードを指すとエラー', () => {
  const spec = validArchitecture();
  spec.zones[0].children.push('ghost');
  assert.ok(validateSpec(spec).some((e) => e.includes('ghost')));
});

test('architecture: ノードが複数ゾーンに属するとエラー', () => {
  const spec = validArchitecture();
  spec.zones.push({ id: 'backup', label: 'Backup', children: ['db'] });
  assert.ok(validateSpec(spec).some((e) => e.includes('db') && e.includes('複数')));
});

test('architecture: zone id とノード id の衝突はエラー', () => {
  const spec = validArchitecture();
  spec.zones.push({ id: 'db', label: 'x', children: ['alb'] });
  const errors = validateSpec(spec);
  assert.ok(errors.some((e) => e.includes('"db"') && e.includes('重複')));
});

test('architecture: 存在しないノードへの edge はエラー', () => {
  const spec = validArchitecture();
  spec.edges.push({ from: 'app', to: 'cache' });
  assert.ok(validateSpec(spec).some((e) => e.includes('cache')));
});

test('architecture: zones / edges 省略可', () => {
  const spec = validArchitecture();
  delete spec.zones;
  delete spec.edges;
  assert.deepEqual(validateSpec(spec), []);
});

// ---- Stage 2: sequence ----

const validSequence = () => ({
  type: 'sequence',
  title: 'ログイン処理',
  actors: [
    { id: 'user', label: 'ユーザー', kind: 'actor' },
    { id: 'web', label: 'Web' },
    { id: 'db', label: 'DB' },
  ],
  messages: [
    { from: 'user', to: 'web', label: 'ログイン要求' },
    { from: 'web', to: 'db', label: '照会', style: 'async' },
    { from: 'db', to: 'web', label: '結果', style: 'return' },
  ],
});

test('sequence: 妥当な spec は空配列', () => {
  assert.deepEqual(validateSpec(validSequence()), []);
});

test('sequence: actors が空はエラー', () => {
  assert.ok(validateSpec({ ...validSequence(), actors: [] }).some((e) => e.includes('actors')));
});

test('sequence: 未定義アクターへのメッセージはエラー', () => {
  const spec = validSequence();
  spec.messages.push({ from: 'web', to: 'mail' });
  assert.ok(validateSpec(spec).some((e) => e.includes('mail')));
});

test('sequence: 自己メッセージはエラー(未対応の明示)', () => {
  const spec = validSequence();
  spec.messages.push({ from: 'web', to: 'web', label: '内部処理' });
  assert.ok(validateSpec(spec).some((e) => e.includes('自己メッセージ')));
});

test('sequence: 不正な style はエラー', () => {
  const spec = validSequence();
  spec.messages[0].style = 'dashed';
  assert.ok(validateSpec(spec).some((e) => e.includes('style') && e.includes('dashed')));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/validate.test.mjs`
Expected: FAIL(新規テストが「未対応の図種」エラーで落ちる。既存 14 は PASS のまま)

- [ ] **Step 3: validate.mjs に 3 図種のルールを実装**

`plugins/basic-design/scripts/lib/validate.mjs` を修正:

1 行目の `SUPPORTED_TYPES` を差し替え:

```js
export const SUPPORTED_TYPES = ['er', 'screen-flow', 'architecture', 'sequence'];
```

`RULES` を差し替え:

```js
const RULES = {
  er: validateEr,
  'screen-flow': validateScreenFlow,
  architecture: validateArchitecture,
  sequence: validateSequence,
};
```

ファイル末尾(validateEr の後)に追加:

```js
function validateScreenFlow(spec) {
  const errors = [];
  if (!Array.isArray(spec.screens) || spec.screens.length === 0) {
    errors.push('screens: 1 件以上の画面が必須です');
    return errors;
  }
  const ids = new Set();
  for (const [i, screen] of spec.screens.entries()) {
    const where = `screens[${i}]`;
    if (screen === null || typeof screen !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    if (typeof screen.id !== 'string' || screen.id.trim() === '') {
      errors.push(`${where}.id: 必須です(空でない文字列)`);
      continue;
    }
    if (ids.has(screen.id)) {
      errors.push(`${where}.id: "${screen.id}" が重複しています`);
    }
    ids.add(screen.id);
    if (screen.kind !== undefined && !['start', 'end'].includes(screen.kind)) {
      errors.push(`${where}(${screen.id}).kind: "${screen.kind}" は不正です(対応: start, end、または省略)`);
    }
  }
  const transitions = spec.transitions ?? [];
  if (!Array.isArray(transitions)) {
    errors.push('transitions: 配列ではありません');
    return errors;
  }
  for (const [i, t] of transitions.entries()) {
    const where = `transitions[${i}]`;
    if (t === null || typeof t !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    for (const end of ['from', 'to']) {
      if (!ids.has(t[end])) {
        errors.push(`${where}.${end}: 画面 "${t[end]}" は screens に定義されていません`);
      }
    }
  }
  return errors;
}

function validateArchitecture(spec) {
  const errors = [];
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    errors.push('nodes: 1 件以上のノードが必須です');
    return errors;
  }
  const nodeIds = new Set();
  for (const [i, node] of spec.nodes.entries()) {
    const where = `nodes[${i}]`;
    if (node === null || typeof node !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    if (typeof node.id !== 'string' || node.id.trim() === '') {
      errors.push(`${where}.id: 必須です(空でない文字列)`);
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`${where}.id: "${node.id}" が重複しています`);
    }
    nodeIds.add(node.id);
  }
  const zones = spec.zones ?? [];
  if (!Array.isArray(zones)) {
    errors.push('zones: 配列ではありません');
    return errors;
  }
  const zoneIds = new Set();
  const assigned = new Set();
  for (const [i, zone] of zones.entries()) {
    const where = `zones[${i}]`;
    if (zone === null || typeof zone !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    if (typeof zone.id !== 'string' || zone.id.trim() === '') {
      errors.push(`${where}.id: 必須です(空でない文字列)`);
      continue;
    }
    if (zoneIds.has(zone.id) || nodeIds.has(zone.id)) {
      errors.push(`${where}.id: "${zone.id}" が重複しています(ゾーン・ノード間で一意であること)`);
    }
    zoneIds.add(zone.id);
    if (!Array.isArray(zone.children) || zone.children.length === 0) {
      errors.push(`${where}(${zone.id}).children: 1 件以上のノード id の配列が必須です`);
      continue;
    }
    for (const [j, childId] of zone.children.entries()) {
      if (!nodeIds.has(childId)) {
        errors.push(`zones(${zone.id}).children[${j}]: ノード "${childId}" は nodes に定義されていません`);
        continue;
      }
      if (assigned.has(childId)) {
        errors.push(`zones(${zone.id}).children[${j}]: ノード "${childId}" は複数のゾーンに属しています`);
      }
      assigned.add(childId);
    }
  }
  const edges = spec.edges ?? [];
  if (!Array.isArray(edges)) {
    errors.push('edges: 配列ではありません');
    return errors;
  }
  for (const [i, edge] of edges.entries()) {
    const where = `edges[${i}]`;
    if (edge === null || typeof edge !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    for (const end of ['from', 'to']) {
      if (!nodeIds.has(edge[end])) {
        errors.push(`${where}.${end}: ノード "${edge[end]}" は nodes に定義されていません`);
      }
    }
  }
  return errors;
}

function validateSequence(spec) {
  const errors = [];
  if (!Array.isArray(spec.actors) || spec.actors.length === 0) {
    errors.push('actors: 1 件以上のアクターが必須です');
    return errors;
  }
  const ids = new Set();
  for (const [i, actor] of spec.actors.entries()) {
    const where = `actors[${i}]`;
    if (actor === null || typeof actor !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    if (typeof actor.id !== 'string' || actor.id.trim() === '') {
      errors.push(`${where}.id: 必須です(空でない文字列)`);
      continue;
    }
    if (ids.has(actor.id)) {
      errors.push(`${where}.id: "${actor.id}" が重複しています`);
    }
    ids.add(actor.id);
  }
  const messages = spec.messages ?? [];
  if (!Array.isArray(messages)) {
    errors.push('messages: 配列ではありません');
    return errors;
  }
  for (const [i, msg] of messages.entries()) {
    const where = `messages[${i}]`;
    if (msg === null || typeof msg !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    for (const end of ['from', 'to']) {
      if (!ids.has(msg[end])) {
        errors.push(`${where}.${end}: アクター "${msg[end]}" は actors に定義されていません`);
      }
    }
    if (msg.from === msg.to && ids.has(msg.from)) {
      errors.push(`${where}: from と to が同一(自己メッセージ)は未対応です`);
    }
    if (msg.style !== undefined && !['async', 'return'].includes(msg.style)) {
      errors.push(`${where}.style: "${msg.style}" は不正です(対応: async, return、または省略=同期)`);
    }
  }
  return errors;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/validate.test.mjs`
Expected: PASS(既存 14 + 新規 19 = 33 tests)

- [ ] **Step 5: 全体通し + コミット**

Run: `node --test plugins/basic-design/scripts/*.test.mjs`
Expected: PASS(61 tests, fail 0)

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): 3 図種(screen-flow/architecture/sequence)のバリデーションを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 画面遷移図レイアウト(layout/screen-flow.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/lib/layout/screen-flow.mjs`
- Test: `plugins/basic-design/scripts/layout-screen-flow.test.mjs`

**Interfaces:**
- Consumes: 検証済み screen-flow spec、`test-helpers.mjs` の `rectsOverlap`
- Produces: `layoutScreenFlow(spec): LayoutResult` — nodes は `shape: 'box' | 'terminal'`(start/end が terminal)、`meta: { group, kind }` 付き。edges は `id: 't1'...`、`style: 'arrow'`、`label` = trigger

レイアウト方針(設計書 §7: 階層レイアウト、左→右): kind='start' の画面(なければ流入 0 の画面、それもなければ先頭)を起点に BFS で層を割り当て、層 = x 列。未到達の画面は最終層+1 に置く。層内は出現順に縦積み。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/basic-design/scripts/layout-screen-flow.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutScreenFlow } from './lib/layout/screen-flow.mjs';
import { rectsOverlap } from './test-helpers.mjs';

const spec = () => ({
  type: 'screen-flow',
  title: 'EC 画面遷移',
  screens: [
    { id: 'login', label: 'ログイン', group: '認証', kind: 'start' },
    { id: 'home', label: 'ホーム' },
    { id: 'detail', label: '商品詳細' },
    { id: 'cart', label: 'カート' },
    { id: 'done', label: '注文完了', kind: 'end' },
    { id: 'help', label: 'ヘルプ' },
  ],
  transitions: [
    { from: 'login', to: 'home', trigger: 'ログイン成功' },
    { from: 'home', to: 'detail', trigger: '商品選択' },
    { from: 'home', to: 'cart' },
    { from: 'detail', to: 'cart', trigger: 'カート追加' },
    { from: 'cart', to: 'done', trigger: '注文確定' },
  ],
});

test('start が層 0、BFS の層が x 座標になる', () => {
  const layout = layoutScreenFlow(spec());
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get('login').x, 0);
  assert.ok(byId.get('home').x > byId.get('login').x);
  assert.ok(byId.get('detail').x > byId.get('home').x);
  // cart は home からの直接遷移で層 2(detail と同層)
  assert.equal(byId.get('cart').x, byId.get('detail').x);
  assert.ok(byId.get('done').x > byId.get('cart').x);
});

test('どの遷移も到達しない画面は最終層+1 に置かれる', () => {
  const layout = layoutScreenFlow(spec());
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const maxReached = Math.max(...['login', 'home', 'detail', 'cart', 'done'].map((id) => byId.get(id).x));
  assert.ok(byId.get('help').x > maxReached);
});

test('どのノードのペアも重ならない', () => {
  const layout = layoutScreenFlow(spec());
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      assert.ok(!rectsOverlap(layout.nodes[i], layout.nodes[j]));
    }
  }
});

test('start/end は terminal、それ以外は box。meta に group と kind が入る', () => {
  const layout = layoutScreenFlow(spec());
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get('login').shape, 'terminal');
  assert.equal(byId.get('done').shape, 'terminal');
  assert.equal(byId.get('home').shape, 'box');
  assert.deepEqual(byId.get('login').meta, { group: '認証', kind: 'start' });
  assert.deepEqual(byId.get('home').meta, { group: '', kind: 'screen' });
});

test('エッジが遷移順に採番され trigger がラベルになる', () => {
  const layout = layoutScreenFlow(spec());
  assert.equal(layout.edges.length, 5);
  assert.deepEqual(layout.edges[0], {
    id: 't1', from: 'login', to: 'home', label: 'ログイン成功', style: 'arrow',
  });
  assert.equal(layout.edges[2].label, '');
});

test('start がない場合は流入 0 の画面が層 0 になる', () => {
  const s = spec();
  delete s.screens[0].kind;
  const layout = layoutScreenFlow(s);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get('login').x, 0); // login は流入 0
  assert.equal(byId.get('help').x, 0);  // help も流入 0
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/layout-screen-flow.test.mjs`
Expected: FAIL(`ERR_MODULE_NOT_FOUND`)

- [ ] **Step 3: 実装を書く**

`plugins/basic-design/scripts/lib/layout/screen-flow.mjs`:

```js
const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const GAP_X = 100;
const GAP_Y = 40;

export function layoutScreenFlow(spec) {
  const transitions = spec.transitions ?? [];
  const incoming = new Map(spec.screens.map((s) => [s.id, 0]));
  const adjacency = new Map(spec.screens.map((s) => [s.id, []]));
  for (const t of transitions) {
    incoming.set(t.to, incoming.get(t.to) + 1);
    adjacency.get(t.from).push(t.to);
  }

  let roots = spec.screens.filter((s) => s.kind === 'start').map((s) => s.id);
  if (roots.length === 0) {
    roots = spec.screens.filter((s) => incoming.get(s.id) === 0).map((s) => s.id);
  }
  if (roots.length === 0) roots = [spec.screens[0].id];

  const layerOf = new Map(roots.map((id) => [id, 0]));
  const queue = roots.map((id) => [id, 0]);
  while (queue.length > 0) {
    const [id, layer] = queue.shift();
    for (const next of adjacency.get(id)) {
      if (!layerOf.has(next)) {
        layerOf.set(next, layer + 1);
        queue.push([next, layer + 1]);
      }
    }
  }
  const maxLayer = Math.max(...layerOf.values());
  for (const screen of spec.screens) {
    if (!layerOf.has(screen.id)) layerOf.set(screen.id, maxLayer + 1);
  }

  const rowIndex = new Map();
  const nodes = spec.screens.map((screen) => {
    const layer = layerOf.get(screen.id);
    const row = rowIndex.get(layer) ?? 0;
    rowIndex.set(layer, row + 1);
    return {
      id: screen.id,
      label: screen.label ?? screen.id,
      shape: screen.kind === 'start' || screen.kind === 'end' ? 'terminal' : 'box',
      x: layer * (NODE_WIDTH + GAP_X),
      y: row * (NODE_HEIGHT + GAP_Y),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      meta: { group: screen.group ?? '', kind: screen.kind ?? 'screen' },
    };
  });

  const edges = transitions.map((t, i) => ({
    id: `t${i + 1}`,
    from: t.from,
    to: t.to,
    label: t.trigger ?? '',
    style: 'arrow',
  }));

  return { type: 'screen-flow', title: spec.title, nodes, edges };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/layout-screen-flow.test.mjs`
Expected: PASS(6 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): 画面遷移図レイアウトを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: システム構成図レイアウト(layout/architecture.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/lib/layout/architecture.mjs`
- Test: `plugins/basic-design/scripts/layout-architecture.test.mjs`

**Interfaces:**
- Consumes: 検証済み architecture spec、`rectsOverlap`
- Produces: `layoutArchitecture(spec): LayoutResult` — `zones` 配列(背景ボックス)+ nodes(`shape: 'box'`、`meta: { icon, zone }`)+ edges(`id: 'e1'...`、`style: 'arrow'`)

レイアウト方針(設計書 §7: ゾーン入れ子+ゾーン内グリッド): ゾーンを左から右へ並べ、各ゾーン内は `ceil(sqrt(n))` 列グリッド。どのゾーンにも属さないノードは最後のゾーンの右に独立グリッドで置く。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/basic-design/scripts/layout-architecture.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutArchitecture } from './lib/layout/architecture.mjs';
import { rectsOverlap } from './test-helpers.mjs';

const spec = () => ({
  type: 'architecture',
  title: 'Web システム構成',
  zones: [
    { id: 'aws', label: 'AWS', children: ['alb', 'app', 'db'] },
    { id: 'monitor', label: '監視', children: ['grafana'] },
  ],
  nodes: [
    { id: 'browser', label: 'ブラウザ' },
    { id: 'alb', label: 'ALB' },
    { id: 'app', label: 'App Server', icon: 'server' },
    { id: 'db', label: 'DB' },
    { id: 'grafana', label: 'Grafana' },
  ],
  edges: [
    { from: 'browser', to: 'alb', label: 'HTTPS' },
    { from: 'alb', to: 'app', label: 'HTTP' },
    { from: 'app', to: 'db', label: 'SQL' },
  ],
});

test('ゾーンが左から並び、子ノードはゾーンの矩形内に収まる', () => {
  const layout = layoutArchitecture(spec());
  assert.equal(layout.zones.length, 2);
  const [aws, monitor] = layout.zones;
  assert.ok(aws.x + aws.width < monitor.x + monitor.width);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const id of ['alb', 'app', 'db']) {
    const n = byId.get(id);
    assert.ok(n.x >= aws.x && n.x + n.width <= aws.x + aws.width, `${id} が AWS ゾーン外(x)`);
    assert.ok(n.y >= aws.y && n.y + n.height <= aws.y + aws.height, `${id} が AWS ゾーン外(y)`);
  }
});

test('ゾーン外のノードはどのゾーン矩形とも重ならない', () => {
  const layout = layoutArchitecture(spec());
  const browser = layout.nodes.find((n) => n.id === 'browser');
  for (const zone of layout.zones) {
    assert.ok(!rectsOverlap(browser, zone), `browser が ${zone.id} と重なっています`);
  }
});

test('どのノードのペアも重ならない', () => {
  const layout = layoutArchitecture(spec());
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      assert.ok(!rectsOverlap(layout.nodes[i], layout.nodes[j]));
    }
  }
});

test('ゾーン同士も重ならない', () => {
  const layout = layoutArchitecture(spec());
  assert.ok(!rectsOverlap(layout.zones[0], layout.zones[1]));
});

test('meta に icon と zone が入る', () => {
  const layout = layoutArchitecture(spec());
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  assert.deepEqual(byId.get('app').meta, { icon: 'server', zone: 'aws' });
  assert.deepEqual(byId.get('browser').meta, { icon: '', zone: '' });
});

test('zones 省略時はゾーンなしの全ノードグリッド', () => {
  const s = spec();
  delete s.zones;
  const layout = layoutArchitecture(s);
  assert.deepEqual(layout.zones, []);
  assert.equal(layout.nodes.length, 5);
});

test('エッジが順に採番される', () => {
  const layout = layoutArchitecture(spec());
  assert.deepEqual(layout.edges[0], { id: 'e1', from: 'browser', to: 'alb', label: 'HTTPS', style: 'arrow' });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/layout-architecture.test.mjs`
Expected: FAIL(`ERR_MODULE_NOT_FOUND`)

- [ ] **Step 3: 実装を書く**

`plugins/basic-design/scripts/lib/layout/architecture.mjs`:

```js
const NODE_WIDTH = 140;
const NODE_HEIGHT = 60;
const NODE_GAP = 40;
const ZONE_PADDING = 20;
const ZONE_HEADER = 30;
const ZONE_GAP = 60;

export function layoutArchitecture(spec) {
  const zones = spec.zones ?? [];
  const zoned = new Set(zones.flatMap((z) => z.children));
  const nodeById = new Map(spec.nodes.map((n) => [n.id, n]));

  const zoneBoxes = [];
  const nodes = [];
  let cursorX = 0;

  for (const zone of zones) {
    const children = zone.children;
    const cols = Math.ceil(Math.sqrt(children.length));
    const rows = Math.ceil(children.length / cols);
    const width = ZONE_PADDING * 2 + cols * NODE_WIDTH + (cols - 1) * NODE_GAP;
    const height = ZONE_HEADER + ZONE_PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * NODE_GAP;
    zoneBoxes.push({ id: zone.id, label: zone.label ?? zone.id, x: cursorX, y: 0, width, height });
    children.forEach((childId, i) => {
      const child = nodeById.get(childId);
      nodes.push({
        id: child.id,
        label: child.label ?? child.id,
        shape: 'box',
        x: cursorX + ZONE_PADDING + (i % cols) * (NODE_WIDTH + NODE_GAP),
        y: ZONE_HEADER + ZONE_PADDING + Math.floor(i / cols) * (NODE_HEIGHT + NODE_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        meta: { icon: child.icon ?? '', zone: zone.id },
      });
    });
    cursorX += width + ZONE_GAP;
  }

  const unzoned = spec.nodes.filter((n) => !zoned.has(n.id));
  const cols = Math.ceil(Math.sqrt(unzoned.length || 1));
  unzoned.forEach((n, i) => {
    nodes.push({
      id: n.id,
      label: n.label ?? n.id,
      shape: 'box',
      x: cursorX + (i % cols) * (NODE_WIDTH + NODE_GAP),
      y: ZONE_HEADER + Math.floor(i / cols) * (NODE_HEIGHT + NODE_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      meta: { icon: n.icon ?? '', zone: '' },
    });
  });

  const edges = (spec.edges ?? []).map((e, i) => ({
    id: `e${i + 1}`,
    from: e.from,
    to: e.to,
    label: e.label ?? '',
    style: 'arrow',
  }));

  return { type: 'architecture', title: spec.title, zones: zoneBoxes, nodes, edges };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/layout-architecture.test.mjs`
Expected: PASS(7 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): システム構成図レイアウトを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: シーケンス図レイアウト(layout/sequence.mjs)

**Files:**
- Create: `plugins/basic-design/scripts/lib/layout/sequence.mjs`
- Test: `plugins/basic-design/scripts/layout-sequence.test.mjs`

**Interfaces:**
- Consumes: 検証済み sequence spec、`rectsOverlap`
- Produces: `layoutSequence(spec): LayoutResult` — nodes はアクター(`shape: 'actor'`、y=0 一列)、`lines` はライフライン(`{x, y1, y2, owner}`)、edges はメッセージ(`id: 'msg1'...`、`style: 'sync'|'async'|'return'`、`fromPt`/`toPt` の座標指定)

レイアウト方針(設計書 §7: 等間隔ライフライン+メッセージ順の縦位置)。

- [ ] **Step 1: 失敗するテストを書く**

`plugins/basic-design/scripts/layout-sequence.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSequence } from './lib/layout/sequence.mjs';
import { rectsOverlap } from './test-helpers.mjs';

const spec = () => ({
  type: 'sequence',
  title: 'ログイン処理',
  actors: [
    { id: 'user', label: 'ユーザー', kind: 'actor' },
    { id: 'web', label: 'Web' },
    { id: 'db', label: 'DB' },
  ],
  messages: [
    { from: 'user', to: 'web', label: 'ログイン要求' },
    { from: 'web', to: 'db', label: '照会', style: 'async' },
    { from: 'db', to: 'web', label: '結果', style: 'return' },
    { from: 'web', to: 'user', label: 'トークン', style: 'return' },
  ],
});

test('アクターが y=0 に等間隔で並び、重ならない', () => {
  const layout = layoutSequence(spec());
  assert.equal(layout.nodes.length, 3);
  for (const n of layout.nodes) {
    assert.equal(n.y, 0);
    assert.equal(n.shape, 'actor');
  }
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      assert.ok(!rectsOverlap(layout.nodes[i], layout.nodes[j]));
    }
  }
});

test('ライフラインが各アクターの中心 x でアクター下端から伸びる', () => {
  const layout = layoutSequence(spec());
  assert.equal(layout.lines.length, 3);
  for (const line of layout.lines) {
    const actor = layout.nodes.find((n) => n.id === line.owner);
    assert.equal(line.x, actor.x + actor.width / 2);
    assert.equal(line.y1, actor.height);
    assert.ok(line.y2 > line.y1);
  }
});

test('メッセージが順に下へ並び、送受信アクターのライフライン x を結ぶ', () => {
  const layout = layoutSequence(spec());
  assert.equal(layout.edges.length, 4);
  const centerOf = (id) => {
    const n = layout.nodes.find((nd) => nd.id === id);
    return n.x + n.width / 2;
  };
  layout.edges.forEach((edge, i) => {
    assert.equal(edge.id, `msg${i + 1}`);
    assert.equal(edge.fromPt.x, centerOf(edge.from));
    assert.equal(edge.toPt.x, centerOf(edge.to));
    assert.equal(edge.fromPt.y, edge.toPt.y);
    if (i > 0) assert.ok(edge.fromPt.y > layout.edges[i - 1].fromPt.y);
  });
});

test('style が sync/async/return に正規化される', () => {
  const layout = layoutSequence(spec());
  assert.equal(layout.edges[0].style, 'sync');
  assert.equal(layout.edges[1].style, 'async');
  assert.equal(layout.edges[2].style, 'return');
});

test('メッセージの y はライフラインの範囲内', () => {
  const layout = layoutSequence(spec());
  const maxY2 = Math.max(...layout.lines.map((l) => l.y2));
  for (const edge of layout.edges) {
    assert.ok(edge.fromPt.y < maxY2);
  }
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/layout-sequence.test.mjs`
Expected: FAIL(`ERR_MODULE_NOT_FOUND`)

- [ ] **Step 3: 実装を書く**

`plugins/basic-design/scripts/lib/layout/sequence.mjs`:

```js
const ACTOR_WIDTH = 140;
const ACTOR_HEIGHT = 50;
const ACTOR_GAP = 80;
const MESSAGE_GAP = 50;
const TAIL = 30;

export function layoutSequence(spec) {
  const messages = spec.messages ?? [];
  const bottomY = ACTOR_HEIGHT + (messages.length + 1) * MESSAGE_GAP + TAIL;
  const centerX = new Map();

  const nodes = spec.actors.map((actor, i) => {
    const x = i * (ACTOR_WIDTH + ACTOR_GAP);
    centerX.set(actor.id, x + ACTOR_WIDTH / 2);
    return {
      id: actor.id,
      label: actor.label ?? actor.id,
      shape: 'actor',
      x,
      y: 0,
      width: ACTOR_WIDTH,
      height: ACTOR_HEIGHT,
      meta: { kind: actor.kind ?? 'system' },
    };
  });

  const lines = spec.actors.map((actor) => ({
    x: centerX.get(actor.id),
    y1: ACTOR_HEIGHT,
    y2: bottomY,
    owner: actor.id,
  }));

  const edges = messages.map((msg, i) => {
    const y = ACTOR_HEIGHT + (i + 1) * MESSAGE_GAP;
    return {
      id: `msg${i + 1}`,
      from: msg.from,
      to: msg.to,
      label: msg.label ?? '',
      style: msg.style === 'return' ? 'return' : msg.style === 'async' ? 'async' : 'sync',
      fromPt: { x: centerX.get(msg.from), y },
      toPt: { x: centerX.get(msg.to), y },
    };
  });

  return { type: 'sequence', title: spec.title, nodes, lines, edges };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/layout-sequence.test.mjs`
Expected: PASS(5 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): シーケンス図レイアウトを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Draw.io レンダラの汎用化

**Files:**
- Modify: `plugins/basic-design/scripts/lib/render/drawio.mjs`
- Test: `plugins/basic-design/scripts/render-drawio.test.mjs`(既存 5 テストに追記)

**Interfaces:**
- Consumes: 拡張 LayoutResult(zones / shape / lines / fromPt 付き edges)
- Produces: `renderDrawio(layout): string` — シグネチャ不変。**ER の出力はバイト不変**(既存テストが検証)。新規: ゾーンセル(`z-<id>`)、shape 別ノードセル、ライフラインセル(`l-<番号>`)、座標指定エッジ

セルの出力順: zones → nodes → lines → edges(draw.io は文書順が z 順なので、ゾーンが背景になる)。

- [ ] **Step 1: 失敗するテストを追記**

`plugins/basic-design/scripts/render-drawio.test.mjs` の末尾に追記:

```js
// ---- Stage 2: 汎用シーングラフ ----

test('ゾーンが z- プレフィックスで nodes より先に出力される', () => {
  const xml = renderDrawio({
    type: 'architecture',
    title: 'x',
    zones: [{ id: 'aws', label: 'AWS', x: 0, y: 0, width: 400, height: 200 }],
    nodes: [{ id: 'app', label: 'App', shape: 'box', x: 20, y: 50, width: 140, height: 60 }],
    edges: [],
  });
  assert.ok(/id="z-aws"[^>]*vertex="1"/.test(xml));
  assert.ok(xml.indexOf('id="z-aws"') < xml.indexOf('id="n-app"'));
});

test('shape 別のノードスタイル(box は rounded、terminal は ellipse、actor は fontStyle=1)', () => {
  const xml = renderDrawio({
    type: 'screen-flow',
    title: 'x',
    nodes: [
      { id: 'a', label: 'A', shape: 'box', x: 0, y: 0, width: 180, height: 60 },
      { id: 'b', label: 'B', shape: 'terminal', x: 300, y: 0, width: 180, height: 60 },
      { id: 'c', label: 'C', shape: 'actor', x: 600, y: 0, width: 140, height: 50 },
    ],
    edges: [],
  });
  assert.ok(/id="n-a"[^>]*style="rounded=1;/.test(xml));
  assert.ok(/id="n-b"[^>]*style="ellipse;/.test(xml));
  assert.ok(/id="n-c"[^>]*style="[^"]*fontStyle=1;"/.test(xml));
});

test('ライフラインが破線エッジセルとして座標指定で出力される', () => {
  const xml = renderDrawio({
    type: 'sequence',
    title: 'x',
    nodes: [{ id: 'u', label: 'U', shape: 'actor', x: 0, y: 0, width: 140, height: 50 }],
    lines: [{ x: 70, y1: 50, y2: 300, owner: 'u' }],
    edges: [],
  });
  assert.ok(/id="l-1"[^>]*edge="1"/.test(xml));
  assert.ok(xml.includes('<mxPoint x="70" y="50" as="sourcePoint"/>'));
  assert.ok(xml.includes('<mxPoint x="70" y="300" as="targetPoint"/>'));
  assert.ok(/id="l-1"[^>]*dashed=1/.test(xml));
});

test('座標指定エッジ(fromPt/toPt)が sourcePoint/targetPoint で出力され、style が反映される', () => {
  const xml = renderDrawio({
    type: 'sequence',
    title: 'x',
    nodes: [],
    edges: [
      { id: 'msg1', from: 'u', to: 'w', label: '要求', style: 'sync', fromPt: { x: 70, y: 100 }, toPt: { x: 300, y: 100 } },
      { id: 'msg2', from: 'w', to: 'u', label: '応答', style: 'return', fromPt: { x: 300, y: 150 }, toPt: { x: 70, y: 150 } },
    ],
  });
  assert.ok(/id="e-msg1"[^>]*value="要求"/.test(xml));
  assert.ok(xml.includes('<mxPoint x="70" y="100" as="sourcePoint"/>'));
  assert.ok(/id="e-msg2"[^>]*style="[^"]*dashed=1;[^"]*endArrow=open;/.test(xml));
});

test('source/target 型の非 ER エッジは block 矢印になる', () => {
  const xml = renderDrawio({
    type: 'screen-flow',
    title: 'x',
    nodes: [
      { id: 'a', label: 'A', shape: 'box', x: 0, y: 0, width: 180, height: 60 },
      { id: 'b', label: 'B', shape: 'box', x: 300, y: 0, width: 180, height: 60 },
    ],
    edges: [{ id: 't1', from: 'a', to: 'b', label: '遷移', style: 'arrow' }],
  });
  assert.ok(/id="e-t1"[^>]*source="n-a" target="n-b"/.test(xml));
  assert.ok(/id="e-t1"[^>]*endArrow=block;endFill=1;/.test(xml));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/render-drawio.test.mjs`
Expected: FAIL(新規 5 テストが落ち、既存 5 は PASS)

- [ ] **Step 3: drawio.mjs を汎用化**

`plugins/basic-design/scripts/lib/render/drawio.mjs` の全文を次に置き換える(ER パスの文字列生成は一字一句既存のまま):

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
const ZONE_STYLE =
  'rounded=0;fillColor=#f5f5f5;strokeColor=#666666;verticalAlign=top;' +
  'fontStyle=1;align=left;spacingLeft=8;';
const NODE_STYLES = {
  box: 'rounded=1;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#333333;',
  terminal: 'ellipse;whiteSpace=wrap;fillColor=#e8eef7;strokeColor=#333333;',
  actor: 'rounded=0;whiteSpace=wrap;fillColor=#e8eef7;strokeColor=#333333;fontStyle=1;',
};
const EDGE_STYLES = {
  arrow: 'rounded=0;endArrow=block;endFill=1;',
  sync: 'rounded=0;endArrow=block;endFill=1;',
  async: 'rounded=0;endArrow=open;endFill=0;',
  return: 'rounded=0;dashed=1;endArrow=open;endFill=0;',
};
const LIFELINE_STYLE = 'endArrow=none;dashed=1;strokeColor=#999999;';

export function renderDrawio(layout) {
  const cells = [];
  for (const zone of layout.zones ?? []) {
    cells.push(
      `<mxCell id="${escapeXml(`z-${zone.id}`)}" value="${escapeXml(zone.label)}" style="${ZONE_STYLE}" vertex="1" parent="1">` +
        `<mxGeometry x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" as="geometry"/>` +
        `</mxCell>`,
    );
  }
  for (const node of layout.nodes) {
    const nodeId = `n-${node.id}`;
    if (node.rows) {
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
    } else {
      const style = NODE_STYLES[node.shape] ?? NODE_STYLES.box;
      cells.push(
        `<mxCell id="${escapeXml(nodeId)}" value="${escapeXml(node.label)}" style="${style}" vertex="1" parent="1">` +
          `<mxGeometry x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" as="geometry"/>` +
          `</mxCell>`,
      );
    }
  }
  (layout.lines ?? []).forEach((line, i) => {
    cells.push(
      `<mxCell id="l-${i + 1}" style="${LIFELINE_STYLE}" edge="1" parent="1">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${line.x}" y="${line.y1}" as="sourcePoint"/>` +
        `<mxPoint x="${line.x}" y="${line.y2}" as="targetPoint"/>` +
        `</mxGeometry></mxCell>`,
    );
  });
  for (const edge of layout.edges) {
    if (edge.fromPt) {
      const style = EDGE_STYLES[edge.style] ?? EDGE_STYLES.arrow;
      cells.push(
        `<mxCell id="${escapeXml(`e-${edge.id}`)}" value="${escapeXml(edge.label)}" style="${style}" edge="1" parent="1">` +
          `<mxGeometry relative="1" as="geometry">` +
          `<mxPoint x="${edge.fromPt.x}" y="${edge.fromPt.y}" as="sourcePoint"/>` +
          `<mxPoint x="${edge.toPt.x}" y="${edge.toPt.y}" as="targetPoint"/>` +
          `</mxGeometry></mxCell>`,
      );
    } else if (edge.cardinality) {
      const [startArrow, endArrow] = CARDINALITY_ARROWS[edge.cardinality] ?? ['none', 'open'];
      const style =
        `edgeStyle=entityRelationEdgeStyle;rounded=0;` +
        `startArrow=${startArrow};startFill=0;endArrow=${endArrow};endFill=0;`;
      cells.push(
        `<mxCell id="${escapeXml(`e-${edge.id}`)}" value="${escapeXml(edge.label)}" style="${style}" edge="1" parent="1" source="${escapeXml(`n-${edge.from}`)}" target="${escapeXml(`n-${edge.to}`)}">` +
          `<mxGeometry relative="1" as="geometry"/>` +
          `</mxCell>`,
      );
    } else {
      const style = EDGE_STYLES[edge.style] ?? EDGE_STYLES.arrow;
      cells.push(
        `<mxCell id="${escapeXml(`e-${edge.id}`)}" value="${escapeXml(edge.label)}" style="${style}" edge="1" parent="1" source="${escapeXml(`n-${edge.from}`)}" target="${escapeXml(`n-${edge.to}`)}">` +
          `<mxGeometry relative="1" as="geometry"/>` +
          `</mxCell>`,
      );
    }
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

- [ ] **Step 4: テストが通ることを確認(ER 回帰含む)**

Run: `node --test plugins/basic-design/scripts/render-drawio.test.mjs`
Expected: PASS(既存 5 + 新規 5 = 10 tests)

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): Draw.io レンダラをゾーン・図形・ライフライン・座標指定エッジに対応

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: HTML レンダラの汎用化

**Files:**
- Modify: `plugins/basic-design/scripts/lib/render/html.mjs`
- Test: `plugins/basic-design/scripts/render-html.test.mjs`(既存 5 テストに追記)

**Interfaces:**
- Consumes: 拡張 LayoutResult
- Produces: `renderHtml(layout, spec): string` — シグネチャ不変。ER 出力の既存アサーションは維持。新規: `.zone` グループ、shape 別ノード SVG、`.lifeline` 破線、座標指定エッジ+SVG マーカー(矢印)、meta ベースの詳細パネル

- [ ] **Step 1: 失敗するテストを追記**

`plugins/basic-design/scripts/render-html.test.mjs` の末尾に追記:

```js
// ---- Stage 2: 汎用シーングラフ ----

const flowLayout = () => ({
  type: 'screen-flow',
  title: '画面遷移',
  nodes: [
    { id: 'login', label: 'ログイン', shape: 'terminal', x: 0, y: 0, width: 180, height: 60, meta: { group: '認証', kind: 'start' } },
    { id: 'home', label: 'ホーム', shape: 'box', x: 280, y: 0, width: 180, height: 60, meta: { group: '', kind: 'screen' } },
  ],
  edges: [{ id: 't1', from: 'login', to: 'home', label: 'ログイン成功', style: 'arrow' }],
});

test('shape 別 SVG: terminal は ellipse、box は rx 付き rect', () => {
  const html = renderHtml(flowLayout(), { type: 'screen-flow' });
  assert.ok(html.includes('<ellipse'));
  assert.ok(/<g class="node" data-id="home"[^>]*>.*?<rect[^>]*rx="8"/.test(html));
});

test('非 ER エッジに矢印マーカーが付き、defs にマーカー定義がある', () => {
  const html = renderHtml(flowLayout(), { type: 'screen-flow' });
  assert.ok(html.includes('<defs>'));
  assert.ok(html.includes('marker-end="url(#arrow)"'));
});

test('ゾーンが .zone として nodes より先に描画される', () => {
  const html = renderHtml({
    type: 'architecture',
    title: '構成',
    zones: [{ id: 'aws', label: 'AWS', x: 0, y: 0, width: 400, height: 200 }],
    nodes: [{ id: 'app', label: 'App', shape: 'box', x: 20, y: 50, width: 140, height: 60, meta: {} }],
    edges: [],
  }, { type: 'architecture' });
  assert.ok(html.includes('<g class="zone">'));
  assert.ok(html.indexOf('class="zone"') < html.indexOf('data-id="app"'));
});

test('ライフラインとポイント指定エッジ(return は破線クラス)が描画される', () => {
  const html = renderHtml({
    type: 'sequence',
    title: 'シーケンス',
    nodes: [
      { id: 'u', label: 'U', shape: 'actor', x: 0, y: 0, width: 140, height: 50, meta: { kind: 'actor' } },
      { id: 'w', label: 'W', shape: 'actor', x: 220, y: 0, width: 140, height: 50, meta: { kind: 'system' } },
    ],
    lines: [
      { x: 70, y1: 50, y2: 250, owner: 'u' },
      { x: 290, y1: 50, y2: 250, owner: 'w' },
    ],
    edges: [
      { id: 'msg1', from: 'u', to: 'w', label: '要求', style: 'sync', fromPt: { x: 70, y: 100 }, toPt: { x: 290, y: 100 } },
      { id: 'msg2', from: 'w', to: 'u', label: '応答', style: 'return', fromPt: { x: 290, y: 150 }, toPt: { x: 70, y: 150 } },
    ],
  }, { type: 'sequence' });
  assert.ok((html.match(/class="lifeline"/g) ?? []).length === 2);
  assert.ok(html.includes('<g class="edge sync" data-id="msg1"'));
  assert.ok(html.includes('<g class="edge return" data-id="msg2"'));
  // ポイント指定座標が反映される(PAD=40 加算後)
  assert.ok(html.includes('x1="110"'));
});

test('viewBox がライフラインとゾーンを含む大きさになる', () => {
  const html = renderHtml({
    type: 'sequence',
    title: 'x',
    nodes: [{ id: 'u', label: 'U', shape: 'actor', x: 0, y: 0, width: 140, height: 50, meta: {} }],
    lines: [{ x: 70, y1: 50, y2: 500, owner: 'u' }],
    edges: [],
  }, { type: 'sequence' });
  const m = html.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(Number(m[2]) >= 500 + 80); // y2 + PAD*2
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/render-html.test.mjs`
Expected: FAIL(新規 5 テストが落ち、既存 5 は PASS)

- [ ] **Step 3: html.mjs を汎用化**

`plugins/basic-design/scripts/lib/render/html.mjs` を修正する。変更点(既存の ER 出力に影響しない差分のみ):

(1) 冒頭のサイズ計算を差し替え:

```js
export function renderHtml(layout, spec) {
  const zones = layout.zones ?? [];
  const lines = layout.lines ?? [];
  const boxes = [...layout.nodes, ...zones];
  const width = Math.max(
    ...boxes.map((b) => b.x + b.width),
    ...lines.map((l) => l.x),
  ) + PAD * 2;
  const height = Math.max(
    ...boxes.map((b) => b.y + b.height),
    ...lines.map((l) => l.y2),
    ...layout.edges.flatMap((e) => (e.fromPt ? [e.fromPt.y, e.toPt.y] : [])),
  ) + PAD * 2;
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
```

(2) `byId` の直後に zoneSvg / lineSvg を追加:

```js
  const zoneSvg = zones
    .map((zone) =>
      `<g class="zone">` +
      `<rect x="${zone.x + PAD}" y="${zone.y + PAD}" width="${zone.width}" height="${zone.height}"/>` +
      `<text x="${zone.x + PAD + 8}" y="${zone.y + PAD + 18}" class="zone-label">${escapeXml(zone.label)}</text>` +
      `</g>`,
    )
    .join('\n');

  const lineSvg = lines
    .map((line) =>
      `<line class="lifeline" x1="${line.x + PAD}" y1="${line.y1 + PAD}" x2="${line.x + PAD}" y2="${line.y2 + PAD}"/>`,
    )
    .join('\n');
```

(3) edgeSvg の map 内を差し替え(座標決定とマーカー対応):

```js
  const edgeSvg = layout.edges
    .map((edge) => {
      let x1;
      let y1;
      let x2;
      let y2;
      if (edge.fromPt) {
        x1 = edge.fromPt.x + PAD;
        y1 = edge.fromPt.y + PAD;
        x2 = edge.toPt.x + PAD;
        y2 = edge.toPt.y + PAD;
      } else {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        x1 = a.x + a.width / 2 + PAD;
        y1 = a.y + a.height / 2 + PAD;
        x2 = b.x + b.width / 2 + PAD;
        y2 = b.y + b.height / 2 + PAD;
      }
      const label = [edge.label, edge.cardinality].filter(Boolean).join(' ');
      const styleClass = edge.style ? ` ${edge.style}` : '';
      const marker = edge.cardinality
        ? ''
        : edge.style === 'async' || edge.style === 'return'
          ? ' marker-end="url(#arrow-open)"'
          : ' marker-end="url(#arrow)"';
      return (
        `<g class="edge${styleClass}" data-id="${escapeXml(edge.id)}" data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}">` +
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${marker}/>` +
        `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" class="edge-label">${escapeXml(label)}</text>` +
        `</g>`
      );
    })
    .join('\n');
```

(4) nodeSvg の map 内を差し替え(shape 対応。rows パスは既存のまま):

```js
  const nodeSvg = layout.nodes
    .map((node) => {
      let body;
      if (node.rows) {
        const rows = node.rows
          .map((row, i) => {
            const rowY = node.headerHeight + i * node.rowHeight + node.rowHeight / 2;
            return `<text x="8" y="${rowY}" dominant-baseline="middle" class="row">${escapeXml(row.text)}</text>`;
          })
          .join('');
        body =
          `<rect width="${node.width}" height="${node.height}" class="node-box"/>` +
          `<rect width="${node.width}" height="${node.headerHeight}" class="node-header"/>` +
          `<text x="${node.width / 2}" y="${node.headerHeight / 2}" text-anchor="middle" dominant-baseline="middle" class="node-title">${escapeXml(node.label)}</text>` +
          rows;
      } else if (node.shape === 'terminal') {
        body =
          `<ellipse cx="${node.width / 2}" cy="${node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" class="node-box"/>` +
          `<text x="${node.width / 2}" y="${node.height / 2}" text-anchor="middle" dominant-baseline="middle" class="node-title">${escapeXml(node.label)}</text>`;
      } else {
        const rx = node.shape === 'actor' ? 0 : 8;
        const fillClass = node.shape === 'actor' ? ' node-header-fill' : '';
        body =
          `<rect width="${node.width}" height="${node.height}" rx="${rx}" class="node-box${fillClass}"/>` +
          `<text x="${node.width / 2}" y="${node.height / 2}" text-anchor="middle" dominant-baseline="middle" class="node-title">${escapeXml(node.label)}</text>`;
      }
      return (
        `<g class="node" data-id="${escapeXml(node.id)}" transform="translate(${node.x + PAD},${node.y + PAD})">` +
        body +
        `</g>`
      );
    })
    .join('\n');
```

(5) `<style>` 内の `.hl line, .pv line { ... }` の直後に追加:

```css
  .zone rect { fill: #f5f5f5; stroke: #666; }
  .zone-label { font-size: 12px; font-weight: bold; fill: #444; }
  .lifeline { stroke: #999; stroke-dasharray: 6 4; }
  .edge.return line { stroke-dasharray: 6 4; }
  .node-header-fill { fill: #e8eef7; }
  #arrow path { fill: #666; }
```

(6) SVG 本体を差し替え(defs 追加、zones / lines グループ追加):

```html
<svg id="canvas" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>
<marker id="arrow-open" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="#666"/></marker>
</defs>
<g id="zones">
${zoneSvg}
</g>
<g id="lines">
${lineSvg}
</g>
<g id="edges">
${edgeSvg}
</g>
<g id="nodes">
${nodeSvg}
</g>
</svg>
```

(7) 詳細パネル `showPanel` を差し替え(rows が無いノードは meta を表示、エッジは存在するフィールドだけ):

```js
  function showPanel(g) {
    panel.hidden = false;
    panelBody.textContent = '';
    if (g.classList.contains('node')) {
      const node = layout.nodes.find((n) => n.id === g.dataset.id);
      panelTitle.textContent = node.label;
      const table = document.createElement('table');
      if (node.rows) {
        for (const row of node.rows) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.textContent = row.text;
          tr.appendChild(td);
          table.appendChild(tr);
        }
      } else {
        for (const [k, v] of Object.entries(node.meta ?? {})) {
          if (v === '' || v === undefined) continue;
          const tr = document.createElement('tr');
          const td1 = document.createElement('td');
          const td2 = document.createElement('td');
          td1.textContent = k;
          td2.textContent = String(v);
          tr.append(td1, td2);
          table.appendChild(tr);
        }
      }
      panelBody.appendChild(table);
    } else {
      const edge = layout.edges.find((ed) => ed.id === g.dataset.id);
      panelTitle.textContent = edge.label || edge.id;
      const dl = document.createElement('table');
      const fields = [['from', edge.from], ['to', edge.to]];
      if (edge.cardinality) fields.push(['cardinality', edge.cardinality]);
      if (edge.style) fields.push(['style', edge.style]);
      for (const [k, v] of fields) {
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
```

- [ ] **Step 4: テストが通ることを確認(ER 回帰含む)**

Run: `node --test plugins/basic-design/scripts/render-html.test.mjs`
Expected: PASS(既存 5 + 新規 5 = 10 tests)

注意: 既存テスト「外部リソース参照が無い」は `src="https?:` / `link href` を見るためマーカー追加で壊れない。ER エッジは cardinality を持つため marker 属性が付かず、既存アサーションのまま通る。

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/scripts/
git commit -m "feat(basic-design): HTML レンダラをゾーン・図形・ライフライン・座標指定エッジに対応

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: CLI 配線とサンプル 3 種

**Files:**
- Modify: `plugins/basic-design/scripts/design-gen.mjs`(LAYOUTS に 3 図種追加)
- Test: `plugins/basic-design/scripts/design-gen.test.mjs`(既存 9 テストに追記)
- Create: `plugins/basic-design/samples/ec-screen-flow.spec.json` / `web-architecture.spec.json` / `login-sequence.spec.json`(+ 各 .drawio / .html 生成物)

**Interfaces:**
- Consumes: Task 2〜6 の全成果
- Produces: 4 図種すべてが CLI で生成可能。コミット済みサンプル生成物

- [ ] **Step 1: 失敗するテストを追記**

`plugins/basic-design/scripts/design-gen.test.mjs` の末尾に追記:

```js
// ---- Stage 2: 3 図種の生成 ----

const flowSpec = {
  type: 'screen-flow',
  title: '画面遷移',
  screens: [
    { id: 'login', label: 'ログイン', kind: 'start' },
    { id: 'home', label: 'ホーム' },
  ],
  transitions: [{ from: 'login', to: 'home', trigger: '成功' }],
};

const archSpec = {
  type: 'architecture',
  title: '構成図',
  zones: [{ id: 'aws', label: 'AWS', children: ['app'] }],
  nodes: [
    { id: 'browser', label: 'ブラウザ' },
    { id: 'app', label: 'App' },
  ],
  edges: [{ from: 'browser', to: 'app', label: 'HTTPS' }],
};

const seqSpec = {
  type: 'sequence',
  title: 'シーケンス',
  actors: [
    { id: 'u', label: 'ユーザー' },
    { id: 'w', label: 'Web' },
  ],
  messages: [
    { from: 'u', to: 'w', label: '要求' },
    { from: 'w', to: 'u', label: '応答', style: 'return' },
  ],
};

for (const [name, spec] of [['screen-flow', flowSpec], ['architecture', archSpec], ['sequence', seqSpec]]) {
  test(`${name}: --format both で 2 ファイル生成される`, async () => {
    const { specPath } = await writeSpec(spec, `${name}.spec.json`);
    const { code, json } = await runCli([specPath, '--format', 'both']);
    assert.equal(code, 0);
    assert.equal(json.ok, true);
    assert.equal(json.files.length, 2);
    const drawio = await readFile(json.files.find((f) => f.endsWith('.drawio')), 'utf8');
    assert.ok(drawio.startsWith('<mxfile'));
    const html = await readFile(json.files.find((f) => f.endsWith('.html')), 'utf8');
    assert.ok(html.startsWith('<!doctype html>'));
  });
}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test plugins/basic-design/scripts/design-gen.test.mjs`
Expected: FAIL(3 新規テストが「LAYOUTS[spec.type] is not a function」相当で落ちる)

- [ ] **Step 3: design-gen.mjs の LAYOUTS を配線**

import に追加:

```js
import { layoutScreenFlow } from './lib/layout/screen-flow.mjs';
import { layoutArchitecture } from './lib/layout/architecture.mjs';
import { layoutSequence } from './lib/layout/sequence.mjs';
```

LAYOUTS を差し替え:

```js
const LAYOUTS = {
  er: layoutEr,
  'screen-flow': layoutScreenFlow,
  architecture: layoutArchitecture,
  sequence: layoutSequence,
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test plugins/basic-design/scripts/*.test.mjs`
Expected: PASS(全ファイル、fail 0)

- [ ] **Step 5: サンプル spec を作成し生成**

`plugins/basic-design/samples/ec-screen-flow.spec.json`:

```json
{
  "type": "screen-flow",
  "title": "EC サイト画面遷移図(サンプル)",
  "screens": [
    { "id": "login", "label": "ログイン", "group": "認証", "kind": "start" },
    { "id": "home", "label": "ホーム" },
    { "id": "product-list", "label": "商品一覧" },
    { "id": "product-detail", "label": "商品詳細" },
    { "id": "cart", "label": "カート" },
    { "id": "checkout", "label": "購入手続き" },
    { "id": "order-complete", "label": "注文完了", "kind": "end" }
  ],
  "transitions": [
    { "from": "login", "to": "home", "trigger": "ログイン成功" },
    { "from": "home", "to": "product-list", "trigger": "カテゴリ選択" },
    { "from": "product-list", "to": "product-detail", "trigger": "商品選択" },
    { "from": "product-detail", "to": "cart", "trigger": "カートに入れる" },
    { "from": "cart", "to": "checkout", "trigger": "レジへ進む" },
    { "from": "checkout", "to": "order-complete", "trigger": "注文確定" },
    { "from": "order-complete", "to": "home", "trigger": "トップへ戻る" }
  ]
}
```

`plugins/basic-design/samples/web-architecture.spec.json`:

```json
{
  "type": "architecture",
  "title": "Web システム構成図(サンプル)",
  "zones": [
    { "id": "aws", "label": "AWS", "children": ["alb", "web", "app", "db"] }
  ],
  "nodes": [
    { "id": "browser", "label": "ブラウザ" },
    { "id": "cdn", "label": "CDN" },
    { "id": "alb", "label": "ALB" },
    { "id": "web", "label": "Web Server", "icon": "server" },
    { "id": "app", "label": "App Server", "icon": "server" },
    { "id": "db", "label": "PostgreSQL", "icon": "database" }
  ],
  "edges": [
    { "from": "browser", "to": "cdn", "label": "HTTPS" },
    { "from": "browser", "to": "alb", "label": "HTTPS" },
    { "from": "alb", "to": "web", "label": "HTTP" },
    { "from": "web", "to": "app", "label": "HTTP" },
    { "from": "app", "to": "db", "label": "SQL" }
  ]
}
```

`plugins/basic-design/samples/login-sequence.spec.json`:

```json
{
  "type": "sequence",
  "title": "ログイン処理シーケンス図(サンプル)",
  "actors": [
    { "id": "user", "label": "ユーザー", "kind": "actor" },
    { "id": "web", "label": "Web アプリ" },
    { "id": "auth", "label": "認証 API" },
    { "id": "db", "label": "DB" }
  ],
  "messages": [
    { "from": "user", "to": "web", "label": "ログイン要求" },
    { "from": "web", "to": "auth", "label": "認証リクエスト" },
    { "from": "auth", "to": "db", "label": "ユーザー照会" },
    { "from": "db", "to": "auth", "label": "ユーザー情報", "style": "return" },
    { "from": "auth", "to": "web", "label": "トークン発行", "style": "return" },
    { "from": "web", "to": "user", "label": "ホーム画面表示", "style": "return" }
  ]
}
```

各サンプルを生成:

```bash
node plugins/basic-design/scripts/design-gen.mjs plugins/basic-design/samples/ec-screen-flow.spec.json --format both
node plugins/basic-design/scripts/design-gen.mjs plugins/basic-design/samples/web-architecture.spec.json --format both
node plugins/basic-design/scripts/design-gen.mjs plugins/basic-design/samples/login-sequence.spec.json --format both
```

Expected: 各コマンドで `{"ok":true,"files":[...2件...]}`、exit 0

- [ ] **Step 6: コミット**

```bash
git add plugins/basic-design/scripts/ plugins/basic-design/samples/
git commit -m "feat(basic-design): design-gen に 3 図種を配線しサンプルを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: スキル 3 種(screen-flow / system-architecture / sequence-diagram)

**Files:**
- Create: `plugins/basic-design/skills/screen-flow/SKILL.md` + `references/spec-schema.md`
- Create: `plugins/basic-design/skills/system-architecture/SKILL.md` + `references/spec-schema.md`
- Create: `plugins/basic-design/skills/sequence-diagram/SKILL.md` + `references/spec-schema.md`

**Interfaces:**
- Consumes: Task 7 の CLI(既存 er-diagram スキルと同じ呼び出し契約)
- Produces: 「画面遷移図を作って」「システム構成図を作って」「シーケンス図を作って」で発動するスキル

3 スキルとも既存 `plugins/basic-design/skills/er-diagram/SKILL.md` と同じ章立て(目的 / 大原則 / 手順 1〜5 / 既存図の更新)にする。**大原則・手順 1(環境チェック)・手順 3(ドラフト全文提示→明示承認)・手順 4 のエラー規律(2 回修正で STOP)・手順 5 の開き方案内・「既存図の更新」節は er-diagram と同一文面を使い、図種固有部分だけ差し替える**。er-diagram を読んでから書くこと。

- [ ] **Step 1: screen-flow スキルを書く**

`plugins/basic-design/skills/screen-flow/SKILL.md` — frontmatter:

```markdown
---
name: screen-flow
description: ユーザーが画面遷移図(画面フロー図)の作成・更新を依頼したときに必ず使用するスキル。ユーザーとのブレインストーミングで画面と遷移を練り上げ、Draw.io 形式(.drawio)またはインタラクティブ HTML として docs/design/screen-flow/ に生成する。明示的な依頼があったときのみ使い、自律的には発動しない。
---
```

図種固有部分:
- 保存先の既定: `docs/design/screen-flow/`
- ブレストの観点表(設計書 §5):

```markdown
| 観点 | 埋まる状態 |
| --- | --- |
| 画面一覧 | 対象領域の画面が列挙され、それぞれ一言で説明できる |
| 画面グループ | 認証・商品・決済などの画面のまとまり(group) |
| 遷移とトリガー | どの画面からどの画面へ、何をきっかけに遷移するか |
| 開始・終了点 | エントリーポイント(kind: start)と終端画面(kind: end) |
```

- ドラフト提示の内容: 画面一覧(id・ラベル・グループ・kind)と遷移一覧(from → to、トリガー)
- spec 参照: `references/spec-schema.md`

`plugins/basic-design/skills/screen-flow/references/spec-schema.md`(er-diagram の spec-schema.md と同じ表形式):

- トップレベル: `type`(固定 `"screen-flow"`、必須)/ `title`(必須)/ `screens`(Screen[]、必須 1+)/ `transitions`(Transition[]、省略可)
- Screen: `id`(必須・一意)/ `label`(任意、省略時 id 表示)/ `group`(任意、画面のまとまり)/ `kind`(任意、`"start"` | `"end"`。図では楕円表示)
- Transition: `from`/`to`(必須、定義済み screen id)/ `trigger`(任意、遷移のきっかけ。エッジラベルになる)
- 記述例として Task 7 の ec-screen-flow.spec.json の短縮版(画面 3 つ・遷移 2 つ)を載せる

- [ ] **Step 2: system-architecture スキルを書く**

`plugins/basic-design/skills/system-architecture/SKILL.md` — frontmatter:

```markdown
---
name: system-architecture
description: ユーザーがシステム構成図(アーキテクチャ図・インフラ構成図)の作成・更新を依頼したときに必ず使用するスキル。ユーザーとのブレインストーミングでゾーン・ノード・通信経路を練り上げ、Draw.io 形式(.drawio)またはインタラクティブ HTML として docs/design/architecture/ に生成する。明示的な依頼があったときのみ使い、自律的には発動しない。
---
```

図種固有部分:
- 保存先の既定: `docs/design/architecture/`
- 観点表:

```markdown
| 観点 | 埋まる状態 |
| --- | --- |
| ゾーン | ネットワーク境界・クラウド環境などのまとまり(AWS、オンプレ、DMZ 等) |
| ノード | サーバー・サービス・ミドルウェアが列挙され、所属ゾーンが決まっている |
| 通信経路とプロトコル | どのノード間がどのプロトコルで通信するか |
| 外部システム | 連携する外部サービス・クライアント(ゾーン外ノード) |
```

- ドラフト提示: ゾーン一覧(id・ラベル・所属ノード)、ノード一覧(id・ラベル・icon)、通信経路一覧(from → to、ラベル)
- spec-schema.md: `type: "architecture"` / `title` / `zones`(Zone[]、省略可)/ `nodes`(Node[]、必須 1+)/ `edges`(Edge[]、省略可)。Zone: `id`(必須・ノードとも衝突しない一意)/ `label`(任意)/ `children`(必須 1+、定義済みノード id。1 ノードは最大 1 ゾーン)。Node: `id`(必須・一意)/ `label`(任意)/ `icon`(任意、詳細パネル表示用のメモ)。Edge: `from`/`to`(必須、定義済みノード id)/ `label`(任意、プロトコル等)

- [ ] **Step 3: sequence-diagram スキルを書く**

`plugins/basic-design/skills/sequence-diagram/SKILL.md` — frontmatter:

```markdown
---
name: sequence-diagram
description: ユーザーがシーケンス図(処理フローの時系列図)の作成・更新を依頼したときに必ず使用するスキル。ユーザーとのブレインストーミングで対象ユースケースの登場アクターとメッセージの流れを練り上げ、Draw.io 形式(.drawio)またはインタラクティブ HTML として docs/design/sequence/ に生成する。明示的な依頼があったときのみ使い、自律的には発動しない。
---
```

図種固有部分:
- 保存先の既定: `docs/design/sequence/`
- 観点表:

```markdown
| 観点 | 埋まる状態 |
| --- | --- |
| 対象ユースケース | どの処理フローを図にするか(1 図 1 ユースケース) |
| 登場アクター・システム | 関与する人・システム・外部サービスが列挙されている |
| メッセージの順序 | 誰から誰へ、どの順番で何が送られるか |
| 同期・非同期・応答の別 | 各メッセージが同期(省略)/ 非同期(async)/ 応答(return)のどれか |
```

- 制約の明記: **自己メッセージ(from と to が同一)は未対応**。必要な場合は処理内容をメッセージラベルに含めるよう案内する
- ドラフト提示: アクター一覧(id・ラベル・kind)、メッセージ一覧(順番、from → to、ラベル、style)
- spec-schema.md: `type: "sequence"` / `title` / `actors`(Actor[]、必須 1+)/ `messages`(Message[]、省略可)。Actor: `id`(必須・一意)/ `label`(任意)/ `kind`(任意、`"actor"` = 人、省略 = システム。詳細パネル表示用)。Message: `from`/`to`(必須、定義済みアクター id、同一不可)/ `label`(任意)/ `style`(任意、`"async"` | `"return"`、省略 = 同期)

- [ ] **Step 4: セルフチェック**

- 3 スキルの frontmatter が er-diagram と同形式(name / description のみ)であること
- 各 spec-schema.md の必須/任意・許容値が Task 1 の validate.mjs 実装と一致すること(実装を読んで照合)
- CLI 呼び出しコマンドと保存先ディレクトリが正しいこと

- [ ] **Step 5: コミット**

```bash
git add plugins/basic-design/skills/
git commit -m "feat(basic-design): 画面遷移図・システム構成図・シーケンス図スキルを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: バージョン更新と仕上げ

**Files:**
- Modify: `plugins/basic-design/.claude-plugin/plugin.json`(version → `0.2.0-dev`)
- Modify: `plugins/basic-design/README.md`(実装状況を Stage 2 まで更新)

**Interfaces:**
- Consumes: Task 1〜8 のすべて
- Produces: リリース可能な Stage 2

- [ ] **Step 1: plugin.json のバージョンを上げる**

`"version": "0.1.0-dev"` → `"version": "0.2.0-dev"`(マイナー更新のみ。メジャー更新ではないため人間確認は不要 — CLAUDE.md の規則どおり)

- [ ] **Step 2: README.md の実装状況を更新**

「## 現在の実装状況」を:

```markdown
## 現在の実装状況

- Stage 1: 変換パイプライン基盤 + ER図スキル
- Stage 2: 画面遷移図・システム構成図・シーケンス図(スキル+レイアウト+両レンダラ対応)
```

- [ ] **Step 3: 全テスト通しと最終コミット**

Run: `node --test plugins/basic-design/scripts/*.test.mjs`
Expected: PASS(fail 0)

```bash
git add plugins/basic-design/
git commit -m "feat(basic-design): Stage 2 リリース(v0.2.0-dev)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 完了条件(Stage 2)

- `node --test plugins/basic-design/scripts/*.test.mjs` が全パス(既存 42 を含む)
- 4 図種すべてが CLI で .drawio / .html を生成できる
- サンプル 3 種(ec-screen-flow / web-architecture / login-sequence)の生成物がコミットされている
- ブラウザ実機確認はユーザー起床後にサンプルで実施してもらう(Stage 1 と同じ 2 点確認)

## 後続 Stage(この計画のスコープ外)

- Stage 3: api-list / nfr-checklist / 入口スキル basic-design
- Stage 4: Google Drive 連携
