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
