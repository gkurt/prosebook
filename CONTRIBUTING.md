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
bun run example     # build, then the Vite example's dev server
bun run site        # the homepage (site/) in _site/
```

Before committing, run `bun run fix` (lint and format, with fixes) and `bun run checks` (check, typecheck and test). A pre-commit
hook runs the linter and formatter on staged files. Fix what they report rather than disabling a rule.

## Examples

`examples/` holds one app per integration and per binding, each importing prosebook from `dist` as a user's app would. After
changing the compiler or the generator, regenerate them and commit their `src/copy/`; CI fails on stale output:

```bash
bun run examples:generate
bun run --cwd examples/next dev    # run one
bun run examples:smoke vite        # serve an example's production build and check it (after its build)
```

## Documentation

- [README.md](README.md) is the overview: short, with small examples. New features get a line there at most.
- [API.md](API.md) is the full reference. A change to a user-facing API updates it, and AGENTS.md, in the same commit.
- `site/index.html` is the homepage. Its in-context demo copies `examples/vite`'s cart catalog; keep the two in step.

## Releases

A change that ships gets a changelog entry, `.tegami/<slug>.md`:

```bash
bun run tegami
```

The release workflow turns pending entries into a version pull request and publishes it. Never edit `version` in `package.json`.
