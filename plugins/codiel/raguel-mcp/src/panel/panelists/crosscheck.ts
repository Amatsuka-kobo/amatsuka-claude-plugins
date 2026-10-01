/**
 * 鑑識(crosscheck): 成果物の主張を objective・前フェーズの証拠・事実表と突き合わせる。
 * 未達(書いてあるのにやっていない)と逸脱(書いていないのにやっている)の両方を見る。
 * このパネリストはツールを持たないので、ファイルの状態は呼び出し側が決定論で作った事実表で渡す。
 */

import type { Artifact, DiffFile, PanelReport } from "../../core/types.js"
import {
  commonHeader,
  formatArtifact,
  formatObjective,
  formatPriorEvidence,
  frameUntrusted
} from "../prompts.js"
import type { CallControl, JudgeProvider } from "../provider.js"
import { formatRubric, rubricFor } from "../rubrics.js"
import {
  standardPanelResponseSchema,
  toFindings,
  toJsonSchema
} from "../schema.js"

/** 事実表の 1 行の状態。diff から作るものと、本文の参照パスの実在の確認から作るもの */
export type FactState =
  | "new"
  | "deleted"
  | "renamed"
  | "modified"
  | "exists"
  | "missing"

export interface FactRow {
  /** a/・b/ を除いた repoPath 相対のパス */
  path: string
  state: FactState
  /** renamed のときの元のパス */
  oldPath?: string
}

const STATE_LABELS: Record<FactState, string> = {
  new: "新規",
  deleted: "削除",
  renamed: "改名",
  modified: "変更",
  exists: "実在",
  missing: "不在"
}

/**
 * Raguel が組んだ diff の解析結果から事実表の行を作る(所見 A13)。
 * 新規ファイルは変更前の作業ツリーには無いが、「不在」でなく「新規」と書く
 */
export function factRowsFromDiff(files: readonly DiffFile[]): FactRow[] {
  return files.map((f): FactRow => {
    if (f.isNew) return { path: f.path, state: "new" }
    if (f.isDeleted) return { path: f.path, state: "deleted" }
    if (f.isRename)
      return { path: f.path, state: "renamed", oldPath: f.oldPath }
    return { path: f.path, state: "modified" }
  })
}

export function formatFactTable(rows: readonly FactRow[]): string {
  if (rows.length === 0) return "(参照パスなし)"
  return rows
    .map(
      (r) =>
        `${r.path}: ${STATE_LABELS[r.state]}` +
        (r.oldPath ? `(旧: ${r.oldPath})` : "")
    )
    .join("\n")
}

export interface CrosscheckInput {
  artifact: Artifact
  /** 前フェーズの証拠。無ければ初回フェーズとして扱う */
  priorEvidence?: string
  /** 呼び出し側が決定論で作った事実表 */
  facts?: readonly FactRow[]
}

function factSection(facts?: readonly FactRow[]): string {
  if (!facts) {
    return (
      "(事実表なし。決定論的な実在確認は行われていない。成果物内の記述同士の" +
      "内部矛盾のみを確認すること)"
    )
  }
  return frameUntrusted("fact-table", formatFactTable(facts))
}

export async function runCrosscheck(
  input: CrosscheckInput,
  provider: JudgeProvider,
  model: string,
  ctl: CallControl
): Promise<PanelReport> {
  const axes = rubricFor(input.artifact.kind)
  const schema = standardPanelResponseSchema(axes.map((a) => a.key))

  const prompt = [
    commonHeader("鑑識(crosscheck)"),
    "",
    "## 職務",
    "成果物の主張を objective・前フェーズ証拠・事実表と突合し、不整合を洗い出せ。",
    "以下の両方向を必ず確認すること:",
    "- 未達: 計画・主張に書かれているのに、成果物内で実施された形跡がないもの",
    "- 逸脱: 計画・主張に書かれていないのに、成果物内で実施されているもの",
    "事実表の「不在」は参照先が無いことを表す。「新規」はこの変更で作られるファイルで、不在ではない。",
    "",
    "## objective(この成果物が何のためのものか)",
    formatObjective(input.artifact.objective),
    "",
    "## 成果物",
    formatArtifact(input.artifact.content),
    "",
    "## 前フェーズの証拠",
    formatPriorEvidence(input.priorEvidence),
    "",
    "## 事実表(ファイルの状態。決定論で作ったもの)",
    factSection(input.facts),
    "",
    "## ルーブリック(scores はこの軸ごとに付ける)",
    formatRubric(axes),
    "",
    "各 finding は severity(info|ask)・confidence(0-100)・message を含めること。",
    "severity は ask までしか使えない。"
  ].join("\n")

  const response = await provider.invoke(
    {
      role: "crosscheck",
      model,
      prompt,
      schema,
      jsonSchema: toJsonSchema(schema)
    },
    ctl
  )

  return {
    panelist: "crosscheck",
    model,
    findings: toFindings(response.findings, "crosscheck"),
    scores: response.scores
  }
}
