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

// ---- 直交エッジルーティング ----

test('障害物を挟む source/target エッジは polyline になり障害物矩形を避ける', () => {
  const PAD = 40;
  const from = { id: 'a', label: 'A', shape: 'box', x: 0, y: 100, width: 140, height: 60, meta: {} };
  const mid = { id: 'm', label: 'M', shape: 'box', x: 200, y: 100, width: 140, height: 60, meta: {} };
  const to = { id: 'b', label: 'B', shape: 'box', x: 400, y: 100, width: 140, height: 60, meta: {} };
  const html = renderHtml({
    type: 'architecture',
    title: 'obst',
    nodes: [from, mid, to],
    edges: [{ id: 'e1', from: 'a', to: 'b', label: '接続', style: 'arrow' }],
  }, { type: 'architecture' });

  // polyline で描画され marker-end が維持される
  const m = html.match(/data-id="e1"[^>]*>\s*<polyline points="([^"]+)" fill="none" marker-end="url\(#arrow\)"/);
  assert.ok(m, 'e1 が marker-end 付き polyline で出力される');
  const pts = m[1].trim().split(/\s+/).map((s) => {
    const [x, y] = s.split(',').map(Number);
    return { x, y };
  });
  assert.ok(pts.length > 2, `点数 ${pts.length} > 2`);

  // 障害物 m の HTML 矩形(PAD 加算後)をどのセグメントも貫通しない
  const rect = { x: mid.x + PAD, y: mid.y + PAD, x2: mid.x + mid.width + PAD, y2: mid.y + mid.height + PAD };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const hit = minX < rect.x2 && rect.x < maxX && minY < rect.y2 && rect.y < maxY;
    assert.ok(!hit, `segment ${i} が障害物 m を貫通した`);
  }
});

test('CSS が polyline を line と同様に扱う', () => {
  const html = renderHtml(flowLayout(), { type: 'screen-flow' });
  assert.ok(html.includes('.edge line, .edge polyline'));
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
