---
packages:
  'prosebook': minor
---

### `prosebook export`: a locale's entries as XLIFF 2.0 or JSON, for translation tools

`export <locale> [file]` writes what `todo` lists, or every entry with `--all`, with each entry's context, kind, surface and placeholders as XLIFF notes. `import` takes the tool's XLIFF or JSON back, checked as a reply is: a translation of a source that has changed since the export is left out, and a stale one given back unchanged is accepted once the tool has moved it on from `initial`.
