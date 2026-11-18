import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { hook, MARKER } from "./helpers/guard-bash-fixtures.js"
import { cli, SLUG, setupRun, setupRunAtPr } from "./helpers/run-setup.js"

// --- state.json の保護は cd を追った解決後のパスで判定する(C3-02・C3-15) ---

test.each([
  "rm .codiel/runs/x/try-1/state.json",
  "cd .codiel/runs/x/try-1 && echo '{}' > state.json",
  "rm -rf .codiel/runs/x",
  "ln -sf /tmp/fake.json .codiel/runs/x/try-1/state.json"
])("%s は deny", (command) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  fs.mkdirSync(path.join(root, ".codiel/runs/x/try-1"), { recursive: true })
  const r = hook(root, command)
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain("state.json")
})

// cp・mv・install・ln の書き込み先が runs の配下・runs そのもの・runs を含む祖先なら、コピー元を問わず拒否する
test.each([
  "cp -a backup/try-1 .codiel/runs/demo",
  "cp -r -t .codiel/runs/demo backup/try-1",
  "cp -t alias/.. data.json",
  "cp data.json .codiel/runs/demo/try-1",
  "cp -a backup/.codiel ."
])("%s は deny", (command) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const tryDir = path.join(root, ".codiel/runs/demo/try-1")
  fs.mkdirSync(path.join(tryDir, "child"), { recursive: true })
  fs.writeFileSync(path.join(tryDir, "state.json"), "{}")
  fs.symlinkSync(
    path.join(tryDir, "state.json"),
    path.join(tryDir, "data.json")
  )
  fs.symlinkSync(path.join(tryDir, "child"), path.join(root, "alias"), "dir")
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

// 書かれるパスの根で判定する(-T、中身のコピー、リンク名を省略した ln)
function rootsProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  for (const d of [
    ".codiel/runs/demo/try-1/reports",
    "backup/runs/demo/try-1",
    "backup/.codiel/runs/demo/try-1",
    "src"
  ])
    fs.mkdirSync(path.join(root, d), { recursive: true })
  return root
}

test.each([
  "cp -aT backup .codiel",
  "cp -a --no-target-directory backup .",
  "cd .codiel/runs/demo/try-1 && ln -sf ../../../../backup/runs/demo/try-1/state.json"
])("%s は deny", (command) => {
  expect(hook(rootsProject(), command)?.permissionDecision).toBe("deny")
})

// runs の祖先への中身のコピーは、元を問わず拒否する(受け入れる誤拒否。ファイルを指定してコピーすれば避けられる)
test.each([
  "cp -a .codiel/runs/demo/try-1/reports/. .",
  "cp -a src/. ."
])("runs の祖先への中身のコピー %s は deny", (command) => {
  expect(hook(rootsProject(), command)?.permissionDecision).toBe("deny")
})

