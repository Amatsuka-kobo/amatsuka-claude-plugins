// 正規表現の規則を組み立てる。避ける語は渡された SKILL.md の本文の
// 「## 避ける語」の表から作り、翻訳調はこのファイルの定義から作る。
// ファイルは読まない。

export interface Rule {
  id: string
  category: string
  pattern: RegExp
  advice: string
}

const AVOID_ADVICE = "語を消して具体的な事実・数値・条件を書く"

// 表の Before は例文で、そこから型を作れないため、型はここに書く
const TRANSLATION: Rule[] = [
  {
    id: "koto-dekiru",
    category: "冗長",
    pattern: /ことが(でき|可能)/u,
    advice:
      "「することができ」は「でき」に、「〜ことができ」は可能形に縮める。否定や過去の活用(できない・できた)は保つ"
  },
  {
    id: "dash-insert",
    category: "翻訳調",
    pattern: /——|――/u,
    advice: "括弧に入れるか、文を分ける"
  }
]

// 語がカタカナか漢字で始まるとき、複合語の一部(承認ポイントは)に当たらないようにする
const KATAKANA_OR_KANJI = "[\\u30A0-\\u30FF\\p{sc=Han}]"

// 先頭と末尾の「〜」は落とす。任意の語句に一致させると、一致が「」の外まで広がるためである
function wordPattern(entry: string): RegExp {
  const word = entry.replace(/^〜+|〜+$/g, "")
  const body = word
    .split("〜")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".{0,30}?")
  const head = new RegExp(`^${KATAKANA_OR_KANJI}`, "u").test(word)
    ? `(?<!${KATAKANA_OR_KANJI})`
    : ""
  return new RegExp(head + body, "u")
}

function avoidRules(discipline: string): Rule[] {
  const section = discipline.split(/^## 避ける語[ \t]*$/m)[1]?.split(/^## /m)[0]
  if (section === undefined) return []
  const rules: Rule[] = []
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue
    const cells = line.split("|").map((c) => c.trim())
    const category = cells[1] ?? ""
    for (const m of (cells[2] ?? "").matchAll(/「([^」]+)」/g)) {
      const word = m[1] ?? ""
      rules.push({
        id: `avoid:${word}`,
        category,
        pattern: wordPattern(word),
        advice: AVOID_ADVICE
      })
    }
  }
  return rules
}

// 慣用の語は違反にしない。before は語の直前、after は語の直後に置く否定の先読み・後読み
const LITERAL_EXCEPTIONS: Record<string, { before?: string; after?: string }> =
  {
    根: {
      before: "(?<!木の)",
      after: "(?!っこ|を張|を下ろ|が深|こそぎ|ざ|に持|も葉も|づ)"
    },
    節: {
      // 数字(間の空白 1 つを許す)の後の「1 節」と、「お節」「かつお節」
      before: "(?<![0-9０-９] ?)(?<!お)",
      after: "(?!々|(?<=その節)(?:は|には)|(?<=[るたいな]節)(?:がある|もある))"
    }
  }

function literalRule(id: string, word: string): Rule {
  const ex = LITERAL_EXCEPTIONS[word]
  // 「2 段目」のように助数表現として続く「目」を許すのは「段」だけにする
  const tail =
    word === "段"
      ? `(?=目|(?!${KATAKANA_OR_KANJI}))`
      : `(?!${KATAKANA_OR_KANJI})`
  return {
    id,
    category: "直訳語",
    pattern: new RegExp(
      `(?<!${KATAKANA_OR_KANJI})${ex?.before ?? ""}${word}${ex?.after ?? ""}${tail}`,
      "u"
    ),
    advice: ""
  }
}

function literalRules(discipline: string): Rule[] {
  const lines = discipline.split("\n")
  const headerIndex = lines.findIndex((line) => {
    if (!line.startsWith("|")) return false
    return line
      .split("|")
      .map((cell) => cell.trim())
      .includes("避ける訳")
  })
  if (headerIndex === -1) return []
  const header = (lines[headerIndex] ?? "")
    .split("|")
    .map((cell) => cell.trim())
  const avoidIndex = header.indexOf("避ける訳")
  const useIndex = header.indexOf("使う訳")
  if (avoidIndex === -1 || useIndex === -1) return []

  // 同じ語が複数の行に出るため、id ごとに 1 本にまとめ、「使う訳」を出現順に集める
  const rules = new Map<string, Rule>()
  const uses = new Map<string, string[]>()
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.startsWith("|")) break
    const cells = line.split("|").map((cell) => cell.trim())
    const avoid = cells[avoidIndex] ?? ""
    const used = cells[useIndex] ?? ""
    const quotedWords = [...avoid.matchAll(/「([^」]+)」/g)].map(
      (match) => match[1] ?? ""
    )
    const words =
      quotedWords.length > 0
        ? quotedWords
        : avoid.split(/[・、]/).map((cell) => cell.trim())
    for (const word of words) {
      if (!/^[゠-ヿ\p{sc=Han}]+$/u.test(word)) continue
      const id = `literal:${word}`
      const prior = uses.get(id)
      if (prior) prior.push(used)
      else uses.set(id, [used])
      if (!rules.has(id)) rules.set(id, literalRule(id, word))
    }
  }
  return [...rules.values()].map((rule) => ({
    ...rule,
    advice: `「使う訳」の列の「${(uses.get(rule.id) ?? []).join(" / ")}」を参考に、文脈に合う語で書く`
  }))
}

export function buildRules(discipline: string): Rule[] {
  return [
    ...avoidRules(discipline),
    ...literalRules(discipline),
    ...TRANSLATION
  ]
}
