// The definition viewer. Every engine case runs on the terminal and on the desktop surface. The
// kit proves the mod's logic and that its tree is valid for each surface's element table; it never
// paints, so that Claude Desktop shows and clicks the chips is for the manual test in the README.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { compile, termsIn } from './config'
import { fingerprint, parseJson, parseMarkdown } from './sources'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const CONFIG = JSON.stringify({
  types: [
    { name: 'task', pattern: 'TASK-\\d+', source: { path: 'defs/tasks.json' } },
    { name: 'term', pattern: '\\b(?:SLA|QP)\\b', source: { path: 'docs/glossary.md' } }
  ]
})
const ABBREV = '\\b(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z]+[0-9]+|[A-Z]{2,5}|[a-z]+(?:\\.[0-9]+)+)\\b'
const TASKS = (one: string) => JSON.stringify({ 'TASK-1': { name: 'Write the report', definition: one }, 'TASK-2': 'Plain string definition.' })
const GLOSSARY = '# Glossary\n\nIgnored intro.\n\n## SLA — Service level agreement\nHow fast we answer.\n\n## QP\nQuick peek.\n'

type Files = Record<string, { text: string; mtimeMs: number } | undefined>

/** The engine beneath the mod: a project at /project holding `files`, a clock, and a trap for any model call. */
function world (on: On, files: Files) {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.env(on, { HOME: '/home/ana' })
  const models: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/project' }))
  on('session.root', () => ({ value: '/project' }))
  on('fs.stat', ($, e) => {
    const file = files[e.path]
    return file ? { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } } : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.read', ($, e) => {
    const file = files[e.path]
    return file ? { value: file.text } : { deny: `ENOENT: ${e.path}` }
  })
  on('model.complete', () => { models.push('complete'); return { deny: 'no model in tests' } })
  on('model.classify', () => { models.push('classify'); return { deny: 'no model in tests' } })
  on('model.fork', () => { models.push('fork'); return { deny: 'no model in tests' } })
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine reply</Text>
  })
  return { clock, models, toasts }
}

const project = (tasks: string = TASKS('Draft and send the quarterly report.')): Files => ({
  '/project/.goldfish-qp.json': { text: CONFIG, mtimeMs: 1 },
  '/project/defs/tasks.json': { text: tasks, mtimeMs: 1 },
  '/project/docs/glossary.md': { text: GLOSSARY, mtimeMs: 1 }
})

const start = ($: Engine, surface: Surface) => $.session.start({ cwd: '/project', surface, isInteractive: true })
const reply = ($: Engine, surface: Surface, text: string) =>
  $.ui.mount({ plugin: 'goldfish-qp', surface, component: 'AssistantMessage', requestId: `a-${text}`, props: { text, isFirstOfReply: true }, viewport: { columns: 80, rows: 40, isFullscreen: true } })
type Ui = Awaited<ReturnType<typeof reply>>

const click = async (ui: Ui, term: string) => {
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: `chip:${term}` })
  await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: `chip:${term}` })
}
const has = async (ui: Ui, term: string, text: string | RegExp) => (await ui.find({ type: 'Text', text, in: `chip:${term}` })) !== undefined
const chipOf = async (ui: Ui, term: string) => (await ui.findAll({ type: 'Text', in: `chip:${term}` }))[0]?.text

test('JSON sources: a map or an array, definitions only as the source writes them', () => {
  const entries = parseJson(JSON.stringify({ A: 'one', B: { name: 'Bee', definition: 'two' }, C: { name: 'no definition' }, D: '  ', E: 7 }))
  expect(entries).toEqual([{ key: 'A', name: 'A', definition: 'one' }, { key: 'B', name: 'Bee', definition: 'two' }])
  expect(parseJson(JSON.stringify([{ key: 'X', definition: 'a' }, { id: 'X', name: 'Ex', definition: 'b' }, { definition: 'no key' }])).map(e => e.key)).toEqual(['X', 'X'])
  expect(() => parseJson('{ broken')).toThrow()
})

