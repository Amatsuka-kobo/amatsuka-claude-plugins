import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

// 同一ディレクトリの rename を使い、読者に途中の内容を見せずに置換する。
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tempPath = path.join(
    dir,
    `.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  )

  try {
    fs.writeFileSync(tempPath, content)
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
}
