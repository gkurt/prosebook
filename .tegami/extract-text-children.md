---
packages:
  'prosebook': patch
---

### `extract` writes what type-checks

Inside a component whose `children` are typed `string`, text becomes `{t('…')}` rather than a `<Text>` it can't take, and a value that may be `null` is given `?? ''`, which renders as React rendered the null.
