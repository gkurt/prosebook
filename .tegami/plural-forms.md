---
packages:
  'prosebook': minor
---

### `plural-forms`: a plural writes every form its locale counts in

A Polish translation with only `one` and `other` now fails the lint, naming `few` and `many`, where it used to fall back to `other` and say "5 pliki". So does a German one with no `one` arm, and an English `zero` arm, which English never picks: write `=0`. MessageFormat 2 messages are read by the variant keys written, not the arms `*` fills in.
