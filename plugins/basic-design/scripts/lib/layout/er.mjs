const ENTITY_WIDTH = 220;
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 26;
const GAP_X = 80;
const GAP_Y = 60;

export function layoutEr(spec) {
  const relations = spec.relations ?? [];
  const degree = new Map(spec.entities.map((e) => [e.name, 0]));
  for (const rel of relations) {
    degree.set(rel.from, degree.get(rel.from) + 1);
    degree.set(rel.to, degree.get(rel.to) + 1);
  }
  const ordered = [...spec.entities].sort(
    (a, b) => degree.get(b.name) - degree.get(a.name),
  );

  const cols = Math.ceil(Math.sqrt(ordered.length));
  const nodes = [];
  let y = 0;
  for (let start = 0; start < ordered.length; start += cols) {
    const rowEntities = ordered.slice(start, start + cols);
    let rowMaxHeight = 0;
    rowEntities.forEach((entity, i) => {
      const height = HEADER_HEIGHT + entity.columns.length * ROW_HEIGHT;
      nodes.push({
        id: entity.name,
        label: entity.label ? `${entity.label}(${entity.name})` : entity.name,
        x: i * (ENTITY_WIDTH + GAP_X),
        y,
        width: ENTITY_WIDTH,
        height,
        headerHeight: HEADER_HEIGHT,
        rowHeight: ROW_HEIGHT,
        rows: entity.columns.map((column) => ({
          text: formatColumn(column),
          meta: column,
        })),
      });
      rowMaxHeight = Math.max(rowMaxHeight, height);
    });
    y += rowMaxHeight + GAP_Y;
  }

  const edges = relations.map((rel, i) => ({
    id: `rel${i + 1}`,
    from: rel.from,
    to: rel.to,
    label: rel.label ?? '',
    cardinality: rel.cardinality,
  }));

  return { type: 'er', title: spec.title, nodes, edges };
}

function formatColumn(column) {
  const marks = [
    column.pk && 'PK',
    column.fk && 'FK',
    column.unique && 'UQ',
  ].filter(Boolean);
  const prefix = marks.length ? `[${marks.join(',')}] ` : '';
  return column.type ? `${prefix}${column.name} : ${column.type}` : `${prefix}${column.name}`;
}
