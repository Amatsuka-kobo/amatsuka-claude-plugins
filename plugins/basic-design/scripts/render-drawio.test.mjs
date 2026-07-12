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
