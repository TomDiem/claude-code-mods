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

test('draws context, rate limits and cost, and counts down to the reset', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-24T12:00:00Z') })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({
    context: { tokens: 116_000, window: 200_000, percent: 58 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-24T14:14:00Z' }],
    cost: { usd: 1.84 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  const ui = await $.ui.mount(band)
  const text = async () => (await ui.find({ type: 'Text' }))?.text

  expect(await text()).toBe('ctx ▓▓▓▓▓▓░░░░ 58% (116k/200k)  ·  5h ▓▓░░░░░░░░ 23% (resets 2h14m)  ·  $1.84')

  await clock.advance(60_000)

  expect(await text()).toContain('(resets 2h13m)')
})
