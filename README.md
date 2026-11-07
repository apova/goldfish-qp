# Goldfish QP

**Quick Peek for forgetful humans.** Click an object, abbreviation, task or identifier in Claude's reply and see its definition from **your own files**, without asking the model and without spending a token.

- You configure what to recognize (regular expressions) and where definitions live (local JSON and Markdown files; the resolver interface is ready for more).
- Definitions are source-grounded: the card shows the text a source holds, its source, and whether it is **current**, **stale**, **missing** or **ambiguous**. Nothing is invented.
- The latest copy is cached and replaced when its source changes; if a source disappears, the last known definition stays, clearly marked stale.
- Built for Claude Desktop's Code tab; also works in the Claude Code terminal, where Quick Peek's original file-path previews are kept.

## Get started

Tell your AI agent:

> Set up Goldfish QP for me, following https://raw.githubusercontent.com/apova/goldfish-qp/main/get-started.md

It installs the plugin, creates your config, asks about your ticket tracker and GitHub repo, and adds the rule that keeps your glossary current. The steps are in [get-started.md](get-started.md); you can follow them by hand too.

Everything else is in [`plugins/goldfish-qp`](plugins/goldfish-qp/README.md): configuration, install, and the manual verification steps for Claude Desktop.

```text
/plugin marketplace add apova/goldfish-qp
/plugin install goldfish-qp@goldfish-qp
```

```bash
npm run validate
npm test
```

## Attribution

Goldfish QP is a fork of [`midudev/better-claude`](https://github.com/midudev/better-claude), keeping only its Quick Peek mod, © 2026 Miguel Ángel Durán (midudev), MIT. See [LICENSE](LICENSE).
