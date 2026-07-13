const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
}

export function escapeXml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c])
}
