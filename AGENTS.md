# AGENTS.md

Guidance for AI agents working in this repository.

## Commands

```bash
bun run test       # All tests (with the prosebook@dev condition: source, not dist)
bun typecheck      # TypeScript 7; includes the example app and test/types.test.ts's @ts-expect-error checks
bun run lint       # oxlint
bun run format     # oxfmt
bun run fix        # lint + format with autofix
bun run checks     # check + typecheck + test
bun run build      # dist/ with tsdown
bun run cli <cmd>  # the CLI from source, e.g. `bun run cli generate --root examples/react-app`
bun run example    # the example app in Vite
bun run site       # the homepage (site/) in _site/, as Pages deploys it
```

Prefer these scripts over ad-hoc commands. Do not prefix them with `bun run` when a bare alias exists
(`bun check`, `bun typecheck`) — those are whitelisted for agent use. Before finishing, run `bun run fix`
then `bun run checks` — the linter (type-aware, through `oxlint-tsgolint`), formatter and `tsc` own all
mechanical style rules. Fix the code; don't disable rules. A pre-commit hook runs both on staged files.

After changing the compiler or the generator, regenerate the example
(`bun run cli generate --root examples/react-app`) and commit its `src/copy/`, so it shows the current output.

## Structure

One package, ESM-only. Two halves that share only types: the runtime, which ships to browsers and
must stay small and dependency-free, and the tools, which run at build time in Node or Bun.

Runtime (`prosebook`, `prosebook/react`):

- `src/runtime/types.ts`: what generated code and the runtime agree on; `Register` for module augmentation;
  `DevHooks`, the globals the Vite plugin sets in dev: `ReadHook`, which the runtime calls on every read
  for the inspector, and the `HotHook` set every copy adds itself to, so an edited locale's messages
  are swapped in place. A copy's `version` counts both kinds of change; `useCopy()` follows it.
- `src/runtime/helpers.ts`: the one-letter helpers compiled messages call (`h.n`, `h.p`, ...), per locale.
- `src/runtime/copy.ts`: `createCopy`, `defineCatalog`: lookup, fallback chain, lazy loading, subscribe.
- `src/runtime/locale.ts`: `negotiate`, `chainOf`, `preferredLocales`.
- `src/react/index.tsx`: `CopyProvider`, `useCopy`, `useLocale`, `Text`.

Tools (`prosebook/tools`, `prosebook/config`, `prosebook/vite`, the CLI):

- `src/tools/config.ts`: the config, its defaults and loading, and which rule runs at what severity.
  `presets.ts`: kinds, surfaces, the strict preset's word lists.
- `src/tools/catalog.ts`: loads and checks YAML; every problem is a `Problem` with its file, key and a fix.
  `entryLocator` finds an entry's line, reading each file once.
- `src/tools/icu.ts`: reading ICU ASTs: argument types, tags, number and date options.
- `src/tools/mf2.ts`: MessageFormat 2 read into the same element tree, and the tree written as MF2. `.match`
  becomes nested plural and select elements built per locale so the runtime picks MF2's variant; keep
  `matchTree`'s ranking in step with the spec. `mf1.ts`: the tree written as MF1. `syntax.ts`: the one
  switch between them (`messageFormat` in the config). `migrate.ts`: `prosebook migrate`, which renders
  each message both ways before writing.
- `src/tools/compile.ts`: ICU AST to JavaScript. Keep its output in step with `runtime/helpers.ts`.
- `src/tools/generate.ts`: the files `generate` writes. `lock.ts`: stale translations and the source texts
  they were made from; `diff.ts`: the word diff that shows what changed.
- `src/tools/lint.ts`: writing rules. The core rules are a `Record<string, CheckRule>` written as a
  plugin's are; each carries its severity under `recommended` and `strict`, and `lint.plugins` adds
  more as `<plugin>/<rule>`, as code or as data (`existence`, `substitution`, ...), which
  `compileRule` turns into code and checks when the config loads. The core word and case rules use
  the same matchers (`listed`, `outOfCase`) as the data rules; the format rules (`plural-count`,
  `arm-endings`, ...) walk the locale's `ast`, which MF2 is read into too. Every translation is linted
  by the rules whose `on.locale` reads it; unset is the source only, since most rules are English. `scan.ts`: hardcoded JSX text and key references. `pseudo.ts`.
