import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import {
  hook,
  MARKER,
  NO_MARKER_COMMENT,
  writeV1Run
} from "./helpers/guard-bash-fixtures.js"
import {
  setupRun,
  setupRunAtImplement,
  setupRunAtPr,
  setupRunAtTriage
} from "./helpers/run-setup.js"

// --- v1 の active run だけがあるとき、guard-bash の制限は run 無しと同じ ---

test("v1 の active run だけがあるとき、guard-bash の制限は掛からない(run 無しと同じ)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  writeV1Run(root)
  const r = hook(root, "gh issue create -t x")
  expect(r).toBe(null)
})

// --- 投稿する本文のマーカー(設計書 §6.8) ---

const MARKED_COMMAND_SETUPS: Record<string, () => string> = {
  "gh issue create -t x": setupRunAtTriage,
  "gh issue comment 1": setupRun,
  "gh issue edit 1": setupRun,
  "gh pr create --label codiel": setupRunAtPr,
  "gh pr comment 1": setupRun,
  "gh pr edit 1": setupRun,
  "gh pr review 1": setupRun
}

for (const [base, setup] of Object.entries(MARKED_COMMAND_SETUPS)) {
  test(`${base} --body はマーカーがあれば通る`, () => {
    const root = setup()
    const r = hook(root, `${base} --body "本文 ${MARKER}"`)
    expect(r).toBe(null)
  })

  test(`${base} -b はマーカーが無ければ deny`, () => {
    const root = setup()
    const r = hook(root, `${base} -b "本文だけ"`)
    expect(r?.permissionDecision).toBe("deny")
  })
}

test("gh issue comment -b はマーカーがあれば通る", () => {
  const root = setupRun()
  const r = hook(root, `gh issue comment 1 -b "本文 ${MARKER}"`)
  expect(r).toBe(null)
})

test("gh issue comment --body はマーカーが無ければ deny", () => {
  const root = setupRun()
  const r = hook(root, 'gh issue comment 1 --body "本文だけ"')
  expect(r?.permissionDecision).toBe("deny")
})

test("--body の本文が heredoc で複数行でも、マーカーがあれば通る", () => {
  const root = setupRun()
  const command = [
    "gh issue comment 1 --body \"$(cat <<'EOF'",
    "本文1行目",
    MARKER,
    NO_MARKER_COMMENT,
    "EOF",
    ')"'
  ].join("\n")
  const r = hook(root, command)
  expect(r).toBe(null)
})

// --- heredoc の本文の行を gh の起動と見なさない(M2-AR の low、決定 64 関連の修正) ---

test("git commit メッセージの heredoc に書かれた gh の使い方は gh の起動と誤認しない", () => {
  const root = setupRun()
  const command = [
    "git commit -m \"$(cat <<'EOF'",
    "gh pr comment 1 --body-file tmp.md",
    "EOF",
    ')"'
  ].join("\n")
  const r = hook(root, command)
  expect(r).toBe(null)
})

test("bash <<EOF の中で実際に gh を起動する投稿はマーカーが無くても見逃す(既知の限界)", () => {
  const root = setupRun()
  const command = [
    "bash <<EOF",
    'gh pr comment 1 --body "no marker"',
    "EOF"
  ].join("\n")
  const r = hook(root, command)
  expect(r).toBe(null)
})

test("gh pr comment --body-file はファイルの中身にマーカーがあれば通る", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "body.md"), `本文\n${MARKER}\n`)
  const r = hook(root, "gh pr comment 1 --body-file body.md")
  expect(r).toBe(null)
})

test("gh pr edit -F はファイルの中身にマーカーが無ければ deny", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "body.md"), "本文だけ\n")
  const r = hook(root, "gh pr edit 1 -F body.md")
  expect(r?.permissionDecision).toBe("deny")
})

test("--body-file のファイルが読めなければ deny", () => {
  const root = setupRun()
  const r = hook(root, "gh issue edit 1 --body-file missing.md")
  expect(r?.permissionDecision).toBe("deny")
})

test("--body-file - は標準入力を検査できないため deny", () => {
  const root = setupRun()
  const r = hook(root, "gh issue comment 1 --body-file -")
  expect(r?.permissionDecision).toBe("deny")
})

test("-F - は標準入力を検査できないため deny", () => {
  const root = setupRun()
  const r = hook(root, "gh pr comment 1 -F -")
  expect(r?.permissionDecision).toBe("deny")
})

test("gh pr review --approve は本文を持たないため通る", () => {
  const root = setupRun()
  const r = hook(root, "gh pr review 1 --approve")
  expect(r).toBe(null)
})

