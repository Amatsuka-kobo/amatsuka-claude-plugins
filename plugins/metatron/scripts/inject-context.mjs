#!/usr/bin/env node

// src/inject-context.ts
import fs3 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// src/lib/architecture.ts
import fs from "node:fs";
var ARCHITECTURE_TITLE = "# ARCHITECTURE";
var ADR_HEADING = "ADR \u4E00\u89A7";
var UNCLOSED_FENCE_WARNING = "\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u304C\u3042\u308A\u307E\u3059\u3002\u672A\u9589\u30D5\u30A7\u30F3\u30B9\u4EE5\u964D\u3092 1 \u30BB\u30AF\u30B7\u30E7\u30F3\u3068\u3057\u3066\u6271\u3044\u307E\u3057\u305F\u3002";
function splitLines(text) {
  if (text === "") return [];
  return text.split(/(?<=\n)/).map((raw) => ({
    raw,
    text: raw.replace(/\n$/, "").replace(/\r$/, "")
  }));
}
function joinRaw(lines, start, end) {
  let out = "";
  for (let i = start; i < end; i++) out += lines[i].raw;
  return out;
}
function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}
var FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var FENCE_CLOSE_RE = /^ {0,3}(`+|~+)[ \t]*$/;
var HEADING_RE = /^ {0,3}## (.*)$/;
function matchFenceOpen(lineText) {
  const m = FENCE_OPEN_RE.exec(lineText);
  if (!m) return null;
  return { char: m[1][0], count: m[1].length, info: m[2] };
}
function isFenceClose(lineText, fence) {
  const m = FENCE_CLOSE_RE.exec(lineText);
  if (!m) return false;
  if (m[1][0] !== fence.char) return false;
  return m[1].length >= fence.count;
}
function scanFences(text) {
  const lines = splitLines(text);
  const insideFence = new Array(lines.length).fill(false);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (fence === null) {
      const open = matchFenceOpen(t);
      if (open !== null) {
        fence = open;
        insideFence[i] = true;
      }
      continue;
    }
    insideFence[i] = true;
    if (isFenceClose(t, fence)) fence = null;
  }
  return { lines, insideFence, unclosed: fence !== null, eol: detectEol(text) };
}
function parseArchitecture(text) {
  const scan = scanFences(text);
  const lines = scan.lines;
  const eol = scan.eol;
  const starts = [];
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (scan.insideFence[i]) continue;
    const heading = HEADING_RE.exec(lines[i].text);
    if (heading) {
      starts.push(i);
      headings.push(heading[1].trim());
    }
  }
  const sections = [];
  for (let s = 0; s < starts.length; s++) {
    const startLine = starts[s];
    const endLine = s + 1 < starts.length ? starts[s + 1] : lines.length;
    let contentEndLine = endLine;
    while (contentEndLine > startLine + 1 && lines[contentEndLine - 1].text.trim() === "") {
      contentEndLine--;
    }
    const body = joinRaw(lines, startLine + 1, endLine);
    sections.push({
      heading: headings[s],
      headingLine: lines[startLine].text,
      startLine,
      contentEndLine,
      endLine,
      body,
      raw: lines[startLine].raw + body
    });
  }
  const preambleEnd = starts.length > 0 ? starts[0] : lines.length;
  const warnings = [];
  let strayLines = 0;
  for (let i = 0; i < preambleEnd; i++) {
    const t = lines[i].text;
    if (t.trim() === "") continue;
    if (/^ {0,3}# /.test(t)) continue;
    strayLines++;
  }
  if (strayLines > 0) {
    warnings.push(
      `${ARCHITECTURE_TITLE} \u3068\u6700\u521D\u306E ## \u898B\u51FA\u3057\u306E\u9593\u306B\u672C\u6587\u304C ${strayLines} \u884C\u3042\u308A\u307E\u3059\u3002\u5192\u982D\u306E\u6982\u8981\u306F \`## \u30B7\u30B9\u30C6\u30E0\u6982\u8981\` \u306B\u79FB\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    );
  }
  const counts = /* @__PURE__ */ new Map();
  for (const h of headings) counts.set(h, (counts.get(h) ?? 0) + 1);
  for (const [h, n] of counts) {
    if (n > 1) {
      warnings.push(
        `## ${h} \u304C ${n} \u500B\u3042\u308A\u307E\u3059\u3002\u6700\u521D\u306E\u3082\u306E\u3060\u3051\u3092\u5BFE\u8C61\u306B\u3057\u307E\u3059\u3002`
      );
    }
  }
  return {
    text,
    eol,
    preamble: joinRaw(lines, 0, preambleEnd),
    sections,
    error: scan.unclosed ? "unclosed_fence" : null,
    warnings
  };
}
function parseArchitectureForRead(text) {
  const doc = parseArchitecture(text);
  if (doc.error === null) return doc;
  return { ...doc, warnings: [...doc.warnings, UNCLOSED_FENCE_WARNING] };
}
function findSection(doc, heading) {
  return doc.sections.find((s) => s.heading === heading);
}
function readArchitectureFile(filePath) {
  const warnings = [];
  let text = "";
  let exists = false;
  try {
    text = fs.readFileSync(filePath, "utf8");
    exists = true;
  } catch (err) {
    const code = err?.code;
    if (code !== "ENOENT") {
      warnings.push(
        `ARCHITECTURE(${filePath})\u3092\u8AAD\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u672A\u4F5C\u6210\u3068\u3057\u3066\u6271\u3044\u307E\u3059\u3002`
      );
    }
  }
  const doc = parseArchitectureForRead(text);
  return {
    path: filePath,
    exists,
    text,
    doc,
    warnings: [...warnings, ...doc.warnings]
  };
}

