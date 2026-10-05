// guard-bash が行の走査で読む heredoc の扱い。受け手が本文を実行しないと確かに分かる heredoc の
// 本文の行だけを差し引く(設計書 2026-10-05 の 4.12.3)。テストから直接呼べるよう、hook の
// エントリポイントから分けて置く

// heredoc の開始(`<<<` の here-string は除く)。fd 番号の付いた形(`0<<EOF`)も受ける。
// 算術の `<<` も開始と読むが、本文を差し引かない向きにだけ働くので区別しない
// 区切り語は、2 番目が単一引用符、3 番目が二重引用符、4 番目がバックスラッシュ、5 番目が語である
export const ANY_HEREDOC_RE =
  /(?<!<)<<(?!<)(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|(\\)?([A-Za-z_]\w*))/g

// heredoc の受け手が本文を実行しないと確かに分かるか。line は開始の行、before はそのうち `<<`
// より前、after は区切り語より後ろ、next は終端の行の次の行である。次をすべて満たすときに限る。
// - 開始の行に `;`・`&`・`|` が無く、heredoc が 1 つだけである
// - 受け手が次のどれかである。受け手のコマンド名を引用符・エスケープ・置換で書いた形は、
//   前の文字が区切りでなくなるので当たらない
//   - git commit の `-F -`・`-F /dev/stdin`
//   - git commit・git tag・gh の `-m`・`--message`・`--body` の引数の `$(cat <<…)`。区切り語の
//     後ろに何も無く、終端の次の行が `)` か `)"` だけである
// `cat > <ファイル>`・`tee <ファイル>` は、プロセス置換や /dev/ の先で実行や書き込みに化けるので外さない
export function isInertHeredoc(
  line: string,
  before: string,
  after: string,
  next: string | undefined
): boolean {
  if (/[;&|]/.test(after) || [...line.matchAll(ANY_HEREDOC_RE)].length !== 1)
    return false
  // 開始の行か終端の次の行が行末のバックスラッシュで終わると、次の行(`| bash` など)へ続くので
  // どの形でも差し引かない
  if (/\\\s*$/.test(line) || /\\\s*$/.test(next ?? "")) return false
  // `<<` より前は許可リストで読む。認めるのは、前段に `git add <パス…> &&` を 1 つだけ置いてよく、
  // 続けて受け手の区間(git commit・git tag・gh)が来る形だけである。記号を足して塞ぐ方式では、
  // `#` のコメントやバックスラッシュで区切りを隠す形が抜けるためである
  const m = before.match(/^\s*(?:git\s+add(?:\s+[\w./-]+)*\s*&&\s*)?(.*)$/s)
  const receiver = m?.[1] ?? ""
  // 受け手の区間の中に、`-m "$(cat` の部分の外で区切り・コメント・エスケープ・引用・置換があれば
  // 差し引かない
  const core = receiver.replace(
    /\s(?:-m|--message|--body)(?:\s+|=)"?\$\(\s*cat\s+$/,
    " "
  )
  if (/[;&|#\\'"`]|\$\(/.test(core)) return false
  const head = receiver.trim().split(/\s+/)
  if (
    !(
      (head[0] === "git" && ["commit", "tag"].includes(head[1] ?? "")) ||
      head[0] === "gh"
    )
  )
    return false
  // 受け手の区間の先頭に固定して読む。`-F -` の形も、区切り語の後ろが空のときに限る
  if (
    /^\s*git\s+commit\b.*\s(?:-F|--file)(?:\s+|=)(?:-|\/dev\/stdin)(?=\s|$)/.test(
      receiver
    )
  )
    return after.trim() === ""
  if (
    /^\s*(?:git\s+(?:commit|tag)\b|gh\s).*\s(?:-m|--message|--body)(?:\s+|=)"?\$\(\s*cat\s+$/.test(
      receiver
    )
  )
    // 終端の次の行は `)` か `)"` で始まり、後ろに `&&`・`;`・`||` で続くコマンドがあってよい。
    // 続きの部分は差し引かず、通常の走査に残る。続きの中に `)`・`"`・`'`・バッククォートがあると、
    // 外側の置換や引用を閉じて別の受け手につなぐ形になりうるので差し引かない
    return (
      after.trim() === "" &&
      /^\s*\)"?\s*(?:$|(?:&&|;|\|\|)[^)"'`]*$)/.test(next ?? "")
    )
  return false
}

// cmd から、受け手が本文を実行しないと確かに分かる heredoc(isInertHeredoc)の本文の行を
// 空行に置き換えて返す。開始の行と終端の行は残す。終端の行が見つからない heredoc と、開始を
// 読めない heredoc は差し引かない(全行の走査を残す)。
export function withoutInertBodies(cmd: string): string {
  const lines = cmd.split("\n")
  // 本文を外すのは、heredoc の開始の行がコマンド全体の 1 行目(先頭の空行を除く)のときに限る。
  // 前の行の継続(`sh -s \`)・行頭の `(`・閉じていない引用符などで、受け手が別のコマンドに
  // なる形を外さないためである
  const firstLine = lines.findIndex((l) => l.trim() !== "")
  for (let i = 0; i < lines.length; i++) {
    const ms = [...lines[i].matchAll(ANY_HEREDOC_RE)]
    if (ms.length === 0) continue
    // 開始の行の heredoc の本文は、開始の順に続く。各本文の終端の行を順に探す
    let k = i
    for (const m of ms) {
      const word = m[2] ?? m[3] ?? m[5]
      const from = k
      k = lines.findIndex(
        (l, j) =>
          j > from && (m[1] === "-" ? l.replace(/^\t+/, "") : l) === word
      )
      // 終端が見つからなければ、ここから後ろは何も差し引かない
      if (k === -1) return lines.join("\n")
    }
    const m = ms[0]
    const at = m.index ?? 0
    // 除外に当たる heredoc だけ本文を空にする。当たらないものは本文を残し、終端の行まで飛ばす。
    // 当たらない heredoc の本文は実行されうるので、中の開始の行を除外の判定にかけない。
    // 区切り語が引用されていない heredoc(`<<EOF`)は外さない。引用の無い区切り語では、bash は
    // 本文の行末のバックスラッシュと改行を結合してから終端を探す。そのため、物理行で探す終端と
    // 食い違いうる。
    // 引用された区切り語でも、引用を外した語が英数字と `_` だけのときに限る。`<<"E\$OF"` では、
    // bash が引用を外して区切り語を `E$OF` とする。引用の中身のままの語で探す終端とは食い違う
    const quoted =
      (m[2] !== undefined || m[3] !== undefined || m[4] !== undefined) &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(m[2] ?? m[3] ?? m[5] ?? "")
    if (
      i === firstLine &&
      quoted &&
      ms.length === 1 &&
      isInertHeredoc(
        lines[i],
        lines[i].slice(0, at),
        lines[i].slice(at + m[0].length),
        lines[k + 1]
      )
    )
      for (let j = i + 1; j < k; j++) lines[j] = ""
    i = k
  }
  return lines.join("\n")
}
