---
packages:
  'prosebook': minor
---

### `copy.compare` sorts text in the copy's locale

`copy.compare(a, b, options)` compares as the copy's current locale sorts, with `Intl.Collator`'s options (`numeric` puts "file9"
before "file10", `sensitivity: 'base'`), and `copy.collator(options)` is the collator itself, made once per locale and options.
Every binding's reader has both. Scan reports `localeCompare` and `new Intl.Collator()` given no locale in components, except
on ids and ISO times (`a.id`, `b.createdAt`), which sort as raw strings. A format named by the same options object each call,
as a named format is, now finds its formatter without serializing the options.
