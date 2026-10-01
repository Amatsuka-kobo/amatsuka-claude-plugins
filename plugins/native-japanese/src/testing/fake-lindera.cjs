// 測定 CLI のテストで、lindera の .node の代わりに loadAnalyzer に読み込ませる。
// ready.json の node にこのファイルを指させ、固定データの例文だけを解析できる解析器を返す。
// 知らない本文には何も返さない。NJ_FAKE_LINDERA_THROW=1 なら、解析のたびに例外を投げる。

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
    if (process.env.NJ_FAKE_LINDERA_THROW === "1")
      throw new Error("fake-lindera: 解析に失敗した")
    return fixture.find((s) => s.text === text)?.tokens ?? []
  }
}