- `src/tools/sarif.ts`: findings as a SARIF 2.1.0 log, for `--format sarif` on `lint`, `scan`, `status`
  and `check`. The CLI adds results beside its text, which goes to stderr then, and gives each a line.
- `src/tools/extract.ts`: `prosebook extract`: runs of JSX text to catalog entries, `<Text>` and `t()`. Its
  test renders a component before and after and compares the HTML; keep that passing.
- `src/tools/types.ts`: what kind of value a JSX expression holds, from TypeScript 7's `unstable/async`
  API (an optional peer) or, without it, from the expression's syntax. Not `unstable/sync`: under Bun on
  Linux and macOS it throws, and CI runs there.
- `src/vite.ts`: regenerate on change, prune in builds. In dev it makes the generated modules accept
  their own updates (the index reloads only when the locales change), sets the dev hooks before the app
  runs, serves the inspector and opens the entry it asks for (`entryLocation` in `catalog.ts`, then
  Vite's `/__open-in-editor`). `src/cli.ts`: the
  `prosebook` command.
- `src/inspector.ts`: browser code, loaded by the Vite plugin from beside itself (a tsdown entry of its
  own). Matches the text under the pointer to the reads the runtime reported, since the DOM carries no
  keys. Its test drives `keyAt` over a DOM. `inspector-dialog.ts`: the Alt-right-click dialog, in a
  shadow root, which edits an entry through the plugin's `/__prosebook/entry`. While typing it posts
  the edit unsaved and shows the view's `findings`, each with its `fixed` text, so no lint code ships
  to the browser. Its comment field and Mark for removal write the entry's `comment` and `remove`:
  requests for whoever edits next, which `loadCatalog` reports as warnings so agents find them.
- `src/tools/entry.ts`: an entry in every locale, as fields and as the YAML written for it, and edits
  to it. Every edit is checked as the whole catalog (`loadCatalog`'s `unsaved`, which also reads
  translation files an edit would create) before a file is written; fields go into the parsed document
  so the rest of the file stays as it was. An empty translation removes the key from its locale.
  `applyFixes` makes the edits lint findings carry, the same way. A finding's `match` is found in the
  message's text through its literals (`literalsIn`), since the readings lose positions; a literal
  escaped in the text has none, so neither has a finding in it.

`site/index.html` is the homepage, and the only demo: `.github/workflows/pages.yml` deploys it on every
push to main. Its in-context demo recreates the inspector over a copy of the example's cart catalog, so
keep it in step when the inspector or that catalog changes, and add new features to its list. The copy
differs on purpose in one string, `cart.checkout`'s "Check out...", so the demo has a lint finding to show.

`examples/react-app/` uses prosebook from source through Vite aliases. `test/fixture.ts` builds
projects on disk under `test/.tmp/` and evaluates compiled messages.

## Conventions

- Problem messages state the fix: `args.n is missing: say what the placeholder holds`.
- Comments say what the code cannot: the reason, the constraint, the trap. Match the density around them.
- The runtime has no dependencies. Anything that needs a parser belongs in the tools.
- Imports from parent directories go through the `#src/` alias, with the extension (`#src/runtime/types.ts`).
- Prefer colocation, and early returns and guard clauses over nested conditionals.
- Check for existing helpers before creating new ones. Avoid duplication.
- Remove dead and commented-out code; don't preserve old APIs unless asked.
- When moving code, don't leave a re-export behind: update every importer and delete the old definition.
- Line endings are LF, on every OS. Scripts that write files must write LF too: on Windows, Python's text
  mode writes CRLF unless opened with `newline=''`.

## Documentation

When changing user-facing APIs, update README.md and AGENTS.md in the same change. Documentation must
not go stale.
