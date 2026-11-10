---
packages:
  'prosebook': minor
---

### Judges are trusted in order, and can be declared without being asked

With several judges, the first in `models` that answered an entry decides it, where their probabilities were averaged: list the model you trust most first. `ask: false` on a judge, as `decisionJudge` and `languageJudge` take it, keeps a model no run can ask here, as without its key: `judge` and `--check` pass it by, its answers in the lock still count, and the next model decides where it hasn't answered.
