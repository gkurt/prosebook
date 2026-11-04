---
packages:
  'prosebook': minor
---

### A server render links the files of the areas it reads, under Bun too

A split `Bun.build` lists each lazy locale's files in the server's catalog, so `createCopy`'s `preload` is handed them as under Vite: in a full-stack build from the page built beside the server, and in a server's own build from the page's build before it.
