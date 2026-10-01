#!/usr/bin/env node

// src/check.ts
import { createHash, randomUUID } from "node:crypto";
import fs2 from "node:fs";
import os from "node:os";
import path3 from "node:path";

// src/lib/extract.ts
import path from "node:path";
var LANG_OF_EXT = {};
for (const [lang, exts] of [
  ["markdown", ".md .mdx .markdown .txt"],
  ["html", ".html .htm"],
  [
    "slash",
    ".ts .tsx .js .mjs .cjs .jsx .java .kt .go .rs .c .h .cpp .cs .swift .dart .scala"
  ],
  ["hash", ".sh .bash .zsh .rb .yaml .yml .toml .r .pl"],
  ["python", ".py"],
  ["dash", ".sql .lua .hs"]
]) {
  for (const ext of exts.split(" ")) LANG_OF_EXT[ext] = lang;
}
var KANA = /[ぁ-ゟ゠-ヿ]/;
var PLACEHOLDER = "\u7532";
var INLINE_CODE = /(`+)[^`]+\1/g;
var URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]+/g;
var MARKER = "native-japanese: ignore-file";
var MD_MARKER = `<!-- ${MARKER} -->`;
var CODE_MARKER = {
  slash: new RegExp(`^(?://\\s*${MARKER}|/\\*\\s*${MARKER}\\s*\\*/)$`),
  hash: new RegExp(`^#\\s*${MARKER}$`),
  python: new RegExp(`^#\\s*${MARKER}$`),
  dash: new RegExp(`^--\\s*${MARKER}$`),
  cell: new RegExp(`^(?://|#)\\s*${MARKER}$`)
};
function isHtml(p) {
  return langOf({ path: p, text: "" }) === "html";
}
function langOf(src) {
  if (src.cellType) return src.cellType === "markdown" ? "markdown" : "cell";
  return LANG_OF_EXT[path.extname(src.path).toLowerCase()] ?? null;
}
function splitLines(text) {
  return text.split("\n").map((l) => l.replace(/\r$/, ""));
}
function fenceMask(lines) {
  let fence = null;
  return lines.map((l) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(l);
    if (fence === null) {
      if (m) fence = m[1];
      return m !== null;
    }
    const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    if (close.test(l)) fence = null;
    return true;
  });
}
function commentsOf(lines, lang) {
  let inBlock = false;
  let triple = null;
  return lines.map((line) => {
    if (lang === "slash") {
      if (!inBlock && /^\s*\*/.test(line)) {
        const e = line.indexOf("*/");
        return e < 0 ? line : line.slice(0, e);
      }
      const parts = [];
      let rest = line;
      let found = false;
      for (; ; ) {
        if (inBlock) {
          found = true;
          const e = rest.indexOf("*/");
          if (e < 0) {
            parts.push(rest);
            break;
          }
          parts.push(rest.slice(0, e));
          rest = rest.slice(e + 2);
          inBlock = false;
          continue;
        }
        const s = rest.indexOf("/*");
        const d = rest.indexOf("//");
        if (d >= 0 && (s < 0 || d < s)) {
          parts.push(rest.slice(d + 2));
          return parts.join(" ");
        }
        if (s < 0) break;
        inBlock = true;
        rest = rest.slice(s + 2);
      }
      return found ? parts.join(" ") : null;
    }
    if (lang === "python") {
      if (triple !== null) {
        const e2 = line.indexOf(triple);
        if (e2 < 0) return line;
        triple = null;
        return line.slice(0, e2);
      }
      const m2 = /#|"""|'''/.exec(line);
      if (!m2) return null;
      const rest = line.slice(m2.index + m2[0].length);
      if (m2[0] === "#") return rest;
      const e = rest.indexOf(m2[0]);
      if (e >= 0) return rest.slice(0, e);
      triple = m2[0];
      return rest;
    }
    const m = { hash: /#/, dash: /--/, cell: /\/\/|#/ }[lang].exec(line);
    return m ? line.slice(m.index + m[0].length) : null;
  });
}
function cleanComment(c) {
  return c.replace(/^[\s*/!#-]+/, "").trimEnd();
}
function toNoun(s) {
  return s.replace(INLINE_CODE, PLACEHOLDER).replace(URL_RE, PLACEHOLDER);
}
function extractLines(src) {
  const lang = langOf(src);
  if (lang === null || lang === "html") return [];
  const lines = splitLines(src.text);
  const out = [];
  if (lang === "markdown") {
    const fenced = fenceMask(lines);
    lines.forEach((l, i) => {
      if (fenced[i] || MD_QUOTE.test(l)) return;
      const text = l.replace(INLINE_CODE, (m) => " ".repeat(m.length));
      if (KANA.test(text)) out.push({ line: i + 1, text });
    });
    return out;
  }
  commentsOf(lines, lang).forEach((c, i) => {
    if (c === null) return;
    const text = cleanComment(c).replace(
      INLINE_CODE,
      (m) => " ".repeat(m.length)
    );
    if (KANA.test(text)) out.push({ line: i + 1, text });
  });
  return out;
}
function extractBlocks(src) {
  const lang = langOf(src);
  if (lang === null) return [];
  const lines = splitLines(src.text);
  const blocks = lang === "html" ? htmlBlocks(src.text) : lang === "markdown" ? markdownBlocks(lines) : commentBlocks(lines, lang);
  return blocks.filter((b) => KANA.test(b.text));
}
var Buf = class {
  constructor(kind) {
    this.kind = kind;
  }
  kind;
  text = "";
  lineOf = [];
  push(s, line) {
    this.text += s;
    for (let i = 0; i < s.length; i++) this.lineOf.push(line);
  }
};
function finish(buf) {
  const { text, lineOf } = buf;
  let out = "";
  const lo = [];
  const run = /[ \t\r]*\n[ \t\r\n]*/g;
  let at = 0;
  const copy = (end2) => {
    out += text.slice(at, end2);
    lo.push(...lineOf.slice(at, end2));
  };
  for (const m of text.matchAll(run)) {
    copy(m.index);
    at = m.index + m[0].length;
    const prev = out.at(-1);
    const next = text[at];
    if (prev === void 0 || next === void 0) continue;
    if (prev.charCodeAt(0) > 127 && next.charCodeAt(0) > 127) continue;
    out += " ";
    lo.push(lo.at(-1));
  }
  copy(text.length);
  const start = out.length - out.trimStart().length;
  const end = out.trimEnd().length;
  return {
    kind: buf.kind,
    text: out.slice(start, end),
    lineOf: lo.slice(start, end)
  };
}
var MD_HEADING = /^\s{0,3}#{1,6}(?:\s+|$)/;
var MD_TABLE = /^\s*\|/;
var MD_LIST = /^\s*(?:[-*+]|\d+[.)])\s+/;
var MD_QUOTE = /^\s*>/;
function markdownBlocks(lines) {
  const fenced = fenceMask(lines);
  const blocks = [];
  let cur = null;
  for (const [i, l] of lines.entries()) {
    const line = i + 1;
    const heading = MD_HEADING.exec(l);
    const list = MD_LIST.exec(l);
    const body = toNoun(l);
    const skipped = fenced[i] || l.trim() === "" || MD_QUOTE.test(l);
    if (cur && (skipped || heading || list || MD_TABLE.test(l))) {
      blocks.push(finish(cur));
      cur = null;
    }
    if (skipped) continue;
    if (heading || MD_TABLE.test(l)) {
      const b = new Buf(heading ? "heading" : "table");
      b.push(toNoun(heading ? l.slice(heading[0].length) : l), line);
      blocks.push(finish(b));
    } else if (list) {
      cur = new Buf("list");
      cur.push(toNoun(l.slice(list[0].length)), line);
    } else if (cur) {
      cur.push("\n", line);
      cur.push(body, line);
    } else {
      cur = new Buf("prose");
      cur.push(body, line);
    }
  }
  if (cur) blocks.push(finish(cur));
  return blocks;
}
function commentBlocks(lines, lang) {
  const blocks = [];
  let cur = null;
  commentsOf(lines, lang).forEach((c, i) => {
    const text = c === null ? "" : cleanComment(c);
    if (text === "") {
      if (cur) blocks.push(finish(cur));
      cur = null;
      return;
    }
    if (cur) cur.push("\n", i + 1);
    else cur = new Buf("comment");
    cur.push(toNoun(text), i + 1);
  });
  if (cur) blocks.push(finish(cur));
  return blocks;
}
var HTML_BLOCK_KIND = {
  li: "list",
  dt: "list",
  dd: "list",
  td: "table",
  th: "table"
};
for (const t of "p div section article header footer blockquote figcaption".split(
  " "
))
  HTML_BLOCK_KIND[t] = "prose";
for (let n = 1; n <= 6; n++) HTML_BLOCK_KIND[`h${n}`] = "heading";
var HTML_ENTITY = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  nbsp: "\xA0"
};
var HTML_TOKEN = /<!--[\s\S]*?-->|<(script|style|pre|code|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?([a-zA-Z][\w-]*)[^>]*>|<![^>]*>|&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|nbsp));/gi;
function htmlBlocks(text) {
  const blocks = [];
  const stack = [];
  const kindNow = () => stack.at(-1)?.kind ?? "prose";
  let buf = new Buf("prose");
  let line = 1;
  let at = 0;
  const flush = () => {
    if (buf.text !== "") blocks.push(finish(buf));
    buf = new Buf(kindNow());
  };
  const emit = (s) => {
    for (const ch of s) {
      buf.push(ch, line);
      if (ch === "\n") line++;
    }
  };
  const skip = (s) => {
    for (const ch of s) if (ch === "\n") line++;
  };
  for (const m of text.matchAll(HTML_TOKEN)) {
    emit(text.slice(at, m.index));
    at = m.index + m[0].length;
    const [whole, dropped, tag, hex, dec, named] = m;
    if (dropped !== void 0) {
      if (dropped.toLowerCase() === "code") buf.push(PLACEHOLDER, line);
      skip(whole);
    } else if (tag !== void 0) {
      const name = tag.toLowerCase();
      const kind = HTML_BLOCK_KIND[name];
      if (name === "br") flush();
      else if (kind !== void 0) {
        flush();
        if (!whole.startsWith("</")) {
          if (!whole.endsWith("/>")) stack.push({ name, kind });
        } else {
          const i = stack.findLastIndex((e) => e.name === name);
          if (i >= 0) stack.length = i;
        }
        buf.kind = kindNow();
      }
      skip(whole);
    } else if (hex !== void 0 || dec !== void 0) {
      const cp = hex !== void 0 ? Number.parseInt(hex, 16) : Number(dec);
      emit(cp <= 1114111 ? String.fromCodePoint(cp) : whole);
    } else if (named !== void 0) {
      emit(HTML_ENTITY[named.toLowerCase()]);
    } else skip(whole);
  }
  emit(text.slice(at));
  flush();
  return blocks;
}
function hasIgnoreMarker(src) {
  const lang = langOf(src);
  if (lang === null) return false;
  const lines = splitLines(src.text);
  if (lang === "markdown" || lang === "html") {
    const fenced = lang === "markdown" ? fenceMask(lines) : [];
    return lines.some((l, i) => !fenced[i] && l.trim() === MD_MARKER);
  }
  const re = CODE_MARKER[lang];
  return lines.some((l) => re.test(l.trim()));
}

