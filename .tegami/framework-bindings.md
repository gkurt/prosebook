---
packages:
  'prosebook': minor
---

### Bindings for Preact, Vue, Svelte and Solid

`prosebook/preact`, `prosebook/vue`, `prosebook/svelte` and `prosebook/solid` each give the copy to components the framework's way, update what reads a message when the locale changes, and render rich messages as the framework's own elements: Vue's `<Text>` takes tags as slots, and Svelte's as snippets.

### Strict pruning reads `.vue` and `.svelte` files

A build fails on a read whose key it can't see in a Vue template or Svelte markup as it does in a script, and `scan` finds keys there; `.vue` and `.svelte` join `scan.extensions`' defaults.

### `useCopy()` in React reads the registered catalog's keys

`useCopy().t` and the other plain reads are typed by `Register` as `rich` already was, so a misspelled key there is a type error.
