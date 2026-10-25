// Pure logic: no `$`, no clock, no randomness (time and jitter are passed in)

// rank 0 is the most urgent
export type Line = { rank: number; text: string; detail: string }

const SEPARATOR = ' · '

// ASCII labels only, so `.length` is the display width
export const fit = (lines: Line[], columns: number) => {
  const texts = [...lines].sort((a, b) => a.rank - b.rank).map(line => line.text)

  for (let count = texts.length; count > 0; count--) {
    const hidden = texts.length - count
    const suffix = hidden > 0 ? `${SEPARATOR}+${hidden}` : ''

    if (texts.slice(0, count).join(SEPARATOR).length + suffix.length <= columns) {
      return { shown: texts.slice(0, count), hidden }
    }
  }

  return { shown: [], hidden: texts.length }
}