test('Markdown sources: a heading of the level is an entry, its key before the dash, fences are not headings', () => {
  const text = '# Title\nintro\n## TASK-9 — Name here\nFirst line.\n\n### Sub heading stays in the body\nMore.\n```\n## not a heading\n```\n## Empty entry\n## QP: short\nbody\n'
  const entries = parseMarkdown(text)
  expect(entries.map(e => [e.key, e.name])).toEqual([['TASK-9', 'TASK-9 — Name here'], ['QP', 'QP: short']])
  expect(entries[0]!.definition).toContain('### Sub heading stays in the body')
  expect(entries[0]!.definition).toContain('## not a heading')
  expect(parseMarkdown('# A\ntext\n## B\nx', 1).map(e => e.key)).toEqual(['A'])
})

test('the config: patterns and sources are checked, what is wrong is told, the rest works', () => {
  const config = compile(JSON.stringify({ types: [
    { name: 'ok', pattern: 'X-\\d+', sources: [{ path: '~/a.json' }, { path: '../b.md', level: 3 }] },
    { name: 'bad regex', pattern: '(', source: { path: 'a.json' } },
    { name: 'no source', pattern: 'Y' },
    { name: 'unknown kind', pattern: 'Z', source: { path: 'a.txt' } }
  ] }), '/project/sub/.goldfish-qp.json', '/home/ana')
  expect(config.types.map(t => t.name)).toEqual(['ok'])
  expect(config.types[0]!.sources.map(s => [s.kind, s.path, s.level])).toEqual([['json', '/home/ana/a.json', undefined], ['markdown', '/project/b.md', 3]])
  expect(config.problems).toHaveLength(4)
  expect(compile('{ nope', '/p/.goldfish-qp.json', undefined).problems[0]).toContain('not valid JSON')
  expect(termsIn('TASK-1, X-22 and X-22, plus QP.', compile(CONFIG, '/project/.goldfish-qp.json', undefined))).toEqual(['TASK-1', 'QP'])
  const broad = compile(JSON.stringify({ ignore: ['API', 'CI', 7], types: [{ name: 'abbr', pattern: ABBREV, source: { path: 'g.json' } }] }), '/p/.goldfish-qp.json', undefined)
  expect(broad.ignore).toEqual(['API', 'CI'])
  expect(termsIn('AB-1 started as PROJ-123: C5 writes the plan; SM reviews, XYZ stays; beta.32, API, CI and OK-1 and ok.', broad)).toEqual(['AB-1', 'PROJ-123', 'C5', 'SM', 'XYZ', 'beta.32', 'OK-1'])
  expect(fingerprint('a')).not.toBe(fingerprint('b'))
})

test('a reply naming configured objects gets a chip each; one naming none, or with no config, is the engine\'s', async ($, on) => {
  const files = project()
  const { models } = world(on, files)
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await reply($, surface, 'Do TASK-1 before the SLA; TASK-7 is new, and "ASLAP" is not a term.')
    expect(await ui.find({ type: 'Text', text: 'engine reply' })).toBeDefined()
    expect((await ui.findAll({ type: 'Client' })).map(c => c.key)).toEqual(['chip:TASK-1', 'chip:SLA', 'chip:TASK-7'])
    expect(await chipOf(ui, 'TASK-1')).toBe('[TASK-1]')
    expect(await chipOf(ui, 'TASK-7')).toBe('[TASK-7 ? no definition]')
    await ui.unmount()
    const none = await reply($, surface, 'Nothing configured here.')
    expect(await none.find({ type: 'Client' })).toBeUndefined()
    await none.unmount()
  }
  delete files['/project/.goldfish-qp.json']
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await reply($, surface, 'TASK-1 and QP, but no config now.')
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  }
  expect(models).toEqual([])
})

