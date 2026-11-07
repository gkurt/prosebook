---
packages:
  'prosebook': patch
---

### Linting text in code reads two-string picks in their sentence, names placeholders for their values, and suggests fewer proper nouns

A ternary between two strings stays in its JSX sentence: `{n === 1 ? 'hop' : 'hops'}` reads as a plural on `n`, any other test as a select, so each arm is linted in place. A placeholder is named for the value it shows past formatting calls: `${rate.toFixed(1)}` is `{rate}`, not `{value}`. `path` passes a lone separator with no capital after it (`origin → {hops}`). The `lint.properNouns` suggestion leaves out words the text also writes in lowercase, which are Title Case labels rather than names. Helpers of tests and stories (`A.spec.helper.tsx`) are left out of the scan.
