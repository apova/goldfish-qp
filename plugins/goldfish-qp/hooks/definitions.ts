// Looking a term up: read its sources (again only when they changed), keep the latest copy of
// each, and say what that copy is worth: current, stale (the source is unavailable now, this is the
// last known definition), missing (the source has no entry) or ambiguous (several do: none is
// chosen). No model is called; a definition is only ever text a source holds.
import type { EngineInterface } from 'claude-code'

import { fetchCommand, render } from './command'
import type { Config, TypeSpec } from './config'
import { RESOLVERS } from './sources'
import type { Entry, Io, SourceSpec } from './sources'

type Engine = EngineInterface

export type Status = 'current' | 'stale' | 'missing' | 'ambiguous'
export type Candidate = { type: string; name: string; definition: string; from?: string; source: string; resolvedAt: number; checkedAt: number; isStale: boolean }
export type Lookup = { term: string; status: Status; reason: string; candidates: Candidate[]; checkedAt: number; url?: string }

/** The latest copy of a source: replaced when the source changes, never accumulated. */
type Snapshot = {
  version: string
  fingerprint: string
  entries: Map<string, Entry[]>
  resolvedAt: number // when this content was read
  checkedAt: number // when the source was last looked at
  hasContent: boolean // a read succeeded at some point
  error?: string // the last look failed: this copy is stale
}

const CHECK_MS = 1000
const snapshots = new Map<string, Snapshot>()

export function resetDefinitions () {
  snapshots.clear()
}

const grouped = (entries: Entry[]) => {
  const map = new Map<string, Entry[]>()
  for (const entry of entries) map.set(entry.key, [...(map.get(entry.key) ?? []), entry])
  return map
}

/**
 * The source's snapshot, looked at again unless it was a moment ago (`force`: at once). Unchanged
 * (same version token, else same fingerprint) it only gets a new `checkedAt`; changed, its entries
 * replace the old ones; unavailable, the last copy stays, marked with the error.
 */
export async function refresh ($: Engine, source: SourceSpec, force = false): Promise<Snapshot> {
  const id = `${source.kind}\n${source.level ?? ''}\n${source.path}`
  const now = await $.clock.now()
  const known = snapshots.get(id)
  if (known && !force && now - known.checkedAt < CHECK_MS) return known
  const resolver = RESOLVERS[source.kind]!
  const io: Io = { stat: path => $.fs.stat(path), read: path => $.fs.read(path) }
  let next: Snapshot
  try {
    const version = await resolver.version(io, source)
    if (known && !known.error && known.version === version) {
      next = { ...known, checkedAt: now }
    } else {
      const { entries, fingerprint } = await resolver.load(io, source)
      next = known?.hasContent && known.fingerprint === fingerprint
        ? { ...known, version, checkedAt: now, error: undefined }
        : { version, fingerprint, entries: grouped(entries), resolvedAt: now, checkedAt: now, hasContent: true }
    }
  } catch (error) {
    // The engine prefixes a failed read with the plugin and call; the person wants the cause.
    const message = (error instanceof Error ? error.message : String(error)).replace(/^[\w-]+: \$\.fs\.\w+: /, '')
    next = known
      ? { ...known, checkedAt: now, error: message }
      : { version: '', fingerprint: '', entries: new Map(), resolvedAt: 0, checkedAt: now, hasContent: false, error: message }
  }
  if (next.error === undefined) delete next.error
  snapshots.set(id, next)
  return next
}

/** The types whose pattern matches all of `term`, in the order the config lists them. */
export const typesOf = (config: Config, term: string): TypeSpec[] => config.types.filter(type => type.whole.test(term))

/** What one source says about a term: its candidates, and whether it could be looked at. */
type Looked = { label: string; hasContent: boolean; error?: string; isNotFound?: boolean; checkedAt: number; candidates: Candidate[]; fields?: unknown }

