---
packages:
  'prosebook': minor
---

### Every catalog file starts with its schema line

`generate` adds `# yaml-language-server: $schema=./catalog.schema.json` to a catalog file that doesn't start with it, since an editor finds the schema only through that line, and `generate --check` and `check` fail on such a file, saying why. A file that names a schema of its own on its first line keeps it.
