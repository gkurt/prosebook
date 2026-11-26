---
packages:
  'prosebook': minor
---

### `prosebook/test` finds the page's text by key, and `scan` finds tests that say the copy's words

`copy.t('cart.checkout')` and `copy.match('cart.items')` read the catalog's YAML as it is now, with no setup or generated
modules. `match` gives a regular expression that matches any text where a placeholder isn't given, and any arm where a plural
or select isn't given. `scan` and `check` warn of test literals that a message says (`test-text`, over `scan.tests` and the
test files under `scan.dirs`), `scan --fix` rewrites them to read the catalog, and `diff` names the tests still saying an
entry's old text.
