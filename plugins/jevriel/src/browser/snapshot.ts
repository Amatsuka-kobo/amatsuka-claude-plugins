export type AriaNode = {
  role: string
  name?: string
  children?: Array<AriaNode | string>
  disabled?: boolean
  ariaHidden?: boolean
  [key: string]: unknown
}

export const ACTIONABLE_ROLES: readonly string[] = [
  "link",
  "button",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "option",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "switch",
  "slider",
  "spinbutton",
  "treeitem"
]

export const MAX_ACTIONABLES = 200

export type Actionable = {
  id: string
  role: string
  name: string
  nth: number
}

export function extractActionables(nodes: AriaNode[]): {
  actionables: Actionable[]
  omitted: number
} {
  const roles = new Set(ACTIONABLE_ROLES)
  const counts = new Map<string, number>()
  const actionables: Actionable[] = []
  let omitted = 0

  const visit = (node: AriaNode): void => {
    if (node.ariaHidden) return

    if (node.disabled !== true && node.name && roles.has(node.role)) {
      const key = JSON.stringify([node.role, node.name])
      const nth = counts.get(key) ?? 0
      counts.set(key, nth + 1)
      if (actionables.length < MAX_ACTIONABLES) {
        actionables.push({
          id: `a${actionables.length + 1}`,
          role: node.role,
          name: node.name,
          nth
        })
      } else {
        omitted += 1
      }
    }

    for (const child of node.children ?? []) {
      if (typeof child !== "string") visit(child)
    }
  }

  for (const node of nodes) visit(node)
  return { actionables, omitted }
}
