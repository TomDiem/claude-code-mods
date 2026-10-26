import { expect, test } from 'claude-code/testing'

import type { Io } from '../hooks/core'
import { calendar } from '../hooks/calendar'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// local times, so the clock text does not depend on the machine's time zone
const at = (hour: number, minute = 0, day = 26) => new Date(2026, 9, day, hour, minute).getTime()
const NOW = at(12)

const event = (id: string, startAt: number, endAt: number, extra: object = {}) => ({
  id,
  summary: `Event ${id}`,
  status: 'confirmed',
  htmlLink: `https://calendar.google.com/event?eid=${id}`,
  start: { dateTime: new Date(startAt).toISOString() },
  end: { dateTime: new Date(endAt).toISOString() },
  attendees: [{ email: 'me@acme.dev', self: true, responseStatus: 'accepted' }],
  ...extra,
})

const item = (id: string, start: number, end: number, title = `Event ${id}`) => ({
  id,
  title,
  start,
  end,
  url: `https://calendar.google.com/event?eid=${id}`,
})

const reply = (body: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(body) }], isError: false })

const ioWith = (result: unknown | Error, calls: unknown[][] = []): Io => ({
  mcp: async (...args) => {
    calls.push(args)

    if (result instanceof Error) {
      throw result
    }

    return result
  },
  run: async () => {
    throw new Error('calendar does not use run')
  },
})

const fetched = async (body: unknown) => calendar.fetch(ioWith(reply(body)), NOW)

test('keeps the timed events that can take my time', async () => {
  const result = await fetched({
    events: [
      event('a', at(13), at(14)),
      event('cancelled', at(13), at(14), { status: 'cancelled' }),
      event('declined', at(13), at(14), { attendees: [{ email: 'me@acme.dev', self: true, responseStatus: 'declined' }] }),
      event('allday', at(13), at(14), { start: { date: '2026-10-26' }, end: { date: '2026-10-27' } }),
      event('free', at(13), at(14), { transparency: 'transparent' }),
      event('available', at(13), at(14), { availability: 'AVAILABILITY_FREE' }),
      event('tentative', at(15), at(16), { status: 'tentative', attendees: [{ email: 'other@acme.dev', responseStatus: 'declined' }] }),
    ],
  })

  expect(result).toEqual({
    ok: true,
    items: [item('a', at(13), at(14)), item('tentative', at(15), at(16))],
  })
})

test('drops out-of-office, focus time and working location, keeps Gmail events and ones without a type', async () => {
  const result = await fetched({
    events: [
      event('ooo', at(13), at(14), { eventType: 'OUT_OF_OFFICE' }),
      event('focus', at(13), at(14), { eventType: 'FOCUS_TIME' }),
      event('where', at(13), at(14), { eventType: 'WORKING_LOCATION' }),
      event('gmail', at(13), at(14), { eventType: 'FROM_GMAIL' }),
      event('default', at(15), at(16), { eventType: 'DEFAULT' }),
      event('untyped', at(17), at(18)),
    ],
  })

  expect(result.ok && result.items.map(i => i.id)).toEqual(['gmail', 'default', 'untyped'])
})

test('keeps an event without attendees, titles one without a summary, and skips one without an end', async () => {
  const result = await fetched({
    events: [
      event('solo', at(13), at(14), { attendees: undefined, summary: undefined }),
      event('open', at(15), at(16), { end: undefined }),
    ],
  })

  expect(result).toEqual({ ok: true, items: [{ ...item('solo', at(13), at(14)), title: '(no title)' }] })
})

test('treats a response without events as an empty calendar', async () => {
  expect(await fetched({ summary: 'me', timeZone: 'UTC' })).toEqual({ ok: true, items: [] })
})

test('asks list_events for the next events in start order', async () => {
  const calls: unknown[][] = []

  await calendar.fetch(ioWith(reply({}), calls), NOW)

  expect(calls).toEqual([['claude.ai Google Calendar', 'list_events', { pageSize: 100, orderBy: 'startTime' }]])
})

test('is enabled only when the calendar option is on', () => {
  expect(calendar.enabled({ calendar: true })).toBe(true)
  expect(calendar.enabled({ calendar: false })).toBe(false)
  expect(calendar.enabled({})).toBe(false)
})

test('reports a server that is not connected as not-connected', async () => {
  for (const message of ['Server "claude.ai Google Calendar" is not connected', 'Unauthorized', 'MCP server not found']) {
    expect(await calendar.fetch(ioWith(new Error(message)), NOW)).toEqual({ ok: false, reason: 'not-connected' })
  }
})

test('reports a failed call that says it is not connected as not-connected', async () => {
  const failed = { content: [{ type: 'text', text: 'Unauthorized: sign in again' }], isError: true }

  expect(await calendar.fetch(ioWith(failed), NOW)).toEqual({ ok: false, reason: 'not-connected' })
})

test('reports any other rejection and a failed call as tool-error', async () => {
  const failed = { content: [{ type: 'text', text: 'boom' }], isError: true }

  expect(await calendar.fetch(ioWith(new Error('the host refused the call')), NOW)).toEqual({ ok: false, reason: 'tool-error' })
  expect(await calendar.fetch(ioWith(failed), NOW)).toEqual({ ok: false, reason: 'tool-error' })
})

test('reports bad JSON and a drifted shape as parse-error', async () => {
  const parseError = { ok: false, reason: 'parse-error' }

  expect(await calendar.fetch(ioWith({ content: [{ type: 'text', text: 'not json' }], isError: false }), NOW)).toEqual(parseError)
  expect(await calendar.fetch(ioWith({ content: [], isError: false }), NOW)).toEqual(parseError)
  expect(await fetched('events')).toEqual(parseError)
  expect(await fetched(null)).toEqual(parseError)
  expect(await fetched({ events: 'none' })).toEqual(parseError)
})

