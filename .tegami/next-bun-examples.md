---
packages:
  'prosebook': minor
---

### `prosebook/next`: Next.js with Turbopack

`withProsebook(nextConfig)` generates in `next dev` and `next build`, regenerates on every catalog edit and swaps the messages in place in the browser, and prunes the build to the messages the code names, failing on a read whose key it can't see.

### `prosebook/bun`: `Bun.build` and Bun's dev server

`prosebook()` in `Bun.build`'s `plugins` prunes the build the same way; `"prosebook/bun"` in bunfig.toml's `[serve.static] plugins` regenerates on catalog edits and swaps the messages in place.

### The Vite plugin's dev hooks and inspector come in through the generated index, so frameworks that render their own HTML, such as TanStack Start, get them too
