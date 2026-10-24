import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Context } from '../types'

const context = atom({ plugin: 'usage-meter', key: 'context' } as const, null)

const BAR_WIDTH = 10

const bar = (percent: number) => {
  const filled = Math.round((percent / 100) * BAR_WIDTH)
  return '▓'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

const k = (tokens: number) => `${Math.round(tokens / 1000)}k`

const format = ({ tokens, window, percent }: Context) =>
  `ctx ${bar(percent)} ${percent}% (${k(tokens)}/${k(window)})`

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    const { tokens, window, percent } = e.context

    if (tokens !== undefined && percent !== undefined) {
      await update($, context, () => ({ tokens, window, percent }))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, context)

    if (e.props.hasSurvey || current === null) {
      return next(e)
    }

    const { Text } = $.ui.resolve(e)

    return <Text dimColor>{format(current)}</Text>
  })
}
