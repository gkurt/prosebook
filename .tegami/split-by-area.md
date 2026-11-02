---
packages:
  'prosebook': minor
---

### Splitting by area: a lazy route brings its own messages

With `prosebook({ split: true })`, the Vite plugin ships each area's messages beside the code that reads them, and a lazy locale loads area by area, so a lazy route loads only its own messages and renders in the reader's language from its first frame. A key read before its area loaded is reported through `onError`.
