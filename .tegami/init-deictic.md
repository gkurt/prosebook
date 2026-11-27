---
packages:
  'prosebook': minor
---

### prosebook init installs deictic for the copy inspector, and adds prosebook to the bundler's config

Where the project can't import deictic, `init` installs it with the project's package manager (`--no-install` only says the command), and adds prosebook's integration to the Vite, Astro, webpack or Rspack config, or wraps Next's or Metro's, printing the snippet where it can't tell where. The server's record of reads now stops once the last dev server using it closes.