test('a click opens the definition card in the app: name, definition, source, freshness; a second click closes it', async ($, on) => {
  const { models } = world(on, project())
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await reply($, surface, 'TASK-1 and QP')
    expect(await has(ui, 'TASK-1', 'Draft and send the quarterly report.')).toBe(true) // the hover preview
    expect(await has(ui, 'TASK-1', 'click the term to close')).toBe(false)
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'chip:TASK-1' }) // an up with no down is no click
    expect(await has(ui, 'TASK-1', /click the term to close/)).toBe(false)
    await click(ui, 'TASK-1')
    expect(await has(ui, 'TASK-1', 'Write the report')).toBe(true)
    expect(await has(ui, 'TASK-1', 'Draft and send the quarterly report.')).toBe(true)
    expect(await has(ui, 'TASK-1', /^defs\/tasks\.json · updated \d\d:\d\d:\d\d$/)).toBe(true)
    expect(await has(ui, 'TASK-1', /^current · checked \d\d:\d\d:\d\d · click the term to close$/)).toBe(true)
    await click(ui, 'TASK-1')
    expect(await has(ui, 'TASK-1', /click the term to close/)).toBe(false)
    await click(ui, 'QP')
    expect(await has(ui, 'QP', 'Quick peek.')).toBe(true)
    expect(await has(ui, 'QP', /^docs\/glossary\.md/)).toBe(true)
    await ui.unmount()
  }
  expect(models).toEqual([])
})

test('the chip carries a hover preview a Box reveals, on both surfaces', async ($, on) => {
  world(on, project())
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await reply($, surface, 'TASK-1')
    const hoverable = JSON.stringify(await ui.find({ type: 'Box', key: 'hoverable', in: 'chip:TASK-1' }))
    expect(hoverable).toContain('"hover":{"display":"flex"}')
    await ui.pointer({ type: 'enter', x: 1, y: 0, in: 'chip:TASK-1' })
    expect((await ui.find({ type: 'Text', text: '[TASK-1]', in: 'chip:TASK-1' }))?.props.underline).toBe(true)
    await ui.pointer({ type: 'leave', x: 1, y: 0, in: 'chip:TASK-1' })
    expect((await ui.find({ type: 'Text', text: '[TASK-1]', in: 'chip:TASK-1' }))?.props.underline).toBe(false)
    await ui.unmount()
  }
})

test('when the source changes the cached definition is replaced: on the next reply, and on a click at once', async ($, on) => {
  const files = project()
  const { clock } = world(on, files)
  for (const surface of SURFACES) {
    files['/project/defs/tasks.json'] = { text: TASKS('Draft and send the quarterly report.'), mtimeMs: 1 }
    await start($, surface)
    let ui = await reply($, surface, 'TASK-1')
    await click(ui, 'TASK-1')
    expect(await has(ui, 'TASK-1', 'Draft and send the quarterly report.')).toBe(true)

    // The file changes; within the check interval a redraw still shows the copy it has, a click does not.
    files['/project/defs/tasks.json'] = { text: TASKS('Cancelled: the report is no longer needed.'), mtimeMs: 2 }
    await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'chip:TASK-1' })
    await ui.pointer({ type: 'up', x: 1, y: 0, button: 'left', in: 'chip:TASK-1' }) // closes
    await click(ui, 'TASK-1') // opens: the source is looked at again
    expect(await has(ui, 'TASK-1', 'Cancelled: the report is no longer needed.')).toBe(true)
    expect(await has(ui, 'TASK-1', 'Draft and send the quarterly report.')).toBe(false)
    await ui.unmount()

    // A later reply is drawn from the replaced copy, one copy only.
    await clock.advance(5000)
    files['/project/defs/tasks.json'] = { text: TASKS('Reopened: send it by Friday.'), mtimeMs: 3 }
    ui = await reply($, surface, 'TASK-1 again')
    expect(await has(ui, 'TASK-1', 'Reopened: send it by Friday.')).toBe(true)
    expect(await has(ui, 'TASK-1', /Cancelled/)).toBe(false)
    await ui.unmount()
  }
})

