#!/usr/bin/env node

// src/lib/architecture.ts
var ARCHITECTURE_TITLE = "# ARCHITECTURE";
var ARCHITECTURE_HEADINGS = [
  "\u30B7\u30B9\u30C6\u30E0\u6982\u8981",
  "\u6280\u8853\u30B9\u30BF\u30C3\u30AF",
  "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210",
  "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7",
  "\u30B3\u30DE\u30F3\u30C9\u5B9A\u7FA9",
  "\u30C6\u30B9\u30C8\u65B9\u91DD",
  "\u7981\u6B62\u4E8B\u9805",
  "\u5909\u66F4\u6642\u306E\u8FFD\u968F"
];
var LEGACY_HEADINGS = {
  \u30EC\u30A4\u30E4\u30FC\u69CB\u9020: "\u30EC\u30A4\u30E4\u30FC\u3068\u8A31\u3055\u308C\u308B\u4F9D\u5B58\u65B9\u5411\u306F\u300C\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u300D\u3001\u7981\u6B62\u3059\u308B\u4F9D\u5B58\u65B9\u5411\u306F\u300C\u7981\u6B62\u4E8B\u9805\u300D",
  \u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u3068\u8CAC\u52D9: "\u300C\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u300D",
  \u4FDD\u8B77\u30D1\u30B9: "\u89E6\u3089\u306A\u3044\u30D1\u30B9\u306F\u300C\u7981\u6B62\u4E8B\u9805\u300D\u3001\u5909\u66F4\u306B\u614E\u91CD\u3092\u8981\u3059\u308B\u30D1\u30B9\u306F\u300C\u5909\u66F4\u6642\u306E\u8FFD\u968F\u300D"
};
var ARCHITECTURE_LINE_LIMIT = 200;
function splitTextLines(text) {
  if (text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function countArchitectureLines(text) {
  return splitTextLines(text).length;
}
function lineLimitWarning(lineCount) {
  if (lineCount <= ARCHITECTURE_LINE_LIMIT) return null;
  return `ARCHITECTURE \u304C ${String(lineCount)} \u884C\u3042\u308A\u3001\u76EE\u5B89\u306E ${String(ARCHITECTURE_LINE_LIMIT)} \u884C\u3092\u8D85\u3048\u3066\u3044\u307E\u3059\u3002\u524A\u308C\u308B\u5185\u5BB9(writing-discipline.md \u306E\u300C\u524A\u308C\u308B\u5185\u5BB9\u300D)\u3092\u6D17\u3044\u51FA\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
}
var DOMAINS_HEADING = "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7";
var DOMAINS_MARKER = "metatron:domains";
var RETIRED_PSEUDO_KEYS = /* @__PURE__ */ new Set(["overview"]);
var UNCLOSED_FENCE_WARNING = "\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u304C\u3042\u308A\u307E\u3059\u3002\u672A\u9589\u30D5\u30A7\u30F3\u30B9\u4EE5\u964D\u3092 1 \u30BB\u30AF\u30B7\u30E7\u30F3\u3068\u3057\u3066\u6271\u3044\u307E\u3057\u305F\u3002";
function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, "\n");
}
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
  const scan2 = scanFences(text);
  const lines = scan2.lines;
  const eol = scan2.eol;
  const starts = [];
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (scan2.insideFence[i]) continue;
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
    error: scan2.unclosed ? "unclosed_fence" : null,
    warnings
  };
}
function parseArchitectureForRead(text) {
  const doc = parseArchitecture(text);
  if (doc.error === null) return doc;
  return { ...doc, warnings: [...doc.warnings, UNCLOSED_FENCE_WARNING] };
}
function parseArchitectureForWrite(text) {
  const doc = parseArchitecture(text);
  if (doc.error !== null) {
    return {
      ok: false,
      error: doc.error,
      message: "\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u304C\u3042\u308B\u305F\u3081\u3001\u30BB\u30AF\u30B7\u30E7\u30F3\u306E\u5DEE\u3057\u66FF\u3048\u3092\u884C\u3044\u307E\u305B\u3093\u3002\u30D5\u30A7\u30F3\u30B9\u3092\u9589\u3058\u3066\u304B\u3089\u518D\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      warnings: doc.warnings
    };
  }
  return { ok: true, doc, warnings: doc.warnings };
}
function findSection(doc, heading) {
  return doc.sections.find((s) => s.heading === heading);
}
function isArchitectureHeading(value) {
  return ARCHITECTURE_HEADINGS.includes(value);
}
function canonicalIndex(heading) {
  return ARCHITECTURE_HEADINGS.indexOf(heading);
}
function validateHeadingKey(heading, options = {}) {
  if (typeof heading !== "string" || heading.trim() === "") {
    return {
      ok: false,
      error: "unknown_heading",
      message: `heading \u304C\u7A7A\u3067\u3059\u3002\u6307\u5B9A\u3067\u304D\u308B\u306E\u306F ${ARCHITECTURE_HEADINGS.join(" / ")} \u306E\u3044\u305A\u308C\u304B\u3067\u3059\u3002`
    };
  }
  const value = heading.trim();
  if (RETIRED_PSEUDO_KEYS.has(value.toLowerCase())) {
    return {
      ok: false,
      error: "retired_overview_key",
      message: "`overview` \u7591\u4F3C\u30AD\u30FC\u306F\u5EC3\u6B62\u3057\u307E\u3057\u305F\u3002\u5192\u982D\u306E\u6982\u8981\u306F `\u30B7\u30B9\u30C6\u30E0\u6982\u8981` \u30BB\u30AF\u30B7\u30E7\u30F3\u306B\u66F8\u3044\u3066\u304F\u3060\u3055\u3044\u3002"
    };
  }
  if (options.allowUnlisted === true) return { ok: true, heading: value };
  if (!isArchitectureHeading(value)) {
    const destination = Object.hasOwn(LEGACY_HEADINGS, value) ? LEGACY_HEADINGS[value] : void 0;
    const legacyHint = destination === void 0 ? "" : ` \u300C${value}\u300D\u306F\u5EC3\u6B62\u3057\u305F\u65E7\u898B\u51FA\u3057\u3067\u3059\u3002\u672C\u6587\u306E\u79FB\u3057\u5148\u306F ${destination} \u3067\u3059\u3002/metatron:update \u306E\u65E7\u69CB\u6210\u306E\u79FB\u884C\u3067\u65B0\u3057\u3044\u898B\u51FA\u3057\u3078\u79FB\u3057\u3066\u304B\u3089\u3001{ "heading": "${value}", "remove": true } \u3067\u65E7\u898B\u51FA\u3057\u3092\u524A\u9664\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
    return {
      ok: false,
      error: "unknown_heading",
      message: `\u672A\u77E5\u306E\u898B\u51FA\u3057\u300C${value}\u300D\u3067\u3059\u3002\u6307\u5B9A\u3067\u304D\u308B\u306E\u306F ${ARCHITECTURE_HEADINGS.join(" / ")} \u306E\u3044\u305A\u308C\u304B\u3067\u3059\u3002${legacyHint}`
    };
  }
  return { ok: true, heading: value };
}
function isDomainsInfo(info) {
  const tokens = info.trim().split(/[ \t]+/).filter(Boolean);
  return tokens.length === 2 && tokens[0] === "json" && tokens[1] === DOMAINS_MARKER;
}
function findDomainsBlock(text) {
  const lines = splitLines(text);
  const blocks = [];
  const warnings = [];
  let fence = null;
  let openIndex = -1;
  let isTarget = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (fence) {
      if (isFenceClose(t, fence)) {
        if (isTarget) {
          blocks.push({
            fenceLine: openIndex,
            content: joinRaw(lines, openIndex + 1, i),
            closed: true
          });
        }
        fence = null;
        isTarget = false;
      }
      continue;
    }
    const open = matchFenceOpen(t);
    if (open) {
      fence = open;
      openIndex = i;
      isTarget = isDomainsInfo(open.info);
    }
  }
  if (fence && isTarget) {
    blocks.push({
      fenceLine: openIndex,
      content: joinRaw(lines, openIndex + 1, lines.length),
      closed: false
    });
  }
  if (blocks.length > 1) {
    warnings.push(
      `\`${DOMAINS_MARKER}\` \u30D6\u30ED\u30C3\u30AF\u304C ${blocks.length} \u500B\u3042\u308A\u307E\u3059\u3002\u6700\u521D\u306E\u3082\u306E\u3060\u3051\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002`
    );
  }
  if (blocks.length > 0 && !blocks[0].closed) {
    warnings.push(
      `\`${DOMAINS_MARKER}\` \u30D6\u30ED\u30C3\u30AF\u304C\u9589\u3058\u3066\u3044\u307E\u305B\u3093\u3002\u30D5\u30A1\u30A4\u30EB\u7D42\u7AEF\u307E\u3067\u3092\u5185\u5BB9\u3068\u3057\u3066\u6271\u3044\u307E\u3057\u305F\u3002`
    );
  } else if (fence !== null) {
    warnings.push(
      `\`${DOMAINS_MARKER}\` \u306E\u8D70\u67FB\u4E2D\u306B\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u3092\u691C\u51FA\u3057\u307E\u3057\u305F\u3002\u30DE\u30FC\u30AB\u30FC\u304C\u30D5\u30A7\u30F3\u30B9\u5185\u306B\u53D6\u308A\u8FBC\u307E\u308C\u3066\u3044\u306A\u3044\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    );
  }
  return { block: blocks[0] ?? null, warnings };
}
function validateDomainsValue(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      reason: "not_an_object",
      message: `\`${DOMAINS_MARKER}\` \u306E\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u306F\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059(\u914D\u5217\u30FBnull \u306F\u4E0D\u53EF)\u3002`
    };
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return {
      ok: false,
      reason: "no_domains",
      message: `\`${DOMAINS_MARKER}\` \u306B\u30C9\u30E1\u30A4\u30F3\u304C 1 \u500B\u3082\u3042\u308A\u307E\u305B\u3093\u3002\u5206\u5272\u304C\u99B4\u67D3\u307E\u306A\u3044\u5834\u5408\u306F {"generic": ["**"]} \u306B\u7E2E\u9000\u3055\u305B\u3066\u304F\u3060\u3055\u3044\u3002`
    };
  }
  for (const [key, globs] of entries) {
    if (!Array.isArray(globs) || globs.length === 0) {
      return {
        ok: false,
        reason: "invalid_globs",
        message: `\u30C9\u30E1\u30A4\u30F3\u300C${key}\u300D\u306E\u5024\u304C 1 \u8981\u7D20\u4EE5\u4E0A\u306E\u914D\u5217\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002`
      };
    }
    if (globs.some((g) => typeof g !== "string")) {
      return {
        ok: false,
        reason: "invalid_globs",
        message: `\u30C9\u30E1\u30A4\u30F3\u300C${key}\u300D\u306E\u5024\u306B\u6587\u5B57\u5217\u3067\u306A\u3044\u8981\u7D20\u304C\u3042\u308A\u307E\u3059\u3002`
      };
    }
  }
  return { ok: true, domains: value };
}
function parseDomainsContent(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      reason: "invalid_json",
      message: `\`${DOMAINS_MARKER}\` \u30D6\u30ED\u30C3\u30AF\u304C\u6709\u52B9\u306A JSON \u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002`
    };
  }
  return validateDomainsValue(parsed);
}
function extractDomains(text) {
  const { block, warnings } = findDomainsBlock(text);
  if (!block) {
    return {
      ok: false,
      domains: null,
      reason: "block_not_found",
      message: `\`${DOMAINS_MARKER}\` \u30D6\u30ED\u30C3\u30AF\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002`,
      warnings
    };
  }
  const result = parseDomainsContent(block.content);
  if (!result.ok) {
    return {
      ok: false,
      domains: null,
      reason: result.reason,
      message: result.message,
      warnings
    };
  }
  return {
    ok: true,
    domains: result.domains,
    reason: null,
    message: null,
    warnings
  };
}
function normalizeBody(body, eol) {
  const unified = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = unified.replace(/^\n+/, "").replace(/[ \t\n]+$/, "");
  if (trimmed === "") return "";
  return trimmed.split("\n").join(eol);
}
function buildSectionText(heading, body, eol, trailingBlank) {
  const normalized = normalizeBody(body, eol);
  if (normalized === "") {
    return trailingBlank ? `## ${heading}${eol}${eol}` : `## ${heading}${eol}`;
  }
  const head = `## ${heading}${eol}${eol}`;
  return `${head}${normalized}${eol}${trailingBlank ? eol : ""}`;
}
function insertionAnchor(doc, heading) {
  const target = canonicalIndex(heading);
  if (target < 0) return null;
  for (const section of doc.sections) {
    const idx = canonicalIndex(section.heading);
    if (idx >= 0 && idx > target) return section.startLine;
  }
  return null;
}
function createArchitecture(changes, eol) {
  const ordered = [...changes].sort(
    (a, b) => canonicalIndex(a.heading) - canonicalIndex(b.heading)
  );
  let out = `${ARCHITECTURE_TITLE}${eol}${eol}`;
  for (const change of ordered) {
    out += buildSectionText(change.heading, change.body ?? "", eol, true);
  }
  return out.replace(/(\r?\n)+$/, eol);
}
function applySectionChanges(current, changes) {
  const warnings = [];
  const text = current ?? "";
  const eol = detectEol(text);
  if (text.trim() === "") {
    const created = createArchitecture(
      changes.filter((c) => c.remove !== true),
      eol
    );
    return rejectBrokenResult(text, created, warnings) ?? {
      ok: true,
      text: created,
      created: true,
      applied: changes.filter((c) => c.remove !== true).map((c) => ({ heading: c.heading, mode: "added" })),
      warnings
    };
  }
  const parsed = parseArchitectureForWrite(text);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      message: parsed.message,
      warnings: [...warnings, ...parsed.warnings]
    };
  }
  const doc = parsed.doc;
  warnings.push(...doc.warnings);
  const lines = splitLines(text);
  const chunks = lines.map((l) => l.raw);
  const ops = [];
  const applied = [];
  const removedRanges = changes.filter((c) => c.remove === true).map((c) => findSection(doc, c.heading)).filter((s) => s !== void 0);
  const isRemovedLine = (index) => removedRanges.some((s) => index >= s.startLine && index < s.endLine);
  const appended = [];
  for (const change of changes) {
    const order = canonicalIndex(change.heading);
    const section = findSection(doc, change.heading);
    if (change.remove === true) {
      if (!section) continue;
      ops.push({
        start: section.startLine,
        end: section.endLine,
        text: "",
        order,
        touchesEnd: section.endLine === lines.length
      });
      applied.push({ heading: change.heading, mode: "removed" });
      continue;
    }
    if (section) {
      const body = normalizeBody(change.body ?? "", eol);
      ops.push({
        start: section.startLine + 1,
        end: section.contentEndLine,
        text: body === "" ? "" : `${eol}${body}${eol}`,
        order,
        touchesEnd: section.endLine === lines.length
      });
      applied.push({ heading: change.heading, mode: "replaced" });
      continue;
    }
    const anchor = insertionAnchor(doc, change.heading);
    if (anchor !== null) {
      ops.push({
        start: anchor,
        end: anchor,
        text: buildSectionText(change.heading, change.body ?? "", eol, true),
        order
      });
    } else {
      appended.push(change);
    }
    applied.push({ heading: change.heading, mode: "added" });
  }
  if (appended.length > 0) {
    let lastIndex = lines.length - 1;
    while (lastIndex >= 0 && isRemovedLine(lastIndex)) lastIndex--;
    const last = lastIndex >= 0 ? lines[lastIndex] : void 0;
    let prefix = "";
    if (last !== void 0) {
      if (!last.raw.endsWith("\n")) prefix += eol;
      if (last.text.trim() !== "") prefix += eol;
    }
    const body = [...appended].sort((a, b) => canonicalIndex(a.heading) - canonicalIndex(b.heading)).map((c) => buildSectionText(c.heading, c.body ?? "", eol, true)).join("");
    ops.push({
      start: lines.length,
      end: lines.length,
      text: prefix + body,
      order: Number.MAX_SAFE_INTEGER,
      touchesEnd: true
    });
  }
  ops.sort((a, b) => b.start - a.start || b.order - a.order);
  for (const op of ops) chunks.splice(op.start, op.end - op.start, op.text);
  let next = chunks.join("");
  if (ops.some((op) => op.touchesEnd === true)) {
    const endEol = /\r\n$/.test(text) ? "\r\n" : /\n$/.test(text) ? "\n" : eol;
    next = next.replace(/(?:[ \t]*\r?\n)+$/, endEol);
  }
  return rejectBrokenResult(text, next, warnings) ?? {
    ok: true,
    text: next,
    created: false,
    applied,
    warnings
  };
}
function rejectBrokenResult(before, text, warnings) {
  if (parseArchitecture(text).error === "unclosed_fence") {
    return {
      ok: false,
      error: "unclosed_fence",
      message: "\u5DEE\u3057\u66FF\u3048\u305F\u5F8C\u306E\u6587\u66F8\u306B\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u304C\u3042\u308A\u307E\u3059\u3002body \u306E\u30D5\u30A7\u30F3\u30B9\u3092\u9589\u3058\u3066\u304F\u3060\u3055\u3044\u3002",
      warnings
    };
  }
  const isBroken = (result) => !result.ok && result.reason !== "block_not_found";
  const domains = extractDomains(text);
  if (isBroken(domains) && !isBroken(extractDomains(before))) {
    return {
      ok: false,
      error: "invalid_domains",
      message: `\u5DEE\u3057\u66FF\u3048\u305F\u5F8C\u306E\u6587\u66F8\u306E \`${DOMAINS_MARKER}\` \u30D6\u30ED\u30C3\u30AF\u3092\u8AAD\u3081\u307E\u305B\u3093: ${domains.message}`,
      warnings
    };
  }
  return null;
}
function prepareArchitectureUpdate(current, changes) {
  const warnings = [];
  if (!Array.isArray(changes) || changes.length === 0) {
    return {
      ok: false,
      error: "empty_changes",
      message: "sections \u304C\u7A7A\u3067\u3059\u3002\u5DEE\u3057\u66FF\u3048\u308B\u898B\u51FA\u3057\u3092 1 \u3064\u4EE5\u4E0A\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      warnings
    };
  }
  const normalizedChanges = [];
  const seen = /* @__PURE__ */ new Set();
  for (const change of changes) {
    const remove = change?.remove;
    if (remove !== void 0 && remove !== true) {
      return {
        ok: false,
        error: "invalid_input",
        message: "remove \u306F true \u306E\u3068\u304D\u3060\u3051\u6307\u5B9A\u3067\u304D\u307E\u3059\u3002false \u3084 true \u4EE5\u5916\u306E\u5024\u306F\u53D7\u3051\u4ED8\u3051\u307E\u305B\u3093\u3002",
        warnings
      };
    }
    const isRemove = remove === true;
    const validated = validateHeadingKey(change?.heading, {
      allowUnlisted: isRemove
    });
    if (!validated.ok) {
      return {
        ok: false,
        error: validated.error,
        message: validated.message,
        warnings
      };
    }
    if (seen.has(validated.heading)) {
      return {
        ok: false,
        error: "duplicate_heading",
        message: `\u300C${validated.heading}\u300D\u304C sections \u306B 2 \u56DE\u4EE5\u4E0A\u3042\u308A\u307E\u3059\u30021 \u56DE\u306B\u307E\u3068\u3081\u3066\u304F\u3060\u3055\u3044\u3002`,
        warnings
      };
    }
    seen.add(validated.heading);
    if (isRemove) {
      if (change?.body !== void 0) {
        return {
          ok: false,
          error: "invalid_input",
          message: `\u300C${validated.heading}\u300D\u306B remove \u3068 body \u3092\u540C\u6642\u306B\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093\u3002\u524A\u9664\u306A\u3089 body \u3092\u66F8\u304B\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002`,
          warnings
        };
      }
      normalizedChanges.push({ heading: validated.heading, remove: true });
      continue;
    }
    if (typeof change?.body !== "string") {
      return {
        ok: false,
        error: "invalid_body",
        message: `\u300C${validated.heading}\u300D\u306E body \u304C\u6587\u5B57\u5217\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002`,
        warnings
      };
    }
    const body = normalizeNewlines(change.body);
    if (scanFences(body).unclosed) {
      return {
        ok: false,
        error: "unclosed_fence",
        message: `\u300C${validated.heading}\u300D\u306E body \u306B\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u304C\u3042\u308A\u307E\u3059\u3002body \u306E\u4E2D\u3067\u30D5\u30A7\u30F3\u30B9\u3092\u9589\u3058\u3066\u304F\u3060\u3055\u3044\u3002`,
        warnings
      };
    }
    const bodyScan = scanFences(body);
    const stray = bodyScan.lines.findIndex(
      (line, i) => !bodyScan.insideFence[i] && HEADING_RE.test(line.text)
    );
    if (stray >= 0) {
      return {
        ok: false,
        error: "invalid_body",
        message: `\u300C${validated.heading}\u300D\u306E body \u306B \`## \` \u306E\u898B\u51FA\u3057(${bodyScan.lines[stray].text.trim()})\u304C\u3042\u308A\u307E\u3059\u3002\u5C0F\u898B\u51FA\u3057\u306F \`### \` \u4EE5\u4E0B\u3067\u66F8\u3044\u3066\u304F\u3060\u3055\u3044\u3002`,
        warnings
      };
    }
    normalizedChanges.push({ heading: validated.heading, body });
  }
  const removals = normalizedChanges.filter((c) => c.remove === true);
  if (removals.length > 0) {
    const parsed = parseArchitectureForWrite(current ?? "");
    if (!parsed.ok) {
      return {
        ok: false,
        error: parsed.error,
        message: parsed.message,
        warnings: [...warnings, ...parsed.warnings]
      };
    }
    for (const removal of removals) {
      if (findSection(parsed.doc, removal.heading) === void 0) {
        return {
          ok: false,
          error: "section_not_found",
          message: `\u300C${removal.heading}\u300D\u306F ARCHITECTURE \u306B\u5B58\u5728\u3057\u307E\u305B\u3093\u3002\u524A\u9664\u3067\u304D\u308B\u306E\u306F\u5B58\u5728\u3059\u308B\u7BC0\u3060\u3051\u3067\u3059\u3002`,
          warnings
        };
      }
    }
  }
  const domainsChange = normalizedChanges.find(
    (c) => c.heading === DOMAINS_HEADING && c.remove !== true
  );
  if (domainsChange) {
    const lookup = findDomainsBlock(domainsChange.body ?? "");
    if (!lookup.block) {
      warnings.push(
        `\`## ${DOMAINS_HEADING}\` \u306B \`${DOMAINS_MARKER}\` \u30D6\u30ED\u30C3\u30AF\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u6A5F\u68B0\u53EF\u8AAD\u306A\u5199\u50CF\u304C\u5931\u308F\u308C\u307E\u3059\u3002`
      );
    } else {
      warnings.push(...lookup.warnings);
      const validated = parseDomainsContent(lookup.block.content);
      if (!validated.ok) {
        return {
          ok: false,
          error: "invalid_domains",
          message: validated.message,
          warnings
        };
      }
    }
  }
  const result = applySectionChanges(current, normalizedChanges);
  return { ...result, warnings: [...warnings, ...result.warnings] };
}

