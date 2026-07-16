#!/usr/bin/env node

// src/hooks/capture-subagent-stop.ts
import path6 from "node:path";

// src/lib/git.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
function git(projectDir2, args, env) {
  return execFileSync("git", args, {
    cwd: projectDir2,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...env }
  });
}
function snapshotWorktree(projectDir2) {
  const tmpIndex = path.join(
    os.tmpdir(),
    `pitcrew-index-${process.pid}-${Date.now()}`
  );
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      git(projectDir2, ["read-tree", "HEAD"], env);
    } catch {
      git(projectDir2, ["read-tree", "--empty"], env);
    }
    git(projectDir2, ["add", "-A", "--", ".", ":!.pitcrew"], env);
    return git(projectDir2, ["write-tree"], env).trim();
  } catch {
    return null;
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
}
function diffBetween(projectDir2, baseTree, headTree) {
  const diff = git(projectDir2, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    baseTree,
    headTree
  ]);
  const nameOnly = git(projectDir2, ["diff", "--name-only", baseTree, headTree]);
  return {
    diff,
    paths: nameOnly.split("\n").filter((p) => p.trim() !== "")
  };
}
function baselineTree(projectDir2) {
  try {
    return git(projectDir2, ["rev-parse", "HEAD^{tree}"]).trim();
  } catch {
    try {
      return git(projectDir2, ["hash-object", "-t", "tree", "/dev/null"]).trim();
    } catch {
      return null;
    }
  }
}

// src/lib/hook-io.ts
import fs4 from "node:fs";
import path4 from "node:path";

// src/lib/run.ts
import fs3 from "node:fs";
import path3 from "node:path";

// src/lib/atomic.ts
import crypto from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
function writeFileAtomic(filePath, content) {
  const dir = path2.dirname(filePath);
  fs2.mkdirSync(dir, { recursive: true });
  const tmp = path2.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  );
  fs2.writeFileSync(tmp, content);
  fs2.renameSync(tmp, filePath);
}

// src/lib/run.ts
function pitcrewDir(projectDir2) {
  return path3.join(projectDir2, ".pitcrew");
}
function initialRun() {
  return {
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastCaptureCommit: null,
    lastCaptureAt: null,
    nextReviewId: 1
  };
}
function loadRun(projectDir2) {
  const file = path3.join(pitcrewDir(projectDir2), "run.json");
  let raw;
  try {
    raw = fs3.readFileSync(file, "utf8");
  } catch {
    return initialRun();
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || typeof parsed.nextReviewId !== "number" || !Number.isInteger(parsed.nextReviewId) || parsed.nextReviewId < 1)
      return initialRun();
    return {
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : (/* @__PURE__ */ new Date()).toISOString(),
      lastCaptureCommit: typeof parsed.lastCaptureCommit === "string" ? parsed.lastCaptureCommit : null,
      lastCaptureAt: typeof parsed.lastCaptureAt === "string" ? parsed.lastCaptureAt : null,
      nextReviewId: parsed.nextReviewId,
      ...typeof parsed.phase === "string" ? { phase: parsed.phase } : {}
    };
  } catch {
    return initialRun();
  }
}
function saveRun(projectDir2, run) {
  writeFileAtomic(
    path3.join(pitcrewDir(projectDir2), "run.json"),
    `${JSON.stringify(run, null, 2)}
`
  );
}

