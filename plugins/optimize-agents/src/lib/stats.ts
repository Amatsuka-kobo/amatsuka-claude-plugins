export interface Stats {
  mean: number
  stddev: number
  min: number
  max: number
}

export function computeStats(values: number[]): Stats {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return {
    mean,
    stddev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values)
  }
}
