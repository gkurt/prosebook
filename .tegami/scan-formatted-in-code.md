---
packages:
  'prosebook': minor
---

### `scan` finds numbers, dates and lists formatted in code

`toLocaleString()`, `toLocaleDateString()`, `new Intl.NumberFormat(…)` and the other `Intl` formatters, and `.join(', ')` in a component, show the browser's locale where the copy shows its own. `prosebook scan` lists each with the copy's method to read instead, and the named format whose options match the ones written out; `scan --strict` fails on them.
