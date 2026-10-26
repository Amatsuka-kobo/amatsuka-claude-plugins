import crypto from "node:crypto"

export function textHash(text: string): string {
  return crypto
    .createHash("sha256")
    .update(text.trim())
    .digest("hex")
    .slice(0, 16)
}

// 翻訳で label / description が書き換わってもハッシュが変わらないよう、本文だけを対象にする。
export function bodyHash(content: string): string {
  const lines = content.split("\n")
  let body = lines
  if (lines[0]?.trim() === "---") {
    const close = lines.indexOf("---", 1)
    if (close !== -1) body = lines.slice(close + 1)
  }
  return textHash(body.join("\n"))
}

export interface HashRecord {
  description?: string
  preamble?: string
  /** キーは見出し行 */
  sections: Record<string, string>
}

// base64url は `:` を含まないため、frontmatter のどの読み方でも 1 行の値として壊れない。
export function encodeRecord(record: HashRecord): string {
  return Buffer.from(JSON.stringify(record), "utf8").toString("base64url")
}

export function decodeRecord(
  value: string | undefined
): HashRecord | undefined {
  if (value === undefined || value.trim() === "") return undefined
  try {
    const parsed = JSON.parse(
      Buffer.from(value.trim(), "base64url").toString("utf8")
    )
    if (typeof parsed !== "object" || parsed === null) return undefined
    if (typeof parsed.sections !== "object" || parsed.sections === null) {
      return undefined
    }
    return parsed as HashRecord
  } catch {
    return undefined
  }
}
