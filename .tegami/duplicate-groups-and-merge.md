---
packages:
  'prosebook': minor
---

### `duplicate` says each group once, and `lint --fix --unsafe` merges it

A group of entries saying the same words in the same role is one line at the entry to keep, naming the others. `prosebook lint --fix --unsafe` merges each group into that entry (in `extract.shared` where it spans areas), moving a translation only another entry has and rewriting the code that reads the others; a group whose translations differ is left and named.

### `named-format` names every format a placeholder shows as, in one finding

Two named formats that show alike in a locale gave one finding each on every placeholder they match; now one finding names both.
