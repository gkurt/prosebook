---
packages:
  'prosebook': patch
---

### `extract` reads a number made text in code as the number

`{c.toLocaleString()} nodes` becomes a plural of `c`, and `frameMs.toFixed(2)` becomes `{frameMs, number, ::.00}`, rather than a string placeholder; and a message that starts with a plural is keyed by its words, not `other`.
