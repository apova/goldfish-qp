# Goldfish QP

**Quick Peek for forgetful humans.** When Claude's reply mentions an object, an abbreviation, a task or an identifier you care about, click it and a small card shows its definition, taken from **your own files**: no question to the model, no tokens spent.

```text
⏺ Do TASK-1 before the SLA review; TASK-9 is new.

  click a term to see its definition
  [TASK-1]  [SLA]  [TASK-9 ? no definition]

  [TASK-1]
  ╭──────────────────────────────────────────────────────────────╮
  │ Write the quarterly report                                   │
  │ Draft the report from last quarter's numbers and send it ... │
  │ tasks.json · updated 09:12:44                                │
  │ current · checked 09:31:05 · click the term to close         │
  ╰──────────────────────────────────────────────────────────────╯
```

- **Generic.** Nothing is built in. You say which patterns to recognize and where their definitions live.
- **Source-grounded.** A definition is text a source holds, shown as it is. If no source has one, the card says so; nothing is guessed or generated.
- **Fresh, or marked.** The latest copy is cached and replaced when its source changes. Every card says whether it is *current*, *stale*, *missing* or *ambiguous*.
- **Zero LLM.** Detection is a regular expression, lookup is a file read, and the card is drawn by the app.

Built for **Claude Desktop's Code tab**, and works in the Claude Code terminal too. See [Verification status](#verification-status) for what has and has not been confirmed in Desktop.

> **Easiest start:** tell your agent *"Set up Goldfish QP for me, following [get-started.md](../../get-started.md)"*. The rest of this page is the reference.

## Configure

Create `.goldfish-qp.json` in your project (or in your home folder as a fallback). The first one found is used.

```json
{
  "types": [
    { "name": "task", "pattern": "TASK-\\d+", "source": { "path": "docs/tasks.json" } },
    { "name": "term", "pattern": "\\b(?:SLA|QP)\\b", "source": { "path": "docs/glossary.md", "level": 2 } }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `name` | A label for you, used in messages. |
| `pattern` | A regular expression (in JSON, backslashes doubled). Each match in a reply is a term. Case-sensitive. |
| `source` or `sources` | One source or a list. Every source listed for a type is consulted. |
| `source.path` | `/absolute`, `~/home`, or relative to the folder holding `.goldfish-qp.json`. |
| `source.kind` | `json` or `markdown`. Left out, it follows the extension (`.json`, `.md`). |
| `source.level` | Markdown only: the heading level that starts an entry (default `2`). |

A broken pattern, source or file is reported once as a toast; the rest of the config keeps working.

### JSON sources

A map from key to a definition, or to `{ "name", "definition" }`; or an array of `{ "key", "name", "definition" }`, which may repeat a key (that is how a real ambiguity looks). An entry without definition text is skipped.

```json
{ "TASK-1": { "name": "Write the report", "definition": "Draft it and send it by Friday." },
  "TASK-2": "A plain string works too." }
