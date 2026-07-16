#!/usr/bin/env node

// src/hooks/capture-post-tool-use.ts
import fs5 from "node:fs";
import path6 from "node:path";

// src/lib/atomic.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  );
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

// src/lib/capture-rules.ts
import fs3 from "node:fs";
import path3 from "node:path";

// src/lib/frontmatter.ts
function quote(v) {
  return /[:#"[\],]|^[\s\d]|\s$|^$/.test(v) ? JSON.stringify(v) : v;
}
function unquote(v) {
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
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
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim();
      data[key] = inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()));
    } else {
      data[key] = unquote(raw);
    }
  }
  return { data, body: text.slice(m[0].length) };
}

// src/lib/run.ts
import fs2 from "node:fs";
import path2 from "node:path";
function pitcrewDir(projectDir2) {
  return path2.join(projectDir2, ".pitcrew");
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
  const file = path2.join(pitcrewDir(projectDir2), "run.json");
  let raw;
  try {
    raw = fs2.readFileSync(file, "utf8");
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
    path2.join(pitcrewDir(projectDir2), "run.json"),
    `${JSON.stringify(run, null, 2)}
`
  );
}

// src/lib/capture-rules.ts
function isArtifactPath(relPath) {
  const p = relPath.replaceAll("\\", "/");
  return p.startsWith("docs/") && p.endsWith(".md") && !p.startsWith("docs/chat/");
}
function findReviewItemForPath(projectDir2, type, relPath) {
  const reviewDir = path3.join(pitcrewDir(projectDir2), "review");
  let names;
  try {
    names = fs3.readdirSync(reviewDir);
  } catch {
    return null;
  }
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const file = path3.join(reviewDir, name);
    let data;
    try {
      data = parseFrontmatter(fs3.readFileSync(file, "utf8")).data;
    } catch {
      continue;
    }
    const paths = data.paths;
    if (data.type === type && typeof data.id === "string" && Array.isArray(paths) && paths.length === 1 && paths[0] === relPath)
      return { file, id: data.id };
  }
  return null;
}
var TEST_COMMAND_PREFIXES = [
  "pnpm test",
  "pnpm build",
  "pnpm typecheck",
  "pnpm lint",
  "pnpm vitest",
  "npm test",
  "npm run test",
  "npm run build",
  "yarn test",
  "yarn build",
  "npx vitest",
  "vitest",
  "pytest",
  "go test",
  "cargo test",
  "make test",
  "make build"
];
function matchTestCommand(command) {
  const trimmed = command.trimStart();
  for (const prefix of TEST_COMMAND_PREFIXES) {
    if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) return prefix;
  }
  return null;
}
function extractBashResult(toolResponse) {
  let output = "";
  let exitCode = null;
  if (typeof toolResponse === "string") {
    output = toolResponse;
  } else if (toolResponse && typeof toolResponse === "object") {
    const r = toolResponse;
    const parts = [];
    if (typeof r.stdout === "string" && r.stdout !== "") parts.push(r.stdout);
    if (typeof r.stderr === "string" && r.stderr !== "") parts.push(r.stderr);
    output = parts.join("\n");
    for (const key of ["exit_code", "exitCode", "code"]) {
      if (typeof r[key] === "number") {
        exitCode = r[key];
        break;
      }
    }
  }
  const failed = exitCode !== null && exitCode !== 0 || /\b(FAIL|failed|Error)\b/.test(output.slice(-2e3));
  return { output, failed };
}
function summarizeOutput(output, maxLines = 120) {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;
  return [
    `> (\u5148\u982D ${lines.length - maxLines} \u884C\u3092\u7701\u7565)`,
    ...lines.slice(-maxLines)
  ].join("\n");
}

// src/lib/git.ts
import { execFileSync } from "node:child_process";
function git(projectDir2, args, env) {
  return execFileSync("git", args, {
    cwd: projectDir2,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...env }
  });
}
function headCommit(projectDir2) {
  try {
    return git(projectDir2, ["rev-parse", "--short", "HEAD"]).trim();
  } catch {
    return null;
  }
}

// src/lib/hook-io.ts
import fs4 from "node:fs";
import path4 from "node:path";
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

// src/hooks/capture-post-tool-use.ts
function captureArtifact(projectDir2, input2) {
  const filePath = input2.tool_input?.file_path;
  if (typeof filePath !== "string") return;
  const rel = path6.relative(projectDir2, filePath).replaceAll("\\", "/");
  if (rel.startsWith("..") || path6.isAbsolute(rel)) return;
  if (!isArtifactPath(rel)) return;
  let content;
  try {
    content = fs5.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  const sections = [`\`\`\`\`markdown
${content.trimEnd()}
\`\`\`\``];
  const oldStr = input2.tool_input?.old_string;
  const newStr = input2.tool_input?.new_string;
  if (typeof oldStr === "string" && typeof newStr === "string") {
    sections.push(
      [
        "## \u5909\u66F4\u6982\u8981",
        "",
        "\u5909\u66F4\u524D:",
        `\`\`\`\`
${oldStr}
\`\`\`\``,
        "\u5909\u66F4\u5F8C:",
        `\`\`\`\`
${newStr}
\`\`\`\``
      ].join("\n")
    );
  }
  const item = {
    type: "artifact",
    title: `${rel} \u306E${input2.tool_name === "Write" ? "\u4F5C\u6210\u30FB\u66F4\u65B0" : "\u66F4\u65B0"}`,
    agent: input2.agent_type ?? "session",
    paths: [rel],
    base: null,
    head: headCommit(projectDir2),
    body: sections.join("\n\n")
  };
  const existing = findReviewItemForPath(projectDir2, "artifact", rel);
  if (existing) {
    writeFileAtomic(
      existing.file,
      renderReviewItem(existing.id, item, /* @__PURE__ */ new Date())
    );
    return;
  }
  const run = loadRun(projectDir2);
  const res = writeReviewItem(projectDir2, run, item);
  saveRun(projectDir2, res.run);
}
function captureTestResult(projectDir2, input2) {
  const command = input2.tool_input?.command;
  if (typeof command !== "string") return;
  const matched = matchTestCommand(command);
  if (!matched) return;
  const { output, failed } = extractBashResult(input2.tool_response);
  const status = failed ? "\u5931\u6557\u306E\u7591\u3044" : "\u6210\u529F";
  const body = [
    `- \u30B3\u30DE\u30F3\u30C9: \`${command}\``,
    `- \u7D50\u679C: ${status}(\u51FA\u529B\u304B\u3089\u306E\u6A5F\u68B0\u7684\u63A8\u5B9A)`,
    "",
    "## \u51FA\u529B(\u672B\u5C3E)",
    "",
    `\`\`\`
${summarizeOutput(output).trimEnd()}
\`\`\``
  ].join("\n");
  const item = {
    type: "test",
    title: `${matched} \u306E\u5B9F\u884C\u7D50\u679C: ${status}`,
    agent: input2.agent_type ?? "session",
    paths: [],
    base: null,
    head: headCommit(projectDir2),
    body
  };
  const run = loadRun(projectDir2);
  const res = writeReviewItem(projectDir2, run, item);
  saveRun(projectDir2, res.run);
}
var input = readStdinSync();
if (!input) process.exit(0);
var projectDir = resolveProjectDir(input);
try {
  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    captureArtifact(projectDir, input);
  } else if (input.tool_name === "Bash") {
    captureTestResult(projectDir, input);
  }
} catch (err) {
  logError(projectDir, "capture-post-tool-use", err);
}
process.exit(0);
