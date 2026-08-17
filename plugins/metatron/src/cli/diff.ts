// 行単位の unified diff。stage → commit の 2 段階で「diff を計算せずに書き込むことは
// できない」保証を成り立たせるため、stage が返す diff は CLI が自前で計算する
// (外部ライブラリを追加しない方針のため LCS を直接書く)。

/** これを超える行数の文書は LCS を諦め、セクション単位の before/after に委ねる。 */
export const MAX_DIFF_LINES = 1500

const DEFAULT_CONTEXT = 3

type OpKind = "eq" | "del" | "add"

interface Entry {
  kind: OpKind
  line: string
  /** 1 始まりの旧行番号。追加行では 0。 */
  aNo: number
  /** 1 始まりの新行番号。削除行では 0。 */
  bNo: number
}

export interface UnifiedDiffOptions {
  context?: number
  fromLabel?: string
  toLabel?: string
}

/**
 * unified diff の計算結果。
 *
 * 上限を超えると `unified` は案内文だけになる。案内文を差分と読み違えたまま承認を
 * 求める経路を塞ぐため、省略したことは文字列ではなく `truncated` で返す。
 */
export interface UnifiedDiffResult {
  /** unified 形式の差分。差分が無ければ空文字列。省略時は案内文だけが入る。 */
  unified: string
  /** 上限を超えて差分の計算を諦めたか。 */
  truncated: boolean
  /** 省略した理由。省略していなければ null。 */
  truncatedReason: string | null
  /** 変更前の行数。 */
  beforeLines: number
  /** 変更後の行数。 */
  afterLines: number
  /** 省略の判定に使った上限行数。 */
  maxLines: number
}

function splitLines(text: string): string[] {
  if (text === "") return []
  const unified = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lines = unified.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

// 最長共通部分列を後ろから積み上げ、前から辿って操作列に落とす。
function diffOps(a: string[], b: string[]): Entry[] {
  const n = a.length
  const m = b.length
  const width = m + 1
  const lcs = new Int32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + (j + 1)] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + (j + 1)])
    }
  }

  const entries: Entry[] = []
  let i = 0
  let j = 0
  const push = (kind: OpKind, line: string): void => {
    if (kind === "eq") {
      entries.push({ kind, line, aNo: i + 1, bNo: j + 1 })
    } else if (kind === "del") {
      entries.push({ kind, line, aNo: i + 1, bNo: 0 })
    } else {
      entries.push({ kind, line, aNo: 0, bNo: j + 1 })
    }
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("eq", a[i])
      i++
      j++
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
      push("del", a[i])
      i++
    } else {
      push("add", b[j])
      j++
    }
  }
  while (i < n) {
    push("del", a[i])
    i++
  }
  while (j < m) {
    push("add", b[j])
    j++
  }
  return entries
}

/**
 * unified 形式の差分を計算する。
 * 例外を投げない(差分の表示に失敗しても stage の判断を変えないため)。
 */
export function unifiedDiff(
  beforeText: string,
  afterText: string,
  options: UnifiedDiffOptions = {}
): UnifiedDiffResult {
  const context = options.context ?? DEFAULT_CONTEXT
  const fromLabel = options.fromLabel ?? "a"
  const toLabel = options.toLabel ?? "b"

  const a = splitLines(beforeText)
  const b = splitLines(afterText)
  const base = {
    truncated: false as boolean,
    truncatedReason: null as string | null,
    beforeLines: a.length,
    afterLines: b.length,
    maxLines: MAX_DIFF_LINES
  }
  if (a.length === 0 && b.length === 0) return { ...base, unified: "" }
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    const reason = `行数が上限 ${MAX_DIFF_LINES} を超えたため unified diff を省略した(${a.length} 行 → ${b.length} 行)。sections の before / after から提示すること。`
    return {
      ...base,
      unified: `(差分を省略しました: ${reason})`,
      truncated: true,
      truncatedReason: reason
    }
  }

  const entries = diffOps(a, b)
  const changed = entries.map((e) => e.kind !== "eq")
  if (!changed.includes(true)) return { ...base, unified: "" }

  const hunks: { start: number; end: number }[] = []
  let idx = 0
  while (idx < entries.length) {
    if (!changed[idx]) {
      idx++
      continue
    }
    const start = Math.max(0, idx - context)
    let last = idx
    let k = idx + 1
    while (k < entries.length) {
      if (changed[k]) {
        last = k
        k++
        continue
      }
      let run = k
      while (run < entries.length && !changed[run]) run++
      // 変化と変化の間が短ければ 1 つの hunk にまとめる。
      if (run < entries.length && run - k <= context * 2) {
        k = run
        continue
      }
      break
    }
    const end = Math.min(entries.length - 1, last + context)
    hunks.push({ start, end })
    idx = end + 1
  }

  const out: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`]
  for (const hunk of hunks) {
    const slice = entries.slice(hunk.start, hunk.end + 1)
    let aStart = 0
    let bStart = 0
    let aCount = 0
    let bCount = 0
    for (const entry of slice) {
      if (entry.kind !== "add") {
        if (aStart === 0) aStart = entry.aNo
        aCount++
      }
      if (entry.kind !== "del") {
        if (bStart === 0) bStart = entry.bNo
        bCount++
      }
    }
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`)
    for (const entry of slice) {
      const prefix =
        entry.kind === "eq" ? " " : entry.kind === "del" ? "-" : "+"
      out.push(`${prefix}${entry.line}`)
    }
  }
  return { ...base, unified: out.join("\n") }
}