// --parents の実際の配置先(output/src が try のディレクトリへの symlink)
test.each([
  "cp --parents src/state.json output",
  "cp -a --parents src/state.json output",
  "cp --pa src/state.json output",
  "cp --parents -t output src/state.json"
])("%s は deny", (command) => {
  const root = rootsProject()
  fs.mkdirSync(path.join(root, "output"))
  fs.symlinkSync(
    path.join(root, ".codiel/runs/demo/try-1"),
    path.join(root, "output/src"),
    "dir"
  )
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("--parents で ~ から始まる元は、~ を展開した実際の配置先でも照合して deny", () => {
  const root = rootsProject()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gb-home-"))
  const placed = path.join(root, "output", home.replace(/^\/+/, ""))
  fs.mkdirSync(placed, { recursive: true })
  fs.symlinkSync(
    path.join(root, ".codiel/runs/demo/try-1"),
    path.join(placed, "src"),
    "dir"
  )
  for (const command of [
    "cp --parents ~/src/a.txt output",
    "cp -a --parents ~/src/a.txt output",
    "cp --pa ~/src/a.txt output",
    "cp --parents -t output ~/src/a.txt"
  ])
    expect(
      hook(root, command, { HOME: home })?.permissionDecision,
      command
    ).toBe("deny")
})

// 元が別ディレクトリへの symlink の .codiel、元の runs が切れた symlink、--parents の配置先
test.each([
  "cp -a linked/.codiel .",
  "cp -a broken/. .codiel",
  "cd backup && cp -a --parents .codiel/runs .."
])("%s は deny", (command) => {
  const root = rootsProject()
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "gb-other-"))
  fs.mkdirSync(path.join(root, "linked"))
  fs.symlinkSync(other, path.join(root, "linked/.codiel"), "dir")
  fs.mkdirSync(path.join(root, "broken"))
  fs.symlinkSync(path.join(root, "nowhere"), path.join(root, "broken/runs"))
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("前段で元に runs の道を作ってから中身を祖先へコピーする複合コマンドは deny", () => {
  const command =
    "mkdir -p x/.codiel/runs/demo/try-1 && cp s.json x/.codiel/runs/demo/try-1/state.json && cp -a x/. ."
  expect(hook(rootsProject(), command)?.permissionDecision).toBe("deny")
  // hook の時点では元(src)に .codiel が無く、字句の検査にも当たらない形
  const later =
    "mkdir -p src/.codiel/runs/demo/try-1 && touch src/.codiel/runs/demo/try-1/data.json && cp -a src/. ."
  expect(hook(rootsProject(), later)?.permissionDecision).toBe("deny")
})

test("runs の下から外へのコピーは素通し", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  fs.mkdirSync(path.join(root, ".codiel/runs/x/try-1/reports"), {
    recursive: true
  })
  expect(hook(root, "cp .codiel/runs/x/try-1/reports/a.md /tmp")).toBe(null)
})

// 書き込み先のディレクトリをオプションで渡す形(H1)
test.each([
  "cp -t .codiel/runs/x/try-1 /tmp/state.json",
  "install -t .codiel/runs/x/try-1 /tmp/state.json",
  "cp --target-directory .codiel/runs/x/try-1 /tmp/state.json",
  "cp --target-directory=.codiel/runs/x/try-1 /tmp/state.json",
  "cp --target-dir .codiel/runs/x/try-1 /tmp/state.json",
  "install --target-d=.codiel/runs/x/try-1 /tmp/state.json"
])("%s は deny", (command) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  fs.mkdirSync(path.join(root, ".codiel/runs/x/try-1"), { recursive: true })
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("先頭が git・gh でないコマンドでは、囮の gh -m の後ろの改行を含む語も判定に残し、state.json の削除は deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const r = hook(root, "env rm gh -m '.codiel/runs/x/try-1/state.json\nx'")
  expect(r?.permissionDecision).toBe("deny")
})

test("cd -P で symlink の .. を実体で辿った先の state.json への書き込みは deny(H2)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const child = path.join(root, ".codiel/runs/x/try-1/child")
  fs.mkdirSync(child, { recursive: true })
  fs.symlinkSync(child, path.join(root, "alias"), "dir")
  const r = hook(root, "cd -P alias/.. && printf '{}' > state.json")
  expect(r?.permissionDecision).toBe("deny")
})

test("symlink を通した alias/../state.json への書き込みは deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const reports = path.join(root, ".codiel/runs/x/try-1/reports")
  fs.mkdirSync(reports, { recursive: true })
  fs.symlinkSync(reports, path.join(root, "alias"), "dir")
  const r = hook(root, "echo '{}' > alias/../state.json")
  expect(r?.permissionDecision).toBe("deny")
})

// cwd の候補は、cd の行き先の組み合わせで増える。別々の相対ディレクトリへの cd が 8 個(候補 256)
// まで判定し、9 個(候補 512)で上限を超える
test("別々の相対ディレクトリへの cd が 8 個までは素通し、9 個で cd が多すぎるとして deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const nested = (n: number) =>
    [..."abcdefghi".slice(0, n)].map((d) => `cd ${d}`).join(" && ")
  expect(hook(root, `${nested(4)} && ls`)).toBe(null)
  expect(hook(root, `${nested(8)} && ls`)).toBe(null)
  const r = hook(root, `${nested(9)} && ls`)
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain(
    "cd が多すぎて書き込み先を判定できない"
  )
})

test("monorepo の 8 パッケージを cd で巡回するコマンドは素通し", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const pkgs = ["a", "b", "c", "d", "e", "f", "g", "h"]
  const command = pkgs
    .map((p, i) => `${i === 0 ? "cd packages/" : "cd ../"}${p} && npm test`)
    .join(" && ")
  expect(hook(root, command)).toBe(null)
})

