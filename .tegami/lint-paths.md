---
packages:
  'prosebook': minor
---

### lint and judge take paths

`prosebook lint copy/catalog/billing.yaml` keeps the findings to the entries in those files, catalog, translation or code, and `prosebook judge src/settings` asks the models of those entries alone. A path holding no entry fails with what to name instead, and one holding only docs says to add `--docs`.
