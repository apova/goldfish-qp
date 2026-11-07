// What a definition source is: a place that holds entries (a key, a name, a definition), and
// how to tell cheaply that it changed. Two resolvers ship, JSON and Markdown files; a new kind
// (a git revision, an HTTP ETag) is one more `Resolver` in `RESOLVERS`.
import type { FsStat } from 'claude-code'

/** The only thing a resolver is given of the engine: to look at a file and to read it. */
export type Io = { stat: (path: string) => Promise<FsStat>; read: (path: string) => Promise<unknown> }

/** One defined object, as its source holds it. Never written by the mod: only read. */
export type Entry = { key: string; name: string; definition: string; from?: string }

/**
 * A source named in the config: its kind, the absolute path it reads, how the config spelled it. A
 * `command` source has no path: it has `run` (argv with `{0}`, `{1}`, `{field}`), `name` and `definition` templates, and `ttl` ms.
 */
export type SourceSpec = { kind: string; path: string; label: string; level?: number; run?: string[]; name?: string; definition?: string; ttl?: number }

export interface Resolver {
  /** A cheap token: the same token as last time means the content is unchanged. Throws when the source is unavailable. */
  version (io: Io, source: SourceSpec): Promise<string>
  /** The source's entries now, and a fingerprint of the content they were read from. Throws when it cannot be read or parsed. */
  load (io: Io, source: SourceSpec): Promise<{ entries: Entry[]; fingerprint: string }>
}

const MAX_BYTES = 1024 * 1024

/** A fast non-cryptographic fingerprint of a text: enough to tell that a file's content changed. */
export function fingerprint (text: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return `${text.length}:${(hash >>> 0).toString(16)}`
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * JSON: an object mapping a key to a definition (a string, or `{ name?, definition, from? }`, `from` being where the definition was taken from), or an array of
 * `{ key, name?, definition }`, which may repeat a key. An entry with no definition text is skipped:
 * nothing is made up.
 */
export function parseJson (text: string): Entry[] {
  const data: unknown = JSON.parse(text)
  const entries: Entry[] = []
  const add = (key: unknown, value: unknown) => {
    if (!isText(key)) return
    if (isText(value)) entries.push({ key, name: key, definition: value.trim() })
    else if (value && typeof value === 'object') {
      const { name, definition, from } = value as { name?: unknown; definition?: unknown; from?: unknown }
      if (isText(definition)) entries.push({ key, name: isText(name) ? name : key, definition: definition.trim(), ...(isText(from) && { from: from.trim() }) })
    }
  }
  if (Array.isArray(data)) for (const item of data) add((item as { key?: unknown; id?: unknown } | null)?.key ?? (item as { id?: unknown } | null)?.id, item)
  else if (data && typeof data === 'object') for (const [key, value] of Object.entries(data)) add(key, value)
  return entries
}

/**
 * Markdown: each heading of `level` (default 2) is an entry; its key is the heading up to the first
 * ` — `, ` – `, ` - ` or `: `, its name the whole heading, its definition the text under it up to the next
 * heading of its level or above. Headings in code fences are not headings.
 */
export function parseMarkdown (text: string, level = 2): Entry[] {
  const entries: Entry[] = []
  let current: { key: string; name: string; lines: string[] } | undefined
  let fence: string | undefined
  const close = () => {
    const definition = current?.lines.join('\n').trim()
    if (current && definition) entries.push({ key: current.key, name: current.name, definition })
    current = undefined
  }
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (fence === undefined) fence = marker[0]
      else if (marker[0] === fence) fence = undefined
    }
    const heading = fence === undefined && !marker ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null
    if (heading && heading[1]!.length <= level) {
      close()
      if (heading[1]!.length === level) {
        const name = heading[2]!.trim()
        current = { key: name.split(/ — | – | - |: /)[0]!.trim(), name, lines: [] }
      }
      continue
    }
    current?.lines.push(line)
  }
  close()
  return entries
}

/** A resolver for a file in a format `parse` reads. The version token is its size and mtime. */
function fileResolver (parse: (text: string, source: SourceSpec) => Entry[]): Resolver {
  return {
    async version (io, { path }) {
      const stat = await io.stat(path)
      if (stat.kind !== 'file') throw new Error('not a file')
      if (stat.size > MAX_BYTES) throw new Error('file over 1 MB')
      return `${stat.size}:${stat.mtimeMs}`
    },
    async load (io, source) {
      const text = String(await io.read(source.path))
      return { entries: parse(text, source), fingerprint: fingerprint(text) }
    }
  }
}

export const RESOLVERS: Record<string, Resolver> = {
  json: fileResolver(text => parseJson(text)),
  markdown: fileResolver((text, source) => parseMarkdown(text, source.level))
}
