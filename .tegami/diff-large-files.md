---
packages:
  'prosebook': patch
---

### `prosebook diff` reads a base whose catalog, translations or lock pass 1 MiB

It failed with `spawnSync git ENOBUFS` there, as a lock holding many judges' verdicts does.
