#!/usr/bin/env node

// src/measure.ts
import { execFileSync } from "node:child_process";
import fs2 from "node:fs";
import path3 from "node:path";
import { parseArgs } from "node:util";

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
function sentencesOf(text, analyzer2) {
  const sentences = splitSentences(text).map((r) => ({
    ...r,
    tokens: []
  }));
  let at = 0;
  let k = 0;
  for (const raw of analyzer2.tokenize(text)) {
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
function sentenceLines(blocks) {
  return blocks.filter(checked).flatMap(
    (b) => splitSentences(b.text).map((s) => ({
      line: b.lineOf[s.start],
      endLine: b.lineOf[s.end - 1]
    }))
  );
}
function checkBlocks(blocks, analyzer2) {
  const out = [];
  for (const b of blocks) {
    if (!checked(b)) continue;
    const sentences = sentencesOf(b.text, analyzer2);
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
  const rules2 = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const category = cells[1] ?? "";
    for (const m of (cells[2] ?? "").matchAll(/「([^」]+)」/g)) {
      const word = m[1] ?? "";
      rules2.push({
        id: `avoid:${word}`,
        category,
        pattern: wordPattern(word),
        advice: AVOID_ADVICE
      });
    }
  }
  return rules2;
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
  const rules2 = [];
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
      rules2.push({
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
  return rules2;
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

// src/measure.ts
function countSentences(src, ranges) {
  return sentenceLines(extractBlocks(src)).filter(
    (s) => !ranges || ranges.some((r) => s.line <= r.end && r.start <= s.endLine)
  ).length;
}
var USAGE = "\u4F7F\u3044\u65B9: measure.mjs (--git <range> | --transcripts <dir> [--since YYYY-MM-DD]) [--data-dir <dir>] [--format json|text]";
function fail(message) {
  process.stderr.write(`${message}
${USAGE}
`);
  process.exit(2);
}
function parseDiff(diff) {
  const files = [];
  let cur = null;
  let inHeader = false;
  let hunk = null;
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) {
      cur = null;
      hunk = null;
      inHeader = true;
    } else if (inHeader && l.startsWith("+++ ")) {
      const p = l.slice(4);
      if (p.startsWith("b/")) {
        cur = { path: p.slice(2), hunks: [] };
        files.push(cur);
      }
    } else if (l.startsWith("@@ ")) {
      inHeader = false;
      const m = /^@@ -\S+ \+(\d+)/.exec(l);
      hunk = cur && m ? { start: Number(m[1]), lines: [] } : null;
      if (hunk) cur?.hunks.push(hunk);
    } else if (!inHeader && hunk && l.startsWith("+")) {
      hunk.lines.push(l.slice(1));
    }
  }
  return files;
}
function measureGit(range, rules2, analyzer2) {
  const git = (...args) => execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const diff = git(
    "-c",
    "core.quotePath=false",
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    range
  );
  const dots = /\.\.\.?/.exec(range);
  const end = dots ? range.slice(dots.index + dots[0].length) || "HEAD" : null;
  const top = git("rev-parse", "--show-toplevel").trim();
  const tally = { lines: 0, sentences: 0, found: [] };
  for (const file of parseDiff(diff)) {
    let text;
    try {
      text = end === null ? fs2.readFileSync(path3.join(top, file.path), "utf8") : git("show", `${end}:${file.path}`);
    } catch {
      continue;
    }
    const whole = { path: file.path, text };
    if (hasIgnoreMarker(whole)) continue;
    const ranges = file.hunks.filter((h) => h.lines.length > 0).map((h) => ({ start: h.start, end: h.start + h.lines.length - 1 }));
    if (isHtml(file.path)) {
      const seen = /* @__PURE__ */ new Set();
      for (const b of extractBlocks(whole))
        for (const n of b.lineOf)
          if (ranges.some((r) => r.start <= n && n <= r.end)) seen.add(n);
      tally.lines += seen.size;
      if (analyzer2) tally.sentences += countSentences(whole, ranges);
      for (const v of lint(whole, { rules: rules2, analyzer: analyzer2 }))
        if (overlaps(v, ranges)) tally.found.push({ ...v, path: file.path });
      continue;
    }
    if (analyzer2) {
      tally.sentences += countSentences(whole, ranges);
      for (const v of lint(whole, { rules: [], analyzer: analyzer2 }))
        if (overlaps(v, ranges)) tally.found.push({ ...v, path: file.path });
    }
    for (const h of file.hunks) {
      const frag = { path: file.path, text: h.lines.join("\n") };
      tally.lines += extractLines(frag).length;
      for (const v of lint(frag, { rules: rules2 }))
        tally.found.push({
          ...v,
          path: file.path,
          line: v.line + h.start - 1,
          endLine: v.endLine + h.start - 1
        });
    }
  }
  return tally;
}
var TOOL = /^(Write|Edit|MultiEdit|NotebookEdit|mcp__.+__(replace_content|replace_symbol_body|insert_after_symbol|insert_before_symbol|replace_in_files|create_text_file|replace_lines|insert_at_line))$/;
function sourcesOf(input) {
  const p = [input.file_path, input.notebook_path, input.relative_path].find(
    (v) => typeof v === "string" && v !== ""
  );
  if (p === void 0) return [];
  const bodies = [
    input.content,
    input.new_string,
    input.new_source,
    input.body,
    input.repl
  ];
  if (Array.isArray(input.edits))
    for (const e of input.edits) bodies.push(e?.new_string);
  const cellType = input.cell_type === "markdown" || input.cell_type === "code" ? input.cell_type : void 0;
  return bodies.filter((b) => typeof b === "string" && b !== "").map((text) => ({ path: p, text, cellType }));
}
function writerOf(file) {
  const m = /^agent-(.+)\.jsonl$/.exec(path3.basename(file));
  if (!m || path3.basename(path3.dirname(file)) !== "subagents") return "main";
  try {
    const meta = JSON.parse(
      fs2.readFileSync(
        path3.join(path3.dirname(file), `agent-${m[1]}.meta.json`),
        "utf8"
      )
    );
    if (typeof meta.agentType === "string") return meta.agentType;
  } catch {
  }
  return "unknown";
}
function measureTranscripts(dir, since, rules2, analyzer2) {
  const byWriter = /* @__PURE__ */ new Map();
  const files = fs2.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".jsonl")).sort();
  for (const rel of files) {
    const file = path3.join(dir, rel);
    const writer = writerOf(file);
    const tally = byWriter.get(writer) ?? { lines: 0, sentences: 0, found: [] };
    byWriter.set(writer, tally);
    for (const l of fs2.readFileSync(file, "utf8").split("\n")) {
      let rec;
      try {
        rec = JSON.parse(l);
      } catch {
        continue;
      }
      if (rec?.type !== "assistant") continue;
      if (since !== void 0 && !(typeof rec.timestamp === "string" && rec.timestamp.slice(0, 10) >= since))
        continue;
      const content = rec.message?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type !== "tool_use" || typeof c.name !== "string") continue;
        if (!TOOL.test(c.name) || typeof c.input !== "object" || !c.input)
          continue;
        for (const src of sourcesOf(c.input)) {
          if (hasIgnoreMarker(src)) continue;
          tally.lines += isHtml(src.path) ? new Set(extractBlocks(src).flatMap((b) => b.lineOf)).size : extractLines(src).length;
          if (analyzer2) tally.sentences += countSentences(src);
          for (const v of lint(src, { rules: rules2, analyzer: analyzer2 }))
            tally.found.push({ ...v, path: src.path });
        }
      }
    }
  }
  return byWriter;
}
function openAnalyzer(dataDir) {
  let dir = dataDir;
  if (dir === void 0) {
    if (process.env.AMATSUKA_NATIVE_JAPANESE_MORPH === "off")
      return {
        analyzer: null,
        morph: { used: false, reason: "AMATSUKA_NATIVE_JAPANESE_MORPH=off" }
      };
    dir = process.env.CLAUDE_PLUGIN_DATA;
    if (!dir)
      return {
        analyzer: null,
        morph: {
          used: false,
          reason: "--data-dir \u3082 CLAUDE_PLUGIN_DATA \u3082\u6307\u5B9A\u3055\u308C\u3066\u3044\u306A\u3044"
        }
      };
  }
  const analyzer2 = loadAnalyzer(dir);
  return analyzer2 ? { analyzer: analyzer2, morph: { used: true } } : {
    analyzer: null,
    morph: {
      used: false,
      reason: `${dir} \u306B\u53D6\u5F97\u7269\u304C\u7121\u3044\u304B\u3001\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u305F`
    }
  };
}
function report(tally, rules2, byWriter, morph2) {
  const regexIds = new Set(rules2.map((r) => r.id));
  const counts = /* @__PURE__ */ new Map();
  const examples = {};
  for (const v of tally.found) {
    counts.set(v.ruleId, (counts.get(v.ruleId) ?? 0) + 1);
    const ex = examples[v.ruleId] ?? [];
    examples[v.ruleId] = ex;
    if (ex.length < 3) ex.push(v);
  }
  const violations = tally.found.length;
  return {
    morph: morph2,
    lines: tally.lines,
    sentences: tally.sentences,
    violations,
    per100Lines: tally.lines === 0 ? 0 : Math.round(violations / tally.lines * 100 * 100) / 100,
    // 多い順。同数なら id の順
    byRule: [...counts].map(([ruleId, count]) => ({
      ruleId,
      layer: regexIds.has(ruleId) ? "regex" : "morph",
      count
    })).sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId)),
    ...byWriter && {
      // main を先に、残りは書き手の名前の順に並べる
      byWriter: [...byWriter].sort(
        ([a], [b]) => a === "main" ? -1 : b === "main" ? 1 : a.localeCompare(b)
      ).map(([writer, t]) => ({
        writer,
        lines: t.lines,
        violations: t.found.length
      }))
    },
    examples
  };
}
function toText(r) {
  const out = [
    `\u5F62\u614B\u7D20\u89E3\u6790: ${r.morph.used ? "\u4F7F\u3063\u305F" : `\u4F7F\u3063\u3066\u3044\u306A\u3044(${r.morph.reason ?? "\u7406\u7531\u4E0D\u660E"})`}`,
    `\u691C\u67FB\u3057\u305F\u884C: ${r.lines}  \u6587: ${r.sentences}  \u9055\u53CD: ${r.violations}  100 \u884C\u3042\u305F\u308A: ${r.per100Lines}`
  ];
  for (const layer of ["regex", "morph"]) {
    const rows = r.byRule.filter((b) => b.layer === layer);
    if (rows.length === 0) continue;
    out.push(
      "",
      `\u898F\u5247\u3054\u3068\u306E\u9055\u53CD(${layer === "regex" ? "\u6B63\u898F\u8868\u73FE" : "\u5F62\u614B\u7D20\u89E3\u6790"}\u306E\u5C64):`
    );
    for (const b of rows) out.push(`  ${b.count}	${b.ruleId}`);
  }
  if (r.byWriter) {
    out.push("", "\u66F8\u304D\u624B\u3054\u3068:");
    for (const w of r.byWriter)
      out.push(`  ${w.writer}	${w.lines} \u884C	${w.violations} \u4EF6`);
  }
  out.push("", "\u9055\u53CD\u306E\u4F8B:");
  for (const [id, vs] of Object.entries(r.examples)) {
    out.push(`  ${id}`);
    for (const v of vs)
      out.push(`    ${v.path}:${v.line} \u300C${v.match}\u300D ${v.text.trim()}`);
  }
  return `${out.join("\n")}
`;
}
var values;
try {
  ;
  ({ values } = parseArgs({
    options: {
      git: { type: "string" },
      transcripts: { type: "string" },
      since: { type: "string" },
      "data-dir": { type: "string" },
      format: { type: "string", default: "text" }
    }
  }));
} catch (e) {
  fail(e.message);
}
if (values.git === void 0 === (values.transcripts === void 0))
  fail("--git \u3068 --transcripts \u306E\u3069\u3061\u3089\u304B 1 \u3064\u3092\u6307\u5B9A\u3059\u308B");
