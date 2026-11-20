---
packages:
  'prosebook': patch
---

### A relative time keeps updating when its timer fires a moment early

A timer firing while `Date.now()` still read short of the moment, or after the system clock was set back, left every relative time on the page as it was until the next one began waiting.
