---
packages:
  'prosebook': minor
---

### `scan` reads what JSX expressions render, notices and label maps

Both arms of a ternary, a `??` or `||` fallback and a template's words are found in JSX text and readable attributes, as are the text given to `scan.calls` (`toast`, `alert`, `confirm`) and, in components, the values of `scan.properties` (`label`, `title`, `description`, `placeholder`, `header`). `scan()` and `hardcodedText()` in `prosebook/tools` take the scan options as one object.
