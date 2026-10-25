import { expect, test } from 'claude-code/testing'

import { cells, due, fit, settle, status } from '../hooks/core'
import type { Entry, Fetched, Segment } from '../hooks/core'

const MINUTE = 60_000
const TTL = 5 * MINUTE
const NOW = 1_000_000

const segment = (rank: number, ...levels: string[]): Segment => ({ rank, levels })
const texts = (segments: Segment[], columns: number) => fit(segments, columns).shown.map(part => part.text)

test('cells counts emoji and wide characters as two columns and joiners as none', () => {
  expect(cells('abc')).toBe(3)
  expect(cells('🔀 a')).toBe(4)
  expect(cells('日本')).toBe(4)
  expect(cells('a️')).toBe(1)
  expect(cells('👩‍💻')).toBe(4)
  expect(cells('')).toBe(0)
})

test('fit puts the most urgent segments first and keeps source order within a rank', () => {
  const segments = [segment(2, 'c'), segment(0, 'a1'), segment(1, 'b'), segment(0, 'a2')]

  expect(texts(segments, 80)).toEqual(['a1', 'a2', 'b', 'c'])
})

test('fit returns each chosen text next to its segment so the shell can color it', () => {
  const urgent: Segment = { rank: 0, levels: ['review'], tone: 'urgent' }

  expect(fit([urgent], 80)).toEqual({ shown: [{ segment: urgent, text: 'review' }], hidden: 0 })
})

test('fit counts emoji as two columns', () => {
  // "🔀 abc" is 6 wide, " · " 3, "📅 d" 4: 13 in all
  const segments = [segment(0, '🔀 abc'), segment(1, '📅 d')]

  expect(texts(segments, 13)).toEqual(['🔀 abc', '📅 d'])
  expect(texts(segments, 12)).toEqual(['🔀 abc'])
})

test('fit shrinks the least urgent segment first, one level at a time', () => {
  const segments = [segment(0, 'review app#12', 'app#12', '1 PR'), segment(1, 'standup in 12 min', 'in 12 min', '1 event')]

  // 13 + 3 + 17 = 33 wide in full
  expect(texts(segments, 33)).toEqual(['review app#12', 'standup in 12 min'])
  expect(texts(segments, 29)).toEqual(['review app#12', 'in 12 min'])
})

test('fit lowers one segment all the way before touching a more urgent one', () => {
  const segments = [segment(0, 'review app#12', 'app#12', '1 PR'), segment(1, 'standup in 12 min', 'in 12 min', '1 event')]

  // the standup goes to 'in 12 min' (25 wide) and then '1 event' (23) before the review shortens
  expect(texts(segments, 23)).toEqual(['review app#12', '1 event'])
  expect(texts(segments, 16)).toEqual(['app#12', '1 event'])
})

test('fit keeps the urgent segment full while the least urgent one gives way', () => {
  const urgent = segment(0, '🔀 app#12 review requested +2', '🔀 #12 review +2', '🔀 3 PRs')
  const calendar = segment(1, '📅 Standup in 12 min', '📅 12 min', '📅 1')

  expect(texts([urgent, calendar], 40)).toEqual(['🔀 app#12 review requested +2', '📅 1'])
})

test('fit drops the least urgent segments only once every level is the shortest, and says how many', () => {
  const segments = [segment(0, 'aaaaaa', 'aaa'), segment(1, 'bbbbbb', 'bbb'), segment(2, 'cccccc', 'ccc')]

  // 3 + 3 + 3 + 3 + 3 = 15 at the shortest levels
  expect(fit(segments, 15).hidden).toBe(0)
  expect(fit(segments, 14).hidden).toBe(1)
  expect(texts(segments, 14)).toEqual(['aaa', 'bbb'])
  // 'aaa · +2' is 8 wide
  expect(texts(segments, 8)).toEqual(['aaa'])
  expect(fit(segments, 8).hidden).toBe(2)
})

test('fit grows the survivors back to their fullest level after a drop', () => {
  const segments = [segment(0, 'aaaaaa', 'aaa'), segment(1, 'bbbbbb', 'bbb'), segment(2, 'cccccc')]

  // all three need 18 at best; without c, a and b fit with ' · +1' (5) at 6 + 3 + 3 + 5 = 17
  expect(fit(segments, 17)).toEqual({ shown: [{ segment: segments[0], text: 'aaaaaa' }, { segment: segments[1], text: 'bbb' }], hidden: 1 })
})

