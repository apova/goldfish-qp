// Surface module of one recognized term in a reply: a chip, and on click a compact definition card
// drawn inside the app (name, definition, source, freshness). A click also tells the hooks module,
// which looks the source up again and hands this instance fresh props. A link is a button: pressed,
// the hooks module opens it (a `Link` inside a Client is a tree the Desktop page cannot draw). Hover underlines the chip
// and reveals a one-line preview, which the host draws without any hook running.
import type { ClientModule } from 'claude-code'

type Candidate = { name: string; definition: string; from?: string; source: string; resolvedAt: string; isStale: boolean }
export type CardProps = { term: string; url?: string; status: 'current' | 'stale' | 'missing' | 'ambiguous'; reason: string; checkedAt: string; candidates: Candidate[] }
type State = { over: boolean; open: boolean; pressed: boolean }

const START: State = { over: false, open: false, pressed: false }
const COLOR = { current: 'success', stale: 'warning', missing: 'error', ambiguous: 'suggestion' } as const
const LABEL = { current: '', stale: ' ⚠ stale', missing: ' ? no definition', ambiguous: ' ≠ ambiguous' } as const
const BRIEF = 90

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The line a hover shows, and the first line of a card: what the term is, or why it is not known. */
function brief (props: CardProps) {
  if (props.status === 'missing') return cut(`No definition found: ${props.reason}`, BRIEF)
  if (props.status === 'ambiguous') return `${props.candidates.length} definitions found, none chosen: click to see them`
  const [first] = props.candidates
  return cut(`${props.status === 'stale' ? '⚠ stale · ' : ''}${first?.definition ?? ''}`, BRIEF)
}

const Card: ClientModule<CardProps, State> = (props, surface) => {
  const state = surface.state ?? START
  surface.onPointer(event => {
    const now = surface.state ?? START
    if (event.type === 'down') {
      surface.setState({ ...now, pressed: event.button === 'left' })
    } else if (event.type === 'up') {
      const isClick = now.pressed && event.button === 'left'
      surface.setState({ ...now, pressed: false, open: isClick ? !now.open : now.open })
      // Opening asks the hooks module to look the source up again: a card shows what the source says now.
      if (isClick && !now.open) surface.post({ kind: 'open', term: props.term })
    } else if (event.type === 'enter' || event.type === 'leave') {
      surface.setState({ ...now, over: event.type === 'enter' })
    }
  })
  const { Box, Button, Text } = surface.elements
  const color = COLOR[props.status]
  return (
    <Box flexDirection="column">
      <Box key="hoverable" flexDirection="row">
        <Text color={color} bold={state.open} underline={state.over}>{`[${props.term}${LABEL[props.status]}]`}</Text>
        {!state.open && (
          <Box position="absolute" top={1} left={0} display="none" hover={{ display: 'flex' }} flexDirection="column" borderStyle="round" paddingX={1}>
            <Text>{brief(props)}</Text>
          </Box>
        )}
      </Box>
      {state.open && (
        <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
          {props.status === 'missing' && (
            <Box flexDirection="column">
              <Text bold>{props.term}</Text>
              <Text color="error">No definition found. Nothing is guessed.</Text>
              <Text dimColor>{props.reason}</Text>
            </Box>
          )}
          {props.status === 'ambiguous' && <Text bold color="suggestion">{`${props.term}: ${props.candidates.length} definitions, none chosen`}</Text>}
          {props.candidates.map((candidate, i) => (
            <Box key={`c${i}`} flexDirection="column" marginTop={0}>
              {props.status === 'ambiguous' && i > 0 && <Text dimColor>───</Text>}
              <Text bold>{candidate.name}</Text>
              <Text>{candidate.definition}</Text>
              <Text dimColor>{`${candidate.source}${candidate.from ? ` · from: ${candidate.from}` : ''} · updated ${candidate.resolvedAt}${candidate.isStale ? ' · STALE' : ''}`}</Text>
            </Box>
          ))}
          {props.status === 'stale' && <Text color="warning">{`STALE: ${props.reason}`}</Text>}
          {props.url && <Button key={`open:${props.term}`} plain label={`↗ ${props.url}`} onPress={() => surface.post({ kind: 'url', term: props.term })} />}
          <Text dimColor>{`${props.status} · checked ${props.checkedAt} · click the term to close`}</Text>
        </Box>
      )}
    </Box>
  )
}

export default Card
