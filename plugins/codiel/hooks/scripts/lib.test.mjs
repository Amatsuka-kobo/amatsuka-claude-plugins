import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globToRegExp, readDomains, findProjectRoot } from "./lib.mjs";

test("globToRegExp: src/** は src/a/b.ts にマッチする", () => {
  assert.match("src/a/b.ts", globToRegExp("src/**"));
});

test("globToRegExp: src/** は other/x にマッチしない", () => {
  assert.doesNotMatch("other/x", globToRegExp("src/**"));
});

test("globToRegExp: *.md はディレクトリを跨がずファイル名にマッチする", () => {
  assert.match("readme.md", globToRegExp("*.md"));
});

test("globToRegExp: *.md はディレクトリを跨ぐパスにはマッチしない", () => {
  assert.doesNotMatch("src/readme.md", globToRegExp("*.md"));
});

test("globToRegExp: ** は深いネストのパスにもマッチする", () => {
  assert.match("a/b/c.ts", globToRegExp("**"));
});

test("readDomains: docs/ARCHITECTURE.md の json codiel:domains ブロックを抽出できる", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lib-domains-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  const body = [
    "# Architecture",
    "",
    "```json codiel:domains",
    '{"domains": ["auth", "billing"]}',
    "```",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "docs", "ARCHITECTURE.md"), body);
  assert.deepEqual(readDomains(root), { domains: ["auth", "billing"] });
});

test("readDomains: json codiel:domains ブロックがなければ null", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lib-domains-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "ARCHITECTURE.md"), "# Architecture\n\nno domains block here\n");
  assert.equal(readDomains(root), null);
});

test("readDomains: 壊れた JSON なら null", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lib-domains-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  const body = ["```json codiel:domains", "{not valid json", "```", ""].join("\n");
  fs.writeFileSync(path.join(root, "docs", "ARCHITECTURE.md"), body);
  assert.equal(readDomains(root), null);
});

test("findProjectRoot: サブディレクトリから祖先の .codiel を発見できる", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lib-root-"));
  fs.mkdirSync(path.join(root, ".codiel"), { recursive: true });
  const sub = path.join(root, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(fs.realpathSync(findProjectRoot(sub)), fs.realpathSync(root));
});

test("findProjectRoot: .codiel が見つからなければ startDir をそのまま返す", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lib-noroot-"));
  const sub = path.join(root, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(findProjectRoot(sub), sub);
});
