---
packages:
  'prosebook': minor
---

### The inspector runs on a page with no dev server

`prosebook/inspector` exports `install`, which takes a `fetch` of its own, and `prosebook/playground`'s `endpoints` answers it in the browser over a catalog's files held in memory, keeping each edit.
