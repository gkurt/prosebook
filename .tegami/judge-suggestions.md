---
packages:
  'prosebook': minor
---

### A judge can suggest a rewrite

`languageJudge` from `prosebook/ai` judges through a language model such as Claude Haiku, answering the same questions a decision model does, and rewrites an entry it finds breaking a guideline. `lint` shows the rewrite under the guideline, and `lint --fix --unsafe` writes it. A `Judge` of your own suggests by giving `suggestion` beside `probabilities`; one that drops or changes a placeholder is left out.
