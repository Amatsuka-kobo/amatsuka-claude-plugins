import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from './lib/validate.mjs';

const validSpec = () => ({
  type: 'er',
  title: '受注管理 ER図',
  entities: [
    {
      name: 'users',
      label: 'ユーザー',
      columns: [
        { name: 'id', type: 'BIGINT', pk: true },
        { name: 'email', type: 'VARCHAR(255)', unique: true },
      ],
    },
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'BIGINT', pk: true },
        { name: 'user_id', type: 'BIGINT', fk: true },
      ],
    },
  ],
  relations: [
    { from: 'users', to: 'orders', cardinality: '1:N', label: '発注する' },
  ],
});

test('妥当な ER spec は空配列を返す', () => {
  assert.deepEqual(validateSpec(validSpec()), []);
});

test('オブジェクトでない spec はエラー', () => {
  assert.equal(validateSpec(null).length, 1);
  assert.equal(validateSpec('x').length, 1);
});

test('未対応の type はエラー', () => {
  const errors = validateSpec({ ...validSpec(), type: 'flowchart' });
  assert.ok(errors.some((e) => e.includes('flowchart')));
});

test('title が無い・空はエラー', () => {
  const spec = validSpec();
  delete spec.title;
  assert.ok(validateSpec(spec).some((e) => e.includes('title')));
  assert.ok(validateSpec({ ...validSpec(), title: '' }).some((e) => e.includes('title')));
});

test('entities が空配列はエラー', () => {
  const errors = validateSpec({ ...validSpec(), entities: [] });
  assert.ok(errors.some((e) => e.includes('entities')));
});

test('エンティティ名の重複はエラー(重複した名前を含むメッセージ)', () => {
  const spec = validSpec();
  spec.entities.push({ name: 'users', columns: [{ name: 'id' }] });
  assert.ok(validateSpec(spec).some((e) => e.includes('users') && e.includes('重複')));
});

test('カラム name が無いエンティティはエラー(エンティティ名を含むメッセージ)', () => {
  const spec = validSpec();
  spec.entities[0].columns.push({ type: 'TEXT' });
  assert.ok(validateSpec(spec).some((e) => e.includes('users')));
});

test('存在しないエンティティへの relation はエラー(参照名を含むメッセージ)', () => {
  const spec = validSpec();
  spec.relations.push({ from: 'users', to: 'products', cardinality: '1:N' });
  assert.ok(validateSpec(spec).some((e) => e.includes('products')));
});

test('不正な cardinality はエラー', () => {
  const spec = validSpec();
  spec.relations[0].cardinality = '1..*';
  assert.ok(validateSpec(spec).some((e) => e.includes('cardinality')));
});

test('relations は省略可', () => {
  const spec = validSpec();
  delete spec.relations;
  assert.deepEqual(validateSpec(spec), []);
});
