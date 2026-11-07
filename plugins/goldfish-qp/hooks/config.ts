// The config: which objects to recognize (a regular expression each) and where their definitions
// live, and which terms to leave alone. Read from `.goldfish-qp.json` in the project and in the
// home folder, both used (the project's types first); read again when a file changes, and the
// last good config kept when one stops parsing.
import type { EngineInterface } from 'claude-code'

import { RESOLVERS } from './sources'
import type { SourceSpec } from './sources'

type Engine = EngineInterface

export type TypeSpec = { name: string; scan: RegExp; whole: RegExp; link?: string; sources: SourceSpec[] }
export type Config = { file?: string; types: TypeSpec[]; ignore: string[]; problems: string[] }

export const CONFIG_NAME = '.goldfish-qp.json'
const CHECK_MS = 1000
const EMPTY: Config = { types: [], ignore: [], problems: [] }

let loaded: { config: Config; signature: string; checkedAt: number } | undefined

export function resetConfig () {
  loaded = undefined
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

/** An absolute path from the way the config spells it: `~/x`, `/x`, or relative to the config's folder. */
function resolvePath (spelled: string, folder: string, home: string | undefined) {
  const joined = spelled.startsWith('~/') && home ? `${home}/${spelled.slice(2)}` : spelled.startsWith('/') ? spelled : `${folder}/${spelled}`
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** The config a text holds; what is wrong with it is told in `problems`, and the rest still works. */
export function compile (text: string, file: string, home: string | undefined): Config {
  const problems: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { file, types: [], ignore: [], problems: [`${CONFIG_NAME}: not valid JSON (${error instanceof Error ? error.message : String(error)})`] }
  }
  const list = (raw as { types?: unknown } | null)?.types
  if (!Array.isArray(list)) return { file, types: [], ignore: [], problems: [`${CONFIG_NAME}: needs a "types" array`] }
  const types: TypeSpec[] = []
  list.forEach((item: Record<string, unknown> | null, i) => {
    const name = typeof item?.name === 'string' && item.name !== '' ? item.name : `type ${i + 1}`
    if (typeof item?.pattern !== 'string' || item.pattern === '') return void problems.push(`${name}: "pattern" must be a regular expression string`)
    let scan: RegExp
    let whole: RegExp
    try {
      scan = new RegExp(item.pattern, 'g')
      whole = new RegExp(`^(?:${item.pattern})$`)
    } catch {
      return void problems.push(`${name}: "pattern" is not a valid regular expression`)
    }
    const given = item.sources ?? item.source
    const sources: SourceSpec[] = []
    for (const one of Array.isArray(given) ? given : given === undefined ? [] : [given]) {
      const { path, kind, level, run, definition, name: label, ttl } = (one ?? {}) as { path?: unknown; kind?: unknown; level?: unknown; run?: unknown; definition?: unknown; name?: unknown; ttl?: unknown }
      if (kind === 'command' || (kind === undefined && run !== undefined)) {
        if (!Array.isArray(run) || run.length === 0 || !run.every(part => typeof part === 'string' && part !== '') || typeof definition !== 'string' || definition === '') {
          problems.push(`${name}: a command source needs "run" (a list of strings) and "definition"`)
          continue
        }
        sources.push({ kind: 'command', path: '', label: (run as string[]).join(' ').slice(0, 60), run: run as string[], definition, ...(typeof label === 'string' && { name: label }), ...(typeof ttl === 'number' && ttl > 0 && { ttl: ttl * 1000 }) })
        continue
      }
      if (typeof path !== 'string' || path === '') {
        problems.push(`${name}: a source needs a "path"`)
        continue
      }
      const resolved = typeof kind === 'string' ? kind : /\.(md|markdown)$/i.test(path) ? 'markdown' : /\.json$/i.test(path) ? 'json' : ''
      if (!(resolved in RESOLVERS)) {
        problems.push(`${name}: source ${path} has no known kind (${[...Object.keys(RESOLVERS), 'command'].join(', ')})`)
        continue
      }
      sources.push({ kind: resolved, path: resolvePath(path, dirOf(file), home), label: path, ...(typeof level === 'number' && level >= 1 && level <= 6 && { level: Math.floor(level) }) })
    }
    if (sources.length === 0) return void problems.push(`${name}: no usable source`)
    types.push({ name, scan, whole, ...(typeof item.link === 'string' && item.link !== '' && { link: item.link }), sources })
  })
  const ignored = (raw as { ignore?: unknown }).ignore
  const ignore = Array.isArray(ignored) ? ignored.filter((term): term is string => typeof term === 'string' && term !== '') : []
  if (ignored !== undefined && !Array.isArray(ignored)) problems.push(`${CONFIG_NAME}: "ignore" must be an array of terms`)
  return { file, types, ignore, problems }
}

/** The config files that are there, the project's first; the home folder's too unless it is the same file. */
async function filesOf ($: Engine, home: string | undefined) {
  const root = await $.session.root().catch(() => $.session.cwd())
  const found: { file: string; signature: string }[] = []
  for (const file of new Set([`${root}/${CONFIG_NAME}`, ...(home ? [`${home}/${CONFIG_NAME}`] : [])])) {
    const stat = await $.fs.stat(file).catch(() => null)
    if (stat && stat.kind === 'file') found.push({ file, signature: `${file}\n${stat.size}:${stat.mtimeMs}` })
  }
  return found
}

/** The config now: the project's `.goldfish-qp.json` and the home folder's together; empty with neither. */
export async function configOf ($: Engine): Promise<Config> {
  const now = await $.clock.now()
  if (loaded && now - loaded.checkedAt < CHECK_MS) return loaded.config
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const files = await filesOf($, home)
  if (files.length === 0) {
    // No config file at all: nothing is recognized.
    loaded = undefined
    return EMPTY
  }
  const signature = files.map(file => file.signature).join('\n')
  if (loaded?.signature === signature) {
    loaded.checkedAt = now
    return loaded.config
  }
  try {
    const configs = await Promise.all(files.map(async ({ file }) => compile(String(await $.fs.read(file)), file, home)))
    const config: Config = { file: files[0]!.file, types: configs.flatMap(one => one.types), ignore: configs.flatMap(one => one.ignore), problems: configs.flatMap(one => one.problems) }
    loaded = { config, signature, checkedAt: now }
    return config
  } catch {
    // A config that is there but cannot be read: the last good one stays.
    if (loaded) loaded.checkedAt = now
    return loaded?.config ?? EMPTY
  }
}

/** The distinct terms of `text` that some type's pattern matches and the config does not ignore, in order of appearance. */
export function termsIn (text: string, config: Config, limit = 12): string[] {
  const found = new Map<string, number>()
  for (const { scan } of config.types) {
    for (const match of text.matchAll(scan)) {
      if (match[0] !== '' && !config.ignore.includes(match[0]) && !found.has(match[0])) found.set(match[0], match.index ?? 0)
    }
  }
  return [...found].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([term]) => term)
}
