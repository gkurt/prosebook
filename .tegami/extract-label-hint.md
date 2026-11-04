---
packages:
  'prosebook': patch
---

### `extract` keeps a label and its hint apart

A label's text followed on the next line by `<span>A sentence…</span>`, which JSX renders with no space between, becomes two entries rather than one message with a tag.
