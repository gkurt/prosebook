---
packages:
  'prosebook': patch
---

### The same words in two roles keep a verdict each

Text in code or the docs saying the same words in two roles, a heading and a table cell, was asked again on every `prosebook judge`, each role's verdict replacing the other's in the lock, so `judge --check` never passed. The lock now keeps an answer per role.
