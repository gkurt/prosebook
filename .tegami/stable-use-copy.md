---
packages:
  'prosebook': patch
---

### `useCopy()` keeps its identity while the provider renders again

In React and Preact, a `CopyProvider` without `tags` no longer makes every `useCopy()` reader new on each render, so `t` is safe as an effect's dependency until the locale changes.
