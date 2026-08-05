#!/usr/bin/env node

// src/link-sub-issue.ts
import { spawnSync } from "node:child_process";
function fail(step, error) {
  console.log(JSON.stringify({ ok: false, step, error }, null, 2));
  process.exit(0);
}
function parseIssueNumber(raw, label) {
  const n = Number(raw);
  if (!/^\d+$/.test(raw ?? "") || !Number.isInteger(n) || n <= 0) {
    fail("args", `${label} \u306F\u6B63\u306E\u6574\u6570\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044: ${raw ?? "(missing)"}`);
  }
  return n;
}
var [slug, parentArg, childArg] = process.argv.slice(2);
if (!/^[^/\s]+\/[^/\s]+$/.test(slug ?? "")) {
  fail(
    "args",
    `\u30EA\u30DD\u30B8\u30C8\u30EA\u306F owner/repo \u5F62\u5F0F\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044: ${slug ?? "(missing)"}`
  );
}
var parent = parseIssueNumber(parentArg, "\u89AA Issue \u756A\u53F7");
var child = parseIssueNumber(childArg, "\u5B50 Issue \u756A\u53F7");
function gh(...args) {
  const res = spawnSync("gh", args, { encoding: "utf8" });
  if (res.status !== 0) {
    return {
      ok: false,
      error: (res.stderr || res.stdout || String(res.error ?? "gh \u306E\u5B9F\u884C\u306B\u5931\u6557")).trim()
    };
  }
  return { ok: true, stdout: res.stdout };
}
var childRes = gh("api", `repos/${slug}/issues/${child}`);
if (!childRes.ok) fail("get-child", childRes.error);
var childId;
try {
  childId = JSON.parse(childRes.stdout).id;
} catch (e) {
  fail(
    "get-child",
    `\u5B50 Issue \u5FDC\u7B54\u306E JSON \u30D1\u30FC\u30B9\u306B\u5931\u6557: ${e instanceof Error ? e.message : String(e)}`
  );
}
if (!Number.isInteger(childId))
  fail("get-child", `\u5B50 Issue \u306E\u5185\u90E8 ID \u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093: ${childId}`);
var linkRes = gh(
  "api",
  "-X",
  "POST",
  `repos/${slug}/issues/${parent}/sub_issues`,
  "-F",
  `sub_issue_id=${childId}`
);
if (!linkRes.ok) fail("link", linkRes.error);
console.log(
  JSON.stringify({ ok: true, parent, child, subIssueId: childId }, null, 2)
);
