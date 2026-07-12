import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'find-chat-records.mjs');

function runScript(args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(res.status, 0, `exit 0 であること: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

// docs/chat/ のフィクスチャを組み立てる。files は { 'YYYY/MMDD/user/name.md': '内容' } 形式
function fixture(files, index) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-chat-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, 'docs', 'chat', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  if (index !== undefined) fs.writeFileSync(path.join(dir, 'docs', 'chat', 'INDEX.md'), index);
  return dir;
}

test('docs/chat が無ければ ok: false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-chat-'));
  const out = runScript(['--dir', dir, 'keyword']);
  assert.equal(out.ok, false);
});

test('キーワードも --latest も無ければ ok: false', () => {
  const dir = fixture({});
  assert.equal(runScript(['--dir', dir]).ok, false);
});

test('--since の形式が不正なら ok: false', () => {
  const dir = fixture({});
  assert.equal(runScript(['--dir', dir, '--since', '0712', 'x']).ok, false);
});

test('--latest: 日付降順で N 件、タイトルと user を返す(旧構造は user: null)', () => {
  const dir = fixture({
    '2025/1231/alice/year-end.md': '# 年末作業\n本文',
    '2026/0101/alice/new-year.md': '# 年始作業\n本文',
    '2026/0301/old-style.md': '# 旧構造の記録\n本文',
  });
  const out = runScript(['--dir', dir, '--latest', '2']);
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'latest');
  assert.deepEqual(
    out.hits.map((h) => h.path),
    ['2026/0301/old-style.md', '2026/0101/alice/new-year.md'],
  );
  assert.equal(out.hits[0].user, null);
  assert.equal(out.hits[0].title, '旧構造の記録');
  assert.equal(out.hits[1].date, '2026-01-01');
});

test('--latest: N 省略時は 3 件', () => {
  const dir = fixture({
    '2026/0101/a/1.md': '# 一\n',
    '2026/0102/a/2.md': '# 二\n',
    '2026/0103/a/3.md': '# 三\n',
    '2026/0104/a/4.md': '# 四\n',
  });
  assert.equal(runScript(['--dir', dir, '--latest']).hits.length, 3);
});

test('--latest: 同日内は mtime 降順', () => {
  const dir = fixture({
    '2026/0101/alice/first.md': '# 一\n',
    '2026/0101/alice/second.md': '# 二\n',
  });
  const atime = new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(path.join(dir, 'docs/chat/2026/0101/alice/first.md'), atime, new Date('2026-01-01T10:00:00Z'));
  fs.utimesSync(path.join(dir, 'docs/chat/2026/0101/alice/second.md'), atime, new Date('2026-01-01T12:00:00Z'));
  const out = runScript(['--dir', dir, '--latest', '2']);
  assert.deepEqual(out.hits.map((h) => h.title), ['二', '一']);
});

test('--user に空文字を指定すると ok: false(git config user.name 未設定を想定)', () => {
  const dir = fixture({ '2026/0101/alice/a.md': '# A\n' });
  const out = runScript(['--dir', dir, '--latest', '--user', '']);
  assert.equal(out.ok, false);
});

test('--latest --user: 指定ユーザーの記録だけを返す', () => {
  const dir = fixture({
    '2026/0101/alice/a.md': '# A\n',
    '2026/0102/bob/b.md': '# B\n',
  });
  const out = runScript(['--dir', dir, '--latest', '--user', 'alice']);
  assert.deepEqual(out.hits.map((h) => h.path), ['2026/0101/alice/a.md']);
});

test('INDEX.md が無ければ grep モード: マッチ行と前後文脈・タイトルを返す', () => {
  const dir = fixture({
    '2026/0101/alice/design.md': '# 設計セッション\n前の行\nストリーミング方式を採用\n次の行',
    '2026/0102/alice/other.md': '# 別件\n無関係な内容',
  });
  const out = runScript(['--dir', dir, 'ストリーミング']);
  assert.equal(out.mode, 'grep');
  assert.equal(out.hits.length, 1);
  assert.equal(out.hits[0].path, '2026/0101/alice/design.md');
  assert.equal(out.hits[0].title, '設計セッション');
  assert.match(out.hits[0].matches[0], /前の行\nストリーミング方式を採用\n次の行/);
});

test('キーワードは大文字小文字を区別せず、複数キーワードは OR で解釈する', () => {
  const dir = fixture({
    '2026/0101/alice/a.md': '# A\nCSV Export の件',
    '2026/0102/alice/b.md': '# B\nストリーミングの件',
  });
  const out = runScript(['--dir', dir, 'csv', 'ストリーミング']);
  assert.equal(out.hits.length, 2);
});

test('INDEX.md があれば index モード: 索引行から検索し、要旨を title に載せ、索引に無いファイルを unindexed で返す', () => {
  const dir = fixture(
    {
      '2026/0101/alice/design.md': '# 設計\nストリーミングの話',
      '2026/0102/alice/extra.md': '# 未索引\n',
    },
    '# Chat Records Index\n\n- `2026/0101/alice/design.md` | 2026-01-01 | alice | CSV エクスポートの設計\n',
  );
  const out = runScript(['--dir', dir, 'エクスポート']);
  assert.equal(out.mode, 'index');
  assert.deepEqual(out.hits.map((h) => h.path), ['2026/0101/alice/design.md']);
  assert.equal(out.hits[0].title, 'CSV エクスポートの設計');
  assert.deepEqual(out.unindexed, ['2026/0102/alice/extra.md']);
});

test('index モードでは本文だけに現れる語はヒットしない(検索対象は索引行)', () => {
  const dir = fixture(
    { '2026/0101/alice/design.md': '# 設計\nストリーミングの話' },
    '# Chat Records Index\n\n- `2026/0101/alice/design.md` | 2026-01-01 | alice | CSV エクスポートの設計\n',
  );
  assert.equal(runScript(['--dir', dir, 'ストリーミング']).hits.length, 0);
});

test('--since: 指定日より前の記録を除外する(grep モード)', () => {
  const dir = fixture({
    '2026/0101/alice/a.md': '# A\nキーワード x',
    '2026/0301/alice/b.md': '# B\nキーワード x',
  });
  const out = runScript(['--dir', dir, '--since', '2026-02-01', 'キーワード']);
  assert.deepEqual(out.hits.map((h) => h.path), ['2026/0301/alice/b.md']);
});

test('--latest でも unindexed を返す(INDEX.md 不在時は全記録が unindexed)', () => {
  const dir = fixture({ '2026/0101/alice/a.md': '# A\n' });
  const out = runScript(['--dir', dir, '--latest']);
  assert.deepEqual(out.unindexed, ['2026/0101/alice/a.md']);
});

test('読めないファイル(chmod 000)があっても exit 0 で JSON を返し、そのファイルはヒットから外れる(grep モード)', {
  skip: process.getuid && process.getuid() === 0 ? 'root は権限を無視するためスキップ' : false,
}, () => {
  const dir = fixture({
    '2026/0101/alice/readable.md': '# 読める記録\nキーワード x',
    '2026/0102/alice/trap.md': '# 読めない記録\nキーワード x',
  });
  const trapPath = path.join(dir, 'docs/chat/2026/0102/alice/trap.md');
  fs.chmodSync(trapPath, 0o000);
  try {
    const out = runScript(['--dir', dir, 'キーワード']);
    assert.equal(out.ok, true);
    assert.equal(out.mode, 'grep');
    assert.deepEqual(out.hits.map((h) => h.path), ['2026/0101/alice/readable.md']);
  } finally {
    fs.chmodSync(trapPath, 0o644); // 後片付け(mkdtemp ディレクトリの削除に支障が出ないように)
  }
});

test('INDEX.md が読めない(ディレクトリ)場合も grep モードにフォールバックし exit 0 で JSON を返す', () => {
  const dir = fixture({
    '2026/0101/alice/design.md': '# 設計セッション\nストリーミング方式を採用',
  });
  fs.mkdirSync(path.join(dir, 'docs', 'chat', 'INDEX.md'));
  const out = runScript(['--dir', dir, 'ストリーミング']);
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'grep');
  assert.deepEqual(out.hits.map((h) => h.path), ['2026/0101/alice/design.md']);
});
