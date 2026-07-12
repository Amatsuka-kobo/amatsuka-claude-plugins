const NODE_WIDTH = 140;
const NODE_HEIGHT = 60;
const NODE_GAP = 40;
const ZONE_PADDING = 20;
const ZONE_HEADER = 30;
const ZONE_GAP = 60;

export function layoutArchitecture(spec) {
  const zones = spec.zones ?? [];
  const zoned = new Set(zones.flatMap((z) => z.children));
  const nodeById = new Map(spec.nodes.map((n) => [n.id, n]));

  const zoneBoxes = [];
  const nodes = [];
  let cursorX = 0;

  for (const zone of zones) {
    const children = zone.children;
    const cols = Math.ceil(Math.sqrt(children.length));
    const rows = Math.ceil(children.length / cols);
    const width = ZONE_PADDING * 2 + cols * NODE_WIDTH + (cols - 1) * NODE_GAP;
    const height = ZONE_HEADER + ZONE_PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * NODE_GAP;
    zoneBoxes.push({ id: zone.id, label: zone.label ?? zone.id, x: cursorX, y: 0, width, height });
    children.forEach((childId, i) => {
      const child = nodeById.get(childId);
      nodes.push({
        id: child.id,
        label: child.label ?? child.id,
        shape: 'box',
        x: cursorX + ZONE_PADDING + (i % cols) * (NODE_WIDTH + NODE_GAP),
        y: ZONE_HEADER + ZONE_PADDING + Math.floor(i / cols) * (NODE_HEIGHT + NODE_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        meta: { icon: child.icon ?? '', zone: zone.id },
      });
    });
    cursorX += width + ZONE_GAP;
  }

  const unzoned = spec.nodes.filter((n) => !zoned.has(n.id));
  const cols = Math.ceil(Math.sqrt(unzoned.length || 1));
  unzoned.forEach((n, i) => {
    nodes.push({
      id: n.id,
      label: n.label ?? n.id,
      shape: 'box',
      x: cursorX + (i % cols) * (NODE_WIDTH + NODE_GAP),
      y: ZONE_HEADER + Math.floor(i / cols) * (NODE_HEIGHT + NODE_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      meta: { icon: n.icon ?? '', zone: '' },
    });
  });

  const edges = (spec.edges ?? []).map((e, i) => ({
    id: `e${i + 1}`,
    from: e.from,
    to: e.to,
    label: e.label ?? '',
    style: 'arrow',
  }));

  return { type: 'architecture', title: spec.title, zones: zoneBoxes, nodes, edges };
}
