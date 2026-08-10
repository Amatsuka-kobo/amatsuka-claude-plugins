import { describe, expect, it } from "vitest"
import { generateHtml } from "../generate-report.js"

const output = {
  exit_reason: "all_passed (iteration 2)",
  original_description: "the original",
  best_description: "the best",
  best_score: "7/8",
  best_train_score: "11/12",
  best_test_score: "7/8",
  final_description: "the best",
  iterations_run: 2,
  holdout: 0.4,
  train_size: 12,
  test_size: 8,
  history: [
    {
      iteration: 1,
      description: "the original",
      train_passed: 9,
      train_failed: 3,
      train_total: 12,
      train_results: [
        {
          query: "a query",
          should_trigger: true,
          trigger_rate: 0,
          triggers: 0,
          runs: 3,
          pass: false
        }
      ],
      test_passed: 5,
      test_failed: 3,
      test_total: 8,
      test_results: [],
      passed: 9,
      failed: 3,
      total: 12,
      results: []
    }
  ]
}

describe("generateHtml", () => {
  it("反復ごとのスコアを出す", () => {
    const html = generateHtml(output, false, "my-skill")
    expect(html).toContain("my-skill")
    expect(html).toContain("11/12")
    expect(html).toContain("7/8")
    expect(html).toContain("a query")
  })

  it("autoRefresh のとき meta refresh を入れる", () => {
    expect(generateHtml(output, true, "my-skill")).toContain(
      'http-equiv="refresh"'
    )
    expect(generateHtml(output, false, "my-skill")).not.toContain(
      'http-equiv="refresh"'
    )
  })

  it("description、query、skillName の HTML 特殊文字を escape する", () => {
    const withSpecialCharacters = {
      ...output,
      best_description: 'use & "quotes" <script>alert(1)</script>',
      history: [
        {
          ...output.history[0],
          train_results: [
            {
              ...output.history[0].train_results[0],
              query: 'query & "quotes" <tag>'
            }
          ]
        }
      ]
    }
    const html = generateHtml(withSpecialCharacters, false, 'my & "skill"')
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain(
      "use &amp; &quot;quotes&quot; &lt;script&gt;alert(1)&lt;/script&gt;"
    )
    expect(html).toContain("query &amp; &quot;quotes&quot; &lt;tag&gt;")
    expect(html).toContain("my &amp; &quot;skill&quot;")
  })

  it("autoRefresh 中は未確定のスコアと最良 description の見出しをマスクする", () => {
    const html = generateHtml(output, true, "my-skill")
    expect(html).toContain("<strong>Current best:</strong>")
    expect(html).toContain("<strong>Best Score:</strong> in progress")
    expect(html).toContain("<strong>Best Train Score:</strong> in progress")
    expect(html).toContain("<strong>Best Test Score:</strong> in progress")
  })

  it("autoRefresh でなければ確定したスコアと通常の見出しを出す", () => {
    const html = generateHtml(output, false, "my-skill")
    expect(html).toContain("<strong>Best:</strong>")
    expect(html).toContain("<strong>Best Score:</strong> 7/8 (test)")
    expect(html).toContain("<strong>Best Train Score:</strong> 11/12")
    expect(html).toContain("<strong>Best Test Score:</strong> 7/8")
  })
})
