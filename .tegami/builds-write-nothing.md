---
packages:
  'prosebook': minor
---

### A build writes nothing

Vite, Astro, Next, webpack, Rspack and Bun builds bundle the catalog as it reads, leave `src/copy/`, the writing guide, the schema and the lock as they are, and fail with the fix where a generated module is missing: commit `src/copy/`, or run `prosebook generate` before the build. Dev servers still generate on start and on every edit.
