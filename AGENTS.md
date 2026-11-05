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

Runtime (`prosebook`, `prosebook/react`, `prosebook/react/server`, `prosebook/preact`, `prosebook/vue`,
`prosebook/svelte`, `prosebook/solid`):

- `src/runtime/types.ts`: what generated code and the runtime agree on; `Register` for module augmentation;
  `DevHooks`, the globals the Vite plugin sets in dev: `ReadHook`, which the runtime calls on every read
  for the inspector, and the `HotHook` set every copy adds itself to, so an edited locale's messages
  are swapped in place. A copy's `version` counts both kinds of change; `useCopy()` follows it.
- `src/runtime/helpers.ts`: the one-letter helpers compiled messages call (`h.n`, `h.p`, ...), per locale.
  None throws: `n` and `d` give nothing back for a missing value or one `Intl` refuses, and `e` returns
  the placeholder's fallback and reports why, which `createCopy` hands to `onError` with the key.
- `src/runtime/copy.ts`: `createCopy`, `defineCatalog`: lookup, fallback chain, lazy loading, subscribe.
  A copy's layer per locale fills area by area: a catalog that isn't split is one area, `''`; a split
  one (`split`) starts empty and takes each area `addArea` registers, by `split.id` in a registry of
  the module's own, so an area loading after a dev edit ran the index again still reaches its copies.
  A server build's catalog may list `areaFiles`, each area's file per lazy locale in the split client,
  which a copy hands to `preload` as it reads each area, once per file, for the page to link.
- `src/runtime/locale.ts`: `negotiate`, `chainOf`, `preferredLocales`, and `acceptedLocales` for servers.
- `src/react/index.tsx`: `CopyProvider`, `useCopy`, `useLocale`, `Text`. `server.ts`: `createServerCopy`,
  a copy per request through React's `cache`, for server components. An entry of its own: the server
  build of React refuses the context `index.tsx` makes as it loads, so nothing there may import it.
- `src/runtime/bind.ts`: what every framework binding shares. `bindCopy` is a copy read through the
  framework's reactivity: `track` on every read, the provider's tags under each rich read's own, `tag` for
  what a tag renderer becomes and `whole` for what a rich read returns. Also `<Text>`'s prop types.
- `src/preact/index.ts`, `src/vue/index.ts`, `src/solid/index.ts`, `src/svelte/index.ts`: one binding
  each, written without JSX or a framework compiler. React and Preact rebuild the reader per version;
  Vue tracks a ref, Solid a signal, Svelte a `createSubscriber`. Vue's `<Text>` takes tags as slots;
  Svelte's tags are snippets, so a rich read returns `{ snippet, chunks }` parts and `Text.svelte`, which
  ships as source for the app's Svelte compiler (tsdown copies it and its `.d.ts`), renders them. It
  imports `prosebook/svelte` by name, and its types name prosebook by package, as they ship beside it.

Tools (`prosebook/tools`, `prosebook/config`, `prosebook/vite`, `prosebook/next`, `prosebook/bun`, the CLI):

- `src/tools/config.ts`: the config, its defaults and loading, and which rule runs at what severity.
  `presets.ts`: kinds, surfaces, the strict preset's word lists.
- `src/tools/catalog.ts`: loads and checks YAML; every problem is a `Problem` with its file, key and a fix.
  `partial` leaves out each broken entry and translation instead of throwing, which the CLI and the dev
  servers load with, so one entry being edited doesn't stop the rest; builds stay strict. An edit,
  fix or import is checked for the errors it brings (`checkEdit` in `entry.ts`), not those already there.
  `entryLocator` finds an entry's line, reading each file once.
