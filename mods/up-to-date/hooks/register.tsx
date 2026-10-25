import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { due, fit, settle, status } from './core'
import type { Entry, Io, Line, Source } from './core'
import { github } from './github'

const entries = atom({ plugin: 'up-to-date', key: 'entries' } as const, {})
const now = atom({ plugin: 'up-to-date', key: 'now' } as const, 0)

const MINUTE = 60_000
const SEPARATOR = ' · '
const sources: Source<any>[] = [github]

const storeKey = (source: Source) => `up-to-date:v1:${source.id}`

// jitter spreads the sessions that share one store so they do not all fetch together
const jitter = () => 0.9 + Math.random() * 0.2

const ioOf = ($: EngineInterface): Io => ({
  mcp: (server, tool, args) => $.mcp.call(server, tool, args as Record<string, unknown>),
  run: (argv, options) => $.process.run(argv, options),
})

// the store is shared and outlives versions: trust only what has the shape of an entry
const isEntry = (value: unknown): value is Entry<unknown> => {
  const entry = value as Partial<Entry<unknown>> | undefined

  return Array.isArray(entry?.items) && [entry.at, entry.fails, entry.nextTryAt].every(n => typeof n === 'number')
}

// a store that misbehaves only costs the sharing between sessions: this session still polls
const fromStore = async ($: EngineInterface, source: Source) => {
  try {
    const value = await $.store.get(storeKey(source))

    return isEntry(value) ? value : undefined
  } catch {
    return undefined
  }
}

const toStore = async ($: EngineInterface, source: Source, entry: Entry<unknown>) => {
  try {
    await $.store.set(storeKey(source), entry)
  } catch {}
}

const refresh = async ($: EngineInterface, source: Source, time: number) => {
  let entry = (await read($, entries))[source.id]
  const shared = await fromStore($, source)

  // another session may have fetched since: take its result instead of fetching again
  if (shared && shared.nextTryAt > (entry?.nextTryAt ?? 0)) {
    entry = shared
  }

  if (due(entry, time)) {
    entry = settle(entry, await source.fetch(ioOf($), time), time, source.ttlMs, jitter())
    await toStore($, source, entry)
  }

  await update($, entries, all => ({ ...all, [source.id]: entry as Entry<unknown> }))
}

// a source that never worked says why; one that did keeps its last items, marked stale
const linesOf = (source: Source, entry: Entry<unknown> | undefined, time: number, options: Record<string, unknown>): Line[] => {
  if (status(entry, true) === 'failed') {
    return [{ rank: 3, text: `${source.id}: ${entry?.error?.reason}`, detail: '' }]
  }

  const mark = status(entry, true) === 'stale' ? '~' : ''

  return source.lines(entry?.items ?? [], time, options).map(line => ({ ...line, text: mark + line.text }))
}

export const register: Register = (on, options) => {
  const enabled = sources.filter(source => source.enabled(options))
  let timer: ReturnType<EngineInterface['clock']['every']> | undefined
  const busy = new Set<string>()

  on('session.start', async ($, e, next) => {
    // never rejects: a failed tick must not break the session or the interval
    const tick = async () => {
      try {
        const time = await $.clock.now()
        await update($, now, () => time)

        await Promise.all(
          enabled
            .filter(source => !busy.has(source.id))
            .map(async source => {
              busy.add(source.id)

              try {
                await refresh($, source, time)
              } finally {
                busy.delete(source.id)
              }
            }),
        )
      } catch {}
    }

    // only a person at the prompt sees the line: -p runs and the SDK do not poll
    if (enabled.length > 0 && e.isInteractive) {
      timer?.cancel()
      timer = $.clock.every(MINUTE, tick)
      void tick()
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    const all = await read($, entries)
    const time = await read($, now)
    const lines = enabled.flatMap(source => linesOf(source, all[source.id], time, options))
    const { shown, hidden } = fit(lines, e.props.bodyColumns)

    if (e.props.hasSurvey || shown.length === 0) {
      return rest
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rest}
        <Text dimColor>{shown.join(SEPARATOR) + (hidden > 0 ? `${SEPARATOR}+${hidden}` : '')}</Text>
      </Box>
    )
  })
}