test('a touched file with the same content keeps the copy and its time; only the check time moves', async ($, on) => {
  const files = project()
  const { clock } = world(on, files)
  for (const surface of SURFACES) {
    await start($, surface)
    let ui = await reply($, surface, 'TASK-1')
    await click(ui, 'TASK-1')
    const updated = (await ui.find({ type: 'Text', text: /· updated/, in: 'chip:TASK-1' }))?.text
    await ui.unmount()
    await clock.advance(120_000)
    files['/project/defs/tasks.json']!.mtimeMs += 100
    ui = await reply($, surface, 'TASK-1')
    await click(ui, 'TASK-1')
    expect((await ui.find({ type: 'Text', text: /· updated/, in: 'chip:TASK-1' }))?.text).toBe(updated)
    expect(await has(ui, 'TASK-1', /^current · checked/)).toBe(true)
    await ui.unmount()
  }
})

test('an object removed from its source is invalidated: no definition, nothing kept', async ($, on) => {
  const files = project()
  world(on, files)
  for (const surface of SURFACES) {
    files['/project/defs/tasks.json'] = { text: TASKS('Draft and send the quarterly report.'), mtimeMs: 1 }
    await start($, surface)
    let ui = await reply($, surface, 'TASK-1')
    await click(ui, 'TASK-1')
    expect(await has(ui, 'TASK-1', 'Draft and send the quarterly report.')).toBe(true)
    files['/project/defs/tasks.json'] = { text: JSON.stringify({ 'TASK-2': 'Plain string definition.' }), mtimeMs: 2 }
    await click(ui, 'TASK-1') // closes
    await click(ui, 'TASK-1') // opens, looked at again
    expect(await has(ui, 'TASK-1', /No definition found/)).toBe(true)
    expect(await has(ui, 'TASK-1', /defs\/tasks\.json: no entry/)).toBe(true)
    expect(await has(ui, 'TASK-1', /quarterly report/)).toBe(false)
    expect(await chipOf(ui, 'TASK-1')).toBe('[TASK-1 ? no definition]')
    await ui.unmount()
    ui = await reply($, surface, 'TASK-1 once more')
    expect(await chipOf(ui, 'TASK-1')).toBe('[TASK-1 ? no definition]')
    await ui.unmount()
  }
})

