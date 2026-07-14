import type { KindKey } from "../types.js"

const SVG_PATH: Record<KindKey, string> = {
  generic: `<rect x="3" y="3" width="18" height="18" rx="4" />`,
  user: `<circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />`,
  api: `<path d="M4 8h16M4 12h16M4 16h16" />`,
  data: `<ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />`,
  messaging: `<path d="M4 5h16v10H9l-4 4V5z" />`,
  external: `<path d="M7 17 17 7M9 7h8v8" />`,
  screen: `<rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" />`,
  entity: `<rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" />`
}

const EMOJI: Record<KindKey, string> = {
  generic: "◆",
  user: "👤",
  api: "⚙",
  data: "▰",
  messaging: "✉",
  external: "↗",
  screen: "▣",
  entity: "▦"
}

export function iconEmoji(kind: KindKey): string {
  return EMOJI[kind]
}

export function iconSvg(kind: KindKey): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">${SVG_PATH[kind]}</svg>`
}
