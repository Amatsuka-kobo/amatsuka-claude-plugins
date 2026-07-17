// 並行テスト用: withRunLock 下で run.json の nextReviewId を count 回インクリメントする。
// vitest からは runTsAsync で複数プロセス同時に起動される。
import { withRunLock } from "../../lock.js"
import { loadRun, saveRun } from "../../run.js"

const [dir, countArg] = process.argv.slice(2)
const count = Number(countArg)
for (let i = 0; i < count; i++) {
  withRunLock(dir, () => {
    const run = loadRun(dir)
    saveRun(dir, { ...run, nextReviewId: run.nextReviewId + 1 })
  })
}
