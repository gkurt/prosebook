---
packages:
  'prosebook': patch
---

### Generated files tell linters and formatters to leave them alone

The modules `generate` writes open with `/* eslint-disable */` (ESLint, oxlint, `bun lint`), Biome's, Deno's and dprint's
whole-file ignores and `@generated`, and put `// prettier-ignore` before each statement for oxfmt, Prettier and `bun fmt`,
which have no whole-file ignore for JavaScript. `WRITING.md` sits in a `prettier-ignore` range under `markdownlint-disable`;
the Rust target carries `rustfmt_skip`, Swift `swiftlint:disable all` and `swift-format-ignore-file`, Kotlin ktlint's
`Suppress`. Ignoring `src/copy/` in your tools' config is still the surest way; `catalog.schema.json`, being JSON, needs it.
