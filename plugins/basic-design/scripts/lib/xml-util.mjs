const XML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}
