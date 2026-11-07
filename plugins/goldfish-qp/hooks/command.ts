// A source that is a command: `gh pr view 560 --json ...`, `multica issue get PROJ-123`. The
// command is run without a shell, its JSON output is turned into a name and a definition by the
// config's templates, and the latest answer is kept per term for a while. No model is called.
import type { EngineInterface } from 'claude-code'

import { fingerprint } from './sources'
import type { SourceSpec } from './sources'

type Engine = EngineInterface

/** What a command source said about a term at the last look. */
export type Fetched = {
  label: string // the command as it was run
  name?: string
  definition?: string
  fields?: unknown // the parsed JSON, for a link template
  resolvedAt: number // when this output was first seen
  checkedAt: number
  hasContent: boolean
  isNotFound?: boolean // the command ran and said there is no such thing
  error?: string // the last look failed: a kept copy is stale
  fingerprint?: string
}

const DEFAULT_TTL_MS = 60_000
const TIMEOUT_MS = 15_000
const NOT_FOUND = /not found|no such|could not resolve|does not exist|404/i
const cache = new Map<string, Fetched>()

export function resetCommands () {
  cache.clear()
}

function field (fields: unknown, path: string): string | undefined {
  let at: unknown = fields
  for (const part of path.split('.')) {
    if (at === null || typeof at !== 'object') return undefined
    at = (at as Record<string, unknown>)[part]
  }
  if (typeof at === 'string' || typeof at === 'number' || typeof at === 'boolean') return String(at)
  if (Array.isArray(at)) {
    const parts = at.flatMap(item => (typeof item === 'string' || typeof item === 'number' ? [String(item)] : typeof (item as { name?: unknown } | null)?.name === 'string' ? [(item as { name: string }).name] : []))
    return parts.join(', ')
  }
  return undefined
}

/**
 * A template with `{0}` (the term), `{1}`... (its regex groups) and `{some.field}` (a field of the
 * command's JSON output). `isComplete` is false when a field it names is missing: nothing is guessed.
 */
export function render (template: string, groups: string[], fields?: unknown) {
  let isComplete = true
  const text = template.replace(/\{([\w.]+)\}/g, (_all, name: string) => {
    const value = /^\d+$/.test(name) ? groups[Number(name)] : field(fields, name)
    if (value === undefined) {
      isComplete = false
      return '—'
    }
    return value
  })
  return { text, isComplete }
}

/** The command source's answer for `term`, run again unless the last answer is younger than its `ttl` (or `force`). */
export async function fetchCommand ($: Engine, source: SourceSpec, term: string, groups: string[], force: boolean): Promise<Fetched> {
  const now = await $.clock.now()
  const argv = (source.run ?? []).map(part => render(part, groups).text)
  const key = argv.join('\u0000')
  const label = argv.join(' ').slice(0, 80)
  const known = cache.get(key)
  if (known && !force && now - known.checkedAt < (source.ttl ?? DEFAULT_TTL_MS)) return known
  let next: Fetched
  try {
    // A term must not turn into an option of the command.
    if (argv.some((arg, i) => i > 0 && arg !== source.run![i] && arg.startsWith('-'))) throw new Error('refused: a term looks like an option')
    const out = await $.process.run(argv, { timeoutMs: TIMEOUT_MS })
    if (out.exitCode !== 0) {
      const said = `${out.stderr}\n${out.stdout}`.trim()
      if (NOT_FOUND.test(said)) {
        cache.set(key, { label, resolvedAt: now, checkedAt: now, hasContent: false, isNotFound: true })
        return cache.get(key)!
      }
      throw new Error(said.split('\n')[0]?.slice(0, 160) || `exit ${out.exitCode}`)
    }
    const fields: unknown = JSON.parse(out.stdout)
    const print = fingerprint(out.stdout)
    const definition = render(source.definition ?? '', groups, fields)
    // Nothing is shown that the output does not hold: a missing field is an error, never a blank.
    if (!definition.isComplete || definition.text.trim() === '') throw new Error('the output lacks a field the definition needs')
    const name = render(source.name ?? '{0}', groups, fields).text
    next = known?.hasContent && known.fingerprint === print
      ? { ...known, checkedAt: now }
      : { label, name, definition: definition.text, fields, fingerprint: print, resolvedAt: now, checkedAt: now, hasContent: true }
    delete next.error
  } catch (error) {
    // The engine prefixes a failed call with the plugin and call; the person wants the cause.
    const message = (error instanceof Error ? error.message : String(error)).replace(/^[\w-]+: \$\.\w+\.\w+: /, '')
    next = known?.hasContent ? { ...known, checkedAt: now, error: message } : { label, resolvedAt: 0, checkedAt: now, hasContent: false, error: message }
  }
  cache.set(key, next)
  return next
}
