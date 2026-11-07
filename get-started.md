# Get started with Goldfish QP (instructions for your AI agent)

> **For the person:** tell your agent *"Set up Goldfish QP for me, following get-started.md"* (or paste the raw link to this file). The agent does the steps below and asks you only the few questions marked **ASK**.
>
> **For the agent:** you are setting up Goldfish QP for the user, on the machine this session runs on. Follow the steps in order. Be careful with the user's files: back up before editing, keep what is already there, and never print or store secrets. Do not commit or push anything. Reply to the user in their language.

Goldfish QP shows a definition card when the user clicks an object, abbreviation, ticket or pull request in your replies. Definitions come from the user's own files or commands; viewing one costs no model call.

## 1. Install the plugin

Pick the case that matches this session.

- **Claude Code terminal:** tell the user to run, or run for them if you can:
  ```text
  /plugin marketplace add apova/goldfish-qp
  /plugin install goldfish-qp@goldfish-qp
  ```
- **Claude Desktop, Code tab (local session):** there is no `/plugin`. Clone the repo and point Claude at it:
  1. `git clone https://github.com/apova/goldfish-qp ~/goldfish-qp` (skip if the folder exists; `git pull` instead).
  2. Back up `~/.claude/settings.json`, then add to its **top-level object** (merge into an existing `env`, do not replace other keys, do not wrap in extra braces):
     ```json
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/ABSOLUTE/PATH/TO/goldfish-qp/plugins/goldfish-qp",
       "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
     }
     ```
     If `CLAUDE_CODE_PLUGIN_DIRS` already lists other folders, append this path with the platform's path separator (`:`).
  3. **Parse the file after editing** (for example `python3 -c "import json,sys; json.load(open(sys.argv[1]))" ~/.claude/settings.json`). An invalid `settings.json` silently disables every setting. If it does not parse, restore the backup and fix it.
- **Remote or cloud session** (the session runs on another machine, such as a cloud coordinator): the user's `~` is not visible there. Install through the marketplace as above, and put `.goldfish-qp.json` and the glossary **in the project's repository** instead of the home folder. Tell the user that definitions added there only survive if committed, and that it is not known whether every remote surface loads plugins and draws clickable terms.

## 2. Create the config

If `~/.goldfish-qp.json` exists, **merge** into it; never overwrite. Otherwise create it with this starting point (a broad pattern for abbreviations and identifiers, and terms that never get a card):

```json
{
  "ignore": ["API", "CI", "CD", "PR", "OK", "TODO", "NOTE", "JSON", "HTML", "CSS", "URL", "HTTP", "HTTPS", "UTF-8", "README", "FAQ", "MIT", "YAML", "SSH"],
  "types": [
    {
      "name": "abbreviations and ids",
      "pattern": "\\b(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z]+[0-9]+|[A-Z]{2,5}|[a-z]+(?:\\.[0-9]+)+)\\b",
      "source": { "path": "~/.goldfish-qp/glossary.json" }
    }
  ]
}
```

Create `~/.goldfish-qp/glossary.json` containing `{}` if it does not exist. Entries look like `"KEY": { "name": "...", "definition": "...", "from": "where this is known from" }`. Put more specific types (tickets, pull requests) **before** the broad one: the first type with a definition answers.

**ASK** the user, once: *"Do you use a ticket tracker with a command line (for example `multica`, `gh`, `jira`) or a GitHub repository whose pull requests you mention? If so, which, and what do ticket numbers look like?"* Skip the rest of this step if the answer is no.

For each one they name:
1. **Run the real command once** on a real id the user gives you (read-only commands only, such as `gh pr view N -R OWNER/REPO --json number,title,state,url,author` or `multica issue get ID --output json`). Read its JSON output and use the **field names it really returns**; never guess them. If it fails (not logged in, no network), tell the user and stop adding that type.
2. Add a type before the broad one, from this pattern:
   ```json
   {
     "name": "pr",
     "pattern": "(?<![\\w/])(?:PR ?#?|#)(\\d+)\\b",
     "link": "https://github.com/OWNER/REPO/pull/{1}",
     "source": {
       "run": ["gh", "pr", "view", "{1}", "-R", "OWNER/REPO", "--json", "number,title,state,url,author"],
       "name": "PR #{number}: {title}",
       "definition": "{state}, by {author.login}"
     }
   }
   ```
   `{0}` is the matched text, `{1}`... its regex groups, `{field.path}` a field of the output. A missing field is shown as an error, never as a blank. A `link` needs a URL pattern you know is right; if unsure, omit it and say so.
3. Do not put secrets, tokens or private repository names anywhere public.

## 3. Add the rule so you keep the glossary current

Add this block to the user's global `CLAUDE.md` (`~/.claude/CLAUDE.md`; create it if missing, append, keep everything else). Adapt the language to the user's.

```markdown
# Goldfish QP (definitions under clickable terms)

If a `.goldfish-qp.json` exists in the project or in `~`, the definitions behind the clickable terms live in the source files it names. The user does not edit them by hand: you keep them up to date.

- When a term, abbreviation or identifier matching a configured `pattern` (and not in `ignore`) gets a settled meaning in the conversation, from the user or from a file or tool result you just read, or when its meaning or status changes, add, replace or remove its entry in the source **without asking**. An entry replaces the old one (never two); other entries are untouched. The user will not give commands: ordinary statements ("X is the invoice run for October", "X is cancelled") are enough.
- Before sending a reply that uses such a term, check with one `grep` which keys are missing from the glossary and add them in one edit, if you know their meaning. Give each entry a `from` (where you know it from).
- Never invent a definition. If you do not know the meaning, leave it without an entry (the card honestly says "no definition") and ask in one sentence when it matters.
- When the user says a term needs no definition, add it to `ignore` in `~/.goldfish-qp.json`.
- One line after a write: `X: added in glossary.json` / `updated` / `removed`.
```

## 4. Check and hand over

1. Parse every JSON file you touched. If the plugin is installed locally, `claude plugin validate <plugin folder>` should pass.
2. Tell the user, briefly, exactly what you created or changed (files and paths) and what you backed up.
3. Tell the user to **fully restart** Claude Desktop (Cmd+Q) if you edited `settings.json`, then start a **new local session** and send: `Reply with exactly this line and nothing else: PROJ-123, AB-1 and SM`. Each term should appear as a clickable chip under the reply; clicking one opens its card (terms without a definition honestly say so).
4. Remind them what Goldfish QP does **not** do yet: chips are a row under the reply rather than inline in the text; nothing is verified on every remote or mobile surface.
