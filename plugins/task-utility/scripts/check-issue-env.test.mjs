import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-issue-env.mjs');

// スクリプトを起動し stdout の JSON を返す。pathDirs 指定時は PATH を差し替える(gh 検出テスト用)
function runScript(cwd, pathDirs) {
  const env = pathDirs
    ? { ...process.env, PATH: pathDirs.join(path.delimiter) }
    : process.env;
  const res = spawnSync(process.execPath, [SCRIPT, cwd], { encoding: 'utf8', env });
  assert.equal(res.status, 0, `exit 0 であること: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue-env-'));
}

function gitRepo(remoteUrl) {
  const dir = tmpdir();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remoteUrl) execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir });
  return dir;
}

test('git リポジトリでないディレクトリでは isGitRepo: false', () => {
  const out = runScript(tmpdir());
  assert.equal(out.isGitRepo, false);
  assert.equal(out.remoteUrl, null);
  assert.equal(out.repoSlug, null);
});

test('リモート未設定の git リポジトリでは remoteUrl/repoSlug が null', () => {
  const out = runScript(gitRepo(null));
  assert.equal(out.isGitRepo, true);
  assert.equal(out.remoteUrl, null);
  assert.equal(out.repoSlug, null);
});

test('GitHub SSH リモートから repoSlug を抽出する', () => {
  const out = runScript(gitRepo('git@github.com:owner/my-repo.git'));
  assert.equal(out.remoteUrl, 'git@github.com:owner/my-repo.git');
  assert.equal(out.repoSlug, 'owner/my-repo');
});

test('GitHub HTTPS リモート(.git なし)から repoSlug を抽出する', () => {
  const out = runScript(gitRepo('https://github.com/owner/my-repo'));
  assert.equal(out.repoSlug, 'owner/my-repo');
});

test('GitHub 以外のリモートでは repoSlug が null', () => {
  const out = runScript(gitRepo('git@gitlab.com:owner/repo.git'));
  assert.equal(out.remoteUrl, 'git@gitlab.com:owner/repo.git');
  assert.equal(out.repoSlug, null);
});