test("gh issue edit --add-label bug は本文を持たないため通る", () => {
  const root = setupRun()
  const r = hook(root, "gh issue edit 1 --add-label bug")
  expect(r).toBe(null)
})

test("active run が無いときは、本文にマーカーが無くても通る", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const r = hook(root, 'gh issue comment 1 --body "マーカー無し"')
  expect(r).toBe(null)
})

// --- 本文フラグの書き方の揺れ(M2-AR の medium) ---

test("短いフラグに値を連結した -b でも、マーカーが無ければ deny", () => {
  const root = setupRun()
  const r = hook(root, 'gh pr comment 1 -b"no marker"')
  expect(r?.permissionDecision).toBe("deny")
})

test("短いフラグに値を連結した -F でも、ファイルにマーカーが無ければ deny", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "body.md"), "本文だけ\n")
  const r = hook(root, "gh pr comment 1 -Fbody.md")
  expect(r?.permissionDecision).toBe("deny")
})

test("--body-file のパスがクォートで囲まれていても、中身にマーカーがあれば通る", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "body.md"), `本文\n${MARKER}\n`)
  const r = hook(root, 'gh pr comment 1 --body-file "body.md"')
  expect(r).toBe(null)
})

test("object と action の間に -R <repo> があっても、マーカーが無ければ deny", () => {
  const root = setupRun()
  const r = hook(root, "gh pr -R o/r comment 1 --body nomarker")
  expect(r?.permissionDecision).toBe("deny")
})

test('bash -c "gh …" の中の投稿も、マーカーが無ければ deny', () => {
  const root = setupRun()
  const r = hook(root, 'bash -c "gh pr comment 1 --body nomarker"')
  expect(r?.permissionDecision).toBe("deny")
})

test("$(gh …) の中の投稿も、マーカーが無ければ deny", () => {
  const root = setupRun()
  const r = hook(root, "echo $(gh pr comment 1 --body nomarker)")
  expect(r?.permissionDecision).toBe("deny")
})

// --- gh api で送る本文のマーカー(決定 53。§6.8 の 7 コマンドの外) ---

