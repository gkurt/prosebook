---
packages:
  'prosebook': patch
---

### Dev servers follow edits to `prosebook.config.*`

An edit to the config file restarts Vite's and Astro's dev server. Next, Bun and `generate --watch` regenerate with the new config, and the inspector checks edits with it. Before, the next catalog edit regenerated with the config the server started with, which dropped new lint rules from the schema and new formats from the generated modules.
