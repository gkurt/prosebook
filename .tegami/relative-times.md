---
packages:
  'prosebook': minor
---

### Relative times: `{at, relative}` says "5 minutes ago" from the time itself

A message takes a `Date`, milliseconds or ISO string as `{at, relative}` (MF2 `{$at :relative}`), and code says the same with
`copy.relative(at, format)`, which replaces `copy.relative(value, unit)`. Named formats under `formats.relative` set the units,
rounding, `Intl` options, an entry for "just now" and a switch to a named date format; formatters can define one in code. The
copy's `now` option is its clock, a server's render time held until hydration; `<Text>` in every binding re-renders itself when
its time next reads differently, and `live: true` refreshes other reads by bumping `version`. The writing guide, scan, types,
pseudo-locale and native targets know it. The generated index imports it only where something says a relative time; the
runtime's budget is now 4.5 KB.
