// what a source last fetched (see hooks/core.ts), kept as plain JSON
export type Entry = {
  items: unknown[]
  at: number
  error?: { reason: 'not-connected' | 'tool-error' | 'parse-error' | 'timeout'; at: number }
  fails: number
  nextTryAt: number
}

declare module 'claude-code' {
  interface PluginState {
    // each enabled source's entry by source id, and the time of the last tick
    'up-to-date': { entries: Record<string, Entry>; now: number }
  }
}