// src/lib/morph.ts
var MUSE_PREDICATES = /* @__PURE__ */ new Set([
  "\u793A\u3059",
  "\u610F\u5473\u3059\u308B",
  "\u7269\u8A9E\u308B",
  "\u88CF\u4ED8\u3051\u308B",
  "\u793A\u5506\u3059\u308B"
]);
var PRONOUNS = /* @__PURE__ */ new Set(["\u79C1", "\u50D5", "\u6211\u3005", "\u5F7C", "\u5F7C\u5973", "\u3042\u306A\u305F"]);
var RUN_LENGTH = 4;
var MIN_ENDING_LENGTH = 2;
var POLITE_ENDINGS = /* @__PURE__ */ new Set(["\u307E\u3059", "\u3067\u3059", "\u307E\u3057\u305F", "\u3067\u3057\u305F"]);
var LONG_SENTENCE = 100;
var MIN_CLAUSE_CUTS = 2;
var MIN_SEGMENT_LENGTH = 30;
var MIN_MODIFIER_CLAUSES = 2;
var NOT_MODIFIED = new Set(
  "\u3053\u3068 \u3082\u306E \u306E \u3068\u304D \u6642 \u969B \u305F\u3073 \u5EA6 \u305F\u3081 \u3088\u3046 \u3068\u3053\u308D \u5834\u5408 \u5F8C \u524D \u9593 \u3046\u3061 \u307E\u307E".split(
    " "
  )
);
var ASCII_SYMBOL = /^[!-/:-@[-`{-~]+$/;
var SEGMENT_CUT = /^[()（）[\]「」『』【】:：]+$/;
var MATCH_LENGTH = 20;
var TERMINATORS = /* @__PURE__ */ new Set(["\u3002", "\uFF01", "\uFF1F"]);
var RULES = {
  "muse-shugo": {
    category: "\u7FFB\u8A33\u8ABF",
    advice: "\u300C\u301C\u304B\u3089\u3001\u301C\u3068\u5206\u304B\u308B\u300D\u306E\u3088\u3046\u306B\u3001\u8AAD\u307F\u624B\u304C\u8AAD\u307F\u53D6\u308B\u5F62\u306B\u8A00\u3044\u63DB\u3048\u308B\u3002\u5143\u306E\u6587\u306E\u78BA\u4FE1\u5EA6\u306F\u5909\u3048\u306A\u3044"
  },
  "bunmatsu-renzoku": {
    category: "\u6587",
    advice: "4 \u6587\u76EE\u306E\u6587\u672B\u306E\u5F62\u3092\u5909\u3048\u308B\u304B\u3001\u96A3\u306E\u6587\u3068\u3064\u306A\u3050"
  },
  "bun-nagasa": {
    category: "\u6587",
    advice: "\u8FF0\u8A9E\u3092\u542B\u3080\u4FEE\u98FE\u8A9E\u306E\u5207\u308C\u76EE\u3067\u6587\u3092\u5206\u3051\u308B\u3002\u5206\u3051\u305F\u5F8C\u3082\u4E3B\u8A9E\u3068\u5FC5\u8981\u306A\u4E8B\u5B9F\u3092\u6B8B\u3059"
  },
  "rentai-kasanari": {
    category: "\u6587",
    advice: "\u8FF0\u8A9E\u3092\u542B\u3080\u4FEE\u98FE\u8A9E\u3092 1 \u3064\u6B8B\u3057\u3001\u6B8B\u308A\u306F\u524D\u306E\u6587\u306B\u51FA\u3059\u3002\u6642\u7CFB\u5217\u304B\u56E0\u679C\u306E\u9806\u306B\u4E26\u3079\u308B"
  }
};
function toToken(raw) {
  const d = raw.details;
  return {
    surface: raw.surface,
    pos: d[0] ?? "",
    pos1: d[1] ?? "",
    pos2: d[2] ?? "",
    conjType: d[4] ?? "",
    conjForm: d[5] ?? "",
    base: d[6] ?? ""
  };
}
function splitSentences(text) {
  const out = [];
  let start = 0;
  const push = (end) => {
    const s = text.slice(start, end);
    const lead = s.length - s.trimStart().length;
    if (s.trim() !== "") out.push({ start: start + lead, end });
    start = end;
  };
  for (let i = 0; i < text.length; i++)
    if (TERMINATORS.has(text[i])) push(i + 1);
  push(text.length);
  return out;
}
function sentencesOf(text, analyzer) {
  const sentences = splitSentences(text).map((r) => ({
    ...r,
    tokens: []
  }));
  let at = 0;
  let k = 0;
  for (const raw of analyzer.tokenize(text)) {
    const i = text.indexOf(raw.surface, at);
    const pos = i < 0 ? at : i;
    at = pos + raw.surface.length;
    while (k < sentences.length - 1 && pos >= sentences[k].end)
      k++;
    sentences[k]?.tokens.push(toToken(raw));
  }
  return sentences;
}
var isVerbLike = (t) => t.pos === "\u52D5\u8A5E" || t.pos === "\u5F62\u5BB9\u8A5E" || t.pos === "\u52A9\u52D5\u8A5E";
function isEndingPart(t) {
  if (t.pos === "\u52A9\u52D5\u8A5E" || t.pos === "\u52A9\u8A5E") return true;
  if (t.pos === "\u52D5\u8A5E") return t.pos1 === "\u975E\u81EA\u7ACB" || t.pos1 === "\u63A5\u5C3E";
  return t.pos === "\u540D\u8A5E" && t.pos1 === "\u975E\u81EA\u7ACB";
}
function endingStart(ts) {
  let last = ts.length;
  while (last > 0 && ts[last - 1].pos === "\u8A18\u53F7") last--;
  let stop = last;
  while (stop > 0 && isEndingPart(ts[stop - 1])) stop--;
  return { stop, last };
}
function endingOf(ts) {
  const { stop, last } = endingStart(ts);
  return ts.slice(stop, last).map((t) => t.surface).join("");
}
var len = (s) => [...s.replace(/\s/g, "")].length;
function museShugo(ts) {
  const core = endingStart(ts).stop - 1;
  const verb = ts[core];
  if (verb?.pos !== "\u52D5\u8A5E" || verb.pos1 !== "\u81EA\u7ACB") return false;
  const noun = ts[core - 1];
  const sahen = verb.base === "\u3059\u308B" && noun?.pos1 === "\u30B5\u5909\u63A5\u7D9A";
  const base = sahen ? `${noun.surface}\u3059\u308B` : verb.base;
  const head = sahen ? core - 1 : core;
  if (!MUSE_PREDICATES.has(base)) return false;
  const wo = ts[head - 1];
  const koto = ts[head - 2];
  if (wo?.surface !== "\u3092" || wo.pos1 !== "\u683C\u52A9\u8A5E") return false;
  if (!koto || koto.surface !== "\u3053\u3068" && koto.surface !== "\u306E" || koto.pos !== "\u540D\u8A5E" || koto.pos1 !== "\u975E\u81EA\u7ACB")
    return false;
  const topicAt = (j) => {
    const t = ts[j];
    return (t.surface === "\u306F" || t.surface === "\u304C") && t.pos === "\u52A9\u8A5E" && (t.pos1 === "\u4FC2\u52A9\u8A5E" || t.pos1 === "\u683C\u52A9\u8A5E") && ts[j - 1]?.pos === "\u540D\u8A5E";
  };
  let hasSubject = false;
  let nearestWa = -1;
  for (let j = 1; j < head - 2; j++) {
    if (!topicAt(j)) continue;
    hasSubject = true;
    if (ts[j].surface === "\u306F") nearestWa = j;
  }
  if (!hasSubject) return false;
  if (nearestWa < 0) return true;
  const subj = ts[nearestWa - 1];
  const person = subj.pos1 === "\u4EE3\u540D\u8A5E" || PRONOUNS.has(subj.surface) || subj.pos1 === "\u56FA\u6709\u540D\u8A5E" && subj.pos2 === "\u4EBA\u540D";
  return !person;
}
function clauseCuts(ts) {
  let n = 0;
  for (let k = 1; k < ts.length; k++) {
    const t = ts[k];
    if (t.pos !== "\u8A18\u53F7" || t.pos1 !== "\u8AAD\u70B9") continue;
    const p = ts[k - 1];
    if (p.pos === "\u52A9\u8A5E" && p.pos1 === "\u63A5\u7D9A\u52A9\u8A5E" || isVerbLike(p) && (p.conjForm === "\u9023\u7528\u5F62" || p.conjForm === "\u9023\u7528\u30C6\u63A5\u7D9A"))
      n++;
  }
  return n;
}
function modifierClauses(seg) {
  let n = 0;
  for (let m = 0; m < seg.length; m++) {
    const t = seg[m];
    if (!isVerbLike(t) || t.pos === "\u5F62\u5BB9\u8A5E") continue;
    if (t.conjForm !== "\u57FA\u672C\u5F62" && t.conjForm !== "\u4F53\u8A00\u63A5\u7D9A") continue;
    const prev = seg[m - 1];
    if (t.pos === "\u52A9\u52D5\u8A5E" && prev && (prev.pos1 === "\u5F62\u5BB9\u52D5\u8A5E\u8A9E\u5E79" || prev.pos2 === "\u5F62\u5BB9\u52D5\u8A5E\u8A9E\u5E79"))
      continue;
    let next = seg[m + 1];
    if (next?.pos === "\u63A5\u982D\u8A5E") next = seg[m + 2];
    if (next?.pos !== "\u540D\u8A5E" || ASCII_SYMBOL.test(next.surface)) continue;
    if (NOT_MODIFIED.has(next.surface)) continue;
    if (["\u63A5\u5C3E", "\u4EE3\u540D\u8A5E", "\u6570"].includes(next.pos1)) continue;
    n++;
  }
  return n;
}
function rentaiKasanari(ts) {
  const segs = [[]];
  for (const t of ts) {
    const cut = t.pos === "\u8A18\u53F7" && (t.pos1 === "\u8AAD\u70B9" || t.pos1 === "\u53E5\u70B9") || t.surface === "\u306F" && t.pos === "\u52A9\u8A5E" && t.pos1 === "\u4FC2\u52A9\u8A5E" || SEGMENT_CUT.test(t.surface);
    if (cut) segs.push([]);
    else segs.at(-1)?.push(t);
  }
  return segs.some(
    (seg) => modifierClauses(seg) >= MIN_MODIFIER_CLAUSES && len(seg.map((t) => t.surface).join("")) >= MIN_SEGMENT_LENGTH
  );
}
function runEnds(sentences) {
  const hits = /* @__PURE__ */ new Set();
  let prev = null;
  let count = 0;
  sentences.forEach((s, i) => {
    const e = endingOf(s.tokens);
    if ([...e].length < MIN_ENDING_LENGTH || POLITE_ENDINGS.has(e)) {
      prev = null;
      count = 0;
      return;
    }
    count = e === prev ? count + 1 : 1;
    prev = e;
    if (count === RUN_LENGTH) hits.add(i);
  });
  return hits;
}
var checked = (b) => b.kind !== "heading" && b.kind !== "table";
function checkBlocks(blocks, analyzer) {
  const out = [];
  for (const b of blocks) {
    if (!checked(b)) continue;
    const sentences = sentencesOf(b.text, analyzer);
    const runs = b.kind === "list" ? /* @__PURE__ */ new Set() : runEnds(sentences);
    sentences.forEach((s, i) => {
      const text = b.text.slice(s.start, s.end);
      const hit = (id) => out.push({
        line: b.lineOf[s.start],
        endLine: b.lineOf[s.end - 1],
        text,
        ruleId: id,
        ...RULES[id],
        match: [...text].slice(0, MATCH_LENGTH).join("")
      });
      if (museShugo(s.tokens)) hit("muse-shugo");
      if (runs.has(i)) hit("bunmatsu-renzoku");
      const body = TERMINATORS.has(text.at(-1)) ? text.slice(0, -1) : text;
      if (len(body) >= LONG_SENTENCE && clauseCuts(s.tokens) >= MIN_CLAUSE_CUTS)
        hit("bun-nagasa");
      if (rentaiKasanari(s.tokens)) hit("rentai-kasanari");
    });
  }
  return out;
}

// src/lib/lint.ts
function matchesOf(rule, text) {
  const flags = `${rule.pattern.flags.replace("g", "")}g`;
  return [...text.matchAll(new RegExp(rule.pattern.source, flags))];
}
var OPEN_OF = { "\u300D": "\u300C", "\u300F": "\u300E" };
function quotedMask(text) {
  const open = [];
  return [...text].flatMap((ch) => {
    const close = OPEN_OF[ch];
    const now = open.length > 0 && ch !== "\u300C" && ch !== "\u300E" && !close;
    if (ch === "\u300C" || ch === "\u300E") open.push(ch);
    else if (close) {
      const i = open.lastIndexOf(close);
      if (i >= 0) open.length = i;
    }
    return ch.length === 2 ? [now, now] : [now];
  });
}
function quoted(mask, m) {
  const start = m.index ?? 0;
  const end = start + Math.max(m[0].length, 1);
  for (let i = start; i < end; i++) if (!mask[i]) return false;
  return true;
}
var NOT_IN_TYPE_NAME = /[\s、。，．,.!?！？|/()（）[\]「」『』【】]/u;
function typeName(text, m) {
  const start = m.index ?? 0;
  const before = text.slice(Math.max(0, start - 3), start);
  const at = before.lastIndexOf("\u301C");
  return at >= 0 && !NOT_IN_TYPE_NAME.test(before.slice(at + 1));
}
function violation(rule, m, text, line, endLine) {
  return {
    line,
    endLine,
    text,
    ruleId: rule.id,
    category: rule.category,
    match: m[0],
    advice: rule.advice
  };
}
function lint(src, opts) {
  const whole = opts.wholeFile ?? src;
  if (hasIgnoreMarker(src) || hasIgnoreMarker(whole)) return [];
  const out = [];
  if (isHtml(src.path)) {
    for (const b of extractBlocks(whole)) {
      const mask = quotedMask(b.text);
      for (const rule of opts.rules) {
        for (const m of matchesOf(rule, b.text)) {
          if (quoted(mask, m) || typeName(b.text, m)) continue;
          const start = m.index ?? 0;
          const end = start + Math.max(m[0].length, 1) - 1;
          out.push(
            violation(
              rule,
              m,
              b.text,
              b.lineOf[start],
              b.lineOf[end]
            )
          );
        }
      }
    }
  } else {
    for (const { line, text } of extractLines(src)) {
      const mask = quotedMask(text);
      for (const rule of opts.rules) {
        for (const m of matchesOf(rule, text))
          if (!quoted(mask, m) && !typeName(text, m))
            out.push(violation(rule, m, text, line, line));
      }
    }
  }
  if (opts.analyzer)
    out.push(...checkBlocks(extractBlocks(whole), opts.analyzer));
  return out;
}
function findEditRanges(fileText, bodies) {
  const newlines = (s) => s.split("\n").length - 1;
  return bodies.map((body) => {
    const at = body === "" ? -1 : fileText.indexOf(body);
    if (at < 0) return null;
    const start = newlines(fileText.slice(0, at)) + 1;
    return { start, end: start + newlines(body.replace(/\n$/, "")) };
  });
}
function overlaps(v, ranges) {
  return ranges.some((r) => v.line <= r.end && r.start <= v.endLine);
}

// src/lib/rules.ts
var AVOID_ADVICE = "\u8A9E\u3092\u6D88\u3057\u3066\u5177\u4F53\u7684\u306A\u4E8B\u5B9F\u30FB\u6570\u5024\u30FB\u6761\u4EF6\u3092\u66F8\u304F";
var TRANSLATION = [
  {
    id: "koto-dekiru",
    pattern: /ことが(でき|可能)/u,
    advice: "\u300C\u3059\u308B\u3053\u3068\u304C\u3067\u304D\u300D\u306F\u300C\u3067\u304D\u300D\u306B\u3001\u300C\u301C\u3053\u3068\u304C\u3067\u304D\u300D\u306F\u53EF\u80FD\u5F62\u306B\u7E2E\u3081\u308B\u3002\u5426\u5B9A\u3084\u904E\u53BB\u306E\u6D3B\u7528(\u3067\u304D\u306A\u3044\u30FB\u3067\u304D\u305F)\u306F\u4FDD\u3064"
  },
  {
    id: "kanten",
    pattern: /という観点(から|で)/u,
    advice: "\u300C\u301C\u3067\u898B\u308C\u3070\u300D\u300C\u301C\u3067\u306F\u300D\u306B\u8A00\u3044\u63DB\u3048\u308B"
  },
  {
    id: "ni-totte-juyo",
    pattern: /にとって(重要|大切)/u,
    advice: "\u4F55\u304C\u4F55\u3092\u6C7A\u3081\u308B\u306E\u304B\u3092\u3001\u5143\u306E\u6587\u306E\u5F37\u3055\u3092\u5909\u3048\u305A\u306B\u66F8\u304F"
  },
  {
    // 具体物や連体修飾(鍵を持つ、意味を持つ定義)を拾わないよう、3 語と文末に限る
    id: "wo-motsu",
    pattern: /(意味|価値|影響)を持つ(?=。|$)/mu,
    advice: "\u300C\u301C\u304C\u3042\u308B\u300D\u306B\u8A00\u3044\u63DB\u3048\u308B"
  },
  {
    id: "koto-ni-yotte",
    pattern: /ことによって/u,
    advice: "\u300C\u301C\u3059\u308B\u3068\u300D\u300C\u301C\u3057\u3066\u300D\u306B\u8A00\u3044\u63DB\u3048\u308B"
  },
  {
    id: "hoka-naranai",
    pattern: /に(他|ほか)ならない/u,
    advice: "\u8A00\u3044\u5207\u308A\u306B\u76F4\u3059\u3002\u5143\u306E\u6587\u306B\u7121\u3044\u56E0\u679C\u3092\u8DB3\u3055\u306A\u3044"
  },
  {
    id: "dash-insert",
    pattern: /——|――/u,
    advice: "\u62EC\u5F27\u306B\u5165\u308C\u308B\u304B\u3001\u6587\u3092\u5206\u3051\u308B"
  }
].map((r) => ({ ...r, category: "\u7FFB\u8A33\u8ABF" }));
var KATAKANA_OR_KANJI = "[\\u30A0-\\u30FF\\p{sc=Han}]";
function wordPattern(entry) {
  const word = entry.replace(/^〜+|〜+$/g, "");
  const body = word.split("\u301C").map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join(".{0,30}?");
  const head = new RegExp(`^${KATAKANA_OR_KANJI}`, "u").test(word) ? `(?<!${KATAKANA_OR_KANJI})` : "";
  return new RegExp(head + body, "u");
}
function avoidRules(discipline) {
  const section = discipline.split(/^## 避ける語[ \t]*$/m)[1]?.split(/^## /m)[0];
  if (section === void 0) return [];
  const rules = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const category = cells[1] ?? "";
    for (const m of (cells[2] ?? "").matchAll(/「([^」]+)」/g)) {
      const word = m[1] ?? "";
      rules.push({
        id: `avoid:${word}`,
        category,
        pattern: wordPattern(word),
        advice: AVOID_ADVICE
      });
    }
  }
  return rules;
}
function literalRules(discipline) {
  const lines = discipline.split("\n");
  const headerIndex = lines.findIndex((line) => {
    if (!line.startsWith("|")) return false;
    return line.split("|").map((cell) => cell.trim()).includes("\u907F\u3051\u308B\u8A33");
  });
  if (headerIndex === -1) return [];
  const header = (lines[headerIndex] ?? "").split("|").map((cell) => cell.trim());
  const avoidIndex = header.indexOf("\u907F\u3051\u308B\u8A33");
  const useIndex = header.indexOf("\u4F7F\u3046\u8A33");
  if (avoidIndex === -1 || useIndex === -1) return [];
  const rules = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map((cell) => cell.trim());
    const avoid = cells[avoidIndex] ?? "";
    const used = cells[useIndex] ?? "";
    const quotedWords = [...avoid.matchAll(/「([^」]+)」/g)].map(
      (match) => match[1] ?? ""
    );
    const words = quotedWords.length > 0 ? quotedWords : avoid.split(/[・、]/).map((cell) => cell.trim());
    for (const word of words) {
      if (!/^[゠-ヿ\p{sc=Han}]+$/u.test(word)) continue;
      rules.push({
        id: `literal:${word}`,
        category: "\u76F4\u8A33\u8A9E",
        // 「2 段目」のように、助数表現として続く「目」を許す。
        pattern: new RegExp(
          `(?<!${KATAKANA_OR_KANJI})${word}(?=\u76EE|(?!${KATAKANA_OR_KANJI}))`,
          "u"
        ),
        advice: `\u300C\u4F7F\u3046\u8A33\u300D\u306E\u5217\u306E\u300C${used}\u300D\u3092\u53C2\u8003\u306B\u3001\u6587\u8108\u306B\u5408\u3046\u8A9E\u3067\u66F8\u304F`
      });
    }
  }
  return rules;
}
function buildRules(discipline) {
  return [
    ...avoidRules(discipline),
    ...literalRules(discipline),
    ...TRANSLATION
  ];
}

// src/morph-runtime.ts
import fs from "node:fs";
import { createRequire } from "node:module";
import path2 from "node:path";
var VERSION = "6.2.0";
var INSTALL_DIR = `lindera-${VERSION}`;
var DICT_DIR = "ipadic";
var DICT_FILES = [
  "NOTICE.txt",
  "metadata.json",
  "dict.trie",
  "dict.wordsidx",
  "char_def.bin",
  "matrix.mtx",
  "dict.vals",
  "unk.bin",
  "dict.valsidx",
  "dict.words"
];
var LOCK_TTL_MS = 10 * 6e4;
var FAILED_TTL_MS = 24 * 60 * 6e4;
function loadAnalyzer(dataDir) {
  if (!dataDir) return null;
  const dir = path2.join(dataDir, "morph", INSTALL_DIR);
  const readyFile = path2.join(dir, "ready.json");
  try {
    if (!fs.existsSync(readyFile)) return null;
    const ready = JSON.parse(fs.readFileSync(readyFile, "utf8"));
    const required = [ready.node, ...DICT_FILES.map((f) => `${DICT_DIR}/${f}`)];
    const intact = required.every((rel) => Object.hasOwn(ready.files, rel)) && Object.entries(ready.files).every(([rel, rec]) => {
      try {
        const st = fs.statSync(path2.join(dir, rel));
        return st.size === rec.size && st.mtimeMs === rec.mtimeMs;
      } catch {
        return false;
      }
    });
    if (!intact) {
      fs.rmSync(readyFile, { force: true });
      return null;
    }
    const lindera = createRequire(import.meta.url)(
      path2.join(dir, ready.node)
    );
    return new lindera.Tokenizer(
      lindera.loadDictionary(path2.join(dir, ready.dict)),
      "normal"
    );
  } catch {
    return null;
  }
}

// src/check.ts
var MAX_LISTED = 10;
var WHOLE_FILE = /^(Write|mcp__.+__create_text_file)$/;
function main() {
  if (process.env.AMATSUKA_NATIVE_JAPANESE_CHECK === "off") return;
  const hook = JSON.parse(fs2.readFileSync(0, "utf8"));
  const input = hook?.tool_input;
  if (typeof input !== "object" || input === null) return;
  const given = [
    input.file_path,
    input.notebook_path,
    input.relative_path
  ].find((v) => typeof v === "string" && v !== "");
  const raw = [
    input.content,
    input.new_string,
    input.new_source,
    input.body,
    input.repl
  ];
  if (Array.isArray(input.edits))
    for (const e of input.edits) raw.push(e?.new_string);
  const bodies = raw.filter(
    (b) => typeof b === "string" && b !== ""
  );
  if (given === void 0 || bodies.length === 0) return;
  const cwd = typeof hook?.cwd === "string" ? hook.cwd : process.cwd();
  const file = path3.resolve(cwd, given);
  if (fs2.statSync(file).isDirectory()) return;
  const cellType = input.cell_type === "markdown" || input.cell_type === "code" ? input.cell_type : input.notebook_path !== void 0 ? cellTypeOf(file, input.cell_id) : void 0;
  const wholeText = input.notebook_path !== void 0 ? bodies[0] : fs2.readFileSync(file, "utf8");
  const whole = { path: file, text: wholeText, cellType };
  if (hasIgnoreMarker(whole)) return;
  const rules = buildRules(
    fs2.readFileSync(
      new URL("../references/discipline.md", import.meta.url),
      "utf8"
    )
  );
  const analyzer = process.env.AMATSUKA_NATIVE_JAPANESE_MORPH === "off" ? null : loadAnalyzer(process.env.CLAUDE_PLUGIN_DATA);
  const perBody = WHOLE_FILE.test(String(hook?.tool_name)) || input.notebook_path !== void 0 ? bodies.map(() => ({ start: 1, end: wholeText.split("\n").length })) : findEditRanges(wholeText, bodies);
  const ranges = perBody.filter((r) => r !== null);
  let morphFound = [];
  if (analyzer) {
    try {
      morphFound = lint(whole, { rules: [], analyzer }).filter(
        (v) => overlaps(v, ranges)
      );
    } catch {
    }
  }
  let found;
  if (isHtml(file)) {
    found = lint(whole, { rules }).filter((v) => overlaps(v, ranges));
  } else {
    found = bodies.flatMap((text, i) => {
      const shift = (perBody[i]?.start ?? 1) - 1;
      return lint({ path: file, text, cellType }, { rules }).map((v) => ({
        ...v,
        line: v.line + shift,
        endLine: v.endLine + shift
      }));
    });
  }
  found.push(...morphFound);
  if (found.length === 0) return;
  const fresh = unrecorded(hook?.session_id, file, found, bodies.join(""));
  if (fresh.length === 0) return;
  fresh.sort(
    (a, b) => Number(a.category === "\u6587") - Number(b.category === "\u6587") || a.line - b.line
  );
  const listed = fresh.slice(0, MAX_LISTED).map((v) => `- L${v.line}: \u300C${v.match}\u300D(${v.category})\u2192 ${v.advice}`);
  if (fresh.length > MAX_LISTED)
    listed.push(`- \u307B\u304B ${fresh.length - MAX_LISTED} \u4EF6`);
  const reason = [
    `[native-japanese] ${file} \u306B\u66F8\u3044\u305F\u65E5\u672C\u8A9E\u306B\u3001\u66F8\u304D\u65B9\u306E\u898F\u5F8B\u306E\u9055\u53CD\u304C ${fresh.length} \u4EF6\u3042\u308B\u3002\u8A72\u5F53\u7B87\u6240\u3092\u66F8\u304D\u76F4\u3059\u3002`,
    ...listed,
    "\u5217\u6319\u3057\u305F\u7B87\u6240\u306E\u307B\u304B\u306B\u3082\u3001\u7DE8\u96C6\u3057\u305F\u7BC4\u56F2\u306B\u82F1\u8A9E\u3092\u76F4\u8A33\u3057\u305F\u8A9E(\u898F\u5F8B\u306E\u8868\u306B\u7121\u3044\u8A9E\u3092\u542B\u3080)\u304C\u7121\u3044\u304B\u8AAD\u307F\u76F4\u3057\u3001\u3042\u308C\u3070\u76F4\u3059\u3002",
    "\u5F15\u7528\u30FB\u56FA\u6709\u540D\u8A5E\u30FB\u8B58\u5225\u5B50\u30FB\u30B3\u30FC\u30C9\u4F8B\u3068\u3057\u3066\u610F\u56F3\u3057\u3066\u66F8\u3044\u305F\u7B87\u6240\u3068\u3001\u691C\u67FB\u306E\u8AA4\u308A\u3068\u5224\u65AD\u3057\u305F\u7B87\u6240\u306F\u3001\u76F4\u3055\u305A\u306B\u6B8B\u3057\u3066\u3088\u3044\u3002\u76F4\u3059\u3068\u304D\u306F\u3001\u5426\u5B9A\u30FB\u6761\u4EF6\u30FB\u78BA\u4FE1\u5EA6\u3092\u5143\u306E\u6587\u306E\u307E\u307E\u4FDD\u3064\u3002"
  ].join("\n");
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}
`);
}
function cellTypeOf(file, cellId) {
  try {
    const nb = JSON.parse(fs2.readFileSync(file, "utf8"));
    const cell = typeof cellId === "string" ? nb.cells?.find((c) => c.id === cellId) : void 0;
    return cell?.cell_type === "markdown" ? "markdown" : "code";
  } catch {
    return "code";
  }
}
function unrecorded(sessionId, file, found, body) {
  const bodyHash = createHash("sha1").update(body).digest("hex");
  const key = (v) => JSON.stringify([file, v.ruleId, v.match, bodyHash]);
  if (typeof sessionId !== "string" || !/^[\w.-]+$/.test(sessionId))
    return found;
  const dir = path3.join(os.tmpdir(), "native-japanese");
  const record = path3.join(dir, `${sessionId}.json`);
  let seen = /* @__PURE__ */ new Set();
  try {
    const keys = JSON.parse(fs2.readFileSync(record, "utf8"));
    if (Array.isArray(keys)) seen = new Set(keys.map(String));
  } catch {
  }
  const fresh = found.filter((v) => !seen.has(key(v)));
  if (fresh.length === 0) return fresh;
  try {
    for (const v of fresh) seen.add(key(v));
    fs2.mkdirSync(dir, { recursive: true });
    const tmp = path3.join(dir, `.${sessionId}.${randomUUID()}.tmp`);
    fs2.writeFileSync(tmp, JSON.stringify([...seen]));
    fs2.renameSync(tmp, record);
  } catch {
  }
  return fresh;
}
try {
  main();
} catch {
}
