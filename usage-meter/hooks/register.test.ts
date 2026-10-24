import { expect, test } from 'claude-code/testing'

const band = {
  plugin: 'usage-meter',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('draws the context bar once the session is measured', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 116_000, window: 200_000, percent: 58 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount(band)

  expect((await ui.find({ type: 'Text' }))?.text).toBe('ctx ▓▓▓▓▓▓░░░░ 58% (116k/200k)')
})
