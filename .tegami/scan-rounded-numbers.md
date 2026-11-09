---
packages:
  'prosebook': minor
---

### Scan finds numbers rounded or given a unit in code

In components, `n.toFixed(1)`, `n.toPrecision(3)` and a value with a unit written after it (`{size} MB`, `` `${ms} ms` ``,
`pct + '%'`) are reported as formatted in code: they ignore the locale and keep English order. Each names the `copy.number` call
with the options it works out (`style: 'unit'`, the fraction digits), or the named format that shows the same. Styles, attributes
no person reads, CSS units and `Number(n.toFixed(2))` are left alone. API.md says what formatting from code costs per call.