// src/lib/hook-io.ts
function readStdinSync() {
  try {
    return JSON.parse(fs4.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}
function resolveProjectDir(input2) {
  return process.env.CLAUDE_PROJECT_DIR || input2.cwd || process.cwd();
}
function logError(projectDir2, context, err) {
  try {
    const logDir = path4.join(pitcrewDir(projectDir2), "log");
    fs4.mkdirSync(logDir, { recursive: true });
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    fs4.appendFileSync(
      path4.join(logDir, "errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} [${context}] ${message}
`
    );
  } catch {
  }
}

// src/lib/review.ts
import path5 from "node:path";

// src/lib/frontmatter.ts
function quote(v) {
  return /[:#"[\],]|^[\s\d]|\s$|^$/.test(v) ? JSON.stringify(v) : v;
}
function serializeFrontmatter(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(quote).join(", ")}]`);
    } else {
      lines.push(`${key}: ${quote(String(value))}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

// src/lib/review.ts
var MAX_BODY_LINES = 600;
function slugify(text) {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "item";
}
function truncateBody(body) {
  const lines = body.split("\n");
  if (lines.length <= MAX_BODY_LINES) return body;
  return [
    ...lines.slice(0, MAX_BODY_LINES),
    "",
    `> (\u4EE5\u964D ${lines.length - MAX_BODY_LINES} \u884C\u3092\u7701\u7565\u3002\u5168\u6587\u306F\u4F5C\u696D\u30C4\u30EA\u30FC\u306E\u5BFE\u8C61\u30D5\u30A1\u30A4\u30EB\u3092\u53C2\u7167)`
  ].join("\n");
}
function commentTemplate(id, item) {
  const fm = serializeFrontmatter({
    urgency: "normal",
    paths: item.paths,
    reviewId: id,
    ...item.base ? { base: item.base } : {}
  });
  return [
    "---",
    "",
    "## \u30B3\u30E1\u30F3\u30C8\u3059\u308B\u5834\u5408",
    "",
    "\u4EE5\u4E0B\u3092 `.pitcrew/comments/c-<\u9023\u756A>.md` \u3068\u3057\u3066\u4FDD\u5B58\u3057\u3066\u304F\u3060\u3055\u3044(urgency \u306F urgent | normal)\u3002",
    "",
    "```markdown",
    fm,
    "(\u3053\u3053\u306B\u30B3\u30E1\u30F3\u30C8\u672C\u6587)",
    "```"
  ].join("\n");
}
function renderReviewItem(id, item, now) {
  const fm = {
    id,
    type: item.type,
    agent: item.agent,
    created: now.toISOString(),
    ...item.base ? { base: item.base } : {},
    ...item.head ? { head: item.head } : {},
    paths: item.paths
  };
  return [
    serializeFrontmatter(fm),
    `# ${item.title}`,
    "",
    truncateBody(item.body).trimEnd(),
    "",
    commentTemplate(id, item),
    ""
  ].join("\n");
}
function writeReviewItem(projectDir2, run, item) {
  const id = String(run.nextReviewId).padStart(3, "0");
  const slugSource = item.paths[0] ? path5.basename(item.paths[0]) : item.title;
  const file = path5.join(
    pitcrewDir(projectDir2),
    "review",
    `${id}-${item.type}-${slugify(slugSource)}.md`
  );
  writeFileAtomic(file, renderReviewItem(id, item, /* @__PURE__ */ new Date()));
  return { file, id, run: { ...run, nextReviewId: run.nextReviewId + 1 } };
}

// src/hooks/capture-subagent-stop.ts
var input = readStdinSync();
if (!input) process.exit(0);
var projectDir = resolveProjectDir(input);
try {
  const head = snapshotWorktree(projectDir);
  if (!head) process.exit(0);
  const run = loadRun(projectDir);
  const base = run.lastCaptureCommit ?? baselineTree(projectDir);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (!base || base === head) {
    saveRun(projectDir, { ...run, lastCaptureCommit: head, lastCaptureAt: now });
    process.exit(0);
  }
  const { diff, paths } = diffBetween(projectDir, base, head);
  if (paths.length === 0) {
    saveRun(projectDir, { ...run, lastCaptureCommit: head, lastCaptureAt: now });
    process.exit(0);
  }
  const first = path6.basename(paths[0]);
  const title = paths.length === 1 ? `${first} \u306E diff` : `${first} \u307B\u304B ${paths.length - 1} \u30D5\u30A1\u30A4\u30EB\u306E diff`;
  const item = {
    type: "diff",
    title,
    agent: input.agent_type ?? input.agent_id ?? "subagent",
    paths,
    base: base.slice(0, 7),
    head: head.slice(0, 7),
    body: `\`\`\`diff
${diff.trimEnd()}
\`\`\`
`
  };
  const res = writeReviewItem(projectDir, run, item);
  saveRun(projectDir, {
    ...res.run,
    lastCaptureCommit: head,
    lastCaptureAt: now
  });
} catch (err) {
  logError(projectDir, "capture-subagent-stop", err);
}
process.exit(0);
