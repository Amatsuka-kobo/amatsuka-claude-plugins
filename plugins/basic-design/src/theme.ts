import type { KindKey } from "./types.js"

export const THEME = {
  palette: {
    generic: {
      fill: "#F8FAFC",
      stroke: "#64748B",
      icon: "#475569",
      text: "#0F172A"
    },
    user: {
      fill: "#EFF6FF",
      stroke: "#3B82F6",
      icon: "#2563EB",
      text: "#1E3A8A"
    },
    api: {
      fill: "#ECFEFF",
      stroke: "#0891B2",
      icon: "#0E7490",
      text: "#164E63"
    },
    data: {
      fill: "#F5F3FF",
      stroke: "#8B5CF6",
      icon: "#7C3AED",
      text: "#4C1D95"
    },
    messaging: {
      fill: "#FFF7ED",
      stroke: "#F97316",
      icon: "#EA580C",
      text: "#7C2D12"
    },
    external: {
      fill: "#FDF2F8",
      stroke: "#DB2777",
      icon: "#BE185D",
      text: "#831843"
    },
    screen: {
      fill: "#F0FDF4",
      stroke: "#22C55E",
      icon: "#16A34A",
      text: "#14532D"
    },
    entity: {
      fill: "#FFFBEB",
      stroke: "#D97706",
      icon: "#B45309",
      text: "#78350F"
    }
  } satisfies Record<
    KindKey,
    { fill: string; stroke: string; icon: string; text: string }
  >,
  zone: { fill: "#F8FAFC", stroke: "#CBD5E1", chip: "#E2E8F0" },
  edge: "#475569",
  labelBackground: "#FFFFFF",
  fontFamily: "system-ui, sans-serif",
  radius: 12,
  shadow: "0 6px 18px rgba(15,23,42,.12)"
} as const
