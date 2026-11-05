---
packages:
  'prosebook': minor
---

### Lists and durations in messages, and named formats for both

`{names, list}` joins a list of strings as the locale joins one ("Ann, Bob, and Cy", "Ann, Bob und Cy"), and `{took, duration}` writes milliseconds in the units the locale writes ("3 min, 5 sec", "3m 5s", "0:03:05"); in MF2, `:list` and `:duration`. Both take named formats: `formats.list` with `max` and `more`, which shows the first items and says the rest with a catalog entry given `{count}` ("grep, sed, and 2 more"), and `formats.duration` with `largest`, `smallest` and `units`. `copy.list` takes a list format's name, and `copy.duration` formats milliseconds in code the same way.
