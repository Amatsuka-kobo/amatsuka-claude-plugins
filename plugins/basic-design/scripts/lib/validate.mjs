export const SUPPORTED_TYPES = ['er', 'screen-flow', 'architecture', 'sequence'];

const CARDINALITIES = ['1:1', '1:N', 'N:1', 'N:M'];

export function validateSpec(spec) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['spec: JSON オブジェクトではありません'];
  }
  if (!SUPPORTED_TYPES.includes(spec.type)) {
    return [`type: 未対応の図種 "${spec.type}" です(対応: ${SUPPORTED_TYPES.join(', ')})`];
  }
  const errors = [];
  if (typeof spec.title !== 'string' || spec.title.trim() === '') {
    errors.push('title: 必須です(空でない文字列)');
  }
  errors.push(...RULES[spec.type](spec));
  return errors;
}

const RULES = {
  er: validateEr,
  'screen-flow': validateScreenFlow,
  architecture: validateArchitecture,
  sequence: validateSequence,
};

function validateEr(spec) {
  const errors = [];
  if (!Array.isArray(spec.entities) || spec.entities.length === 0) {
    errors.push('entities: 1 件以上のエンティティが必須です');
    return errors;
  }
  const names = new Set();
  for (const [i, entity] of spec.entities.entries()) {
    const where = `entities[${i}]`;
    if (entity === null || typeof entity !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    if (typeof entity.name !== 'string' || entity.name.trim() === '') {
      errors.push(`${where}.name: 必須です(空でない文字列)`);
      continue;
    }
    if (names.has(entity.name)) {
      errors.push(`${where}.name: "${entity.name}" が重複しています`);
    }
    names.add(entity.name);
    if (!Array.isArray(entity.columns) || entity.columns.length === 0) {
      errors.push(`${where}(${entity.name}).columns: 1 件以上のカラムが必須です`);
      continue;
    }
    for (const [j, column] of entity.columns.entries()) {
      if (column === null || typeof column !== 'object') {
        errors.push(`entities(${entity.name}).columns[${j}]: オブジェクトではありません`);
        continue;
      }
      if (typeof column.name !== 'string' || column.name.trim() === '') {
        errors.push(`entities(${entity.name}).columns[${j}].name: 必須です(空でない文字列)`);
      }
    }
  }
  const relations = spec.relations ?? [];
  if (!Array.isArray(relations)) {
    errors.push('relations: 配列ではありません');
    return errors;
  }
  for (const [i, rel] of relations.entries()) {
    const where = `relations[${i}]`;
    if (rel === null || typeof rel !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    for (const end of ['from', 'to']) {
      if (!names.has(rel[end])) {
        errors.push(`${where}.${end}: エンティティ "${rel[end]}" は entities に定義されていません`);
      }
    }
    if (!CARDINALITIES.includes(rel.cardinality)) {
      errors.push(`${where}.cardinality: "${rel.cardinality}" は不正です(対応: ${CARDINALITIES.join(', ')})`);
    }
  }
  return errors;
}

function validateScreenFlow(spec) {
  const errors = [];
  if (!Array.isArray(spec.screens) || spec.screens.length === 0) {
    errors.push('screens: 1 件以上の画面が必須です');
    return errors;
  }
  const ids = new Set();
  for (const [i, screen] of spec.screens.entries()) {
    const where = `screens[${i}]`;
    if (screen === null || typeof screen !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    if (typeof screen.id !== 'string' || screen.id.trim() === '') {
      errors.push(`${where}.id: 必須です(空でない文字列)`);
      continue;
    }
    if (ids.has(screen.id)) {
      errors.push(`${where}.id: "${screen.id}" が重複しています`);
    }
    ids.add(screen.id);
    if (screen.kind !== undefined && !['start', 'end'].includes(screen.kind)) {
      errors.push(`${where}(${screen.id}).kind: "${screen.kind}" は不正です(対応: start, end、または省略)`);
    }
  }
  const transitions = spec.transitions ?? [];
  if (!Array.isArray(transitions)) {
    errors.push('transitions: 配列ではありません');
    return errors;
  }
  for (const [i, t] of transitions.entries()) {
    const where = `transitions[${i}]`;
    if (t === null || typeof t !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    for (const end of ['from', 'to']) {
      if (!ids.has(t[end])) {
        errors.push(`${where}.${end}: 画面 "${t[end]}" は screens に定義されていません`);
      }
    }
  }
  return errors;
}

function validateArchitecture(spec) {
  const errors = [];
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    errors.push('nodes: 1 件以上のノードが必須です');
    return errors;
  }
  const nodeIds = new Set();
  for (const [i, node] of spec.nodes.entries()) {
    const where = `nodes[${i}]`;
    if (node === null || typeof node !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    if (typeof node.id !== 'string' || node.id.trim() === '') {
      errors.push(`${where}.id: 必須です(空でない文字列)`);
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`${where}.id: "${node.id}" が重複しています`);
    }
    nodeIds.add(node.id);
  }
  const zones = spec.zones ?? [];
  if (!Array.isArray(zones)) {
    errors.push('zones: 配列ではありません');
    return errors;
  }
  const zoneIds = new Set();
  const assigned = new Set();
  for (const [i, zone] of zones.entries()) {
    const where = `zones[${i}]`;
    if (zone === null || typeof zone !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    if (typeof zone.id !== 'string' || zone.id.trim() === '') {
      errors.push(`${where}.id: 必須です(空でない文字列)`);
      continue;
    }
    if (zoneIds.has(zone.id) || nodeIds.has(zone.id)) {
      errors.push(`${where}.id: "${zone.id}" が重複しています(ゾーン・ノード間で一意であること)`);
    }
    zoneIds.add(zone.id);
    if (!Array.isArray(zone.children) || zone.children.length === 0) {
      errors.push(`${where}(${zone.id}).children: 1 件以上のノード id の配列が必須です`);
      continue;
    }
    for (const [j, childId] of zone.children.entries()) {
      if (!nodeIds.has(childId)) {
        errors.push(`zones(${zone.id}).children[${j}]: ノード "${childId}" は nodes に定義されていません`);
        continue;
      }
      if (assigned.has(childId)) {
        errors.push(`zones(${zone.id}).children[${j}]: ノード "${childId}" は複数のゾーンに属しています`);
      }
      assigned.add(childId);
    }
  }
  const edges = spec.edges ?? [];
  if (!Array.isArray(edges)) {
    errors.push('edges: 配列ではありません');
    return errors;
  }
  for (const [i, edge] of edges.entries()) {
    const where = `edges[${i}]`;
    if (edge === null || typeof edge !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    for (const end of ['from', 'to']) {
      if (!nodeIds.has(edge[end])) {
        errors.push(`${where}.${end}: ノード "${edge[end]}" は nodes に定義されていません`);
      }
    }
  }
  return errors;
}

function validateSequence(spec) {
  const errors = [];
  if (!Array.isArray(spec.actors) || spec.actors.length === 0) {
    errors.push('actors: 1 件以上のアクターが必須です');
    return errors;
  }
  const ids = new Set();
  for (const [i, actor] of spec.actors.entries()) {
    const where = `actors[${i}]`;
    if (actor === null || typeof actor !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    if (typeof actor.id !== 'string' || actor.id.trim() === '') {
      errors.push(`${where}.id: 必須です(空でない文字列)`);
      continue;
    }
    if (ids.has(actor.id)) {
      errors.push(`${where}.id: "${actor.id}" が重複しています`);
    }
    ids.add(actor.id);
  }
  const messages = spec.messages ?? [];
  if (!Array.isArray(messages)) {
    errors.push('messages: 配列ではありません');
    return errors;
  }
  for (const [i, msg] of messages.entries()) {
    const where = `messages[${i}]`;
    if (msg === null || typeof msg !== 'object') {
      errors.push(`${where}: オブジェクトではありません`);
      continue;
    }
    for (const end of ['from', 'to']) {
      if (!ids.has(msg[end])) {
        errors.push(`${where}.${end}: アクター "${msg[end]}" は actors に定義されていません`);
      }
    }
    if (msg.from === msg.to && ids.has(msg.from)) {
      errors.push(`${where}: from と to が同一(自己メッセージ)は未対応です`);
    }
    if (msg.style !== undefined && !['async', 'return'].includes(msg.style)) {
      errors.push(`${where}.style: "${msg.style}" は不正です(対応: async, return、または省略=同期)`);
    }
  }
  return errors;
}
