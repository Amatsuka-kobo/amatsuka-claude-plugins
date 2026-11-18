import fs from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"
import {
  hook,
  MARKER,
  NO_MARKER_COMMENT
} from "./helpers/guard-bash-fixtures.js"
import { setupRun, setupRunAtPr } from "./helpers/run-setup.js"

// --- gh の起動を分けるのはコマンドの区切りとコマンド置換の境界だけ(M2-FX3-AR の high、決定 69) ---

test("本文の値のコマンド置換に gh があっても、外側の投稿の本文を検査する", () => {
  const root = setupRun()
  for (const command of [
    'gh pr comment 1 --body "$(gh pr view 2 --json body -q .body)"',
    'gh pr comment 1 -b "$(gh api repos/o/r/pulls/2 -q .body)"',
    'gh pr comment 1 -b "`gh pr view 2 --json body -q .body`"'
  ])
    expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("クォートの中のコマンド置換の gh の投稿も、別の起動として検査する", () => {
  const root = setupRun()
  const r = hook(root, 'echo "$(gh pr comment 1 --body nomarker)"')
  expect(r?.permissionDecision).toBe("deny")
})

test('eval "gh …" の中の投稿も、マーカーが無ければ deny', () => {
  const root = setupRun()
  const r = hook(root, 'eval "gh pr comment 1 --body nomarker"')
  expect(r?.permissionDecision).toBe("deny")
})

test("クォートの中に書いた gh の使用例では起動を分けず、投稿を 1 つと数える", () => {
  const root = setupRun()
  for (const command of [
    `gh pr comment 1 --body "${MARKER} 再現: gh pr comment 2 --body x"`,
    `gh pr comment 1 --body "${MARKER}\n再現:\ngh pr comment 2 --body x"`
  ])
    expect(hook(root, command)).toBe(null)
})

// --- フラグはクォートを外した独立の語だけで読む(M2-FX3-AR の medium) ---

test("クォートの中の --web・-w・-webkit- はフラグと読まず、手順どおりの PR 作成を通す", () => {
  const root = setupRunAtPr()
  fs.writeFileSync(path.join(root, "pr-body.md"), `本文\n${MARKER}\n`)
  for (const title of [
    "feat: CLI に --web オプションを足す",
    "fix: -w フラグの既定値",
    "fix: -webkit- 接頭辞を消す",
    "docs: use -b flag"
  ])
    expect(
      hook(
        root,
        `gh pr create --label codiel --title "${title}" --body-file pr-body.md`
      )
    ).toBe(null)
})

test("クォートの中の -F を本文ファイルと読まず、--body-file のファイルを検査する", () => {
  const root = setupRunAtPr()
  fs.writeFileSync(path.join(root, "good.md"), `本文\n${MARKER}\n`)
  fs.writeFileSync(path.join(root, "bad.md"), "本文だけ\n")
  const r = hook(root, 'gh pr create --title "x -F good.md" --body-file bad.md')
  expect(r?.permissionDecision).toBe("deny")
})

// --- 本文のフラグを繰り返したときは、すべての値を検査する(M2-FX3-AR の medium) ---

test("本文のフラグを繰り返したときは、1 つでもマーカーが無いか読めなければ deny", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "good.md"), `本文\n${MARKER}\n`)
  fs.writeFileSync(path.join(root, "bad.md"), "本文だけ\n")
  for (const command of [
    "gh pr comment 1 -F good.md -F bad.md",
    "gh pr comment 1 --body-file good.md --body-file missing.md",
    `gh pr comment 1 --body "${MARKER}" --body "no marker"`,
    `gh pr comment 1 -b "${MARKER}" -F bad.md`,
    `gh api repos/o/r/issues/1/comments -f body="${MARKER}" -f body="no marker"`
  ])
    expect(hook(root, command)?.permissionDecision).toBe("deny")
  expect(hook(root, `gh pr comment 1 -b "${MARKER} a" -b "${MARKER} b"`)).toBe(
    null
  )
  expect(
    hook(
      root,
      `gh api repos/o/r/pulls/1/reviews -f event=COMMENT -f 'comments[][body]=${MARKER} a' -f 'comments[][body]=${MARKER} b'`
    )
  ).toBe(null)
})

