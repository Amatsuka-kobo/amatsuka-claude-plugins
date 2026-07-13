import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const CLI = new URL('./check-drive-config.mjs', import.meta.url).pathname;

async function makeProject(localMd) {
  const dir = await mkdtemp(path.join(tmpdir(), 'drive-config-'));
  if (localMd !== null) {
    await mkdir(path.join(dir, '.claude'), { recursive: true });
    await writeFile(path.join(dir, '.claude', 'basic-design.local.md'), localMd);
  }
  return dir;
}

async function runCli(dir) {
  const { stdout } = await run('node', [CLI, dir]);
  return JSON.parse(stdout);
}

test('設定ファイルに drive_folder_id があれば configured:true と ID を返す', async () => {
  const dir = await makeProject('---\ndrive_folder_id: "1AbCdEfGh"\n---\n\nメモ\n');
  assert.deepEqual(await runCli(dir), { configured: true, driveFolderId: '1AbCdEfGh' });
});

test('シングルクォート・引用符なしも受け付ける', async () => {
  const single = await makeProject("---\ndrive_folder_id: '1XyZ'\n---\n");
  assert.deepEqual(await runCli(single), { configured: true, driveFolderId: '1XyZ' });
  const bare = await makeProject('---\ndrive_folder_id: 1Bare123\n---\n');
  assert.deepEqual(await runCli(bare), { configured: true, driveFolderId: '1Bare123' });
});

test('ファイルが無ければ configured:false(exit 0)', async () => {
  const dir = await makeProject(null);
  assert.deepEqual(await runCli(dir), { configured: false, driveFolderId: null });
});

test('frontmatter が無い・キーが無い・値が空なら configured:false', async () => {
  const noFm = await makeProject('ただのメモ\n');
  assert.deepEqual(await runCli(noFm), { configured: false, driveFolderId: null });
  const noKey = await makeProject('---\nother_key: x\n---\n');
  assert.deepEqual(await runCli(noKey), { configured: false, driveFolderId: null });
  const empty = await makeProject('---\ndrive_folder_id: ""\n---\n');
  assert.deepEqual(await runCli(empty), { configured: false, driveFolderId: null });
});

test('frontmatter の外にあるキーは無視する', async () => {
  const dir = await makeProject('---\ntitle: x\n---\n\ndrive_folder_id: "1Outside"\n');
  assert.deepEqual(await runCli(dir), { configured: false, driveFolderId: null });
});

test('引数省略時はカレントディレクトリを使う', async () => {
  const dir = await makeProject('---\ndrive_folder_id: "1Cwd"\n---\n');
  const { stdout } = await run('node', [CLI], { cwd: dir });
  assert.deepEqual(JSON.parse(stdout), { configured: true, driveFolderId: '1Cwd' });
});

test('引用符付きの値に行末コメントが付いても正しく剥がす', async () => {
  const dir = await makeProject('---\ndrive_folder_id: "1AbC"   # フォルダ URL 末尾の ID\n---\n');
  assert.deepEqual(await runCli(dir), { configured: true, driveFolderId: '1AbC' });
});

test('CRLF 改行のファイルも読める', async () => {
  const dir = await makeProject('---\r\ndrive_folder_id: "1Crlf"\r\n---\r\n');
  assert.deepEqual(await runCli(dir), { configured: true, driveFolderId: '1Crlf' });
});

test('UTF-8 BOM 付きのファイルも読める', async () => {
  const dir = await makeProject('\uFEFF---\ndrive_folder_id: "1Bom"\n---\n');
  assert.deepEqual(await runCli(dir), { configured: true, driveFolderId: '1Bom' });
});
