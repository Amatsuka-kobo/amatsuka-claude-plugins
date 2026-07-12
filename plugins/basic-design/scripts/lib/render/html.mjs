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
