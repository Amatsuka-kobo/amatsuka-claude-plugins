const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const GAP_X = 100;
const GAP_Y = 40;

export function layoutScreenFlow(spec) {
  const transitions = spec.transitions ?? [];
  const incoming = new Map(spec.screens.map((s) => [s.id, 0]));
  const adjacency = new Map(spec.screens.map((s) => [s.id, []]));
  for (const t of transitions) {
    incoming.set(t.to, incoming.get(t.to) + 1);
    adjacency.get(t.from).push(t.to);
  }

  let roots = spec.screens.filter((s) => s.kind === 'start').map((s) => s.id);
  if (roots.length === 0) {
    roots = spec.screens.filter((s) => incoming.get(s.id) === 0).map((s) => s.id);
  }
  if (roots.length === 0) roots = [spec.screens[0].id];

  const layerOf = new Map(roots.map((id) => [id, 0]));
  const queue = roots.map((id) => [id, 0]);
  while (queue.length > 0) {
    const [id, layer] = queue.shift();
    for (const next of adjacency.get(id)) {
      if (!layerOf.has(next)) {
        layerOf.set(next, layer + 1);
        queue.push([next, layer + 1]);
      }
    }
  }
  const maxLayer = Math.max(...layerOf.values());
  for (const screen of spec.screens) {
    if (!layerOf.has(screen.id)) layerOf.set(screen.id, maxLayer + 1);
  }

  const rowIndex = new Map();
  const nodes = spec.screens.map((screen) => {
    const layer = layerOf.get(screen.id);
    const row = rowIndex.get(layer) ?? 0;
    rowIndex.set(layer, row + 1);
    return {
      id: screen.id,
      label: screen.label ?? screen.id,
      shape: screen.kind === 'start' || screen.kind === 'end' ? 'terminal' : 'box',
      x: layer * (NODE_WIDTH + GAP_X),
      y: row * (NODE_HEIGHT + GAP_Y),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      meta: { group: screen.group ?? '', kind: screen.kind ?? 'screen' },
    };
  });

  const edges = transitions.map((t, i) => ({
    id: `t${i + 1}`,
    from: t.from,
    to: t.to,
    label: t.trigger ?? '',
    style: 'arrow',
  }));

  return { type: 'screen-flow', title: spec.title, nodes, edges };
}
