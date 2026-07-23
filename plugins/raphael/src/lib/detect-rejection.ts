import type { InfectionDetails, RaphaelStateV1 } from "./types.js"

interface RejectionPattern {
  id: string
  source: string
  flags?: string
}

const BUILTIN_PATTERNS: readonly RejectionPattern[] = [
  { id: "ja-not-that", source: "そう(じゃない|ではない)" },
  { id: "ja-wrong-target", source: "(それ|そこ)(じゃない|ではない)" },
  {
    id: "ja-not-intended",
    source: "(意図|お願いしたこと|頼んだこと)と(違う|異なる)"
  },
  { id: "ja-restore", source: "(元に)?戻して" },
  { id: "ja-cancel", source: "(取り消して|取り消しにして)" },
  { id: "ja-redo", source: "(やり直して|最初からやって)" },
  { id: "ja-misunderstood", source: "(勘違いしている|誤解している)" },
  {
    id: "ja-dont-change",
    source: "(勝手に変えないで|そこは変えないで)"
  },
  { id: "ja-no", source: "^(いや|いえ)[、,。!！\\s]" },
  {
    id: "ja-wrong",
    source: "^(違う|違います|違いますね|違います。)(?:[、,。!！\\s]|$)"
  },
  {
    id: "en-thats-wrong",
    source: "\\b(that(?:'s| is) wrong|that(?:'s| is) not right)\\b",
    flags: "i"
  },
  {
    id: "en-not-requested",
    source: "\\b(not what i (asked|requested|meant|wanted))\\b",
    flags: "i"
  },
  {
    id: "en-revert-that",
    source: "\\b(revert|undo|roll back) (that|this|the last change)\\b",
    flags: "i"
  },
  {
    id: "en-redo",
    source: "\\b(start over|do it again|try again)\\b",
    flags: "i"
  },
  {
    id: "en-misunderstood",
    source: "\\b(you misunderstood|you misread)\\b",
    flags: "i"
  },
  {
    id: "en-dont-change",
    source: "\\b(do not|don't) change (that|this)\\b",
    flags: "i"
  },
  { id: "en-no", source: "^(no|nope)[,.:;!\\s]", flags: "i" },
  {
    id: "en-wrong",
    source: "^(wrong|incorrect)[,.:;!\\s]",
    flags: "i"
  },
  {
    id: "en-imperative-revert",
    source: "^(please\\s+)?(revert|undo|roll back)(?:[\\s,.!]|$)",
    flags: "i"
  }
]

type RejectionDetails = Extract<InfectionDetails, { type: "user-rejection" }>
type PreviousTool = RaphaelStateV1["last_tool"] extends infer LastTool
  ? Exclude<LastTool, null> extends {
      tool: infer Tool
      input_digest: infer Digest
    }
    ? { tool: Tool; input_digest: Digest }
    : never
  : never

export function detectUserRejection(
  prompt: string,
  additionalPatterns: readonly string[] = [],
  previousTool: PreviousTool | null = null
): RejectionDetails | null {
  const normalized = normalizePrompt(prompt)
  if (startsWithXmlLikeTag(normalized)) return null

  for (const pattern of BUILTIN_PATTERNS) {
    if (new RegExp(pattern.source, pattern.flags).test(normalized)) {
      return rejectionDetails(prompt, pattern.id, previousTool)
    }
  }

  for (const source of additionalPatterns) {
    try {
      if (new RegExp(source, "iu").test(normalized))
        return rejectionDetails(prompt, source, previousTool)
    } catch {
      // Invalid config regexes are skipped independently.
    }
  }
  return null
}

function normalizePrompt(prompt: string): string {
  return prompt.normalize("NFKC").replace(/\s+/gu, " ").trimStart()
}

function startsWithXmlLikeTag(prompt: string): boolean {
  return /^<[A-Za-z][A-Za-z0-9:_-]*(?:\s[^>]*)?>/.test(prompt)
}

function rejectionDetails(
  prompt: string,
  matchedPattern: string,
  previousTool: PreviousTool | null
): RejectionDetails {
  return {
    type: "user-rejection",
    prompt_excerpt: prompt.slice(0, 1_000),
    matched_pattern: matchedPattern,
    previous_tool: previousTool
  }
}
