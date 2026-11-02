# AGENTS.md

Guidance for AI agents working in this repository.

## Commands

```bash
bun run test       # All tests (with the prosebook@dev condition: source, not dist)
bun typecheck      # TypeScript 7, over src and test, with test/types.test.ts's @ts-expect-error checks
bun run lint       # oxlint
bun run format     # oxfmt
bun run fix        # lint + format with autofix
bun run checks     # check + typecheck + test
bun run build      # dist/ with tsdown
bun run cli <cmd>  # the CLI from source, e.g. `bun run cli generate --root examples/vite`
bun run example    # build, then the Vite example's dev server (`tsdown --watch` beside it for live edits)
bun run examples:generate     # build, then `prosebook generate` in every example
bun run examples:smoke <name>  # an example's production build, served and checked (after its `build`)
bun run site       # the homepage (site/) in _site/, as Pages deploys it
bun run tegami     # write a changelog entry (.tegami/<slug>.md); config in scripts/tegami.mts
```

Prefer these scripts over ad-hoc commands. Do not prefix them with `bun run` when a bare alias exists
(`bun check`, `bun typecheck`) — those are whitelisted for agent use. Before finishing, run `bun run fix`
then `bun run checks` — the linter (type-aware, through `oxlint-tsgolint`), formatter and `tsc` own all
mechanical style rules. Fix the code; don't disable rules. A pre-commit hook runs both on staged files.

Releases are Tegami's: a change that ships gets a `.tegami/<slug>.md` entry (the `changelog` skill), and
`release.yml` turns pending entries into a version PR, then publishes. Never edit `version` in
`package.json` or put a version in a commit title; only that workflow bumps it.

After changing the compiler or the generator, regenerate the examples (`bun run examples:generate`) and
commit their `src/copy/`, so they show the current output; CI fails on an example whose output is stale.

## Structure

One package, ESM-only. Two halves that share only types: the runtime, which ships to browsers and
must stay small and dependency-free, and the tools, which run at build time in Node or Bun.

Runtime (`prosebook`, `prosebook/react`, `prosebook/react/server`):

- `src/runtime/types.ts`: what generated code and the runtime agree on; `Register` for module augmentation;
  `DevHooks`, the globals the Vite plugin sets in dev: `ReadHook`, which the runtime calls on every read
  for the inspector, and the `HotHook` set every copy adds itself to, so an edited locale's messages
  are swapped in place. A copy's `version` counts both kinds of change; `useCopy()` follows it.
- `src/runtime/helpers.ts`: the one-letter helpers compiled messages call (`h.n`, `h.p`, ...), per locale.
  None throws: `n` and `d` give nothing back for a missing value or one `Intl` refuses, and `e` returns
  the placeholder's fallback and reports why, which `createCopy` hands to `onError` with the key.
- `src/runtime/copy.ts`: `createCopy`, `defineCatalog`: lookup, fallback chain, lazy loading, subscribe.
- `src/runtime/locale.ts`: `negotiate`, `chainOf`, `preferredLocales`, and `acceptedLocales` for servers.
- `src/react/index.tsx`: `CopyProvider`, `useCopy`, `useLocale`, `Text`. `server.ts`: `createServerCopy`,
  a copy per request through React's `cache`, for server components. An entry of its own: the server
  build of React refuses the context `index.tsx` makes as it loads, so nothing there may import it.

Tools (`prosebook/tools`, `prosebook/config`, `prosebook/vite`, `prosebook/next`, `prosebook/bun`, the CLI):

- `src/tools/config.ts`: the config, its defaults and loading, and which rule runs at what severity.
  `presets.ts`: kinds, surfaces, the strict preset's word lists.
- `src/tools/catalog.ts`: loads and checks YAML; every problem is a `Problem` with its file, key and a fix.
  `entryLocator` finds an entry's line, reading each file once.
- `src/tools/icu.ts`: reading ICU ASTs: argument types, tags, number and date options. Parsed without a
  locale, so `parseMessage` reads a skeleton's `j` itself, as an hour `Intl` gives the locale's cycle.
