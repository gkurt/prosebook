---
packages:
  'prosebook': minor
---

### A server render links the files of the areas it reads

Under Vite, a split client's lazy locales are listed in the server build's catalog, and `createCopy`'s new `preload` is handed each file the render reads from, once: `preload: (href) => preloadModule(href, { as: 'script' })` under React, so the browser fetches German beside the route's code rather than after it.
