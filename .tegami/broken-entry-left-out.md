---
packages:
  'prosebook': minor
---

### A broken entry no longer stops every command

`generate`, `lint`, `scan`, `status` and the dev servers report a broken entry or translation with its fix, leave it out, and carry on with the rest of the catalog; each command still fails while it is broken. An edit, a lint fix or an import is refused only for problems it brings itself.
