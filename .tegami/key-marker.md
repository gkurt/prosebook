---
packages:
  'prosebook': minor
---

### `key()` marks a key that code names ahead of the read, and a read under `copy.has` is seen

`key('api-errors.not-found')` returns the key as given, typed as that key, and `Key<'api-errors'>` is any key of that area: one
helper for error classes and API contracts instead of each project's own. A read of a `const` holding a marked key is seen by the
build's check for reads it can't see, and so is a read under a `has` check of the same key, `if (copy.has(error.key))
copy.t(error.key)`, as `has` is false where the build dropped the message. Neither needs `prosebook-ignore` any more.

`scan` finds the text given to a class `scan.calls` names, `new AppError('…')`, and to `super('…')` in a class extending it, and a
`message` property's text in any script, not only in components.