test("受け手を問わず heredoc の本文の state.json の削除は deny(パイプでシェルへ渡す形と、引用符で囲んだシェル名を含む)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  for (const head of ["bash <<EOF", "cat <<EOF | bash", '"bash" <<EOF'])
    expect(
      hook(root, [head, "rm .codiel/runs/x/try-1/state.json", "EOF"].join("\n"))
        ?.permissionDecision,
      head
    ).toBe("deny")
})

test("fd 番号付きの heredoc でシェルへ渡した state.json の削除は deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  for (const command of [
    ["bash 0<<EOF", "rm .codiel/runs/x/try-1/state.json", "EOF"].join("\n"),
    ["sh 0<<-EOF", "\trm .codiel/runs/x/try-1/state.json", "\tEOF"].join("\n")
  ])
    expect(hook(root, command)?.permissionDecision, command).toBe("deny")
})

test("コミットメッセージの heredoc と同じ行に 2 つ目の heredoc があれば、2 つ目の本文の書き込みは deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const command = [
    "git commit -F - <<'EOF' ; bash <<'X'",
    "メッセージ",
    "EOF",
    "echo '{}' > .codiel/runs/x/try-1/state.json",
    "X"
  ].join("\n")
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("実行される heredoc の本文の中に除外に当たる heredoc の開始行があっても、後ろの行の削除は deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const command = [
    "bash <<'X'",
    "git commit -F - <<'Y'",
    "rm .codiel/runs/x/try-1/state.json",
    "Y",
    "X"
  ].join("\n")
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("cat のプロセス置換へ渡した heredoc の本文と、改行を含む語の中の state.json の削除は deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  for (const command of [
    ["cat > >(bash) <<'EOF'", "rm .codiel/runs/x/try-1/state.json", "EOF"].join(
      "\n"
    ),
    "bash -c $'rm .codiel/runs/x/try-1/state.json\\necho'"
  ])
    expect(hook(root, command)?.permissionDecision, command).toBe("deny")
})

test("heredoc の本文の中の cd も cwd の候補に入れ、その先の state.json の書き込みは deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const command = [
    "cd .codiel/runs/x/try-1 && ls",
    "bash <<'EOF'",
    "cd .codiel/runs/x/try-1",
    "echo '{}' > state.json",
    "EOF"
  ].join("\n")
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

// 行末のバックスラッシュで次の行の `| bash` へ続く形と、終端の次の行の続きに引用符がある形は差し引かない
test.each([
  // 引用の無い区切り語では、bash が本文の行末のバックスラッシュと改行を結合して終端を認識する
  // (`EO\` と `F` の 2 行で EOF になる)。物理行で探す終端より前で本文が終わる形
  [
    "git commit -F - <<EOF",
    "メッセージ",
    "EO\\",
    "F",
    "rm .codiel/runs/x/try-1/state.json",
    ": <<'EOF'",
    "EOF"
  ],
  // 前の行の継続で、受け手が別のコマンド(sh)になる形
  [
    "sh -s \\",
    "git commit -F - <<'EOF'",
    "rm .codiel/runs/x/try-1/state.json",
    "EOF"
  ],
  // `-F -` の区切り語の後ろが空でない形(受け入れる誤拒否)
  [
    "git commit --amend -F - <<'EOF' --no-verify",
    "rm .codiel/runs/x/try-1/state.json",
    "EOF"
  ],
  [
    "git add -A && git commit -F - <<'EOF' \\",
    "| bash",
    "rm .codiel/runs/x/try-1/state.json",
    "EOF"
  ],
  [
    "git commit -m \"$(cat <<'EOF'",
    "rm .codiel/runs/x/try-1/state.json",
    "EOF",
    ')" && echo "x"'
  ],
  // gh と名前の似た別のコマンド。受け手の最初の語の完全一致の判定(head)の回帰テストである。
  // 正規表現の先頭への固定は多重防御で、この形の挙動は変えない
  [
    "gh-x pr create --body \"$(cat <<'EOF'",
    "rm .codiel/runs/x/try-1/state.json",
    "EOF",
    ')"'
  ]
])("%s … は deny", (...lines) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  expect(hook(root, lines.join("\n"))?.permissionDecision).toBe("deny")
})