// src/lib/gotchas.ts
var LIST_SECTION_TITLE = "\u5931\u6557\u30D1\u30BF\u30FC\u30F3\u4E00\u89A7";
function stripCr(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
var FENCE_OPEN_RE2 = /^ {0,3}(`{3,}|~{3,})/;
var FENCE_CLOSE_RE2 = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
function matchFenceOpen2(line) {
  const m = FENCE_OPEN_RE2.exec(line);
  if (m === null) return null;
  return { char: m[1][0], count: m[1].length };
}
function isFenceClose2(line, fence) {
  const m = FENCE_CLOSE_RE2.exec(line);
  if (m === null) return false;
  return m[1][0] === fence.char && m[1].length >= fence.count;
}
function scanFences2(lines, ignoreFences) {
  const blocked = new Array(lines.length).fill(false);
  if (ignoreFences) return { blocked, unclosedFence: false };
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = stripCr(lines[i]);
    if (fence === null) {
      const open = matchFenceOpen2(line);
      if (open !== null) {
        fence = open;
        blocked[i] = true;
      }
      continue;
    }
    blocked[i] = true;
    if (isFenceClose2(line, fence)) fence = null;
  }
  return { blocked, unclosedFence: fence !== null };
}
var SECTION_HEADING_RE = /^ {0,3}## (.*)$/;
var SUB_HEADING_RE = /^ {0,3}### /;
var ENTRY_HEADING_RE = /^( {0,3}###[ \t]+\[(\d{4}-\d{2}-\d{2})\][ \t]+GOTCHA-(\d+):)(.*)$/;
var TAG_RE = /^ (\[解決済み\]|\[対象外\])(?:[ \t](.*))?$/;
var FIELD_LINE_RE = /^ {0,3}\*\*(.+?)\*\*[ \t]*:[ \t]*(.*)$/;
function parseTagAndTitle(rest) {
  const m = TAG_RE.exec(rest);
  if (m === null) return { tag: null, title: rest.trim() };
  const literal = m[1];
  const tag = literal === "[\u89E3\u6C7A\u6E08\u307F]" ? "\u89E3\u6C7A\u6E08\u307F" : "\u5BFE\u8C61\u5916";
  return { tag, title: (m[2] ?? "").trim() };
}
function normalizeFieldName(name) {
  return name.replace(/[\s　]/g, "");
}
var FIELD_KEYS = {
  \u30BF\u30B9\u30AF: "task",
  \u5931\u6557\u5185\u5BB9: "mistake",
  "\u539F\u56E0(\u63A8\u6E2C)": "cause",
  \u5BFE\u7B56: "countermeasure",
  \u6607\u683C\u5019\u88DC: "promotionCandidate"
};
function parseEntryFields(bodyLines) {
  const fields = {};
  const values = {
    task: "",
    mistake: "",
    cause: "",
    countermeasure: "",
    promotionCandidate: null
  };
  for (const raw of bodyLines) {
    const m = FIELD_LINE_RE.exec(stripCr(raw));
    if (m === null) continue;
    const name = m[1].trim();
    const value = m[2].trim();
    if (fields[name] === void 0) fields[name] = value;
    const key = FIELD_KEYS[normalizeFieldName(name)];
    if (key === void 0) continue;
    if (key === "promotionCandidate") {
      if (values.promotionCandidate === null && (value === "Yes" || value === "No")) {
        values.promotionCandidate = value;
      }
      continue;
    }
    if (values[key] === "") values[key] = value;
  }
  return { fields, values };
}
function parseWith(text, ignoreFences) {
  const lines = text.split("\n");
  const { blocked, unclosedFence } = scanFences2(lines, ignoreFences);
  const warnings = [];
  let listSection = null;
  for (let i = 0; i < lines.length; i++) {
    if (blocked[i]) continue;
    const m = SECTION_HEADING_RE.exec(stripCr(lines[i]));
    if (m === null) continue;
    if (listSection === null && m[1].trim() === LIST_SECTION_TITLE) {
      listSection = { headingIndex: i, endIndex: lines.length };
      continue;
    }
    if (listSection !== null && listSection.endIndex === lines.length) {
      listSection.endIndex = i;
      break;
    }
  }
  const entries = [];
  if (listSection !== null) {
    const starts = [];
    for (let i = listSection.headingIndex + 1; i < listSection.endIndex; i++) {
      if (blocked[i]) continue;
      if (!SUB_HEADING_RE.test(stripCr(lines[i]))) continue;
      starts.push(i);
    }
    for (let s = 0; s < starts.length; s++) {
      const startIndex = starts[s];
      const endIndex = s + 1 < starts.length ? starts[s + 1] : listSection.endIndex;
      const headingLine = lines[startIndex];
      const m = ENTRY_HEADING_RE.exec(stripCr(headingLine));
      if (m === null) continue;
      const bodyLines = lines.slice(startIndex + 1, endIndex);
      const { fields, values } = parseEntryFields(bodyLines);
      const { tag, title } = parseTagAndTitle(m[4]);
      const num = Number.parseInt(m[3], 10);
      entries.push({
        ...values,
        id: formatGotchaId(num),
        number: num,
        date: m[2],
        tag,
        title,
        headingLine,
        startIndex,
        endIndex,
        raw: lines.slice(startIndex, endIndex).join("\n"),
        fields
      });
    }
  }
  let maxNumber = 0;
  for (const entry of entries) {
    if (entry.number > maxNumber) maxNumber = entry.number;
  }
  if (unclosedFence) {
    warnings.push(
      "\u672A\u9589\u306E\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u304C\u3042\u308A\u307E\u3059\u3002\u30A8\u30F3\u30C8\u30EA\u306E\u7BC4\u56F2\u304C\u6B63\u3057\u304F\u53D6\u308C\u3066\u3044\u306A\u3044\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002"
    );
  }
  return {
    text,
    lines,
    crlf: text.includes("\r\n"),
    listSection,
    entries,
    maxNumber,
    nextNumber: maxNumber + 1,
    unclosedFence,
    warnings
  };
}
function parseGotchas(text) {
  const primary = parseWith(text, false);
  if (!primary.unclosedFence) return primary;
  const fallback = parseWith(text, true);
  const useFallback = primary.listSection === null && fallback.listSection !== null;
  const base = useFallback ? fallback : primary;
  const maxNumber = Math.max(primary.maxNumber, fallback.maxNumber);
  const warnings = [...primary.warnings];
  if (useFallback) {
    warnings.push(
      "\u672A\u9589\u30D5\u30A7\u30F3\u30B9\u306E\u305F\u3081\u3001\u30D5\u30A7\u30F3\u30B9\u3092\u7121\u8996\u3057\u305F\u8D70\u67FB\u3067 `## \u5931\u6557\u30D1\u30BF\u30FC\u30F3\u4E00\u89A7` \u3092\u7279\u5B9A\u3057\u307E\u3057\u305F\u3002"
    );
  }
  return {
    ...base,
    maxNumber,
    nextNumber: maxNumber + 1,
    unclosedFence: true,
    warnings
  };
}
function formatGotchaId(num) {
  return `GOTCHA-${String(num).padStart(3, "0")}`;
}
var TEMPLATE_LINES = [
  "# GOTCHAS",
  "",
  "\u3053\u306E\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3067 AI \u304C\u5B9F\u969B\u306B\u3084\u3063\u3066\u3057\u307E\u3063\u305F\u5931\u6557\u306E\u30D1\u30BF\u30FC\u30F3\u3092\u84C4\u7A4D\u3059\u308B\u3002",
  "\u767A\u898B\u3055\u308C\u305F\u5931\u6557\u3092\u3001\u4E0B\u8A18\u306E\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u3067\u8FFD\u8A18\u3057\u3066\u3044\u304F\u3002",
  "",
  "## \u904B\u7528\u30EB\u30FC\u30EB",
  "",
  "- \u65B0\u3057\u3044\u3082\u306E\u3092\u4E0A\u306B\u8FFD\u52A0\u3059\u308B\u3002",
  "- \u540C\u3058\u30D1\u30BF\u30FC\u30F3\u304C 5 \u4EF6\u4EE5\u4E0A\u84C4\u7A4D\u3055\u308C\u305F\u3089\u3001\u30B9\u30AD\u30EB\u307E\u305F\u306F Hook \u3078\u306E\u6607\u683C\u3092\u691C\u8A0E\u3059\u308B\u3002",
  "- \u89E3\u6C7A\u6E08\u307F\u306E\u9805\u76EE\u306F `[\u89E3\u6C7A\u6E08\u307F]` \u30BF\u30B0\u3092\u4ED8\u3051\u3066\u6B8B\u3059\u3002\u524A\u9664\u3057\u306A\u3044\u3002",
  "- \u9673\u8150\u5316\u3057\u305F\u9805\u76EE\u306F `[\u5BFE\u8C61\u5916]` \u30BF\u30B0\u3092\u4ED8\u3051\u3066\u6B8B\u3059\u3002\u524A\u9664\u3057\u306A\u3044\u3002",
  "",
  "## \u8A18\u5165\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8",
  "",
  "### [YYYY-MM-DD] GOTCHA-NNN: \u5931\u6557\u306E\u30BF\u30A4\u30C8\u30EB",
  "",
  "**\u30BF\u30B9\u30AF**: (\u4F55\u3092\u3057\u3088\u3046\u3068\u3057\u3066\u3044\u305F\u304B)",
  "**\u5931\u6557\u5185\u5BB9**: (\u5177\u4F53\u7684\u306B\u4F55\u3092\u9593\u9055\u3048\u305F\u304B)",
  "**\u539F\u56E0 (\u63A8\u6E2C)**: (\u306A\u305C\u305D\u3046\u306A\u3063\u305F\u304B)",
  "**\u5BFE\u7B56**: (\u4ECA\u5F8C AI \u306F\u3069\u3046\u632F\u308B\u821E\u3046\u3079\u304D\u304B)",
  "**\u6607\u683C\u5019\u88DC**: Yes / No (\u30B9\u30AD\u30EB\u3084 Hook \u306B\u3059\u308B\u3079\u304D\u304B)",
  "",
  `## ${LIST_SECTION_TITLE}`,
  ""
];

