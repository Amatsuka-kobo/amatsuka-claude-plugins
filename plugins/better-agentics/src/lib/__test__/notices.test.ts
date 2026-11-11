import { describe, expect, it } from "vitest"
import type { Definition } from "../agents"
import type { ConfigState } from "../config"
import { envWarnings, setupNotices } from "../notices"

function def(name: string, role: string): Definition {
  return {
    file: name,
    name,
    role,
    model: undefined,
    effort: undefined,
    tools: undefined,
    toolsFormat: "none",
    whenToInvoke: ""
  }
}

function ok(...roles: string[]): ConfigState {
  return { kind: "ok", config: { disabledRoles: roles as never } }
}

const ABSENT: ConfigState = { kind: "absent" }
const INVALID: ConfigState = {
  kind: "invalid",
  message: ".claude/better-agentics/config.json is not valid JSON",
  raw: "{"
}

describe("envWarnings", () => {
  it.each([
    [{ CLAUDE_CODE_EFFORT_LEVEL: "high" }, "CLAUDE_CODE_EFFORT_LEVEL"],
    [{ CLAUDE_CODE_EFFORT_LEVEL: "auto" }, "CLAUDE_CODE_EFFORT_LEVEL"],
    [
      { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "yes" },
      "CLAUDE_CODE_SUBAGENT_MODEL_FORCE"
    ],
    [{ FORCE_PROMPT_CACHING_5M: "1" }, "FORCE_PROMPT_CACHING_5M"],
    [{ FORCE_PROMPT_CACHING_5M: "true" }, "FORCE_PROMPT_CACHING_5M"],
    [
      { CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: "5m" },
      "CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL"
    ]
  ])("%o では 1 文を出す", (env, name) => {
    const warnings = envWarnings(env, true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(name)
  })

  it.each([
    [{ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "0" }, true],
    [{ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "false" }, true],
    [{ FORCE_PROMPT_CACHING_5M: "1" }, false],
    [{ CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: "5m" }, false],
    [{ CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: "1h" }, true],
    [{ CLAUDE_CODE_SUBAGENT_MODEL: "haiku" }, true],
    [{ CLAUDE_CODE_EFFORT_LEVEL: "" }, true]
  ])("%o(レビューの定義: %s)では出さない", (env, hasReview) => {
    expect(envWarnings(env, hasReview)).toEqual([])
  })
})

describe("setupNotices", () => {
  it("定義が 0 件なら Standard Agent モードの案内だけを出す", () => {
    for (const config of [ABSENT, ok()]) {
      expect(setupNotices({ definitions: [], config })).toEqual([
        "定義の無い役割は Standard Agent モードで委譲する。調整したい役割の定義と、外す役割は better-agentics:setup で決める。"
      ])
    }
  })

  it("定義が 0 件でも設定ファイルが invalid なら作り直しを知らせる", () => {
    const notices = setupNotices({ definitions: [], config: INVALID })
    expect(notices).toHaveLength(2)
    expect(notices[1]).toContain("config.json")
    expect(notices[1]).toContain("better-agentics:setup")
  })

  it("定義があり設定ファイルが無ければ、定義の無い役割を並べて移行を知らせる", () => {
    const notices = setupNotices({
      definitions: [def("code-reviewer", "code-review")],
      config: ABSENT
    })
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("Standard Agent モード")
    expect(notices[0]).toContain("- escalation")
    expect(notices[0]).not.toContain("- code-review")
  })

  it("定義の無い役割が 0 件なら、設定ファイルが無くても移行を知らせない", () => {
    const definitions = [
      "complex-impl",
      "normal-impl",
      "light-impl",
      "general",
      "explore",
      "realtime-research",
      "e2e-verify",
      "escalation",
      "design-review",
      "knowledge-elicitation",
      "code-review",
      "complex-review",
      "adversarial-review"
    ].map((role) => def(`${role}-agent`, role))
    expect(setupNotices({ definitions, config: ABSENT })).toEqual([])
  })

  it("外した役割に定義があれば、役割と定義名を並べる", () => {
    const notices = setupNotices({
      definitions: [def("code-reviewer", "code-review")],
      config: ok("code-review")
    })
    expect(notices.join("\n")).toContain("- code-review: code-reviewer")
  })

  it("review か split の役割をすべて外していれば、止まる委譲の種類を書く", () => {
    const review = setupNotices({
      definitions: [def("a", "normal-impl")],
      config: ok(
        "design-review",
        "knowledge-elicitation",
        "code-review",
        "complex-review",
        "adversarial-review"
      )
    }).join("\n")
    expect(review).toContain("レビュー")
    const split = setupNotices({
      definitions: [def("a", "code-review")],
      config: ok(
        "complex-impl",
        "normal-impl",
        "light-impl",
        "general",
        "explore",
        "realtime-research",
        "e2e-verify"
      )
    }).join("\n")
    expect(split).toContain("分担")
  })

  it("escalation だけを外しても知らせない", () => {
    expect(
      setupNotices({
        definitions: [def("a", "code-review")],
        config: ok("escalation")
      })
    ).toEqual([])
  })

  it("設定ファイルが invalid なら作り直しを知らせる", () => {
    const notices = setupNotices({
      definitions: [def("a", "code-review")],
      config: INVALID
    })
    expect(notices.join("\n")).toContain("config.json")
  })
})
