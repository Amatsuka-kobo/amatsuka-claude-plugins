import { expect, test } from "vitest"
import {
  ADR_ENV,
  GOTCHAS_ENV,
  readFeatures
} from "../../../metatron/src/lib/features.js"
import { runScript, tmpdir } from "./helpers/check-intent-env-fixtures.js"

test("knowledgeRecording: 2 変数が未設定なら両方 false", () => {
  expect(runScript(tmpdir()).knowledgeRecording).toStrictEqual({
    adr: false,
    gotchas: false
  })
})

test("knowledgeRecording: 変数ごとに独立して判定する", () => {
  const dir = tmpdir()
  expect(
    runScript(dir, undefined, { AMATSUKA_METATRON_ENABLE_ADR: "1" })
      .knowledgeRecording
  ).toStrictEqual({ adr: true, gotchas: false })
  expect(
    runScript(dir, undefined, { AMATSUKA_METATRON_ENABLE_GOTCHAS: " On " })
      .knowledgeRecording
  ).toStrictEqual({ adr: false, gotchas: true })
})

test("knowledgeRecording: metatron の readFeatures と同じ入力で同じ結果を返す(2 者比較)", () => {
  const dir = tmpdir()
  const values = [undefined, "", " ", "1", "TRUE", " On ", "0", "yes", "off"]
  // 片方を 1 に固定し、もう片方に値域の組を与える(両変数が独立に判定されることも見る)
  const inputs = values.flatMap((v) => [
    [v, "1"],
    ["1", v]
  ])
  for (const [adr, gotchas] of inputs) {
    const extra: Record<string, string> = {}
    if (adr !== undefined) extra[ADR_ENV] = adr
    if (gotchas !== undefined) extra[GOTCHAS_ENV] = gotchas
    expect(
      runScript(dir, undefined, extra).knowledgeRecording,
      JSON.stringify(extra)
    ).toStrictEqual(readFeatures(extra))
  }
})
