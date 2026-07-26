#!/usr/bin/env node

// src/lib/hook-io.ts
import fs from "node:fs";
import path2 from "node:path";

// src/lib/paths.ts
import path from "node:path";
function guidepostDir(projectDir2) {
  return path.join(projectDir2, ".guidepost");
}
function toursDir(projectDir2) {
  return path.join(guidepostDir(projectDir2), "tours");
}
function tourDir(projectDir2, tourId) {
  return path.join(toursDir(projectDir2), tourId);
}
function answersDir(projectDir2, tourId) {
  return path.join(tourDir(projectDir2, tourId), "answers");
}
function questionsDir(projectDir2) {
  return path.join(guidepostDir(projectDir2), "queue", "questions");
}
function processedDir(projectDir2) {
  return path.join(questionsDir(projectDir2), "processed");
}

// src/lib/hook-io.ts
function readStdinSync() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}
function resolveProjectDir(input2) {
  return process.env.CLAUDE_PROJECT_DIR || input2.cwd || process.cwd();
}
function logError(projectDir2, context, err) {
  try {
    const logDir = path2.join(guidepostDir(projectDir2), "log");
    fs.mkdirSync(logDir, { recursive: true });
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    fs.appendFileSync(
      path2.join(logDir, "errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} [${context}] ${message}
`
    );
  } catch {
  }
}

// src/lib/injection.ts
import path4 from "node:path";

// src/lib/tour-store.ts
import path3 from "node:path";
var TOUR_ID_PATTERN = /^[A-Za-z0-9-]+$/;
var STOP_ID_PATTERN = /^stop-\d{2}$/;
function isSafeTourId(tourId) {
  return TOUR_ID_PATTERN.test(tourId);
}
function answerPath(projectDir2, tourId, stopId, ts) {
  if (!isSafeTourId(tourId) || !STOP_ID_PATTERN.test(stopId) || !/^[A-Za-z0-9-]+$/.test(ts)) {
    throw new Error("\u56DE\u7B54\u30D1\u30B9\u306B\u4F7F\u7528\u3067\u304D\u306A\u3044\u8B58\u5225\u5B50\u304C\u542B\u307E\u308C\u3066\u3044\u307E\u3059");
  }
  return path3.join(answersDir(projectDir2, tourId), `${stopId}-${ts}.md`);
}

// src/lib/injection.ts
var MAX_INJECT_CHARS = 9e3;
var UNKNOWN_QUESTION_INSTRUCTION = "\u3069\u306E\u30C4\u30A2\u30FC\u30FB\u3069\u306E\u30B9\u30C8\u30C3\u30D7\u3078\u306E\u8CEA\u554F\u304B\u7279\u5B9A\u3067\u304D\u306A\u3044\u305F\u3081\u3001\u30BB\u30C3\u30B7\u30E7\u30F3\u5185\u3067\u56DE\u7B54\u306E\u307F\u884C\u3044 answers/ \u3078\u306E\u66F8\u304D\u8FBC\u307F\u306F\u4E0D\u8981\u3067\u3059\u3002";
function questionTimestamp(name) {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}
function renderQuestion(question, projectDir2) {
  const metadata = [
    `tourId: ${question.tourId ?? "\u4E0D\u660E"}`,
    `stopId: ${question.stopId ?? "\u4E0D\u660E"}`
  ].join(" / ");
  if (question.tourId === null || question.stopId === null) {
    return `## ${question.name} (${metadata})

${question.body}

${UNKNOWN_QUESTION_INSTRUCTION}`;
  }
  const ts = questionTimestamp(question.name);
  let destination;
  try {
    destination = answerPath(projectDir2, question.tourId, question.stopId, ts);
  } catch {
    return `## ${question.name} (${metadata})

${question.body}

${UNKNOWN_QUESTION_INSTRUCTION}`;
  }
  const tourFile = path4.join(
    projectDir2,
    ".guidepost",
    "tours",
    question.tourId,
    "tour.json"
  );
  return [
    `## ${question.name} (${metadata})`,
    question.body,
    `\u8A72\u5F53\u30B9\u30C8\u30C3\u30D7\u306E\u6587\u8108\u306F \`.guidepost/tours/${question.tourId}/tour.json\` \u306E\u8A72\u5F53\u30A8\u30F3\u30C8\u30EA\u3092\u8AAD\u3093\u3067\u304F\u3060\u3055\u3044\u3002`,
    `\u53C2\u7167\u3059\u308B tour.json \u306E\u7D76\u5BFE\u30D1\u30B9: ${tourFile}`,
    `\u56DE\u7B54\u306E\u66F8\u304D\u8FBC\u307F\u5148: ${destination}`,
    `\u56DE\u7B54\u306F \`answers/${question.stopId}-${ts}.md\` \u306B\u65B0\u898F\u30D5\u30A1\u30A4\u30EB\u3068\u3057\u3066\u66F8\u3044\u3066\u304F\u3060\u3055\u3044\u3002\u65E2\u5B58\u30D5\u30A1\u30A4\u30EB\u3078\u306E\u8FFD\u8A18\u306F\u3057\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002`
  ].join("\n\n");
}
function renderInjection(questions, projectDir2, maxChars) {
  const head = `[guidepost] \u30C4\u30A2\u30FC\u95B2\u89A7\u8005\u304B\u3089\u306E\u8CEA\u554F(${questions.length} \u4EF6)\u3002\u8CEA\u554F\u3054\u3068\u306B\u6307\u5B9A\u3055\u308C\u305F\u30C4\u30A2\u30FC\u3068\u30B9\u30C8\u30C3\u30D7\u306E\u6587\u8108\u3092\u78BA\u8A8D\u3057\u3001\u56DE\u7B54\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
  const text = [
    head,
    ...questions.map((question) => renderQuestion(question, projectDir2))
  ].join("\n\n");
  if (text.length <= maxChars) return text;
  const note = `

> (\u4E0A\u9650\u306B\u3088\u308A\u5207\u308A\u8A70\u3081\u3002\u5168\u6587: .guidepost/queue/questions/processed/ \u914D\u4E0B\u306E ${questions.map((question) => question.name).join(", ")})`;
  return (text.slice(0, Math.max(0, maxChars - note.length)) + note).slice(
    0,
    maxChars
  );
}

// src/lib/queue.ts
import fs2 from "node:fs";
import path5 from "node:path";

// src/lib/frontmatter.ts
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
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const value = raw.trimEnd();
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner === "" ? [] : inner.split(",").map((s) => unquote(s.trim()));
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body: text.slice(m[0].length) };
}

// src/lib/queue.ts
function asString(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
function listQuestions(projectDir2) {
  const dir = questionsDir(projectDir2);
  let names;
  try {
    names = fs2.readdirSync(dir);
  } catch {
    return [];
  }
  const questions = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const file = path5.join(dir, name);
    let raw;
    try {
      if (!fs2.statSync(file).isFile()) continue;
      raw = fs2.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    questions.push({
      name,
      tourId: asString(data.tourId),
      stopId: asString(data.stopId),
      createdAt: asString(data.createdAt),
      body: body.trim()
    });
  }
  return questions;
}
function claimQuestion(projectDir2, name) {
  try {
    fs2.mkdirSync(processedDir(projectDir2), { recursive: true });
    fs2.renameSync(
      path5.join(questionsDir(projectDir2), name),
      path5.join(processedDir(projectDir2), name)
    );
    return true;
  } catch {
    return false;
  }
}

// src/hooks/inject-stop.ts
var input = readStdinSync();
if (!input) process.exit(0);
var projectDir = resolveProjectDir(input);
try {
  if (input.stop_hook_active !== true) {
    const claimed = listQuestions(projectDir).filter(
      (question) => claimQuestion(projectDir, question.name)
    );
    if (claimed.length > 0) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason: renderInjection(claimed, projectDir, MAX_INJECT_CHARS)
        })
      );
    }
  }
} catch (err) {
  logError(projectDir, "inject-stop", err);
}
process.exit(0);
