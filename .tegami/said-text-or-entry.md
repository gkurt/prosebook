---
packages:
  'prosebook': minor
---

### A format's `more`, `separator` and `now` are text or an entry

**Breaking.** A list's `more` and a relative time's `now` no longer take an entry's key as a string: a string is now text, in the
catalog's syntax (`now: 'just now'`, `more: '{count, plural, other {# more}}'`), set per locale under `formats.locales`, and
`{ entry: 'time.now' }` names an entry, translated as any entry is. A config still naming a key fails as the catalog loads, with
the fix. A list's `separator` takes the same two. A tag in what a format says, `separator: '<dot> · </dot>'` or
`now: '<em>just now</em>'`, renders through the renderers a rich read or `<Text>` is given, as the message's own tags do, so a
separator, "and 2 more" or "just now" can be an element; `t` and code read its text.
