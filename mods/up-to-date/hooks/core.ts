// Pure logic: no `$`, no clock, no randomness (time and jitter are passed in)

export type Reason = 'not-connected' | 'tool-error' | 'parse-error' | 'timeout'

export type Fetched<I> = { ok: true; items: I[] } | { ok: false; reason: Reason }

// what a source may reach for, injected so adapters never touch `$`
export type Io = {
  mcp(server: string, tool: string, args: object): Promise<unknown>
  run(argv: string[], options?: { timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

// rank 0 is the most urgent
export type Line = { rank: number; text: string; detail: string }

type Options = Record<string, unknown>

// items are plain JSON so they can be cached; text is built at render time from `now`
export type Source<I = unknown> = {
  id: string
  label: string
  ttlMs: number
  enabled(options: Options): boolean
  fetch(io: Io, now: number): Promise<Fetched<I>>
  lines(items: I[], now: number, options: Options): Line[]
}

export type Entry<I> = {
  items: I[]
  at: number
  error?: { reason: Reason; at: number }
  fails: number
  nextTryAt: number
}

const MAX_BACKOFF = 30 * 60_000
const SEPARATOR = ' · '

// ASCII labels only, so `.length` is the display width
export const fit = (lines: Line[], columns: number) => {
  const texts = [...lines].sort((a, b) => a.rank - b.rank).map(line => line.text)

  for (let count = texts.length; count > 0; count--) {
    const hidden = texts.length - count
    const suffix = hidden > 0 ? `${SEPARATOR}+${hidden}` : ''

    if (texts.slice(0, count).join(SEPARATOR).length + suffix.length <= columns) {
      return { shown: texts.slice(0, count), hidden }
    }
  }

  return { shown: [], hidden: texts.length }
}

// a failure keeps the last good items (stale) and backs off: ttl * 2^fails, capped,
// but never retries sooner than a healthy source would
export const settle = <I>(
  prev: Entry<I> | undefined,
  result: Fetched<I>,
  now: number,
  ttlMs: number,
  jitter = 1,
): Entry<I> => {
  if (result.ok) {
    return { items: result.items, at: now, fails: 0, nextTryAt: now + ttlMs * jitter }
  }

  const fails = (prev?.fails ?? 0) + 1

  return {
    items: prev?.items ?? [],
    at: prev?.at ?? 0,
    error: { reason: result.reason, at: now },
    fails,
    nextTryAt: now + Math.min(ttlMs * 2 ** fails, Math.max(ttlMs, MAX_BACKOFF)),
  }
}

export const due = (entry: Entry<unknown> | undefined, now: number) => !entry || now >= entry.nextTryAt

// pending: enabled, not fetched yet; stale: failing since a good fetch (even an empty one);
// failed: never fetched successfully. The shell formats times, so this stays pure
export const status = (entry: Entry<unknown> | undefined, enabled: boolean) => {
  if (!enabled) {
    return 'disabled'
  }

  if (!entry) {
    return 'pending'
  }

  if (!entry.error) {
    return 'ok'
  }

  return entry.at > 0 ? 'stale' : 'failed'
}
