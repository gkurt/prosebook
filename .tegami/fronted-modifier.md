---
packages:
  'prosebook': minor
---

### `voice/dangling-modifier` is `voice/fronted-modifier`, and finds a modifier opening a sentence whatever the modifier describes

`Opened from the Finder, the app…` is found as `Enabled, a session…` is: the finding asks for the subject or a whole clause first. A modifier no longer passes for a pronoun after the comma (`Unset, it is…`). An adjective on a noun (`Named values, with…`), a verb with the verb's object (`Added {name},`) and a series (`Generated, formatting, imports and whitespace hunks`) pass. Rename `voice/dangling-modifier` in `lint.rules` and `allow`.
