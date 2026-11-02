---
packages:
  'prosebook': minor
---

### Android string resources from the same catalog

`native: [{ language: 'android', out: 'android/app/src/main/res', keys: ['android'] }]` makes `generate` write `values/strings.xml` and a `values-<qualifier>/strings.xml` per locale (`values-pt-rBR`, `values-b+sr+Latn`), so the manifest, shortcuts and other XML resources can name `@string/…`. Placeholders are positional (`%1$s`), a plural becomes `<plurals>`, and what Android can't hold (a select, a date, a formatted number, an exact arm such as `=0`, a tag) fails the build with the fix.
