import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globToRegExp, readDomains, findProjectRoot } from "../lib.js";

test("globToRegExp: src/** は src/a/b.ts にマッチする", () => {
  expect("src/a/b.ts").toMatch(globToRegExp("src/**"));
});

test("globToRegExp: src/** は other/x にマッチしない", () => {
  expect("other/x").not.toMatch(globToRegExp("src/**"));
});

test("globToRegExp: *.md はディレクトリを跨がずファイル名にマッチする", () => {
  expect("readme.md").toMatch(globToRegExp("*.md"));
});

test("globToRegExp: *.md はディレクトリを跨ぐパスにはマッチしない", () => {
  expect("src/readme.md").not.toMatch(globToRegExp("*.md"));
});

test("globToRegExp: ** は深いネストのパスにもマッチする", () => {
  expect("a/b/c.ts").toMatch(globToRegExp("**"));
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
  expect(readDomains(root)).toStrictEqual({ domains: ["auth", "billing"] });
});

test("readDomains: json codiel:domains ブロックがなければ null", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lib-domains-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "ARCHITECTURE.md"), "# Architecture\n\nno domains block here\n");
  expect(readDomains(root)).toBe(null);
});

test("readDomains: 壊れた JSON なら null", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lib-domains-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  const body = ["```json codiel:domains", "{not valid json", "```", ""].join("\n");
  fs.writeFileSync(path.join(root, "docs", "ARCHITECTURE.md"), body);
  expect(readDomains(root)).toBe(null);
});

test("findProjectRoot: サブディレクトリから祖先の .codiel を発見できる", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lib-root-"));
  fs.mkdirSync(path.join(root, ".codiel"), { recursive: true });
  const sub = path.join(root, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  expect(fs.realpathSync(findProjectRoot(sub))).toBe(fs.realpathSync(root));
});

test("findProjectRoot: .codiel が見つからなければ startDir をそのまま返す", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lib-noroot-"));
  const sub = path.join(root, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  expect(findProjectRoot(sub)).toBe(sub);
});
