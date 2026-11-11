---
packages:
  'prosebook': minor
---

### `npx prosebook lint` runs in a codebase with nothing set up

With no config file and no catalog, `lint` and `scan` read the text in the code under the strict rules, from `src` or the project's root, and say so.
