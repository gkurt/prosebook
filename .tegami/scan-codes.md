---
packages:
  'prosebook': minor
---

### `scan` passes constants, camel case and the options a call is given by, and `lint --fix --unsafe` removes exemptions no longer needed

`ORPCError('UNAUTHORIZED')` and `NotYourMessageError('sendNow')` are codes, as `'not-found'` was. A name in `scan.calls` or
`scan.skipCalls` matches a call's whole name, `PlatformError.systemError`, as well as its first part. In an options object a call
is given, only a property `scan.properties` or `scan.scriptProperties` names is read as text; any other is read only where it is
more than a word, so `{ _tag: 'Unknown', module: 'ChildProcess' }` passes.

An exemption an entry no longer needs is removed by `lint --fix --unsafe`, and its `allow` with it once empty; `lint` says how
many there are.