test("gh api の -X を繰り返したときは、最後のメソッドで本文の有無を判定する", () => {
  const root = setupRun()
  const r = hook(
    root,
    "gh api -X GET -X POST repos/o/r/issues/1/comments -f body=nomarker"
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("本文ファイルの書き換えの検出は、繰り返した本文のフラグのすべてのパスに当てる", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "a.md"), `本文\n${MARKER}\n`)
  fs.writeFileSync(path.join(root, "b.md"), `本文\n${MARKER}\n`)
  const r = hook(root, "cp t.md b.md && gh pr comment 1 -F a.md -F b.md")
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain("Write ツール")
})

// --- フェーズの制限を gh の起動の解析で判定する(M2-FX3-AR の medium) ---

test("フェーズの制限は、-R・--repo を置いた gh pr create・gh issue create も捕まえる", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "good.md"), `本文\n${MARKER}\n`)
  for (const command of [
    "gh -R o/r pr create --title t --body-file good.md",
    "gh pr -R o/r create --title t --body-file good.md",
    "gh --repo o/r issue create --title t --body-file good.md",
    "gh issue -R o/r create --title t --body-file good.md"
  ]) {
    const r = hook(root, command)
    expect(r?.permissionDecision).toBe("deny")
    expect(r?.permissionDecisionReason).toContain("フェーズ")
  }
})

test("コミットメッセージに書いた gh pr create・gh issue create は、フェーズの制限に掛けない", () => {
  const root = setupRun()
  const heredoc = [
    "git commit -m \"$(cat <<'EOF'",
    "fix(guard): gh pr create の --web を塞ぐ",
    "EOF",
    ')"'
  ].join("\n")
  for (const command of [
    heredoc,
    'git commit -m "fix: gh issue create の -T を塞ぐ"'
  ])
    expect(hook(root, command)).toBe(null)
})

// --- 終端の語をクォートしない heredoc の本文のコマンド置換(M2-FX3-AR の medium) ---

test("終端の語をクォートしない heredoc は、本文のコマンド置換の中の gh の投稿を検査する", () => {
  const root = setupRun()
  for (const subst of [`$(${NO_MARKER_COMMENT})`, `\`${NO_MARKER_COMMENT}\``])
    expect(
      hook(root, ["cat <<EOF", subst, "EOF"].join("\n"))?.permissionDecision
    ).toBe("deny")
  // 終端の語をクォートした heredoc の本文は bash が展開しないので、読み飛ばす。
  for (const start of ["cat <<'EOF'", 'cat <<"EOF"'])
    expect(
      hook(root, [start, `$(${NO_MARKER_COMMENT})`, "EOF"].join("\n"))
    ).toBe(null)
})

test("終端の語の直後に語の区切り以外が続く <<EOF-X は heredoc の開始と見なさず、後の行を検査する", () => {
  const root = setupRun()
  const command = ["cat <<EOF-X", "EOF-X", NO_MARKER_COMMENT, "EOF"].join("\n")
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

// --- heredoc の開始の書き方の揺れと、閉じていないクォートの読み直し(M2-FX4-AR の high、決定 69) ---

test("空白ありや空白を詰めた heredoc の本文に対になっていないクォートがあっても、後ろの gh の投稿を検査する", () => {
  const root = setupRun()
  const commitThenComment = (start: string) =>
    [
      `git commit -m "$(${start}`,
      "fix: don't skip",
      "EOF",
      `)" && ${NO_MARKER_COMMENT}`
    ].join("\n")
  const noteThenComment = (start: string, word = "EOF") =>
    [start, "it's done", word, NO_MARKER_COMMENT].join("\n")
  for (const command of [
    commitThenComment("cat << 'EOF'"),
    noteThenComment("cat > notes.txt << 'EOF'"),
    commitThenComment("cat<<'EOF'"),
    noteThenComment("cat <<\\EOF"),
    noteThenComment("cat << EOF"),
    noteThenComment('cat << "EOF"'),
    noteThenComment("cat <<'END-OF-MSG'", "END-OF-MSG")
  ]) {
    const r = hook(root, command)
    expect(r?.permissionDecision).toBe("deny")
    expect(r?.permissionDecisionReason).toContain("gh pr comment の本文")
  }
})

test("空白ありの heredoc の本文の後ろの gh pr create は、フェーズの制限で deny", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "good.md"), `本文\n${MARKER}\n`)
  const command = [
    "git commit -m \"$(cat << 'EOF'",
    "fix: don't",
    "EOF",
    ')" && gh pr create --title t --body-file good.md'
  ].join("\n")
  const r = hook(root, command)
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain("pr フェーズ")
})

