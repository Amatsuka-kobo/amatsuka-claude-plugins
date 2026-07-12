#!/usr/bin/env node
// open Issue の一覧・既存ラベル・現在のログインユーザーを gh で取得し、JSON で stdout に出力する。
// stale 判定(最終更新からの経過日数が閾値を超えたか。既定 90 日)もここで機械的に行う。
// PR は除外する(GitHub の issues API は PR も返すため pull_request キーで弾く)。
// 判断(STOP・提案の組み立て)はスキル側が行い、このスクリプトは常に exit 0。
// 使い方: node list-issues.mjs [--stale-days N] [--now <ISO8601>(テスト用)]
import { spawnSync } from 'node:child_process';

function fail(step, error) {
  console.log(JSON.stringify({ ok: false, step, error }, null, 2));
  process.exit(0);
}

const args = process.argv.slice(2);
let staleDaysThreshold = 90;
let now = Date.now();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--stale-days') {
    const v = args[++i];
    if (!/^\d+$/.test(v ?? '')) fail('args', `--stale-days は正の整数で指定してください: ${v ?? '(missing)'}`);
    staleDaysThreshold = Number(v);
  } else if (args[i] === '--now') {
    const t = Date.parse(args[++i] ?? '');
    if (Number.isNaN(t)) fail('args', '--now は ISO 8601 形式で指定してください');
    now = t;
  } else {
    fail('args', `不明な引数: ${args[i]}`);
  }
}

// gh 未インストール時、spawnSync は ENOENT で status: null を返す(例外は投げない)
function gh(...a) {
  const res = spawnSync('gh', a, { encoding: 'utf8' });
  if (res.status !== 0) {
    return { ok: false, error: (res.stderr || res.stdout || String(res.error ?? 'gh の実行に失敗')).trim() };
  }
  return { ok: true, stdout: res.stdout };
}

// --paginate はページごとの JSON 配列を連結して出力するため、][ をカンマに置換して 1 配列に戻す
function parsePaginated(stdout, step) {
  try {
    return JSON.parse(stdout.trim().replace(/\]\s*\[/g, ','));
  } catch (e) {
    fail(step, `JSON パースに失敗: ${e.message}`);
  }
}

const userRes = gh('api', 'user');
if (!userRes.ok) fail('user', userRes.error);
let currentLogin;
try {
  currentLogin = JSON.parse(userRes.stdout).login;
} catch (e) {
  fail('user', `JSON パースに失敗: ${e.message}`);
}

const issuesRes = gh('api', '--paginate', 'repos/{owner}/{repo}/issues?state=open&per_page=100');
if (!issuesRes.ok) fail('issues', issuesRes.error);
const rawIssues = parsePaginated(issuesRes.stdout, 'issues');

const labelsRes = gh('api', '--paginate', 'repos/{owner}/{repo}/labels?per_page=100');
if (!labelsRes.ok) fail('labels', labelsRes.error);
const rawLabels = parsePaginated(labelsRes.stdout, 'labels');

const DAY = 24 * 60 * 60 * 1000;
const issues = rawIssues
  .filter((i) => !i.pull_request)
  .map((i) => {
    const staleDays = Math.floor((now - Date.parse(i.updated_at)) / DAY);
    return {
      number: i.number,
      title: i.title,
      body: (i.body ?? '').slice(0, 500),
      labels: (i.labels ?? []).map((l) => l.name),
      assignees: (i.assignees ?? []).map((a) => a.login),
      author: i.user?.login ?? null,
      updatedAt: i.updated_at,
      commentsCount: i.comments ?? 0,
      staleDays,
      stale: staleDays > staleDaysThreshold,
    };
  });

const labels = rawLabels.map((l) => ({ name: l.name, description: l.description ?? '' }));

console.log(JSON.stringify({ ok: true, currentLogin, staleDaysThreshold, issues, labels }, null, 2));
