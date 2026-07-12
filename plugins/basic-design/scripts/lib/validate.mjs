export const SUPPORTED_TYPES = ['er'];

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