test("空白ありなどの heredoc で gh の使用例を書いたコミットメッセージは、phase intent でも通る", () => {
  const root = setupRun()
  const commit = (start: string, line: string, word = "EOF") =>
    [`git commit -m "$(${start}`, line, word, ')"'].join("\n")
  for (const command of [
    commit("cat << 'EOF'", "feat: gh pr create の --fill を塞ぐ"),
    commit("cat<<'EOF'", "fix: don't run gh issue create here"),
    commit("cat <<\\EOF", "fix: gh pr create -T を塞ぐ"),
    commit(
      "cat <<'END-OF-MSG'",
      "docs: it's gh issue create --web",
      "END-OF-MSG"
    )
  ])
    expect(hook(root, command)).toBe(null)
})

test("空白ありの heredoc で本文を渡す投稿は、本文に書いた gh の使用例を別の投稿と数えない", () => {
  const root = setupRun()
  const command = [
    "gh pr comment 12 --body \"$(cat << 'EOF'",
    MARKER,
    "再現: gh pr comment 2 --body x",
    "EOF",
    ')"'
  ].join("\n")
  expect(hook(root, command)).toBe(null)
})

test("空白を詰めた cat<<EOF も heredoc の開始と見なし、本文の行を gh の起動と読まない", () => {
  const root = setupRun()
  const r = hook(root, ["cat<<EOF", NO_MARKER_COMMENT, "EOF"].join("\n"))
  expect(r).toBe(null)
})

test("算術の展開 $(( … )) の中の << は、空白や識別子の後でも heredoc の開始と見なさない", () => {
  const root = setupRun()
  for (const [first, word] of [
    ["n=$(( x << y ))", "y"],
    ["n=$(( 1 <<b ))", "b"]
  ])
    expect(
      hook(root, [first, NO_MARKER_COMMENT, word].join("\n"))
        ?.permissionDecision
    ).toBe("deny")
})

test("字句解析が閉じていないクォートを残したときは、空白で区切る方式で gh の起動を探し直して検査する", () => {
  const root = setupRun()
  for (const command of [
    // クォートしない語に - を含む終端は heredoc の開始と見なさない。
    ["cat <<END-OF-MSG", "it's done", "END-OF-MSG", NO_MARKER_COMMENT].join(
      "\n"
    ),
    // 終端の語と ) を同じ行に書くと、終端の行が見つからない。
    [
      "git commit -m \"$(cat <<'EOF'",
      "fix: don't skip",
      `EOF)" && ${NO_MARKER_COMMENT}`
    ].join("\n")
  ]) {
    const r = hook(root, command)
    expect(r?.permissionDecision).toBe("deny")
    expect(r?.permissionDecisionReason).toContain("gh pr comment の本文")
  }
})

// --- -c の引数の中を読み直すのはシェルの -c と eval だけ(M2-FX4-AR の medium) ---

