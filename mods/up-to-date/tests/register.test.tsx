import { expect, mock, test } from 'claude-code/testing'

import { fit } from '../hooks/core'
import type { Segment } from '../hooks/core'
import { line } from '../hooks/line'

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

  expect(await texts()).toEqual(['🔀 app#1 review requested'])

  await clock.advance(4 * MINUTE)
  expect(calls()).toBe(1)

  await clock.advance(2 * MINUTE)
  expect(calls()).toBe(2)
  expect(await texts()).toEqual(['🔀 app#2 review requested'])
})

test('uses a fresh cached entry instead of fetching', { ...github }, async ($, on) => {
  const item = { repo: 'app', number: 9, title: 't', url: 'u9', reason: 'ci', draft: false }
  const entry = { items: [item], at: START, fails: 0, nextTryAt: START + 5 * MINUTE }
  const { clock, texts, calls } = await world($, on, [reply(1)], { 'up-to-date:v1:github': entry })

  expect(await texts()).toEqual(['🔀 app#9 CI failing'])

  await clock.advance(MINUTE)
  expect(calls()).toBe(0)
})

test('marks a failing source stale and backs off', { ...github }, async ($, on) => {
  const { clock, texts, calls } = await world($, on, [reply(1), broken, reply(2)])

  // the ttl is 5 minutes give or take jitter, so the failure lands on minute 5 or 6
  await clock.advance(6 * MINUTE)
  expect(calls()).toBe(2)
  expect(await texts()).toEqual(['~🔀 app#1 review requested'])

  // the retry waits for the backoff (5 minutes after the failure), not the next tick
  await clock.advance(3 * MINUTE)
  expect(calls()).toBe(2)

  await clock.advance(3 * MINUTE)
  expect(calls()).toBe(3)
  expect(await texts()).toEqual(['🔀 app#2 review requested'])
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

const calendar = { options: { calendar: true } }

test('fetches only Calendar when only Calendar is enabled, and counts down on the minute tick', { ...calendar }, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  on('ui.render', empty)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))

  let runs = 0
  let asked = 0
  const standup = { id: 's', summary: 'Standup', htmlLink: 'u', start: { dateTime: new Date(START + 12 * MINUTE).toISOString() }, end: { dateTime: new Date(START + 42 * MINUTE).toISOString() } }
  on('process.run', () => ({ value: (runs++, reply(1)) }))
  on('mcp.call', () => ({ value: (asked++, { content: [{ type: 'text', text: JSON.stringify({ events: [standup] }) }], isError: false }) }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)

  const texts = async () => (await (await $.ui.mount(band)).findAll({ type: 'Text' })).map((t: any) => t.text)

  expect(await texts()).toEqual(['📅 in 12m: Standup'])

  await clock.advance(MINUTE)
  expect(await texts()).toEqual(['📅 in 11m: Standup'])
  expect([runs, asked]).toEqual([0, 1])
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
    expect(await texts()).toEqual(['🔀 app#1 review requested'])
  })
}

test('says why a source failed when it never worked', { ...github }, async ($, on) => {
  const { texts } = await world($, on, [broken])

  expect(await texts()).toEqual(['🔀 github: tool-error'])
})

const texted = async ($: any) => (await (await $.ui.mount(band)).findAll({ type: 'Text' })) as any[]

test('colors the segment by urgency with theme colors: warning for a review, error for failing CI', { ...github }, async ($, on) => {
  await world($, on, [reply(1)])
  const [review] = await texted($)

  expect(review.text).toBe('🔀 app#1 review requested')
  expect(review.props).toMatchObject({ color: 'warning' })
  expect(review.props.dimColor).toBeFalsy()
})

test('draws failing CI in the error color',{ ...github }, async ($, on) => {
  const item = { repo: 'app', number: 9, title: 't', url: 'u9', reason: 'ci', draft: false }
  const entry = { items: [item], at: START, fails: 0, nextTryAt: START + 5 * MINUTE }
  await world($, on, [reply(1)], { 'up-to-date:v1:github': entry })
  const [ci] = await texted($)

  expect(ci.text).toBe('🔀 app#9 CI failing')
  expect(ci.props).toMatchObject({ color: 'error' })
})

test('draws a stale segment dim, not colored', { ...github }, async ($, on) => {
  const { clock } = await world($, on, [reply(1), broken])

  await clock.advance(6 * MINUTE)
  const [stale] = await texted($)

  expect(stale.text).toBe('~🔀 app#1 review requested')
  expect(stale.props).toMatchObject({ dimColor: true })
  expect(stale.props.color).toBeUndefined()
})

test('draws a failing source dim, with no color', { ...github }, async ($, on) => {
  await world($, on, [broken])
  const [failed] = await texted($)

  expect(failed.text).toBe('🔀 github: tool-error')
  expect(failed.props).toMatchObject({ dimColor: true })
  expect(failed.props.color).toBeUndefined()
})

