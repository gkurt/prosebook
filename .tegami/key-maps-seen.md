---
packages:
  'prosebook': minor
---

### A read through a `const` map of keys is seen

`t(STATUS[s])` and `<Text id={KINDS[i].label} />` no longer fail a pruned build or need `prosebook-ignore` where `STATUS` and `KINDS` are `const` maps or lists of keys in the same module: every key they can read is written there.
