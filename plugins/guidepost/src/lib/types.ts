export interface TourSource {
  type: "range" | "pr"
  value: string
}

export interface TourStopHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
}

export interface TourStop {
  id: string
  file: string
  title: string
  what: string
  why: string
  ifBroken: string
  hunk?: TourStopHunk
  diffText?: string
}

export interface Tour {
  version: 1
  tourId: string
  title: string
  baseSha: string
  headSha: string
  source: TourSource
  stops: TourStop[]
}

export interface Question {
  name: string
  tourId: string
  stopId: string
  createdAt: string
  body: string
}

export interface Answer {
  stopId: string
  ts: string
  body: string
}
