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
// flush left, so it lines up with the other mods drawn in the band. One plain button holds it
// all, so a click anywhere on the line presses (it opens the details)
export const line = (
  { Box, Button, Text }: Ui,
  shown: { segment: Segment; text: string }[],
  hidden: number,
  onPress: () => void,
) => (
  <Box>
    <Button plain key="up-to-date:line" onPress={onPress}>
      {shown.flatMap(({ segment, text }, i) => [
        ...(i > 0 ? [<Text key={`${i}:sep`} dimColor>{SEPARATOR}</Text>] : []),
        <Text key={`${i}`} wrap="truncate" {...style(segment)}>
          {text}
        </Text>,
      ])}
      {hidden > 0 ? [<Text key="hidden" dimColor>{`${SEPARATOR}+${hidden}`}</Text>] : []}
    </Button>
  </Box>
)
