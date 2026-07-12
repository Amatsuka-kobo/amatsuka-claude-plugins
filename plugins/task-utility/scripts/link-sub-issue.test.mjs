import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'link-sub-issue.mjs');

// スクリプトを起動し stdout の JSON を返す。binDir 指定時は PATH をそのディレクトリだけに差し替える(gh モック用)
function runScript(args, binDir) {
  const env = binDir ? { ...process.env, PATH: binDir } : process.env;
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
  assert.equal(res.status, 0, `exit 0 であること: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'link-sub-'));
}

// 渡した行を gh として置いた bin ディレクトリを作る。行中の __DIR__ は実ディレクトリに展開する
// (PATH をこのディレクトリだけに差し替えるため、dirname 等の外部コマンドはモック内で使えない)
function fakeGh(scriptLines) {
  const dir = tmpdir();
  const file = path.join(dir, 'gh');
  fs.writeFileSync(file, scriptLines.join('\n').replaceAll('__DIR__', dir) + '\n');
  fs.chmodSync(file, 0o755);
  return dir;
}

test('引数なしでは ok: false / step: args(exit 0)', () => {
  const out = runScript([]);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'args');
});

test('スラッグ形式でないリポジトリ指定は args エラー', () => {
  const out = runScript(['not-a-slug', '1', '2']);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'args');
});

test('Issue 番号が正の整数でなければ args エラー', () => {
  assert.equal(runScript(['o/r', 'abc', '2']).step, 'args');
  assert.equal(runScript(['o/r', '1', '-5']).step, 'args');
  assert.equal(runScript(['o/r', '1.5', '2']).step, 'args');
});

test('gh が PATH に無ければ step: get-child の失敗として返る', () => {
  const out = runScript(['o/r', '1', '2'], tmpdir()); // 空ディレクトリ = gh なし
  assert.equal(out.ok, false);
  assert.equal(out.step, 'get-child');
});

test('正常系: 子の内部 ID を取得し、-F sub_issue_id=<ID> で親に POST する', () => {
  const dir = fakeGh([
    '#!/bin/sh',
    'echo "$@" >> "__DIR__/calls.log"',
    'case "$*" in',
    '  "api repos/o/r/issues/12") echo \'{"id": 999888, "number": 12}\' ;;',
    '  *sub_issues*) echo \'{}\' ;;',
    '  *) exit 1 ;;',
    'esac',
  ]);
  const out = runScript(['o/r', '5', '12'], dir);
  assert.deepEqual(out, { ok: true, parent: 5, child: 12, subIssueId: 999888 });
  const calls = fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n');
  assert.equal(calls[0], 'api repos/o/r/issues/12');
  assert.equal(calls[1], 'api -X POST repos/o/r/issues/5/sub_issues -F sub_issue_id=999888');
});

test('子 Issue の取得が失敗したら step: get-child で stderr を返す', () => {
  const dir = fakeGh(['#!/bin/sh', 'echo "Not Found (HTTP 404)" >&2', 'exit 1']);
  const out = runScript(['o/r', '5', '999'], dir);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'get-child');
  assert.match(out.error, /Not Found/);
});

test('リンク POST が失敗したら step: link で stderr を返す', () => {
  const dir = fakeGh([
    '#!/bin/sh',
    'case "$*" in',
    '  "api repos/o/r/issues/12") echo \'{"id": 999888}\' ;;',
    '  *) echo "sub-issues not supported (HTTP 404)" >&2; exit 1 ;;',
    'esac',
  ]);
  const out = runScript(['o/r', '5', '12'], dir);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'link');
  assert.match(out.error, /not supported/);
});

test('子 Issue の JSON が壊れていたら step: get-child のパース失敗として返る', () => {
  const dir = fakeGh(['#!/bin/sh', 'echo "not json"']);
  const out = runScript(['o/r', '5', '12'], dir);
  assert.equal(out.ok, false);
  assert.equal(out.step, 'get-child');
});
