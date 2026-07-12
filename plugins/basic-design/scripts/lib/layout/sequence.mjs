const ACTOR_WIDTH = 140;
const ACTOR_HEIGHT = 50;
const ACTOR_GAP = 80;
const MESSAGE_GAP = 50;
const TAIL = 30;

export function layoutSequence(spec) {
  const messages = spec.messages ?? [];
  const bottomY = ACTOR_HEIGHT + (messages.length + 1) * MESSAGE_GAP + TAIL;
  const centerX = new Map();

  const nodes = spec.actors.map((actor, i) => {
    const x = i * (ACTOR_WIDTH + ACTOR_GAP);
    centerX.set(actor.id, x + ACTOR_WIDTH / 2);
    return {
      id: actor.id,
      label: actor.label ?? actor.id,
      shape: 'actor',
      x,
      y: 0,
      width: ACTOR_WIDTH,
      height: ACTOR_HEIGHT,
      meta: { kind: actor.kind ?? 'system' },
    };
  });

  const lines = spec.actors.map((actor) => ({
    x: centerX.get(actor.id),
    y1: ACTOR_HEIGHT,
    y2: bottomY,
    owner: actor.id,
  }));

  const edges = messages.map((msg, i) => {
    const y = ACTOR_HEIGHT + (i + 1) * MESSAGE_GAP;
    return {
      id: `msg${i + 1}`,
      from: msg.from,
      to: msg.to,
      label: msg.label ?? '',
      style: msg.style === 'return' ? 'return' : msg.style === 'async' ? 'async' : 'sync',
      fromPt: { x: centerX.get(msg.from), y },
      toPt: { x: centerX.get(msg.to), y },
    };
  });

  return { type: 'sequence', title: spec.title, nodes, lines, edges };
}
