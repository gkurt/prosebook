---
packages:
  'prosebook': patch
---

### Fewer false positives when scanning and linting text in code

`scan` reads JSX text with values in it (`restart from {clientName}.`) as one sentence, decodes entities such as `&nbsp;`, skips class strings, and skips JSX in tests and stories. `<Tooltip label>` gets the tooltip role. `path` now ignores a trailing arrow and a single slash. `no-em-dash` names the dash it found and asks for an en dash in ranges. The lint summary counts findings per rule, notes that warnings alone exit 0, and suggests `lint.properNouns`.
