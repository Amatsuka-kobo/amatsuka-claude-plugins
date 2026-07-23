import { expect, test } from "vitest"
import { redactSecrets } from "../redact.js"

test("secret-like 環境変数代入を値だけ置換する", () => {
  expect(
    redactSecrets(
      'export API_TOKEN="token value" OTHER=value db_password=hunter2; PASSWD=last'
    )
  ).toBe(
    "export API_TOKEN=<redacted> OTHER=value db_password=<redacted>; PASSWD=<redacted>"
  )
})

test("Authorization Bearer token を大文字小文字に関係なく置換する", () => {
  expect(
    redactSecrets(
      "curl -H 'Authorization: Bearer abc.def-123' / && authorization: bearer xyz"
    )
  ).toBe(
    "curl -H 'Authorization: Bearer <redacted>' / && authorization: bearer <redacted>"
  )
})

test("secret に見えない文字列は変更しない", () => {
  expect(
    redactSecrets("MONITOR=wide credentialless=true Authorization: Basic abc")
  ).toBe("MONITOR=wide credentialless=true Authorization: Basic abc")
})

test("secret marker を名前の途中に含む環境変数も置換する", () => {
  expect(redactSecrets("MONKEYPATCH=value MYTOKEN=value")).toBe(
    "MONKEYPATCH=<redacted> MYTOKEN=<redacted>"
  )
})
