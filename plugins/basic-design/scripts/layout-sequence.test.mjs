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
