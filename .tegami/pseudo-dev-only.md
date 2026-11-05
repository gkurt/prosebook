---
packages:
  'prosebook': minor
---

### The pseudo-locale stays out of production

A build through `prosebook/vite`, `prosebook/next` or `prosebook/bun` (and Bun's server run with `NODE_ENV=production`) leaves the `pseudo` locale out of `catalog.locales` and ships none of its messages, so a locale switcher built from `copy.locales` no longer offers `en-XA` to users. Dev keeps it, and `generate` still writes its module.