- `src/tools/mf2.ts`: MessageFormat 2 read into the same element tree, and the tree written as MF2. `.match`
  becomes nested plural and select elements built per locale so the runtime picks MF2's variant; keep
  `matchTree`'s ranking in step with the spec. An option an argument gives (`currency=$code`, those in
  `FROM_ARGUMENT`) rides on the element's style as `args`, by `Intl` option (`optionArgsOf` in
  `icu.ts`), which types the argument and which the compiler passes to `h.n`/`h.d` beside the hoisted
  options. A number selector other than a bare `:number` rides on its plural element as `selection`
  (`selectionOf`): the `Intl.PluralRules` options that make it select as formatted, and `:integer`'s
  rounding or `:percent`'s scale, with its function to write back. Each placeholder carries its
  `placeholder` (`placeholderOf`): its `{$name}` fallback and, per `isolate` and `u:dir`, the marks
  isolating it, as the reference `messageformat` package decides. `mf1.ts`: the tree written as MF1,
  which refuses options from arguments. `syntax.ts`: the one
  switch between them (`messageFormat` in the config). `migrate.ts`: `prosebook migrate`, which renders
  each message both ways before writing.
- `src/tools/native/`: the Rust, Swift and Kotlin files `generate` writes for the config's `native`
  targets (`index.ts`). `model.ts` reads the catalog into a tree per message and locale, every fallback
  resolved, which `rust.ts`, `swift.ts` and `kotlin.ts` write out; a message one can't write is a
  `Problem` with the fix. `plurals.ts` compiles CLDR's rules (`cldr-core`, kept on the major the
  ICU in Node and Bun is built from, so they agree with `Intl.PluralRules`). `number.ts` takes an
  `Intl.NumberFormat` apart and checks the parts against it; `formatNumber` and `roundDigits` are
  the algorithm every target writes out, rounding the shortest decimal as `Intl` does, so keep them
  in step. `test/native.test.ts` compiles each target with any toolchain on the PATH and compares
  its output with the runtime's.
- `src/tools/compile.ts`: ICU AST to JavaScript. Keep its output in step with `runtime/helpers.ts`.
  Every placeholder reads `h` for its fallback (`a.name ?? h.e("{name}")`), so only a message with no
  placeholder and no tag is a plain string; the repo's tsconfig turns `noUnusedParameters` on over the
  example's output, which keeps that so.
- `src/tools/generate.ts`: the files `generate` writes. `lock.ts`: stale translations and the source texts
  they were made from; `diff.ts`: the word diff that shows what changed. `todo.ts`: `prosebook todo`,
  and with `--prompt` the prompt for a model. prosebook never calls a model: it writes the prompt, and
  `import` (`importTranslations` in `entry.ts`) checks the reply.
- `src/tools/lint.ts`: writing rules. The core rules are a `Record<string, CheckRule>` written as a
  plugin's are; each carries its severity under `recommended` and `strict`, and `lint.plugins` adds
  more as `<plugin>/<rule>`, as code or as data (`existence`, `substitution`, ...), which
  `compileRule` turns into code and checks when the config loads. The core word and case rules use
  the same matchers (`listed`, `outOfCase`) as the data rules; the format rules (`plural-count`,
  `arm-endings`, ...) walk the locale's `ast`, which MF2 is read into too. Every translation is linted
  by the rules whose `on.locale` reads it; unset is the source only, since most rules are English.
  `on.area` scopes a rule to areas, and `lint.areas` sets severities per area (`severityOf`).
  `scan.ts`: hardcoded JSX text, key references, and `unseenReads`: reads whose key a pruned build
  can't see, found by name (`t`, `rich`, their destructured aliases, `<Text>`). `pseudo.ts`.
- `src/tools/sarif.ts`: findings as a SARIF 2.1.0 log, for `--format sarif` on `lint`, `scan`, `status`
  and `check`. The CLI adds results beside its text, which goes to stderr then, and gives each a line.
- `src/tools/extract.ts`: `prosebook extract`: runs of JSX text to catalog entries, `<Text>` and `t()`. Its
  test renders a component before and after and compares the HTML; keep that passing.
- `src/tools/types.ts`: what kind of value a JSX expression holds, from TypeScript 7's `unstable/async`
  API (an optional peer) or, without it, from the expression's syntax. Not `unstable/sync`: under Bun on
  Linux and macOS it throws, and CI runs there.
- `src/tools/bundle.ts`: what the bundler integrations share: `keeper`, the unseen reads that are a
  copy's and the error they fail a build with, `scanSources` for bundlers that load a locale before
  the code reading it, the pruned locale module, the catalog watcher, and the dev code appended to the
  generated modules (`hotLocale`, `HOT_INDEX`, `HOT_SET`, `notifyingLocale`, `installInspector`).
  `endpoints.ts`: the inspector's `/__prosebook/open` and `/__prosebook/entry` over `Request` and
  `Response`, with each dev server's editor launcher handed in as `open`; `nodeMiddleware` mounts them
  on Vite's server and Next's.
