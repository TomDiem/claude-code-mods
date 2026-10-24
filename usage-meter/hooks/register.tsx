import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'usage-meter', key: 'usage' } as const, null)
const now = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)

const BAR_WIDTH = 10
const MINUTE = 60_000
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

const bar = (percent: number) => {
  const filled = Math.round((Math.min(percent, 100) / 100) * BAR_WIDTH)
  return '▓'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`

const duration = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  if (days > 0) {
    return `${days}d${hours}h`
  }

  return hours > 0 ? `${hours}h${minutes % 60}m` : `${minutes}m`
}

const format = ({ context, rateLimits, usd }: Usage, time: number) => {
  const parts: string[] = []

  if (context.tokens !== undefined && context.percent !== undefined) {
    parts.push(`ctx ${bar(context.percent)} ${context.percent}% (${k(context.tokens)}/${k(context.window)})`)
  }

  for (const { kind, percentUsed, resetsAt } of rateLimits) {
    const reset = resetsAt ? ` (resets ${duration(Date.parse(resetsAt) - time)})` : ''
    parts.push(`${LABELS[kind] ?? kind} ${bar(percentUsed)} ${percentUsed}%${reset}`)
  }

  if (usd !== undefined) {
    parts.push(`$${usd.toFixed(2)}`)
  }

  return parts.join('  ·  ')
}

export const register: Register = on => {
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
    await update($, usage, () => ({ context: e.context, rateLimits: e.rateLimits, usd: e.cost?.usd }))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, usage)
    const line = current && format(current, await read($, now))

    if (e.props.hasSurvey || !line) {
      return next(e)
    }

    const { Text } = $.ui.resolve(e)

    return <Text dimColor>{line}</Text>
  })
}
