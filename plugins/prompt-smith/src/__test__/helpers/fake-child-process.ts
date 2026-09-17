import { EventEmitter } from "node:events"

export class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdinWrites: string[] = []
  stdinEnded = false
  readonly stdin = {
    write: (chunk: unknown): boolean => {
      this.stdinWrites.push(String(chunk))
      return true
    },
    end: (): void => {
      this.stdinEnded = true
    }
  }
  readonly killSignals: NodeJS.Signals[] = []
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killSignals.push(signal)
    return true
  }
}
