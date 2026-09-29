// 測定 CLI のテストで、lindera の .node の代わりに loadAnalyzer に読み込ませる。
// ready.json の node にこのファイルを指させ、固定データの例文だけを解析できる解析器を返す。
// 知らない本文には何も返さない。

const fs = require("node:fs")
const path = require("node:path")

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "fixtures", "morph", "tokens.json"),
    "utf8"
  )
)

exports.loadDictionary = () => ({})
exports.Tokenizer = class {
  tokenize(text) {
    return fixture.find((s) => s.text === text)?.tokens ?? []
  }
}
