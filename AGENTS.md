# AGENTS.md

Guidance for AI agents working in this repository.

## Commands

```bash
bun run test       # All tests (with the copydeck@dev condition: source, not dist)
bun typecheck      # TypeScript 7; includes the example app and test/types.test.ts's @ts-expect-error checks
bun run lint       # oxlint
bun run format     # oxfmt
bun run fix        # lint + format with autofix
bun run checks     # check + typecheck + test
bun run build      # dist/ with tsdown
bun run cli <cmd>  # the CLI from source, e.g. `bun run cli generate --root examples/react-app`
bun run example    # the example app in Vite
```

Before finishing, run `bun run fix` then `bun run checks`. After changing the compiler or the
generator, regenerate the example (`bun run cli generate --root examples/react-app`) and commit its
`src/copy/`, so it shows the current output.

## Structure

One package, ESM-only. Two halves that share only types: the runtime, which ships to browsers and
must stay small and dependency-free, and the tools, which run at build time in Node or Bun.

Runtime (`copydeck`, `copydeck/react`):

- `src/runtime/types.ts`: what generated code and the runtime agree on; `Register` for module augmentation.
- `src/runtime/helpers.ts`: the one-letter helpers compiled messages call (`h.n`, `h.p`, ...), per locale.
- `src/runtime/copy.ts`: `createCopy`, `defineCatalog`: lookup, fallback chain, lazy loading, subscribe.
- `src/runtime/locale.ts`: `negotiate`, `chainOf`, `preferredLocales`.
- `src/react/index.tsx`: `CopyProvider`, `useCopy`, `useLocale`, `Text`.

Tools (`copydeck/tools`, `copydeck/config`, `copydeck/vite`, the CLI):

- `src/tools/config.ts`: the config, its defaults and loading. `presets.ts`: kinds, surfaces, lint presets.
- `src/tools/catalog.ts`: loads and checks YAML; every problem is a `Problem` with where and a fix.
- `src/tools/icu.ts`: reading ICU ASTs: argument types, tags, number and date options.
- `src/tools/compile.ts`: ICU AST to JavaScript. Keep its output in step with `runtime/helpers.ts`.
- `src/tools/generate.ts`: the files `generate` writes. `lock.ts`: stale translations.
- `src/tools/lint.ts`: writing rules. `scan.ts`: hardcoded JSX text and key references. `pseudo.ts`.
- `src/tools/extract.ts`: `copydeck extract`: runs of JSX text to catalog entries, `<Text>` and `t()`. Its
  test renders a component before and after and compares the HTML; keep that passing.
- `src/vite.ts`: regenerate on change, prune in builds. `src/cli.ts`: the `copydeck` command.

`examples/react-app/` uses copydeck from source through Vite aliases. `test/fixture.ts` builds
projects on disk under `test/.tmp/` and evaluates compiled messages.

## Conventions

- Problem messages state the fix: `args.n is missing: say what the placeholder holds`.
- Comments say what the code cannot: the reason, the constraint, the trap. Match the density around them.
- The runtime has no dependencies. Anything that needs a parser belongs in the tools.
