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

// ---- 直交エッジルーティング ----

test('障害物を挟む source/target エッジは orthogonalEdgeStyle と waypoint を持つ', () => {
  const xml = renderDrawio({
    type: 'architecture',
    title: 'obst',
    nodes: [
      { id: 'a', label: 'A', shape: 'box', x: 0, y: 100, width: 140, height: 60 },
      { id: 'm', label: 'M', shape: 'box', x: 200, y: 100, width: 140, height: 60 },
      { id: 'b', label: 'B', shape: 'box', x: 400, y: 100, width: 140, height: 60 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', label: '接続', style: 'arrow' }],
  });
  assert.ok(/id="e-e1"[^>]*style="edgeStyle=orthogonalEdgeStyle;/.test(xml));
  const cell = xml.match(/<mxCell id="e-e1"[\s\S]*?<\/mxCell>/)[0];
  assert.ok(cell.includes('<Array as="points">'));
  assert.ok(/<mxPoint x="[-\d.]+" y="[-\d.]+"\/>/.test(cell));
});

test('障害物なしの整列 source/target エッジは Array を持たない', () => {
  const xml = renderDrawio({
    type: 'architecture',
    title: 'aligned',
    nodes: [
      { id: 'a', label: 'A', shape: 'box', x: 0, y: 0, width: 140, height: 60 },
      { id: 'b', label: 'B', shape: 'box', x: 400, y: 0, width: 140, height: 60 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b', label: '接続', style: 'arrow' }],
  });
  const cell = xml.match(/<mxCell id="e-e1"[\s\S]*?<\/mxCell>/)[0];
  assert.ok(/id="e-e1"[^>]*style="edgeStyle=orthogonalEdgeStyle;/.test(xml));
  assert.ok(!cell.includes('<Array'));
  assert.ok(cell.includes('<mxGeometry relative="1" as="geometry"/>'));
});
