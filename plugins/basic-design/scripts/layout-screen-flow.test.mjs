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
