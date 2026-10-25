import { expect, test } from 'claude-code/testing'

import type { Io } from '../hooks/core'
import { github } from '../hooks/github'

type Run = Awaited<ReturnType<Io['run']>>

const pr = (number: number, extra: object = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/app/pull/${number}`,
  isDraft: false,
  reviewDecision: null,
  repository: { name: 'app' },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...extra,
})

const failing = { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }
const changes = { reviewDecision: 'CHANGES_REQUESTED' }

const answer = (review: object[], mine: object[]) =>
  JSON.stringify({ data: { review: { nodes: review }, mine: { nodes: mine } } })

const ioWith = (result: Run | Error, calls: string[][] = []): Io => ({
  mcp: async () => {
    throw new Error('github does not use mcp')
  },
  run: async argv => {
    calls.push(argv)

    if (result instanceof Error) {
      throw result
    }

    return result
  },
})

const ok = (stdout: string): Run => ({ exitCode: 0, stdout, stderr: '' })

const fetched = async (stdout: string) => github.fetch(ioWith(ok(stdout)), 0)

test('keeps each PR once, under its most urgent reason', async () => {
  const result = await fetched(
    answer([pr(1), pr(2)], [pr(2, failing), pr(3, { ...failing, ...changes }), pr(4, changes), pr(5)]),
  )

  expect(result).toEqual({
    ok: true,
    items: [
      { repo: 'app', number: 1, title: 'PR 1', url: 'https://github.com/acme/app/pull/1', reason: 'review', draft: false },
      { repo: 'app', number: 2, title: 'PR 2', url: 'https://github.com/acme/app/pull/2', reason: 'review', draft: false },
      { repo: 'app', number: 3, title: 'PR 3', url: 'https://github.com/acme/app/pull/3', reason: 'ci', draft: false },
      { repo: 'app', number: 4, title: 'PR 4', url: 'https://github.com/acme/app/pull/4', reason: 'changes', draft: false },
    ],
  })
})

test('ranks failing drafts after failing non-drafts', async () => {
  const result = await fetched(answer([], [pr(7, { ...failing, isDraft: true }), pr(8, failing)]))

  expect(result.ok && result.items.map(item => [item.number, item.draft])).toEqual([
    [8, false],
    [7, true],
  ])
})

test('asks gh api graphql for review requests and my PRs', async () => {
  const calls: string[][] = []

  await github.fetch(ioWith(ok(answer([], [])), calls), 0)

  expect(calls).toHaveLength(1)
  expect(calls[0]?.slice(0, 5)).toEqual(['gh', 'api', 'graphql', '-f', expect.stringMatching(/^query=.*review-requested:@me/s)])
})

const segmentOf = async (review: object[], mine: object[]) => {
  const result = await fetched(answer(review, mine))

  return github.segment(result.ok ? result.items : [], 0, {})
}

test('shows one urgent segment for the top PR when a review is requested', async () => {
  expect(await segmentOf([pr(12), pr(13), pr(14)], [pr(3, failing)])).toEqual({
    rank: 0,
    tone: 'urgent',
    levels: ['🔀 app#12 review requested +3', '🔀 #12 review +3', '🔀 4 PRs'],
  })
  expect(await segmentOf([pr(12)], [])).toEqual({
    rank: 0,
    tone: 'urgent',
    levels: ['🔀 app#12 review requested', '🔀 #12 review', '🔀 1 PR'],
  })
})

test('shows failing CI in alert and requested changes without a tone', async () => {
  expect(await segmentOf([], [pr(3, failing), pr(4, changes)])).toEqual({
    rank: 1,
    tone: 'alert',
    levels: ['🔀 app#3 CI failing +1', '🔀 #3 CI +1', '🔀 2 PRs'],
  })
  expect(await segmentOf([], [pr(4, changes)])).toEqual({
    rank: 2,
    levels: ['🔀 app#4 changes requested', '🔀 #4 changes', '🔀 1 PR'],
  })
})

test('shows nothing when no PR needs you, and never draws a title', async () => {
  expect(await segmentOf([], [pr(5)])).toBeUndefined()
  expect(JSON.stringify(await segmentOf([pr(12)], []))).not.toContain('PR 12')
})

const detailsOf = async (review: object[], mine: object[]) => {
  const result = await fetched(answer(review, mine))

  return github.details?.(result.ok ? result.items : [], 0, {})
}

test('groups the details by reason in rank order, each row linking to its PR', async () => {
  expect(await detailsOf([pr(12)], [pr(4, changes), pr(3, failing)])).toEqual([
    { heading: 'Review requested', rows: [{ label: 'app#12', title: 'PR 12', url: 'https://github.com/acme/app/pull/12' }] },
    { heading: 'CI failing', rows: [{ label: 'app#3', title: 'PR 3', url: 'https://github.com/acme/app/pull/3' }] },
    { heading: 'Changes requested', rows: [{ label: 'app#4', title: 'PR 4', url: 'https://github.com/acme/app/pull/4' }] },
  ])
})

test('leaves out the reasons nothing matches, and marks a draft', async () => {
  expect(await detailsOf([], [])).toEqual([])
  expect(await detailsOf([], [pr(7, { ...failing, isDraft: true })])).toEqual([
    { heading: 'CI failing', rows: [{ label: 'app#7', title: 'PR 7', url: 'https://github.com/acme/app/pull/7', note: 'draft' }] },
  ])
})

test('is enabled only when the github option is on', () => {
  expect(github.enabled({ github: true })).toBe(true)
  expect(github.enabled({ github: false })).toBe(false)
  expect(github.enabled({})).toBe(false)
})

test('reports gh missing or signed out as not-connected', async () => {
  const missing = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
  const cannotStart = new Error('gh cannot start')
  const signedOut = { exitCode: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }
  const badToken = { exitCode: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' }

  expect(await github.fetch(ioWith(missing), 0)).toEqual({ ok: false, reason: 'not-connected' })
  expect(await github.fetch(ioWith(cannotStart), 0)).toEqual({ ok: false, reason: 'not-connected' })
  expect(await github.fetch(ioWith(signedOut), 0)).toEqual({ ok: false, reason: 'not-connected' })
  expect(await github.fetch(ioWith(badToken), 0)).toEqual({ ok: false, reason: 'not-connected' })
})

test('reports a failing gh as tool-error', async () => {
  const result = await github.fetch(ioWith({ exitCode: 1, stdout: '', stderr: 'HTTP 502' }), 0)

  expect(result).toEqual({ ok: false, reason: 'tool-error' })
})

test('reports a call that is still running at its time as timeout', async () => {
  const result = await github.fetch(ioWith(new Error('gh is still running after 15000ms')), 0)

  expect(result).toEqual({ ok: false, reason: 'timeout' })
})

test('reports any other rejection as tool-error', async () => {
  const result = await github.fetch(ioWith(new Error('the host refused the call')), 0)

  expect(result).toEqual({ ok: false, reason: 'tool-error' })
})

test('reports bad JSON and a drifted shape as parse-error', async () => {
  expect(await fetched('not json')).toEqual({ ok: false, reason: 'parse-error' })
  expect(await fetched(JSON.stringify({ data: { review: { nodes: [] } } }))).toEqual({ ok: false, reason: 'parse-error' })
  expect(await fetched(JSON.stringify({ errors: [{ message: 'Bad credentials' }] }))).toEqual({
    ok: false,
    reason: 'parse-error',
  })
})
