---
packages:
  'prosebook': minor
---

### A list format can join with a separator: "Ann · Draft · 2 new commits"

A list format's `separator` joins the items with it alone, in place of `Intl.ListFormat`'s commas and "and": `formats.list.facts:
{ separator: ' · ' }`, set per locale under `formats.locales`, read by `{facts, list, facts}`, `{$facts :list format=facts}` and
`copy.list(items, 'facts')`, or given in code as options. Every list now leaves out empty items, `null`, `undefined` and `false`,
so `[author, draft && 'Draft']` needs no filtering; list arguments are typed to take them. The writing guide shows the format,
and scan reports `.join(…)` in a component with any separator a person reads (`' · '`, `' / '`), naming the list format with that
separator, not only `', '`.
