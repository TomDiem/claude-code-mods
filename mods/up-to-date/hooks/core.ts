// Pure logic: no `$`, no clock, no randomness (time and jitter are passed in)

export type Reason = 'not-connected' | 'tool-error' | 'parse-error' | 'timeout'

export type Fetched<I> = { ok: true; items: I[] } | { ok: false; reason: Reason }

// what a source may reach for, injected so adapters never touch `$`
export type Io = {
  mcp(server: string, tool: string, args: object): Promise<unknown>
  run(argv: string[], options?: { timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

// what one source shows: its levels run from the fullest text to the shortest, rank 0 is the
// most urgent item it holds; the tone only says how loud the shell may draw it
export type Segment = { rank: number; levels: string[]; tone?: 'urgent' | 'alert' | 'active' | 'muted'; stale?: boolean }

// what the details pane lists for a source: one heading per group, a linked row per item
export type Row = { label: string; title: string; url: string; note?: string }
export type Group = { heading: string; rows: Row[] }

type Options = Record<string, unknown>

// items are plain JSON so they can be cached; text is built at render time from `now`
export type Source<I = unknown> = {
  id: string
  label: string
  // leads the source's segment, also when it only says why it is failing
  icon: string
  ttlMs: number
  // the line stays silent while it has never worked: its first fetch can run before the
  // host has connected, and the quiet retry is enough; the pane still says why
  quiet?: boolean
  // a shorter (or longer) wait worked out from what was just fetched; absent: ttlMs
  ttl?(items: I[], now: number): number
  enabled(options: Options): boolean
  fetch(io: Io, now: number): Promise<Fetched<I>>
  // undefined: nothing to show
  segment(items: I[], now: number, options: Options): Segment | undefined
  // the pane's list, most urgent group first; a source without it has no pane section
  details?(items: I[], now: number, options: Options): Group[]
}

export type Entry<I> = {
  items: I[]
  at: number
  error?: { reason: Reason; at: number }
  fails: number
  nextTryAt: number
}

const MAX_BACKOFF = 30 * 60_000
export const SEPARATOR = ' · '

// icons must be emoji-presentation characters from the supplementary plane (🔀 📅): the table
// does not cover the BMP ones (⏰ ✅) that terminals may draw either way
// emoji and East Asian wide characters take two columns; the joiner and the emoji selector none
const isWide = (code: number) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe6f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6) ||
  (code >= 0x1f300 && code <= 0x1f64f) ||
  (code >= 0x1f680 && code <= 0x1f6ff) ||
  (code >= 0x1f900 && code <= 0x1faff) ||
  (code >= 0x20000 && code <= 0x3fffd)

export const cells = (text: string) =>
  [...text].reduce((sum, char) => {
    const code = char.codePointAt(0) as number

    return sum + (code === 0xfe0f || code === 0x200d ? 0 : isWide(code) ? 2 : 1)
  }, 0)

// most urgent first (ties keep source order). Too wide, the least urgent segment shortens
// level by level until it is at its shortest, then the next more urgent one, and so on; if even
// that is too wide the least urgent segment is dropped, the rest start over at their fullest
// level, and the dropped ones are counted in ` · +N`. If not even the most urgent one fits it
// is still returned at its shortest, for the shell to truncate.
export const fit = (segments: Segment[], columns: number) => {
  const ordered = [...segments].sort((a, b) => a.rank - b.rank)

  for (let keep = ordered.length; keep > 0; keep--) {
    const kept = ordered.slice(0, keep)
    const levels = kept.map(() => 0)
    const suffix = keep < ordered.length ? `${SEPARATOR}+${ordered.length - keep}` : ''
    const text = (i: number) => (kept[i] as Segment).levels[levels[i] as number] ?? ''
    const wide = () => cells(kept.map((_, i) => text(i)).join(SEPARATOR) + suffix)

    for (let i = keep - 1; i >= 0 && wide() > columns; i--) {
      while (wide() > columns && (levels[i] as number) < (kept[i] as Segment).levels.length - 1) {
        levels[i] = (levels[i] as number) + 1
      }
    }

    if (wide() <= columns) {
      return { shown: kept.map((segment, i) => ({ segment, text: text(i) })), hidden: ordered.length - keep }
    }
  }

  const first = ordered[0]

  return { shown: first ? [{ segment: first, text: first.levels[first.levels.length - 1] ?? '' }] : [], hidden: 0 }
}

// a failure keeps the last good items (stale) and backs off: ttl * 2^(fails - 1), capped,
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
    nextTryAt: now + Math.min(ttlMs * 2 ** (fails - 1), Math.max(ttlMs, MAX_BACKOFF)),
  }
}

// how long a good fetch stays fresh; a failure backs off from the fixed ttlMs
export const ttlOf = <I>(source: Source<I>, result: Fetched<I>, now: number) =>
  (result.ok && source.ttl?.(result.items, now)) || source.ttlMs

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