test('fit still returns the most urgent segment at its shortest when nothing fits, so the shell truncates it', () => {
  const segments = [segment(0, 'aaaaaa', 'aaa'), segment(1, 'bbb')]

  expect(fit(segments, 2)).toEqual({ shown: [{ segment: segments[0], text: 'aaa' }], hidden: 0 })
})

test('fit shows nothing for no segments', () => {
  expect(fit([], 80)).toEqual({ shown: [], hidden: 0 })
})

test('settle stores fresh items and schedules the next fetch after the ttl, scaled by the jitter', () => {
  const ok: Fetched<string> = { ok: true, items: ['a'] }

  expect(settle(undefined, ok, NOW, TTL)).toEqual({ items: ['a'], at: NOW, fails: 0, nextTryAt: NOW + TTL })
  expect(settle(undefined, ok, NOW, TTL, 1.1).nextTryAt).toBe(NOW + TTL * 1.1)
})

test('settle keeps the last good items on failure and backs off exponentially up to 30 minutes', () => {
  const fail = { ok: false, reason: 'timeout' } as const
  const good: Entry<string> = { items: ['a'], at: NOW - TTL, fails: 0, nextTryAt: NOW }

  const first = settle(good, fail, NOW, TTL)
  const second = settle(first, fail, NOW, TTL)
  const third = settle(second, fail, NOW, TTL)
  const fourth = settle(third, fail, NOW, TTL)

  expect(first).toEqual({
    items: ['a'],
    at: NOW - TTL,
    error: { reason: 'timeout', at: NOW },
    fails: 1,
    nextTryAt: NOW + 2 * TTL,
  })
  expect(second.nextTryAt).toBe(NOW + 4 * TTL)
  expect(third.nextTryAt).toBe(NOW + 30 * MINUTE)
  expect(fourth.nextTryAt).toBe(NOW + 30 * MINUTE)
})

test('settle never retries a failing source sooner than a healthy one', () => {
  const hour = 60 * MINUTE

  expect(settle(undefined, { ok: false, reason: 'timeout' }, NOW, hour).nextTryAt).toBe(NOW + hour)
})

test('settle clears the error and the backoff once a fetch succeeds again', () => {
  const failed = settle(undefined, { ok: false, reason: 'not-connected' }, NOW, TTL)

  expect(failed).toEqual({
    items: [],
    at: 0,
    error: { reason: 'not-connected', at: NOW },
    fails: 1,
    nextTryAt: NOW + 2 * TTL,
  })
  expect(settle(failed, { ok: true, items: ['b'] }, NOW + 1, TTL)).toEqual({
    items: ['b'],
    at: NOW + 1,
    fails: 0,
    nextTryAt: NOW + 1 + TTL,
  })
})

test('due is true with no entry and once the next try time has come', () => {
  const entry: Entry<string> = { items: [], at: NOW, fails: 0, nextTryAt: NOW + TTL }

  expect(due(undefined, NOW)).toBe(true)
  expect(due(entry, NOW + TTL - 1)).toBe(false)
  expect(due(entry, NOW + TTL)).toBe(true)
})

test('status tells disabled, pending, ok, stale and failed apart', () => {
  const ok: Entry<string> = { items: [], at: NOW, fails: 0, nextTryAt: NOW + TTL }
  const stale: Entry<string> = { ...ok, items: ['a'], error: { reason: 'timeout', at: NOW }, fails: 1 }
  const failed: Entry<string> = { ...ok, at: 0, error: { reason: 'tool-error', at: NOW }, fails: 1 }

  expect(status(ok, false)).toBe('disabled')
  expect(status(undefined, true)).toBe('pending')
  expect(status(ok, true)).toBe('ok')
  expect(status(stale, true)).toBe('stale')
  expect(status(failed, true)).toBe('failed')
})

test('status is stale, not failed, when the last good fetch found nothing', () => {
  const empty: Entry<string> = { items: [], at: NOW - TTL, error: { reason: 'timeout', at: NOW }, fails: 1, nextTryAt: NOW + TTL }

  expect(status(empty, true)).toBe('stale')
})
