---
packages:
  'prosebook': minor
---

### `extract`'s contexts are drafts, listed until finished

A new entry's context says it is a draft and where extract found the string, and `generate` and `check` warn of every context and argument doc still starting with `TODO`. Placeholders are named for what they hold: `files.length` is `filesCount`, `PREVIEW_EVENTS` is `previewEvents`, `formatBytes(size)` is `size`.