test("gh api の -f body= はマーカーが無ければ deny(PR の行コメント)", () => {
  const root = setupRun()
  const r = hook(
    root,
    'gh api repos/o/r/pulls/1/comments -f body="no marker" -f path=a -F line=1'
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("gh api の -f body= はマーカーがあれば通る", () => {
  const root = setupRun()
  const r = hook(
    root,
    `gh api repos/o/r/pulls/1/comments -f body="本文 ${MARKER}" -f path=a -F line=1`
  )
  expect(r).toBe(null)
})

test("gh api の -X PATCH --raw-field body= はマーカーが無ければ deny", () => {
  const root = setupRun()
  const r = hook(
    root,
    "gh api -X PATCH repos/o/r/issues/comments/1 --raw-field body=nomarker"
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("gh api の --field=body= はマーカーが無ければ deny", () => {
  const root = setupRun()
  const r = hook(
    root,
    "gh api repos/o/r/issues/1/comments --field=body=nomarker"
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("gh api の入れ子の comments[][body] もマーカーが無ければ deny", () => {
  const root = setupRun()
  const r = hook(
    root,
    "gh api repos/o/r/pulls/1/reviews -f event=COMMENT -f 'comments[][body]=nomarker' -f 'comments[][path]=a'"
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("gh api の -F body=@<パス> はファイルにマーカーがあれば通り、無ければ deny", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "ok.md"), `本文\n${MARKER}\n`)
  fs.writeFileSync(path.join(root, "ng.md"), "本文だけ\n")
  expect(hook(root, "gh api repos/o/r/issues/1/comments -F body=@ok.md")).toBe(
    null
  )
  expect(
    hook(root, "gh api repos/o/r/issues/1/comments -F body=@ng.md")
      ?.permissionDecision
  ).toBe("deny")
})

test("gh api の -F body=@- は標準入力を検査できないため deny", () => {
  const root = setupRun()
  const r = hook(root, "gh api repos/o/r/issues/1/comments -F body=@-")
  expect(r?.permissionDecision).toBe("deny")
})

test("gh api の --input は body のキーを持つファイルにマーカーが無ければ deny、あれば通る", () => {
  const root = setupRun()
  fs.writeFileSync(
    path.join(root, "ng.json"),
    JSON.stringify({ event: "COMMENT", body: "本文だけ" })
  )
  fs.writeFileSync(
    path.join(root, "ok.json"),
    JSON.stringify({ event: "COMMENT", body: `本文 ${MARKER}` })
  )
  expect(
    hook(root, "gh api repos/o/r/pulls/1/reviews --input ng.json")
      ?.permissionDecision
  ).toBe("deny")
  expect(hook(root, "gh api repos/o/r/pulls/1/reviews --input ok.json")).toBe(
    null
  )
})

test("gh api の --input - は標準入力を検査できないため deny", () => {
  const root = setupRun()
  const r = hook(root, "gh api repos/o/r/pulls/1/reviews --input -")
  expect(r?.permissionDecision).toBe("deny")
})

test("gh api の --input で body のキーを持たない更新(ラベルだけ)は通る", () => {
  const root = setupRun()
  fs.writeFileSync(
    path.join(root, "labels.json"),
    JSON.stringify({ labels: ["bug"] })
  )
  const r = hook(
    root,
    "gh api -X PUT repos/o/r/issues/1/labels --input labels.json"
  )
  expect(r).toBe(null)
})

test("gh api の読み取りとラベルだけの更新は通る", () => {
  const root = setupRun()
  expect(hook(root, "gh api repos/o/r/pulls/1/comments")).toBe(null)
  expect(hook(root, "gh api repos/o/r/issues/1/labels -f 'labels[]=bug'")).toBe(
    null
  )
  expect(hook(root, "gh api -X GET search/issues -f q=is:open")).toBe(null)
})

test("active run が無いときは、gh api の本文にマーカーが無くても通る", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const r = hook(root, "gh api repos/o/r/issues/1/comments -f body=nomarker")
  expect(r).toBe(null)
})

// --- 本文のフラグを持たない --fill 系・--template/-T は本文を検査できない(決定 64) ---

test("gh pr create --fill は本文を検査できないため deny", () => {
  const root = setupRunAtPr()
  const r = hook(root, "gh pr create --fill")
  expect(r?.permissionDecision).toBe("deny")
})

test("gh pr create --fill-first は本文を検査できないため deny", () => {
  const root = setupRunAtPr()
  const r = hook(root, "gh pr create --fill-first")
  expect(r?.permissionDecision).toBe("deny")
})

test("gh pr create --fill-verbose は本文を検査できないため deny", () => {
  const root = setupRunAtPr()
  const r = hook(root, "gh pr create --fill-verbose")
  expect(r?.permissionDecision).toBe("deny")
})

test("gh pr create --template <file> は本文を検査できないため deny", () => {
  const root = setupRunAtPr()
  const r = hook(root, "gh pr create --template file.md")
  expect(r?.permissionDecision).toBe("deny")
})

test("gh pr create -T <file> は本文を検査できないため deny", () => {
  const root = setupRunAtPr()
  const r = hook(root, "gh pr create -T file.md")
  expect(r?.permissionDecision).toBe("deny")
})

test("gh issue create --template <file> は本文を検査できないため deny", () => {
  const root = setupRunAtTriage()
  const r = hook(root, "gh issue create --template file.md")
  expect(r?.permissionDecision).toBe("deny")
})

test("gh issue create --fill は pr create 専用のフラグなので、本文フラグ無しの従来どおり通る", () => {
  const root = setupRunAtTriage()
  const r = hook(root, "gh issue create --fill")
  expect(r).toBe(null)
})

test("gh pr create --fill --body はマーカーがあれば通る(本文のフラグを持つ呼び出しは従来どおり本文を検査する)", () => {
  const root = setupRunAtPr()
  const r = hook(
    root,
    `gh pr create --label codiel --fill --body "本文 ${MARKER}"`
  )
  expect(r).toBe(null)
})

// --- heredoc の本文を除くのは終端の行が見つかったときだけ(M2-FX2-R の critical、M2-FX2-AR の medium) ---

test("閉じていない heredoc(cat <<NEVERCLOSED)の後の行の gh の投稿は、マーカーが無ければ deny", () => {
  const root = setupRun()
  const r = hook(root, ["cat <<NEVERCLOSED", NO_MARKER_COMMENT].join("\n"))
  expect(r?.permissionDecision).toBe("deny")
})

test("here-string(<<<)を heredoc の開始と見なさず、後続の行の gh の投稿を検査する", () => {
  const root = setupRun()
  for (const first of ["echo <<<EOF", "x=$(cat <<<hello)"])
    expect(
      hook(root, [first, NO_MARKER_COMMENT].join("\n"))?.permissionDecision
    ).toBe("deny")
})

test("直前が数字・識別子・) の <<(算術のシフト)を heredoc の開始と見なさず、後続の行の gh の投稿を検査する", () => {
  const root = setupRun()
  for (const first of ["n=$((1<<2))", "n=$((x<<y))", "n=$(( (1)<<y ))"])
    expect(
      hook(root, [first, NO_MARKER_COMMENT, "y"].join("\n"))?.permissionDecision
    ).toBe("deny")
})

test("文字列の中の <<EOF を heredoc の開始と見なさず、後続の行の gh の投稿を検査する", () => {
  const root = setupRun()
  const first = 'git commit -m "doc: <<EOF の扱い"'
  expect(
    hook(root, [first, NO_MARKER_COMMENT].join("\n"))?.permissionDecision
  ).toBe("deny")
  // 後ろに同じ語で終わる本物の heredoc があっても、間の行を除かない。
  expect(
    hook(root, [first, NO_MARKER_COMMENT, "cat <<EOF", "x", "EOF"].join("\n"))
      ?.permissionDecision
  ).toBe("deny")
})

test("コメントの中の <<EOF を heredoc の開始と見なさず、後続の行の gh の投稿を検査する", () => {
  const root = setupRun()
  const command = ["# <<EOF", NO_MARKER_COMMENT, "cat <<EOF", "x", "EOF"].join(
    "\n"
  )
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("heredoc の終端の行より後の gh の投稿は検査する", () => {
  const root = setupRun()
  const command = [
    "cat <<'EOF'",
    "gh pr comment 1 --body-file tmp.md",
    "EOF",
    NO_MARKER_COMMENT
  ].join("\n")
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("<<- の heredoc は先頭のタブを除いた終端の行で閉じ、<< の heredoc は完全に一致する終端の行でだけ閉じる", () => {
  const root = setupRun()
  const dash = [
    "cat <<-EOF",
    "\tgh pr comment 1 --body-file tmp.md",
    "\tEOF"
  ].join("\n")
  expect(hook(root, dash)).toBe(null)
  const indented = ["cat <<EOF", NO_MARKER_COMMENT, "  EOF"].join("\n")
  expect(hook(root, indented)?.permissionDecision).toBe("deny")
})

test("heredoc の開始行が行末の \\ で続くときは、論理行の次の行から本文とする", () => {
  const root = setupRun()
  const command = [
    "cat <<EOF \\",
    `&& ${NO_MARKER_COMMENT}`,
    "本文",
    "EOF"
  ].join("\n")
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

// --- --fill の短縮形 -f と短いフラグの結合(M2-FX2-AR の high、決定 64) ---

test("gh pr create -f は --fill の短縮形として deny", () => {
  const root = setupRunAtPr()
  for (const command of ["gh pr create -f", "gh pr create -f --title x"])
    expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("短いフラグの結合(-df・-dT・-dTfile.md)に含まれる -f・-T を読み deny", () => {
  const root = setupRunAtPr()
  for (const command of [
    "gh pr create -df",
    "gh pr create -dT file.md",
    "gh pr create -dTfile.md"
  ])
    expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("値を取る短いフラグの後ろの文字は結合と読まない(-tf は --title f)。結合した -db の本文は検査する", () => {
  const root = setupRunAtPr()
  expect(hook(root, "gh pr create -l codiel -tf")).toBe(null)
  expect(hook(root, 'gh pr create -db "no marker"')?.permissionDecision).toBe(
    "deny"
  )
  expect(hook(root, `gh pr create -l codiel -db "本文 ${MARKER}"`)).toBe(null)
})

// --- 行末の \ による行の継続を 1 行へ戻す(M2-FX2-AR の high) ---

test("行末の \\ で続けた gh pr comment の --body も、マーカーが無ければ deny", () => {
  const root = setupRun()
  const r = hook(root, 'gh pr comment 1 \\\n  --body "no marker"')
  expect(r?.permissionDecision).toBe("deny")
  // `\\` の直後の改行は継続ではないので、次の行は別のコマンドとして検査する。
  const escaped = hook(root, `echo a\\\\\n${NO_MARKER_COMMENT}`)
  expect(escaped?.permissionDecision).toBe("deny")
})

test("行末の \\ で続けた gh pr create の --body・--fill も deny", () => {
  const root = setupRunAtPr()
  expect(
    hook(root, 'gh pr create \\\n  --title t \\\n  --body "no marker"')
      ?.permissionDecision
  ).toBe("deny")
  expect(hook(root, "gh pr create \\\n  --fill")?.permissionDecision).toBe(
    "deny"
  )
})

test("行末の \\ で続けた git push --force origin main も deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const r = hook(root, "git push \\\n  --force origin main")
  expect(r?.permissionDecision).toBe("deny")
})

test("行末の \\ で続けた gh pr create も、フェーズの制限で deny", () => {
  const root = setupRun()
  setupRunAtImplement(root)
  const r = hook(root, "gh pr \\\ncreate --title t")
  expect(r?.permissionDecision).toBe("deny")
})

// --- 同じコマンドでの本文ファイルの書き換えと複数の投稿、gh pr create --web(決定 66) ---

test("同じコマンドで書き換えた本文ファイル(cat > x.md <<EOF、cp t.md x.md)を -F で渡すと deny", () => {
  const root = setupRunAtPr()
  // フックは実行前の中身を読むので、マーカーのある古い中身を置いておく。
  fs.writeFileSync(path.join(root, "x.md"), `古い本文\n${MARKER}\n`)
  const heredoc = [
    "cat > x.md <<'EOF'",
    "## Summary",
    "- [x] I have signed the CLA",
    "EOF",
    "gh pr create --title fix -F x.md"
  ].join("\n")
  const copy = "cp t.md x.md && gh pr create -t a -F x.md"
  for (const command of [heredoc, copy]) {
    const r = hook(root, command)
    expect(r?.permissionDecision).toBe("deny")
    expect(r?.permissionDecisionReason).toContain("Write ツール")
  }
})

test("gh api の -F body=@<パス> と --input のパスが、同じコマンドの別の場所にも現れたら deny", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "x.md"), `本文\n${MARKER}\n`)
  fs.writeFileSync(
    path.join(root, "x.json"),
    JSON.stringify({ body: `本文 ${MARKER}` })
  )
  for (const command of [
    "cp t.md x.md && gh api repos/o/r/issues/1/comments -F body=@x.md",
    "cp t.json x.json && gh api repos/o/r/pulls/1/reviews --input x.json"
  ]) {
    const r = hook(root, command)
    expect(r?.permissionDecision).toBe("deny")
    expect(r?.permissionDecisionReason).toContain("Write ツール")
  }
})

test("本文を引数で渡す投稿を含む複数の投稿は、1 つのマーカーがあっても deny", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "ok.md"), `本文\n${MARKER}\n`)
  for (const command of [
    `gh pr comment 1 -b "${MARKER} A" && gh pr comment 1 -b "B without marker"`,
    `echo $(gh pr comment 1 -b "${MARKER} A") $(gh pr comment 2 -b B)`,
    `gh api repos/o/r/issues/1/comments -f body="${MARKER}" && gh pr comment 1 -F ok.md`
  ]) {
    const r = hook(root, command)
    expect(r?.permissionDecision).toBe("deny")
    expect(r?.permissionDecisionReason).toContain("1 回の Bash 呼び出しに 1 つ")
  }
})

test("本文ファイルだけで渡す複数の投稿は、同じファイルを使っても中身にマーカーがあれば通る", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "ok.md"), `本文\n${MARKER}\n`)
  const r = hook(
    root,
    "gh pr comment 1 -F ok.md && gh issue comment 1 -F ok.md"
  )
  expect(r).toBe(null)
})

test("gh pr create --web / -w は、本文のフラグの有無によらず deny", () => {
  const root = setupRunAtPr()
  fs.writeFileSync(path.join(root, "ok.md"), `本文\n${MARKER}\n`)
  for (const command of [
    "gh pr create -t x --web",
    "gh pr create -w --body-file ok.md",
    "gh pr create -dw"
  ]) {
    const r = hook(root, command)
    expect(r?.permissionDecision).toBe("deny")
    expect(r?.permissionDecisionReason).toContain("--web")
  }
})

test("gh issue create --web / -w も、本文のフラグの有無によらず deny", () => {
  const root = setupRunAtTriage()
  for (const command of [
    "gh issue create -t x --web",
    `gh issue create -t x -b "${MARKER}" -w`
  ]) {
    const r = hook(root, command)
    expect(r?.permissionDecision).toBe("deny")
    expect(r?.permissionDecisionReason).toContain("--web")
  }
})

test("複数の投稿の deny は、Write ツールで書いた本文ファイルを --body-file で渡すよう案内する", () => {
  const root = setupRun()
  const r = hook(
    root,
    `gh pr comment 1 -b "${MARKER} A" && gh pr comment 2 -b "${MARKER} B"`
  )
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain(
    "Write ツールで書いたファイルを --body-file"
  )
})
