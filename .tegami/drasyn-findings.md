---
packages:
  'prosebook': minor
---

### A date skeleton's `j` is the hour as each locale writes it

`{when, date, ::yMMMdjmm}` read "Oct 28, 2026, 5"; it now reads "Oct 28, 2026, 2:05 PM", and "14:05" in German. A date field the formatter would drop, such as `J`, fails the build.

### A build fails on a read whose key it can't see

`prune` is `'strict'` by default: `t(item.key)` or `<Text id={id} />` fails the build instead of showing the key where its message was pruned. Mark a deliberate one `prosebook-ignore`, or set `prune: 'loose'`. `prune: true` is gone.

### The Vite plugin takes a `root` for apps that share one catalog

### Generated TypeScript passes `noUnusedParameters`

### Lint rules scoped by area: `on.area`, and `lint.areas` for severities per area

### A `path` rule under `strict`: `Settings › General`, with `lint.pathSeparator`

### The catalog schema offers the `key: message` shorthand only when no field is required
