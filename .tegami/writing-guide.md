---
packages:
  'prosebook': minor
---

### `generate` writes the writing guide, for an agent to read before it writes

`copy/catalog/WRITING.md` says the config as instructions: each kind with its budget, the surfaces, the banned words with their reasons, plurals and prices in your message format, and your plugins' rules, only those turned on. `generate --check` fails once it is stale; set `guide` to move it, or `false` for none.
