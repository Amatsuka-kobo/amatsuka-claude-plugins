#!/usr/bin/env node

// src/check-issue-env.ts
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
var cwd = process.argv[2] ?? process.cwd();
function git(...args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}
var isGitRepo = git("rev-parse", "--is-inside-work-tree") === "true";
var remoteUrl = isGitRepo ? git("remote", "get-url", "origin") : null;
var repoSlug = remoteUrl?.match(
  /^(?:git@|ssh:\/\/git@|https?:\/\/)github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/
)?.[1] ?? null;
var ghInstalled = spawnSync("gh", ["--version"], { encoding: "utf8" }).status === 0;
var ghAuthenticated = ghInstalled && spawnSync("gh", ["auth", "status"], { encoding: "utf8" }).status === 0;
var repoRoot = isGitRepo ? git("rev-parse", "--show-toplevel") : null;
var tplDir = repoRoot ? path.join(repoRoot, ".github", "ISSUE_TEMPLATE") : null;
var unquote = (v) => v.replace(/^(["'])(.*)\1$/, "$2");
function parseTopLevel(src) {
  const top = {};
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (!value) {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        items.push(lines[++i].replace(/^\s+-\s+/, "").trim());
      }
      value = items.join(",");
    }
    top[m[1]] = value;
  }
  return top;
}
function parseTemplate(file, content) {
  let src = content;
  if (file.endsWith(".md")) {
    src = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  }
  const top = parseTopLevel(src);
  const labelsRaw = top.labels?.match(/^\[(.*)\]$/)?.[1] ?? top.labels ?? "";
  return {
    file,
    name: unquote(top.name ?? ""),
    about: unquote(top.description ?? top.about ?? ""),
    title: unquote(top.title ?? ""),
    labels: labelsRaw.split(",").map((s) => unquote(s.trim())).filter(Boolean)
  };
}
var templates = [];
var blankIssuesEnabled = true;
if (tplDir) {
  let files = [];
  try {
    files = fs.readdirSync(tplDir).sort();
  } catch {
  }
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(tplDir, f), "utf8");
    } catch {
      return null;
    }
  };
  templates = files.filter((f) => /\.(md|ya?ml)$/.test(f) && f !== "config.yml").map((f) => ({ f, content: read(f) })).filter(
    (entry) => entry.content !== null
  ).map(({ f, content }) => parseTemplate(f, content));
  const configRaw = files.includes("config.yml") ? read("config.yml") : null;
  if (configRaw !== null) {
    const config = parseTopLevel(configRaw);
    if (config.blank_issues_enabled !== void 0) {
      blankIssuesEnabled = config.blank_issues_enabled !== "false";
    }
  }
}
console.log(
  JSON.stringify(
    {
      isGitRepo,
      remoteUrl,
      repoSlug,
      ghInstalled,
      ghAuthenticated,
      templates,
      blankIssuesEnabled
    },
    null,
    2
  )
);
