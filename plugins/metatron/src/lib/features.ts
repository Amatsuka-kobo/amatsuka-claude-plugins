// ADR と GOTCHAS の記録を有効にする環境変数の判定
// (`harness-docs/design/2026-10-08-metatron-adr-gotchas-opt-in-design.md` §2)。
//
// 値を trim して小文字にし、`1` / `true` / `on` のどれかなら有効とする。
// 未設定・空・それ以外の値は無効。codiel の check-intent-env も同じ判定を独立に持つので、
// 値域を変えるときは 2 者比較テストを通して両方を揃える。

export const ADR_ENV = "AMATSUKA_METATRON_ENABLE_ADR"
export const GOTCHAS_ENV = "AMATSUKA_METATRON_ENABLE_GOTCHAS"

export interface Features {
  adr: boolean
  gotchas: boolean
}

export type Feature = keyof Features

/** 機能ごとの環境変数名。拒否や案内の文面に載せる。 */
export const FEATURE_ENV: Readonly<Record<Feature, string>> = {
  adr: ADR_ENV,
  gotchas: GOTCHAS_ENV
}

function enabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "on"
}

export function readFeatures(env: NodeJS.ProcessEnv): Features {
  return { adr: enabled(env[ADR_ENV]), gotchas: enabled(env[GOTCHAS_ENV]) }
}
