/** code のルールのテストが使う、固定した書式の diff を組むヘルパー */

/** path の既存ファイルに追加行と削除行を持つ 1 ファイル分の diff */
export function fileDiff(
  path: string,
  additions: string[],
  deletions: string[] = []
): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${deletions.length} +1,${additions.length} @@`,
    ...deletions.map((l) => `-${l}`),
    ...additions.map((l) => `+${l}`)
  ].join("\n")
}

/** from のファイルを to へ移す diff。additions を渡すと、移した上で行を足す */
export function renameDiff(
  from: string,
  to: string,
  additions: string[] = []
): string {
  const head = [
    `diff --git a/${from} b/${to}`,
    `similarity index ${additions.length === 0 ? 100 : 90}%`,
    `rename from ${from}`,
    `rename to ${to}`
  ]
  if (additions.length === 0) return head.join("\n")
  return [
    ...head,
    "index 1111111..2222222 100644",
    `--- a/${from}`,
    `+++ b/${to}`,
    `@@ -1,0 +1,${additions.length} @@`,
    ...additions.map((l) => `+${l}`)
  ].join("\n")
}

/** path のファイルを削除する diff */
export function deletedFileDiff(path: string, lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    "index 1111111..0000000",
    `--- a/${path}`,
    "+++ /dev/null",
    `@@ -1,${lines.length} +0,0 @@`,
    ...lines.map((l) => `-${l}`)
  ].join("\n")
}
