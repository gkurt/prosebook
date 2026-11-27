---
packages:
  'prosebook': minor
---

### The copy inspector is a deictic plugin: install deictic and every integration adds it, merged into an app's own deictic

`prosebook/deictic` is the plugin, and its edits land in deictic's history, so undo takes them back. `prosebook/inspector` is gone, `inspect` takes `{ shortcut }` as a deictic shortcut, `prosebook/bun`'s `inspector()` is async and answers deictic's routes, the playground's `endpoints` is `standalone`, deictic's `Standalone`, and `editEntry` hands back each file's new text instead of writing it.
