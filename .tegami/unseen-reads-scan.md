---
packages:
  'prosebook': minor
---

### `scan` and `check` report reads a pruned build can't see

`t(id)` and `<Text id={id} />` are reported where they are, as the bundler plugins would fail the build on them: a warning from `scan` and `check`, an error under `scan --strict`, and `unseen-read` in a SARIF log.
