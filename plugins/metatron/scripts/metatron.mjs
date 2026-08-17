#!/usr/bin/env node

// src/lib/architecture.ts
var ARCHITECTURE_TITLE = "# ARCHITECTURE";
var ARCHITECTURE_HEADINGS = [
  "\u30B7\u30B9\u30C6\u30E0\u6982\u8981",
  "\u6280\u8853\u30B9\u30BF\u30C3\u30AF",
  "\u30EC\u30A4\u30E4\u30FC\u69CB\u9020",
  "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u3068\u8CAC\u52D9",
  "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7",
  "\u30B3\u30DE\u30F3\u30C9\u5B9A\u7FA9",
  "\u30C6\u30B9\u30C8\u65B9\u91DD",
  "\u4FDD\u8B77\u30D1\u30B9",
  "\u898F\u7D04",
  "ADR \u4E00\u89A7"
];
var ADR_HEADING = "ADR \u4E00\u89A7";
var DOMAINS_HEADING = "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7";
var DOMAINS_MARKER = "metatron:domains";
var RETIRED_PSEUDO_KEYS = /* @__PURE__ */ new Set(["overview"]);
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
function validateHeadingKey(heading) {
  if (typeof heading !== "string" || heading.trim() === "") {
    return {
      ok: false,
      error: "unknown_heading",
      message: `heading \u304C\u7A7A\u3067\u3059\u3002\u6307\u5B9A\u3067\u304D\u308B\u306E\u306F ${ARCHITECTURE_HEADINGS.join(" / ")} \u306E\u3044\u305A\u308C\u304B\u3067\u3059\u3002`
    };
  }
  const value = heading.trim();
  if (value === ADR_HEADING) {
    return {
      ok: false,
      error: "adr_heading",
      message: "`ADR \u4E00\u89A7` \u306F stage-architecture \u3067\u306F\u5909\u66F4\u3067\u304D\u307E\u305B\u3093\u3002ADR \u306E\u8FFD\u52A0\u30FB\u72B6\u614B\u5909\u66F4\u306F stage-adr \u3092\u4F7F\u3063\u3066\u304F\u3060\u3055\u3044\u3002\u7BC0\u3054\u3068\u306E\u5DEE\u3057\u66FF\u3048\u3092\u8A31\u3059\u3068\u3001\u63A1\u756A\u30FB`\u72B6\u614B` \u306E\u5024\u57DF\u30FB\u72B6\u614B\u5909\u66F4\u5C65\u6B74\u306E\u8FFD\u8A18\u3092\u3059\u3079\u3066\u8FC2\u56DE\u3067\u304D\u308B\u305F\u3081\u3067\u3059\u3002"
    };
  }
  if (RETIRED_PSEUDO_KEYS.has(value.toLowerCase())) {
    return {
      ok: false,
      error: "retired_overview_key",
      message: "`overview` \u7591\u4F3C\u30AD\u30FC\u306F\u5EC3\u6B62\u3057\u307E\u3057\u305F\u3002\u5192\u982D\u306E\u6982\u8981\u306F `\u30B7\u30B9\u30C6\u30E0\u6982\u8981` \u30BB\u30AF\u30B7\u30E7\u30F3\u306B\u66F8\u3044\u3066\u304F\u3060\u3055\u3044\u3002"
    };
  }
  if (!isArchitectureHeading(value)) {
    return {
      ok: false,
      error: "unknown_heading",
      message: `\u672A\u77E5\u306E\u898B\u51FA\u3057\u300C${value}\u300D\u3067\u3059\u3002\u6307\u5B9A\u3067\u304D\u308B\u306E\u306F ${ARCHITECTURE_HEADINGS.join(" / ")} \u306E\u3044\u305A\u308C\u304B\u3067\u3059\u3002`
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
    out += buildSectionText(change.heading, change.body, eol, true);
  }
  return out.replace(/(\r?\n)+$/, eol);
}
function applySectionChanges(current, changes) {
  const warnings = [];
  const text = current ?? "";
  const eol = detectEol(text);
  if (text.trim() === "") {
    return {
      ok: true,
      text: createArchitecture(changes, eol),
      created: true,
      applied: changes.map((c) => ({
        heading: c.heading,
        mode: "added"
      })),
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
  for (const change of changes) {
    const order = canonicalIndex(change.heading);
    const section = findSection(doc, change.heading);
    if (section) {
      const body = normalizeBody(change.body, eol);
      ops.push({
        start: section.startLine + 1,
        end: section.contentEndLine,
        text: body === "" ? "" : `${eol}${body}${eol}`,
        order
      });
      applied.push({ heading: change.heading, mode: "replaced" });
      continue;
    }
    const anchor = insertionAnchor(doc, change.heading);
    if (anchor !== null) {
      ops.push({
        start: anchor,
        end: anchor,
        text: buildSectionText(change.heading, change.body, eol, true),
        order
      });
    } else {
      const last = lines[lines.length - 1];
      let prefix = "";
      if (!last.raw.endsWith("\n")) prefix += eol;
      if (last.text.trim() !== "") prefix += eol;
      ops.push({
        start: lines.length,
        end: lines.length,
        text: prefix + buildSectionText(change.heading, change.body, eol, false),
        order
      });
    }
    applied.push({ heading: change.heading, mode: "added" });
  }
  ops.sort((a, b) => b.start - a.start || b.order - a.order);
  for (const op of ops) chunks.splice(op.start, op.end - op.start, op.text);
  return { ok: true, text: chunks.join(""), created: false, applied, warnings };
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
    const validated = validateHeadingKey(change?.heading);
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
    if (typeof change?.body !== "string") {
      return {
        ok: false,
        error: "invalid_body",
        message: `\u300C${validated.heading}\u300D\u306E body \u304C\u6587\u5B57\u5217\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002`,
        warnings
      };
    }
    normalizedChanges.push({ heading: validated.heading, body: change.body });
  }
  const domainsChange = normalizedChanges.find(
    (c) => c.heading === DOMAINS_HEADING
  );
  if (domainsChange) {
    const lookup = findDomainsBlock(domainsChange.body);
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
var DEFAULT_GOTCHAS_PATH = "docs/GOTCHAS.md";
var DEFAULT_INJECTION_ENABLED = true;
var DEFAULT_GOTCHAS_RECENT_COUNT = 5;
var DEFAULT_MAX_CHARS = 9e3;
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

// src/lib/scan.ts
import fs2 from "node:fs";
import path2 from "node:path";
var ARCHITECTURE_SECTIONS = [
  "\u30B7\u30B9\u30C6\u30E0\u6982\u8981",
  "\u6280\u8853\u30B9\u30BF\u30C3\u30AF",
  "\u30EC\u30A4\u30E4\u30FC\u69CB\u9020",
  "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u3068\u8CAC\u52D9",
  "\u30C9\u30E1\u30A4\u30F3\u30DE\u30C3\u30D7",
  "\u30B3\u30DE\u30F3\u30C9\u5B9A\u7FA9",
  "\u30C6\u30B9\u30C8\u65B9\u91DD",
  "\u4FDD\u8B77\u30D1\u30B9",
  "\u898F\u7D04",
  "ADR \u4E00\u89A7"
];
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
var PACKAGE_MANAGER_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "install",
  "i",
  "ci",
  "add",
  "remove",
  "rm",
  "un",
  "uninstall",
  "exec",
  "dlx",
  "x",
  "create",
  "init",
  "update",
  "up",
  "upgrade",
  "outdated",
  "audit",
  "publish",
  "pack",
  "link",
  "unlink",
  "why",
  "list",
  "ls",
  "run",
  "workspace",
  "recursive",
  "config",
  "store",
  "dedupe",
  "licenses",
  "info",
  "version"
]);
var NON_PACKAGE_TOKENS = /* @__PURE__ */ new Set([
  "node",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "git",
  "docker",
  "make",
  "python",
  "python3",
  "pip",
  "uv",
  "poetry",
  "go",
  "rust",
  "cargo",
  "java",
  "kotlin",
  "swift",
  "ruby",
  "php",
  "sh",
  "bash",
  "zsh",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "md",
  "markdown",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "esm",
  "cjs-only",
  "src",
  "dist",
  "scripts",
  "main",
  "dev",
  "prod",
  "latest",
  "workspace",
  "true",
  "false",
  "null"
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
function looksLikePackageName(token) {
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(token);
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
    if (dirent.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(dirent.name)) continue;
      if (depth + 1 <= 2) state.dirs.add(childRel);
      pushTree(state, childRel, depth + 1, "directory");
      walkDirectory(state, path2.join(dir, dirent.name), childRel, depth + 1);
    } else if (dirent.isFile()) {
      recordFile(state, childRel);
      pushTree(state, childRel, depth + 1, "file");
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
function scanPackageManager(root, packageJson, warnings) {
  const lockfiles = [];
  let name = null;
  for (const entry of LOCKFILES) {
    if (!fileExists(path2.join(root, entry.file))) continue;
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
function scanLanguages(root, packageJson) {
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
  const tsconfigPath = path2.join(root, "tsconfig.json");
  if (fileExists(tsconfigPath)) {
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
  const pyproject = readTextFile(path2.join(root, "pyproject.toml"));
  if (pyproject !== null) {
    const details = {};
    const requires = tomlValue(pyproject, "requires-python");
    if (requires !== void 0) details["requires-python"] = requires;
    const name = tomlValue(pyproject, "name");
    if (name !== void 0) details.name = name;
    out.push({ name: "Python", source: "pyproject.toml", details });
  }
  const goMod = readTextFile(path2.join(root, "go.mod"));
  if (goMod !== null) {
    const details = {};
    const moduleName = /^module\s+(\S+)\s*$/m.exec(goMod)?.[1];
    if (moduleName !== void 0) details.module = moduleName;
    const goVersion = /^go\s+(\S+)\s*$/m.exec(goMod)?.[1];
    if (goVersion !== void 0) details.go = goVersion;
    out.push({ name: "Go", source: "go.mod", details });
  }
  const cargo = readTextFile(path2.join(root, "Cargo.toml"));
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
  const pyproject = readTextFile(path2.join(root, "pyproject.toml"));
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
function collectMarkdownFiles(dir, rel, depth, maxDepth, out, limit) {
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
    if (dirent.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(dirent.name)) continue;
      collectMarkdownFiles(
        path2.join(dir, dirent.name),
        childRel,
        depth + 1,
        maxDepth,
        out,
        limit
      );
    } else if (dirent.isFile() && /\.md$/i.test(dirent.name)) {
      out.push(childRel);
    }
  }
}
function scanDocuments(root, limits, truncation) {
  const targets = [];
  let rootEntries = [];
  try {
    rootEntries = fs2.readdirSync(root, { withFileTypes: true });
  } catch {
    rootEntries = [];
  }
  rootEntries.sort((a, b) => compareStrings(a.name, b.name));
  for (const dirent of rootEntries) {
    if (!dirent.isFile()) continue;
    const lower = dirent.name.toLowerCase();
    if (lower === "readme.md" || lower === "claude.md")
      targets.push(dirent.name);
  }
  const docsDir = path2.join(root, "docs");
  const docsFiles = [];
  collectMarkdownFiles(docsDir, "docs", 1, 3, docsFiles, limits.maxDocuments);
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
  const state = {
    limits,
    tree: [],
    files: [],
    fileCount: 0,
    testFiles: [],
    dirFileCounts: /* @__PURE__ */ new Map(),
    dirSamples: /* @__PURE__ */ new Map(),
    dirs: /* @__PURE__ */ new Set(),
    visited: 0,
    truncation,
    unreadable: []
  };
  walkDirectory(state, root, "", 0);
  if (state.unreadable.length > 0) {
    const shown = state.unreadable.slice(0, 5).join(", ");
    warnings.push(
      `\u8AAD\u3081\u306A\u304B\u3063\u305F\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u3092 ${String(state.unreadable.length)} \u4EF6\u30B9\u30AD\u30C3\u30D7\u3057\u307E\u3057\u305F(${shown})\u3002`
    );
  }
  const packageJsonRaw = readJsonFile(path2.join(root, "package.json"));
  const packageJsonExists = fileExists(path2.join(root, "package.json"));
  const packageJson = isPlainObject2(packageJsonRaw) ? packageJsonRaw : null;
  if (packageJsonExists && packageJson === null) {
    warnings.push(
      "package.json \u3092 JSON \u3068\u3057\u3066\u8AAD\u3081\u306A\u304B\u3063\u305F\u305F\u3081\u3001\u4F9D\u5B58\u3068\u30B3\u30DE\u30F3\u30C9\u3092\u53CE\u96C6\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002"
    );
  }
  const packageManager = scanPackageManager(root, packageJson, warnings);
  const languages = scanLanguages(root, packageJson);
  const dependencies = {
    source: packageJson === null ? null : "package.json",
    dependencies: toDependencyEntries(packageJson?.dependencies),
    devDependencies: toDependencyEntries(packageJson?.devDependencies)
  };
  const { scripts, commands } = scanScripts(packageJson, packageManager.name);
  const testFrameworks = scanTestFrameworks(root, state, dependencies);
  const domainCandidates = scanDomainCandidates(state);
  const documents = scanDocuments(root, limits, truncation);
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
  tech_stack_added: 1,
  tech_stack_removed: 2,
  command_added: 3,
  command_removed: 4,
  directory_undocumented: 5,
  directory_stale: 6,
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
function diffTechStack(result, body, findings) {
  const section = "\u6280\u8853\u30B9\u30BF\u30C3\u30AF";
  if (body === void 0) return;
  const declared = /* @__PURE__ */ new Set();
  for (const dep of [
    ...result.dependencies.dependencies,
    ...result.dependencies.devDependencies
  ]) {
    declared.add(dep.name);
    if (!body.includes(dep.name)) {
      findings.push({
        kind: "tech_stack_added",
        section,
        subject: dep.name,
        detail: `package.json \u306E\u4F9D\u5B58 ${dep.name} \u304C ## ${section} \u306B\u8A18\u8F09\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002`
      });
    }
  }
  const seen = /* @__PURE__ */ new Set();
  for (const token of extractInlineCode(body)) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (!looksLikePackageName(token)) continue;
    if (NON_PACKAGE_TOKENS.has(token)) continue;
    if (declared.has(token)) continue;
    findings.push({
      kind: "tech_stack_removed",
      section,
      subject: token,
      detail: `## ${section} \u306B\u66F8\u304B\u308C\u305F ${token} \u304C package.json \u306E\u4F9D\u5B58\u306B\u3042\u308A\u307E\u305B\u3093\u3002`
    });
  }
}
function diffCommands(result, body, findings) {
  const section = "\u30B3\u30DE\u30F3\u30C9\u5B9A\u7FA9";
  if (body === void 0) return;
  const scriptNames = new Set(result.scripts.map((s) => s.name));
  for (const command of result.commands) {
    const mentioned = body.includes(command.script) || body.includes(command.command);
    if (mentioned) continue;
    findings.push({
      kind: "command_added",
      section,
      subject: command.script,
      detail: `package.json \u306E scripts.${command.script}(${command.kind})\u304C ## ${section} \u306B\u8A18\u8F09\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002`
    });
  }
  const re = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?([A-Za-z0-9:_.-]+)/g;
  const seen = /* @__PURE__ */ new Set();
  let m = re.exec(body);
  while (m !== null) {
    const name = m[1] ?? "";
    m = re.exec(body);
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    if (PACKAGE_MANAGER_SUBCOMMANDS.has(name)) continue;
    if (scriptNames.has(name)) continue;
    findings.push({
      kind: "command_removed",
      section,
      subject: name,
      detail: `## ${section} \u306B\u66F8\u304B\u308C\u305F\u30B3\u30DE\u30F3\u30C9 ${name} \u304C package.json \u306E scripts \u306B\u3042\u308A\u307E\u305B\u3093\u3002`
    });
  }
}
function diffDirectories(result, body, findings) {
  const section = "\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u3068\u8CAC\u52D9";
  if (body === void 0) return;
  for (const entry of result.tree) {
    if (entry.type !== "directory" || entry.depth !== 1) continue;
    if (body.includes(entry.path)) continue;
    findings.push({
      kind: "directory_undocumented",
      section,
      subject: entry.path,
      detail: `\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u306E\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA ${entry.path} \u304C ## ${section} \u306B\u8A18\u8F09\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002`
    });
  }
  const existing = /* @__PURE__ */ new Set();
  for (const entry of result.tree) {
    if (entry.type === "directory") existing.add(entry.path);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const raw of extractInlineCode(body)) {
    const token = raw.replace(/\/+$/, "");
    if (token === "" || seen.has(token)) continue;
    seen.add(token);
    if (/[*?[\]{}]/.test(token)) continue;
    if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(token)) continue;
    if (!token.includes("/")) continue;
    if (existing.has(token)) continue;
    if (token.split("/").length > DEFAULT_SCAN_LIMITS.maxDepth) continue;
    if (result.files.includes(token)) continue;
    findings.push({
      kind: "directory_stale",
      section,
      subject: token,
      detail: `## ${section} \u306B\u66F8\u304B\u308C\u305F ${token} \u304C\u5B9F\u5728\u3057\u307E\u305B\u3093\u3002`
    });
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
  for (const g of globs) {
    if (result.files.some((file) => g.re.test(file))) continue;
    findings.push({
      kind: "domain_dead_glob",
      section,
      subject: g.glob,
      detail: `\u30C9\u30E1\u30A4\u30F3 ${g.domain} \u306E glob ${g.glob} \u304C\u3069\u306E\u30D5\u30A1\u30A4\u30EB\u306B\u3082\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002`
    });
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
  if (input.scan.dependencies.source === null) {
    skipped.push(
      "\u6280\u8853\u30B9\u30BF\u30C3\u30AF / \u30B3\u30DE\u30F3\u30C9\u306E\u7A81\u304D\u5408\u308F\u305B: package.json \u3092\u8AAD\u3081\u306A\u304B\u3063\u305F\u305F\u3081\u691C\u51FA\u3057\u307E\u305B\u3093\u3067\u3057\u305F\u3002"
    );
  } else {
    diffTechStack(input.scan, sections.get("\u6280\u8853\u30B9\u30BF\u30C3\u30AF"), findings);
    diffCommands(input.scan, sections.get("\u30B3\u30DE\u30F3\u30C9\u5B9A\u7FA9"), findings);
  }
  diffDirectories(input.scan, sections.get("\u30C7\u30A3\u30EC\u30AF\u30C8\u30EA\u69CB\u6210\u3068\u8CAC\u52D9"), findings);
  diffDomains(input.scan, input.domains, findings, skipped);
  skipped.push(
    "\u4FDD\u8B77\u30D1\u30B9\u306E\u4E0D\u6574\u5408: raguel.config.yaml \u306E\u89E3\u6790\u3092\u4F34\u3046\u305F\u3081\u3001\u3053\u306E\u95A2\u6570\u3067\u306F\u691C\u51FA\u3057\u307E\u305B\u3093\u3002"
  );
  skipped.push(
    "ADR \u306E\u72B6\u614B\u306E\u9673\u8150\u5316: ADR \u306E\u89E3\u6790(adr.ts)\u3092\u4F34\u3046\u305F\u3081\u3001\u3053\u306E\u95A2\u6570\u3067\u306F\u691C\u51FA\u3057\u307E\u305B\u3093\u3002"
  );
  findings.sort(
    (a, b) => FINDING_ORDER[a.kind] - FINDING_ORDER[b.kind] || compareStrings(a.subject, b.subject)
  );
  return { findings, skipped, warnings };
}
function diffArchitecture(input) {
  try {
    return diffArchitectureInner(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      findings: [],
      skipped: [],
      warnings: [`\u4E56\u96E2\u5019\u88DC\u306E\u7B97\u51FA\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${reason}`]
    };
  }
}

// src/cli/input.ts
import fs4 from "node:fs";

// src/lib/staging.ts
import crypto from "node:crypto";
import fs3 from "node:fs";
import os from "node:os";
import path3 from "node:path";
var STAGING_DIR_NAME = "metatron-staging";
var STAGING_RECORD_VERSION = 2;
var DEFAULT_STAGING_TTL_MS = 30 * 60 * 1e3;
function hashBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function hashContent(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return hashBuffer(buf);
}
function hashFileOrNull(filePath) {
  try {
    return hashBuffer(fs3.readFileSync(filePath));
  } catch {
    return null;
  }
}
function projectKey(projectRoot) {
  let resolved;
  try {
    resolved = path3.resolve(projectRoot);
  } catch {
    resolved = projectRoot;
  }
  let real = resolved;
  try {
    real = fs3.realpathSync(resolved);
  } catch {
  }
  return hashContent(real.split(path3.sep).join("/")).slice(0, 16);
}
function stagingRootDir() {
  return path3.join(os.tmpdir(), STAGING_DIR_NAME);
}
function stagingDirFor(projectRoot) {
  return path3.join(stagingRootDir(), projectKey(projectRoot));
}
var STAGING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function isSafeStagingId(stagingId) {
  return typeof stagingId === "string" && STAGING_ID_PATTERN.test(stagingId);
}
function stagingRecordPath(projectRoot, stagingId) {
  if (!isSafeStagingId(stagingId)) return null;
  return path3.join(stagingDirFor(projectRoot), `${stagingId}.json`);
}
function isInside(root, target) {
  const rel = path3.relative(root, target);
  if (rel === "" || rel === "..") return false;
  return !rel.startsWith(`..${path3.sep}`) && !path3.isAbsolute(rel);
}
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStagingKind(value) {
  return value === "architecture" || value === "adr";
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
    const text = fs3.readFileSync(recordPath, "utf8");
    return parseRecord(JSON.parse(text), stagingId);
  } catch {
    return null;
  }
}
function writeRecord(recordPath, record) {
  const dir = path3.dirname(recordPath);
  fs3.mkdirSync(dir, { recursive: true });
  const tmpPath = `${recordPath}.tmp-${crypto.randomUUID()}`;
  const body = `${JSON.stringify(record, null, 2)}
`;
  fs3.writeFileSync(tmpPath, body, { encoding: "utf8", mode: 384 });
  try {
    fs3.renameSync(tmpPath, recordPath);
  } catch (err) {
    try {
      fs3.rmSync(tmpPath, { force: true });
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
  const projectRoot = path3.resolve(input.projectRoot);
  const targetPath = path3.resolve(projectRoot, input.targetPath);
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
  const stagingId = crypto.randomUUID();
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
  const recordPath = path3.join(stagingDirFor(projectRoot), `${stagingId}.json`);
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
  const projectRoot = path3.resolve(input.projectRoot);
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
    fs3.mkdirSync(path3.dirname(record.targetPath), { recursive: true });
    fs3.writeFileSync(record.targetPath, buf);
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
var BOOLEAN_FLAGS = /* @__PURE__ */ new Set([
  "exclude-tagged",
  "promotion-candidates",
  "help"
]);
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
function boolFlag(flags, name) {
  const value = flags[name];
  if (value === true) return true;
  if (typeof value === "string") return value !== "false" && value !== "0";
  return false;
}
function intFlag(flags, name) {
  const raw = flags[name];
  if (raw === void 0) return { ok: true, value: void 0 };
  if (raw === true)
    return { ok: false, message: `--${name} \u306B\u5024\u304C\u3042\u308A\u307E\u305B\u3093\u3002` };
  if (!/^-?\d+$/.test(raw.trim())) {
    return {
      ok: false,
      message: `--${name} \u306F\u6574\u6570\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044(\u53D7\u9818: ${JSON.stringify(raw)})\u3002`
    };
  }
  return { ok: true, value: Number.parseInt(raw.trim(), 10) };
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
    return fs4.readFileSync(0, "utf8");
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
      raw = fs4.readFileSync(inputPath, "utf8");
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
    const buf = fs4.readFileSync(filePath);
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
      skipped: result.skipped,
      truncation: scanned.truncation,
      warnings
    });
  } catch (error) {
    emitReadFailure(command, "internal_error", messageOf(error));
  }
}

// src/lib/gotchas.ts
import fs5 from "node:fs";
import path4 from "node:path";
var GOTCHA_TAGS = ["\u89E3\u6C7A\u6E08\u307F", "\u5BFE\u8C61\u5916"];
var LIST_SECTION_TITLE = "\u5931\u6557\u30D1\u30BF\u30FC\u30F3\u4E00\u89A7";
var GotchaError = class extends Error {
  code;
  details;
  constructor(code, message, details = []) {
    super(message);
    this.name = "GotchaError";
    this.code = code;
    this.details = details;
  }
};
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
function parseGotchaId(raw) {
  const m = /^(?:GOTCHA-)?(\d+)$/i.exec(raw.trim());
  if (m === null) return null;
  const num = Number.parseInt(m[1], 10);
  return Number.isFinite(num) ? num : null;
}
function findGotchaByNumber(doc, num) {
  return doc.entries.find((entry) => entry.number === num) ?? null;
}
function filterGotchas(entries, filter = {}) {
  let result = entries;
  if (filter.id !== void 0) {
    const num = parseGotchaId(filter.id);
    result = num === null ? [] : result.filter((e) => e.number === num);
  }
  if (filter.query !== void 0 && filter.query !== "") {
    const needle = filter.query.toLowerCase();
    result = result.filter((e) => e.raw.toLowerCase().includes(needle));
  }
  if (filter.excludeTagged === true) {
    result = result.filter((e) => e.tag === null);
  }
  if (filter.promotionCandidates === true) {
    result = result.filter((e) => e.promotionCandidate === "Yes");
  }
  if (filter.recent !== void 0 && filter.recent >= 0) {
    result = result.slice(0, filter.recent);
  }
  return result;
}
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var PLATITUDES = /* @__PURE__ */ new Set([
  "\u6C17\u3092\u3064\u3051\u308B",
  "\u6C17\u3092\u4ED8\u3051\u308B",
  "\u6C17\u3092\u3064\u3051\u305F\u3044",
  "\u6C17\u3092\u3064\u3051\u308B\u3053\u3068",
  "\u6C17\u3092\u4ED8\u3051\u308B\u3053\u3068",
  "\u6CE8\u610F",
  "\u6CE8\u610F\u3059\u308B",
  "\u6CE8\u610F\u3057\u305F\u3044",
  "\u6CE8\u610F\u3059\u308B\u3053\u3068"
]);
function normalizeForPlatitude(value) {
  return value.replace(/[\s　]/g, "").replace(/[。.、,!！]+$/, "");
}
function requireSingleLine(value, label, errors) {
  if (typeof value !== "string") {
    errors.push(`${label} \u304C\u6587\u5B57\u5217\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002`);
    return "";
  }
  if (value.includes("\n") || value.includes("\r")) {
    errors.push(
      `${label} \u306B\u6539\u884C\u304C\u542B\u307E\u308C\u3066\u3044\u307E\u3059\u30021 \u884C\u3067\u66F8\u3051\u308B\u5185\u5BB9\u306B\u8981\u7D04\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    );
    return "";
  }
  return value;
}
function validateGotchaInput(input) {
  const errors = [];
  const warnings = [];
  const title = requireSingleLine(input.title, "title", errors);
  if (title.trim() === "") errors.push("title \u304C\u7A7A\u3067\u3059\u3002");
  if (input.date !== void 0) {
    if (typeof input.date !== "string" || !DATE_RE.test(input.date)) {
      errors.push("date \u306F YYYY-MM-DD \u306E\u5F62\u5F0F\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    }
  }
  const task = requireSingleLine(input.task, "task", errors);
  const mistake = requireSingleLine(input.mistake, "mistake", errors);
  const cause = requireSingleLine(input.cause, "cause", errors);
  const countermeasure = requireSingleLine(
    input.countermeasure,
    "countermeasure",
    errors
  );
  if (input.promotionCandidate !== "Yes" && input.promotionCandidate !== "No") {
    errors.push(
      `promotionCandidate \u306F "Yes" \u307E\u305F\u306F "No" \u306E\u307F\u3092\u53D7\u3051\u4ED8\u3051\u307E\u3059(\u53D7\u9818: ${JSON.stringify(
        input.promotionCandidate
      )})\u3002`
    );
  }
  for (const [label, value] of [
    ["task", task],
    ["mistake", mistake],
    ["cause", cause]
  ]) {
    if (value.trim() === "") warnings.push(`${label} \u304C\u7A7A\u3067\u3059\u3002`);
  }
  const normalized = normalizeForPlatitude(countermeasure);
  if (normalized === "") {
    warnings.push(
      "countermeasure \u304C\u7A7A\u3067\u3059\u3002\u6B21\u306E\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u304C\u305D\u306E\u307E\u307E\u5B9F\u884C\u3067\u304D\u308B\u884C\u52D5\u306B\u843D\u3068\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    );
  } else if (PLATITUDES.has(normalized)) {
    warnings.push(
      "countermeasure \u304C\u7CBE\u795E\u8AD6\u306E\u307F\u3067\u3059\u3002\u300C\u301C\u3059\u308B\u524D\u306B\u301C\u3092 Read \u3057\u3066\u78BA\u8A8D\u3059\u308B\u300D\u306E\u5F62\u306B\u66F8\u304D\u63DB\u3048\u3066\u304F\u3060\u3055\u3044\u3002"
    );
  }
  return { errors, warnings };
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
function renderGotchasTemplate() {
  return TEMPLATE_LINES.join("\n");
}
function renderEntryLines(num, date, input) {
  return [
    `### [${date}] ${formatGotchaId(num)}: ${input.title.trim()}`,
    "",
    `**\u30BF\u30B9\u30AF**: ${input.task.trim()}`,
    `**\u5931\u6557\u5185\u5BB9**: ${input.mistake.trim()}`,
    `**\u539F\u56E0 (\u63A8\u6E2C)**: ${input.cause.trim()}`,
    `**\u5BFE\u7B56**: ${input.countermeasure.trim()}`,
    `**\u6607\u683C\u5019\u88DC**: ${input.promotionCandidate}`
  ];
}
function applyEol(lines, crlf) {
  return crlf ? lines.map((line) => `${line}\r`) : lines;
}
function isBlank(line) {
  return stripCr(line).trim() === "";
}
function buildAppendedText(existing, input, date) {
  const warnings = [];
  let created = false;
  let sectionCreated = false;
  let source = existing;
  if (source === null || source.trim() === "") {
    source = renderGotchasTemplate();
    created = true;
  }
  let doc = parseGotchas(source);
  warnings.push(...doc.warnings);
  if (doc.listSection === null) {
    const lines2 = [...doc.lines];
    while (lines2.length > 0 && isBlank(lines2[lines2.length - 1])) lines2.pop();
    lines2.push(...applyEol(["", `## ${LIST_SECTION_TITLE}`, ""], doc.crlf));
    doc = parseGotchas(lines2.join("\n"));
    sectionCreated = !created;
  }
  const section = doc.listSection;
  if (section === null) {
    throw new GotchaError(
      "invalid_input",
      `\`## ${LIST_SECTION_TITLE}\` \u7BC0\u3092\u4F5C\u6210\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002`
    );
  }
  const num = doc.nextNumber;
  const insertAt = section.headingIndex + 1;
  const block = ["", ...renderEntryLines(num, date, input)];
  const following = doc.lines[insertAt];
  if (following === void 0 || !isBlank(following)) {
    block.push("");
  }
  const lines = [...doc.lines];
  lines.splice(insertAt, 0, ...applyEol(block, doc.crlf));
  return {
    text: lines.join("\n"),
    id: formatGotchaId(num),
    number: num,
    created,
    sectionCreated,
    warnings
  };
}
function buildTaggedText(existing, num, tag, reason, date) {
  const doc = parseGotchas(existing);
  const entry = findGotchaByNumber(doc, num);
  if (entry === null) {
    throw new GotchaError(
      "not_found",
      `${formatGotchaId(num)} \u304C \`## ${LIST_SECTION_TITLE}\` \u914D\u4E0B\u306B\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002`
    );
  }
  const lines = [...doc.lines];
  const rawHeading = lines[entry.startIndex];
  const hadCr = rawHeading.endsWith("\r");
  const m = ENTRY_HEADING_RE.exec(stripCr(rawHeading));
  if (m === null) {
    throw new GotchaError(
      "not_found",
      `${formatGotchaId(num)} \u306E\u898B\u51FA\u3057\u3092\u89E3\u6790\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002`
    );
  }
  const title = entry.title;
  const rebuilt = `${m[1]} [${tag}]${title === "" ? "" : ` ${title}`}`;
  lines[entry.startIndex] = hadCr ? `${rebuilt}\r` : rebuilt;
  let last = entry.startIndex;
  for (let i = entry.endIndex - 1; i > entry.startIndex; i--) {
    if (!isBlank(lines[i])) {
      last = i;
      break;
    }
  }
  const reasonLine = `**[${tag}] (${date})**: ${reason.trim()}`;
  lines.splice(last + 1, 0, ...applyEol([reasonLine], doc.crlf));
  return {
    text: lines.join("\n"),
    id: entry.id,
    previousTag: entry.tag,
    tag,
    warnings: doc.warnings
  };
}
var LOCK_RETRY_INTERVAL_MS = 50;
var LOCK_MAX_RETRIES = 20;
var LOCK_STALE_MS = 6e4;
function lockPathFor(targetPath) {
  return `${targetPath}.lock`;
}
function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}
function errnoCode(error) {
  return error?.code;
}
function tryCreateLock(lockPath) {
  try {
    const fd = fs5.openSync(lockPath, "wx");
    try {
      fs5.writeSync(fd, `${process.pid} ${(/* @__PURE__ */ new Date()).toISOString()}
`);
    } finally {
      fs5.closeSync(fd);
    }
    return true;
  } catch (error) {
    if (errnoCode(error) === "EEXIST") return false;
    throw error;
  }
}
function statMtimeMs(lockPath) {
  try {
    return fs5.statSync(lockPath).mtimeMs;
  } catch {
    return null;
  }
}
function tryStealStaleLock(lockPath) {
  const mtimeMs = statMtimeMs(lockPath);
  if (mtimeMs === null) return tryCreateLock(lockPath);
  if (Date.now() - mtimeMs <= LOCK_STALE_MS) return false;
  try {
    fs5.unlinkSync(lockPath);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") return false;
  }
  return tryCreateLock(lockPath);
}
function withFileLock(targetPath, fn) {
  const lockPath = lockPathFor(targetPath);
  try {
    fs5.mkdirSync(path4.dirname(lockPath), { recursive: true });
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
    throw new GotchaError(
      "lock_timeout",
      `${lockPath} \u306E\u30ED\u30C3\u30AF\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u4ED6\u306E\u30D7\u30ED\u30BB\u30B9\u304C\u66F8\u304D\u8FBC\u307F\u4E2D\u306E\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002`
    );
  }
  try {
    return fn();
  } finally {
    try {
      fs5.rmSync(lockPath, { force: true });
    } catch {
    }
  }
}
function readTextIfExists(filePath) {
  try {
    return fs5.readFileSync(filePath, "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
}
function formatToday(now) {
  const y = String(now.getFullYear()).padStart(4, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function appendGotcha(gotchasPath, input, options = {}) {
  const validation = validateGotchaInput(input);
  if (validation.errors.length > 0) {
    throw new GotchaError(
      "invalid_input",
      `\u5165\u529B\u304C\u66F8\u5F0F\u3092\u6E80\u305F\u3057\u3066\u3044\u307E\u305B\u3093: ${validation.errors.join(" / ")}`,
      validation.errors
    );
  }
  const date = input.date ?? formatToday(options.now ?? /* @__PURE__ */ new Date());
  return withFileLock(gotchasPath, () => {
    const existing = readTextIfExists(gotchasPath);
    const built = buildAppendedText(existing, input, date);
    fs5.mkdirSync(path4.dirname(gotchasPath), { recursive: true });
    fs5.writeFileSync(gotchasPath, built.text);
    return {
      id: built.id,
      number: built.number,
      path: gotchasPath,
      date,
      created: built.created,
      sectionCreated: built.sectionCreated,
      warnings: [...validation.warnings, ...built.warnings]
    };
  });
}
function isGotchaTag(value) {
  return GOTCHA_TAGS.includes(value);
}
function tagGotcha(gotchasPath, params, options = {}) {
  if (!isGotchaTag(params.tag)) {
    throw new GotchaError(
      "invalid_tag",
      `--tag \u306F ${GOTCHA_TAGS.join(" / ")} \u306E\u307F\u3092\u53D7\u3051\u4ED8\u3051\u307E\u3059(\u53D7\u9818: ${JSON.stringify(
        params.tag
      )})\u3002`
    );
  }
  const tag = params.tag;
  const errors = [];
  const reason = requireSingleLine(params.reason, "reason", errors);
  if (reason.trim() === "") {
    errors.push("reason \u304C\u7A7A\u3067\u3059\u3002\u30BF\u30B0\u3092\u4ED8\u3051\u308B\u7406\u7531\u306F\u5FC5\u9808\u3067\u3059\u3002");
  }
  if (params.date !== void 0 && !DATE_RE.test(params.date)) {
    errors.push("date \u306F YYYY-MM-DD \u306E\u5F62\u5F0F\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  }
  if (errors.length > 0) {
    throw new GotchaError(
      "invalid_input",
      `\u5165\u529B\u304C\u66F8\u5F0F\u3092\u6E80\u305F\u3057\u3066\u3044\u307E\u305B\u3093: ${errors.join(" / ")}`,
      errors
    );
  }
  const num = parseGotchaId(params.id);
  if (num === null) {
    throw new GotchaError(
      "invalid_input",
      `--id \u306F GOTCHA-NNN \u306E\u5F62\u5F0F\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044(\u53D7\u9818: ${JSON.stringify(params.id)})\u3002`
    );
  }
  const date = params.date ?? formatToday(options.now ?? /* @__PURE__ */ new Date());
  return withFileLock(gotchasPath, () => {
    const existing = readTextIfExists(gotchasPath);
    if (existing === null) {
      throw new GotchaError("not_found", `${gotchasPath} \u304C\u5B58\u5728\u3057\u307E\u305B\u3093\u3002`);
    }
    const built = buildTaggedText(existing, num, tag, reason, date);
    fs5.writeFileSync(gotchasPath, built.text);
    return {
      id: built.id,
      path: gotchasPath,
      tag: built.tag,
      previousTag: built.previousTag,
      date,
      warnings: built.warnings
    };
  });
}

// src/cli/commit.ts
function runCommitArchitecture(ctx) {
  const command = "commit-architecture";
  const stagingId = stringFlag(ctx.flags, "staging-id");
  if (stagingId === void 0 || stagingId.trim() === "") {
    emitWriteFailure(
      command,
      "missing_staging_id",
      "--staging-id <id> \u304C\u5FC5\u8981\u3067\u3059\u3002stage-architecture \u307E\u305F\u306F stage-adr \u304C\u8FD4\u3057\u305F stagingId \u3092\u6E21\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
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
    if (error instanceof GotchaError) {
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

// src/lib/adr.ts
import fs6 from "node:fs";
var ADR_STATUSES = ["\u63A1\u7528", "\u63D0\u6848", "\u5EC3\u6B62"];
var DEFAULT_ADR_STATUS = "\u63A1\u7528";
var AdrError = class extends Error {
  code;
  details;
  constructor(code, message, details = []) {
    super(message);
    this.name = "AdrError";
    this.code = code;
    this.details = details;
  }
};
var ENTRY_HEADING_RE2 = /^( {0,3}###[ \t]+ADR-(\d+):)(.*)$/;
var STATUS_LINE_RE = /^( {0,3}-[ \t]+状態[ \t]*:[ \t]*)(.*)$/;
var DECIDED_ON_RE = /^ {0,3}-[ \t]+決定日[ \t]*:[ \t]*(.*)$/;
var DECIDED_BY_RE = /^ {0,3}-[ \t]+決定者[ \t]*:[ \t]*(.*)$/;
var STATUS_CHANGE_RE = /^ {0,3}-[ \t]+状態変更\((\d{4}-\d{2}-\d{2})\)[ \t]*:[ \t]*(.*)$/;
var STATUS_CHANGE_VALUE_RE = /^(.*?)[ \t]*→[ \t]*([^。]*)。?(.*)$/;
var DATE_RE2 = /^\d{4}-\d{2}-\d{2}$/;
function formatAdrId(num) {
  return `ADR-${String(num).padStart(3, "0")}`;
}
function parseAdrId(raw) {
  if (typeof raw !== "string") return null;
  const m = /^(?:ADR-)?(\d+)$/i.exec(raw.trim());
  if (m === null) return null;
  const num = Number.parseInt(m[1], 10);
  return Number.isFinite(num) ? num : null;
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
  const scan2 = scanFences(sectionBody);
  const lines = scan2.lines;
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (scan2.insideFence[i]) continue;
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
      if (scan2.insideFence[i]) continue;
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
function findAdrByNumber(doc, num) {
  return doc.entries.find((entry) => entry.number === num) ?? null;
}
function filterAdrEntries(entries, filter = {}) {
  let result = entries;
  if (filter.id !== void 0) {
    const num = parseAdrId(filter.id);
    result = num === null ? [] : result.filter((e) => e.number === num);
  }
  if (filter.status !== void 0 && filter.status !== "") {
    result = result.filter((e) => e.status === filter.status);
  }
  return result;
}
function requireSingleLine2(value, label, errors) {
  if (typeof value !== "string") {
    errors.push(`${label} \u304C\u6587\u5B57\u5217\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002`);
    return "";
  }
  if (value.includes("\n") || value.includes("\r")) {
    errors.push(`${label} \u306B\u6539\u884C\u304C\u542B\u307E\u308C\u3066\u3044\u307E\u3059\u30021 \u884C\u3067\u66F8\u3044\u3066\u304F\u3060\u3055\u3044\u3002`);
    return "";
  }
  if (value.trim() === "") {
    errors.push(`${label} \u304C\u7A7A\u3067\u3059\u3002`);
    return "";
  }
  return value;
}
function requireText(value, label, errors) {
  if (typeof value !== "string") {
    errors.push(`${label} \u304C\u6587\u5B57\u5217\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002`);
    return "";
  }
  if (value.trim() === "") {
    errors.push(`${label} \u304C\u7A7A\u3067\u3059\u3002`);
    return "";
  }
  return value;
}
function validateStatusValue(value, label, errors) {
  if (!isAdrStatus(value)) {
    errors.push(
      `${label} \u306F ${ADR_STATUSES.join(" / ")} \u306E\u307F\u3092\u53D7\u3051\u4ED8\u3051\u307E\u3059(\u53D7\u9818: ${JSON.stringify(value)})\u3002`
    );
  }
}
function validateAdrAddInput(input) {
  const errors = [];
  const warnings = [];
  requireSingleLine2(input?.title, "title", errors);
  requireSingleLine2(input?.decidedBy, "decidedBy", errors);
  requireText(input?.background, "background", errors);
  requireText(input?.conclusion, "conclusion", errors);
  requireText(input?.rationale, "rationale", errors);
  requireText(input?.impact, "impact", errors);
  if (input?.status !== void 0) {
    validateStatusValue(input.status, "status", errors);
  }
  if (input?.decidedOn !== void 0) {
    if (typeof input.decidedOn !== "string" || !DATE_RE2.test(input.decidedOn)) {
      errors.push("decidedOn \u306F YYYY-MM-DD \u306E\u5F62\u5F0F\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    }
  }
  if (!Array.isArray(input?.options) || input.options.length === 0) {
    errors.push(
      "options \u304C 1 \u8981\u7D20\u4EE5\u4E0A\u306E\u914D\u5217\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002\u6BD4\u8F03\u3057\u305F\u9078\u629E\u80A2\u3092\u6319\u3052\u3066\u304F\u3060\u3055\u3044\u3002"
    );
  } else {
    input.options.forEach((option, i) => {
      requireSingleLine2(option, `options[${i}]`, errors);
    });
    if (input.options.length === 1) {
      warnings.push(
        "options \u304C 1 \u4EF6\u3060\u3051\u3067\u3059\u3002\u6BD4\u8F03\u3057\u305F\u4EE3\u66FF\u3092\u6319\u3052\u3089\u308C\u306A\u3044\u3082\u306E\u306F\u5224\u65AD\u3067\u306F\u306A\u304F\u5236\u7D04\u3067\u3042\u308A\u3001`## \u6280\u8853\u30B9\u30BF\u30C3\u30AF` \u3084 `## \u898F\u7D04` \u306B\u5C5E\u3059\u308B\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059(\u5951\u7D04 \xA75-3)\u3002"
      );
    }
  }
  return { errors, warnings };
}
function validateAdrStatusInput(input) {
  const errors = [];
  const warnings = [];
  if (parseAdrId(input?.id) === null) {
    errors.push(
      `id \u306F ADR-NNN \u306E\u5F62\u5F0F\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044(\u53D7\u9818: ${JSON.stringify(input?.id)})\u3002`
    );
  }
  validateStatusValue(input?.status, "status", errors);
  if (input?.reason === void 0 || input?.reason === null) {
    errors.push("reason \u304C\u6307\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u72B6\u614B\u5909\u66F4\u306E\u7406\u7531\u306F\u5FC5\u9808\u3067\u3059\u3002");
  } else {
    const reasonErrors = [];
    requireSingleLine2(input.reason, "reason", reasonErrors);
    if (reasonErrors.length > 0) {
      errors.push(...reasonErrors);
      errors.push("\u72B6\u614B\u5909\u66F4\u306E\u7406\u7531\u306F\u5FC5\u9808\u3067\u3059\u3002");
    }
  }
  if (input?.changedOn !== void 0) {
    if (typeof input.changedOn !== "string" || !DATE_RE2.test(input.changedOn)) {
      errors.push("changedOn \u306F YYYY-MM-DD \u306E\u5F62\u5F0F\u3067\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    }
  }
  return { errors, warnings };
}
function throwOnErrors(result) {
  if (result.errors.length === 0) return;
  const status = result.errors.some((e) => e.startsWith("status \u306F"));
  throw new AdrError(
    status ? "invalid_status" : "invalid_input",
    `\u5165\u529B\u304C\u66F8\u5F0F\u3092\u6E80\u305F\u3057\u3066\u3044\u307E\u305B\u3093: ${result.errors.join(" / ")}`,
    result.errors
  );
}
function renderAdrEntryLines(num, input, date, status) {
  const lines = [
    `### ${formatAdrId(num)}: ${input.title.trim()}`,
    "",
    `- \u72B6\u614B: ${status}`,
    `- \u6C7A\u5B9A\u65E5: ${date}`,
    `- \u6C7A\u5B9A\u8005: ${input.decidedBy.trim()}`,
    "",
    "#### \u80CC\u666F",
    "",
    ...blockLines(input.background),
    "",
    "#### \u691C\u8A0E\u3057\u305F\u9078\u629E\u80A2",
    ""
  ];
  input.options.forEach((option, i) => {
    lines.push(`${i + 1}. ${option.trim()}`);
  });
  lines.push(
    "",
    "#### \u63A1\u7528\u3057\u305F\u7D50\u8AD6",
    "",
    ...blockLines(input.conclusion),
    "",
    "#### \u7406\u7531",
    "",
    ...blockLines(input.rationale),
    "",
    "#### \u5F71\u97FF\u7BC4\u56F2",
    "",
    ...blockLines(input.impact)
  );
  return lines;
}
function blockLines(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t\n]+$/, "").replace(/^\n+/, "").split("\n");
}
function normalizeSectionBody(body) {
  return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t\n]+$/, "").replace(/^\n+/, "");
}
function applyAdrSection(current, body) {
  const result = applySectionChanges(current, [{ heading: ADR_HEADING, body }]);
  if (!result.ok) {
    if (result.error === "unclosed_fence") {
      throw new AdrError(
        "unclosed_fence",
        "\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u304C\u3042\u308B\u305F\u3081\u3001ADR \u306E\u66F4\u65B0\u3092\u884C\u3044\u307E\u305B\u3093\u3002\u30D5\u30A7\u30F3\u30B9\u3092\u9589\u3058\u3066\u304B\u3089\u518D\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
        result.warnings
      );
    }
    throw new AdrError("invalid_input", result.message, result.warnings);
  }
  return {
    text: result.text,
    created: result.created,
    warnings: result.warnings
  };
}
function buildAdrAddition(current, input, date) {
  const validation = validateAdrAddInput(input);
  throwOnErrors(validation);
  const status = isAdrStatus(input.status) ? input.status : DEFAULT_ADR_STATUS;
  const doc = parseAdrDocument(current);
  if (doc.unclosedFence) {
    throw new AdrError(
      "unclosed_fence",
      "\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u304C\u3042\u308B\u305F\u3081\u3001ADR \u306E\u8FFD\u52A0\u3092\u884C\u3044\u307E\u305B\u3093\u3002\u30D5\u30A7\u30F3\u30B9\u3092\u9589\u3058\u3066\u304B\u3089\u518D\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      doc.warnings
    );
  }
  const num = doc.nextNumber;
  const rendered = renderAdrEntryLines(num, input, date, status).join("\n");
  const existing = normalizeSectionBody(doc.sectionBody);
  const body = existing === "" ? rendered : `${existing}

${rendered}`;
  const applied = applyAdrSection(current, body);
  return {
    text: applied.text,
    id: formatAdrId(num),
    number: num,
    created: applied.created,
    sectionCreated: !doc.hasSection,
    status,
    date,
    warnings: [...validation.warnings, ...doc.warnings]
  };
}
function buildAdrStatusChange(current, input, date) {
  const validation = validateAdrStatusInput(input);
  throwOnErrors(validation);
  const to = input.status;
  const num = parseAdrId(input.id) ?? 0;
  const doc = parseAdrDocument(current);
  if (doc.unclosedFence) {
    throw new AdrError(
      "unclosed_fence",
      "\u9589\u3058\u3066\u3044\u306A\u3044\u30B3\u30FC\u30C9\u30D5\u30A7\u30F3\u30B9\u304C\u3042\u308B\u305F\u3081\u3001\u72B6\u614B\u5909\u66F4\u3092\u884C\u3044\u307E\u305B\u3093\u3002\u30D5\u30A7\u30F3\u30B9\u3092\u9589\u3058\u3066\u304B\u3089\u518D\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      doc.warnings
    );
  }
  const entry = findAdrByNumber(doc, num);
  if (entry === null) {
    throw new AdrError(
      "not_found",
      `${formatAdrId(num)} \u304C \`## ${ADR_HEADING}\` \u306B\u3042\u308A\u307E\u305B\u3093\u3002\u30A8\u30F3\u30C8\u30EA\u306F\u524A\u9664\u3055\u308C\u306A\u3044\u305F\u3081\u3001\u756A\u53F7\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    );
  }
  if (entry.statusLineIndex === null || entry.statusRaw === null) {
    throw new AdrError(
      "invalid_entry",
      `${entry.id} \u306B \`- \u72B6\u614B:\` \u884C\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u5951\u7D04 \xA75-1 \u306E\u66F8\u5F0F\u306B\u76F4\u3057\u3066\u304B\u3089\u518D\u5B9F\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
    );
  }
  const warnings = [...validation.warnings, ...doc.warnings];
  const from = entry.statusRaw;
  if (entry.status === null) {
    warnings.push(
      `${entry.id} \u306E\u73FE\u5728\u306E\u72B6\u614B\u300C${from}\u300D\u306F\u5024\u57DF(${ADR_STATUSES.join(" / ")})\u306E\u5916\u3067\u3059\u3002\u5C65\u6B74\u884C\u306B\u306F\u3053\u306E\u5024\u3092\u305D\u306E\u307E\u307E\u66F8\u304D\u307E\u3059\u3002`
    );
  }
  if (from === to) {
    warnings.push(
      `${entry.id} \u306E\u72B6\u614B\u306F\u65E2\u306B\u300C${to}\u300D\u3067\u3059\u3002\u5C65\u6B74\u884C\u3060\u3051\u304C\u8FFD\u8A18\u3055\u308C\u307E\u3059\u3002`
    );
  }
  const scan2 = scanFences(doc.sectionBody);
  const chunks = scan2.lines.map((line) => line.raw);
  const statusLine = scan2.lines[entry.statusLineIndex];
  const m = STATUS_LINE_RE.exec(statusLine.text);
  if (m === null) {
    throw new AdrError(
      "invalid_entry",
      `${entry.id} \u306E \`- \u72B6\u614B:\` \u884C\u3092\u89E3\u6790\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002`
    );
  }
  const lineEnding = statusLine.raw.slice(statusLine.text.length);
  chunks[entry.statusLineIndex] = `${m[1]}${to}${lineEnding}`;
  const previous = scan2.lines[entry.contentEndIndex - 1];
  const continues = previous !== void 0 && STATUS_CHANGE_RE.test(previous.text);
  const history = `- \u72B6\u614B\u5909\u66F4(${date}): ${from} \u2192 ${to}\u3002${input.reason.trim()}`;
  chunks.splice(
    entry.contentEndIndex,
    0,
    continues ? `${history}
` : `
${history}
`
  );
  const applied = applyAdrSection(current, chunks.join(""));
  return {
    text: applied.text,
    id: entry.id,
    number: entry.number,
    from,
    to,
    date,
    warnings: [...warnings, ...applied.warnings]
  };
}
function formatToday2(now) {
  const y = String(now.getFullYear()).padStart(4, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function readTextIfExists2(filePath) {
  try {
    return fs6.readFileSync(filePath, "utf8");
  } catch (error) {
    const code = error?.code;
    if (code === "ENOENT") return null;
    throw error;
  }
}
function withArchitectureLock(architecturePath, fn) {
  try {
    return withFileLock(architecturePath, fn);
  } catch (error) {
    if (error instanceof AdrError) throw error;
    const code = error?.code;
    if (code === "lock_timeout") {
      throw new AdrError("lock_timeout", error.message);
    }
    throw error;
  }
}
function stageAdr(architecturePath, input, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  if (input?.mode === "status") {
    throwOnErrors(validateAdrStatusInput(input));
    const date2 = input.changedOn ?? formatToday2(now);
    return withArchitectureLock(architecturePath, () => {
      const baseText = readTextIfExists2(architecturePath);
      if (baseText === null) {
        throw new AdrError(
          "not_found",
          `${architecturePath} \u304C\u5B58\u5728\u3057\u307E\u305B\u3093\u3002\u72B6\u614B\u3092\u5909\u66F4\u3059\u308B ADR \u304C\u3042\u308A\u307E\u305B\u3093\u3002`
        );
      }
      const built = buildAdrStatusChange(baseText, input, date2);
      return {
        mode: "status",
        path: architecturePath,
        baseExists: true,
        baseText,
        nextText: built.text,
        id: built.id,
        number: built.number,
        assignedId: null,
        previousStatus: built.from,
        status: built.to,
        date: built.date,
        created: false,
        sectionCreated: false,
        warnings: built.warnings
      };
    });
  }
  if (input?.mode !== "add") {
    throw new AdrError(
      "invalid_input",
      `mode \u306F "add" \u307E\u305F\u306F "status" \u306E\u307F\u3092\u53D7\u3051\u4ED8\u3051\u307E\u3059(\u53D7\u9818: ${JSON.stringify(
        input?.mode
      )})\u3002`
    );
  }
  throwOnErrors(validateAdrAddInput(input));
  const date = input.decidedOn ?? formatToday2(now);
  return withArchitectureLock(architecturePath, () => {
    const baseText = readTextIfExists2(architecturePath);
    const built = buildAdrAddition(baseText, input, date);
    return {
      mode: "add",
      path: architecturePath,
      baseExists: baseText !== null,
      baseText: baseText ?? "",
      nextText: built.text,
      id: built.id,
      number: built.number,
      assignedId: built.id,
      previousStatus: null,
      status: built.status,
      date: built.date,
      created: built.created,
      sectionCreated: built.sectionCreated,
      warnings: built.warnings
    };
  });
}

// src/cli/paths.ts
import path5 from "node:path";
import { fileURLToPath } from "node:url";
function metatronCliPath() {
  const here = fileURLToPath(import.meta.url);
  if (path5.basename(here) === "metatron.mjs") return here;
  const pluginRoot = path5.resolve(path5.dirname(here), "..", "..");
  return path5.join(pluginRoot, "scripts", "metatron.mjs");
}
function commandLine(args) {
  return `node ${metatronCliPath()} ${args}`;
}
var INPUT_SCHEMAS = {
  "stage-architecture": {
    input: "{ sections: [{ heading, body }], reason? }",
    headings: [...ARCHITECTURE_HEADINGS],
    note: "`ADR \u4E00\u89A7` \u306F\u6307\u5B9A\u3067\u304D\u307E\u305B\u3093\u3002ADR \u306E\u8FFD\u52A0\u30FB\u72B6\u614B\u5909\u66F4\u306F stage-adr \u3092\u4F7F\u3063\u3066\u304F\u3060\u3055\u3044\u3002"
  },
  "stage-adr": {
    add: '{ mode: "add", title, status?, decidedOn?, decidedBy, background, options: [...], conclusion, rationale, impact }',
    status: '{ mode: "status", id: "ADR-003", status: "\u63A1\u7528" | "\u63D0\u6848" | "\u5EC3\u6B62", reason, changedOn? }',
    note: "\u63A1\u756A\u306F CLI \u304C\u884C\u3046\u3002\u66F8\u304D\u8FBC\u307F\u306F commit-architecture --staging-id <id>\u3002"
  },
  "append-gotcha": {
    input: '{ title, date?, task, mistake, cause, countermeasure, promotionCandidate: "Yes" | "No" }',
    note: "\u63A1\u756A\u306F CLI \u304C\u884C\u3046\u3002`## \u5931\u6557\u30D1\u30BF\u30FC\u30F3\u4E00\u89A7` \u306E\u76F4\u4E0B(\u5148\u982D)\u306B\u633F\u5165\u3059\u308B\u3002"
  },
  "tag-gotcha": {
    usage: "tag-gotcha --id GOTCHA-003 --tag \u89E3\u6C7A\u6E08\u307F|\u5BFE\u8C61\u5916 --reason <\u7406\u7531>",
    note: "\u898B\u51FA\u3057\u3078\u306E\u30BF\u30B0\u633F\u5165\u3068\u672B\u5C3E\u306E\u7406\u7531\u884C\u306E\u8FFD\u8A18\u3060\u3051\u3092\u884C\u3046\u3002\u672C\u6587\u306F\u66F8\u304D\u63DB\u3048\u306A\u3044\u3002"
  }
};
var USAGE_LINES = [
  "usage: node <plugin-root>/scripts/metatron.mjs <subcommand> [options]",
  "",
  "\u8AAD\u307F\u53D6\u308A(\u5E38\u306B exit 0):",
  "  get config",
  "  get architecture [--section <\u898B\u51FA\u3057>]",
  "  get domains",
  "  get gotchas [--recent N | --id <ID> | --query <\u8A9E>] [--exclude-tagged] [--promotion-candidates]",
  "  get adr [--id <ID> | --status <\u72B6\u614B>]",
  "  scan",
  "  diff-architecture",
  "",
  "\u6BB5\u968E(\u62D2\u5426\u306F\u975E 0):",
  "  stage-architecture --input <path>",
  "  stage-adr --input <path>",
  "",
  "\u66F8\u304D\u8FBC\u307F(\u62D2\u5426\u30FB\u5931\u6557\u306F\u975E 0):",
  "  commit-architecture --staging-id <id>",
  "  append-gotcha --input <path>",
  "  tag-gotcha --id <ID> --tag <\u89E3\u6C7A\u6E08\u307F|\u5BFE\u8C61\u5916> --reason <\u7406\u7531>"
];

// src/cli/get.ts
function configOf(cwd) {
  return loadConfig(cwd);
}
function runGetConfig(ctx) {
  const command = "get config";
  const config = configOf(ctx.cwd);
  const architecture = readDocument(config.architecturePath);
  const gotchas = readDocument(config.gotchasPath);
  const warnings = [
    ...config.warnings,
    ...architecture.warnings,
    ...gotchas.warnings
  ];
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
    gotchas: {
      path: config.gotchasPath,
      relative: config.gotchasRelative,
      exists: gotchas.exists
    },
    injection: config.injection,
    cli: {
      path: metatronCliPath(),
      stageArchitecture: commandLine("stage-architecture --input <path>"),
      stageAdr: commandLine("stage-adr --input <path>"),
      commitArchitecture: commandLine("commit-architecture --staging-id <id>"),
      appendGotcha: commandLine("append-gotcha --input <path>"),
      tagGotcha: commandLine(
        "tag-gotcha --id <GOTCHA-NNN> --tag <\u89E3\u6C7A\u6E08\u307F|\u5BFE\u8C61\u5916> --reason <\u7406\u7531>"
      )
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
  emitResult(command, {
    ok: true,
    path: config.architecturePath,
    exists: true,
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
function serializeGotcha(entry) {
  return {
    id: entry.id,
    number: entry.number,
    date: entry.date,
    tag: entry.tag,
    title: entry.title,
    task: entry.task,
    mistake: entry.mistake,
    cause: entry.cause,
    countermeasure: entry.countermeasure,
    promotionCandidate: entry.promotionCandidate,
    raw: entry.raw
  };
}
function runGetGotchas(ctx) {
  const command = "get gotchas";
  const config = configOf(ctx.cwd);
  const file = readDocument(config.gotchasPath);
  const doc = parseGotchas(file.text);
  const warnings = [...config.warnings, ...file.warnings, ...doc.warnings];
  noteWarnings(warnings);
  const recent = intFlag(ctx.flags, "recent");
  if (!recent.ok) {
    emitReadFailure(command, "invalid_option", recent.message, {
      path: config.gotchasPath,
      exists: file.exists,
      entries: [],
      warnings
    });
    return;
  }
  const filter = {
    id: stringFlag(ctx.flags, "id"),
    query: stringFlag(ctx.flags, "query"),
    recent: recent.value,
    excludeTagged: boolFlag(ctx.flags, "exclude-tagged"),
    promotionCandidates: boolFlag(ctx.flags, "promotion-candidates")
  };
  if (!file.exists) {
    emitReadFailure(
      command,
      "not_created",
      `${config.gotchasPath} \u306F\u672A\u4F5C\u6210\u3067\u3059\u3002append-gotcha \u304C\u53F0\u5E33\u3054\u3068\u4F5C\u6210\u3057\u307E\u3059\u3002`,
      {
        path: config.gotchasPath,
        exists: false,
        total: 0,
        count: 0,
        filter,
        entries: [],
        warnings
      }
    );
    return;
  }
  const entries = filterGotchas(doc.entries, filter);
  emitResult(command, {
    ok: true,
    path: config.gotchasPath,
    exists: true,
    total: doc.entries.length,
    count: entries.length,
    promotionCandidateCount: doc.entries.filter(
      (e) => e.promotionCandidate === "Yes"
    ).length,
    filter,
    entries: entries.map(serializeGotcha),
    warnings
  });
}
function serializeAdr(entry) {
  return {
    id: entry.id,
    number: entry.number,
    title: entry.title,
    status: entry.status,
    statusRaw: entry.statusRaw,
    decidedOn: entry.decidedOn,
    decidedBy: entry.decidedBy,
    statusChanges: entry.statusChanges.map((change) => ({
      date: change.date,
      from: change.from,
      to: change.to,
      reason: change.reason
    })),
    raw: entry.raw
  };
}
function runGetAdr(ctx) {
  const command = "get adr";
  const config = configOf(ctx.cwd);
  const file = readDocument(config.architecturePath);
  const doc = parseAdrDocument(file.text);
  const warnings = [...config.warnings, ...file.warnings, ...doc.warnings];
  noteWarnings(warnings);
  const filter = {
    id: stringFlag(ctx.flags, "id"),
    status: stringFlag(ctx.flags, "status")
  };
  if (!file.exists) {
    emitReadFailure(
      command,
      "not_created",
      `${config.architecturePath} \u306F\u672A\u4F5C\u6210\u3067\u3059\u3002stage-adr \u304C\u7BC0\u3054\u3068\u4F5C\u6210\u3057\u307E\u3059\u3002`,
      {
        path: config.architecturePath,
        exists: false,
        hasSection: false,
        total: 0,
        count: 0,
        filter,
        entries: [],
        warnings
      }
    );
    return;
  }
  const entries = filterAdrEntries(doc.entries, filter);
  emitResult(command, {
    ok: true,
    path: config.architecturePath,
    exists: true,
    hasSection: doc.hasSection,
    total: doc.entries.length,
    count: entries.length,
    nextNumber: doc.nextNumber,
    filter,
    entries: entries.map(serializeAdr),
    warnings
  });
}
var GET_TARGETS = ["config", "architecture", "domains", "gotchas", "adr"];
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
      case "gotchas":
        runGetGotchas(ctx);
        return;
      case "adr":
        runGetAdr(ctx);
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

// src/cli/gotcha.ts
function failFromError(command, error, extra) {
  if (error instanceof GotchaError) {
    emitWriteFailure(command, error.code, error.message, {
      ...extra,
      details: error.details
    });
    return;
  }
  emitWriteFailure(command, "internal_error", messageOf(error), extra);
}
function runAppendGotcha(ctx) {
  const command = "append-gotcha";
  const input = loadInputJson(ctx.flags);
  if (!input.ok) {
    emitWriteFailure(
      command,
      input.error,
      input.message,
      { written: false },
      EXIT_USAGE
    );
    return;
  }
  if (!isPlainObject4(input.value)) {
    emitWriteFailure(
      command,
      "invalid_input",
      `${input.source} \u306E\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u306F { title, task, mistake, cause, countermeasure, promotionCandidate } \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\u3002`,
      { written: false },
      EXIT_USAGE
    );
    return;
  }
  const config = loadConfig(ctx.cwd);
  try {
    const result = appendGotcha(
      config.gotchasPath,
      input.value
    );
    const warnings = [...config.warnings, ...result.warnings];
    noteWarnings(warnings);
    emitResult(command, {
      ok: true,
      written: true,
      id: result.id,
      number: result.number,
      path: result.path,
      date: result.date,
      created: result.created,
      sectionCreated: result.sectionCreated,
      warnings
    });
  } catch (error) {
    failFromError(command, error, {
      written: false,
      path: config.gotchasPath
    });
  }
}
function runTagGotcha(ctx) {
  const command = "tag-gotcha";
  const id = stringFlag(ctx.flags, "id");
  const tag = stringFlag(ctx.flags, "tag");
  const reason = stringFlag(ctx.flags, "reason");
  const date = stringFlag(ctx.flags, "date");
  const missing = [];
  if (id === void 0) missing.push("--id <GOTCHA-NNN>");
  if (tag === void 0) missing.push(`--tag <${GOTCHA_TAGS.join("|")}>`);
  if (reason === void 0) missing.push("--reason <\u7406\u7531>");
  if (missing.length > 0) {
    emitWriteFailure(
      command,
      "missing_option",
      `${missing.join(" / ")} \u304C\u5FC5\u8981\u3067\u3059\u3002`,
      { written: false },
      EXIT_USAGE
    );
    return;
  }
  const config = loadConfig(ctx.cwd);
  try {
    const result = tagGotcha(config.gotchasPath, {
      id,
      tag,
      reason,
      date
    });
    const warnings = [...config.warnings, ...result.warnings];
    noteWarnings(warnings);
    emitResult(command, {
      ok: true,
      written: true,
      id: result.id,
      path: result.path,
      tag: result.tag,
      previousTag: result.previousTag,
      date: result.date,
      warnings
    });
  } catch (error) {
    failFromError(command, error, {
      written: false,
      path: config.gotchasPath
    });
  }
}

// src/cli/diff.ts
var MAX_DIFF_LINES = 1500;
var DEFAULT_CONTEXT = 3;
function splitLines2(text) {
  if (text === "") return [];
  const unified = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = unified.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
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
  const a = splitLines2(beforeText);
  const b = splitLines2(afterText);
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
      `${input.source} \u306E\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u306F { sections: [{ heading, body }] } \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\u3002`,
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
  emitResult(command, {
    ok: true,
    valid: true,
    stagingId: staged.stagingId,
    path: config.architecturePath,
    baseExists: file.exists,
    created: update.created,
    applied: update.applied,
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
function runStageAdr(ctx) {
  const command = "stage-adr";
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
      `${input.source} \u306E\u30C8\u30C3\u30D7\u30EC\u30D9\u30EB\u306F { mode: "add" | "status", ... } \u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\u3002`,
      { valid: false },
      EXIT_USAGE
    );
    return;
  }
  const config = loadConfig(ctx.cwd);
  let result;
  try {
    result = stageAdr(
      config.architecturePath,
      input.value
    );
  } catch (error) {
    if (error instanceof AdrError) {
      emitWriteFailure(command, error.code, error.message, {
        valid: false,
        stagingId: null,
        path: config.architecturePath,
        details: error.details,
        warnings: config.warnings
      });
      return;
    }
    emitWriteFailure(command, "internal_error", messageOf(error), {
      valid: false,
      stagingId: null,
      path: config.architecturePath
    });
    return;
  }
  const warnings = [...config.warnings, ...result.warnings];
  noteWarnings(warnings);
  const staged = createStaging({
    projectRoot: config.docRoot,
    kind: "adr",
    targetPath: config.architecturePath,
    nextContent: result.nextText,
    // stageAdr が採番のために読んだ本文をそのまま照合対象にする。
    baseHash: result.baseExists ? hashContent(result.baseText) : null,
    meta: {
      mode: result.mode,
      id: result.id,
      assignedId: result.assignedId,
      status: result.status,
      date: result.date
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
  const diff = unifiedDiff(result.baseText, result.nextText, {
    fromLabel: `${config.architectureRelative} (\u73FE\u884C)`,
    toLabel: `${config.architectureRelative} (stage)`
  });
  emitResult(command, {
    ok: true,
    valid: true,
    stagingId: staged.stagingId,
    mode: result.mode,
    path: config.architecturePath,
    baseExists: result.baseExists,
    id: result.id,
    number: result.number,
    assignedId: result.assignedId,
    previousStatus: result.previousStatus,
    status: result.status,
    date: result.date,
    created: result.created,
    sectionCreated: result.sectionCreated,
    diff: diffPayload(
      diff,
      sectionDiffs(result.baseText, result.nextText, [
        {
          heading: ADR_HEADING,
          mode: result.sectionCreated ? "added" : "replaced"
        }
      ])
    ),
    expiresAt: new Date(staged.expiresAt).toISOString(),
    warnings,
    next: commandLine(`commit-architecture --staging-id ${staged.stagingId}`),
    reminder: withTruncationNote(
      diff,
      "ADR \u306E\u8FFD\u52A0\u30FB\u72B6\u614B\u5909\u66F4\u306F\u8A2D\u8A08\u5224\u65AD\u306E\u5BA3\u8A00\u3067\u3042\u308B\u3002diff \u3092\u5168\u6587\u63D0\u793A\u3057\u3066\u627F\u8A8D\u3092\u5F97\u308B\u307E\u3067 commit-architecture \u3092\u5B9F\u884C\u3057\u306A\u3044\u3053\u3068\u3002"
    )
  });
}

// src/cli/main.ts
var READ_SUBCOMMANDS = /* @__PURE__ */ new Set(["get", "scan", "diff-architecture"]);
var WRITE_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "stage-architecture",
  "stage-adr",
  "commit-architecture",
  "append-gotcha",
  "tag-gotcha"
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
      case "stage-architecture":
        runStageArchitecture(ctx);
        return;
      case "stage-adr":
        runStageAdr(ctx);
        return;
      case "commit-architecture":
        runCommitArchitecture(ctx);
        return;
      case "append-gotcha":
        runAppendGotcha(ctx);
        return;
      case "tag-gotcha":
        runTagGotcha(ctx);
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