test("前段の git add にパスを並べたコミットメッセージは素通し", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const command = [
    "git add a b && git commit -m \"$(cat <<'EOF'",
    "rm .codiel/runs/x/try-1/state.json",
    "EOF",
    ')"'
  ].join("\n")
  expect(hook(root, command)).toBe(null)
})

// 許可リストに当たるコミットメッセージの形は、本文の行頭に rm があっても素通し
test.each([
  ["git commit -m \"$(cat <<'EOF'", ')"'],
  ["git commit -F - <<'EOF'", ""],
  ["gh pr create --title t --body \"$(cat <<'EOF'", ')"']
])("コミットメッセージ %s は素通し", (head, tail) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const lines = [head, "rm .codiel/runs/x/try-1/state.json", "EOF"]
  if (tail) lines.push(tail)
  expect(hook(root, lines.join("\n"))).toBe(null)
})

// 開始の行の前段に && があるコミットメッセージと、終端の次の行に続くコマンドがある形
test.each([
  [
    "git add -A && git commit -m \"$(cat <<'EOF'",
    "rm .codiel/runs/x/try-1/state.json",
    "EOF",
    ')"'
  ],
  [
    "git commit -m \"$(cat <<'EOF'",
    "rm .codiel/runs/x/try-1/state.json",
    "EOF",
    ')" && git push'
  ]
])("コミットメッセージ %s … は素通し", (...lines) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  expect(hook(root, lines.join("\n"))).toBe(null)
})

test.each([
  [
    "git commit -F - <<'EOF' | bash",
    "rm .codiel/runs/x/try-1/state.json",
    "EOF"
  ],
  [
    "git commit -m \"$(cat <<'EOF'",
    "メッセージ",
    "EOF",
    ')" && rm .codiel/runs/x/try-1/state.json'
  ]
])("コミットメッセージの形でも、本文をシェルへ渡す %s … と続きの書き込みは deny", (...lines) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  expect(hook(root, lines.join("\n"))?.permissionDecision).toBe("deny")
})

// 包みのコマンド(nohup・timeout)の後ろの削除も拒否する
test.each([
  "nohup rm .codiel/runs/x/try-1/state.json",
  "timeout 5 rm .codiel/runs/x/try-1/state.json"
])("%s は deny", (command) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  expect(hook(root, command)?.permissionDecision).toBe("deny")
})

test("引用の中の && の後ろに git commit -F - を置いた heredoc の本文は差し引かず deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  for (const head of [
    "bash -c 'x && ' git commit -F - <<'EOF'",
    // 受け手の区間は git commit だが、区切りより前に引用符がある形
    "bash -c \"true && git commit -F - <<'EOF'\"",
    // バックスラッシュで区切りをエスケープした形(`;` は区切りでなく bash の引数)
    "bash -s \\; git commit -F - <<'EOF'",
    // `#` のコメントで区切りを隠した形
    "true #; git commit -F - <<'EOF'"
  ]) {
    const command = [head, "rm .codiel/runs/x/try-1/state.json", "EOF"].join(
      "\n"
    )
    expect(hook(root, command)?.permissionDecision, head).toBe("deny")
  }
})

// cp・ln・install などの通常のコマンドと、install を引数に持つコマンドは素通し
test.each([
  "cp a b",
  "cp -r src dist",
  "ln -s ../x link",
  "install -m 755 a.sh /usr/local/bin/",
  "npm install -D foo bar",
  "pnpm install",
  "grep -r install src"
])("通常のコマンド %s は素通し", (command) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  expect(hook(root, command)).toBe(null)
})

test("コミットメッセージの heredoc の本文にある state.json への書き込みと削除の文字列は、起動と見なさず素通し", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const body = [
    "echo '{}' > .codiel/runs/x/try-1/state.json",
    "rm .codiel/runs/x/try-1/state.json"
  ]
  for (const command of [
    ["git commit -m \"$(cat <<'EOF'", ...body, "EOF", ')"'].join("\n"),
    ["git commit -F - <<'EOF'", ...body, "EOF"].join("\n")
  ])
    expect(hook(root, command), command).toBe(null)
})

