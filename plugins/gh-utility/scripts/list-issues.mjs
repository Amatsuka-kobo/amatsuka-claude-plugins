#!/usr/bin/env node

// src/list-issues.ts
import { spawnSync } from "node:child_process";
function fail(step, error) {
  console.log(JSON.stringify({ ok: false, step, error }, null, 2));
  process.exit(0);
}
var args = process.argv.slice(2);
var staleDaysThreshold = 90;
var now = Date.now();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--stale-days") {
    const v = args[++i];
    if (!/^\d+$/.test(v ?? ""))
      fail(
        "args",
        `--stale-days \u306F\u6B63\u306E\u6574\u6570\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044: ${v ?? "(missing)"}`
      );
    staleDaysThreshold = Number(v);
  } else if (args[i] === "--now") {
    const t = Date.parse(args[++i] ?? "");
    if (Number.isNaN(t))
      fail("args", "--now \u306F ISO 8601 \u5F62\u5F0F\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044");
    now = t;
  } else {
    fail("args", `\u4E0D\u660E\u306A\u5F15\u6570: ${args[i]}`);
  }
}
function gh(...a) {
  const res = spawnSync("gh", a, { encoding: "utf8" });
  if (res.status !== 0) {
    return {
      ok: false,
      error: (res.stderr || res.stdout || String(res.error ?? "gh \u306E\u5B9F\u884C\u306B\u5931\u6557")).trim()
    };
  }
  return { ok: true, stdout: res.stdout };
}
function parsePaginated(stdout, step) {
  try {
    return JSON.parse(stdout.trim()).flat();
  } catch (e) {
    fail(
      step,
      `JSON \u30D1\u30FC\u30B9\u306B\u5931\u6557: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
var userRes = gh("api", "user");
if (!userRes.ok) fail("user", userRes.error);
var currentLogin;
try {
  currentLogin = JSON.parse(userRes.stdout).login;
} catch (e) {
  fail(
    "user",
    `JSON \u30D1\u30FC\u30B9\u306B\u5931\u6557: ${e instanceof Error ? e.message : String(e)}`
  );
}
var issuesRes = gh(
  "api",
  "--paginate",
  "--slurp",
  "repos/{owner}/{repo}/issues?state=open&per_page=100"
);
if (!issuesRes.ok) fail("issues", issuesRes.error);
var rawIssues = parsePaginated(issuesRes.stdout, "issues");
var labelsRes = gh(
  "api",
  "--paginate",
  "--slurp",
  "repos/{owner}/{repo}/labels?per_page=100"
);
if (!labelsRes.ok) fail("labels", labelsRes.error);
var rawLabels = parsePaginated(labelsRes.stdout, "labels");
var DAY = 24 * 60 * 60 * 1e3;
var issues = rawIssues.filter((i) => !i.pull_request).map((i) => {
  const staleDays = Math.floor((now - Date.parse(i.updated_at)) / DAY);
  return {
    number: i.number,
    title: i.title,
    body: (i.body ?? "").slice(0, 500),
    labels: (i.labels ?? []).map((l) => l.name),
    assignees: (i.assignees ?? []).map((a) => a.login),
    author: i.user?.login ?? null,
    updatedAt: i.updated_at,
    commentsCount: i.comments ?? 0,
    staleDays,
    stale: staleDays > staleDaysThreshold
  };
});
var labels = rawLabels.map((l) => ({
  name: l.name,
  description: l.description ?? ""
}));
console.log(
  JSON.stringify(
    { ok: true, currentLogin, staleDaysThreshold, issues, labels },
    null,
    2
  )
);
