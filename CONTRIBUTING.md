# Contributing

prosebook is one ESM package built with [Bun](https://bun.sh). [AGENTS.md](AGENTS.md) describes how the code is laid out and the
conventions it follows; read it before a change of any size.

## Setup

```bash
bun install
bun run build   # dist/, which the examples import
bun install     # again, so the examples link the prosebook bin from dist/cli.js
```

## Working

```bash
bun run test        # all tests, against the source
bun typecheck       # TypeScript 7 over src and test
bun run cli <cmd>   # the CLI from source: bun run cli generate --root examples/vite
bun run docs        # the README, API.md, CONTRIBUTING.md and AGENTS.md held to the writing rules
bun run docs:judge  # and to the guidelines, by a model; needs TYPESAFE_AI_API_KEY (ANTHROPIC_API_KEY adds Haiku, which suggests rewrites), then commit prosebook.lock.json
bun run judge       # the site's and the Vite example's catalogs the same way; then commit their copy/lock.json
bun run example     # build, then the Vite example's dev server
bun run dev         # build, then the homepage's dev server, with the inspector
bun run site        # the homepage (site/, Astro) built into _site/
```

Before committing, run `bun run fix` (lint and format, with fixes) and `bun run checks` (check, typecheck, docs and test). A pre-commit
hook runs the linter and formatter on staged files, and `bun run docs` on the docs staged. Fix what they report rather than disabling a rule.

## Examples

`examples/` holds one app per integration and per binding, each importing prosebook from `dist` as a user's app would. After
changing the compiler or the generator, regenerate them and commit their `src/copy/`; CI fails on stale output:

```bash
bun run examples:generate
bun run --cwd examples/next dev    # run one
bun run examples:smoke vite        # serve an example's production build and check it (after its build)
bun run size                       # what the runtime and each binding weigh, gzipped, against budgets (after build)
```

## Documentation

- [README.md](README.md) is the overview: short, with small examples. New features get a line there at most.
- [API.md](API.md) is the full reference. A change to a user-facing API updates it, and AGENTS.md, in the same commit.
- `site/` is the homepage, an Astro site whose words are in its own catalog. Its demo (`site/src/demo/`) runs the real tools
  on an entry the visitor edits, so what it shows is what `prosebook lint` says.

## Releases

A change that ships gets a changelog entry, `.tegami/<slug>.md`:

```bash
bun run tegami
```

The release workflow turns pending entries into a version pull request and publishes it. Never edit `version` in `package.json`.
