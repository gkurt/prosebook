---
packages:
  'prosebook': minor
---

### Guidelines, and a writing guide for an agent to read before it writes

A lint rule of `type: 'guideline'` is advice no pattern can check. `generate` writes `copy/catalog/WRITING.md` with what each kind and surface is for, the guidelines, and any checked rule marked `guide: true`, and `generate --check` fails once it is stale. Set `guide` to move it, or `false` for none. A guideline whose `on.locale` reads a translation's locale is said in that locale's `todo --prompt` too.