test('refetches Calendar after 2 minutes when a meeting is within 30 minutes', { ...calendar }, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  on('ui.render', empty)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))

  let asked = 0
  const soon = { id: 's', summary: 'Standup', htmlLink: 'u', start: { dateTime: new Date(START + 20 * MINUTE).toISOString() }, end: { dateTime: new Date(START + 60 * MINUTE).toISOString() } }
  on('mcp.call', () => ({ value: (asked++, { content: [{ type: 'text', text: JSON.stringify({ events: [soon] }) }], isError: false }) }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  expect(asked).toBe(1)

  // the 2 minute ttl is 1.8 to 2.2 minutes with jitter: by the third tick it is due
  await clock.advance(3 * MINUTE)
  expect(asked).toBe(2)
})

test('does not call the connector while Calendar is disabled', { ...github }, async ($, on) => {
  let asked = 0
  on('mcp.call', () => ({ value: (asked++, { content: [], isError: false }) }))
  const { clock } = await world($, on, [reply(1)])

  await clock.advance(10 * MINUTE)

  expect(asked).toBe(0)
})

test('says why Calendar failed when it never worked, dim like GitHub', { ...calendar }, async ($, on) => {
  on('mcp.call', () => {
    throw new Error('the host refused the call')
  })
  await world($, on, [reply(1)])
  const [failed] = await texted($)

  expect(failed.text).toBe('📅 calendar: tool-error')
  expect(failed.props).toMatchObject({ dimColor: true })
})

test('keeps a meeting within 15 minutes over a review request when only one fits', { options: { github: true, calendar: true } }, async ($, on) => {
  const standup = { id: 's', summary: 'Standup', htmlLink: 'u', start: { dateTime: new Date(START + 12 * MINUTE).toISOString() }, end: { dateTime: new Date(START + 42 * MINUTE).toISOString() } }
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ events: [standup] }) }], isError: false } }))
  await world($, on, [reply(1)])
  const narrow = await $.ui.mount({ ...band, props: { ...band.props, bodyColumns: 16 } })

  // both are rank 0: the meeting does not wait, the review can
  expect((await narrow.findAll({ type: 'Text' })).map((t: any) => t.text)).toEqual(['📅 in 12m', ' · +1'])
})

const segment = (rank: number, tone: Segment['tone'], ...levels: string[]): Segment => ({ rank, tone, levels })
const reviewSegment = segment(0, 'urgent', '🔀 app#12 review requested', '🔀 #12 review', '🔀 1 PR')
const standup = segment(1, 'active', '📅 Standup in 12 min', '📅 12 min', '📅 1')

// draws what fit chooses for these segments, as the shell does, on an otherwise empty band
const drawn = async ($: any, on: any, segments: Segment[], columns: number) => {
  const { shown, hidden } = fit(segments, columns)
  on('ui.render', ($: any, e: any) => line($.ui.resolve(e), shown, hidden, () => {}))

  return texted($)
}

test('fits the line to the body columns, down to the exact column', { ...github }, async ($, on) => {
  const { texts } = await world($, on, [reply(1)])
  const mount = async (bodyColumns: number) =>
    (await (await $.ui.mount({ ...band, props: { ...band.props, bodyColumns } })).findAll({ type: 'Text' })).map((t: any) => t.text)

  // '🔀 app#1 review requested' is 25 wide, flush left with no padding
  expect(await mount(25)).toEqual(['🔀 app#1 review requested'])
  expect(await mount(24)).toEqual(['🔀 #1 review'])
  expect(await texts()).toEqual(['🔀 app#1 review requested'])
})

test('shortens a failing source to its icon and a bang on a narrow terminal', { ...github }, async ($, on) => {
  await world($, on, [broken])
  const narrow = await $.ui.mount({ ...band, props: { ...band.props, bodyColumns: 8 } })

  expect((await narrow.findAll({ type: 'Text' })).map((t: any) => t.text)).toEqual(['🔀 !'])
})

test('draws a dim separator between segments and colors each by its tone', async ($, on) => {
  const [first, separator, second] = await drawn($, on, [standup, reviewSegment], 80)

  expect([first.text, separator.text, second.text]).toEqual(['🔀 app#12 review requested', ' · ', '📅 Standup in 12 min'])
  expect(separator.props).toMatchObject({ dimColor: true })
  expect(first.props).toMatchObject({ color: 'warning' })
  expect(second.props).toMatchObject({ color: 'suggestion' })
})

test('says how many segments were dropped, dim, after the ones that fit', async ($, on) => {
  // '🔀 1 PR' is 6 wide and ' · +1' is 5
  const parts = await drawn($, on, [reviewSegment, standup], 12)

  expect(parts.map(t => t.text)).toEqual(['🔀 1 PR', ' · +1'])
  expect(parts[1].props).toMatchObject({ dimColor: true })
})

test('stacks under another mod and leaves a survey alone', { ...github }, async ($, on) => {
  const other = ($: any, e: any) => $.ui.resolve(e).Text({ children: 'other' })
  const { texts } = await world($, on, [reply(1)], undefined, other)

  expect(await texts()).toEqual(['other', '🔀 app#1 review requested'])

  const survey = await $.ui.mount({ ...band, props: { ...band.props, hasSurvey: true } })
  expect((await survey.findAll({ type: 'Text' })).map((t: any) => t.text)).toEqual(['other'])
})