// src/lib/adr.ts
var ADR_STATUSES = ["\u63A1\u7528", "\u63D0\u6848", "\u5EC3\u6B62"];
var ENTRY_HEADING_RE2 = /^( {0,3}###[ \t]+ADR-(\d+):)(.*)$/;
var STATUS_LINE_RE = /^( {0,3}-[ \t]+状態[ \t]*:[ \t]*)(.*)$/;
var DECIDED_ON_RE = /^ {0,3}-[ \t]+決定日[ \t]*:[ \t]*(.*)$/;
var DECIDED_BY_RE = /^ {0,3}-[ \t]+決定者[ \t]*:[ \t]*(.*)$/;
var STATUS_CHANGE_RE = /^ {0,3}-[ \t]+状態変更\((\d{4}-\d{2}-\d{2})\)[ \t]*:[ \t]*(.*)$/;
var STATUS_CHANGE_VALUE_RE = /^(.*?)[ \t]*→[ \t]*([^。]*)。?(.*)$/;
function formatAdrId(num) {
  return `ADR-${String(num).padStart(3, "0")}`;
}
function isAdrStatus(value) {
  return typeof value === "string" && ADR_STATUSES.includes(value);
}
function joinRaw2(lines, start, end) {
  let out = "";
  for (let i = start; i < end; i++) out += lines[i].raw;
  return out;
}
function parseStatusChangeValue(value) {
  const m = STATUS_CHANGE_VALUE_RE.exec(value);
  if (m === null) return { from: null, to: null, reason: value.trim() };
  return { from: m[1].trim(), to: m[2].trim(), reason: m[3].trim() };
}
function parseEntries(sectionBody) {
  const scan = scanFences(sectionBody);
  const lines = scan.lines;
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (scan.insideFence[i]) continue;
    const m = ENTRY_HEADING_RE2.exec(lines[i].text);
    if (m === null) continue;
    starts.push({
      index: i,
      number: Number.parseInt(m[2], 10),
      title: m[3].trim()
    });
  }
  const entries = [];
  for (let s = 0; s < starts.length; s++) {
    const { index: startIndex, number, title } = starts[s];
    const endIndex = s + 1 < starts.length ? starts[s + 1].index : lines.length;
    let contentEndIndex = endIndex;
    while (contentEndIndex > startIndex + 1 && lines[contentEndIndex - 1].text.trim() === "") {
      contentEndIndex--;
    }
    let statusRaw = null;
    let statusLineIndex = null;
    let decidedOn = null;
    let decidedBy = null;
    const statusChanges = [];
    for (let i = startIndex + 1; i < contentEndIndex; i++) {
      if (scan.insideFence[i]) continue;
      const text = lines[i].text;
      const change = STATUS_CHANGE_RE.exec(text);
      if (change !== null) {
        statusChanges.push({
          date: change[1],
          raw: change[2],
          lineIndex: i,
          ...parseStatusChangeValue(change[2])
        });
        continue;
      }
      if (statusRaw === null) {
        const status = STATUS_LINE_RE.exec(text);
        if (status !== null) {
          statusRaw = status[2].trim();
          statusLineIndex = i;
          continue;
        }
      }
      if (decidedOn === null) {
        const on = DECIDED_ON_RE.exec(text);
        if (on !== null) {
          decidedOn = on[1].trim();
          continue;
        }
      }
      if (decidedBy === null) {
        const by = DECIDED_BY_RE.exec(text);
        if (by !== null) decidedBy = by[1].trim();
      }
    }
    entries.push({
      id: formatAdrId(number),
      number,
      title,
      headingLine: lines[startIndex].text,
      status: isAdrStatus(statusRaw) ? statusRaw : null,
      statusRaw,
      statusLineIndex,
      decidedOn,
      decidedBy,
      startIndex,
      contentEndIndex,
      endIndex,
      raw: joinRaw2(lines, startIndex, endIndex),
      statusChanges
    });
  }
  return entries;
}
function parseAdrDocument(text) {
  const source = text ?? "";
  const doc = parseArchitecture(source);
  const warnings = [...doc.warnings];
  const section = findSection(doc, ADR_HEADING);
  const sectionBody = section?.body ?? "";
  const entries = section ? parseEntries(sectionBody) : [];
  const seen = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    seen.set(entry.number, (seen.get(entry.number) ?? 0) + 1);
  }
  for (const [num, count] of seen) {
    if (count > 1) {
      warnings.push(
        `${formatAdrId(num)} \u304C ${count} \u500B\u3042\u308A\u307E\u3059\u3002\u63A1\u756A\u306F\u6700\u5927\u5024 + 1 \u3067\u884C\u3046\u305F\u3081\u885D\u7A81\u306F\u8D77\u304D\u307E\u305B\u3093\u304C\u3001\u624B\u7DE8\u96C6\u3067\u91CD\u8907\u3057\u305F\u3082\u306E\u3068\u601D\u308F\u308C\u307E\u3059\u3002`
      );
    }
  }
  let maxNumber = 0;
  for (const entry of entries) {
    if (entry.number > maxNumber) maxNumber = entry.number;
  }
  return {
    text: source,
    hasSection: section !== void 0,
    sectionBody,
    entries,
    maxNumber,
    nextNumber: maxNumber + 1,
    unclosedFence: doc.error === "unclosed_fence",
    warnings
  };
}

