---
packages:
  'prosebook': minor
---

### A GitHub action checks the copy on a pull request

`uses: gkurt/prosebook@main` runs `prosebook check`, uploads its findings to code scanning, and comments the copy the pull request changes, updating that comment on each push.
