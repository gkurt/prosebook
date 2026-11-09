---
packages:
  'prosebook': patch
---

### The writing guide stays as written when Bun and Node format its samples differently

A guide whose format samples another runtime wrote is kept while the formats it shows are unchanged, so a build under Bun no longer rewrites the guide Node generated, and `generate --check` passes on it.
