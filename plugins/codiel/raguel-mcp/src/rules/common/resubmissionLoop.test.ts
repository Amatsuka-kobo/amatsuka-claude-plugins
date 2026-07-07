import { describe, expect, it } from "vitest"
import { makeArtifact, makeCtx } from "../testHelpers.js"
import {
  computeSubmissionDigest,
  resubmissionLoopRule,
  similarity
} from "./resubmissionLoop.js"

describe("computeSubmissionDigest / similarity", () => {
  it("完全一致は sha256 が一致し類似度 1", () => {
    const a = computeSubmissionDigest("Hello   World", 1, "ASK")
    const b = computeSubmissionDigest("hello world", 2, "ASK")
    expect(a.sha256).toBe(b.sha256) // 空白圧縮 + 小文字化で正規化一致
    expect(similarity(a.shingleHashes, b.shingleHashes)).toBe(1)
  })

  it("語順の入れ替え程度は近似(高い Jaccard 類似度)になる", () => {
    const a = computeSubmissionDigest(
      "デプロイスクリプトを更新してタイムアウトを180秒に延長する",
      1,
      "ASK"
    )
    const b = computeSubmissionDigest(
      "タイムアウトを180秒に延長するためデプロイスクリプトを更新する",
      2,
      "ASK"
    )
    const sim = similarity(a.shingleHashes, b.shingleHashes)
    expect(sim).toBeGreaterThan(0.5)
  })

  it("全く異なる内容は非近似", () => {
    const a = computeSubmissionDigest(
      "認証まわりのバグを修正しました",
      1,
      "ASK"
    )
    const b = computeSubmissionDigest(
      "料金プランのドキュメントを更新しました",
      2,
      "ASK"
    )
    const sim = similarity(a.shingleHashes, b.shingleHashes)
    expect(sim).toBeLessThan(0.3)
  })
})

describe("resubmissionLoopRule", () => {
  it("過去提出がなければ発火しない", () => {
    const findings = resubmissionLoopRule.check(
      makeArtifact({ content: "新しい成果物です" }),
      makeCtx()
    )
    expect(findings).toEqual([])
  })

  it("完全一致の再提出は ask で発火する", () => {
    const prior = computeSubmissionDigest("危険な変更です", 1, "ASK")
    const findings = resubmissionLoopRule.check(
      makeArtifact({ content: "危険な変更です" }),
      makeCtx({}, [prior])
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("ask")
  })

  it("PROCEED 済みの過去提出とは比較しない", () => {
    const prior = computeSubmissionDigest("承認済みの内容です", 1, "PROCEED")
    const findings = resubmissionLoopRule.check(
      makeArtifact({ content: "承認済みの内容です" }),
      makeCtx({}, [prior])
    )
    expect(findings).toEqual([])
  })

  it("stopAfter 回数に到達すると severity が stop に昇格する", () => {
    const content = "同じ危険な変更を何度も出す"
    const priors = [
      computeSubmissionDigest(content, 1, "ASK"),
      computeSubmissionDigest(content, 2, "ASK"),
      computeSubmissionDigest(content, 3, "STOP")
    ]
    const findings = resubmissionLoopRule.check(
      makeArtifact({ content }),
      makeCtx({}, priors)
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe("stop")
  })

  it("similarityThreshold は 0.95 を超えて緩和できない(実測 Jaccard 約0.97のペアで検証)", () => {
    // このペアの Jaccard 類似度は約 0.968。設定通り 0.999 が採用されれば発火しないはずだが、
    // sealed ルールの緩和上限 0.95 にクランプされるため発火する
    const content =
      "The quick brown fox jumps over the lazy dog near the riverbank every single morning without failing"
    const priorContent =
      "The quick brown fox jumps over the lazy dog near the riverbank every single morning without fail"
    const prior = computeSubmissionDigest(priorContent, 1, "ASK")

    const sim = similarity(
      computeSubmissionDigest(content, 0, "ASK").shingleHashes,
      prior.shingleHashes
    )
    expect(sim).toBeGreaterThan(0.95)
    expect(sim).toBeLessThan(0.999)

    const findings = resubmissionLoopRule.check(
      makeArtifact({ content }),
      makeCtx(
        {
          rules: {
            "common/resubmission-loop": { similarityThreshold: 0.999 }
          }
        },
        [prior]
      )
    )
    expect(findings.length).toBeGreaterThan(0)
  })
})