test("同じコマンドで run の配下への symlink を作ってから書く形は deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  fs.mkdirSync(path.join(root, ".codiel/runs/x/try-1"), { recursive: true })
  const r = hook(
    root,
    "ln -s .codiel/runs/x/try-1 a && echo '{}' > a/state.json"
  )
  expect(r?.permissionDecision).toBe("deny")
})

test("heredoc と here-string でシェルへ渡した state.json の削除と書き込みは deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  for (const command of [
    ["bash <<EOF", "rm .codiel/runs/x/try-1/state.json", "EOF"].join("\n"),
    `bash <<< "echo x > .codiel/runs/x/try-1/state.json"`
  ])
    expect(hook(root, command)?.permissionDecision, command).toBe("deny")
})

test("$PWD を使った state.json への書き込みは、字句の検査で deny", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const r = hook(root, "echo '{}' > $PWD/.codiel/runs/x/try-1/state.json")
  expect(r?.permissionDecision).toBe("deny")
})

test("/tmp のテストデータに state.json 宛ての文字列を含むだけのコマンドは素通し(C3-15)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "gb-data-"))
  const r = hook(
    root,
    `printf '%s\\n' 'cp x .codiel/runs/a/try-1/state.json' > ${data}/state.json`
  )
  expect(r).toBe(null)
})

test("mv (state.json と無関係)は素通し(無出力)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const r = hook(root, "mv a b")
  expect(r).toBe(null)
})

// --- state.json の判定はリダイレクトの行き先と同じコマンドの引数だけを見る(A7-11) ---

const STATE = ".codiel/runs/s/try-1/state.json"

test.each([
  `echo '{}' > ${STATE}`,
  `echo x >>${STATE}`,
  `jq . a.json | tee ${STATE}`,
  `sed -i 's/a/b/' ${STATE}`,
  `printf '{}'>${STATE}`,
  `jq . a.json 2>${STATE}`,
  `jq . a.json &>${STATE}`,
  `jq . a.json >>${STATE}`,
  `jq . a.json >|${STATE}`
])("state.json への書き込み %s は deny", (command) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  const r = hook(root, command)
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain("state.json")
})

test.each([
  `git commit -m t -m "Co-Authored-By: X <noreply@anthropic.com>" && cat ${STATE}`,
  `echo "a > b"; cat ${STATE}`,
  `echo "x>"; cat ${STATE}`,
  `cat ${STATE} > /tmp/x.json`,
  `cat ${STATE}>/tmp/x.json`,
  `tee /tmp/x.log < ${STATE}`,
  `tee /tmp/x.log <${STATE}`
])("state.json を読むだけの %s は ALWAYS_DENY に掛からない", (command) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-"))
  expect(hook(root, command)).toBe(null)
})

// --- guard-bash の理由文(A7-12)。deny するかどうかは変わらない ---

test("run あり(phase=review)で git push は deny し、理由に push を許すフェーズを挙げる", () => {
  const root = setupRunAtPr()
  cli(root, [
    "complete-phase",
    "pr",
    "--slug",
    SLUG,
    "--pr-url",
    "https://example.test/pull/1"
  ])
  cli(root, ["start-phase", "review", "--slug", SLUG])
  const r = hook(root, "git push origin codiel/demo-try-1")
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain(
    "pr・fix-loop・triage・finalize"
  )
  expect(r?.permissionDecisionReason).toContain("現在: review")
})

test("run ありで gh api の -f body=@<パス> は deny し、理由で -F body=@<パス> を案内する", () => {
  const root = setupRun()
  fs.writeFileSync(path.join(root, "x.md"), `本文 ${MARKER}`)
  const r = hook(root, "gh api repos/o/r/pulls/1/comments -f body=@x.md")
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).toContain("-F body=@<パス>")
})

test("run ありで gh api の -f body=<文字列> の deny には -F body=@<パス> の案内を添えない", () => {
  const root = setupRun()
  const r = hook(root, "gh api repos/o/r/pulls/1/comments -f body=nomarker")
  expect(r?.permissionDecision).toBe("deny")
  expect(r?.permissionDecisionReason).not.toContain("-F body=@<パス>")
})
