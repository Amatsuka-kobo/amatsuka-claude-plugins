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
