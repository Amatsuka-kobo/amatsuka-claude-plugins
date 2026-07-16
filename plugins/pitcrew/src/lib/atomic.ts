import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

// 同一ディレクトリ内 rename の原子性を利用した書き込み(設計書 §9)。
// ビューアが書きかけのファイルを読まないようにする。親ディレクトリも自動作成する。
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  )
  try {
    fs.writeFileSync(tmp, content)
    fs.renameSync(tmp, filePath)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
}
