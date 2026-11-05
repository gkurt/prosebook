---
packages:
  'prosebook': patch
---

### API.md: reading the catalog in end-to-end tests

A test finds the page's text with `copy.t(key)` over the generated catalog, so a copy edit doesn't break it.
