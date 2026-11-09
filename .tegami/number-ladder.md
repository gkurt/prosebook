---
packages:
  'prosebook': minor
---

### A number format can climb a ladder of units: "512B", "1.5 kB", "1 MB"

A named number format's `ladder` shows a number in the largest of its units it has one whole of: bytes by 1000 or by 1024
(`per`), bits per second, or any series of `Intl` units, each with its own `per` (60 minutes to the hour) and options
(`unitDisplay: 'narrow'` on bytes alone). `steps` read the number in its unit, so "tenths below 10" is one step, and the unit is
checked after rounding: 999,999 bytes is "1 MB", not "1,000 kB". Messages and `copy.number` show it alike; the writing guide shows
it in each of its first units and where rounding carries into the next; `.match` and native targets refuse it, as they do steps.
