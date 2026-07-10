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

test('github.com を含むだけの別ホストでは repoSlug が null', () => {
  assert.equal(runScript(gitRepo('git@notgithub.com:owner/repo.git')).repoSlug, null);
  assert.equal(runScript(gitRepo('https://mygithub.com/owner/repo')).repoSlug, null);
});

// PATH 制御用: 実物の git だけを持つ bin ディレクトリを作る(スクリプトが spawn するのは git と gh のみ)
function fakeBin({ gh } = {}) {
  const dir = tmpdir();
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.symlinkSync(realGit, path.join(dir, 'git'));
  if (gh) {
    const file = path.join(dir, 'gh');
    fs.writeFileSync(file, gh);
    fs.chmodSync(file, 0o755);
  }
  return dir;
}

test('gh が PATH に無ければ ghInstalled/ghAuthenticated とも false', () => {
  const out = runScript(tmpdir(), [fakeBin()]);
  assert.equal(out.ghInstalled, false);
  assert.equal(out.ghAuthenticated, false);
});

test('gh はあるが未認証なら ghInstalled: true, ghAuthenticated: false', () => {
  const bin = fakeBin({ gh: '#!/bin/sh\n[ "$1" = "--version" ] && exit 0\nexit 1\n' });
  const out = runScript(tmpdir(), [bin]);
  assert.equal(out.ghInstalled, true);
  assert.equal(out.ghAuthenticated, false);
});

test('gh があり認証済みなら両方 true', () => {
  const bin = fakeBin({ gh: '#!/bin/sh\nexit 0\n' });
  const out = runScript(tmpdir(), [bin]);
  assert.equal(out.ghInstalled, true);
  assert.equal(out.ghAuthenticated, true);
});

function withTemplates(files) {
  const dir = gitRepo('git@github.com:owner/repo.git');
  const tplDir = path.join(dir, '.github', 'ISSUE_TEMPLATE');
  fs.mkdirSync(tplDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tplDir, name), content);
  }
  return dir;
}

test('テンプレートが無ければ templates は空、blankIssuesEnabled は true', () => {
  const out = runScript(gitRepo('git@github.com:owner/repo.git'));
  assert.deepEqual(out.templates, []);
  assert.equal(out.blankIssuesEnabled, true);
});

test('md テンプレートの frontmatter からトップレベルキーを抽出する', () => {
  const dir = withTemplates({
    'bug_report.md': [
      '---',
      'name: バグ報告',
      'about: 動作不良の報告',
      'title: "[Bug] "',
      'labels: bug, help wanted',
      '---',
      '',
      '## 再現手順',
    ].join('\n'),
  });
  const out = runScript(dir);
  assert.deepEqual(out.templates, [
    {
      file: 'bug_report.md',
      name: 'バグ報告',
      about: '動作不良の報告',
      title: '[Bug] ',
      labels: ['bug', 'help wanted'],
    },
  ]);
});

test('yml フォームは description を about に正規化し、複数行 labels も拾う', () => {
  const dir = withTemplates({
    'feature.yml': [
      'name: 機能要望',
      'description: 新機能の提案',
      'labels:',
      '  - enhancement',
      '  - "needs triage"',
      'body:',
      '  - type: markdown',
      '    attributes:',
      '      value: 説明',
    ].join('\n'),
  });
  const out = runScript(dir);
  assert.equal(out.templates.length, 1);
  assert.equal(out.templates[0].name, '機能要望');
  assert.equal(out.templates[0].about, '新機能の提案');
  assert.deepEqual(out.templates[0].labels, ['enhancement', 'needs triage']);
});

test('inline 配列の labels もパースでき、config.yml は templates に含めない', () => {
  const dir = withTemplates({
    'task.yml': 'name: タスク\nlabels: ["chore", "docs"]\n',
    'config.yml': 'blank_issues_enabled: false\n',
  });
  const out = runScript(dir);
  assert.deepEqual(out.templates.map((t) => t.file), ['task.yml']);
  assert.deepEqual(out.templates[0].labels, ['chore', 'docs']);
  assert.equal(out.blankIssuesEnabled, false);
});

test('サブディレクトリから実行してもリポジトリルートのテンプレートを検出する', () => {
  const dir = withTemplates({ 'bug.md': '---\nname: Bug\n---\n' });
  const sub = path.join(dir, 'src');
  fs.mkdirSync(sub);
  const out = runScript(sub);
  assert.equal(out.templates.length, 1);
  assert.equal(out.templates[0].name, 'Bug');
});

test('読めないエントリ(ディレクトリ等)はスキップして exit 0 を保つ', () => {
  const dir = withTemplates({ 'bug.md': '---\nname: Bug\n---\n' });
  fs.mkdirSync(path.join(dir, '.github', 'ISSUE_TEMPLATE', 'weird.yml'));
  const out = runScript(dir);
  assert.deepEqual(out.templates.map((t) => t.file), ['bug.md']);
});

test('ISSUE_TEMPLATE がディレクトリでなくファイルでも exit 0 でテンプレート無し扱い', () => {
  const dir = gitRepo('git@github.com:owner/repo.git');
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'ISSUE_TEMPLATE'), 'not a directory');
  const out = runScript(dir);
  assert.deepEqual(out.templates, []);
  assert.equal(out.blankIssuesEnabled, true);
});

test('複数テンプレートはファイル名昇順で返る', () => {
  const dir = withTemplates({
    'b_bug.md': '---\nname: Bug\n---\n',
    'a_feature.yml': 'name: Feature\n',
  });
  const out = runScript(dir);
  assert.deepEqual(out.templates.map((t) => t.file), ['a_feature.yml', 'b_bug.md']);
});
