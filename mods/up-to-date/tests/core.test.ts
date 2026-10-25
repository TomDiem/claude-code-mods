import { expect, test } from 'claude-code/testing'

import { due, fit, settle, status } from '../hooks/core'
import type { Entry, Fetched } from '../hooks/core'

const MINUTE = 60_000
const TTL = 5 * MINUTE
const NOW = 1_000_000

const line = (rank: number, text: string) => ({ rank, text, detail: '' })

test('fit puts the most urgent lines first and keeps source order within a rank', () => {
  const lines = [line(2, 'c'), line(0, 'a1'), line(1, 'b'), line(0, 'a2')]

  expect(fit(lines, 80)).toEqual({ shown: ['a1', 'a2', 'b', 'c'], hidden: 0 })
})

test('fit drops the least urgent lines that do not fit and counts them', () => {
  const lines = [line(0, 'review #1'), line(1, 'ci #2'), line(2, 'changes #3')]

  // "review #1 · ci #2" is 17 wide, plus " · +1" makes 22
  expect(fit(lines, 22)).toEqual({ shown: ['review #1', 'ci #2'], hidden: 1 })
  expect(fit(lines, 21)).toEqual({ shown: ['review #1'], hidden: 2 })
})

test('fit shows nothing when not even the first line fits', () => {
  expect(fit([line(0, 'review #1'), line(1, 'ci #2')], 8)).toEqual({ shown: [], hidden: 2 })
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
