---
packages:
  'prosebook': patch
---

### A select's argument can also be printed

`{tool, select, shell {Shell} other {{tool}}}` no longer fails as "used as two different types", and two selects on one argument take the arms of both.
