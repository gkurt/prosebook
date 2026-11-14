---
packages:
  'prosebook': minor
---

### A judge's `id` keeps its verdicts when the provider changes

`decisionJudge` and `languageJudge` take an `id`, the name the lock keeps the model's answers under. Without one the name is the provider's and the model's, so the same model through another provider was asked of the whole catalog again. Give the name the lock already has, `languageJudge(model, { id: 'anthropic.messages/claude-haiku-5-5' })`, to keep those answers.
