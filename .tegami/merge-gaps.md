---
packages:
  'prosebook': patch
---

### `lint --fix --unsafe` and `rename` rewrite keys in all of the project's source, and a merge names and writes its entry better

Keys are rewritten in every source file under the config's folder, `e2e/` included, not under `scan.dirs` alone. A group merged into `extract.shared` keeps the entry already there, or takes a key from its words (`common.saving`, then `common.saving-state` where that is taken) and is no longer left apart over a taken name. The kept entry's context is every context the group had, and it stands a blank line apart where the file's entries do. A key prefix something other than `t` or `rich` is called with, as a test's name is, is no longer warned of.

### `scan.dirs` reads a file it names

`scan: { dirs: ['src', 'desktop/app.config.ts'] }` reads the file, which was passed by silently.
