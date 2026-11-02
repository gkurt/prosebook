---
packages:
  'prosebook': minor
---

### `prosebook todo <locale> --prompt` and `prosebook import`: translate with any model, checked

`todo --prompt` prints a locale's missing and stale entries as a prompt: how to reply, the plural forms the locale takes, and what each kind and surface asks for. `import` reads the reply, or `todo`'s YAML filled in by hand, and writes each entry to its file once it passes the catalog's checks, leaving out the ones that fail with their fix.

### `prosebook todo` shows each entry's kind and surface
