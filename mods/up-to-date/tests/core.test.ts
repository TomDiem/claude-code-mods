import { expect, test } from 'claude-code/testing'

import { fit } from '../hooks/core'

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
