import type { Fetched, Group, Io, Reason, Segment, Source } from './core'

type Why = 'review' | 'ci' | 'changes'

// plain JSON, so it can be cached; the text is built from it at render time
export type Pr = { repo: string; number: number; title: string; url: string; reason: Why; draft: boolean }

const TIMEOUT_MS = 15_000
const ICON = '🔀'
const ORDER: Why[] = ['review', 'ci', 'changes']
const RANK: Record<Why, number> = { review: 0, ci: 1, changes: 2 }
const TONE: Record<Why, Segment['tone']> = { review: 'urgent', ci: 'alert', changes: undefined }
// the full label, then the short one for a narrow terminal
const LABELS: Record<Why, [string, string]> = {
  review: ['review requested', 'review'],
  ci: ['CI failing', 'CI'],
  changes: ['changes requested', 'changes'],
}
const HEADINGS: Record<Why, string> = { review: 'Review requested', ci: 'CI failing', changes: 'Changes requested' }

// one round trip: reviews asked of me, and my open PRs with their CI and review state
const QUERY = `query {
  review: search(query: "is:pr is:open archived:false review-requested:@me", type: ISSUE, first: 20) {
    nodes { ...pull }
  }
  mine: search(query: "is:pr is:open archived:false author:@me", type: ISSUE, first: 50) {
    nodes { ...pull }
  }
}
fragment pull on PullRequest {
  number title url isDraft reviewDecision
  repository { name }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`

type Node = {
  number?: number
  title?: string
  url?: string
  isDraft?: boolean
  reviewDecision?: string | null
  repository?: { name?: string }
  commits?: { nodes?: { commit?: { statusCheckRollup?: { state?: string } | null } }[] }
}

const pr = (node: Node, reason: Why): Pr => ({
  repo: node.repository?.name ?? '',
  number: node.number ?? 0,
  title: node.title ?? '',
  url: node.url ?? '',
  reason,
  draft: node.isDraft === true,
})

const isFailing = (node: Node) => {
  const state = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state
  return state === 'FAILURE' || state === 'ERROR'
}

// search also returns non-PR nodes as {}; a missing list means the shape drifted
const nodesOf = (list: unknown): Node[] | undefined => {
  const nodes = (list as { nodes?: unknown } | undefined)?.nodes
  return Array.isArray(nodes) ? nodes.filter((node: Node) => typeof node?.number === 'number') : undefined
}

// most urgent reason wins: review, then failing CI (drafts last), then changes requested
const pick = (review: Node[], mine: Node[]): Pr[] => {
  const failing = mine.filter(isFailing)
  const all = [
    ...review.map(node => pr(node, 'review')),
    ...failing.filter(node => !node.isDraft).map(node => pr(node, 'ci')),
    ...failing.filter(node => node.isDraft).map(node => pr(node, 'ci')),
    ...mine.filter(node => !isFailing(node) && node.reviewDecision === 'CHANGES_REQUESTED').map(node => pr(node, 'changes')),
  ]
  const seen = new Set<string>()

  return all.filter(item => !seen.has(item.url) && !!seen.add(item.url))
}

const SIGNED_OUT = /gh auth login|not logged in|bad credentials|authentication|HTTP 401/i
const NOT_STARTED = /ENOENT|cannot start/i
const STILL_RUNNING = /still running/i

// `run` rejects when gh cannot start (not installed) or is still running at its time
const failure = (error: unknown): Reason => {
  const message = String((error as Error)?.message)

  if (NOT_STARTED.test(message)) {
    return 'not-connected'
  }

  return STILL_RUNNING.test(message) ? 'timeout' : 'tool-error'
}

const fetchPrs = async (io: Io): Promise<Fetched<Pr>> => {
  let result: Awaited<ReturnType<Io['run']>>

  try {
    result = await io.run(['gh', 'api', 'graphql', '-f', `query=${QUERY}`], { timeoutMs: TIMEOUT_MS })
  } catch (error) {
    return { ok: false, reason: failure(error) }
  }

  if (result.exitCode !== 0) {
    return { ok: false, reason: result.exitCode === 4 || SIGNED_OUT.test(result.stderr) ? 'not-connected' : 'tool-error' }
  }

  try {
    const data = JSON.parse(result.stdout)?.data
    const review = nodesOf(data?.review)
    const mine = nodesOf(data?.mine)

    return review && mine ? { ok: true, items: pick(review, mine) } : { ok: false, reason: 'parse-error' }
  } catch {
    return { ok: false, reason: 'parse-error' }
  }
}

// the top PR (items arrive most urgent first) speaks for the source; titles are never drawn
const segment = (items: Pr[]): Segment | undefined => {
  const [top] = items

  if (!top) {
    return undefined
  }

  const [full, short] = LABELS[top.reason]
  const more = items.length > 1 ? ` +${items.length - 1}` : ''

  return {
    rank: RANK[top.reason],
    tone: TONE[top.reason],
    levels: [
      `${ICON} ${top.repo}#${top.number} ${full}${more}`,
      `${ICON} #${top.number} ${short}${more}`,
      `${ICON} ${items.length} PR${items.length > 1 ? 's' : ''}`,
    ],
  }
}

// one group per reason, most urgent first
const details = (items: Pr[]): Group[] =>
  ORDER.flatMap(reason => {
    const rows = items
      .filter(item => item.reason === reason)
      .map(({ repo, number, title, url, draft }) => ({ label: `${repo}#${number}`, title, url, ...(draft && { note: 'draft' }) }))

    return rows.length > 0 ? [{ heading: HEADINGS[reason], rows }] : []
  })

export const github: Source<Pr> = {
  id: 'github',
  label: 'GitHub',
  icon: ICON,
  ttlMs: 5 * 60_000,
  enabled: options => options.github === true,
  fetch: fetchPrs,
  segment,
  details,
}
