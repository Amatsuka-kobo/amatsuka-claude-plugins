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

// SSH (git@github.com:owner/repo.git) と HTTPS (https://github.com/owner/repo) の両形式に対応
const repoSlug = remoteUrl?.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null;

console.log(JSON.stringify({ isGitRepo, remoteUrl, repoSlug }, null, 2));
