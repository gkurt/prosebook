---
packages:
  'prosebook': minor
---

### `prosebook/astro`: the catalog in an Astro site

`integrations: [prosebook()]` generates, prunes each build to the messages its pages and scripts read, and puts the inspector on every page in dev, a page with no script included. A page reads with `t` and `rich` in its frontmatter and markup (`rich('home.terms', { link: (chunks) => <a href="/terms">{chunks}</a> })`), and an edit reloads it with the new text. A strict build fails on an unseen read in an `.astro` file, and `scan`, `rename` and pruning read `.astro` files.

### The inspector traces text the server rendered

Under Vite and Astro, Alt-pointing at text a server render read, and not the browser, finds its entry, so the dialog edits and comments on it as on any other.