const segmentOf = (items: object[], now = NOW, options: Record<string, unknown> = {}) =>
  calendar.segment(items as never[], now, options)

test('says how long until a meeting about to start, in the warning tone and first in rank', () => {
  expect(segmentOf([item('s', at(12, 12), at(13), 'Standup'), item('r', at(13), at(14))])).toEqual({
    rank: 0,
    tone: 'urgent',
    levels: ['📅 in 12m: Standup +1', '📅 in 12m +1', '📅 2 meetings'],
  })
})

test('shows the clock time of a meeting further out, ranking it by how near it is', () => {
  expect(segmentOf([item('p', at(13, 30), at(14), 'Planning')])).toEqual({
    rank: 2,
    levels: ['📅 13:30 Planning', '📅 13:30', '📅 1 meeting'],
  })
  expect(segmentOf([item('p', at(14, 30), at(15), 'Planning')])).toMatchObject({ rank: 3 })
})

test('adds the weekday to a meeting that is not today', () => {
  expect(segmentOf([item('p', at(9, 0, 28), at(10, 0, 28), 'Planning')])?.levels[0]).toBe('📅 Wed 09:00 Planning')
})

test('never rounds a countdown up to 60m, and ranks by the exact 15m and 2h boundaries', () => {
  expect(segmentOf([item('p', NOW + 59 * MINUTE + 30_000, NOW + 2 * HOUR)])?.levels[0]).toBe('📅 12:59 Event p')
  expect(segmentOf([item('p', NOW + 59 * MINUTE, NOW + 2 * HOUR)])?.levels[0]).toBe('📅 in 59m: Event p')
  expect(segmentOf([item('p', NOW + 15 * MINUTE, NOW + HOUR)])).toMatchObject({ rank: 0, tone: 'urgent' })
  expect(segmentOf([item('p', NOW + 15 * MINUTE + 1, NOW + HOUR)])).toMatchObject({ rank: 2 })
  expect(segmentOf([item('p', NOW + 2 * HOUR, NOW + 3 * HOUR)])).toMatchObject({ rank: 2 })
  expect(segmentOf([item('p', NOW + 2 * HOUR + 1, NOW + 3 * HOUR)])).toMatchObject({ rank: 3 })
})

test('counts an event exactly as long as the limit', () => {
  expect(segmentOf([item('p', at(13), at(16))])?.levels[2]).toBe('📅 1 meeting')
  expect(segmentOf([item('p', at(13), at(16) + 1)])).toBeUndefined()
})

test('shows a meeting in progress in the active tone', () => {
  expect(segmentOf([item('s', at(11, 30), at(12, 30), 'Standup'), item('r', at(13), at(14))])).toEqual({
    rank: 1,
    tone: 'active',
    levels: ['📅 now: Standup +1', '📅 now +1', '📅 2 meetings'],
  })
})

test('lets a meeting about to start outrank one in progress', () => {
  expect(segmentOf([item('s', at(11), at(13), 'Workshop'), item('r', at(12, 5), at(13), 'Sync')])).toMatchObject({
    rank: 0,
    levels: [expect.stringContaining('in 5m: Sync'), expect.anything(), expect.anything()],
  })
})

test('leaves out meetings that ended and blocks longer than the limit', () => {
  const items = [item('ended', at(10), at(12)), item('block', at(12, 30), at(17)), item('a', at(13), at(14), 'Sync')]

  expect(segmentOf(items)?.levels).toEqual(['📅 13:00 Sync', '📅 13:00', '📅 1 meeting'])
  expect(segmentOf(items, NOW, { calendarMaxBlockHours: 5 })?.levels[2]).toBe('📅 2 meetings')
  expect(segmentOf(items.slice(0, 2))).toBeUndefined()
  expect(segmentOf([])).toBeUndefined()
})

test('counts down from the time it is given, with no refetch', () => {
  const items = [item('s', at(12, 12), at(13), 'Standup')]

  expect(segmentOf(items, at(12, 1))?.levels[0]).toBe('📅 in 11m: Standup')
  expect(segmentOf(items, at(12, 12))?.levels[0]).toBe('📅 now: Standup')
})

test('refreshes every 2 minutes while a meeting is in progress or within 30 minutes, else every 5', () => {
  const ttl = (...items: object[]) => calendar.ttl?.(items as never[], NOW)

  expect(ttl(item('a', at(11, 30), at(12, 30)))).toBe(2 * MINUTE)
  expect(ttl(item('a', NOW + 29 * MINUTE, NOW + 2 * HOUR))).toBe(2 * MINUTE)
  expect(ttl(item('a', NOW + 30 * MINUTE, NOW + 2 * HOUR))).toBe(2 * MINUTE)
  expect(ttl(item('a', NOW + 31 * MINUTE, NOW + 2 * HOUR))).toBe(5 * MINUTE)
  expect(ttl(item('ended', at(10), at(11, 59)))).toBe(5 * MINUTE)
  expect(ttl()).toBe(5 * MINUTE)
})

test('lists the meetings in the details by start, each linking to its event', () => {
  const items = [item('b', at(15), at(16), 'Review'), item('a', at(11, 30), at(12, 30), 'Standup'), item('x', at(9), at(10))]

  expect(calendar.details?.(items as never[], NOW, {})).toEqual([
    {
      heading: 'Upcoming meetings',
      rows: [
        { label: 'now', title: 'Standup', url: 'https://calendar.google.com/event?eid=a' },
        { label: '15:00', title: 'Review', url: 'https://calendar.google.com/event?eid=b' },
      ],
    },
  ])
  expect(calendar.details?.([], NOW, {})).toEqual([])
})
