---
packages:
  'prosebook': minor
---

### `prosebook judge` holds each entry to the guidelines through decision models, `decisionJudge` from `prosebook/ai`, and keeps the verdicts in the lock for `lint`

`judge.prompt` tells the models about the app, and `prosebook approve` passes an entry as written until it changes.
