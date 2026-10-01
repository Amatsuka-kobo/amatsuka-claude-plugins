// 例文を実物の lindera で解析し、形態素の列を固定データの JSON に書き出す。
// 使い方: node dump-tokens.mjs <データディレクトリ> <例文ファイル>
// 書き出し先は例文ファイルと同じディレクトリの tokens.json。例文は 1 行 1 文で、空行は読み飛ばす。
// npm の lindera パッケージは ESM へバンドルできないので、.node を createRequire で直接読む。

import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const [dataDir, sentencesFile] = process.argv.slice(2)
if (!dataDir || !sentencesFile) {
  console.error("使い方: node dump-tokens.mjs <データディレクトリ> <例文ファイル>")
  process.exit(1)
}

const dir = path.resolve(dataDir, "morph", "lindera-6.2.0")
const ready = JSON.parse(fs.readFileSync(path.join(dir, "ready.json"), "utf8"))
const lindera = createRequire(import.meta.url)(path.join(dir, ready.node))
const tokenizer = new lindera.Tokenizer(
  lindera.loadDictionary(path.join(dir, ready.dict)),
  "normal"
)

const out = fs
  .readFileSync(sentencesFile, "utf8")
  .split(/\r?\n/)
  .filter((line) => line !== "")
  .map((text) => ({
    text,
    tokens: tokenizer
      .tokenize(text)
      .map((t) => ({ surface: t.surface, details: [...t.details] }))
  }))

const outFile = path.join(path.dirname(path.resolve(sentencesFile)), "tokens.json")
// 差分を読みやすくするため、1 トークンを 1 行に書く
const body = out
  .map(
    (s) =>
      `  {\n    "text": ${JSON.stringify(s.text)},\n    "tokens": [\n${s.tokens
        .map((t) => `      ${JSON.stringify(t)}`)
        .join(",\n")}\n    ]\n  }`
  )
  .join(",\n")
fs.writeFileSync(outFile, `[\n${body}\n]\n`)
console.log(`${out.length} 文を ${outFile} に書き出した`)
