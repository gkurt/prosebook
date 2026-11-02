---
packages:
  'prosebook': minor
---

### MF2 selects on a number as it's shown

Under `.input {$n :number minimumFractionDigits=1}`, 1 shows as "1.0" and matches `other` in English, as MF2 has it; it matched `one`. `:integer` matches the value rounded. A selector's function is written back as it was, `select=exact` included.

### `.match` selects with `:percent`, on the value times 100

### MF2 placeholders are isolated in right-to-left locales

Each is wrapped in Unicode isolation marks, so a Latin name in a Hebrew sentence can't reorder the text around it. `u:dir` picks a placeholder's direction, and `isolate` in the config sets when: `'rtl'` (the default), `'always'`, or `false`.

### A message never throws

A placeholder with no value, or one `Intl` refuses, shows as `{name}` (`{$name}` in MF2) and goes to `console.error`, or to `createCopy`'s new `onError`; it rendered nothing, or threw.