test("シェルでないコマンドの -c の値は読み直さず、grep -c・rg -c の検索を phase intent で通す", () => {
  const root = setupRun()
  for (const command of [
    'grep -c "gh pr create" plugins/codiel/skills/orchestrating-runs/SKILL.md',
    'grep -rc "gh pr create" plugins/codiel/skills',
    "rg -c 'gh issue create' plugins/"
  ])
    expect(hook(root, command)).toBe(null)
})

test("前置や結合したフラグのあるシェルの -c の引数の中の投稿も、マーカーが無ければ deny", () => {
  const root = setupRun()
  for (const command of [
    'env X=1 bash -lc "gh pr comment 1 --body nomarker"',
    "sudo sh -c 'gh pr comment 1 --body nomarker'",
    '/bin/zsh -c "gh pr comment 1 --body nomarker"'
  ])
    expect(hook(root, command)?.permissionDecision).toBe("deny")
})

// --- 字句解析が閉じていないクォートを残したとき、代入の形の gh の起動を見つける(M2-FX5-AR の medium) ---

test("閉じていないクォートを残す入力(数字直後の << で heredoc と見なさない python3<<'EOF')の後ろの代入の形(url=$(gh …)、url=`gh …`)も見つけて検査する", () => {
  const root = setupRun()
  // <<'EOF' の直前は python3 の 3(数字)なので heredoc の開始と見なさず、
  // 本文の対になっていない ' が字句解析を閉じていない状態のまま終わらせる。
  const unclosedQuote = ["python3<<'EOF'", "it's done", "EOF"].join("\n")
  for (const assignment of [
    "url=$(gh pr comment 1 --body x)",
    "url=`gh pr comment 1 --body x`"
  ])
    expect(
      hook(root, [unclosedQuote, assignment].join("\n"))?.permissionDecision
    ).toBe("deny")
})

test("閉じていないクォートを残す入力の後ろの PR=$(gh pr create …) も、フェーズの制限で deny", () => {
  const root = setupRun()
  const unclosedQuote = ["python3<<'EOF'", "it's done", "EOF"].join("\n")
  const r = hook(
    root,
    [unclosedQuote, "PR=$(gh pr create --title t --body-file good.md)"].join(
      "\n"
    )
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("フォールバックした gh api の -f body=<マーカー無し> は、代入の除去で body= キーを失わず deny(M2-E-R)", () => {
  const root = setupRun()
  const unclosedQuote = ["python3<<'EOF'", "it's done", "EOF"].join("\n")
  const r = hook(
    root,
    [unclosedQuote, "gh api repos/o/r/issues/1/comments -f body=hello"].join(
      "\n"
    )
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("フォールバックした gh api の -F body=@<マーカー無しファイル> も、代入の除去でパスを失わず deny(M2-E-R)", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "nomark.md"), "本文だけ\n")
  const unclosedQuote = ["python3<<'EOF'", "it's done", "EOF"].join("\n")
  const r = hook(
    root,
    [
      unclosedQuote,
      "gh api repos/o/r/issues/1/comments -F body=@nomark.md"
    ].join("\n")
  )
  expect(r?.permissionDecision).toBe("deny")
})

test('フォールバックした += の代入(x+=$(gh …)、arr+=("$(gh …)"))も見つけて検査する(M2-E-AR)', () => {
  const root = setupRun()
  const unclosedQuote = ["python3<<'EOF'", "it's done", "EOF"].join("\n")
  for (const assignment of [
    "x+=$(gh pr comment 1 --body nomarker)",
    'arr+=("$(gh pr comment 1 --body nomarker)")'
  ])
    expect(
      hook(root, [unclosedQuote, assignment].join("\n"))?.permissionDecision
    ).toBe("deny")
})

test('フォールバックした echo "url=$(gh …)" のように引用符が代入より前にある形も見つけて検査する(M2-E-AR)', () => {
  const root = setupRun()
  const unclosedQuote = ["python3<<'EOF'", "it's done", "EOF"].join("\n")
  const r = hook(
    root,
    [unclosedQuote, 'echo "url=$(gh pr comment 1 --body nomarker)"'].join("\n")
  )
  expect(r?.permissionDecision).toBe("deny")
})
