---
packages:
  'prosebook': minor
---

### Translations are held to their language's punctuation

`quotes` (German „…“, French « », per CLDR, set per locale with `lint.quotes`), `french-spacing` (no-break spaces before `; ! ? :` and inside guillemets), `inverted-marks` (Spanish ¿ and ¡) and `full-width` (，。？！ after Chinese and Japanese text). All but `inverted-marks` are fixed by `prosebook lint --fix`. A lint plugin's `match` may now be a regular expression, and its rules see the whole `catalog`.
