---
packages:
  'prosebook': patch
---

### `extract` keeps the spaces around a sentence

A `{' '}` before a line break stays in the code, and a literal's own leading or trailing space goes beside the `<Text>`, so `from{' '}<Branch />` no longer renders "frommain".
