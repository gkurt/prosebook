---
packages:
  'prosebook': patch
---

### A key written twice costs only its second entry, and an unquoted `: ` says to quote the value

A catalog or translation file with a key written twice, as a merge leaves it, lost every entry in it. Now the error names
the key and both lines, and the second entry is left out. A value holding `: ` unquoted, `en: Note: the name shows.`, says to
quote the value rather than giving the YAML parser's error. And an ellipsis no longer ends a sentence: `Importing… 3 files
left.` is one sentence to `sentence-budget`.