test('an unavailable source keeps the last known definition, marked stale; a source never read is missing', async ($, on) => {
  const files = project()
  const { clock } = world(on, files)
  for (const surface of SURFACES) {
    files['/project/defs/tasks.json'] = { text: TASKS('Draft and send the quarterly report.'), mtimeMs: 1 }
    await start($, surface)
    let ui = await reply($, surface, 'TASK-1')
    await click(ui, 'TASK-1')
    await click(ui, 'TASK-1')
    delete files['/project/defs/tasks.json']
    await click(ui, 'TASK-1')
    expect(await has(ui, 'TASK-1', 'Draft and send the quarterly report.')).toBe(true)
    expect(await has(ui, 'TASK-1', /^STALE: defs\/tasks\.json unavailable \(ENOENT.*showing the last known definition$/)).toBe(true)
    expect(await has(ui, 'TASK-1', /· STALE$/)).toBe(true)
    expect(await has(ui, 'TASK-1', /^stale · checked/)).toBe(true)
    expect(await chipOf(ui, 'TASK-1')).toBe('[TASK-1 ⚠ stale]')
    await ui.unmount()

    // It comes back: current again, with no mark left.
    files['/project/defs/tasks.json'] = { text: TASKS('Draft and send the quarterly report.'), mtimeMs: 9 }
    await clock.advance(5000)
    ui = await reply($, surface, 'TASK-1')
    expect(await chipOf(ui, 'TASK-1')).toBe('[TASK-1]')
    await ui.unmount()

    // Never readable: nothing to keep, nothing invented.
    delete files['/project/defs/tasks.json']
    await start($, surface)
    ui = await reply($, surface, 'TASK-2')
    expect(await chipOf(ui, 'TASK-2')).toBe('[TASK-2 ? no definition]')
    await click(ui, 'TASK-2')
    expect(await has(ui, 'TASK-2', /defs\/tasks\.json: unavailable \(ENOENT/)).toBe(true)
    await ui.unmount()
  }
})

test('several definitions of one object are ambiguous: all shown, none chosen', async ($, on) => {
  const tasks = JSON.stringify([{ key: 'TASK-3', name: 'First meaning', definition: 'The audit.' }, { key: 'TASK-3', name: 'Second meaning', definition: 'The migration.' }])
  world(on, project(tasks))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await reply($, surface, 'TASK-3')
    expect(await chipOf(ui, 'TASK-3')).toBe('[TASK-3 ≠ ambiguous]')
    await click(ui, 'TASK-3')
    expect(await has(ui, 'TASK-3', 'TASK-3: 2 definitions, none chosen')).toBe(true)
    expect(await has(ui, 'TASK-3', 'The audit.')).toBe(true)
    expect(await has(ui, 'TASK-3', 'The migration.')).toBe(true)
    expect(await has(ui, 'TASK-3', /^ambiguous · checked/)).toBe(true)
    await ui.unmount()
  }
})

test('a broken config is told once, and what is valid in it still works', async ($, on) => {
  const files = project()
  files['/project/.goldfish-qp.json'] = { text: JSON.stringify({ types: [{ name: 'broken', pattern: '(', source: { path: 'defs/tasks.json' } }, { name: 'task', pattern: 'TASK-\\d+', source: { path: 'defs/tasks.json' } }] }), mtimeMs: 2 }
  const { toasts } = world(on, files)
  for (const surface of SURFACES) {
    await start($, surface)
    for (const text of ['TASK-1', 'TASK-2']) {
      const ui = await reply($, surface, text)
      expect(await chipOf(ui, text)).toBe(`[${text}]`)
      await ui.unmount()
    }
  }
  expect(toasts.filter(t => t.includes('not a valid regular expression'))).toHaveLength(2) // once a session start
})

test('the project config and the home config both apply; ignored terms get no chip; a definition says where it is from', async ($, on) => {
  const files = project()
  files['/home/ana/.goldfish-qp.json'] = { text: JSON.stringify({ ignore: ['API'], types: [{ name: 'abbr', pattern: ABBREV, source: { path: '~/glossary.json' } }] }), mtimeMs: 1 }
  files['/home/ana/glossary.json'] = { text: JSON.stringify({ 'AB-1': { name: 'Phase A', definition: 'The first work package.', from: 'ticket PROJ-123' }, SM: 'Scrum master.' }), mtimeMs: 1 }
  world(on, files)
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await reply($, surface, 'AB-1 and SM, the API, TASK-1 and C5.')
    expect((await ui.findAll({ type: 'Client' })).map(c => c.key)).toEqual(['chip:AB-1', 'chip:SM', 'chip:TASK-1', 'chip:C5'])
    expect(await chipOf(ui, 'AB-1')).toBe('[AB-1]')
    expect(await chipOf(ui, 'C5')).toBe('[C5 ? no definition]')
    expect(await chipOf(ui, 'TASK-1')).toBe('[TASK-1]') // the project's definition, though the broad pattern matches it too
    await click(ui, 'AB-1')
    expect(await has(ui, 'AB-1', /^~\/glossary\.json · from: ticket PROJ-123 · updated \d\d:\d\d:\d\d$/)).toBe(true)
    await click(ui, 'SM')
    expect(await has(ui, 'SM', /^~\/glossary\.json · updated/)).toBe(true)
    await ui.unmount()
  }
})

// Command sources: a pull request through `gh`, a ticket through `multica`, links from a template.
const PR_TYPE = { name: 'pr', pattern: '\\bPR ?#?(\\d+)\\b', link: 'https://github.com/acme/widgets/pull/{1}', source: { run: ['gh', 'pr', 'view', '{1}', '-R', 'acme/widgets', '--json', 'number,title,state,url,author'], name: 'PR #{number}: {title}', definition: '{state} · by {author.login}', ttl: 60 } }
const TICKET_TYPE = { name: 'ticket', pattern: '\\bPROJ-\\d+\\b', source: { run: ['multica', 'issue', 'get', '{0}', '--output', 'json'], name: '{identifier}: {title}', definition: '{status}, {priority}' } }
const PR_JSON = (title: string, state = 'OPEN') => JSON.stringify({ number: 560, title, state, url: 'https://github.com/acme/widgets/pull/560', author: { login: 'apova' } })

