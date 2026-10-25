import type { EngineInterface } from 'claude-code'

import { SEPARATOR } from './core'
import type { Segment } from './core'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

// theme keys, so the line follows the person's theme; no tone: the terminal's own text color
const COLORS = { urgent: 'warning', alert: 'error', active: 'suggestion' } as const

// dim: the last good result of a failing source, or a source that never worked
const style = (segment: Segment) =>
  segment.stale || segment.tone === 'muted' ? { dimColor: true } : segment.tone ? { color: COLORS[segment.tone] } : {}

// what fit chose, drawn one dim separator between segments, then how many were dropped;
// flush left, so it lines up with the other mods drawn in the band
export const line = ({ Box, Text }: Ui, shown: { segment: Segment; text: string }[], hidden: number) => (
  <Box>
    {shown.flatMap(({ segment, text }, i) => [
      ...(i > 0 ? [<Text key={`${i}:sep`} dimColor>{SEPARATOR}</Text>] : []),
      <Text key={`${i}`} wrap="truncate" {...style(segment)}>
        {text}
      </Text>,
    ])}
    {hidden > 0 && <Text dimColor>{`${SEPARATOR}+${hidden}`}</Text>}
  </Box>
)
