// 正規表現の規則を組み立てる。避ける語は渡された discipline.md の本文の
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
    pattern: /ことが(でき|可能)/u,
    advice:
      "「することができ」は「でき」に、「〜ことができ」は可能形に縮める。否定や過去の活用(できない・できた)は保つ"
  },
  {
    id: "kanten",
    pattern: /という観点(から|で)/u,
    advice: "「〜で見れば」「〜では」に言い換える"
  },
  {
    id: "ni-totte-juyo",
    pattern: /にとって(重要|大切)/u,
    advice: "何が何を決めるのかを、元の文の強さを変えずに書く"
  },
  {
    // 具体物や連体修飾(鍵を持つ、意味を持つ定義)を拾わないよう、3 語と文末に限る
    id: "wo-motsu",
    pattern: /(意味|価値|影響)を持つ(?=。|$)/mu,
    advice: "「〜がある」に言い換える"
  },
  {
    id: "koto-ni-yotte",
    pattern: /ことによって/u,
    advice: "「〜すると」「〜して」に言い換える"
  },
  {
    id: "hoka-naranai",
    pattern: /に(他|ほか)ならない/u,
    advice: "言い切りに直す。元の文に無い因果を足さない"
  },
  {
    id: "dash-insert",
    pattern: /——|――/u,
    advice: "括弧に入れるか、文を分ける"
  }
].map((r) => ({ ...r, category: "翻訳調" }))

// 語がカタカナか漢字で始まるとき、複合語の一部(承認ポイントは)に当たらないようにする
const KATAKANA_OR_KANJI = "[\\u30A0-\\u30FF\\p{sc=Han}]"

function wordPattern(word: string): RegExp {
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

export function buildRules(discipline: string): Rule[] {
  return [...avoidRules(discipline), ...TRANSLATION]
}
