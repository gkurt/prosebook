---
packages:
  'prosebook': minor
---

### The lint reads your docs with --docs

`prosebook lint --docs README.md docs` holds the prose of Markdown files to the same rules and guidelines as the copy, and so do `judge --docs` and `approve --docs`: each heading, paragraph, list item, table cell and quote, with code blocks passed by and code spans read as placeholders. With no paths, `--docs` reads the files the config's `docs` names.
