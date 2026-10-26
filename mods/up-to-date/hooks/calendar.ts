import type { Fetched, Group, Io, Reason, Segment, Source } from './core'

// plain JSON, so it can be cached; the text is built from it at render time
export type Meeting = { id: string; title: string; start: number; end: number; url: string }

const SERVER = 'claude.ai Google Calendar'
const ICON = '📅'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const SOON = 15 * MINUTE
const MAX_BLOCK_HOURS = 3
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Event = {
  id?: string
  summary?: string
  status?: string
  transparency?: string
  availability?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
  htmlLink?: string
}

// all-day events have no dateTime; free time and what I turned down never take my time
const meeting = (event: Event): Meeting | undefined => {
  const start = Date.parse(event.start?.dateTime ?? '')
  const end = Date.parse(event.end?.dateTime ?? '')
  const declined = event.attendees?.some(who => who.self && who.responseStatus === 'declined')
  const free = event.transparency === 'transparent' || event.availability === 'AVAILABILITY_FREE'

  if (event.status === 'cancelled' || declined || free || Number.isNaN(start) || Number.isNaN(end)) {
    return undefined
  }

  return { id: event.id ?? '', title: event.summary ?? '', start, end, url: event.htmlLink ?? '' }
}

const NOT_CONNECTED = /not connected|unauthori|not found/i

// `mcp` rejects when the server is missing or signed out
const failure = (error: unknown): Reason => (NOT_CONNECTED.test(String((error as Error)?.message)) ? 'not-connected' : 'tool-error')

// with no events in the window the server leaves `events` out
const fetchMeetings = async (io: Io): Promise<Fetched<Meeting>> => {
  let result: { content?: { text?: unknown }[]; isError?: boolean }

  try {
    result = (await io.mcp(SERVER, 'list_events', { pageSize: 30, orderBy: 'startTime' })) as typeof result
  } catch (error) {
    return { ok: false, reason: failure(error) }
  }

  if (result?.isError) {
    return { ok: false, reason: 'tool-error' }
  }

  try {
    const text = result?.content?.[0]?.text
    const data = JSON.parse(String(text))
    const events = data?.events ?? []

    return data && typeof data === 'object' && Array.isArray(events)
      ? { ok: true, items: events.flatMap((event: Event) => meeting(event ?? {}) ?? []) }
      : { ok: false, reason: 'parse-error' }
  } catch {
    return { ok: false, reason: 'parse-error' }
  }
}

// what is still on and short enough to be a meeting, by start; the limit is read at render time
// so raising it needs no refetch
const upcoming = (items: Meeting[], now: number, options: Record<string, unknown>) => {
  const hours = typeof options.calendarMaxBlockHours === 'number' ? options.calendarMaxBlockHours : MAX_BLOCK_HOURS

  return items.filter(item => item.end > now && item.end - item.start <= hours * HOUR).sort((a, b) => a.start - b.start)
}

const clock = (time: number) => {
  const date = new Date(time)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// "now", "in 12m", then the clock time, with the weekday when it is not today
const when = ({ start }: Meeting, now: number) => {
  if (start <= now) {
    return 'now'
  }

  if (start - now < HOUR) {
    return `in ${Math.ceil((start - now) / MINUTE)}m`
  }

  const today = new Date(now).toDateString() === new Date(start).toDateString()

  return today ? clock(start) : `${DAYS[new Date(start).getDay()]} ${clock(start)}`
}

// about to start first, then in progress, then by how soon it starts
const rank = ({ start }: Meeting, now: number) =>
  start <= now ? 1 : start - now <= SOON ? 0 : start - now <= 2 * HOUR ? 2 : 3

// the most pressing meeting speaks for the source; the others are counted
const segment = (items: Meeting[], now: number, options: Record<string, unknown>): Segment | undefined => {
  const meetings = upcoming(items, now, options)
  const [top] = [...meetings].sort((a, b) => rank(a, now) - rank(b, now))

  if (!top) {
    return undefined
  }

  const label = when(top, now)
  const more = meetings.length > 1 ? ` +${meetings.length - 1}` : ''
  const live = top.start <= now
  // relative labels lead with a colon, clock times do not
  const colon = top.start - now < HOUR ? ':' : ''

  return {
    rank: rank(top, now),
    ...(live ? { tone: 'active' as const } : rank(top, now) === 0 && { tone: 'urgent' as const }),
    levels: [
      `${ICON} ${label}${colon} ${top.title}${more}`,
      `${ICON} ${label}${more}`,
      `${ICON} ${meetings.length} meeting${meetings.length > 1 ? 's' : ''}`,
    ],
  }
}

const details = (items: Meeting[], now: number, options: Record<string, unknown>): Group[] => {
  const rows = upcoming(items, now, options).map(item => ({ label: when(item, now), title: item.title, url: item.url }))

  return rows.length > 0 ? [{ heading: 'Upcoming meetings', rows }] : []
}

export const calendar: Source<Meeting> = {
  id: 'calendar',
  label: 'Calendar',
  icon: ICON,
  ttlMs: 10 * MINUTE,
  enabled: options => options.calendar === true,
  fetch: fetchMeetings,
  segment,
  details,
}