- `src/vite.ts`: regenerate on change, prune in builds. Its `transform` runs `pre`, so keys and reads
  are found in the source as written (JSX, lines, `prosebook-ignore`); `prune: 'strict'`, the
  default, fails in `buildEnd` on a read `unseenReads` reports. `root` names the config's folder for
  apps that share a catalog. In dev it makes the generated modules accept their own updates (the index
  reloads only when the locales change), and the index, in the browser, imports `virtual:prosebook/dev`
  first: the dev hooks and the inspector, there before any copy, in frameworks that write their own
  HTML too. It serves the inspector's endpoints and opens an entry by redirecting to Vite's
  `/__open-in-editor`. `src/cli.ts`: the `prosebook` command.
- `src/next.ts`: `withProsebook`, the Next config wrapped. Generates in the dev and build phases only,
  watches in dev, and hands Turbopack rules for the generated modules, matched by file name then by the
  path's end (Turbopack's root may be the monorepo's). `next-loader.ts` is the loader those rules name
  by path (a tsdown entry of its own): in a build each locale's pruned module travels to it as its
  options, so no config is loaded in Turbopack's workers; in dev, in the browser, the index sets the
  hot set and starts the inspector (imported by a relative path), and each locale, run again by Fast
  Refresh, updates the copies. An app route needs a file in the app, so in dev the inspector's
  endpoints run on a local port of their own, once per process, and a `beforeFiles` rewrite of
  `/__prosebook/*` proxies to it; Next forwards the page's host, which the same-origin check reads, and
  an entry opens by redirect to `/__nextjs_launch-editor`. Turbopack only: Next 16 fails
  a Turbopack build whose config has a `webpack` key. Its export has a `default` condition, since Next
  `require`s the config.
- `src/bun.ts`: the Bun plugin. `Bun.build` names `entrypoints`, so it prunes there; the dev server
  (bunfig.toml's `[serve.static]`) names none, so there it watches and appends the Vite plugin's hot
  code, which Bun's `import.meta.hot` runs as Vite's does, and starts the inspector from the index
  unless `NODE_ENV` is `production`. `inspector()` is its endpoints as `Bun.serve` routes, opening
  entries with `Bun.openInEditor`; the example imports it only in dev and its build marks it external.
- `src/inspector.ts`: browser code, loaded from beside each integration (a tsdown entry of its own).
  `install` runs once per page, since Bun and Next run the index again on every change. Matches the text under the pointer to the reads the runtime reported, since the DOM carries no
  keys. Its test drives `keyAt` over a DOM. `inspector-dialog.ts`: the Alt-right-click dialog, in a
  shadow root, which edits an entry through the plugin's `/__prosebook/entry`. While typing it posts
  the edit unsaved and shows the view's `findings`, each with its `fixed` text, so no lint code ships
  to the browser. Its comment field and Mark for removal write the entry's `comment` and `remove`:
  requests for whoever edits next, which `loadCatalog` reports as warnings so agents find them.
- `src/tools/entry.ts`: an entry in every locale, as fields and as the YAML written for it, and edits
  to it. Every edit is checked as the whole catalog (`loadCatalog`'s `unsaved`, which also reads
  translation files an edit would create) before a file is written; fields go into the parsed document
  so the rest of the file stays as it was. An empty translation removes the key from its locale.
  `applyFixes` makes the edits lint findings carry, the same way, and `importTranslations` a locale's
  translations from `todo`'s YAML filled in, leaving out each entry its own file reports. A finding's `match` is found in the
  message's text through its literals (`literalsIn`), since the readings lose positions; a literal
  escaped in the text has none, so neither has a finding in it.

`site/index.html` is the homepage, and the only demo: `.github/workflows/pages.yml` deploys it on every
push to main. Its in-context demo recreates the inspector over a copy of `examples/vite`'s cart catalog, so
keep it in step when the inspector or that catalog changes, and add new features to its list. The copy
differs on purpose in one string, `cart.checkout`'s "Check out...", so the demo has a lint finding to show.

`examples/` holds one app per integration (`vite`, `next`, `tanstack-start`, `bun`, `node`), each a
private workspace that imports prosebook from `dist` as a user's app would, so build before running
one. They share the shop catalog, but each is standalone. `scripts/smoke.mts` serves an example's
build and checks what it says; CI's `examples` job runs it after each example's check, typecheck and
build. The examples link prosebook's bin only once `dist/cli.js` exists, so CI installs again after
building. `test/fixture.ts` builds projects on disk under `test/.tmp/` and evaluates compiled messages.

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
