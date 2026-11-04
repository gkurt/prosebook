---
packages:
  'prosebook': patch
---

### `extract` says nothing of markup with no words beside it

`{icon} {children}` is no sentence, so it no longer warns that `{children}` holds markup.
