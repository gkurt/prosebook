---
packages:
  'prosebook': minor
---

### A name said in other messages: `{app.title, entry}`

A message says an entry of kind `name` as `{app.title, entry}` (MF2's `{app.title :pb:entry}`), in each locale's words, with `{app.title, entry, genitive}` picking a form a translation of the name selects on. It is filled in as the catalog loads, so it compiles to text and native targets write it as text; a missing key, another kind, a missing form or a cycle fails `generate`, and `prosebook rename` renames the references with the entry.
