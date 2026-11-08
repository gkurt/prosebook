---
packages:
  'prosebook': patch
---

### The inspector is one gesture: Alt-click a string to edit it, in a leaner dialog

The dialog opens below the string, on its text in the locale read and the source beside a translation, with lint's findings and fixes; the rest of the entry sits under More, which stays open once opened; a click outside closes it, as Esc does. Open in editor, in the dialog, takes the place of Alt-click and Alt-Shift-click, and opens the file of the field last in focus. The YAML tab is gone, and with it `EntryYaml`: `editEntry(config, key, fields, write)` takes the fields alone, and `EntryView` no longer has `files` or `yaml`.
