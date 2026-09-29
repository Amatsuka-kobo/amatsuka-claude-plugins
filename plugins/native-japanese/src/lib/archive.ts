// tarball と zip の Buffer から、指定した名前のファイルだけを取り出す。
// ファイルは読まず、標準ライブラリの zlib だけで展開する。
// 形式が壊れていれば例外を投げ、呼び出し側が取得の失敗として扱う。

import zlib from "node:zlib"

const BLOCK = 512

function cString(buf: Buffer, start: number, length: number): string {
  const field = buf.subarray(start, start + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8")
}

// ustar のヘッダを 1 つずつ読み、name に一致する通常ファイルの中身を返す。
// pax 拡張ヘッダの長い名前は読まない。取り出す名前が 100 バイトに収まる前提である。
export function extractTarEntry(tgz: Buffer, name: string): Buffer | null {
  const tar = zlib.gunzipSync(tgz)
  let offset = 0
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.every((b) => b === 0)) return null

    let sum = 0
    for (let i = 0; i < BLOCK; i++)
      sum += i >= 148 && i < 156 ? 0x20 : header[i]
    if (Number.parseInt(cString(header, 148, 8).trim(), 8) !== sum) {
      throw new Error(`tar のヘッダのチェックサムが合わない(位置 ${offset})`)
    }

    const size = Number.parseInt(cString(header, 124, 12).trim() || "0", 8)
    const dataStart = offset + BLOCK
    if (Number.isNaN(size) || dataStart + size > tar.length) {
      throw new Error(`tar の項目のサイズが不正(位置 ${offset})`)
    }

    const prefix = cString(header, 345, 155)
    const base = cString(header, 0, 100)
    const entryName = prefix ? `${prefix}/${base}` : base
    const type = header[156]
    if (entryName === name && (type === 0x30 || type === 0)) {
      return Buffer.from(tar.subarray(dataStart, dataStart + size))
    }
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK
  }
  throw new Error("tar の終端ブロックが無い")
}

function isUnsafe(entryName: string): boolean {
  return (
    entryName.startsWith("/") ||
    entryName.includes("\\") ||
    /^[A-Za-z]:/.test(entryName) ||
    entryName.split("/").includes("..")
  )
}

// セントラルディレクトリから項目を読むので、データディスクリプタ形式でも
// サイズを取り違えない。圧縮方式は stored(0)と deflate(8)だけを扱う。
export function extractZipEntries(
  zip: Buffer,
  prefix: string,
  names: string[]
): Map<string, Buffer> {
  // EOCD は末尾 22 バイトに、最大 65535 バイトのコメントが続きうる
  let eocd = -1
  for (
    let i = zip.length - 22;
    i >= Math.max(0, zip.length - 22 - 0xffff);
    i--
  ) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error("zip の終端レコードが見つからない")

  const count = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  const wanted = new Set(names)
  const out = new Map<string, Buffer>()

  for (let n = 0; n < count; n++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(
        `zip のセントラルディレクトリが壊れている(位置 ${offset})`
      )
    }
    const method = zip.readUInt16LE(offset + 10)
    const compSize = zip.readUInt32LE(offset + 20)
    const size = zip.readUInt32LE(offset + 24)
    const nameLen = zip.readUInt16LE(offset + 28)
    const extraLen = zip.readUInt16LE(offset + 30)
    const commentLen = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const entryName = zip.toString("utf8", offset + 46, offset + 46 + nameLen)
    offset += 46 + nameLen + extraLen + commentLen

    if (isUnsafe(entryName) || !entryName.startsWith(prefix)) continue
    const rest = entryName.slice(prefix.length)
    if (rest.includes("/") || !wanted.has(rest)) continue

    if (
      localOffset + 30 > zip.length ||
      zip.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      throw new Error(`zip のローカルヘッダが壊れている: ${entryName}`)
    }
    const dataStart =
      localOffset +
      30 +
      zip.readUInt16LE(localOffset + 26) +
      zip.readUInt16LE(localOffset + 28)
    if (dataStart + compSize > zip.length) {
      throw new Error(`zip の項目が途中で切れている: ${entryName}`)
    }
    const data = zip.subarray(dataStart, dataStart + compSize)

    let body: Buffer
    if (method === 0) body = Buffer.from(data)
    else if (method === 8) body = zlib.inflateRawSync(data)
    else
      throw new Error(
        `zip の圧縮方式 ${method} には対応していない: ${entryName}`
      )
    if (body.length !== size) {
      throw new Error(`zip の項目の展開後のサイズが合わない: ${entryName}`)
    }
    out.set(rest, body)
  }
  return out
}
