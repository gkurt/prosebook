---
packages:
  'prosebook': minor
---

### A split build loads a lazy locale's areas in one file per chunk

Areas the bundler puts in one chunk share a file in each lazy locale, so a route reading three areas loads German in one request, not three. Which areas share a chunk is read from the imports under `scan.dirs`, under Vite, Bun and Next alike.
