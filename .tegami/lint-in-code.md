---
packages:
  'prosebook': minor
---

### `catalog: false` lints the text in the code, with no catalog, and `prosebook approve` passes an entry against any rule

`prosebook lint`, `judge`, `approve` and `check` read the text `scan` finds, each string an entry of its own, its kind
and surface guessed from where it stands (a `<button>` is an action, an `<h1>` a name on a heading); a
`prosebook-allow <rule>: <why>` comment exempts its line, and an approval holds wherever the words move until they
change. `scan --lint` holds a catalog project's hardcoded text to the rules too.
