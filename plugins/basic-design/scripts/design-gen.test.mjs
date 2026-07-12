import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const CLI = new URL('./design-gen.mjs', import.meta.url).pathname;

const validSpec = {
  type: 'er',
  title: 'テスト ER図',
  entities: [
    { name: 'users', columns: [{ name: 'id', pk: true }] },
    { name: 'orders', columns: [{ name: 'id', pk: true }] },
  ],
  relations: [{ from: 'users', to: 'orders', cardinality: '1:N' }],
};

async function writeSpec(spec, filename = 'sample.spec.json') {
  const dir = await mkdtemp(path.join(tmpdir(), 'design-gen-'));
  const specPath = path.join(dir, filename);
  await writeFile(specPath, JSON.stringify(spec));
  return { dir, specPath };
}

// exit 1 でも stdout の JSON を取り出すヘルパー
async function runCli(args) {
  try {
    const { stdout } = await run('node', [CLI, ...args]);
    return { code: 0, json: JSON.parse(stdout) };
  } catch (err) {
    return { code: err.code, json: JSON.parse(err.stdout) };
  }
}

test('--format both で .drawio と .html が生成される', async () => {
  const { dir, specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath, '--format', 'both']);
  assert.equal(code, 0);
  assert.equal(json.ok, true);
  assert.deepEqual(
    json.files.map((f) => path.basename(f)).sort(),
    ['sample.drawio', 'sample.html'],
  );
  for (const f of json.files) await access(f); // 実在する
  const drawio = await readFile(path.join(dir, 'sample.drawio'), 'utf8');
  assert.ok(drawio.startsWith('<mxfile'));
  const html = await readFile(path.join(dir, 'sample.html'), 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
});

test('--format drawio は .drawio のみ生成する', async () => {
  const { specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath, '--format', 'drawio']);
  assert.equal(code, 0);
  assert.equal(json.files.length, 1);
  assert.ok(json.files[0].endsWith('sample.drawio'));
});

test('.spec.json で終わらないファイル名は .json を外してベース名にする', async () => {
  const { specPath } = await writeSpec(validSpec, 'er-diagram.json');
  const { json } = await runCli([specPath, '--format', 'drawio']);
  assert.ok(json.files[0].endsWith('er-diagram.drawio'));
});

test('不正な spec は ok:false・exit 1・エラー配列を返す', async () => {
  const { specPath } = await writeSpec({ type: 'er', title: 'x', entities: [] });
  const { code, json } = await runCli([specPath, '--format', 'both']);
  assert.equal(code, 1);
  assert.equal(json.ok, false);
  assert.ok(json.errors.length >= 1);
  assert.ok(json.errors.some((e) => e.includes('entities')));
});

test('不正な --format は exit 1', async () => {
  const { specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath, '--format', 'pdf']);
  assert.equal(code, 1);
  assert.ok(json.errors.some((e) => e.includes('pdf')));
});

test('--format に値が無い場合も exit 1', async () => {
  const { specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath, '--format']);
  assert.equal(code, 1);
  assert.equal(json.ok, false);
});

test('--format 省略時は both として動く', async () => {
  const { specPath } = await writeSpec(validSpec);
  const { code, json } = await runCli([specPath]);
  assert.equal(code, 0);
  assert.equal(json.files.length, 2);
});

test('存在しない spec ファイルは exit 1', async () => {
  const { code, json } = await runCli(['/no/such/file.spec.json', '--format', 'both']);
  assert.equal(code, 1);
  assert.equal(json.ok, false);
});

test('JSON として読めない spec ファイルは exit 1', async () => {
  const { dir } = await writeSpec(validSpec);
  const brokenPath = path.join(dir, 'broken.spec.json');
  await writeFile(brokenPath, '{not json');
  const { code, json } = await runCli([brokenPath, '--format', 'both']);
  assert.equal(code, 1);
  assert.equal(json.ok, false);
});

// ---- Stage 2: 3 図種の生成 ----

const flowSpec = {
  type: 'screen-flow',
  title: '画面遷移',
  screens: [
    { id: 'login', label: 'ログイン', kind: 'start' },
    { id: 'home', label: 'ホーム' },
  ],
  transitions: [{ from: 'login', to: 'home', trigger: '成功' }],
};

const archSpec = {
  type: 'architecture',
  title: '構成図',
  zones: [{ id: 'aws', label: 'AWS', children: ['app'] }],
  nodes: [
    { id: 'browser', label: 'ブラウザ' },
    { id: 'app', label: 'App' },
  ],
  edges: [{ from: 'browser', to: 'app', label: 'HTTPS' }],
};

const seqSpec = {
  type: 'sequence',
  title: 'シーケンス',
  actors: [
    { id: 'u', label: 'ユーザー' },
    { id: 'w', label: 'Web' },
  ],
  messages: [
    { from: 'u', to: 'w', label: '要求' },
    { from: 'w', to: 'u', label: '応答', style: 'return' },
  ],
};

for (const [name, spec] of [['screen-flow', flowSpec], ['architecture', archSpec], ['sequence', seqSpec]]) {
  test(`${name}: --format both で 2 ファイル生成される`, async () => {
    const { specPath } = await writeSpec(spec, `${name}.spec.json`);
    const { code, json } = await runCli([specPath, '--format', 'both']);
    assert.equal(code, 0);
    assert.equal(json.ok, true);
    assert.equal(json.files.length, 2);
    const drawio = await readFile(json.files.find((f) => f.endsWith('.drawio')), 'utf8');
    assert.ok(drawio.startsWith('<mxfile'));
    const html = await readFile(json.files.find((f) => f.endsWith('.html')), 'utf8');
    assert.ok(html.startsWith('<!doctype html>'));
  });
}