const opened = (on: any) => {
  const calls: any[] = []
  on('ui.open', (_: any, e: any) => {
    calls.push(e)
    return { value: { isPlaced: true } }
  })

  return calls
}

const pane = {
  plugin: 'up-to-date',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'up-to-date',
  props: { title: 'Up to date', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

// a row is the Text holding the indent, the link (its text leads with the href) and the dim title
const body = async ($: any) => {
  const mounted = await $.ui.mount(pane)
  const texts: string[] = (await mounted.findAll({ type: 'Text' })).map((t: any) => t.text as string)

  return {
    texts,
    links: (await mounted.findAll({ type: 'Link' })).map((l: any) => [l.text.replace(l.props.href, ''), l.props.href]),
    row: async (url: string) => texts.find(text => text.includes(url)),
  }
}

test('draws the line as one plain button, so a click on any part of it presses', { ...github }, async ($, on) => {
  await world($, on, [reply(1)])
  const buttons = await (await $.ui.mount(band)).findAll({ type: 'Button' })

  expect(buttons).toHaveLength(1)
  expect(buttons[0]?.key).toBe('up-to-date:line')
  expect(buttons[0]?.props).toMatchObject({ plain: true })
})

test('opens the details pane, closed by Escape, when the line is pressed', { ...github }, async ($, on) => {
  const calls = opened(on)
  await world($, on, [reply(1)])

  await (await $.ui.mount(band)).press({ key: 'up-to-date:line' })

  expect(calls).toEqual([expect.objectContaining({ id: 'up-to-date', title: 'Up to date', focus: true, closeOnEscape: true })])
})

test('lists the items in the pane, each linking to its PR, from what is already fetched', { ...github }, async ($, on) => {
  const items = [
    { repo: 'app', number: 9, title: 'Fix login', url: 'https://github.com/acme/app/pull/9', reason: 'ci', draft: true },
    { repo: 'app', number: 4, title: 'Add search', url: 'https://github.com/acme/app/pull/4', reason: 'review', draft: false },
  ]
  const entry = { items, at: START, fails: 0, nextTryAt: START + 5 * MINUTE }
  const { calls } = await world($, on, [reply(1)], { 'up-to-date:v1:github': entry })
  const { texts, links, row } = await body($)

  expect(texts.filter(text => text.startsWith('🔀'))).toEqual(['🔀 Review requested', '🔀 CI failing'])
  expect(links).toEqual([
    ['app#4', 'https://github.com/acme/app/pull/4'],
    ['app#9', 'https://github.com/acme/app/pull/9'],
  ])
  expect(texts).toContain(' Add search')
  expect(texts).toContain(' Fix login (draft)')
  expect(await row('https://github.com/acme/app/pull/4')).toMatch(/^ {2}[^ ]/)
  expect(calls()).toBe(0)
})

test('draws no trailing space for a PR without a title', { ...github }, async ($, on) => {
  const item = { repo: 'app', number: 4, title: '', url: 'u4', reason: 'review', draft: false }
  const entry = { items: [item], at: START, fails: 0, nextTryAt: START + 5 * MINUTE }
  await world($, on, [reply(1)], { 'up-to-date:v1:github': entry })
  const { row } = await body($)

  expect(await row('u4')).toBe('  u4app#4')
})

test('says dimly how old a stale source is', { ...github }, async ($, on) => {
  const { clock } = await world($, on, [reply(1), broken])

  await clock.advance(6 * MINUTE)

  expect((await body($)).texts).toContain('GitHub: last updated 6 min ago')
})

test('still says how old a stale source is when its last good fetch was empty', { ...github }, async ($, on) => {
  const { clock } = await world($, on, [reply(), broken])

  await clock.advance(6 * MINUTE)

  expect((await body($)).texts).toEqual(['🔀 GitHub: last updated 6 min ago'])
})

test('says it is checking while the first fetch has not landed', { ...github }, async ($, on) => {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  on('ui.render', empty)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('process.run', () => new Promise(() => {}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(0)

  expect((await body($)).texts).toEqual(['🔀 GitHub: checking…'])
})

test('says why a source that never worked has nothing to list', { ...github }, async ($, on) => {
  await world($, on, [broken])

  expect((await body($)).texts).toEqual(['🔀 GitHub: tool-error'])
})

test('says nothing needs you when every enabled source is fine and empty', { ...github }, async ($, on) => {
  await world($, on, [reply()])

  expect((await body($)).texts).toEqual(['Nothing needs you.'])
})

test('says nothing needs you when no source is enabled', async ($, on) => {
  await world($, on, [reply(1)])

  expect((await body($)).texts).toEqual(['Nothing needs you.'])
})

test('draws nothing for a pane that is not its own', { ...github }, async ($, on) => {
  await world($, on, [reply(1)])
  const other = await $.ui.mount({ ...pane, requestId: 'other' })

  expect(await other.findAll({ type: 'Link' })).toEqual([])
})
