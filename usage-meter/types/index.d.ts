export type Context = { tokens: number; window: number; percent: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { context: Context | null }
  }
}
