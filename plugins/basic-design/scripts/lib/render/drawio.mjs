import { escapeXml } from '../xml-util.mjs';
import { routeOrthogonal } from '../route.mjs';

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
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
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
      // 非 ER の source/target 型エッジ: 障害物回避の直交ルーティングを waypoint 化
      const style = `edgeStyle=orthogonalEdgeStyle;` + (EDGE_STYLES[edge.style] ?? EDGE_STYLES.arrow);
      const a = nodeById.get(edge.from);
      const b = nodeById.get(edge.to);
      let geometry = `<mxGeometry relative="1" as="geometry"/>`;
      if (a && b) {
        const obstacles = layout.nodes.filter((n) => n.id !== edge.from && n.id !== edge.to);
        const interior = routeOrthogonal(a, b, obstacles).slice(1, -1);
        if (interior.length > 0) {
          const points = interior
            .map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`)
            .join('');
          geometry =
            `<mxGeometry relative="1" as="geometry">` +
            `<Array as="points">${points}</Array>` +
            `</mxGeometry>`;
        }
      }
      cells.push(
        `<mxCell id="${escapeXml(`e-${edge.id}`)}" value="${escapeXml(edge.label)}" style="${style}" edge="1" parent="1" source="${escapeXml(`n-${edge.from}`)}" target="${escapeXml(`n-${edge.to}`)}">` +
          geometry +
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
