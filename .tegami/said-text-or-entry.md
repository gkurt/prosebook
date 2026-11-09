---
packages:
  'prosebook': minor
---

### A format's `more`, `separator` and `now` are text or an entry

**Breaking.** A list's `more` and a relative time's `now` no longer take an entry's key as a string: a string is now text, in the
catalog's syntax (`now: 'just now'`, `more: '{count, plural, other {# more}}'`), set per locale under `formats.locales`, and
`{ entry: 'time.now' }` names an entry, translated as any entry is. A config still naming a key fails as the catalog loads, with
the fix. A list's `separator` takes the same two. A tag in what a list says, `separator: '<dot> · </dot>'`, renders through the
renderers a rich read or `<Text>` is given, as the message's own tags do, so a separator or "and 2 more" can be an element; `t`
reads its text.
