import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import { hook } from "./helpers/guard-bash-fixtures.js"
import {
  cli,
  newProject,
  recordEvaluation,
  SLUG,
  setupRun
} from "./helpers/run-setup.js"

// --- Raguel の設定と記録の保護(Raguel 設計書 §6.13.4。所見 G8・R12) ---

// RAGUEL_CONFIG で Raguel の設定を <root>/raguel.json に置き、casesDir を <root>/cases-store にする。
// 守る 3 種のパス(cwd = root からの相対)と、フックに渡す環境変数を返す。
function raguelEnv(root: string): {
  env: Record<string, string>
  targets: string[]
} {
  const file = path.join(root, "raguel.json")
  fs.writeFileSync(
    file,
    JSON.stringify({
      storage: { casesDir: path.join(root, "cases-store"), projectId: "demo" }
    })
  )
  return {
    env: { RAGUEL_CONFIG: file },
    targets: [
      ".codiel/config.json",
      "raguel.json",
      "cases-store/cases/demo/evaluations.jsonl"
    ]
  }
}

// 書き込みの 8 つの形(リダイレクトは 3 通り)
const WRITE_FORMS = [
  (p: string) => `echo x > ${p}`,
  (p: string) => `echo x >> ${p}`,
  (p: string) => `echo x >${p}`,
  (p: string) => `echo x | tee -a ${p}`,
  (p: string) => `sed -i 's/a/b/' ${p}`,
  (p: string) => `cp /tmp/x ${p}`,
  (p: string) => `mv /tmp/x ${p}`,
  (p: string) => `rm -f ${p}`,
  (p: string) => `dd if=/tmp/x of=${p}`,
  (p: string) => `install -m 644 /tmp/x ${p}`
]

function markAsk(root: string): void {
  cli(root, [
    "mark-ask",
    "intent",
    "--slug",
    SLUG,
    "--evaluation-id",
    recordEvaluation(root, SLUG, "intent", "ASK")
  ])
}

test("R12: active と awaiting_human の run で、3 種のパスへの書き込みの各形は deny になる", () => {
  const active = setupRun()
  const waiting = setupRun()
  markAsk(waiting)
  for (const root of [active, waiting]) {
    const { env, targets } = raguelEnv(root)
    for (const p of targets)
      for (const form of WRITE_FORMS) {
        const r = hook(root, form(p), env)
        expect(r?.permissionDecision, form(p)).toBe("deny")
        expect(r?.permissionDecisionReason).toMatch(/Raguel の設定と記録/)
      }
  }
})

test("R12: run が無ければ、3 種のパスへの書き込みの各形は通す", () => {
  const root = newProject()
  const { env, targets } = raguelEnv(root)
  for (const p of targets)
    for (const form of WRITE_FORMS) expect(hook(root, form(p), env)).toBe(null)
})

test("G8: run の間に config.json の raguel を書き換えて common/secrets を無効化する形は deny", () => {
  const root = setupRun()
  markAsk(root)
  for (const cmd of [
    `jq '.raguel.rules.disabled += ["common/secrets"]' .codiel/config.json > /tmp/c.json && mv /tmp/c.json .codiel/config.json`,
    `sed -i 's/"common\\/secrets"//' .codiel/config.json`,
    "cp /tmp/loose/config.json .codiel",
    "rm -rf .codiel"
  ])
    expect(hook(root, cmd)?.permissionDecision, cmd).toBe("deny")
})

test("守るパスを含むディレクトリの rm・mv と、~・$HOME で書いたパスも deny", () => {
  const root = setupRun()
  const { env } = raguelEnv(root)
  const withHome = { ...env, HOME: root }
  for (const cmd of [
    "rm -rf cases-store",
    "mv cases-store /tmp/moved",
    "cp /tmp/loose/raguel.json .",
    "rm -rf ~/cases-store",
    "echo x > $HOME/cases-store/a",
    "echo x > \\${HOME}/raguel.json"
  ])
    expect(hook(root, cmd, withHome)?.permissionDecision, cmd).toBe("deny")
})

test("閉じていないクォートが残っても、Raguel の設定への書き込みは splitLoosely の語で deny", () => {
  const root = setupRun()
  const unclosedQuote = ["python3<<'EOF'", "it's done", "EOF"].join("\n")
  const r = hook(
    root,
    [unclosedQuote, "echo x > .codiel/config.json"].join("\n")
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("run の間でも、守るパスを読むだけのコマンドと別のパスへの書き込みは通す", () => {
  const root = setupRun()
  const { env } = raguelEnv(root)
  for (const cmd of [
    "cat .codiel/config.json",
    "grep x cases-store/cases/demo/evaluations.jsonl > out.txt",
    "tee out.log < .codiel/config.json",
    "echo x > cases-store2/a",
    "mv a.txt .",
    "cp .codiel/runs/demo/try-1/issue.md /tmp/issue.md",
    "rm -rf build"
  ])
    expect(hook(root, cmd, env), cmd).toBe(null)
})