```

### Markdown sources

Each heading of the chosen level is an entry. Its key is the heading up to the first ` — `, ` – `, ` - ` or `: `; the name is the whole heading; the definition is everything under it up to the next heading of that level or above. Headings inside code fences are ignored.

```markdown
## SLA — Service level agreement
How fast we promise to answer.
```

Ready-made copies of all three files are in [`examples/`](examples).

### Tickets and pull requests: command sources and links

A source can be a **command**: the mod runs it (no shell, no model), turns its JSON output into the card with templates, and keeps the latest answer per term for `ttl` seconds (default 60; opening a card always looks again). `{0}` is the matched term, `{1}`... its regex groups, `{some.field}` a field of the output. A field the output lacks is an error shown on the card, never a blank.

```json
{
  "types": [
    {
      "name": "ticket",
      "pattern": "\\bPROJ-\\d+\\b",
      "source": { "run": ["multica", "issue", "get", "{0}", "--output", "json"], "name": "{identifier}: {title}", "definition": "{status}, priority: {priority}" }
    },
    {
      "name": "pr",
      "pattern": "(?<![\\w/])(?:PR ?#?|#)(\\d+)\\b",
      "link": "https://github.com/OWNER/REPO/pull/{1}",
      "source": { "run": ["gh", "pr", "view", "{1}", "-R", "OWNER/REPO", "--json", "number,title,state,url,author"], "name": "PR #{number}: {title}", "definition": "{state}, by {author.login}" }
    }
  ]
}
```

- **`link`** (on a type) is a URL template; the card shows it as a link even before, or without, a successful lookup.
- Types are tried **in the order listed** and the first one with a definition answers: put specific types (tickets, PRs) before a broad abbreviation type. Several definitions inside one type are still ambiguous.
- A command that cannot run keeps the last answer, marked stale; a command that says "not found" makes the term missing.
- The command runs where the session runs: on your Mac for a local session, on the server for a Remote Control one. It needs to be logged in there.

### Recognize every abbreviation and identifier

To get a chip on every abbreviation or ID in a reply (`PROJ-123`, `AB-1`, `C5`, `SM`, `beta.32`), put this in `~/.goldfish-qp.json`. The project's config and the home config both apply. `ignore` lists terms that never get a chip.

```json
{
  "ignore": ["API", "CI", "PR", "LLM", "OK", "TODO"],
  "types": [
    {
      "name": "abbreviations and ids",
      "pattern": "\\b(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z]+[0-9]+|[A-Z]{2,5}|[a-z]+(?:\\.[0-9]+)+)\\b",
      "source": { "path": "~/.goldfish-qp/glossary.json" }
    }
  ]
}
```

A JSON entry may carry `"from"`, where its definition was taken from; the card shows it.

## Keeping definitions up to date without editing files

The plugin ships a skill, [`/goldfish-qp:define`](skills/define/SKILL.md): Claude finds the right source through `.goldfish-qp.json` and adds, replaces or removes the entry, touching nothing else, and only with text the conversation or a file actually established (it asks instead of guessing). Say `zdefiniuj TASK-5: ...` or `update the definition of TASK-1`. For it to happen on its own, add a rule to your `CLAUDE.md` (project or `~/.claude/CLAUDE.md`) telling Claude to run it whenever a configured term gets a settled meaning or a changed one. This is ordinary editing by the model while you work; **viewing** a definition stays free of any model call.

## What the card tells you

| Chip | Status | Meaning |
| --- | --- | --- |
| `[TASK-1]` (green) | **current** | A source holds the definition, and it was looked at moments ago. |
| `[TASK-1 ⚠ stale]` (yellow) | **stale** | The source is unavailable now (moved, unreadable, invalid). The last known definition is shown, labelled `STALE` with the reason. |
| `[TASK-9 ? no definition]` (red) | **missing** | The pattern matched but no source has an entry (never defined, or removed since). The card says where it looked. |
| `[TASK-3 ≠ ambiguous]` (purple) | **ambiguous** | More than one entry has that key, in one source or several. All are listed; none is chosen. |

Freshness:

- **Cached:** the latest copy of each source, with `resolvedAt` (when this content was read) and `checkedAt` (when the source was last looked at), shown on the card as *updated* and *checked*.
- **Checked** when a reply is drawn (at most once a second per source) and **at once when you open a card**, so a card is never older than your click.
- **Cheap:** a source is read again only when its size or modification time changed. If the content is identical (a touch), the copy and its *updated* time are kept.
- **Replaced, not accumulated:** a changed source replaces its copy. An entry deleted from the source disappears (missing); a deleted file leaves the last copy, marked stale.
- No file watcher, no database, no background process.

## Install

Claude Code terminal:

```text
/plugin marketplace add apova/goldfish-qp
/plugin install goldfish-qp@goldfish-qp
/tui fullscreen
```

`/tui fullscreen` turns on the interface that reports the mouse; without it nothing is clickable in a terminal.

Claude Desktop's Code tab has no `/plugin`: load the folder with an environment variable, as the [manual verification](#manual-verification-in-claude-desktops-code-tab) below describes.

## Path previews (from Quick Peek)

Goldfish QP keeps the original Quick Peek. Its paths in Claude's replies become links:

- **Which paths**: absolute (`/Users/…`), from home (`~/…`), relative (`./x`, `src/app.ts`, `README.md`: from the folder the shell is in, else from the project's, so they still lead somewhere after a `cd`), with or without backticks, and with a `:line` or `:line:column` after them. Only the paths that lead to a file or a folder become links; the rest stay as Claude wrote them. Inside backticks a path may hold spaces.
- **Hover**: the path is underlined and a small window opens by the pointer, above it and to its right, without taking the focus: the file's Quick Look thumbnail (a video's frame, an image, a PDF's or a document's first page), else its icon; its name, its kind, size and age as your system words them, and the folder it is in. A folder shows its icon and its first entries. Move off the path and it closes.
- **Code**: a file of code or text (`.js`, `.ts`, `.tsx`, `.html`, `.css`, `.json`, `.md`, `.py`, `.go`, `.rs`, `.sh`, `.yml`, a `Dockerfile`, a `.env` and many more) shows its first 20 lines instead, numbered and coloured, its language and how many lines it has under them. A path with a line (`src/app.ts:42`) shows the lines around it, that one lit.
- **Click**: Finder opens the folder with the file selected (`open -R`). **Option-click** opens the file itself, with its app.

A path a row cannot hold is drawn in parts, cut after a `/`, and each part is the link. Clicking and hovering need the mouse, so in the terminal they need Claude Code's fullscreen interface: type `/tui fullscreen` in the session (`/tui default` goes back).

### Other systems

| System | Click | Hover |
| --- | --- | --- |
| macOS | Finder, the file selected | A window by the pointer, with the Quick Look thumbnail |
| Linux | The file manager, the file selected (`org.freedesktop.FileManager1`), else its folder with `xdg-open` | A one-line card over the path: name, size, age; a file of code, its first 8 lines under it |
| Windows | Explorer, the file selected (`explorer /select,`) | The card |
| WSL | Windows' Explorer, the path turned into its Windows form by `wslpath -w` | The card |

Turn the window off with the **Preview paths in a window** option (`/config`) to get the card on macOS too. Over SSH the window would open on the other machine, so there the card shows.

These previews run **in the terminal's fullscreen interface only**. In Claude Desktop the definition chips work, but paths are not turned into links: that part of Quick Peek replaces the whole message layout and has not been ported.

### Limits of the path previews

- Only Claude's replies: paths in tool rows (`Read(…)`, a command's output) and in your prompts stay as they are.
- A reply with a path that leads somewhere is drawn by the mod: its paragraphs and lists that hold such a path are laid out by the mod as Claude Code lays them out (bold, italics, code, links, nested and numbered lists), and every other block (headings, code blocks, tables, quotes) by Claude Code's own Markdown. A path in a heading, a table, a quote or a code block is no link.
- In plain text a path ends at a space or a bracket: a path with spaces is a link only inside backticks.
- A path is looked at when the reply is drawn; one created later becomes a link the next time the reply is drawn (scrolling it into view).
- Dragging to select text that starts on a path does not select: the path takes the pointer.
- A window stays a minute at most, and closes when another app comes to the front or the pointer goes a few rows away (the terminal does not say when the pointer leaves it).
- The card is drawn over the rows above the path (nine for a file of code): on the first rows on screen it is cut.
- A file of code over 1 MB, or one with what text never holds (a NUL), shows its thumbnail or icon, not its lines. Its colours come from a small highlighter of the mod's own in the window, and from Claude Code's in the card; lines inside a block comment that opens above them are coloured as code.
- An SVG is a picture: it shows its thumbnail, not its source.
- Option-click needs the terminal to report the Option key with the click; some keep Option-click for themselves.

## Manual verification in Claude Desktop's Code tab

The automated tests run every case on both the `terminal` and the `desktop` surface, but the test kit never paints anything: it proves the logic and that the UI tree is valid for Desktop's element table, **not** that the Desktop app shows it or delivers the pointer events. These steps are the actual check.

1. **Point Desktop at this plugin.** Quit Claude Desktop (Cmd+Q). In `~/.claude/settings.json`, inside the top-level object, set the following (replace the value if the key exists; do not paste an extra pair of braces around it):

   ```json
   "env": {
     "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/goldfish-qp/plugins/goldfish-qp",
     "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
   }
   ```

   This replaces the probe's path: do not list both.
2. **Make a demo project.**

   ```bash
   mkdir -p ~/goldfish-qp-demo && cp -R /path/to/goldfish-qp/plugins/goldfish-qp/examples/. ~/goldfish-qp-demo/
   ```
3. Start Claude Desktop, open the **Code** tab, choose the folder `~/goldfish-qp-demo`, start a **new local session**.
4. Send: `Reply with exactly this line and nothing else: TASK-1, TASK-2, TASK-9, SLA and QP`

Then check and write down what you saw:

| # | Do | Expect |
| --- | --- | --- |
| 1 | Look under the reply. | `click a term to see its definition` and chips `[TASK-1] [TASK-2] [TASK-9 ? no definition] [SLA] [QP]`. |
| 2 | Click `[TASK-1]`. | A card: *Write the quarterly report*, its definition, `tasks.json · updated HH:MM:SS`, `current · checked HH:MM:SS`. Click again: it closes. |
| 3 | Click `[SLA]`, then `[TASK-9 …]`. | SLA: *SLA — Service level agreement*, `glossary.md`. TASK-9: "No definition found. Nothing is guessed." and where it looked. |
| 4 | Hover a chip (no click). | Underline, and a one-line preview card below it. Hover is a bonus: note if it is missing or clipped. |
| 5 | **Change:** edit TASK-1's `definition` in `~/goldfish-qp-demo/tasks.json`, save, then close and reopen the card. | The new text, with a newer `updated` time. No restart. |
| 6 | **Removal:** delete the `TASK-2` entry from `tasks.json`, save, close and reopen TASK-2's card. | `No definition found`; the old text is gone. |
| 7 | **Stale:** `mv ~/goldfish-qp-demo/tasks.json ~/goldfish-qp-demo/tasks.off`, then close and reopen TASK-1. | The last definition, a yellow `STALE: tasks.json unavailable (...)` line, chip `[TASK-1 ⚠ stale]`. Move the file back and reopen: current again. |
| 8 | **Ambiguous:** replace `tasks.json` with `[{"key":"TASK-1","name":"A","definition":"First."},{"key":"TASK-1","name":"B","definition":"Second."}]`, reopen TASK-1. | Chip `≠ ambiguous`; both definitions listed, "none chosen". Restore the file after. |
| 9 | **Broken config:** change a `pattern` in `.goldfish-qp.json` to `(`, start a new session and send the line again. | A toast `goldfish-qp: ... not a valid regular expression`; the other types still get chips. |
| 10 | **No LLM:** note the session's usage before and after steps 2 to 8. | Clicking, hovering and editing sources cost no tokens (only your own messages and Claude's replies do). |

If no chips appear: the session must be **new** and **local**, started after the restart; `settings.json` must be valid JSON; the reply must contain a term exactly (`TASK-1`, not `task-1`); and `.goldfish-qp.json` must be in the session's folder or in `~`. Look for lines starting `goldfish-qp:` in the transcript or in `claude --debug`.

## Verification status

- **Automated (`npm test`):** definition parsing, config, the four statuses, cache replacement and invalidation, click open and close, hover markup, and no model call, all on terminal and desktop surfaces; plus the original path-preview tests.
- **Confirmed by hand in Claude Desktop (the probe):** `Client` pointer events and the click-to-open card.
- **Not yet confirmed in Desktop for this version:** everything in the table above with the new cards, in particular the status colors, the hover preview and the re-lookup on open.

## How it works

The path previews: one hooks module ([`hooks/register.tsx`](hooks/register.tsx)), a surface module for the links ([`hooks/link.tsx`](hooks/link.tsx)), the markdown it lays out ([`hooks/markdown.ts`](hooks/markdown.ts)), the paths it finds ([`hooks/paths.ts`](hooks/paths.ts)), the code it previews ([`hooks/code.ts`](hooks/code.ts)) and the window's program ([`hooks/window.ts`](hooks/window.ts)):

- A `ui.render` hook on `AssistantMessage` cuts the reply into blocks and finds the paths in its paragraphs and list items, inline code included. Each is resolved (`~`, the shell's folder, else the project's: `$.session.root()`) and looked at with `$.fs.stat`, the answers kept a few seconds.
- With none that leads somewhere, Claude Code draws the reply. Otherwise the mod draws it: the bullet, the blocks with no path as one `Markdown` each, and the others wrapped into rows the way Claude Code wraps a reply, each part of a path a `Client` drawing that part in the color of inline code. The tree replaces only Claude Code's own node, so what other mods draw around a reply stays.
- Each `Client` posts when the pointer comes onto it, moves on it and leaves it, and when it is clicked; a `ui.message` hook opens and closes the preview, or shows the path in the file manager.
- On macOS a hover starts `osascript` with a JavaScript for Automation program, told the path (`QUICK_PEEK_FILE`), the picture's largest side and how long it may stay. It draws an AppKit panel that never takes the focus or the pointer, with the thumbnail from `QLThumbnailImageCreate` and the kind, size and date from the file's resource values, formatted by the system. It says `shown`, then a `.` every tenth of a second, so the mod wakes to end it when the pointer leaves.
- A file of code or text is known by its name. The mod reads it with `$.fs.read`, cuts the lines a preview shows (around the line the path names), and colours them with a regex highlighter per language; the window is told them as JSON (`QUICK_PEEK_CODE`) and draws them on a plate, one monospaced label a line, in place of the thumbnail.
- Without a window, each part of a path is a keyed `Box` holding a card drawn `display: "none"`, which the terminal reveals while the pointer is on the path, with no hook running. A file of code adds its lines to the card as a `Code` element, which Claude Code colours with its own highlighter.

The definition viewer adds: [`peek.tsx`](hooks/peek.tsx), the hooks (a row of chips under each reply, and the re-lookup when a card opens); [`card.tsx`](hooks/card.tsx), the surface module of one chip and its card; [`config.ts`](hooks/config.ts), the config; [`definitions.ts`](hooks/definitions.ts), the cache and the status of a lookup; [`sources.ts`](hooks/sources.ts), the `Resolver` interface and the JSON and Markdown resolvers. Both parts share one `register.tsx`, since the engine allows one hook per event.

A new kind of source (a git revision, an HTTP ETag) is one more entry in `RESOLVERS`: a cheap `version` that changes when the source may have, and a `load` that returns its entries.

## Limits

- The chips are a row **under** the reply, not inline in its text.
- Patterns are plain case-sensitive regular expressions: a loose pattern matches loosely.
- Definitions are shown as plain text (Markdown inside a definition is not rendered).
- Sources are local JSON and Markdown files up to 1 MB, and commands that print JSON: no git, HTTP or glob sources yet.
- A long definition is cut at 1,200 characters, and says so.
- At most 12 distinct terms per reply get chips.

## Development

```bash
npm run validate     # claude plugin validate
npm test             # claude plugin test: every case on the terminal and the desktop surface
```

## License and attribution

MIT. Goldfish QP is a fork of [Quick Peek](https://github.com/midudev/better-claude/tree/main/plugins/quick-peek) from [midudev/better-claude](https://github.com/midudev/better-claude), © 2026 Miguel Ángel Durán (midudev). The original license and copyright are kept in [LICENSE](../../LICENSE).
