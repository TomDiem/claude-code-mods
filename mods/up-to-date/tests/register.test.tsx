import { expect, mock, test } from 'claude-code/testing'

const MINUTE = 60_000
const START = Date.parse('2026-10-25T12:00:00Z')

const band = {
  plugin: 'up-to-date',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const github = { options: { github: true } }

// stands in for the engine drawing beneath the plugins
const empty = ($: any, e: any) => $.ui.resolve(e).Box({})

const review = (number: number) => ({ number, title: 't', url: `u${number}`, repository: { name: 'app' } })
const truncation = { isStdoutTruncated: false, isStderrTruncated: false }
const reply = (...numbers: number[]) => ({
  ...truncation,
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify({ data: { review: { nodes: numbers.map(review) }, mine: { nodes: [] } } }),
})
const broken = { ...truncation, exitCode: 1, stdout: '', stderr: 'HTTP 502' }

// fakes gh and the world beneath the plugins; `answers` is what each gh call gets, the last one repeating
const world = async (
  $: any,
  on: any,
  answers: object[],
  store?: Record<string, unknown>,
  beneath = empty,
  isInteractive = true,
) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on, store)
  on('ui.render', beneath)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))

  let calls = 0
  on('process.run', () => ({ value: answers[Math.min(calls++, answers.length - 1)] }))

  const start = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive })
  await start()
  // the first tick runs in the background: let it land
  await clock.advance(0)

  const texts = async () => (await (await $.ui.mount(band)).findAll({ type: 'Text' })).map((t: any) => t.text)

  return { clock, texts, calls: () => calls, start }
}

test('draws nothing and runs nothing while no source is enabled', async ($, on) => {
  const { clock, texts, calls } = await world($, on, [reply(1)])

  await clock.advance(10 * MINUTE)

  expect(calls()).toBe(0)
  expect(await texts()).toEqual([])
})

test('draws the GitHub line, refetching only once the ttl has passed', { ...github }, async ($, on) => {
  const { clock, texts, calls } = await world($, on, [reply(1), reply(2)])

  expect(await texts()).toEqual(['review app#1'])

  await clock.advance(4 * MINUTE)
  expect(calls()).toBe(1)

  await clock.advance(2 * MINUTE)
  expect(calls()).toBe(2)
  expect(await texts()).toEqual(['review app#2'])
})

test('uses a fresh cached entry instead of fetching', { ...github }, async ($, on) => {
  const item = { repo: 'app', number: 9, title: 't', url: 'u9', reason: 'ci', draft: false }
  const entry = { items: [item], at: START, fails: 0, nextTryAt: START + 5 * MINUTE }
  const { clock, texts, calls } = await world($, on, [reply(1)], { 'up-to-date:v1:github': entry })

  expect(await texts()).toEqual(['ci app#9'])

  await clock.advance(MINUTE)
  expect(calls()).toBe(0)
})

test('marks a failing source stale and backs off', { ...github }, async ($, on) => {
  const { clock, texts, calls } = await world($, on, [reply(1), broken, reply(2)])

  // the ttl is 5 minutes give or take jitter, so the failure lands on minute 5 or 6
  await clock.advance(6 * MINUTE)
  expect(calls()).toBe(2)
  expect(await texts()).toEqual(['~review app#1'])

  // the retry waits for the backoff (10 minutes after the failure), not the next tick
  await clock.advance(8 * MINUTE)
  expect(calls()).toBe(2)

  await clock.advance(2 * MINUTE)
  expect(calls()).toBe(3)
  expect(await texts()).toEqual(['review app#2'])
})

test('does not wait for the first fetch to start the session', { ...github }, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  on('ui.render', empty)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('process.run', () => new Promise(() => {}))

  let started = false
  void $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true }).then(() => (started = true))
  await clock.settle()

  expect(started).toBe(true)
})

test('keeps one interval when the session starts twice', { ...github }, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  const cache = new Map<string, unknown>()
  let reads = 0

  // every tick reads the shared cache once: a leftover interval would read twice per period
  on('store.get', (_: any, e: any) => {
    reads += e.key.startsWith('up-to-date:') ? 1 : 0
    return { value: cache.get(e.key) }
  })
  on('store.set', (_: any, e: any) => {
    cache.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.render', empty)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: reply(1) }))

  // overlapping starts: the second arrives while the first is still setting up
  const start = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await Promise.all([start(), start()])
  await clock.advance(0)

  reads = 0
  await clock.advance(3 * MINUTE)
  expect(reads).toBe(3)
})

test('polls only in an interactive session', { ...github }, async ($, on) => {
  const { clock, calls } = await world($, on, [reply(1)], undefined, empty, false)

  await clock.advance(10 * MINUTE)

  expect(calls()).toBe(0)
})

const nextTryAt = START + 5 * MINUTE
const malformed = {
  'items that are not a list': { items: 'oops', at: START, fails: 0, nextTryAt },
  'a retry time that is not a number': { items: [], at: START, fails: 0, nextTryAt: 'soon' },
  'a fail count that is not a number': { items: [], at: START, fails: 'none', nextTryAt },
  'a time that is not a number': { items: [], at: 'now', fails: 0, nextTryAt },
}

for (const [what, entry] of Object.entries(malformed)) {
  test(`ignores a cached entry with ${what} and fetches`, { ...github }, async ($, on) => {
    const { texts, calls } = await world($, on, [reply(1)], { 'up-to-date:v1:github': entry })

    expect(calls()).toBe(1)
    expect(await texts()).toEqual(['review app#1'])
  })
}

test('says why a source failed when it never worked', { ...github }, async ($, on) => {
  const { texts } = await world($, on, [broken])

  expect(await texts()).toEqual(['github: tool-error'])
})

test('stacks under another mod and leaves a survey alone', { ...github }, async ($, on) => {
  const other = ($: any, e: any) => $.ui.resolve(e).Text({ children: 'other' })
  const { texts } = await world($, on, [reply(1)], undefined, other)

  expect(await texts()).toEqual(['other', 'review app#1'])

  const survey = await $.ui.mount({ ...band, props: { ...band.props, hasSurvey: true } })
  expect((await survey.findAll({ type: 'Text' })).map((t: any) => t.text)).toEqual(['other'])
})
