---
name: define
description: Add, update or remove a definition in the user's Goldfish QP source files (the JSON or Markdown files named in .goldfish-qp.json), so the object's chip shows it. Use when a term, abbreviation or identifier that matches a Goldfish QP pattern gets an established or changed meaning in the conversation, when you are about to use one in a reply and its entry is missing, or when the user asks to define, update or remove one.
---

# Write a definition into a Goldfish QP source

Goldfish QP shows definitions from the user's own files. You are the one who keeps those files up to date, so the user never edits them by hand. Reading a definition in the app costs no tokens; writing one here is an ordinary edit.

## 1. Find the config and the source

1. Read `.goldfish-qp.json` in the project root; if there is none, in the home folder. If neither exists, say so in one line and stop: do not create a config unasked.
2. Find the `types` entry whose `pattern` (a regular expression) matches the whole term. If none matches, the term is not tracked: say so and stop.
3. Take that type's source (`source` or `sources`). Resolve its `path` as the config does: absolute, `~/...`, or relative to the folder holding the config. If the type has several sources and it is not obvious which one holds this kind of term, ask one short question.

## 2. Only write what is grounded

A definition must come from what the user said, or from a file or tool result you read in this conversation. Never invent or guess one. If you do not know the meaning, ask in one sentence instead of writing. Keep it short: one to three sentences, the user's own words where possible.

The terms used in your own replies count too: before sending a reply that uses an abbreviation or identifier the config recognizes (and does not `ignore`), find with one `grep` which keys are missing and add them in one edit. Skip any whose meaning you do not know.

## 3. Write it, touching nothing else

**JSON source, a map** (`{ "KEY": ... }`): set `KEY` to `{ "name": "<short name>", "definition": "<text>", "from": "<where you know it from>" }` (`from`: a ticket, a file, "this conversation, 2026-11-07"; always give it), or to a plain string if the file already uses plain strings. Keep the file's other entries, order and indentation. If `KEY` exists, **replace** its value: never keep two. Removing is deleting the key.

**JSON source, an array** of `{ "key", "name", "definition" }`: update the one entry with that key. If the key appears more than once the user has an ambiguity: do not pick one, report it and ask.

**Markdown source** (entries are headings of the source's `level`, default 2): the entry is `## KEY — Name` (or `## KEY`) followed by its text up to the next heading of that level or above. Create it at the end of the file if missing; otherwise replace only that section's text. Leave every other section, and anything above the first entry, untouched.

After writing, check the file still parses (for JSON, read it back). If the source file does not exist, create it only when the config points at it, with just this entry.

## 4. Report in one line

Say what happened, in the user's language: `TASK-5: created in tasks.json`, `TASK-1: updated in tasks.json (was: ...)`, `TASK-2: removed from tasks.json`. The chip shows the change the next time its card is opened; nothing needs restarting.

Never call a model, API or any tool for the lookup itself: this skill only edits local files.
