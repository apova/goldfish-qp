// The definition viewer's hooks: under each assistant reply that names a configured object, a row
// of chips (surface module `card.tsx`), on the terminal and on the desktop. A click looks the source
// up again and the card shows what it says now. Nothing here calls a model.
import type { EngineInterface, EventOf, RenderElement, UiMessageResult } from 'claude-code'

import type { CardProps } from './card'
import { configOf, resetConfig, termsIn } from './config'
import { resetCommands } from './command'
import { lookup, resetDefinitions } from './definitions'
import type { Lookup } from './definitions'

const DEFINITION_MAX = 1200
const shown = new Set<string>()

const clock = (ms: number) => (ms > 0 ? new Date(ms).toTimeString().slice(0, 8) : '—')
const cut = (text: string) => (text.length > DEFINITION_MAX ? `${text.slice(0, DEFINITION_MAX)}… (cut here: read the rest in the source)` : text)

/** What a card is told: plain data, times as the clock shows them, a long definition cut where it says so. */
export function propsOf (found: Lookup): CardProps {
  return {
    term: found.term,
    status: found.status,
    reason: found.reason,
    checkedAt: clock(found.checkedAt),
    ...(found.url && { url: found.url }),
    candidates: found.candidates.map(({ name, definition, from, source, resolvedAt, isStale }) => ({ name, definition: cut(definition), ...(from && { from }), source, resolvedAt: clock(resolvedAt), isStale }))
  }
}

/** A session starts: what was read is read again. */
export function resetPeek () {
  resetConfig()
  resetDefinitions()
  resetCommands()
  shown.clear()
}

type Engine = EngineInterface
type Message = EventOf['ui.message']
type Render = Extract<EventOf['ui.render'], { component: 'AssistantMessage' }>

/** Opens `url` in the system's browser, on the machine the session runs on. */
async function openUrl ($: Engine, url: string) {
  const first = await $.process.run(['open', url]).catch(() => undefined)
  if (first?.exitCode !== 0) await $.process.run(['xdg-open', url]).catch(() => undefined)
}

/**
 * A card opened: the source is looked at again now, and the card gets the answer. A link pressed:
 * the link the config makes for that term opens (never one the card sends).
 */
export async function peekMessage ($: Engine, e: Message, next: (e: Message) => Promise<UiMessageResult>): Promise<UiMessageResult> {
  const result = await next(e)
  const data = e.data as { kind?: unknown; term?: unknown } | null
  if ((data?.kind !== 'open' && data?.kind !== 'url') || typeof data.term !== 'string') return result
  const found = await lookup($, await configOf($), data.term, data.kind === 'open')
  if (data.kind === 'url') {
    if (found.url) await openUrl($, found.url)
    return result
  }
  return { ...result, props: propsOf(found) }
}

/**
 * The reply as `draw` (the rest of the chain) draws it, with a row of chips under it for each
 * configured object it names, on the terminal and on the desktop.
 */
export async function peekRender ($: Engine, e: Render, draw: (next: (e: Render) => Promise<RenderElement>) => Promise<RenderElement>, next: (e: Render) => Promise<RenderElement>): Promise<RenderElement> {
  if (e.props.isSummary || (e.surface !== 'terminal' && e.surface !== 'desktop')) return draw(next)
  const drawn = await draw(next)
  const config = await configOf($)
  for (const problem of config.problems) {
    if (!shown.has(problem)) {
      shown.add(problem)
      $.ui.toast(`goldfish-qp: ${problem}`)
    }
  }
  const terms = termsIn(e.props.text, config)
  if (terms.length === 0) return drawn
  const found = await Promise.all(terms.map(term => lookup($, config, term)))
  const { Box, Client, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      {drawn}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>click a term to see its definition</Text>
        {found.map(one => <Client key={`chip:${one.term}`} module="./card.tsx" props={propsOf(one)} />)}
      </Box>
    </Box>
  )
}
