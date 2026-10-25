import type { EngineInterface } from 'claude-code'

import type { Group, Row } from './core'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

// one enabled source: its groups, and a dim note when it is stale or never worked
export type Section = { icon: string; label: string; groups: Group[]; note?: string }

// the title, then the note in parentheses; empty when a PR has neither
const dim = ({ title, note }: Row) => [title, note && `(${note})`].filter(Boolean).join(' ')

// every group of every source with something to say, a heading led by the icon and a linked row
// per item; the shell fills the sections from the entries, so nothing here fetches
export const details = ({ Box, Link, Text }: Ui, sections: Section[]) => (
  <Box flexDirection="column">
    {sections.length === 0 ? (
      <Text dimColor>Nothing needs you.</Text>
    ) : (
      sections.flatMap(({ icon, label, groups, note }) => [
        ...(note ? [<Text key={`${label}:note`} dimColor>{groups.length > 0 ? `${label}: ${note}` : `${icon} ${label}: ${note}`}</Text>] : []),
        ...groups.map(({ heading, rows }) => (
          <Box key={`${label}:${heading}`} flexDirection="column">
            <Text>{`${icon} ${heading}`}</Text>
            {rows.map(row => (
              <Text key={row.url} wrap="truncate">
                {'  '}
                <Link href={row.url}>{row.label}</Link>
                {dim(row) && <Text dimColor>{` ${dim(row)}`}</Text>}
              </Text>
            ))}
          </Box>
        )),
      ])
    )}
  </Box>
)
