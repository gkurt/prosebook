---
packages:
  'prosebook': minor
---

### `min`: a plural's count that is never 1 needs no `one` form

`min: { sites: 2 }` on an entry makes `plural-forms` ask only for the forms counts from 2 take: English and German need no `one` arm, while Russian still needs `one` (21 sites) and Polish `few`. `todo` and `export` tell translators the count is always 2 or more.

### `plural-one` accepts `one {# failed} other {# failed}`

It warns of a `one` arm saying what `other` says only where `other` counts a plural noun (`# files`), naming the singular to write. A count followed by a word with no singular, such as `# failed` or `# unread`, passes, as `plural-forms` asks for its `one` arm all the same.
