---
packages:
  'prosebook': patch
---

### `{match}` shows a match as the message writes it

A data rule's pattern matching across a placeholder (`${HOLE}'s`) names it as written, `"{team}’s"`, not as an invisible character and a straight apostrophe, and its finding points at the placeholder in the text. `asWritten(match, context)`, from `prosebook/config`, does the same for a rule written as code.
