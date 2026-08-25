import crypto from "node:crypto"

// frontmatter を除いた本文のハッシュ。翻訳で label / description が
// 書き換わってもハッシュが変わらないよう、本文だけを対象にする。
export function bodyHash(content: string): string {
  const lines = content.split("\n")
  let body = lines
  if (lines[0]?.trim() === "---") {
    const close = lines.indexOf("---", 1)
    if (close !== -1) body = lines.slice(close + 1)
  }
  return crypto
    .createHash("sha256")
    .update(body.join("\n").trim())
    .digest("hex")
    .slice(0, 16)
}
