import { sha256Hex } from "./infection-store.js"
import type { InfectionKind } from "./types.js"

export function recurrenceKey(kind: InfectionKind, target: string): string {
  return sha256Hex(`${kind}\0${target}`)
}
