---
packages:
  'prosebook': minor
---

### A judge can be declared without being asked

`ask: false` on a judge, as `decisionJudge` and `languageJudge` take it, keeps a model no run can ask here, as without its key: `judge` and `--check` pass it by, and its answers in the lock still count. A guideline is broken by the mean of the models that answered, so a model added later leaves the others' verdicts standing until it has.
