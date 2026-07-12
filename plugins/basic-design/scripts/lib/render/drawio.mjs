import { escapeXml } from '../xml-util.mjs';

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

export function renderDrawio(layout) {
  const cells = [];
  for (const node of layout.nodes) {
    const nodeId = `n-${node.id}`;
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
  }
  for (const edge of layout.edges) {
    const [startArrow, endArrow] = CARDINALITY_ARROWS[edge.cardinality] ?? ['none', 'open'];
    const style =
      `edgeStyle=entityRelationEdgeStyle;rounded=0;` +
      `startArrow=${startArrow};startFill=0;endArrow=${endArrow};endFill=0;`;
    cells.push(
      `<mxCell id="${escapeXml(`e-${edge.id}`)}" value="${escapeXml(edge.label)}" style="${style}" edge="1" parent="1" source="${escapeXml(`n-${edge.from}`)}" target="${escapeXml(`n-${edge.to}`)}">` +
        `<mxGeometry relative="1" as="geometry"/>` +
        `</mxCell>`,
    );
  }
  return (
    `<mxfile host="basic-design">` +
    `<diagram name="${escapeXml(layout.title)}">` +
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root>` +
    `</mxGraphModel></diagram></mxfile>`
  );
}
