// 正本(ARCHITECTURE・rules・GOTCHAS)への書き込みを一時ファイル + rename で行う。
//
// 途中で失敗しても正本は元のバイト列のまま残り、一時ファイルも残さない。
// 例外は包まずにそのまま投げ直す。扱いは呼び出し側が決める。

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

// 実体が未作成の symlink を辿る回数の上限。循環したリンクはここで止める。
const MAX_LINK_HOPS = 40

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

/**
 * 書き込む実体のパスを返す。symlink は辿った先へ書き、リンクそのものは潰さない。
 *
 * 実体がまだ無い symlink は `realpathSync` が ENOENT になるので、`readlinkSync` で
 * リンクを 1 つずつ辿り、symlink でないパスに行き着いたらそこへ書く。
 */
function resolveWriteTarget(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error
  }

  let current = path.resolve(target)
  for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
    let link: string
    try {
      link = fs.readlinkSync(current)
    } catch (error) {
      // ENOENT は未作成のファイル、EINVAL は symlink でない既存のパス
      const code = errnoCode(error)
      if (code === "ENOENT" || code === "EINVAL") return current
      throw error
    }
    current = path.resolve(path.dirname(current), link)
  }
  const err: NodeJS.ErrnoException = new Error(
    `ELOOP: too many symbolic links encountered, '${target}'`
  )
  err.code = "ELOOP"
  throw err
}

function existingMode(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mode & 0o7777
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null
    throw error
  }
}

export function writeFileAtomic(target: string, data: string | Buffer): void {
  const dest = resolveWriteTarget(target)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const mode = existingMode(dest)
  // 実体の隣に置くので、rename が別のファイルシステムへまたがらない
  const tmp = `${dest}.tmp-${crypto.randomUUID()}`
  try {
    fs.writeFileSync(tmp, data)
    if (mode !== null) fs.chmodSync(tmp, mode)
    fs.renameSync(tmp, dest)
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // 後始末の失敗は握りつぶす
    }
    throw error
  }
}