// src/lib/config.ts
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
var CONFIG_FILENAME = "metatron.config.json";
var SUPPORTED_VERSION = 1;
var DEFAULT_ARCHITECTURE_PATH = "docs/ARCHITECTURE.md";
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function realpathOrSelf(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}
function hasConfigFile(dir) {
  try {
    return fs.existsSync(path.join(dir, CONFIG_FILENAME));
  } catch {
    return false;
  }
}
function existsGit(dir) {
  try {
    return fs.existsSync(path.join(dir, ".git"));
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
  if (hasConfigFile(start)) return start;
  const top = gitToplevel(start);
  let dir = start;
  while (true) {
    if (hasConfigFile(dir)) return dir;
    if (top ? dir === top : existsGit(dir)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
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
function defaultsFor(docRoot, warnings) {
  return {
    docRoot,
    configPath: path.join(docRoot, CONFIG_FILENAME),
    configExists: false,
    architecturePath: path.resolve(docRoot, DEFAULT_ARCHITECTURE_PATH),
    architectureRelative: DEFAULT_ARCHITECTURE_PATH,
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
    if (fs.existsSync(configPath)) {
      configExists = true;
      parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
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
  return {
    docRoot,
    configPath,
    configExists,
    architecturePath: architecture.absolute,
    architectureRelative: architecture.relative,
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

// src/lib/scan.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";
var ARCHITECTURE_SECTIONS = [
  "\u30B7\u30B9\u30C6\u30E0\u6982\u8981",
  "\u6280\u8853\u30B9\u30BF\u30C3\u30AF",
  "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210",
  "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7",
  "\u30B3\u30DE\u30F3\u30C9\u5B9A\u7FA9",
  "\u30C6\u30B9\u30C8\u65B9\u91DD",
  "\u7981\u6B62\u4E8B\u9805",
  "\u5909\u66F4\u6642\u306E\u8FFD\u968F"
];
var LEGACY_SECTIONS = {
  \u30EC\u30A4\u30E4\u30FC\u69CB\u9020: '## \u30EC\u30A4\u30E4\u30FC\u69CB\u9020 \u306F 0.6.4 \u3067\u5EC3\u6B62\u3057\u305F\u65E7\u898B\u51FA\u3057\u3067\u3059\u3002\u30EC\u30A4\u30E4\u30FC\u3068\u8A31\u3055\u308C\u308B\u4F9D\u5B58\u65B9\u5411\u306F ## \u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210 \u3078\u3001\u7981\u6B62\u3059\u308B\u4F9D\u5B58\u65B9\u5411\u306F ## \u7981\u6B62\u4E8B\u9805 \u3078\u79FB\u3057\u3001\u65E7\u898B\u51FA\u3057\u306F stage-architecture \u306E { "heading": "\u30EC\u30A4\u30E4\u30FC\u69CB\u9020", "remove": true } \u3067\u524A\u9664\u3057\u307E\u3059\u3002',
  \u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u3068\u8CAC\u52D9: '## \u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u3068\u8CAC\u52D9 \u306F 0.6.4 \u3067\u5EC3\u6B62\u3057\u305F\u65E7\u898B\u51FA\u3057\u3067\u3059\u3002\u672C\u6587\u3092 ## \u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210 \u3078\u79FB\u3057\u3001\u65E7\u898B\u51FA\u3057\u306F stage-architecture \u306E { "heading": "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u3068\u8CAC\u52D9", "remove": true } \u3067\u524A\u9664\u3057\u307E\u3059\u3002',
  \u4FDD\u8B77\u30D1\u30B9: '## \u4FDD\u8B77\u30D1\u30B9 \u306F 0.6.4 \u3067\u5EC3\u6B62\u3057\u305F\u65E7\u898B\u51FA\u3057\u3067\u3059\u3002\u89E6\u3089\u306A\u3044\u30D1\u30B9\u306F ## \u7981\u6B62\u4E8B\u9805 \u3078\u3001\u5909\u66F4\u306B\u614E\u91CD\u3092\u8981\u3059\u308B\u30D1\u30B9\u306F ## \u5909\u66F4\u6642\u306E\u8FFD\u968F \u3078\u79FB\u3057\u3001\u65E7\u898B\u51FA\u3057\u306F stage-architecture \u306E { "heading": "\u4FDD\u8B77\u30D1\u30B9", "remove": true } \u3067\u524A\u9664\u3057\u307E\u3059\u3002',
  "ADR \u4E00\u89A7": '## ADR \u4E00\u89A7 \u304C\u6B8B\u3063\u3066\u3044\u307E\u3059\u3002metatron \u306F ADR \u6A5F\u80FD\u3092\u5EC3\u6B62\u3057\u305F\u305F\u3081\u3001\u3053\u306E\u30BB\u30AF\u30B7\u30E7\u30F3\u3092\u7BA1\u7406\u3057\u307E\u305B\u3093\u3002\u672C\u6587\u3092\u6B8B\u3059\u306A\u3089\u5225\u306E\u30D5\u30A1\u30A4\u30EB\u3078\u5199\u3057\u3066\u304B\u3089\u3001stage-architecture \u306E { "heading": "ADR \u4E00\u89A7", "remove": true } \u3067\u524A\u9664\u3067\u304D\u307E\u3059\u3002'
};
var EXCLUDED_DIRECTORY_NAMES = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vercel",
  ".netlify",
  ".gradle",
  ".idea",
  ".pnpm-store"
]);
var LOCKFILES = [
  { file: "pnpm-lock.yaml", name: "pnpm" },
  { file: "yarn.lock", name: "yarn" },
  { file: "package-lock.json", name: "npm" },
  { file: "npm-shrinkwrap.json", name: "npm" },
  { file: "bun.lockb", name: "bun" },
  { file: "bun.lock", name: "bun" },
  { file: "deno.lock", name: "deno" },
  { file: "uv.lock", name: "uv" },
  { file: "poetry.lock", name: "poetry" },
  { file: "Pipfile.lock", name: "pipenv" },
  { file: "Cargo.lock", name: "cargo" },
  { file: "go.sum", name: "go" },
  { file: "composer.lock", name: "composer" },
  { file: "Gemfile.lock", name: "bundler" }
];
var JS_PACKAGE_MANAGERS = /* @__PURE__ */ new Set([
  "pnpm",
  "npm",
  "yarn",
  "bun"
]);
var TEST_DIRECTORY_NAMES = /* @__PURE__ */ new Set([
  "__tests__",
  "__test__",
  "tests",
  "test",
  "spec",
  "e2e"
]);
var TEST_CONFIG_PREFIXES = [
  { prefix: "vitest.config.", framework: "vitest" },
  { prefix: "vitest.workspace.", framework: "vitest" },
  { prefix: "jest.config.", framework: "jest" },
  { prefix: "playwright.config.", framework: "playwright" },
  { prefix: "cypress.config.", framework: "cypress" },
  { prefix: "karma.conf.", framework: "karma" },
  { prefix: ".mocharc.", framework: "mocha" }
];
var TEST_CONFIG_FILES = [
  { file: "cypress.json", framework: "cypress" },
  { file: "pytest.ini", framework: "pytest" },
  { file: "conftest.py", framework: "pytest" },
  { file: "tox.ini", framework: "tox" },
  { file: "phpunit.xml", framework: "phpunit" }
];
var TEST_DEPENDENCY_NAMES = /* @__PURE__ */ new Set([
  "vitest",
  "jest",
  "mocha",
  "ava",
  "tap",
  "uvu",
  "karma",
  "jasmine",
  "cypress",
  "playwright",
  "@playwright/test",
  "@jest/globals",
  "testing-library",
  "@testing-library/react",
  "node-tap"
]);
var DEFAULT_SCAN_LIMITS = {
  maxDepth: 3,
  maxEntries: 2e4,
  maxFiles: 2e3,
  maxTreeEntries: 2e3,
  maxTestFiles: 200,
  maxDomainSamples: 12,
  maxDocuments: 50,
  maxHeadingsPerDocument: 200
};
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
function readTextFile(file) {
  try {
    return fs2.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
function fileExists(file) {
  try {
    return fs2.statSync(file).isFile();
  } catch {
    return false;
  }
}
function readJsonFile(file) {
  const text = readTextFile(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function readJsoncFile(file) {
  const text = readTextFile(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    let stripped = "";
    let inString = false;
    let escaped = false;
    let i = 0;
    while (i < text.length) {
      const c = text[i] ?? "";
      if (inString) {
        stripped += c;
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        i += 1;
        continue;
      }
      if (c === '"') {
        inString = true;
        stripped += c;
        i += 1;
        continue;
      }
      if (c === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i += 1;
        continue;
      }
      if (c === "/" && text[i + 1] === "*") {
        i += 2;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
          i += 1;
        }
        i += 2;
        continue;
      }
      stripped += c;
      i += 1;
    }
    stripped = stripped.replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
}
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += (c ?? "").replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
function extractHeadings(text, maxHeadings) {
  const headings = [];
  let truncated = false;
  let fenceChar = null;
  let fenceLength = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const indent = /^ {0,3}/.exec(line)?.[0].length ?? 0;
    if (/^ {4,}/.test(line)) {
      continue;
    }
    const rest = line.slice(indent);
    if (fenceChar !== null) {
      const close = new RegExp(`^(\\${fenceChar}{${fenceLength},})[ \\t]*$`);
      if (close.test(rest)) {
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }
    const open = /^(`{3,}|~{3,})/.exec(rest);
    if (open) {
      const marker = open[1] ?? "";
      fenceChar = marker[0] ?? null;
      fenceLength = marker.length;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(rest);
    if (heading) {
      if (headings.length >= maxHeadings) {
        truncated = true;
        break;
      }
      headings.push({
        level: (heading[1] ?? "").length,
        text: (heading[2] ?? "").trim()
      });
    }
  }
  return { headings, truncated };
}
function stripFencedBlocks(text) {
  const kept = [];
  let fenceChar = null;
  let fenceLength = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const rest = /^ {4,}/.test(line) ? line : line.replace(/^ {0,3}/, "");
    if (fenceChar !== null) {
      const close = new RegExp(`^(\\${fenceChar}{${fenceLength},})[ \\t]*$`);
      if (close.test(rest)) {
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }
    const open = /^(`{3,}|~{3,})/.exec(rest);
    if (open) {
      const marker = open[1] ?? "";
      fenceChar = marker[0] ?? null;
      fenceLength = marker.length;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}
function extractInlineCode(text) {
  const out = [];
  const body = stripFencedBlocks(text);
  const re = /`([^`\n]+)`/g;
  let m = re.exec(body);
  while (m !== null) {
    const token = (m[1] ?? "").trim();
    if (token !== "") out.push(token);
    m = re.exec(body);
  }
  return out;
}
var GIT_REPOSITORY_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE"
];
function gitIgnoredPaths(root) {
  const env = { ...process.env };
  for (const key of GIT_REPOSITORY_ENV_KEYS) delete env[key];
  try {
    const res = spawnSync2(
      "git",
      [
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory"
      ],
      {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 1e4,
        // 既定の 1MB では ignore 済みのファイルが多いと ENOBUFS で失敗する。
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
      }
    );
    if (res.status !== 0 || typeof res.stdout !== "string") return null;
    return new Set(res.stdout.split("\0").filter((p) => p !== ""));
  } catch {
    return null;
  }
}
function isIgnored(ignored, rel, isDirectory) {
  return ignored.has(isDirectory ? `${rel}/` : rel);
}
function rootFile(root, ignored, rel) {
  return ignored.has(rel) ? null : path2.join(root, rel);
}
function readRootText(root, ignored, rel) {
  const file = rootFile(root, ignored, rel);
  return file === null ? null : readTextFile(file);
}
function recordFile(state, rel) {
  state.fileCount += 1;
  if (state.files.length < state.limits.maxFiles) state.files.push(rel);
  else state.truncation.files = true;
  const segments = rel.split("/");
  for (let depth = 1; depth <= 2 && depth < segments.length; depth++) {
    const prefix = segments.slice(0, depth).join("/");
    state.dirFileCounts.set(prefix, (state.dirFileCounts.get(prefix) ?? 0) + 1);
    const samples = state.dirSamples.get(prefix);
    if (samples === void 0) state.dirSamples.set(prefix, [rel]);
    else if (samples.length < state.limits.maxDomainSamples) samples.push(rel);
  }
  if (isTestFilePath(rel)) {
    if (state.testFiles.length < state.limits.maxTestFiles) {
      state.testFiles.push(rel);
    } else {
      state.truncation.testFiles = true;
    }
  }
}
function pushTree(state, rel, depth, type) {
  if (depth > state.limits.maxDepth) return;
  if (state.tree.length >= state.limits.maxTreeEntries) {
    state.truncation.tree = true;
    return;
  }
  state.tree.push({ path: rel, depth, type });
}
function walkDirectory(state, dir, rel, depth) {
  if (state.truncation.walk) return;
  let dirents;
  try {
    dirents = fs2.readdirSync(dir, { withFileTypes: true });
  } catch {
    state.unreadable.push(rel === "" ? "." : rel);
    return;
  }
  dirents.sort((a, b) => compareStrings(a.name, b.name));
  for (const dirent of dirents) {
    if (state.visited >= state.limits.maxEntries) {
      state.truncation.walk = true;
      return;
    }
    state.visited += 1;
    const childRel = rel === "" ? dirent.name : `${rel}/${dirent.name}`;
    if (isIgnored(state.ignored, childRel, dirent.isDirectory())) continue;
    if (dirent.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(dirent.name)) continue;
      if (depth + 1 <= 2) state.dirs.add(childRel);
      pushTree(state, childRel, depth + 1, "directory");
      walkDirectory(state, path2.join(dir, dirent.name), childRel, depth + 1);
    } else if (dirent.isFile()) {
      recordFile(state, childRel);
      pushTree(state, childRel, depth + 1, "file");
    } else if (dirent.isSymbolicLink()) {
      state.symlinks.push(childRel);
    }
  }
}
function isTestFilePath(rel) {
  return testFilePattern(rel) !== null;
}
function testFilePattern(rel) {
  const segments = rel.split("/");
  const base = segments[segments.length - 1] ?? "";
  const dotted = /^.+\.(test|spec)\.([A-Za-z0-9]+)$/.exec(base);
  if (dotted) return `*.${dotted[1]}.${dotted[2]}`;
  const pyPrefix = /^test_.+\.py$/.exec(base);
  if (pyPrefix) return "test_*.py";
  const underscore = /^.+_test\.([A-Za-z0-9]+)$/.exec(base);
  if (underscore) return `*_test.${underscore[1]}`;
  const suffixTest = /^.+Test\.(java|kt|kts|cs|scala)$/.exec(base);
  if (suffixTest) return `*Test.${suffixTest[1]}`;
  for (let i = 0; i < segments.length - 1; i++) {
    const dir = segments[i] ?? "";
    if (TEST_DIRECTORY_NAMES.has(dir)) {
      const ext = /\.([A-Za-z0-9]+)$/.exec(base)?.[1];
      return ext === void 0 ? `${dir}/*` : `${dir}/*.${ext}`;
    }
  }
  return null;
}
function scanPackageManager(root, ignored, packageJson, warnings) {
  const lockfiles = [];
  let name = null;
  for (const entry of LOCKFILES) {
    const file = rootFile(root, ignored, entry.file);
    if (file === null || !fileExists(file)) continue;
    lockfiles.push(entry.file);
    if (name === null) name = entry.name;
  }
  if (lockfiles.length > 1) {
    warnings.push(
      `lockfile \u304C\u8907\u6570\u3042\u308A\u307E\u3059(${lockfiles.join(", ")})\u3002\u512A\u5148\u9806\u4F4D\u306E\u5148\u982D ${String(name)} \u3092\u63A1\u7528\u3057\u307E\u3057\u305F\u3002`
    );
  }
  const field = packageJson?.packageManager;
  return {
    name,
    lockfiles,
    packageManagerField: typeof field === "string" ? field : null
  };
}
function tomlValue(text, key) {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']\\s*$`, "m");
  return re.exec(text)?.[1];
}
function scanLanguages(root, ignored, packageJson) {
  const out = [];
  if (packageJson !== null) {
    const details = {};
    const engines = packageJson.engines;
    if (isPlainObject2(engines)) {
      for (const [k, v] of Object.entries(engines)) {
        if (typeof v === "string") details[`engines.${k}`] = v;
      }
    }
    if (typeof packageJson.type === "string") details.type = packageJson.type;
    out.push({ name: "Node.js", source: "package.json", details });
  }
  const tsconfigPath = rootFile(root, ignored, "tsconfig.json");
  if (tsconfigPath !== null && fileExists(tsconfigPath)) {
    const details = {};
    const parsed = readJsoncFile(tsconfigPath);
    if (isPlainObject2(parsed)) {
      const options = parsed.compilerOptions;
      if (isPlainObject2(options)) {
        for (const key of ["target", "module", "moduleResolution", "strict"]) {
          const value = options[key];
          if (typeof value === "string" || typeof value === "boolean") {
            details[key] = String(value);
          }
        }
      }
    }
    out.push({ name: "TypeScript", source: "tsconfig.json", details });
  }
  const pyproject = readRootText(root, ignored, "pyproject.toml");
  if (pyproject !== null) {
    const details = {};
    const requires = tomlValue(pyproject, "requires-python");
    if (requires !== void 0) details["requires-python"] = requires;
    const name = tomlValue(pyproject, "name");
    if (name !== void 0) details.name = name;
    out.push({ name: "Python", source: "pyproject.toml", details });
  }
  const goMod = readRootText(root, ignored, "go.mod");
  if (goMod !== null) {
    const details = {};
    const moduleName = /^module\s+(\S+)\s*$/m.exec(goMod)?.[1];
    if (moduleName !== void 0) details.module = moduleName;
    const goVersion = /^go\s+(\S+)\s*$/m.exec(goMod)?.[1];
    if (goVersion !== void 0) details.go = goVersion;
    out.push({ name: "Go", source: "go.mod", details });
  }
  const cargo = readRootText(root, ignored, "Cargo.toml");
  if (cargo !== null) {
    const details = {};
    const edition = tomlValue(cargo, "edition");
    if (edition !== void 0) details.edition = edition;
    const rustVersion = tomlValue(cargo, "rust-version");
    if (rustVersion !== void 0) details["rust-version"] = rustVersion;
    const name = tomlValue(cargo, "name");
    if (name !== void 0) details.name = name;
    out.push({ name: "Rust", source: "Cargo.toml", details });
  }
  return out;
}
function toDependencyEntries(raw) {
  if (!isPlainObject2(raw)) return [];
  const out = [];
  for (const [name, version] of Object.entries(raw)) {
    out.push({ name, version: typeof version === "string" ? version : "" });
  }
  out.sort((a, b) => compareStrings(a.name, b.name));
  return out;
}
function classifyScript(name) {
  const key = name.toLowerCase().replace(/[-_:./\s]/g, "");
  if (key.includes("e2e") || key.includes("playwright") || key.includes("cypress")) {
    return "e2e";
  }
  if (key.includes("typecheck") || key.includes("tsc")) return "typecheck";
  if (key.includes("test") || key.includes("spec") || key.includes("vitest") || key.includes("jest")) {
    return "test";
  }
  if (key.includes("lint") || key.includes("biome") || key.includes("eslint")) {
    return "lint";
  }
  if (key.includes("build") || key.includes("compile") || key.includes("bundle")) {
    return "build";
  }
  return null;
}
function scanScripts(packageJson, packageManager) {
  const raw = packageJson?.scripts;
  if (!isPlainObject2(raw)) return { scripts: [], commands: [] };
  const scripts = [];
  for (const [name, command] of Object.entries(raw)) {
    if (typeof command !== "string") continue;
    scripts.push({ name, command });
  }
  scripts.sort((a, b) => compareStrings(a.name, b.name));
  const usable = packageManager !== null && JS_PACKAGE_MANAGERS.has(packageManager) ? packageManager : null;
  const commands = [];
  for (const script of scripts) {
    const kind = classifyScript(script.name);
    if (kind === null) continue;
    commands.push({
      kind,
      script: script.name,
      command: script.command,
      invocation: usable === null ? null : `${usable} run ${script.name}`
    });
  }
  return { scripts, commands };
}
function scanTestFrameworks(root, state, dependencies) {
  const configs = [];
  const seenConfigs = /* @__PURE__ */ new Set();
  for (const entry of state.tree) {
    if (entry.type !== "file") continue;
    if (entry.depth > 2) continue;
    const base = entry.path.split("/").pop() ?? "";
    let framework = null;
    for (const candidate of TEST_CONFIG_FILES) {
      if (base === candidate.file) framework = candidate.framework;
    }
    if (framework === null) {
      for (const candidate of TEST_CONFIG_PREFIXES) {
        if (base.startsWith(candidate.prefix)) framework = candidate.framework;
      }
    }
    if (framework === null) continue;
    const key = `${framework}\0${entry.path}`;
    if (seenConfigs.has(key)) continue;
    seenConfigs.add(key);
    configs.push({ framework, path: entry.path });
  }
  const pyproject = readRootText(root, state.ignored, "pyproject.toml");
  if (pyproject !== null && /^\s*\[tool\.pytest/m.test(pyproject)) {
    configs.push({ framework: "pytest", path: "pyproject.toml" });
  }
  configs.sort(
    (a, b) => compareStrings(a.framework, b.framework) || compareStrings(a.path, b.path)
  );
  const fromDependencies = [];
  for (const dep of [
    ...dependencies.dependencies,
    ...dependencies.devDependencies
  ]) {
    if (TEST_DEPENDENCY_NAMES.has(dep.name)) fromDependencies.push(dep.name);
  }
  fromDependencies.sort(compareStrings);
  const patternMap = /* @__PURE__ */ new Map();
  const directories = /* @__PURE__ */ new Set();
  for (const file of state.testFiles) {
    const pattern = testFilePattern(file);
    if (pattern === null) continue;
    const current = patternMap.get(pattern);
    if (current === void 0) {
      patternMap.set(pattern, { count: 1, examples: [file] });
    } else {
      current.count += 1;
      if (current.examples.length < 3) current.examples.push(file);
    }
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
    directories.add(dir);
  }
  const filePatterns = [...patternMap.entries()].map(([pattern, v]) => ({
    pattern,
    count: v.count,
    examples: v.examples
  })).sort((a, b) => b.count - a.count || compareStrings(a.pattern, b.pattern));
  return {
    configs,
    fromDependencies: [...new Set(fromDependencies)],
    filePatterns,
    directories: [...directories].sort(compareStrings)
  };
}
function scanDomainCandidates(state) {
  const out = [];
  for (const dir of state.dirs) {
    const depth = dir.split("/").length;
    if (depth === 2 && !dir.startsWith("src/")) continue;
    out.push({
      path: dir,
      name: dir.split("/").pop() ?? dir,
      fileCount: state.dirFileCounts.get(dir) ?? 0,
      samplePaths: state.dirSamples.get(dir) ?? []
    });
  }
  out.sort((a, b) => compareStrings(a.path, b.path));
  return out;
}
function collectMarkdownFiles(dir, rel, depth, maxDepth, out, limit, ignored) {
  if (depth > maxDepth || out.length >= limit) return;
  let dirents;
  try {
    dirents = fs2.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  dirents.sort((a, b) => compareStrings(a.name, b.name));
  for (const dirent of dirents) {
    if (out.length >= limit) return;
    const childRel = rel === "" ? dirent.name : `${rel}/${dirent.name}`;
    if (isIgnored(ignored, childRel, dirent.isDirectory())) continue;
    if (dirent.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(dirent.name)) continue;
      collectMarkdownFiles(
        path2.join(dir, dirent.name),
        childRel,
        depth + 1,
        maxDepth,
        out,
        limit,
        ignored
      );
    } else if (dirent.isFile() && /\.md$/i.test(dirent.name)) {
      out.push(childRel);
    }
  }
}
function scanDocuments(root, limits, truncation, ignored) {
  const targets = [];
  let rootEntries = [];
  try {
    rootEntries = fs2.readdirSync(root, { withFileTypes: true });
  } catch {
    rootEntries = [];
  }
  rootEntries.sort((a, b) => compareStrings(a.name, b.name));
  for (const dirent of rootEntries) {
    if (!dirent.isFile() || ignored.has(dirent.name)) continue;
    const lower = dirent.name.toLowerCase();
    if (lower === "readme.md" || lower === "claude.md")
      targets.push(dirent.name);
  }
  const docsDir = path2.join(root, "docs");
  const docsFiles = [];
  if (!isIgnored(ignored, "docs", true)) {
    collectMarkdownFiles(
      docsDir,
      "docs",
      1,
      3,
      docsFiles,
      limits.maxDocuments,
      ignored
    );
  }
  for (const file of docsFiles) targets.push(file);
  const documents = [];
  for (const rel of targets) {
    if (documents.length >= limits.maxDocuments) {
      truncation.documents = true;
      break;
    }
    const text = readTextFile(path2.join(root, rel));
    if (text === null) continue;
    const { headings, truncated } = extractHeadings(
      text,
      limits.maxHeadingsPerDocument
    );
    documents.push({ path: rel, headings, truncated });
  }
  return documents;
}
function scanInner(startDir, options) {
  const limits = { ...DEFAULT_SCAN_LIMITS, ...options.limits };
  const root = options.root !== void 0 ? path2.resolve(options.root) : findDocRoot(startDir);
  const warnings = [];
  const truncation = {
    walk: false,
    files: false,
    tree: false,
    testFiles: false,
    documents: false,
    notes: []
  };
  const ignored = gitIgnoredPaths(root);
  const state = {
    limits,
    tree: [],
    files: [],
    symlinks: [],
    fileCount: 0,
    testFiles: [],
    dirFileCounts: /* @__PURE__ */ new Map(),
    dirSamples: /* @__PURE__ */ new Map(),
    dirs: /* @__PURE__ */ new Set(),
    visited: 0,
    truncation,
    unreadable: [],
    ignored: ignored ?? /* @__PURE__ */ new Set()
  };
  walkDirectory(state, root, "", 0);
  if (state.unreadable.length > 0) {
    const shown = state.unreadable.slice(0, 5).join(", ");
    warnings.push(
      `\u8AAD\u3081\u306A\u304B\u3063\u305F\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u3092 ${String(state.unreadable.length)} \u4EF6\u30B9\u30AD\u30C3\u30D7\u3057\u307E\u3057\u305F(${shown})\u3002`
    );
  }
  const packageJsonPath = rootFile(root, state.ignored, "package.json");
  const packageJsonRaw = packageJsonPath === null ? null : readJsonFile(packageJsonPath);
  const packageJsonExists = packageJsonPath !== null && fileExists(packageJsonPath);
  const packageJson = isPlainObject2(packageJsonRaw) ? packageJsonRaw : null;
  if (packageJsonExists && packageJson === null) {
    warnings.push(
      "package.json \u3092 JSON \u3068\u3057\u3066\u8AAD\u3081\u306A\u304B\u3063\u305F\u305F\u3081\u3001\u4F9D\u5B58\u3068\u30B3\u30DE\u30F3\u30C9\u3092\u53CE\u96C6\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002"
    );
  }
  const packageManager = scanPackageManager(
    root,
    state.ignored,
    packageJson,
    warnings
  );
  const languages = scanLanguages(root, state.ignored, packageJson);
  const dependencies = {
    source: packageJson === null ? null : "package.json",
    dependencies: toDependencyEntries(packageJson?.dependencies),
    devDependencies: toDependencyEntries(packageJson?.devDependencies)
  };
  const { scripts, commands } = scanScripts(packageJson, packageManager.name);
  const testFrameworks = scanTestFrameworks(root, state, dependencies);
  const domainCandidates = scanDomainCandidates(state);
  const documents = scanDocuments(root, limits, truncation, state.ignored);
  if (truncation.walk) {
    truncation.notes.push(
      `\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u8D70\u67FB\u3092 ${String(limits.maxEntries)} \u30A8\u30F3\u30C8\u30EA\u3067\u6253\u3061\u5207\u308A\u307E\u3057\u305F\u3002`
    );
  }
  if (truncation.files) {
    truncation.notes.push(
      `\u30D5\u30A1\u30A4\u30EB\u4E00\u89A7\u3092 ${String(limits.maxFiles)} \u4EF6\u3067\u6253\u3061\u5207\u308A\u307E\u3057\u305F\u3002`
    );
  }
  if (truncation.tree) {
    truncation.notes.push(
      `\u30C4\u30EA\u30FC\u3092 ${String(limits.maxTreeEntries)} \u30A8\u30F3\u30C8\u30EA\u3067\u6253\u3061\u5207\u308A\u307E\u3057\u305F\u3002`
    );
  }
  if (truncation.testFiles) {
    truncation.notes.push(
      `\u30C6\u30B9\u30C8\u30D5\u30A1\u30A4\u30EB\u306E\u691C\u51FA\u3092 ${String(limits.maxTestFiles)} \u4EF6\u3067\u6253\u3061\u5207\u308A\u307E\u3057\u305F\u3002`
    );
  }
  if (truncation.documents) {
    truncation.notes.push(
      `\u898B\u51FA\u3057\u3092\u8AAD\u3080\u6587\u66F8\u3092 ${String(limits.maxDocuments)} \u4EF6\u3067\u6253\u3061\u5207\u308A\u307E\u3057\u305F\u3002`
    );
  }
  return {
    root,
    packageManager,
    languages,
    dependencies,
    scripts,
    commands,
    tree: state.tree,
    files: state.files,
    symlinks: state.symlinks,
    gitIgnoreApplied: ignored !== null,
    fileCount: state.fileCount,
    testFrameworks,
    domainCandidates,
    documents,
    truncation,
    warnings
  };
}
function scan(startDir, options = {}) {
  try {
    return scanInner(startDir, options);
  } catch (error) {
    let root;
    try {
      root = options.root ?? path2.resolve(startDir ?? process.cwd());
    } catch {
      root = options.root ?? startDir ?? ".";
    }
    const reason = error instanceof Error ? error.message : String(error);
    return {
      root,
      packageManager: {
        name: null,
        lockfiles: [],
        packageManagerField: null
      },
      languages: [],
      dependencies: { source: null, dependencies: [], devDependencies: [] },
      scripts: [],
      commands: [],
      tree: [],
      files: [],
      symlinks: [],
      gitIgnoreApplied: false,
      fileCount: 0,
      testFrameworks: {
        configs: [],
        fromDependencies: [],
        filePatterns: [],
        directories: []
      },
      domainCandidates: [],
      documents: [],
      truncation: {
        walk: false,
        files: false,
        tree: false,
        testFiles: false,
        documents: false,
        notes: []
      },
      warnings: [`\u30B3\u30FC\u30C9\u30D9\u30FC\u30B9\u306E\u8D70\u67FB\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${reason}`]
    };
  }
}
var FINDING_ORDER = {
  section_missing: 0,
  legacy_section: 1,
  domain_gap: 7,
  domain_dead_glob: 8
};
function normalizeSections(sections) {
  const map = /* @__PURE__ */ new Map();
  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (section === null || typeof section !== "object") continue;
      const heading = String(section.heading ?? "").trim();
      if (heading === "") continue;
      if (map.has(heading)) continue;
      map.set(heading, String(section.body ?? ""));
    }
    return map;
  }
  if (isPlainObject2(sections)) {
    for (const [heading, body] of Object.entries(sections)) {
      const key = heading.trim();
      if (key === "") continue;
      if (map.has(key)) continue;
      map.set(key, typeof body === "string" ? body : "");
    }
  }
  return map;
}
var SOURCE_FILE_RES = [
  // マニフェスト
  /^package\.json$/,
  /^deno\.jsonc?$/,
  /^pyproject\.toml$/,
  /^requirements[^/]*\.txt$/,
  /^Pipfile$/,
  /^go\.mod$/,
  /^Cargo\.toml$/,
  /^Gemfile$/,
  /^composer\.json$/,
  /^pom\.xml$/,
  /^build\.gradle(\.kts)?$/,
  /^mix\.exs$/,
  /\.(cs|fs|vb)proj$/,
  /^setup\.(py|cfg)$/,
  /^environment\.ya?ml$/,
  /^pubspec\.yaml$/,
  /^Package\.swift$/,
  /^build\.sbt$/,
  /^settings\.gradle(\.kts)?$/,
  // ワークスペース・ランタイムのバージョン定義
  /^pnpm-workspace\.yaml$/,
  /^(turbo|nx)\.json$/,
  /^bunfig\.toml$/,
  /^\.(nvmrc|node-version|python-version|ruby-version|tool-versions)$/,
  /^\.?mise\.toml$/,
  /^flake\.nix$/,
  /^CMakeLists\.txt$/,
  /^Earthfile$/,
  /^Procfile$/,
  /^rust-toolchain(\.toml)?$/,
  // タスクランナー
  /^(GNU)?[Mm]akefile$/,
  /^\.?[Jj]ustfile$/,
  /^Taskfile(\.dist)?\.ya?ml$/,
  /^Rakefile$/,
  /^tox\.ini$/,
  // コンテナ
  /^([Dd]ockerfile|Containerfile)(\..+)?$/,
  /\.(Dockerfile|Containerfile)$/,
  /^\.?devcontainer\.json$/,
  /^(docker-)?compose[^/]*\.ya?ml$/
];
function collectSources(result, skipped) {
  if (result.truncation.files || result.truncation.walk) {
    skipped.push(
      "\u6280\u8853\u30B9\u30BF\u30C3\u30AF / \u30B3\u30DE\u30F3\u30C9\u306E\u5B9A\u7FA9\u306E\u3042\u308A\u304B: \u30D5\u30A1\u30A4\u30EB\u8D70\u67FB\u304C\u6253\u3061\u5207\u308A\u4E0A\u9650\u306B\u9054\u3057\u305F\u305F\u3081\u3001sources \u306F\u4E00\u90E8\u3060\u3051\u3067\u3059\u3002"
    );
  }
  return result.files.filter((file) => {
    const base = file.slice(file.lastIndexOf("/") + 1);
    return SOURCE_FILE_RES.some((re) => re.test(base));
  }).sort(compareStrings);
}
function existsFromRoot(root, relative) {
  return pathStateFromRoot(root, relative) === "exists";
}
function pathStateFromRoot(root, relative) {
  let current = root;
  for (const segment of relative.split("/")) {
    let names;
    try {
      names = fs2.readdirSync(current);
    } catch {
      return "missing";
    }
    if (!names.includes(segment)) return "missing";
    current = path2.join(current, segment);
    try {
      if (fs2.lstatSync(current).isSymbolicLink()) return "link";
    } catch {
      return "missing";
    }
  }
  return "exists";
}
function globLiteralPrefix(glob) {
  const literal = [];
  for (const segment of glob.split("/")) {
    if (/[*?[\]{}]/.test(segment)) break;
    literal.push(segment);
  }
  return literal.join("/");
}
function segmentMayMatchExcluded(segment) {
  if (segment === "**") return true;
  if (/[[\]{}]/.test(segment)) return true;
  if (!/[*?]/.test(segment)) return EXCLUDED_DIRECTORY_NAMES.has(segment);
  const re = new RegExp(
    `^${segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`
  );
  return [...EXCLUDED_DIRECTORY_NAMES].some((name) => re.test(name));
}
function diffDirectories(result, section, body, skipped) {
  if (body === void 0) return;
  const unlisted = result.tree.filter(
    (entry) => entry.type === "directory" && entry.depth === 1 && !body.includes(entry.path)
  ).map((entry) => entry.path);
  if (unlisted.length > 0) {
    skipped.push(
      `\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u306E\u672A\u8A18\u8F09: ## ${section} \u306B\u540D\u524D\u306E\u7121\u3044\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u306E\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA(${unlisted.join(", ")})\u306F\u3001\u5168\u4EF6\u3092\u66F8\u304B\u306A\u3044\u898F\u5B9A\u306E\u305F\u3081\u4E56\u96E2\u3068\u3057\u3066\u6271\u3044\u307E\u305B\u3093\u3067\u3057\u305F\u3002`
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const unconfirmed = [];
  for (const raw of extractInlineCode(body)) {
    const token = raw.replace(/\/+$/, "");
    if (token === "" || seen.has(token)) continue;
    seen.add(token);
    if (/[*?[\]{}]/.test(token)) continue;
    if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(token)) continue;
    if (!token.includes("/")) continue;
    if (token.split("/").some((seg) => seg === "." || seg === "..")) continue;
    if (existsFromRoot(result.root, token)) continue;
    unconfirmed.push(token);
  }
  if (unconfirmed.length > 0) {
    skipped.push(
      `\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u306E\u5B9F\u5728\u306E\u672A\u78BA\u8A8D: ## ${section} \u306B\u66F8\u304B\u308C\u305F\u6B21\u306E\u30D1\u30B9\u306F\u3001\u30EB\u30FC\u30C8\u304B\u3089\u306F\u5B9F\u5728\u3092\u78BA\u304B\u3081\u3089\u308C\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30D1\u30C3\u30B1\u30FC\u30B8\u5185\u306E\u76F8\u5BFE\u30D1\u30B9\u3084\u30EA\u30F3\u30AF\u306E\u5148\u3067\u3042\u308A\u3046\u308B\u305F\u3081\u3001\u6D88\u3048\u305F\u3068\u306F\u65AD\u5B9A\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u3069\u3053\u3092\u6307\u3059\u304B\u3092\u78BA\u304B\u3081\u3066\u304F\u3060\u3055\u3044: ${unconfirmed.join(", ")}`
    );
  }
}
function diffDomains(result, domains, findings, skipped) {
  const section = "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7";
  if (domains === void 0 || domains === null) {
    skipped.push(
      "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7\u306E\u7A74\u30FB\u6B7B\u3093\u3060 glob: metatron:domains \u306E\u62BD\u51FA\u7D50\u679C\u304C\u6E21\u3055\u308C\u3066\u3044\u306A\u3044\u305F\u3081\u691C\u51FA\u3057\u307E\u305B\u3093\u3067\u3057\u305F\u3002"
    );
    return;
  }
  const globs = [];
  for (const [domain, patterns] of Object.entries(domains)) {
    if (!Array.isArray(patterns)) continue;
    for (const glob of patterns) {
      if (typeof glob !== "string" || glob === "") continue;
      globs.push({ domain, glob, re: globToRegExp(glob) });
    }
  }
  for (const candidate of result.domainCandidates) {
    if (candidate.samplePaths.length === 0) continue;
    const covered = candidate.samplePaths.some(
      (file) => globs.some((g) => g.re.test(file))
    );
    if (covered) continue;
    findings.push({
      kind: "domain_gap",
      section,
      subject: candidate.path,
      detail: `${candidate.path}(\u30D5\u30A1\u30A4\u30EB ${String(candidate.fileCount)} \u4EF6)\u304C metatron:domains \u306E\u3069\u306E glob \u306B\u3082\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002`
    });
  }
  if (result.truncation.files || result.truncation.walk) {
    skipped.push(
      "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7\u306E\u6B7B\u3093\u3060 glob: \u30D5\u30A1\u30A4\u30EB\u8D70\u67FB\u304C\u6253\u3061\u5207\u308A\u4E0A\u9650\u306B\u9054\u3057\u305F\u305F\u3081\u691C\u51FA\u3057\u307E\u305B\u3093\u3067\u3057\u305F\u3002"
    );
    return;
  }
  const unconfirmedGlobs = [];
  for (const g of globs) {
    if (result.files.some((file) => g.re.test(file))) continue;
    const prefix = globLiteralPrefix(g.glob);
    const state = prefix === "" ? "exists" : pathStateFromRoot(result.root, prefix);
    if (state !== "missing") {
      const mayHide = state === "link" || g.glob.split("/").some(segmentMayMatchExcluded) || result.symlinks.some(
        (link) => prefix === "" || link === prefix || link.startsWith(`${prefix}/`)
      );
      if (mayHide) {
        unconfirmedGlobs.push(g.glob);
        continue;
      }
    }
    findings.push({
      kind: "domain_dead_glob",
      section,
      subject: g.glob,
      detail: result.gitIgnoreApplied ? `\u30C9\u30E1\u30A4\u30F3 ${g.domain} \u306E glob ${g.glob} \u304C\u3001gitignore \u3092\u9664\u304F\u8D70\u67FB\u5BFE\u8C61\u306E\u3069\u306E\u30D5\u30A1\u30A4\u30EB\u306B\u3082\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002` : `\u30C9\u30E1\u30A4\u30F3 ${g.domain} \u306E glob ${g.glob} \u304C\u3069\u306E\u30D5\u30A1\u30A4\u30EB\u306B\u3082\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002`
    });
  }
  if (unconfirmedGlobs.length > 0) {
    skipped.push(
      `\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7\u306E\u6B7B\u3093\u3060 glob \u306E\u672A\u78BA\u8A8D: \u8D70\u67FB\u304C\u5165\u3089\u306A\u3044\u9664\u5916\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u3084\u30B7\u30F3\u30DC\u30EA\u30C3\u30AF\u30EA\u30F3\u30AF\u306E\u4E2D\u306B\u4E00\u81F4\u3057\u3046\u308B glob(${unconfirmedGlobs.join(", ")})\u306F\u3001\u4E00\u81F4\u3059\u308B\u30D5\u30A1\u30A4\u30EB\u306E\u6709\u7121\u3092\u78BA\u304B\u3081\u3089\u308C\u306A\u3044\u305F\u3081\u5224\u5B9A\u3057\u307E\u305B\u3093\u3067\u3057\u305F\u3002`
    );
  }
}
function diffArchitectureInner(input) {
  const findings = [];
  const skipped = [];
  const warnings = [];
  const sections = normalizeSections(input.sections);
  const exists = input.architectureExists ?? sections.size > 0;
  for (const heading of ARCHITECTURE_SECTIONS) {
    if (exists && sections.has(heading)) continue;
    findings.push({
      kind: "section_missing",
      section: heading,
      subject: heading,
      detail: exists ? `## ${heading} \u304C ARCHITECTURE \u306B\u3042\u308A\u307E\u305B\u3093\u3002` : `ARCHITECTURE \u304C\u7121\u3044\u305F\u3081 ## ${heading} \u3082\u3042\u308A\u307E\u305B\u3093\u3002`
    });
  }
  for (const [heading, detail] of Object.entries(LEGACY_SECTIONS)) {
    if (!exists || !sections.has(heading)) continue;
    findings.push({
      kind: "legacy_section",
      section: heading,
      subject: heading,
      detail
    });
  }
  const sources = collectSources(input.scan, skipped);
  skipped.push(
    "\u6280\u8853\u30B9\u30BF\u30C3\u30AF / \u30B3\u30DE\u30F3\u30C9\u5B9A\u7FA9\u306E\u7A81\u304D\u5408\u308F\u305B: \u8981\u7D04\u3068\u3057\u3066\u66F8\u304F\u7BC0\u306E\u305F\u3081\u6A5F\u68B0\u7684\u306B\u306F\u691C\u51FA\u3057\u307E\u305B\u3093\u3002\u66F8\u304B\u308C\u305F\u6280\u8853\u3068\u30B3\u30DE\u30F3\u30C9\u304C sources \u306B\u6B8B\u3063\u3066\u3044\u308B\u304B\u3092\u8AAD\u3093\u3067\u78BA\u304B\u3081\u3066\u304F\u3060\u3055\u3044\u3002"
  );
  const directorySection = sections.has("\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210") ? "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210" : "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u3068\u8CAC\u52D9";
  diffDirectories(
    input.scan,
    directorySection,
    sections.get(directorySection),
    skipped
  );
  diffDomains(input.scan, input.domains, findings, skipped);
  findings.sort(
    (a, b) => FINDING_ORDER[a.kind] - FINDING_ORDER[b.kind] || compareStrings(a.subject, b.subject)
  );
  return { findings, sources, skipped, warnings };
}
function diffArchitecture(input) {
  try {
    return diffArchitectureInner(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      findings: [],
      sources: [],
      skipped: [],
      warnings: [`\u4E56\u96E2\u5019\u88DC\u306E\u7B97\u51FA\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${reason}`]
    };
  }
}

// src/cli/input.ts
import fs5 from "node:fs";

// src/lib/staging.ts
import crypto2 from "node:crypto";
import fs4 from "node:fs";
import os from "node:os";
import path4 from "node:path";

// src/lib/atomic-write.ts
import crypto from "node:crypto";
import fs3 from "node:fs";
import path3 from "node:path";
var MAX_LINK_HOPS = 40;
function errnoCode(error) {
  return error?.code;
}
function resolveWriteTarget(target) {
  try {
    return fs3.realpathSync(target);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
  }
  let current = path3.resolve(target);
  for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
    let link;
    try {
      link = fs3.readlinkSync(current);
    } catch (error) {
      const code = errnoCode(error);
      if (code === "ENOENT" || code === "EINVAL") return current;
      throw error;
    }
    current = path3.resolve(path3.dirname(current), link);
  }
  const err = new Error(
    `ELOOP: too many symbolic links encountered, '${target}'`
  );
  err.code = "ELOOP";
  throw err;
}
function existingMode(filePath) {
  try {
    return fs3.statSync(filePath).mode & 4095;
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}
function writeFileAtomic(target, data) {
  const dest = resolveWriteTarget(target);
  fs3.mkdirSync(path3.dirname(dest), { recursive: true });
  const mode = existingMode(dest);
  const tmp = `${dest}.tmp-${crypto.randomUUID()}`;
  try {
    fs3.writeFileSync(tmp, data);
    if (mode !== null) fs3.chmodSync(tmp, mode);
    fs3.renameSync(tmp, dest);
  } catch (error) {
    try {
      fs3.rmSync(tmp, { force: true });
    } catch {
    }
    throw error;
  }
}

// src/lib/staging.ts
var STAGING_DIR_NAME = "metatron-staging";
var STAGING_RECORD_VERSION = 2;
var DEFAULT_STAGING_TTL_MS = 30 * 60 * 1e3;
function hashBuffer(buf) {
  return crypto2.createHash("sha256").update(buf).digest("hex");
}
function hashContent(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return hashBuffer(buf);
}
function hashFileOrNull(filePath) {
  try {
    return hashBuffer(fs4.readFileSync(filePath));
  } catch {
    return null;
  }
}
function projectKey(projectRoot) {
  let resolved;
  try {
    resolved = path4.resolve(projectRoot);
  } catch {
    resolved = projectRoot;
  }
  let real = resolved;
  try {
    real = fs4.realpathSync(resolved);
  } catch {
  }
  return hashContent(real.split(path4.sep).join("/")).slice(0, 16);
}
function stagingRootDir() {
  return path4.join(os.tmpdir(), STAGING_DIR_NAME);
}
function stagingDirFor(projectRoot) {
  return path4.join(stagingRootDir(), projectKey(projectRoot));
}
var STAGING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function isSafeStagingId(stagingId) {
  return typeof stagingId === "string" && STAGING_ID_PATTERN.test(stagingId);
}
function stagingRecordPath(projectRoot, stagingId) {
  if (!isSafeStagingId(stagingId)) return null;
  return path4.join(stagingDirFor(projectRoot), `${stagingId}.json`);
}
function isInside(root, target) {
  const rel = path4.relative(root, target);
  if (rel === "" || rel === "..") return false;
  return !rel.startsWith(`..${path4.sep}`) && !path4.isAbsolute(rel);
}
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStagingKind(value) {
  return value === "architecture";
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject3(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const canonical = canonicalize(value[key]);
      if (canonical !== void 0) out[key] = canonical;
    }
    return out;
  }
  return value;
}
function computeRecordHash(record) {
  const { recordHash: _ignored, ...rest } = record;
  const roundTripped = JSON.parse(JSON.stringify(rest));
  return hashContent(JSON.stringify(canonicalize(roundTripped)));
}
function verifyRecordHash(record) {
  return record.recordHash === computeRecordHash(record);
}
function tamperedReason(stagingId) {
  return `staging ${stagingId} \u306E\u5185\u5BB9\u304C stage \u6642\u304B\u3089\u5909\u5316\u3057\u3066\u3044\u307E\u3059(recordHash \u4E0D\u4E00\u81F4)\u3002\u627F\u8A8D\u3055\u308C\u305F diff \u3068\u4E00\u81F4\u3057\u306A\u3044\u305F\u3081\u66F8\u304D\u8FBC\u307F\u307E\u305B\u3093\u3002stage \u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
}
function parseRecord(raw, stagingId) {
  if (!isPlainObject3(raw)) return null;
  if (raw.stagingId !== stagingId) return null;
  if (typeof raw.version !== "number") return null;
  if (!isStagingKind(raw.kind)) return null;
  if (typeof raw.targetPath !== "string" || raw.targetPath === "") return null;
  if (typeof raw.nextContent !== "string") return null;
  if (raw.baseHash !== null && typeof raw.baseHash !== "string") return null;
  if (typeof raw.createdAt !== "number") return null;
  if (typeof raw.expiresAt !== "number") return null;
  if (raw.usedAt !== null && typeof raw.usedAt !== "number") return null;
  return {
    version: raw.version,
    stagingId,
    kind: raw.kind,
    targetPath: raw.targetPath,
    baseHash: raw.baseHash,
    nextContent: raw.nextContent,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    usedAt: raw.usedAt,
    meta: isPlainObject3(raw.meta) ? raw.meta : {},
    // 欄ごと消された場合は空文字にする。sha256 の hex とは決して一致しないため、
    // 「レコードとしては読めたが整合していない」= tampered に落ちる。
    recordHash: typeof raw.recordHash === "string" ? raw.recordHash : ""
  };
}
function loadRecord(projectRoot, stagingId) {
  const recordPath = stagingRecordPath(projectRoot, stagingId);
  if (recordPath === null) return null;
  try {
    const text = fs4.readFileSync(recordPath, "utf8");
    return parseRecord(JSON.parse(text), stagingId);
  } catch {
    return null;
  }
}
function writeRecord(recordPath, record) {
  const dir = path4.dirname(recordPath);
  fs4.mkdirSync(dir, { recursive: true });
  const tmpPath = `${recordPath}.tmp-${crypto2.randomUUID()}`;
  const body = `${JSON.stringify(record, null, 2)}
`;
  fs4.writeFileSync(tmpPath, body, { encoding: "utf8", mode: 384 });
  try {
    fs4.renameSync(tmpPath, recordPath);
  } catch (err) {
    try {
      fs4.rmSync(tmpPath, { force: true });
    } catch {
    }
    throw err;
  }
}
function createStaging(input) {
  const errors = input.validationErrors ?? [];
  if (errors.length > 0) {
    return { ok: false, error: "invalid", reasons: [...errors] };
  }
  const projectRoot = path4.resolve(input.projectRoot);
  const targetPath = path4.resolve(projectRoot, input.targetPath);
  if (!isInside(projectRoot, targetPath)) {
    return {
      ok: false,
      error: "invalid",
      reasons: [
        `\u66F8\u304D\u8FBC\u307F\u5BFE\u8C61 ${targetPath} \u304C\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u30EB\u30FC\u30C8 ${projectRoot} \u306E\u5916\u3092\u6307\u3057\u3066\u3044\u307E\u3059\u3002`
      ]
    };
  }
  const now = input.now ?? Date.now();
  const ttlMs = typeof input.ttlMs === "number" && Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : DEFAULT_STAGING_TTL_MS;
  const baseHash = input.baseHash === void 0 ? hashFileOrNull(targetPath) : input.baseHash;
  const stagingId = crypto2.randomUUID();
  const draft = {
    version: STAGING_RECORD_VERSION,
    stagingId,
    kind: input.kind,
    targetPath,
    baseHash,
    nextContent: input.nextContent,
    createdAt: now,
    expiresAt: now + ttlMs,
    usedAt: null,
    meta: input.meta ?? {}
  };
  const recordPath = path4.join(stagingDirFor(projectRoot), `${stagingId}.json`);
  try {
    writeRecord(recordPath, { ...draft, recordHash: computeRecordHash(draft) });
  } catch (err) {
    return {
      ok: false,
      error: "staging_unavailable",
      reasons: [`staging \u3092\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F(${recordPath}): ${String(err)}`]
    };
  }
  return {
    ok: true,
    stagingId,
    recordPath,
    targetPath,
    baseHash,
    createdAt: draft.createdAt,
    expiresAt: draft.expiresAt
  };
}
function readStaging(projectRoot, stagingId) {
  const record = loadRecord(projectRoot, stagingId);
  if (record === null) {
    return {
      ok: false,
      error: "unknown_id",
      reason: `staging ${stagingId} \u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002stage \u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    };
  }
  if (!verifyRecordHash(record)) {
    return {
      ok: false,
      error: "tampered",
      reason: tamperedReason(record.stagingId)
    };
  }
  return { ok: true, record };
}
function commitStaging(input) {
  const projectRoot = path4.resolve(input.projectRoot);
  const now = input.now ?? Date.now();
  const record = loadRecord(projectRoot, input.stagingId);
  if (record === null) {
    return {
      ok: false,
      error: "unknown_id",
      reason: `staging ${input.stagingId} \u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002stage \u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    };
  }
  if (!verifyRecordHash(record)) {
    return {
      ok: false,
      error: "tampered",
      reason: tamperedReason(record.stagingId)
    };
  }
  if (record.usedAt !== null) {
    return {
      ok: false,
      error: "already_used",
      reason: `staging ${record.stagingId} \u306F\u65E2\u306B\u4F7F\u7528\u6E08\u307F\u3067\u3059(${new Date(record.usedAt).toISOString()})\u3002stage \u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    };
  }
  if (now >= record.expiresAt) {
    return {
      ok: false,
      error: "expired",
      reason: `staging ${record.stagingId} \u306F\u6709\u52B9\u671F\u9650(${new Date(record.expiresAt).toISOString()})\u3092\u904E\u304E\u3066\u3044\u307E\u3059\u3002stage \u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    };
  }
  if (!isInside(projectRoot, record.targetPath)) {
    return {
      ok: false,
      error: "unknown_id",
      reason: `staging ${record.stagingId} \u306E\u66F8\u304D\u8FBC\u307F\u5148\u304C\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u30EB\u30FC\u30C8\u306E\u5916\u3092\u6307\u3057\u3066\u3044\u307E\u3059\u3002stage \u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    };
  }
  const currentHash = hashFileOrNull(record.targetPath);
  if (currentHash !== record.baseHash) {
    const before = record.baseHash === null ? "\u672A\u4F5C\u6210" : record.baseHash;
    const after = currentHash === null ? "\u672A\u4F5C\u6210" : currentHash;
    return {
      ok: false,
      error: "file_changed",
      reason: `${record.targetPath} \u304C stage \u5F8C\u306B\u5909\u5316\u3057\u3066\u3044\u307E\u3059(${before} \u2192 ${after})\u3002stage \u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    };
  }
  const recordPath = stagingRecordPath(projectRoot, record.stagingId);
  if (recordPath === null) {
    return {
      ok: false,
      error: "unknown_id",
      reason: `staging ${record.stagingId} \u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002stage \u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    };
  }
  try {
    const used = { ...record, usedAt: now };
    writeRecord(recordPath, { ...used, recordHash: computeRecordHash(used) });
  } catch (err) {
    return {
      ok: false,
      error: "staging_unavailable",
      reason: `staging ${record.stagingId} \u3092\u4F7F\u7528\u6E08\u307F\u306B\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F(${recordPath}): ${String(err)}\u3002\u5358\u56DE\u4F7F\u7528\u3092\u4FDD\u8A3C\u3067\u304D\u306A\u3044\u305F\u3081\u66F8\u304D\u8FBC\u307F\u307E\u305B\u3093\u3002${record.targetPath} \u306F\u5909\u66F4\u3057\u3066\u3044\u307E\u305B\u3093\u3002`
    };
  }
  const buf = Buffer.from(record.nextContent, "utf8");
  try {
    writeFileAtomic(record.targetPath, buf);
  } catch (err) {
    return {
      ok: false,
      error: "write_failed",
      reason: `${record.targetPath} \u3078\u66F8\u304D\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F: ${String(err)}\u3002\u3053\u306E staging \u306F\u6D88\u8CBB\u6E08\u307F\u306B\u306A\u3063\u305F\u305F\u3081\u3001stage \u304B\u3089\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    };
  }
  return {
    ok: true,
    stagingId: record.stagingId,
    kind: record.kind,
    path: record.targetPath,
    bytesWritten: buf.byteLength,
    meta: record.meta,
    warnings: []
  };
}

// src/cli/args.ts
var BOOLEAN_FLAGS = /* @__PURE__ */ new Set(["help"]);
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    if (body === "") {
      errors.push('"--" \u306F\u89E3\u91C8\u3067\u304D\u307E\u305B\u3093\u3002');
      continue;
    }
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (BOOLEAN_FLAGS.has(body)) {
      flags[body] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === void 0 || next.startsWith("--")) {
      errors.push(`--${body} \u306B\u5024\u304C\u3042\u308A\u307E\u305B\u3093\u3002`);
      continue;
    }
    flags[body] = next;
    i++;
  }
  return { positionals, flags, errors };
}
function stringFlag(flags, name) {
  const value = flags[name];
  if (value === void 0) return void 0;
  if (value === true) return void 0;
  return value;
}

// src/cli/output.ts
var EXIT_REJECTED = 1;
var EXIT_USAGE = 2;
function emitResult(command, payload) {
  process.stdout.write(`${JSON.stringify({ command, ...payload }, null, 2)}
`);
}
function note(line) {
  process.stderr.write(`${line}
`);
}
function noteWarnings(warnings) {
  for (const warning of warnings) note(`warning: ${warning}`);
}
function emitReadFailure(command, error, message, extra = {}) {
  emitResult(command, { ok: false, error, message, ...extra });
  note(message);
}
function emitWriteFailure(command, error, message, extra = {}, exitCode = EXIT_REJECTED) {
  emitResult(command, { ok: false, error, message, ...extra });
  note(message);
  process.exitCode = exitCode;
}
function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

// src/cli/input.ts
function readStdinSync() {
  if (process.stdin.isTTY === true) return null;
  try {
    return fs5.readFileSync(0, "utf8");
  } catch {
    return null;
  }
}
function loadInputJson(flags) {
  const inputPath = stringFlag(flags, "input");
  let raw;
  let source;
  if (inputPath !== void 0) {
    source = inputPath;
    try {
      raw = fs5.readFileSync(inputPath, "utf8");
    } catch (error) {
      return {
        ok: false,
        error: "unreadable_input",
        message: `--input ${inputPath} \u3092\u8AAD\u3081\u307E\u305B\u3093\u3067\u3057\u305F: ${messageOf(error)}`
      };
    }
  } else {
    const piped = readStdinSync();
    if (piped === null || piped.trim() === "") {
      return {
        ok: false,
        error: "missing_input",
        message: "--input <path> \u304C\u5FC5\u8981\u3067\u3059\u3002\u5165\u529B\u306E JSON \u3092\u4E00\u6642\u30D5\u30A1\u30A4\u30EB\u306B\u66F8\u3044\u3066\u304B\u3089\u30D1\u30B9\u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      };
    }
    source = "<stdin>";
    raw = piped;
  }
  try {
    return { ok: true, source, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      error: "invalid_json",
      message: `${source} \u304C\u6709\u52B9\u306A JSON \u3067\u306F\u3042\u308A\u307E\u305B\u3093: ${messageOf(error)}`
    };
  }
}
function isPlainObject4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readDocument(filePath) {
  try {
    const buf = fs5.readFileSync(filePath);
    return {
      path: filePath,
      exists: true,
      text: buf.toString("utf8"),
      hash: hashContent(buf),
      warnings: []
    };
  } catch (error) {
    const code = error?.code;
    const warnings = code === "ENOENT" ? [] : [
      `${filePath} \u3092\u8AAD\u3081\u307E\u305B\u3093\u3067\u3057\u305F(${code ?? "unknown"})\u3002\u672A\u4F5C\u6210\u3068\u3057\u3066\u6271\u3044\u307E\u3059\u3002`
    ];
    return { path: filePath, exists: false, text: "", hash: null, warnings };
  }
}

// src/cli/analysis.ts
function runScan(ctx) {
  const command = "scan";
  try {
    const result = scan(ctx.cwd);
    noteWarnings(result.warnings);
    emitResult(command, { ok: true, ...result });
  } catch (error) {
    emitReadFailure(command, "internal_error", messageOf(error));
  }
}
function runDiffArchitecture(ctx) {
  const command = "diff-architecture";
  try {
    const config = loadConfig(ctx.cwd);
    const file = readDocument(config.architecturePath);
    const doc = parseArchitectureForRead(file.text);
    const domains = extractDomains(file.text);
    const sections = doc.sections.map((section) => ({
      heading: section.heading,
      body: section.body
    }));
    const scanned = scan(ctx.cwd);
    const result = diffArchitecture({
      scan: scanned,
      sections,
      architectureExists: file.exists,
      domains: domains.ok ? domains.domains : null
    });
    const warnings = [
      ...config.warnings,
      ...file.warnings,
      ...doc.warnings,
      ...domains.warnings,
      ...scanned.warnings,
      ...result.warnings
    ];
    noteWarnings(warnings);
    emitResult(command, {
      ok: true,
      root: scanned.root,
      architecture: {
        path: config.architecturePath,
        exists: file.exists,
        headings: doc.sections.map((s) => s.heading)
      },
      domains: {
        ok: domains.ok,
        reason: domains.reason
      },
      findings: result.findings,
      sources: result.sources,
      skipped: result.skipped,
      truncation: scanned.truncation,
      warnings
    });
  } catch (error) {
    emitReadFailure(command, "internal_error", messageOf(error));
  }
}

// src/cli/claude-md.ts
import fs7 from "node:fs";

// src/lib/claude-md.ts
import fs6 from "node:fs";
import path5 from "node:path";
var CLAUDE_MD_CANDIDATES = ["CLAUDE.md", ".claude/CLAUDE.md"];
function readOrNull(filePath) {
  try {
    return fs6.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
function isMentionablePath(rel) {
  return rel !== "" && ![...rel].some((c) => {
    const code = c.charCodeAt(0);
    return /\s/.test(c) || code < 32 || code === 127;
  });
}
function mentions(text) {
  const found = /* @__PURE__ */ new Set();
  const withoutComments = text.replace(/^\uFEFF/, "").replace(/`[^`\n]*`|<!--[\s\S]*?-->/g, (m) => m[0] === "`" ? m : " ");
  let fence = null;
  for (const line of withoutComments.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker) {
      const char = marker[1][0];
      const length = marker[1].length;
      if (fence === null) fence = { char, length };
      else if (char === fence.char && length >= fence.length && line.trim() === marker[1])
        fence = null;
      continue;
    }
    if (fence !== null) continue;
    const outsideCode = line.replace(/`[^`]*`/g, " ");
    for (const match of outsideCode.matchAll(/(?:^|\s)@(\S+)/g)) {
      const token = match[1].replace(/[.,;:)\]、。」]+$/, "");
      if (token !== "") found.add(path5.posix.normalize(token));
    }
  }
  return found;
}
function existingMentions(docRoot) {
  const existing = /* @__PURE__ */ new Set();
  for (const rel of CLAUDE_MD_CANDIDATES) {
    const text = readOrNull(path5.join(docRoot, rel));
    if (text === null) continue;
    for (const m of mentions(text)) {
      existing.add(
        rel === "CLAUDE.md" ? m : path5.posix.normalize(`.claude/${m}`)
      );
    }
  }
  return existing;
}
function linkClaudeMd(docRoot, relatives) {
  const unsafe = relatives.find((rel) => !isMentionablePath(rel));
  if (unsafe !== void 0) {
    throw new Error(
      `\u7A7A\u767D\u304B\u5236\u5FA1\u6587\u5B57\u3092\u542B\u3080\u30D1\u30B9\u306F @\u30E1\u30F3\u30B7\u30E7\u30F3\u306B\u3067\u304D\u307E\u305B\u3093: ${JSON.stringify(unsafe)}`
    );
  }
  const rootText = readOrNull(path5.join(docRoot, "CLAUDE.md"));
  const dotText = readOrNull(path5.join(docRoot, ".claude/CLAUDE.md"));
  const useDot = rootText === null && dotText !== null;
  const target = path5.join(docRoot, useDot ? ".claude/CLAUDE.md" : "CLAUDE.md");
  const created = (useDot ? dotText : rootText) === null;
  const current = (useDot ? dotText : rootText) ?? "";
  const existing = existingMentions(docRoot);
  const present = relatives.filter((rel) => existing.has(rel));
  const added = relatives.filter((rel) => !existing.has(rel));
  if (added.length === 0) {
    return { path: target, added, present, created: false };
  }
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const lines = added.map((rel) => `@${useDot ? `../${rel}` : rel}`);
  const body = current.replace(/\s*$/, "");
  const separator = body === "" ? "" : `${eol}${eol}`;
  writeFileAtomic(target, `${body}${separator}${lines.join(eol)}${eol}`);
  return { path: target, added, present, created };
}

// src/cli/claude-md.ts
function hasContent(filePath) {
  try {
    return fs7.readFileSync(filePath, "utf8").trim() !== "";
  } catch {
    return false;
  }
}
function runLinkClaudeMd(ctx) {
  const command = "link-claude-md";
  const config = loadConfig(ctx.cwd);
  noteWarnings(config.warnings);
  if (!hasContent(config.architecturePath)) {
    emitWriteFailure(
      command,
      "architecture_missing",
      `${config.architectureRelative} \u304C\u307E\u3060\u7121\u3044\u305F\u3081\u8FFD\u8A18\u3057\u307E\u305B\u3093\u3002\u5148\u306B ARCHITECTURE \u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    );
    return;
  }
  const candidates = [config.architectureRelative];
  const relatives = candidates.filter(isMentionablePath);
  const skipped = candidates.filter((rel) => !isMentionablePath(rel));
  let configCreated = false;
  let result;
  try {
    configCreated = createConfigIfMissing(config.configPath);
    result = linkClaudeMd(config.docRoot, relatives);
  } catch (error) {
    let configRemoveError;
    if (configCreated) {
      try {
        fs7.rmSync(config.configPath, { force: true });
        configCreated = false;
      } catch (removeError) {
        configRemoveError = messageOf(removeError);
      }
    }
    emitWriteFailure(command, "write_failed", messageOf(error), {
      written: configCreated,
      configCreated,
      ...configRemoveError === void 0 ? {} : {
        configRemoveFailed: true,
        configRemoveError: `\u4F5C\u3063\u305F\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB ${config.configPath} \u3092\u6D88\u305B\u307E\u305B\u3093\u3067\u3057\u305F: ${configRemoveError}`
      }
    });
    return;
  }
  emitResult(command, {
    ok: true,
    written: result.added.length > 0 || configCreated,
    ...result,
    skipped,
    configPath: config.configPath,
    configCreated,
    warnings: config.warnings
  });
}
function createConfigIfMissing(configPath) {
  let fd;
  try {
    fd = fs7.openSync(configPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  try {
    fs7.writeFileSync(fd, '{\n  "version": 1\n}\n');
  } catch (error) {
    fs7.closeSync(fd);
    fs7.rmSync(configPath, { force: true });
    throw error;
  }
  fs7.closeSync(fd);
  return true;
}

// src/lib/file-lock.ts
import fs8 from "node:fs";
import path6 from "node:path";
var LOCK_RETRY_INTERVAL_MS = 50;
var LOCK_MAX_RETRIES = 20;
var LOCK_STALE_MS = 6e4;
var FileLockError = class extends Error {
  code = "lock_timeout";
  constructor(message) {
    super(message);
    this.name = "FileLockError";
  }
};
function lockPathFor(targetPath) {
  return `${targetPath}.lock`;
}
function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}
function errnoCode2(error) {
  return error?.code;
}
function tryCreateLock(lockPath) {
  try {
    const fd = fs8.openSync(lockPath, "wx");
    try {
      fs8.writeSync(fd, `${process.pid} ${(/* @__PURE__ */ new Date()).toISOString()}
`);
    } finally {
      fs8.closeSync(fd);
    }
    return true;
  } catch (error) {
    if (errnoCode2(error) === "EEXIST") return false;
    throw error;
  }
}
function statMtimeMs(lockPath) {
  try {
    return fs8.statSync(lockPath).mtimeMs;
  } catch {
    return null;
  }
}
function tryStealStaleLock(lockPath) {
  const mtimeMs = statMtimeMs(lockPath);
  if (mtimeMs === null) return tryCreateLock(lockPath);
  if (Date.now() - mtimeMs <= LOCK_STALE_MS) return false;
  try {
    fs8.unlinkSync(lockPath);
  } catch (error) {
    if (errnoCode2(error) !== "ENOENT") return false;
  }
  return tryCreateLock(lockPath);
}
function withFileLock(targetPath, fn) {
  const lockPath = lockPathFor(targetPath);
  try {
    fs8.mkdirSync(path6.dirname(lockPath), { recursive: true });
  } catch {
  }
  let acquired = tryCreateLock(lockPath);
  for (let attempt = 0; !acquired && attempt < LOCK_MAX_RETRIES; attempt++) {
    const mtimeMs = statMtimeMs(lockPath);
    if (mtimeMs !== null && Date.now() - mtimeMs > LOCK_STALE_MS) {
      acquired = tryStealStaleLock(lockPath);
      if (acquired) break;
    }
    sleepSync(LOCK_RETRY_INTERVAL_MS);
    acquired = tryCreateLock(lockPath);
  }
  if (!acquired) {
    throw new FileLockError(
      `${lockPath} \u306E\u30ED\u30C3\u30AF\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u4ED6\u306E\u30D7\u30ED\u30BB\u30B9\u304C\u66F8\u304D\u8FBC\u307F\u4E2D\u306E\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002`
    );
  }
  try {
    return fn();
  } finally {
    try {
      fs8.rmSync(lockPath, { force: true });
    } catch {
    }
  }
}

// src/cli/commit.ts
function runCommit(ctx, spec) {
  const { command } = spec;
  const stagingId = stringFlag(ctx.flags, "staging-id");
  if (stagingId === void 0 || stagingId.trim() === "") {
    emitWriteFailure(
      command,
      "missing_staging_id",
      `--staging-id <id> \u304C\u5FC5\u8981\u3067\u3059\u3002${spec.stageHint}`,
      { written: false },
      EXIT_USAGE
    );
    return;
  }
  const config = loadConfig(ctx.cwd);
  const found = readStaging(config.docRoot, stagingId.trim());
  if (!found.ok) {
    emitWriteFailure(command, found.error, found.reason, {
      written: false,
      stagingId: stagingId.trim()
    });
    return;
  }
  const targetPath = found.record.targetPath;
  let result;
  try {
    result = withFileLock(
      targetPath,
      () => commitStaging({
        projectRoot: config.docRoot,
        stagingId: stagingId.trim()
      })
    );
  } catch (error) {
    if (error instanceof FileLockError) {
      emitWriteFailure(command, error.code, error.message, {
        written: false,
        stagingId: stagingId.trim(),
        path: targetPath
      });
      return;
    }
    emitWriteFailure(command, "internal_error", messageOf(error), {
      written: false,
      stagingId: stagingId.trim(),
      path: targetPath
    });
    return;
  }
  if (!result.ok) {
    emitWriteFailure(command, result.error, result.reason, {
      written: false,
      stagingId: stagingId.trim(),
      path: targetPath
    });
    return;
  }
  noteWarnings(result.warnings);
  emitResult(command, {
    ok: true,
    written: true,
    path: result.path,
    bytesWritten: result.bytesWritten,
    stagingId: result.stagingId,
    kind: result.kind,
    meta: result.meta,
    warnings: [...config.warnings, ...result.warnings]
  });
}
function runCommitArchitecture(ctx) {
  runCommit(ctx, {
    command: "commit-architecture",
    stageHint: "stage-architecture \u304C\u8FD4\u3057\u305F stagingId \u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
  });
}

// src/cli/paths.ts
import path7 from "node:path";
import { fileURLToPath } from "node:url";
function metatronCliPath() {
  const here = fileURLToPath(import.meta.url);
  if (path7.basename(here) === "metatron.mjs") return here;
  const pluginRoot = path7.resolve(path7.dirname(here), "..", "..");
  return path7.join(pluginRoot, "scripts", "metatron.mjs");
}
function commandLine(args) {
  return `node ${metatronCliPath()} ${args}`;
}
var INPUT_SCHEMAS = {
  "stage-architecture": {
    input: "{ sections: [{ heading, body } | { heading, remove: true }], reason? }",
    headings: [...ARCHITECTURE_HEADINGS],
    note: "remove: true \u306E\u524A\u9664\u306F\u898B\u51FA\u3057\u8A31\u53EF\u30EA\u30B9\u30C8\u306E\u5236\u9650\u3092\u53D7\u3051\u307E\u305B\u3093(body \u3068\u306E\u540C\u6642\u6307\u5B9A\u306F\u62D2\u5426)\u3002\u66F8\u304D\u8FBC\u307F\u306F commit-architecture --staging-id <id>\u3002"
  }
};
var USAGE_LINES = [
  "usage: node <plugin-root>/scripts/metatron.mjs <subcommand> [options]",
  "",
  "\u8AAD\u307F\u53D6\u308A(\u5E38\u306B exit 0):",
  "  get config",
  "  get architecture [--section <\u898B\u51FA\u3057>]",
  "  get domains",
  "  scan",
  "  diff-architecture",
  "",
  "\u6BB5\u968E(\u62D2\u5426\u306F\u975E 0):",
  "  stage-architecture --input <path>",
  "",
  "\u66F8\u304D\u8FBC\u307F(\u62D2\u5426\u30FB\u5931\u6557\u306F\u975E 0):",
  "  commit-architecture --staging-id <id>",
  "  link-claude-md"
];

// src/cli/get.ts
function configOf(cwd) {
  return loadConfig(cwd);
}
function runGetConfig(ctx) {
  const command = "get config";
  const config = configOf(ctx.cwd);
  const architecture = readDocument(config.architecturePath);
  const warnings = [...config.warnings, ...architecture.warnings];
  noteWarnings(warnings);
  emitResult(command, {
    ok: true,
    docRoot: config.docRoot,
    configPath: config.configPath,
    configExists: config.configExists,
    architecture: {
      path: config.architecturePath,
      relative: config.architectureRelative,
      exists: architecture.exists
    },
    cli: {
      path: metatronCliPath(),
      stageArchitecture: commandLine("stage-architecture --input <path>"),
      commitArchitecture: commandLine("commit-architecture --staging-id <id>"),
      linkClaudeMd: commandLine("link-claude-md")
    },
    inputSchemas: INPUT_SCHEMAS,
    warnings
  });
}
function runGetArchitecture(ctx) {
  const command = "get architecture";
  const config = configOf(ctx.cwd);
  const file = readDocument(config.architecturePath);
  const doc = parseArchitectureForRead(file.text);
  const warnings = [...config.warnings, ...file.warnings, ...doc.warnings];
  noteWarnings(warnings);
  const section = stringFlag(ctx.flags, "section");
  if (!file.exists) {
    emitReadFailure(
      command,
      "not_created",
      `${config.architecturePath} \u306F\u672A\u4F5C\u6210\u3067\u3059\u3002stage-architecture \u3067\u65B0\u898F\u4F5C\u6210\u306E diff \u3092\u53D6\u5F97\u3067\u304D\u307E\u3059\u3002`,
      {
        path: config.architecturePath,
        exists: false,
        section: section ?? null,
        warnings
      }
    );
    return;
  }
  if (section !== void 0) {
    const found = findSection(doc, section.trim());
    if (found === void 0) {
      emitReadFailure(
        command,
        "section_not_found",
        `\u30BB\u30AF\u30B7\u30E7\u30F3\u300C${section}\u300D\u306F ${config.architecturePath} \u306B\u3042\u308A\u307E\u305B\u3093\u3002`,
        {
          path: config.architecturePath,
          exists: true,
          section,
          headings: doc.sections.map((s) => s.heading),
          warnings
        }
      );
      return;
    }
    emitResult(command, {
      ok: true,
      path: config.architecturePath,
      exists: true,
      section: {
        heading: found.heading,
        body: found.body,
        raw: found.raw
      },
      warnings
    });
    return;
  }
  const lineCount = countArchitectureLines(file.text);
  const lineWarning = lineLimitWarning(lineCount);
  if (lineWarning !== null) {
    warnings.push(lineWarning);
    noteWarnings([lineWarning]);
  }
  emitResult(command, {
    ok: true,
    path: config.architecturePath,
    exists: true,
    lineCount,
    lineLimit: ARCHITECTURE_LINE_LIMIT,
    eol: doc.eol === "\r\n" ? "crlf" : "lf",
    preamble: doc.preamble,
    headings: doc.sections.map((s) => s.heading),
    sections: doc.sections.map((s) => ({ heading: s.heading, body: s.body })),
    text: file.text,
    warnings
  });
}
function runGetDomains(ctx) {
  const command = "get domains";
  const config = configOf(ctx.cwd);
  const file = readDocument(config.architecturePath);
  const result = extractDomains(file.text);
  const warnings = [...config.warnings, ...file.warnings, ...result.warnings];
  noteWarnings(warnings);
  if (!result.ok) {
    emitReadFailure(
      command,
      result.reason ?? "block_not_found",
      result.message ?? "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7\u3092\u8AAD\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
      {
        path: config.architecturePath,
        exists: file.exists,
        reason: result.reason,
        domains: null,
        warnings
      }
    );
    return;
  }
  emitResult(command, {
    ok: true,
    path: config.architecturePath,
    exists: file.exists,
    reason: null,
    domains: result.domains,
    warnings
  });
}
var GET_TARGETS = ["config", "architecture", "domains"];
function runGet(target, ctx) {
  const command = target === void 0 ? "get" : `get ${target}`;
  try {
    switch (target) {
      case "config":
        runGetConfig(ctx);
        return;
      case "architecture":
        runGetArchitecture(ctx);
        return;
      case "domains":
        runGetDomains(ctx);
        return;
      default:
        emitReadFailure(
          command,
          "unknown_target",
          `get \u306E\u5BFE\u8C61\u306F ${GET_TARGETS.join(" / ")} \u306E\u3044\u305A\u308C\u304B\u3067\u3059(\u53D7\u9818: ${JSON.stringify(target ?? null)})\u3002`,
          { targets: GET_TARGETS }
        );
        return;
    }
  } catch (error) {
    emitReadFailure(command, "internal_error", messageOf(error));
  }
}

// src/cli/diff.ts
var MAX_DIFF_LINES = 1500;
var DEFAULT_CONTEXT = 3;
function diffOps(a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const lcs = new Int32Array((n + 1) * width);
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m - 1; j2 >= 0; j2--) {
      lcs[i2 * width + j2] = a[i2] === b[j2] ? lcs[(i2 + 1) * width + (j2 + 1)] + 1 : Math.max(lcs[(i2 + 1) * width + j2], lcs[i2 * width + (j2 + 1)]);
    }
  }
  const entries = [];
  let i = 0;
  let j = 0;
  const push = (kind, line) => {
    if (kind === "eq") {
      entries.push({ kind, line, aNo: i + 1, bNo: j + 1 });
    } else if (kind === "del") {
      entries.push({ kind, line, aNo: i + 1, bNo: 0 });
    } else {
      entries.push({ kind, line, aNo: 0, bNo: j + 1 });
    }
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("eq", a[i]);
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < n) {
    push("del", a[i]);
    i++;
  }
  while (j < m) {
    push("add", b[j]);
    j++;
  }
  return entries;
}
function unifiedDiff(beforeText, afterText, options = {}) {
  const context = options.context ?? DEFAULT_CONTEXT;
  const fromLabel = options.fromLabel ?? "a";
  const toLabel = options.toLabel ?? "b";
  const a = splitTextLines(beforeText);
  const b = splitTextLines(afterText);
  const base = {
    truncated: false,
    truncatedReason: null,
    beforeLines: a.length,
    afterLines: b.length,
    maxLines: MAX_DIFF_LINES
  };
  if (a.length === 0 && b.length === 0) return { ...base, unified: "" };
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    const reason = `\u884C\u6570\u304C\u4E0A\u9650 ${MAX_DIFF_LINES} \u3092\u8D85\u3048\u305F\u305F\u3081 unified diff \u3092\u7701\u7565\u3057\u305F(${a.length} \u884C \u2192 ${b.length} \u884C)\u3002sections \u306E before / after \u304B\u3089\u63D0\u793A\u3059\u308B\u3053\u3068\u3002`;
    return {
      ...base,
      unified: `(\u5DEE\u5206\u3092\u7701\u7565\u3057\u307E\u3057\u305F: ${reason})`,
      truncated: true,
      truncatedReason: reason
    };
  }
  const entries = diffOps(a, b);
  const changed = entries.map((e) => e.kind !== "eq");
  if (!changed.includes(true)) return { ...base, unified: "" };
  const hunks = [];
  let idx = 0;
  while (idx < entries.length) {
    if (!changed[idx]) {
      idx++;
      continue;
    }
    const start = Math.max(0, idx - context);
    let last = idx;
    let k = idx + 1;
    while (k < entries.length) {
      if (changed[k]) {
        last = k;
        k++;
        continue;
      }
      let run = k;
      while (run < entries.length && !changed[run]) run++;
      if (run < entries.length && run - k <= context * 2) {
        k = run;
        continue;
      }
      break;
    }
    const end = Math.min(entries.length - 1, last + context);
    hunks.push({ start, end });
    idx = end + 1;
  }
  const out = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  for (const hunk of hunks) {
    const slice = entries.slice(hunk.start, hunk.end + 1);
    let aStart = 0;
    let bStart = 0;
    let aCount = 0;
    let bCount = 0;
    for (const entry of slice) {
      if (entry.kind !== "add") {
        if (aStart === 0) aStart = entry.aNo;
        aCount++;
      }
      if (entry.kind !== "del") {
        if (bStart === 0) bStart = entry.bNo;
        bCount++;
      }
    }
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const entry of slice) {
      const prefix = entry.kind === "eq" ? " " : entry.kind === "del" ? "-" : "+";
      out.push(`${prefix}${entry.line}`);
    }
  }
  return { ...base, unified: out.join("\n") };
}

// src/cli/stage.ts
function sectionDiffs(beforeText, afterText, headings) {
  const before = parseArchitectureForRead(beforeText);
  const after = parseArchitectureForRead(afterText);
  return headings.map((entry) => ({
    heading: entry.heading,
    mode: entry.mode,
    before: findSection(before, entry.heading)?.body ?? null,
    after: findSection(after, entry.heading)?.body ?? null
  }));
}
function diffPayload(diff, sections) {
  return {
    unified: diff.unified,
    truncated: diff.truncated,
    truncatedReason: diff.truncatedReason,
    beforeLines: diff.beforeLines,
    afterLines: diff.afterLines,
    maxLines: diff.maxLines,
    sections
  };
}
function withTruncationNote(diff, reminder) {
  if (!diff.truncated) return reminder;
  return `${reminder} \u306A\u304A unified diff \u306F\u7701\u7565\u3055\u308C\u3066\u3044\u308B(diff.truncated)\u3002diff.sections \u306E before / after \u304B\u3089\u30BB\u30AF\u30B7\u30E7\u30F3\u5358\u4F4D\u3067\u5168\u6587\u3092\u63D0\u793A\u3059\u308B\u3053\u3068\u3002\u7701\u7565\u3055\u308C\u305F\u307E\u307E\u627F\u8A8D\u3092\u6C42\u3081\u306A\u3044\u3002`;
}
function runStageArchitecture(ctx) {
  const command = "stage-architecture";
  const input = loadInputJson(ctx.flags);
  if (!input.ok) {
    emitWriteFailure(
      command,
      input.error,
      input.message,
      { valid: false },
      EXIT_USAGE
    );
    return;
  }
  if (!isPlainObject4(input.value)) {
    emitWriteFailure(
      command,
      "invalid_input",
      `${input.source} \u306E\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u306F { sections: [{ heading, body } | { heading, remove: true }] } \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\u3002`,
      { valid: false },
      EXIT_USAGE
    );
    return;
  }
  const config = loadConfig(ctx.cwd);
  const file = readDocument(config.architecturePath);
  const rawSections = input.value.sections;
  const reason = input.value.reason;
  const changes = rawSections;
  const update = prepareArchitectureUpdate(file.text, changes);
  const warnings = [...config.warnings, ...file.warnings, ...update.warnings];
  noteWarnings(warnings);
  if (!update.ok) {
    emitWriteFailure(command, update.error, update.message, {
      valid: false,
      stagingId: null,
      path: config.architecturePath,
      warnings
    });
    return;
  }
  const staged = createStaging({
    projectRoot: config.docRoot,
    kind: "architecture",
    targetPath: config.architecturePath,
    nextContent: update.text,
    baseHash: file.hash,
    meta: {
      applied: update.applied,
      reason: typeof reason === "string" ? reason : null
    }
  });
  if (!staged.ok) {
    emitWriteFailure(command, staged.error, staged.reasons.join(" / "), {
      valid: false,
      stagingId: null,
      path: config.architecturePath,
      warnings
    });
    return;
  }
  const diff = unifiedDiff(file.text, update.text, {
    fromLabel: `${config.architectureRelative} (\u73FE\u884C)`,
    toLabel: `${config.architectureRelative} (stage)`
  });
  const lineCount = countArchitectureLines(update.text);
  const lineWarning = lineLimitWarning(lineCount);
  if (lineWarning !== null) {
    warnings.push(lineWarning);
    noteWarnings([lineWarning]);
  }
  emitResult(command, {
    ok: true,
    valid: true,
    stagingId: staged.stagingId,
    path: config.architecturePath,
    baseExists: file.exists,
    created: update.created,
    applied: update.applied,
    lineCount,
    lineLimit: ARCHITECTURE_LINE_LIMIT,
    diff: diffPayload(
      diff,
      sectionDiffs(file.text, update.text, update.applied)
    ),
    expiresAt: new Date(staged.expiresAt).toISOString(),
    warnings,
    next: commandLine(`commit-architecture --staging-id ${staged.stagingId}`),
    reminder: withTruncationNote(
      diff,
      "diff \u3092\u5168\u6587\u63D0\u793A\u3057\u3066\u30E6\u30FC\u30B6\u30FC\u306E\u627F\u8A8D\u3092\u5F97\u308B\u307E\u3067 commit-architecture \u3092\u5B9F\u884C\u3057\u306A\u3044\u3053\u3068\u3002CLI \u306F\u627F\u8A8D\u306E\u6709\u7121\u3092\u5224\u5B9A\u3067\u304D\u306A\u3044\u3002"
    )
  });
}

// src/cli/main.ts
var READ_SUBCOMMANDS = /* @__PURE__ */ new Set(["get", "scan", "diff-architecture"]);
var WRITE_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "stage-architecture",
  "commit-architecture",
  "link-claude-md"
]);
function emitUsage(command, message, exitCode) {
  emitResult(command, {
    ok: false,
    error: "unknown_subcommand",
    message,
    subcommands: [...READ_SUBCOMMANDS, ...WRITE_SUBCOMMANDS]
  });
  for (const line of USAGE_LINES) note(line);
  process.exitCode = exitCode;
}
function main(argv, cwd = process.cwd()) {
  const { positionals, flags, errors } = parseArgs(argv);
  const subcommand = positionals[0];
  const isRead = subcommand !== void 0 && READ_SUBCOMMANDS.has(subcommand);
  const isWrite = subcommand !== void 0 && WRITE_SUBCOMMANDS.has(subcommand);
  if (subcommand === void 0 || !isRead && !isWrite) {
    emitUsage(
      "metatron",
      subcommand === void 0 ? "\u30B5\u30D6\u30B3\u30DE\u30F3\u30C9\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002" : `\u4E0D\u660E\u306A\u30B5\u30D6\u30B3\u30DE\u30F3\u30C9: ${subcommand}`,
      EXIT_USAGE
    );
    return;
  }
  if (errors.length > 0) {
    const message = errors.join(" / ");
    if (isRead) {
      emitReadFailure(subcommand, "invalid_option", message);
    } else {
      emitWriteFailure(subcommand, "invalid_option", message, {}, EXIT_USAGE);
    }
    return;
  }
  const ctx = { flags, cwd };
  try {
    switch (subcommand) {
      case "get":
        runGet(positionals[1], ctx);
        return;
      case "scan":
        runScan(ctx);
        return;
      case "diff-architecture":
        runDiffArchitecture(ctx);
        return;
      case "link-claude-md":
        runLinkClaudeMd(ctx);
        return;
      case "stage-architecture":
        runStageArchitecture(ctx);
        return;
      case "commit-architecture":
        runCommitArchitecture(ctx);
        return;
      default:
        emitUsage("metatron", `\u4E0D\u660E\u306A\u30B5\u30D6\u30B3\u30DE\u30F3\u30C9: ${subcommand}`, EXIT_USAGE);
        return;
    }
  } catch (error) {
    if (isRead) {
      emitReadFailure(subcommand, "internal_error", messageOf(error));
      return;
    }
    emitWriteFailure(subcommand, "internal_error", messageOf(error), {
      written: false
    });
  }
}

// src/metatron-cli.ts
main(process.argv.slice(2));
