---
packages:
  'prosebook': minor
---

### `prosebook diff`: the copy a change makes, for review

`prosebook diff origin/main` lists each entry added, removed, renamed or changed since a git revision, its source as a word diff, the translations it changed, those it left stale or missing, and the lint's findings on the words it wrote. `--format markdown` writes it for a pull request's comment; the README has a workflow that posts it and keeps it up to date.
