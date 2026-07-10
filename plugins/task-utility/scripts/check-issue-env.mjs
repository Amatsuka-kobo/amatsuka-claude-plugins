#!/usr/bin/env node
// GitHub Issue 起票に必要な環境の事実(git リポジトリ・リモート・gh・Issue テンプレート)を
// JSON で stdout に出力する。判断(STOP するか等)はスキル側が行い、このスクリプトは常に exit 0。
// issue-craft スキル専用ではなく、Issue 系スキル共通の前提チェックとして使う。
// 使い方: node check-issue-env.mjs [projectDir]
import { spawnSync } from 'node:child_process';

const cwd = process.argv[2] ?? process.cwd();

function git(...args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

const isGitRepo = git('rev-parse', '--is-inside-work-tree') === 'true';
const remoteUrl = isGitRepo ? git('remote', 'get-url', 'origin') : null;

// SSH (git@github.com:owner/repo.git) と HTTPS (https://github.com/owner/repo) の両形式に対応。
// ホスト名は github.com 完全一致(notgithub.com 等の部分一致を弾く)
const repoSlug =
  remoteUrl?.match(/^(?:git@|ssh:\/\/git@|https?:\/\/)github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null;

// gh 未インストール時、spawnSync は ENOENT で status: null を返す(例外は投げない)
const ghInstalled = spawnSync('gh', ['--version'], { encoding: 'utf8' }).status === 0;
const ghAuthenticated =
  ghInstalled && spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0;

console.log(JSON.stringify({ isGitRepo, remoteUrl, repoSlug, ghInstalled, ghAuthenticated }, null, 2));
