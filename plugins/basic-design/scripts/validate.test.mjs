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

test('relations が配列でない場合はエラー(throw しない)', () => {
  const spec = { ...validSpec(), relations: {} };
  assert.doesNotThrow(() => validateSpec(spec));
  const errors = validateSpec(spec);
  assert.ok(errors.some((e) => e.includes('relations')));
});

test('entities の要素が null の場合はエラー(throw しない)', () => {
  const spec = { ...validSpec(), entities: [null] };
  assert.doesNotThrow(() => validateSpec(spec));
  const errors = validateSpec(spec);
  assert.ok(errors.some((e) => e.includes('entities')));
});

test('columns の要素が null の場合はエラー(throw しない)', () => {
  const spec = validSpec();
  spec.entities[0].columns = [null];
  assert.doesNotThrow(() => validateSpec(spec));
  const errors = validateSpec(spec);
  assert.ok(errors.some((e) => e.includes('columns')));
});

test('relations の要素が null の場合はエラー(throw しない)', () => {
  const spec = validSpec();
  spec.relations = [null];
  assert.doesNotThrow(() => validateSpec(spec));
  const errors = validateSpec(spec);
  assert.ok(errors.some((e) => e.includes('relations')));
});

// ---- Stage 2: screen-flow ----

const validScreenFlow = () => ({
  type: 'screen-flow',
  title: 'EC サイト画面遷移',
  screens: [
    { id: 'login', label: 'ログイン', group: '認証', kind: 'start' },
    { id: 'home', label: 'ホーム' },
    { id: 'done', label: '完了', kind: 'end' },
  ],
  transitions: [
    { from: 'login', to: 'home', trigger: 'ログイン成功' },
    { from: 'home', to: 'done' },
  ],
});

test('screen-flow: 妥当な spec は空配列', () => {
  assert.deepEqual(validateSpec(validScreenFlow()), []);
});

test('screen-flow: screens が空はエラー', () => {
  assert.ok(validateSpec({ ...validScreenFlow(), screens: [] }).some((e) => e.includes('screens')));
});

test('screen-flow: id 重複はエラー', () => {
  const spec = validScreenFlow();
  spec.screens.push({ id: 'login' });
  assert.ok(validateSpec(spec).some((e) => e.includes('login') && e.includes('重複')));
});

test('screen-flow: 不正な kind はエラー', () => {
  const spec = validScreenFlow();
  spec.screens[1].kind = 'middle';
  assert.ok(validateSpec(spec).some((e) => e.includes('kind') && e.includes('middle')));
});

test('screen-flow: 存在しない画面への遷移はエラー', () => {
  const spec = validScreenFlow();
  spec.transitions.push({ from: 'home', to: 'nowhere' });
  assert.ok(validateSpec(spec).some((e) => e.includes('nowhere')));
});

test('screen-flow: transitions 省略可・非配列はエラー', () => {
  const spec = validScreenFlow();
  delete spec.transitions;
  assert.deepEqual(validateSpec(spec), []);
  assert.ok(validateSpec({ ...validScreenFlow(), transitions: {} }).some((e) => e.includes('transitions')));
});

test('screen-flow: null 要素でクラッシュしない', () => {
  const spec = validScreenFlow();
  spec.screens.push(null);
  spec.transitions.push(null);
  const errors = validateSpec(spec);
  assert.ok(errors.length >= 2);
});

// ---- Stage 2: architecture ----

const validArchitecture = () => ({
  type: 'architecture',
  title: 'Web システム構成',
  zones: [{ id: 'aws', label: 'AWS', children: ['alb', 'app', 'db'] }],
  nodes: [
    { id: 'browser', label: 'ブラウザ' },
    { id: 'alb', label: 'ALB' },
    { id: 'app', label: 'App Server', icon: 'server' },
    { id: 'db', label: 'DB' },
  ],
  edges: [
    { from: 'browser', to: 'alb', label: 'HTTPS' },
    { from: 'alb', to: 'app', label: 'HTTP' },
    { from: 'app', to: 'db', label: 'SQL' },
  ],
});

test('architecture: 妥当な spec は空配列', () => {
  assert.deepEqual(validateSpec(validArchitecture()), []);
});

test('architecture: nodes が空はエラー', () => {
  assert.ok(validateSpec({ ...validArchitecture(), nodes: [] }).some((e) => e.includes('nodes')));
});

test('architecture: zone の children が未定義ノードを指すとエラー', () => {
  const spec = validArchitecture();
  spec.zones[0].children.push('ghost');
  assert.ok(validateSpec(spec).some((e) => e.includes('ghost')));
});

test('architecture: ノードが複数ゾーンに属するとエラー', () => {
  const spec = validArchitecture();
  spec.zones.push({ id: 'backup', label: 'Backup', children: ['db'] });
  assert.ok(validateSpec(spec).some((e) => e.includes('db') && e.includes('複数')));
});

test('architecture: zone id とノード id の衝突はエラー', () => {
  const spec = validArchitecture();
  spec.zones.push({ id: 'db', label: 'x', children: ['alb'] });
  const errors = validateSpec(spec);
  assert.ok(errors.some((e) => e.includes('"db"') && e.includes('重複')));
});

test('architecture: 存在しないノードへの edge はエラー', () => {
  const spec = validArchitecture();
  spec.edges.push({ from: 'app', to: 'cache' });
  assert.ok(validateSpec(spec).some((e) => e.includes('cache')));
});

test('architecture: zones / edges 省略可', () => {
  const spec = validArchitecture();
  delete spec.zones;
  delete spec.edges;
  assert.deepEqual(validateSpec(spec), []);
});

// ---- Stage 2: sequence ----

const validSequence = () => ({
  type: 'sequence',
  title: 'ログイン処理',
  actors: [
    { id: 'user', label: 'ユーザー', kind: 'actor' },
    { id: 'web', label: 'Web' },
    { id: 'db', label: 'DB' },
  ],
  messages: [
    { from: 'user', to: 'web', label: 'ログイン要求' },
    { from: 'web', to: 'db', label: '照会', style: 'async' },
    { from: 'db', to: 'web', label: '結果', style: 'return' },
  ],
});

test('sequence: 妥当な spec は空配列', () => {
  assert.deepEqual(validateSpec(validSequence()), []);
});

test('sequence: actors が空はエラー', () => {
  assert.ok(validateSpec({ ...validSequence(), actors: [] }).some((e) => e.includes('actors')));
});

test('sequence: 未定義アクターへのメッセージはエラー', () => {
  const spec = validSequence();
  spec.messages.push({ from: 'web', to: 'mail' });
  assert.ok(validateSpec(spec).some((e) => e.includes('mail')));
});

test('sequence: 自己メッセージはエラー(未対応の明示)', () => {
  const spec = validSequence();
  spec.messages.push({ from: 'web', to: 'web', label: '内部処理' });
  assert.ok(validateSpec(spec).some((e) => e.includes('自己メッセージ')));
});

test('sequence: 不正な style はエラー', () => {
  const spec = validSequence();
  spec.messages[0].style = 'dashed';
  assert.ok(validateSpec(spec).some((e) => e.includes('style') && e.includes('dashed')));
});
