export type Usage = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  usd?: number
}

export type Turn = { tokens: number; usd: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { usage: Usage | null; last: Turn | null; now: number }
  }
}
