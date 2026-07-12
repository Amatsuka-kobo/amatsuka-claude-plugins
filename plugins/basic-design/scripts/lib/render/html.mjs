import { escapeXml } from '../xml-util.mjs';

const PAD = 40;

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
  .zone rect { fill: #f5f5f5; stroke: #666; }
  .zone-label { font-size: 12px; font-weight: bold; fill: #444; }
  .lifeline { stroke: #999; stroke-dasharray: 6 4; }
  .edge.return line { stroke-dasharray: 6 4; }
  .node-header-fill { fill: #e8eef7; }
  #arrow path { fill: #666; }
  aside { width: 280px; border-left: 1px solid #ddd; padding: 12px; overflow-y: auto; background: #fff; }
  aside h2 { font-size: 14px; margin: 0 0 8px; }
  aside table { width: 100%; border-collapse: collapse; font-size: 12px; }
  aside td { border-bottom: 1px solid #eee; padding: 4px 2px; }
</style>
</head>
<body>
<main>
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
})();
</script>
</body>
</html>
`;
}
