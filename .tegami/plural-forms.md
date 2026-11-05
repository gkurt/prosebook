---
packages:
  'prosebook': minor
---

### `plural-forms`: a plural writes every form its locale counts in

A Polish translation with only `one` and `other` now fails the lint, naming `few` and `many`, where it used to fall back to `other` and say "5 pliki". So does a German one with no `one` arm. `plural-unused-form` warns of an arm whose form the locale never picks, such as English `zero` (write `=0`) or `few` (write the count, `=4`). MessageFormat 2 messages are read by the variant keys written, not the arms `*` fills in.
