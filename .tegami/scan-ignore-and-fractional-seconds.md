---
packages:
  'prosebook': patch
---

### `scan.ignore` keeps a scan check out of folders

`{ 'formatted-in-code': ['src/server', '**/*.server.ts'], '*': ['src/admin'] }` leaves code no person reads unreported, by path or glob, one check or all of them. `Intl.DateTimeFormat().resolvedOptions()` is no longer reported as formatting.

### Durations show fractional seconds

A duration format's `fractionalDigits` writes "4.2s" where milliseconds wrote "4s 200ms".
