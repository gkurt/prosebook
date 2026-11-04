---
packages:
  'prosebook': minor
---

### A select's `null` arm says what an absent value shows

`{role, select, null {} other {, as {role}}}` picks `null` for a value that is `null` or `undefined`, and types `role` as optional, so an optional part of a message needs no stand-in value.
