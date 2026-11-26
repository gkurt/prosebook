---
packages:
  'prosebook': minor
---

### `scan` names error subclasses alone, passes codes and calls for a model by, and reads chosen properties in any script

`scan.calls` and `scan.skipCalls` take regular expressions beside names: `/.Error$/` names `TeamError` and every other class
ending in `Error`, not `Error` itself. Text a call or a property is given that opens with a name in brackets, `[React] useDrawer
must be used inside a Drawer.`, is a developer's and isn't read; `scan.developerText` sets how such text starts, or `false`. A lowercase string with no space given to a call or a property is a code or a category, not text:
`new TeamError('not-found')` and `{ message: 'messages' }` are passed by. `scan.skipCalls` names calls whose arguments no person
reads, as a prompt for a model, and nothing in them is reported. `scan.scriptProperties` names the properties read in any
script, not only in components: `message`, as before, unless set, and `problem` added by `['message', 'problem']`.
`scan.properties` no longer holds `message`.

A dot after no word, as in `Type . or .. for a folder.`, no longer ends a sentence for `sentence-budget`.
