import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const DICT_FILES = [
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
]

// data の下に、lindera の .node の代わりに src/testing/fake-lindera.cjs を読み込ませる取得物を置き、data を返す。
// loadAnalyzer の照合を通るよう、ready.json の files に .node と ipadic/ の 10 ファイルをそろえる
export function fakeDataDir(data: string): string {
  const dir = path.join(data, "morph", "lindera-6.2.0")
  fs.mkdirSync(path.join(dir, "ipadic"), { recursive: true })
  const stub = fileURLToPath(
    new URL("../../testing/fake-lindera.cjs", import.meta.url)
  )
  const node = path.relative(dir, stub)
  const rels = [node, ...DICT_FILES.map((f) => `ipadic/${f}`)]
  for (const f of DICT_FILES) fs.writeFileSync(path.join(dir, "ipadic", f), "")
  const files: Record<string, { size: number; mtimeMs: number }> = {}
  for (const rel of rels) {
    const st = fs.statSync(path.join(dir, rel))
    files[rel] = { size: st.size, mtimeMs: st.mtimeMs }
  }
  fs.writeFileSync(
    path.join(dir, "ready.json"),
    JSON.stringify({
      version: "6.2.0",
      target: "test",
      node,
      dict: "ipadic",
      files
    })
  )
  return data
}
