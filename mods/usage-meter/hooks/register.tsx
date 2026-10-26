import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Turn, Usage } from '../types'

const usage = atom({ plugin: 'usage-meter', key: 'usage' } as const, null)
const last = atom({ plugin: 'usage-meter', key: 'last' } as const, null)
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)

const MINUTE = 60_000
const WARN_PERCENT = 80
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

const BAR_WIDTH = 10

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`

const bar = (percent: number) => {
  const filled = Math.round((Math.min(percent, 100) / 100) * BAR_WIDTH)
  return '▓'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

const dollars = (amount: number) => `$${amount.toFixed(2)}`

const signed = (n: number, unit: (n: number) => string) => `${n < 0 ? '-' : '+'}${unit(Math.abs(n))}`

const duration = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  if (days > 0) {
    return `${days}d${hours}h`
  }

  return hours > 0 ? `${hours}h${minutes % 60}m` : `${minutes}m`
}

const totals = ({ context, rateLimits, usd }: Usage, time: number) => {
  const parts: string[] = []

  if (context.tokens !== undefined && context.percent !== undefined) {
    parts.push(`ctx ${bar(context.percent)} ${context.percent}% (${k(context.tokens)}/${k(context.window)})`)
  }

  for (const { kind, percentUsed, resetsAt } of rateLimits) {
    const reset = resetsAt ? ` (resets ${duration(Date.parse(resetsAt) - time)})` : ''
    parts.push(`${LABELS[kind] ?? kind}: ${percentUsed}%${reset}`)
  }

  if (usd !== undefined) {
    parts.push(dollars(usd))
  }

  return parts.join('  ·  ')
}

const delta = ({ tokens, usd }: Turn) => `last turn ${signed(tokens, k)} ctx, ${signed(usd, dollars)}`

const snapshot = async ($: EngineInterface): Promise<Turn | null> => {
  const { context, cost } = await $.session.usage()
  return context.tokens === undefined ? null : { tokens: context.tokens, usd: cost?.usd ?? 0 }
}

export const register: Register = on => {
  let baseline: Turn | null = null

  on('session.start', async ($, e, next) => {
    const tick = async () => {
      const time = await $.clock.now()
      await update($, now, () => time)
    }

    await tick()
    $.clock.every(MINUTE, tick)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const previous = (await read($, usage))?.context.percent ?? 0
    const percent = e.context.percent ?? 0

    if (previous < WARN_PERCENT && percent >= WARN_PERCENT) {
      $.ui.toast(`Context at ${percent}%: consider /compact`)
    }

    await update($, usage, () => ({ context: e.context, rateLimits: e.rateLimits, usd: e.cost?.usd }))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      baseline = await snapshot($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const before = baseline

    if (!e.agentId && before) {
      baseline = null
      const after = await snapshot($)

      if (after) {
        await update($, last, () => ({ tokens: after.tokens - before.tokens, usd: after.usd - before.usd }))
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    const current = await read($, usage)
    const turn = await read($, last)
    const summary = current ? totals(current, await read($, now)) : ''
    const change = turn ? delta(turn) : ''

    if (e.props.hasSurvey || (!summary && !change)) {
      return rest
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rest}
        {summary ? <Text dimColor>{summary}</Text> : null}
        {change ? <Text dimColor>{change}</Text> : null}
      </Box>
    )
  })
}