// src/lib/config.ts
import { spawnSync } from "node:child_process";
import fs2 from "node:fs";
import path from "node:path";
var CONFIG_FILENAME = "metatron.config.json";
var SUPPORTED_VERSION = 1;
var DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md";
var DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md";
var DEFAULT_INJECTION_ENABLED = true;
var DEFAULT_GOTCHAS_RECENT_COUNT = 5;
var DEFAULT_MAX_CHARS = 9e3;
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function realpathOrSelf(dir) {
  try {
    return fs2.realpathSync(dir);
  } catch {
    return dir;
  }
}
function hasConfigFile(dir) {
  try {
    return fs2.existsSync(path.join(dir, CONFIG_FILENAME));
  } catch {
    return false;
  }
}
function gitToplevel(cwd) {
  try {
    const res = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 5e3,
      windowsHide: true
    });
    if (res.status !== 0) return null;
    const out = res.stdout?.trim();
    if (!out) return null;
    return path.resolve(out);
  } catch {
    return null;
  }
}
function findDocRoot(startDir) {
  const start = realpathOrSelf(path.resolve(startDir ?? process.cwd()));
  let dir = start;
  while (true) {
    if (hasConfigFile(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const top = gitToplevel(start);
  if (top) return top;
  return start;
}
function normalizeSeparators(value) {
  return value.replace(/\\/g, "/");
}
function looksAbsolute(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:\//.test(value) || value.startsWith("//");
}
function toPosix(value) {
  return value.split(path.sep).join("/");
}
function resolveConfiguredPath(docRoot, raw, fallback, label, warnings) {
  const useFallback = () => ({
    relative: fallback,
    absolute: path.resolve(docRoot, fallback)
  });
  if (raw === void 0) return useFallback();
  if (typeof raw !== "string" || raw.trim() === "") {
    warnings.push(
      `paths.${label} \u304C\u7A7A\u3067\u306A\u3044\u6587\u5B57\u5217\u3067\u306A\u3044\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return useFallback();
  }
  const value = normalizeSeparators(raw);
  if (looksAbsolute(value)) {
    warnings.push(
      `paths.${label} \u304C\u7D76\u5BFE\u30D1\u30B9(${raw})\u306E\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002\u30DE\u30B7\u30F3\u56FA\u6709\u306E\u7D76\u5BFE\u30D1\u30B9\u306F\u30EA\u30DD\u30B8\u30C8\u30EA\u306E\u53EF\u642C\u6027\u3092\u5931\u308F\u305B\u308B\u305F\u3081\u53D7\u3051\u4ED8\u3051\u307E\u305B\u3093\u3002`
    );
    return useFallback();
  }
  const absolute = path.resolve(docRoot, value);
  const relative = path.relative(docRoot, absolute);
  const escapes = relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (escapes) {
    warnings.push(
      `paths.${label} \u304C\u30EB\u30FC\u30C8\u5916(${raw})\u3092\u6307\u3059\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${fallback} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return useFallback();
  }
  return { relative: toPosix(relative), absolute };
}
function resolveBoolean(raw, fallback, label, warnings) {
  if (raw === void 0) return fallback;
  if (typeof raw !== "boolean") {
    warnings.push(
      `${label} \u304C\u771F\u507D\u5024\u3067\u306A\u3044\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${String(fallback)} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return fallback;
  }
  return raw;
}
function resolveNumber(raw, fallback, label, min, warnings) {
  if (raw === void 0) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < min) {
    warnings.push(
      `${label} \u304C ${min} \u4EE5\u4E0A\u306E\u6574\u6570\u3067\u306A\u3044\u305F\u3081\u3001\u65E2\u5B9A\u5024 ${String(fallback)} \u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
    return fallback;
  }
  return raw;
}
function defaultsFor(docRoot, warnings) {
  return {
    docRoot,
    configPath: path.join(docRoot, CONFIG_FILENAME),
    configExists: false,
    architecturePath: path.resolve(docRoot, DEFAULT_ARCHITECTURE_PATH),
    gotchasPath: path.resolve(docRoot, DEFAULT_GOTCHAS_PATH),
    architectureRelative: DEFAULT_ARCHITECTURE_PATH,
    gotchasRelative: DEFAULT_GOTCHAS_PATH,
    injection: {
      enabled: DEFAULT_INJECTION_ENABLED,
      gotchasRecentCount: DEFAULT_GOTCHAS_RECENT_COUNT,
      maxChars: DEFAULT_MAX_CHARS
    },
    warnings
  };
}
function loadConfigInner(startDir) {
  const warnings = [];
  const docRoot = findDocRoot(startDir);
  const configPath = path.join(docRoot, CONFIG_FILENAME);
  let configExists = false;
  let parsed;
  let parseOk = false;
  try {
    if (fs2.existsSync(configPath)) {
      configExists = true;
      parsed = JSON.parse(fs2.readFileSync(configPath, "utf8"));
      parseOk = true;
    }
  } catch {
    warnings.push("\u8A2D\u5B9A\u3092\u8AAD\u3081\u306A\u304B\u3063\u305F\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002");
  }
  let source;
  if (parseOk) {
    if (isPlainObject(parsed)) {
      source = parsed;
    } else {
      warnings.push(
        "\u8A2D\u5B9A\u306E\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306A\u3044\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002"
      );
    }
  }
  if (source !== void 0) {
    const version = source.version;
    if (version !== void 0 && version !== SUPPORTED_VERSION) {
      warnings.push(
        `\u8A2D\u5B9A\u306E version(${JSON.stringify(version)})\u304C\u672A\u77E5\u306E\u305F\u3081\u3001\u5168\u9805\u76EE\u306B\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
      );
      source = void 0;
    }
  }
  const pathsRaw = source?.paths;
  const paths = isPlainObject(pathsRaw) ? pathsRaw : void 0;
  if (pathsRaw !== void 0 && paths === void 0) {
    warnings.push(
      "paths \u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306A\u3044\u305F\u3081\u3001\u6587\u66F8\u30D1\u30B9\u306B\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002"
    );
  }
  const architecture = resolveConfiguredPath(
    docRoot,
    paths?.architecture,
    DEFAULT_ARCHITECTURE_PATH,
    "architecture",
    warnings
  );
  const gotchas = resolveConfiguredPath(
    docRoot,
    paths?.gotchas,
    DEFAULT_GOTCHAS_PATH,
    "gotchas",
    warnings
  );
  const injectionRaw = source?.injection;
  const injection = isPlainObject(injectionRaw) ? injectionRaw : void 0;
  if (injectionRaw !== void 0 && injection === void 0) {
    warnings.push("injection \u304C\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u306A\u3044\u305F\u3081\u3001\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002");
  }
  return {
    docRoot,
    configPath,
    configExists,
    architecturePath: architecture.absolute,
    gotchasPath: gotchas.absolute,
    architectureRelative: architecture.relative,
    gotchasRelative: gotchas.relative,
    injection: {
      enabled: resolveBoolean(
        injection?.enabled,
        DEFAULT_INJECTION_ENABLED,
        "injection.enabled",
        warnings
      ),
      gotchasRecentCount: resolveNumber(
        injection?.gotchasRecentCount,
        DEFAULT_GOTCHAS_RECENT_COUNT,
        "injection.gotchasRecentCount",
        0,
        warnings
      ),
      maxChars: resolveNumber(
        injection?.maxChars,
        DEFAULT_MAX_CHARS,
        "injection.maxChars",
        1,
        warnings
      )
    },
    warnings
  };
}
function loadConfig(startDir) {
  try {
    return loadConfigInner(startDir);
  } catch {
    let docRoot;
    try {
      docRoot = path.resolve(startDir ?? process.cwd());
    } catch {
      docRoot = startDir ?? ".";
    }
    return defaultsFor(docRoot, [
      "\u8A2D\u5B9A\u306E\u89E3\u6C7A\u306B\u5931\u6557\u3057\u305F\u305F\u3081\u65E2\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002"
    ]);
  }
}

// src/lib/emit.ts
function injectContext(content) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: content
      }
    })}
`
  );
}

// src/inject-context.ts
var STAGE2_TOC_LIMIT = 50;
var MAX_WARNING_LINES = 3;
var STDIN_TIMEOUT_MS = 2e3;
function pluginRoot(env) {
  const fromEnv = env.CLAUDE_PLUGIN_ROOT;
  if (typeof fromEnv === "string" && fromEnv !== "")
    return path2.resolve(fromEnv);
  return path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "..");
}
function metatronCliPath(env) {
  return path2.join(pluginRoot(env), "scripts", "metatron.mjs");
}
function buildGuide(cli) {
  return [
    "# metatron: \u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u306E\u524D\u63D0\u3068\u843D\u3068\u3057\u7A74",
    "",
    "\u3053\u308C\u3089\u306E\u6587\u66F8\u306F metatron \u306E\u7BA1\u7406\u4E0B\u306B\u3042\u308B\u3002**\u76F4\u63A5\u7DE8\u96C6\u306F PreToolUse hook \u304C\u62D2\u5426\u3059\u308B\u3002**",
    `\u8A18\u9332\u30FB\u66F4\u65B0\u30FB\u5168\u6587\u53D6\u5F97\u306F\u6B21\u306E CLI \u3092\u4F7F\u3046(\u7D76\u5BFE\u30D1\u30B9\u3002M = ${cli}):`,
    "  \u8AAD\u3080:     node M get gotchas --query <\u8A9E> / node M get adr / node M get architecture",
    "  \u8A18\u9332:     node M append-gotcha --input <\u4E00\u6642\u30D5\u30A1\u30A4\u30EB>",
    '  \u30BF\u30B0:     node M tag-gotcha --id GOTCHA-003 --tag \u89E3\u6C7A\u6E08\u307F --reason "..."',
    "  \u6587\u66F8\u66F4\u65B0: node M stage-architecture --input <\u4E00\u6642\u30D5\u30A1\u30A4\u30EB> \u2192 node M commit-architecture --staging-id <id>",
    "  ADR:     node M stage-adr --input <\u4E00\u6642\u30D5\u30A1\u30A4\u30EB> \u2192 node M commit-architecture --staging-id <id>",
    "\u203B\u9577\u3044\u5165\u529B\u306F\u4E00\u6642\u30D5\u30A1\u30A4\u30EB\u3078\u66F8\u304D\u3001--input <path> \u3067\u6E21\u3059(CLI \u306E\u547C\u3073\u51FA\u3057\u898F\u7D04)\u3002",
    "\u203B\u3053\u306E\u6848\u5185\u306F\u30E1\u30A4\u30F3\u30BB\u30C3\u30B7\u30E7\u30F3\u5411\u3051\u3002\u30B5\u30D6\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u306B\u306F\u5225\u9014\u30D1\u30B9\u304C\u6E21\u3055\u308C\u308B\u3002"
  ].join("\n");
}
function toLf(text) {
  return text.replace(/\r\n/g, "\n");
}
function trimEnd(text) {
  return text.replace(/\s+$/, "");
}
function readArchitecture(config) {
  const file = readArchitectureFile(config.architecturePath);
  if (!file.exists) return null;
  if (file.text.trim() === "") return null;
  return {
    doc: file.doc,
    adrEntries: parseAdrDocument(file.text).entries,
    warnings: file.warnings
  };
}
function readGotchas(config) {
  let text;
  try {
    text = fs3.readFileSync(config.gotchasPath, "utf8");
  } catch {
    return null;
  }
  if (text.trim() === "") return null;
  const doc = parseGotchas(text);
  return { entries: doc.entries, warnings: doc.warnings };
}
function firstSentence(text) {
  const at = text.indexOf("\u3002");
  if (at >= 0) return text.slice(0, at + 1);
  return text;
}
function isTableDelimiter(line) {
  return line.includes("|") && /^[-\s|:]+$/.test(line);
}
function nextNonEmptyLine(scan, from) {
  for (let i = from; i < scan.lines.length; i++) {
    if (scan.insideFence[i]) return -1;
    if (scan.lines[i].text.trim() !== "") return i;
  }
  return -1;
}
function tableEndLine(scan, from) {
  let i = from;
  while (i < scan.lines.length && !scan.insideFence[i]) {
    const text = scan.lines[i].text.trim();
    if (text === "" || !text.includes("|")) break;
    i++;
  }
  return i - 1;
}
function summarizeSection(section) {
  const scan = scanFences(section.body);
  for (let i = 0; i < scan.lines.length; i++) {
    if (scan.insideFence[i]) continue;
    const line = scan.lines[i].text.trim();
    if (line === "") continue;
    if (/^#{1,6}\s/.test(line)) continue;
    if (line.includes("|")) {
      const delim = nextNonEmptyLine(scan, i + 1);
      if (delim >= 0 && isTableDelimiter(scan.lines[delim].text.trim())) {
        i = tableEndLine(scan, delim + 1);
        continue;
      }
    }
    if (line.startsWith("|")) continue;
    if (/^[-=*_\s|:]+$/.test(line)) continue;
    if (line.startsWith("<!--")) continue;
    const prose = trimEnd(
      line.replace(/^([-*+]|\d+[.)])\s+/, "").replace(/^>\s?/, "")
    ).trim();
    if (prose === "") continue;
    return firstSentence(prose);
  }
  return null;
}
function* plans(recentCount) {
  const base = {
    recentCount,
    tocEnabled: true,
    tocLimit: null,
    includeAdr: true,
    archMode: "full"
  };
  for (let r = recentCount; r >= 1; r--) yield { ...base, recentCount: r };
  const stage1 = { ...base, recentCount: 0 };
  yield stage1;
  const stage2 = { ...stage1, tocLimit: STAGE2_TOC_LIMIT };
  yield stage2;
  const stage3 = { ...stage2, includeAdr: false };
  yield stage3;
  const stage4 = { ...stage3, archMode: "outline" };
  yield stage4;
  const stage5 = { ...stage4, tocEnabled: false };
  yield stage5;
  const stage6 = { ...stage5, archMode: "headings" };
  yield stage6;
  yield { ...stage6, archMode: "none" };
}
function renderAdrSummary(section, entries) {
  const lines = entries.length > 0 ? entries.map((e) => `- ${e.id}: ${e.title}(${e.status ?? "\u72B6\u614B\u4E0D\u660E"})`) : ["(\u307E\u3060 ADR \u306F\u7121\u3044)"];
  return [
    toLf(section.headingLine),
    "",
    ...lines,
    "",
    "ADR \u306E\u5168\u6587\u306F `node M get adr` \u3067\u53D6\u5F97\u3059\u308B\u3053\u3068(\u6CE8\u5165\u306B\u306F\u8F09\u305B\u306A\u3044)\u3002"
  ].join("\n");
}
function renderArchitecture(config, arch, plan) {
  const head = `## \u6280\u8853\u7684\u524D\u63D0(${config.architectureRelative})`;
  const readAll = `\u5168\u6587\u306F ${config.architecturePath} \u3092 Read \u3059\u308B\u3053\u3068`;
  if (plan.archMode === "none") {
    return `${head}

${readAll}\u3002`;
  }
  const listed = arch.doc.sections.filter((s) => s.heading !== ADR_HEADING);
  if (plan.archMode === "headings") {
    return [
      head,
      "",
      `${readAll}(\u4EE5\u4E0B\u306F\u7BC0\u306E\u4E00\u89A7)\u3002`,
      "",
      ...listed.map((s) => `- ${s.heading}`)
    ].join("\n");
  }
  if (plan.archMode === "outline") {
    return [
      head,
      "",
      `${readAll}(\u4EE5\u4E0B\u306F\u76EE\u6B21\u3068\u5404\u7BC0\u306E\u8981\u7D04 1 \u884C)\u3002`,
      "",
      ...listed.map((s) => {
        const summary = summarizeSection(s);
        return summary === null ? `- ${s.heading}` : `- ${s.heading}: ${summary}`;
      })
    ].join("\n");
  }
  const parts = [];
  let adrDropped = false;
  for (const section of arch.doc.sections) {
    if (section.heading === ADR_HEADING) {
      if (!plan.includeAdr) {
        adrDropped = true;
        continue;
      }
      parts.push(renderAdrSummary(section, arch.adrEntries));
      continue;
    }
    const raw = trimEnd(toLf(section.raw));
    if (raw !== "") parts.push(raw);
  }
  if (adrDropped) {
    parts.push("ADR \u4E00\u89A7\u306F\u5272\u611B\u3057\u305F\u3002`node M get adr` \u3067\u53D6\u5F97\u3059\u308B\u3053\u3068\u3002");
  }
  return [head, ...parts].join("\n\n");
}
function tocLine(entry) {
  const title = entry.tag === null ? entry.title : `~~${entry.title}~~([${entry.tag}])`;
  return `- [${entry.date}] ${entry.id}: ${title}`;
}
function pickRecent(entries, count) {
  if (count <= 0) return [];
  const picked = [];
  for (const entry of entries) {
    if (entry.tag !== null) continue;
    picked.push(entry);
    if (picked.length >= count) break;
  }
  return picked;
}
function renderGotchas(config, gotchas, plan) {
  const total = gotchas.entries.length;
  const parts = [
    `## \u65E2\u77E5\u306E\u843D\u3068\u3057\u7A74(${config.gotchasRelative}: \u5168 ${total} \u4EF6)`
  ];
  if (plan.tocEnabled) {
    const limit = plan.tocLimit === null ? total : Math.min(plan.tocLimit, total);
    const shown = gotchas.entries.slice(0, limit);
    const toc = ["### \u76EE\u6B21(\u65B0\u3057\u3044\u9806)"];
    if (shown.length === 0) toc.push("(\u307E\u3060\u8A18\u9332\u306F\u7121\u3044)");
    else toc.push(...shown.map(tocLine));
    const rest = total - shown.length;
    if (rest > 0) {
      toc.push(`- \u307B\u304B ${rest} \u4EF6\u306F \`node M get gotchas\` \u3067\u53D6\u5F97\u3059\u308B\u3053\u3068\u3002`);
    }
    parts.push(toc.join("\n"));
  } else if (total > 0) {
    parts.push("\u4E00\u89A7\u306F `node M get gotchas` \u3067\u53D6\u5F97\u3059\u308B\u3053\u3068\u3002");
  }
  const recent = pickRecent(gotchas.entries, plan.recentCount);
  if (recent.length > 0) {
    parts.push(
      [
        `### \u76F4\u8FD1 ${recent.length} \u4EF6(\u5168\u6587)`,
        "",
        recent.map((e) => trimEnd(toLf(e.raw))).join("\n\n")
      ].join("\n")
    );
  }
  return parts.join("\n\n");
}
function render(input, plan) {
  const blocks = [input.guide];
  if (input.warnings.length > 0) {
    blocks.push(input.warnings.map((w) => `\u203B\u6CE8\u610F: ${w}`).join("\n"));
  }
  if (input.arch !== null) {
    blocks.push(renderArchitecture(input.config, input.arch, plan));
  }
  if (input.gotchas !== null) {
    blocks.push(renderGotchas(input.config, input.gotchas, plan));
  }
  return `${blocks.join("\n\n")}
`;
}
function build(config, env) {
  const arch = readArchitecture(config);
  const gotchas = readGotchas(config);
  if (arch === null && gotchas === null) return null;
  const guide = buildGuide(metatronCliPath(env));
  const warnings = [
    ...config.warnings,
    ...arch?.warnings ?? [],
    ...gotchas?.warnings ?? []
  ].slice(0, MAX_WARNING_LINES);
  const input = { config, guide, warnings, arch, gotchas };
  const budget = Math.max(1, config.injection.maxChars);
  const startCount = Math.min(
    config.injection.gotchasRecentCount,
    gotchas?.entries.length ?? 0
  );
  for (const plan of plans(startCount)) {
    const content = render(input, plan);
    if (content.length <= budget) return content;
  }
  return `${guide}
`;
}
function readHookInput() {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      process.stdin.destroy();
      finish({});
    }, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        finish(
          typeof parsed === "object" && parsed !== null ? parsed : {}
        );
      } catch {
        finish({});
      }
    });
    process.stdin.on("error", () => finish({}));
  });
}
try {
  const hookInput = await readHookInput();
  const startDir = typeof hookInput.cwd === "string" && hookInput.cwd !== "" ? hookInput.cwd : process.cwd();
  const config = loadConfig(startDir);
  if (config.injection.enabled) {
    const content = build(config, process.env);
    if (content !== null) injectContext(content);
  }
} catch {
}