async function lookedInFile ($: Engine, type: TypeSpec, source: SourceSpec, term: string, force: boolean): Promise<Looked> {
  const snapshot = await refresh($, source, force)
  const candidates = (snapshot.entries.get(term) ?? []).map((entry): Candidate => ({ type: type.name, name: entry.name, definition: entry.definition, ...(entry.from && { from: entry.from }), source: source.label, resolvedAt: snapshot.resolvedAt, checkedAt: snapshot.checkedAt, isStale: snapshot.error !== undefined }))
  return { label: source.label, hasContent: snapshot.hasContent, ...(snapshot.error !== undefined && { error: snapshot.error }), checkedAt: snapshot.checkedAt, candidates }
}

async function lookedByCommand ($: Engine, type: TypeSpec, source: SourceSpec, term: string, groups: string[], force: boolean): Promise<Looked> {
  const fetched = await fetchCommand($, source, term, groups, force)
  const candidates: Candidate[] = fetched.hasContent && fetched.definition !== undefined
    ? [{ type: type.name, name: fetched.name ?? term, definition: fetched.definition, source: fetched.label, resolvedAt: fetched.resolvedAt, checkedAt: fetched.checkedAt, isStale: fetched.error !== undefined }]
    : []
  return { label: fetched.label, hasContent: fetched.hasContent, ...(fetched.error !== undefined && { error: fetched.error }), ...(fetched.isNotFound && { isNotFound: true }), checkedAt: fetched.checkedAt, candidates, fields: fetched.fields }
}

/** The link a type's template makes for `term`, once every field it names is known. */
function linkOf (type: TypeSpec | undefined, groups: string[], fields: unknown): string | undefined {
  if (!type?.link) return undefined
  const { text, isComplete } = render(type.link, groups, fields)
  return isComplete && /^https?:\/\//.test(text) ? text : undefined
}

const whyNot = (one: Looked) => (one.error !== undefined ? (one.hasContent ? `${one.label}: no entry in the last known copy, source unavailable (${one.error})` : `${one.label}: unavailable (${one.error})`) : `${one.label}: ${one.isNotFound ? 'not found' : 'no entry'}`)

/**
 * What the sources say `term` is, with the status that says how far to trust it. The types that
 * match it are tried in the config's order and the first with a definition answers (specific types
 * go before broad ones); several definitions within it are ambiguous, and none is chosen.
 */
export async function lookup ($: Engine, config: Config, term: string, force = false): Promise<Lookup> {
  const looked: Looked[] = []
  const types = typesOf(config, term)
  const groupsOf = (type: TypeSpec) => [...(type.whole.exec(term) ?? [term])].map(group => group ?? '')
  for (const type of types) {
    const groups = groupsOf(type)
    const here = await Promise.all(type.sources.map(source => (source.kind === 'command' ? lookedByCommand($, type, source, term, groups, force) : lookedInFile($, type, source, term, force))))
    looked.push(...here)
    const candidates = here.flatMap(one => one.candidates)
    if (candidates.length === 0) continue
    const checkedAt = Math.min(...here.map(one => one.checkedAt))
    const url = linkOf(type, groups, here.find(one => one.candidates.length > 0)?.fields)
    const trouble = here.flatMap(one => (one.error === undefined ? [] : [`${one.label} unavailable (${one.error})`]))
    if (candidates.length > 1) return { term, status: 'ambiguous', reason: `${candidates.length} definitions found; none is chosen`, candidates, checkedAt, ...(url && { url }) }
    return candidates[0]!.isStale
      ? { term, status: 'stale', reason: `${trouble.join('; ')}; showing the last known definition`, candidates, checkedAt, ...(url && { url }) }
      : { term, status: 'current', reason: '', candidates, checkedAt, ...(url && { url }) }
  }
  const linking = types.find(type => type.link)
  const url = linkOf(linking, linking ? groupsOf(linking) : [], undefined)
  const checkedAt = looked.length > 0 ? Math.min(...looked.map(one => one.checkedAt)) : await $.clock.now()
  return { term, status: 'missing', reason: looked.map(whyNot).join('; ') || 'no source', candidates: [], checkedAt, ...(url && { url }) }
}