if (values.format !== "json" && values.format !== "text")
  fail("--format \u306F json \u304B text");
if (values.since !== void 0 && !/^\d{4}-\d{2}-\d{2}$/.test(values.since))
  fail("--since \u306F YYYY-MM-DD");
if (values.since !== void 0 && values.transcripts === void 0)
  fail("--since \u306F --transcripts \u3068\u4E00\u7DD2\u306B\u4F7F\u3046");
var rules = buildRules(
  fs2.readFileSync(
    new URL("../references/discipline.md", import.meta.url),
    "utf8"
  )
);
var { analyzer, morph } = openAnalyzer(values["data-dir"]);
var result;
try {
  if (values.git !== void 0) {
    result = report(measureGit(values.git, rules, analyzer), rules, null, morph);
  } else {
    const byWriter = measureTranscripts(
      values.transcripts,
      values.since,
      rules,
      analyzer
    );
    const all = { lines: 0, sentences: 0, found: [] };
    for (const t of byWriter.values()) {
      all.lines += t.lines;
      all.sentences += t.sentences;
      all.found.push(...t.found);
    }
    result = report(all, rules, byWriter, morph);
  }
} catch (e) {
  process.stderr.write(`${e.message}
`);
  process.exit(1);
}
process.stdout.write(
  values.format === "json" ? `${JSON.stringify(result)}
` : toText(result)
);