- `src/tools/icu.ts`: reading ICU ASTs: argument types, tags, number and date options. Parsed without a
  locale, so `parseMessage` reads a skeleton's `j` itself, as an hour `Intl` gives the locale's cycle.
  Argument types are TypeScript text: a select's is its arms and `(string & {})` (`OPEN`), closed by the
  entry's `closed`, a boolean for `true`/`false` arms, and `| null | undefined` with a `null` arm, which
  the runtime's `h.s` picks for an absent value; `unionOf` merges two uses of one argument.
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
  in step. `date.ts` takes an `Intl.DateTimeFormat` apart the same way, into text and fields (a
  padded number, an hour on the locale's clock, or a name from a table, a day period per hour where
  it isn't AM and PM), checked on dates covering every month, weekday and hour; `formatDate` is the
  reference and `pieceExpr` the field arithmetic Rust, Swift and Kotlin share. A target reads the
  date's fields in the device's time zone (Swift's `Calendar`, Kotlin's `ZoneId`), and Rust, whose
  standard library has none, takes a `DateTime` of the clock's fields, made by `from_unix` with the
  offset. A time zone name, a time zone of the message's own or a calendar other than the Gregorian
  is refused. `android.ts` writes Android's string resources, a `values*/<name>.xml` per locale under
  the `res` folder `out` names, straight from the ICU tree (with `wordsFor` and `foundIn` from the
  model): Android formats with `String.format` and selects plurals itself, so it takes text, `{name}`
  as `%N$s`, and one cardinal plural as `<plurals>`, and refuses the rest. `apple.ts` writes
  `.strings` tables, a `<locale>.lproj/<name>.strings` per locale (plain `.strings`, since only
  Xcode compiles a String Catalog), with `%N$@`, and a message with a plural in a `.stringsdict` of
  the same name, each plural a variable of its format with its count `%N$lld`; with `plist` it is
  `InfoPlist`, its keys spelling the plist's case-insensitively and its source checked against the
  plist's text. Both write through `printf.ts`, the format-string walk they share, which also holds
  `checkPlural`: what a platform's plurals pick on (one cardinal count, no offset, no `=N`). `test/native.test.ts` compiles
  each target with any toolchain on the PATH (aapt2 from `ANDROID_HOME` too) and compares its output
  with the runtime's; nothing here runs the `.strings` files on a Mac.
- `src/tools/compile.ts`: ICU AST to JavaScript. Keep its output in step with `runtime/helpers.ts`.
  Every placeholder reads `h` for its fallback (`a.name ?? h.e("{name}")`), so only a message with no
  placeholder and no tag is a plain string; the repo's tsconfig turns `noUnusedParameters` on over the
  example's output, which keeps that so.
- `src/tools/generate.ts`: the files `generate` writes, the catalog's own included where one lacks its
  first line, `SCHEMA_LINE` (`catalog.ts`), so `--check` fails there. `guide.ts`: the writing guide
  `generate` writes (`guide`, `WRITING.md` in the catalog folder) for whoever writes next: only what
  the lint can't check, the kinds' and surfaces' docs and the rules marked `guide`, which every
  `guideline` (a data rule with no check) is. Keep it short; what a rule checks, its finding says. `lock.ts`: stale translations and the source texts
  they were made from; `diff.ts`: the word diff that shows what changed. `todo.ts`: `prosebook todo`,
  and with `--prompt` the prompt for a model, which says the rules marked `guide` that read the
  locale and some entry in it (`applies`, as the lint decides). prosebook never calls a model: it writes the prompt, and
  `import` (`importTranslations` in `entry.ts`) checks the reply. `exchange.ts`: `prosebook export`,
  the same entries as XLIFF 2.0 or JSON for translation tools, and `readReturned`, which reads every
  format `import` takes (todo's YAML, JSON, XLIFF, through a small XML reader of its own). Messages
  travel as their ICU or MF2 text, never as XLIFF inline codes; a unit's `state` says whether someone
  looked at it, and its source must still be the catalog's.
- `src/tools/lint.ts`: writing rules. The core rules are a `Record<string, CheckRule>` written as a
  plugin's are; each carries its severity under `recommended` and `strict`, and `lint.plugins` adds
  more as `<plugin>/<rule>`, as code or as data (`existence`, `substitution`, ...), which
  `compileRule` turns into code and checks when the config loads. The core word and case rules use
  the same matchers (`listed`, `outOfCase`) as the data rules; the format rules (`plural-count`,
  `arm-endings`, ...) walk the locale's `ast`, which MF2 is read into too. Every translation is linted
  by the rules whose `on.locale` reads it; unset is the source only, since most rules are English.
  `on.area` scopes a rule to areas, and `lint.areas` sets severities per area (`severityOf`).
  `plural-forms` reads the forms from `Intl.PluralRules`, and an MF2 plural's `categories` (set by
  `matchTree`, `categoriesOf` in `icu.ts`), since its tree arms every form once `*` is written. The
  punctuation rules (`quotes`, `french-spacing`, `inverted-marks`, `full-width`) are per language,
  `quotes` through `lint.quotes` over `DEFAULT_QUOTES` (`presets.ts`); they match with regular
  expressions, which a `Report` may give as its `match`, its `fix` expanded from the match's groups.
  `duplicate` compares entries through the context's `catalog`, which `lint` takes apart from the
  messages it lints, so the inspector's one entry is still held to the rest. No-break spaces are
  written as escapes (`NBSP`, `NARROW_NBSP`), never as the characters, which no editor shows.
  `scan.ts`: hardcoded text, key references, and `unseenReads`. Hardcoded text is JSX's, what its
  expressions render (`shownLiterals`: ternary arms, fallbacks, templates), what `scan.calls` are given
  in any script and, in components only, `scan.properties`' values; `looksLikeCode` keeps IDs, hosts
  and commands out, and `isNonProse` `<kbd>` and `<Kbd>`. `unseenReads`: reads whose key a pruned build
  can't see, found by name (`t`, `rich`, their destructured aliases, `<Text>` from any binding); a read
  through a module's `const` map of keys (`keyMapsIn`) counts as seen. A `.vue`
  or `.svelte` file is read as its script blocks and the expressions in its markup, each parsed apart
  at its offset, so lines and `prosebook-ignore` hold; Vite reads such a file whole, not the parts its
  compiler splits off. `pseudo.ts`.
- `src/tools/sarif.ts`: findings as a SARIF 2.1.0 log, for `--format sarif` on `lint`, `scan`, `status`
  and `check`. The CLI adds results beside its text, which goes to stderr then, and gives each a line.
- `src/tools/extract.ts`: `prosebook extract`: runs of JSX text to catalog entries, `<Text>` and `t()`. Its
  tests render a component before and after and compare the HTML; keep them passing. It refuses a run
  rather than write a fragment (a pick in code beside words, `splicedText`'s placeholders), reuses a key
  only for the same role, and fills `extract.shared`. Its contexts are `TODO:` drafts, which
  `loadCatalog` warns of until rewritten.
- `src/tools/types.ts`: what kind of value a JSX expression holds and whether it may be null, and what
  a component takes as `children`, from TypeScript 7's `unstable/async` API (an optional peer, whose
  `TypeFlags` are numbered unlike TypeScript 5's) or, without it, from the expression's syntax. Not `unstable/sync`: under Bun on
  Linux and macOS it throws, and CI runs there.
- `src/tools/bundle.ts`: what the bundler integrations share: `keeper`, the unseen reads that are a
  copy's and the error they fail a build with, `scanSources` for bundlers that load a locale before
  the code reading it, the pruned locale module, the catalog watcher, and the dev code appended to the
  generated modules (`hotLocale`, `HOT_INDEX`, `HOT_SET`, `notifyingLocale`, `installInspector`).
  A build leaves the pseudo-locale out (`withoutPseudo`) and loads `buildIndex` in place of the
  generated index, which lists every locale `generated` holds; the split index and areas read the same.
  And splitting, which every integration shares: `splitIndex`, `areaModule` (its build `inline`
  given by each bundler: Vite's placeholders, Bun's and Next's pruned code), `areasNamed`,
  `importingAreas`, each writing imports through `Specifiers`: `VIRTUAL` for Vite's and Bun's virtual
  modules, `fileSpecifiers` for Next's area files. In a build a lazy locale's part is per group of
  areas (`Groups`, each led by its first area), which `chunks.ts`'s `areaGroups` reads ahead of the
  build from the imports under `scan.dirs`: areas loaded by the same entries, the app's own and each
  dynamic import, less those that load once the area is already in memory, as Rollup chunks them.
  A guess that costs a request when wrong, never a message: the copy takes each area's own keys.
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
  `/__open-in-editor`. With `split`, in the browser only, the index is loaded as a catalog with no
  messages, each module naming an area's keys gets `import "virtual:prosebook/area/<area>"` appended
  (imports run first wherever they sit, so no line moves), and the area module awaits `addArea` with
  its messages: in a build placeholders filled per area in `renderChunk`, its lazy locales
  `virtual:prosebook/area/<group>/<locale>`, the group's part, groups read in `buildStart`; in dev the generated locale modules whole, so their hot
  updates work unchanged and the copy keeps only the areas it holds. A split client build writes each
  area's file per lazy locale to `node_modules/.prosebook/area-files.json` in `generateBundle`, and the
  server build after it loads the index with them as its catalog's `areaFiles`.
  `src/cli.ts`: the `prosebook` command.
- `src/next.ts`: `withProsebook`, the Next config wrapped. Generates in the dev and build phases only,
  watches in dev, and hands Turbopack rules for the generated modules, matched by file name then by the
  path's end (Turbopack's root may be the monorepo's). `next-loader.ts` is the loader those rules name
  by path (a tsdown entry of its own): in a build each locale's pruned module travels to it as its
  options, so no config is loaded in Turbopack's workers; in dev, in the browser, the index sets the
  hot set and starts the inspector (imported by a relative path), and each locale, run again by Fast
  Refresh, updates the copies. An app route needs a file in the app, so in dev the inspector's
  endpoints run on a local port of their own, once per process, and a `beforeFiles` rewrite of
  `/__prosebook/*` proxies to it; Next forwards the page's host, which the same-origin check reads, and
  an entry opens by redirect to `/__nextjs_launch-editor`. With `split`, Turbopack having no
  virtual modules, the areas are files under `node_modules/.prosebook/areas` (`areaFile`), foreign
  code to Turbopack, written in dev (whole, rewritten on each edit) and in builds (pruned); the
  index's browser rule hands over the split index, and a rule per source extension under `scan.dirs`,
  in the browser, not foreign, and matched by content (a quote, then an area), runs the loader to
  append the area imports. An app's own rule for a glob ours shares stays, first, in a list. Turbopack only: Next 16 fails
  a Turbopack build whose config has a `webpack` key. Its export has a `default` condition, since Next
  `require`s the config.
- `src/bun.ts`: the Bun plugin. `Bun.build` names `entrypoints`, so it prunes there; the dev server
  (bunfig.toml's `[serve.static]`) names none, so there it watches and appends the Vite plugin's hot
  code, which Bun's `import.meta.hot` runs as Vite's does, and starts the inspector from the index
  unless `NODE_ENV` is `production`. `inspector()` is its endpoints as `Bun.serve` routes, opening
  entries with `Bun.openInEditor`; the example imports it only in dev and its build marks it external.
  With `split`, areas are modules of its own namespace, and the source under `scan.dirs` is loaded
  here to append their imports, as Bun has no transform hook. A full-stack `Bun.build` loads each
  module once per side and names it in `onLoad`'s `side`, not in Bun's types (a server's own build
  names `server` too); only `client` splits. A split build turns on Bun's metafile, which names the
  file each lazy locale's part of a group went to; `onEnd`, once the files are written, writes them
  to `node_modules/.prosebook/area-files.json` and fills the server index's placeholder `areaFiles`
  in the written output, from this build's page or, in a server's own build, from that file.
  bunfig.toml takes a module's default export, so the example's dev plugin is `prosebook.plugin.ts`.
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

`examples/` holds one app per integration (`vite`, `next`, `tanstack-start`, `bun`, `node`) and per
binding beyond React (`preact`, `vue`, `svelte`, `solid`, each on Vite), each a
private workspace whose copy follows its `copy/catalog/WRITING.md`, and that imports prosebook from `dist` as a user's app would, so build before running
one. They share the shop catalog, but each is standalone. `scripts/smoke.mts` serves an example's
build and checks what it says; CI's `examples` job runs it after each example's check, typecheck and
build. The examples link prosebook's bin only once `dist/cli.js` exists, so CI installs again after
building. `vue` and `svelte` typecheck with `vue-tsc` and `svelte-check` on TypeScript 6, since both need
the TypeScript API that 7 lacks. `test/fixture.ts` builds projects on disk under `test/.tmp/` and evaluates
compiled messages. `test/preload.ts` (bunfig's) gives the framework tests Solid's and Svelte's browser
builds, which Bun would otherwise resolve to their server builds, and compiles `.svelte` files.

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
