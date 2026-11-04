---
packages:
  'prosebook': patch
---

### A select on `true` and `false` takes a boolean

`{on, select, true {On} other {Off}}` types `on` as `boolean`, so a call site passes `true` rather than the text `'true'` or a stand-in such as `'yes'`.