type Run = { exitCode: number; stdout: string; stderr: string }
function commandWorld (on: On, files: Files, answer: (argv: readonly string[]) => Run) {
  const runs: string[][] = []
  const w = world(on, files)
  on('process.run', ($, e) => {
    if (e.argv[0] !== 'uname') runs.push([...e.argv]) // the path previews ask the system's name once
    const { exitCode, stdout, stderr } = answer(e.argv)
    return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { ...w, runs }
}
const withTypes = (types: unknown[], files: Files = project()): Files => ({ ...files, '/project/.goldfish-qp.json': { text: JSON.stringify({ types }), mtimeMs: 5 } })
const ok = (stdout: string): Run => ({ exitCode: 0, stdout, stderr: '' })

test('a pull request gets its title, state and link from gh, and a ticket its fields from multica; no model, no shell', async ($, on) => {
  const files = withTypes([TICKET_TYPE, PR_TYPE, { name: 'broad', pattern: '\\b[A-Z]+-\\d+\\b', source: { path: 'defs/tasks.json' } }])
  const { runs, models } = commandWorld(on, files, argv => (argv[0] === 'gh' ? ok(PR_JSON('Fix the flaky retry')) : ok(JSON.stringify({ identifier: 'PROJ-123', title: 'Add the export provider', status: 'in progress', priority: 'high' }))))
  for (const surface of SURFACES) {
    runs.length = 0
    await start($, surface)
    const ui = await reply($, surface, 'See PR #560 and PROJ-123.')
    expect((await ui.findAll({ type: 'Client' })).map(c => c.key)).toEqual(['chip:PR #560', 'chip:PROJ-123'])
    expect(await chipOf(ui, 'PR #560')).toBe('[PR #560]')
    await click(ui, 'PR #560')
    expect(await has(ui, 'PR #560', 'PR #560: Fix the flaky retry')).toBe(true)
    expect(await has(ui, 'PR #560', 'OPEN · by apova')).toBe(true)
    expect(await has(ui, 'PR #560', /^gh pr view 560 -R acme\/widgets .* · updated/)).toBe(true)
    expect((await ui.find({ type: 'Button', in: 'chip:PR #560' }))?.props.label).toBe('↗ https://github.com/acme/widgets/pull/560')
    runs.length = 0
    await ui.press({ key: 'open:PR #560' })
    expect(runs).toEqual([['open', 'https://github.com/acme/widgets/pull/560']]) // the link opens where the session runs
    await click(ui, 'PROJ-123')
    expect(await has(ui, 'PROJ-123', 'PROJ-123: Add the export provider')).toBe(true)
    expect(await has(ui, 'PROJ-123', 'in progress, high')).toBe(true)
    expect(runs.some(argv => argv.join(' ') === 'multica issue get PROJ-123 --output json')).toBe(true)
    await ui.unmount()
  }
  expect(models).toEqual([])
})

test('a command answer is kept for its ttl, looked at again on a click, and replaced when the output changes', async ($, on) => {
  let title = 'First title'
  const files = withTypes([PR_TYPE])
  const { runs, clock } = commandWorld(on, files, () => ok(PR_JSON(title)))
  for (const surface of SURFACES) {
    await start($, surface)
    runs.length = 0
    let ui = await reply($, surface, 'PR #560')
    ui = await reply($, surface, 'PR #560 again')
    expect(runs).toHaveLength(1) // the second reply used the kept answer
    await click(ui, 'PR #560')
    expect(runs).toHaveLength(2) // opening a card looks again
    title = 'Second title'
    await click(ui, 'PR #560')
    await click(ui, 'PR #560')
    expect(runs).toHaveLength(3)
    expect(await has(ui, 'PR #560', 'PR #560: Second title')).toBe(true)
    expect(await has(ui, 'PR #560', 'PR #560: First title')).toBe(false)
    await ui.unmount()
    await clock.advance(120_000)
    title = 'Third title'
    ui = await reply($, surface, 'PR #560 once more') // past the ttl: looked at again on the next reply
    await click(ui, 'PR #560')
    expect(await has(ui, 'PR #560', 'PR #560: Third title')).toBe(true)
    await ui.unmount()
  }
})

test('a command that fails keeps the last answer, stale; one never answered is missing; no such thing is not found; the link stays', async ($, on) => {
  let said: Run = ok(PR_JSON('Fix the flaky retry'))
  const files = withTypes([PR_TYPE])
  commandWorld(on, files, () => said)
  for (const surface of SURFACES) {
    said = ok(PR_JSON('Fix the flaky retry'))
    await start($, surface)
    let ui = await reply($, surface, 'PR #560')
    await click(ui, 'PR #560')
    await click(ui, 'PR #560')
    said = { exitCode: 1, stdout: '', stderr: 'dial tcp: connection refused' }
    await click(ui, 'PR #560')
    expect(await chipOf(ui, 'PR #560')).toBe('[PR #560 ⚠ stale]')
    expect(await has(ui, 'PR #560', 'PR #560: Fix the flaky retry')).toBe(true)
    expect(await has(ui, 'PR #560', /STALE: gh pr view 560 .* unavailable \(dial tcp: connection refused\); showing the last known definition/)).toBe(true)
    await ui.unmount()

    await start($, surface) // a new session: nothing kept
    ui = await reply($, surface, 'PR #561')
    expect(await chipOf(ui, 'PR #561')).toBe('[PR #561 ? no definition]')
    await click(ui, 'PR #561')
    expect(await has(ui, 'PR #561', /unavailable \(dial tcp/)).toBe(true)
    expect((await ui.find({ type: 'Button', in: 'chip:PR #561' }))?.props.label).toBe('↗ https://github.com/acme/widgets/pull/561') // from the number alone
    await ui.unmount()

    said = { exitCode: 1, stdout: '', stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 9999.' }
    ui = await reply($, surface, 'PR #9999')
    await click(ui, 'PR #9999')
    expect(await has(ui, 'PR #9999', /: not found/)).toBe(true)
    await ui.unmount()
  }
})

test('output that lacks a field the definition names is an error, never a blank definition', async ($, on) => {
  const files = withTypes([TICKET_TYPE])
  commandWorld(on, files, () => ok(JSON.stringify({ identifier: 'PROJ-123', title: 'No status here' })))
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await reply($, surface, 'PROJ-123')
    expect(await chipOf(ui, 'PROJ-123')).toBe('[PROJ-123 ? no definition]')
    await click(ui, 'PROJ-123')
    expect(await has(ui, 'PROJ-123', /the output lacks a field the definition needs/)).toBe(true)
    await ui.unmount()
  }
})

test('a term that looks like an option is never passed to a command', async ($, on) => {
  const files = withTypes([{ name: 'odd', pattern: '\\bX:(\\S+)', source: { run: ['tool', 'show', '{1}'], definition: '{x}' } }])
  const { runs } = commandWorld(on, files, () => ok('{}'))
  for (const surface of SURFACES) {
    runs.length = 0
    await start($, surface)
    const ui = await reply($, surface, 'X:--evil')
    expect(await chipOf(ui, 'X:--evil')).toBe('[X:--evil ? no definition]')
    expect(runs).toEqual([])
    await ui.unmount()
  }
})

test('a type listed first answers before a broad one: no false ambiguity', async ($, on) => {
  const files = withTypes([{ name: 'tasks', pattern: 'TASK-\\d+', source: { path: 'defs/tasks.json' } }, { name: 'broad', pattern: '\\b[A-Z]+-\\d+\\b', source: { path: 'defs/tasks.json' } }])
  world(on, files)
  for (const surface of SURFACES) {
    await start($, surface)
    const ui = await reply($, surface, 'TASK-1')
    expect(await chipOf(ui, 'TASK-1')).toBe('[TASK-1]')
    await ui.unmount()
  }
})
