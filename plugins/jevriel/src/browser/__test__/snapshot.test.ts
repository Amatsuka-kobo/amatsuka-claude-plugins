import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { type AriaNode, extractActionables } from "../snapshot.js"

function fixture(name: "basic" | "excluded" | "duplicates"): AriaNode[] {
  return JSON.parse(
    readFileSync(
      new URL(`../../fixtures/aria/${name}.json`, import.meta.url),
      "utf8"
    )
  ) as AriaNode[]
}

describe("extractActionables", () => {
  it("extracts supported roles in document order", () => {
    const { actionables } = extractActionables(fixture("basic"))

    expect(actionables.map(({ role }) => role)).toEqual([
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
    ])
    expect(actionables.map(({ name }) => name)).toEqual([
      "Link",
      "Button",
      "Text field",
      "Search field",
      "Checkbox",
      "Radio",
      "Combobox",
      "Option",
      "Tab",
      "Menu item",
      "Menu checkbox",
      "Menu radio",
      "Switch",
      "Slider",
      "Spinbutton",
      "Tree item"
    ])
  })

  it("excludes unnamed and disabled nodes from the captured fixture", () => {
    const nodes = fixture("excluded")
    const html = readFileSync(
      new URL("../../fixtures/aria/excluded.html", import.meta.url),
      "utf8"
    )
    const { actionables } = extractActionables(nodes)

    expect(html).toContain('aria-hidden="true"')
    expect(nodes.some((node) => node.role === "button" && !node.name)).toBe(
      true
    )
    expect(
      nodes.some((node) => node.role === "button" && node.disabled === true)
    ).toBe(true)
    expect(nodes.some((node) => node.name === "Hidden button")).toBe(false)
    expect(actionables.map(({ name }) => name)).toEqual(["Visible button"])
  })

  it("defensively excludes ariaHidden nodes", () => {
    const { actionables } = extractActionables([
      { role: "button", name: "Hidden button", ariaHidden: true },
      { role: "button", name: "Visible button" }
    ])

    expect(actionables.map(({ name }) => name)).toEqual(["Visible button"])
  })

  it("assigns sequential ids starting at a1", () => {
    const { actionables } = extractActionables(fixture("basic"))

    expect(actionables.map(({ id }) => id)).toEqual(
      Array.from({ length: 16 }, (_, index) => `a${index + 1}`)
    )
  })

  it("limits results to 200 and reports the omitted count", () => {
    const nodes = Array.from({ length: 201 }, (_, index) => ({
      role: "button",
      name: `Button ${index}`
    }))
    const result = extractActionables(nodes)

    expect(result.actionables).toHaveLength(200)
    expect(result.actionables[199]).toMatchObject({
      id: "a200",
      name: "Button 199"
    })
    expect(result.omitted).toBe(1)
  })

  it("numbers duplicate role and name nodes after disabled nodes are removed", () => {
    const { actionables } = extractActionables(fixture("duplicates"))

    expect(actionables).toEqual([
      { id: "a1", role: "button", name: "Repeat", nth: 0 },
      { id: "a2", role: "button", name: "Repeat", nth: 1 }
    ])
  })
})
