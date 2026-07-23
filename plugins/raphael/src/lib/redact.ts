const ENV_ASSIGNMENT =
  /\b([A-Za-z_][A-Za-z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s;|&]*)/g
const SECRET_NAME_PART = /TOKEN|KEY|SECRET|PASSWORD|PASSWD/i
const BEARER_AUTHORIZATION = /(Authorization\s*:\s*Bearer\s+)([^\s'";,]+)/gi

/** Best-effort redaction for the secret forms Raphael persists locally. */
export function redactSecrets(value: string): string {
  return value
    .replace(ENV_ASSIGNMENT, (match, name: string) =>
      SECRET_NAME_PART.test(name) ? `${name}=<redacted>` : match
    )
    .replace(BEARER_AUTHORIZATION, "$1<redacted>")
}
