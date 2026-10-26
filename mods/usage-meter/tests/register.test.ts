import { expect, mock, test } from 'claude-code/testing'

const band = {
  plugin: 'usage-meter',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// stands in for the engine drawing beneath the plugins
const empty = ($: any, e: any) => $.ui.resolve(e).Box({})

test('draws context, rate limits and cost, and counts down to the reset', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-24T12:00:00Z') })
  on('ui.render', empty)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({
    context: { tokens: 116_000, window: 200_000, percent: 58 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-24T14:14:00Z' },
      { kind: 'seven_day', percentUsed: 65, resetsAt: '2026-10-26T05:00:00Z' },
    ],
    cost: { usd: 1.84 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  const ui = await $.ui.mount(band)
  const text = async () => (await ui.find({ type: 'Text' }))?.text

  // only the context keeps a bar; the rate limits read as plain percentages
  expect(await text()).toBe(
    'ctx ▓▓▓▓▓▓░░░░ 58% (116k/200k)  ·  5h 23% (resets 2h14m)  ·  7d 65% (resets 1d17h)  ·  $1.84',
  )

  await clock.advance(60_000)

  expect(await text()).toContain('(resets 2h13m)')
})

test('shows what the last main turn added', async ($, on) => {
  let current = { tokens: 100_000, usd: 1.5 }
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: current.tokens, window: 200_000 },
      rateLimits: [],
      cost: { usd: current.usd },
    },
  }))
  on('ui.render', empty)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.turn.start({ text: 'hi', turnId: 't1' })
  current = { tokens: 112_000, usd: 1.71 }
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount(band)

  expect((await ui.find({ type: 'Text', text: /last turn/ }))?.text).toBe('last turn +12k ctx, +$0.21')
})

test('warns once when the context crosses 80%', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))

  for (const percent of [70, 82, 85]) {
    await $.session.measure({
      context: { tokens: percent * 2000, window: 200_000, percent },
      rateLimits: [],
      changed: ['context'],
    })
  }

  expect(toasts).toEqual(['Context at 82%: consider /compact'])
})

const measured = {
  context: { tokens: 116_000, window: 200_000, percent: 58 },
  rateLimits: [],
  changed: ['context'],
} as const

const other = ($: any, e: any) => {
  const { Text } = $.ui.resolve(e)
  return Text({ children: 'other' })
}

test('stacks under another mod instead of replacing it', async ($, on) => {
  on('ui.render', other)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure(measured)

  const ui = await $.ui.mount(band)

  expect((await ui.find({ type: 'Text', text: 'other' }))?.text).toBe('other')
  expect((await ui.find({ type: 'Text', text: /^ctx / }))?.text).toBe('ctx ▓▓▓▓▓▓░░░░ 58% (116k/200k)')
})

test('keeps the other mod visible when there is nothing to draw or a survey is up', async ($, on) => {
  on('ui.render', other)
  on('session.measure', (_, e) => ({ changed: e.changed }))

  // nothing measured yet: only the other mod draws
  const unmeasured = await $.ui.mount(band)
  expect((await unmeasured.find({ type: 'Text', text: 'other' }))?.text).toBe('other')
  expect(await unmeasured.find({ type: 'Text', text: /^ctx / })).toBeUndefined()

  // survey up: usage-meter stays out of the way, the other mod still draws
  await $.session.measure(measured)
  const survey = await $.ui.mount({ ...band, props: { ...band.props, hasSurvey: true } })
  expect((await survey.find({ type: 'Text', text: 'other' }))?.text).toBe('other')
  expect(await survey.find({ type: 'Text', text: /^ctx / })).toBeUndefined()
})
