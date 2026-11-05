---
packages:
  'prosebook': minor
---

### `prosebook rename`: a key, or a whole area, renamed everywhere it is written

`prosebook rename cart.checkout pay.button --write` renames the key and the keys under it in the catalog (moving each entry to its new area's file), in every translation, in the lock, so stale translations stay stale, and in every string literal in the code that names it. A read through a prefix moves with a renamed area; one that may reach a renamed key otherwise is named for renaming by hand. A dry run without `--write`.
