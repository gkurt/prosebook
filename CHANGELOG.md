## prosebook@0.8.0

### The pseudo-locale stays out of production

A build through `prosebook/vite`, `prosebook/next` or `prosebook/bun` (and Bun's server run with `NODE_ENV=production`) leaves the `pseudo` locale out of `catalog.locales` and ships none of its messages, so a locale switcher built from `copy.locales` no longer offers `en-XA` to users. Dev keeps it, and `generate` still writes its module.

## prosebook@0.7.0

### `plural-count` says each finding once, and passes a ratio's total

The same words in each arm of a select are one finding, and `{used, number} of {window, number} tokens` no longer asks for a plural, since the noun counts a whole.

### `init`'s example entries are comments

The catalog `init` writes shows its example entries as comments to write yours after, so `scan` no longer reports them as unused keys straight away.

### `scan` reads what JSX expressions render, notices and label maps

Both arms of a ternary, a `??` or `||` fallback and a template's words are found in JSX text and readable attributes, as are the text given to `scan.calls` (`toast`, `alert`, `confirm`) and, in components, the values of `scan.properties` (`label`, `title`, `description`, `placeholder`, `header`). `scan()` and `hardcodedText()` in `prosebook/tools` take the scan options as one object.

### `extract` keeps two features' files out of one area

Two files that would share an area, `routes/notifications.tsx` and `components/Notifications.tsx`, each take their folder's name too, and the report says so.

### `extract` writes what type-checks

Inside a component whose `children` are typed `string`, text becomes `{t('…')}` rather than a `<Text>` it can't take, and a value that may be `null` is given `?? ''`, which renders as React rendered the null.

### `args` describes a tag too

`args.link` on a message with `<link>` says what the tag wraps, for the translator's notes in `todo` and `export` and for the key's doc comment, rather than failing.

### `extract` reads a number made text in code as the number

`{c.toLocaleString()} nodes` becomes a plural of `c`, and `frameMs.toFixed(2)` becomes `{frameMs, number, ::.00}`, rather than a string placeholder; and a message that starts with a plural is keyed by its words, not `other`.

### `useCopy()` keeps its identity while the provider renders again

In React and Preact, a `CopyProvider` without `tags` no longer makes every `useCopy()` reader new on each render, so `t` is safe as an effect's dependency until the locale changes.

### A select on `true` and `false` takes a boolean

`{on, select, true {On} other {Off}}` types `on` as `boolean`, so a call site passes `true` rather than the text `'true'` or a stand-in such as `'yes'`.

### A broken entry no longer stops every command

`generate`, `lint`, `scan`, `status` and the dev servers report a broken entry or translation with its fix, leave it out, and carry on with the rest of the catalog; each command still fails while it is broken. An edit, a lint fix or an import is refused only for problems it brings itself.

### `generate` says the files are current

Run after a dev server has regenerated, it says the generated files are current rather than that nothing changed.

### `extract` says nothing of markup with no words beside it

`{icon} {children}` is no sentence, so it no longer warns that `{children}` holds markup.

### `scan` and `extract` leave keys, example values and commands alone

Text in `<Kbd>` and other components named for `<kbd>`, `<code>` and `<pre>`, and an ID such as `us-west-2`, a list of hosts or a shell command, are no longer taken for copy.

### `extract` keeps a label and its hint apart

A label's text followed on the next line by `<span>A sentence…</span>`, which JSX renders with no space between, becomes two entries rather than one message with a tag.

### `extract`'s contexts are drafts, listed until finished

A new entry's context says it is a draft and where extract found the string, and `generate` and `check` warn of every context and argument doc still starting with `TODO`. Placeholders are named for what they hold: `files.length` is `filesCount`, `PREVIEW_EVENTS` is `previewEvents`, `formatBytes(size)` is `size`.

### A `detail` surface, and reasons named once

A state on the new default surface `detail`, a row's detail line, a reading or a count, needs no period. `lint.reasons` holds reasons many exemptions share, which `allow` names (`period: card-detail`), so each is written and reviewed once; a name the config doesn't hold fails.

### `extract` reads a component's `title` as its heading

`title` on a component (`<NavCard title="Billing" />`) is a heading it shows, keyed `-title`, where an element's stays a tooltip; and a name that runs to a sentence is drafted as a description, which its word budget holds.

### A shared area for the words every feature says

`extract: { shared: 'common' }` gives `Cancel`, `Loading…` and other words several features say one entry: `extract` reuses one there from any file and writes text another area holds already there, and the writing guide points at it. Without it, `extract` names each string that is now an entry in several areas.

### `extract` reads the words code picks

`{n === 1 ? 'file' : 'files'}` in a sentence becomes a plural; a ternary or a fallback standing alone becomes an entry per word, and in a readable attribute `t()` in place, as a template attribute becomes `t()` with its values. A sentence that a pick, another message, a lookup, a joined list or a case change would split into fragments is left as it is, with a warning saying how to write it.

### `formatted-by-hand` finds a unit typed after a number

`{hours, number}h` and `{size, number} MB` are found, with the unit format that writes them as the locale does.

### A select arm ICU can't name says how to write it

`{type, select, application/pdf {…}}` fails with the name ICU takes and MF2's quoting, rather than the parser's `EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT`.

### A select's argument can also be printed

`{tool, select, shell {Shell} other {{tool}}}` no longer fails as "used as two different types", and two selects on one argument take the arms of both.

### A select's `null` arm says what an absent value shows

`{role, select, null {} other {, as {role}}}` picks `null` for a value that is `null` or `undefined`, and types `role` as optional, so an optional part of a message needs no stand-in value.

### `extract` names areas and keys in whole words

`GitHubConnect.tsx` is the area `github-connect`, as is any name in `lint.properNouns`, and a key's words keep their apostrophes' letters: `couldnt`, not `couldn`.

### `closed` selects take only their arms

`closed: [mode]` on an entry types `mode` as the arms its select names, `'dark' | 'light'`, so a misspelled or unhandled value is a type error; `other` stays in the message for the runtime and translation tools, and a translation may not select on an arm the source doesn't name.

### A read through a `const` map of keys is seen

`t(STATUS[s])` and `<Text id={KINDS[i].label} />` no longer fail a pruned build or need `prosebook-ignore` where `STATUS` and `KINDS` are `const` maps or lists of keys in the same module: every key they can read is written there.

### `extract` reuses a key only for the same role

The same words as an aria-label, a placeholder and a button are three entries, since each translates on its own; an entry that names no kind or surface is still reused for any.

### `extract` keeps the spaces around a sentence

A `{' '}` before a line break stays in the code, and a literal's own leading or trailing space goes beside the `<Text>`, so `from{' '}<Branch />` no longer renders "frommain".

### `scan` and `check` report reads a pruned build can't see

`t(id)` and `<Text id={id} />` are reported where they are, as the bundler plugins would fail the build on them: a warning from `scan` and `check`, an error under `scan --strict`, and `unseen-read` in a SARIF log.

### `MessageKey` and `Translate` types

`MessageKey` is a key of the registered catalog, for a prop or a map that holds one, and `Translate` is a copy's `t`, for a function handed one.

## prosebook@0.6.0

### Guidelines, and a writing guide for an agent to read before it writes

A lint rule of `type: 'guideline'` is advice no pattern can check. `generate` writes `copy/catalog/WRITING.md` with what each kind and surface is for, the guidelines, and any checked rule marked `guide: true`, and `generate --check` fails once it is stale. Set `guide` to move it, or `false` for none. A guideline whose `on.locale` reads a translation's locale is said in that locale's `todo --prompt` too.

### A server render links the files of the areas it reads, under Bun too

A split `Bun.build` lists each lazy locale's files in the server's catalog, so `createCopy`'s `preload` is handed them as under Vite: in a full-stack build from the page built beside the server, and in a server's own build from the page's build before it.

## prosebook@0.5.0

### A server render links the files of the areas it reads

Under Vite, a split client's lazy locales are listed in the server build's catalog, and `createCopy`'s new `preload` is handed each file the render reads from, once: `preload: (href) => preloadModule(href, { as: 'script' })` under React, so the browser fetches German beside the route's code rather than after it.

### A split build loads a lazy locale's areas in one file per chunk

Areas the bundler puts in one chunk share a file in each lazy locale, so a route reading three areas loads German in one request, not three. Which areas share a chunk is read from the imports under `scan.dirs`, under Vite, Bun and Next alike.

### Bindings for Preact, Vue, Svelte and Solid

`prosebook/preact`, `prosebook/vue`, `prosebook/svelte` and `prosebook/solid` each give the copy to components the framework's way, update what reads a message when the locale changes, and render rich messages as the framework's own elements: Vue's `<Text>` takes tags as slots, and Svelte's as snippets.

### Strict pruning reads `.vue` and `.svelte` files

A build fails on a read whose key it can't see in a Vue template or Svelte markup as it does in a script, and `scan` finds keys there; `.vue` and `.svelte` join `scan.extensions`' defaults.

### `useCopy()` in React reads the registered catalog's keys

`useCopy().t` and the other plain reads are typed by `Register` as `rich` already was, so a misspelled key there is a type error.

### Dates in Rust, Swift and Kotlin

A `{when, date}` or `{when, time}` message now generates native code, with each format taken apart from `Intl` and checked against it as number formats are: a `Date` in Swift and a `java.time.Instant` in Kotlin, shown in the device's time zone, and in Rust a `DateTime` of the clock's fields, made with `DateTime::from_unix(seconds, offset)`.

### Apple plurals in a `.stringsdict`

The `apple` target writes a message with a plural to a `.stringsdict` beside its `.strings` table, each plural a variable with its count as `%lld`, instead of failing `generate`.

### `prosebook export`: a locale's entries as XLIFF 2.0 or JSON, for translation tools

`export <locale> [file]` writes what `todo` lists, or every entry with `--all`, with each entry's context, kind, surface and placeholders as XLIFF notes. `import` takes the tool's XLIFF or JSON back, checked as a reply is: a translation of a source that has changed since the export is left out, and a stale one given back unchanged is accepted once the tool has moved it on from `initial`.

### Every catalog file starts with its schema line

`generate` adds `# yaml-language-server: $schema=./catalog.schema.json` to a catalog file that doesn't start with it, since an editor finds the schema only through that line, and `generate --check` and `check` fail on such a file, saying why. A file that names a schema of its own on its first line keeps it.

### Splitting by area: a lazy route brings its own messages

With `prosebook({ split: true })`, the Vite, Bun and Next integrations ship each area's messages beside the code that reads them, and a lazy locale loads area by area, so a lazy route loads only its own messages and renders in the reader's language from its first frame. A key read before its area loaded is reported through `onError`.

## prosebook@0.4.0

### Android string resources from the same catalog

`native: [{ language: 'android', out: 'android/app/src/main/res', keys: ['android'] }]` makes `generate` write `values/strings.xml` and a `values-<qualifier>/strings.xml` per locale (`values-pt-rBR`, `values-b+sr+Latn`), so the manifest, shortcuts and other XML resources can name `@string/…`. Placeholders are positional (`%1$s`), a plural becomes `<plurals>`, and what Android can't hold (a select, a date, a formatted number, an exact arm such as `=0`, a tag) fails the build with the fix.

### Apple `.strings` tables, Info.plist's included

`native: [{ language: 'apple', out: 'src-tauri/Resources', keys: ['macos'], plist: 'src-tauri/Info.plist' }]` makes `generate` write `<locale>.lproj/InfoPlist.strings` per locale, so permission prompts and the app's name are translated. `macos.ns-camera-usage-description` is `NSCameraUsageDescription`, and a key the plist lacks, or plist text that differs from the source, fails the build. Without `plist`, the table is `Localizable`, with placeholders as `%1$@`.

## prosebook@0.3.0

### MF2 selects on a number as it's shown

Under `.input {$n :number minimumFractionDigits=1}`, 1 shows as "1.0" and matches `other` in English, as MF2 has it; it matched `one`. `:integer` matches the value rounded. A selector's function is written back as it was, `select=exact` included.

### `.match` selects with `:percent`, on the value times 100

### MF2 placeholders are isolated in right-to-left locales

Each is wrapped in Unicode isolation marks, so a Latin name in a Hebrew sentence can't reorder the text around it. `u:dir` picks a placeholder's direction, and `isolate` in the config sets when: `'rtl'` (the default), `'always'`, or `false`.

### A message never throws

A placeholder with no value, or one `Intl` refuses, shows as `{name}` (`{$name}` in MF2) and goes to `console.error`, or to `createCopy`'s new `onError`; it rendered nothing, or threw.

### MF2 options from arguments: `{$price :currency currency=$code}`

An option can take its value from an argument: a currency, unit, time zone, calendar, display or digit count. The argument is typed with the rest, the formatter is built once per value, and `migrate 1` stops at such a message, since MF1 can't say it.

### A `:currency` or `:unit` takes its currency or unit from the `.input` that declared its operand

`.input {$price :currency currency=EUR}` then `{$price :currency fractionDigits=0}` was refused for naming no currency; it is in euros, as MF2 has it.

### The dev inspector under Next.js and Bun

Alt-click a string to open its entry and Alt-right-click to edit it, now in `next dev` with nothing to add to the app, and under Bun's dev server with `inspector()`'s routes spread into `Bun.serve`.

### `acceptedLocales(header)`: an `Accept-Language` header read by weight, for a server's copy

`createCopy(catalog, { locale: acceptedLocales(request.headers.get('accept-language')) })` asks for the request's locales in the order its `q` values rank them, so `de;q=0.1, en;q=0.9` gets English.

### `prosebook/react/server`: `createServerCopy`, one copy per request for React Server Components

`createServerCopy(catalog, () => locales)` returns a reader every server component in a request shares: asked once for the locale, ready when it resolves, and kept per request by React's `cache`.

### `prosebook todo <locale> --prompt` and `prosebook import`: translate with any model, checked

`todo --prompt` prints a locale's missing and stale entries as a prompt: how to reply, the plural forms the locale takes, and what each kind and surface asks for. `import` reads the reply, or `todo`'s YAML filled in by hand, and writes each entry to its file once it passes the catalog's checks, leaving out the ones that fail with their fix.

### `prosebook todo` shows each entry's kind and surface

### `prosebook/next`: Next.js with Turbopack

`withProsebook(nextConfig)` generates in `next dev` and `next build`, regenerates on every catalog edit and swaps the messages in place in the browser, and prunes the build to the messages the code names, failing on a read whose key it can't see.

### `prosebook/bun`: `Bun.build` and Bun's dev server

`prosebook()` in `Bun.build`'s `plugins` prunes the build the same way; `"prosebook/bun"` in bunfig.toml's `[serve.static] plugins` regenerates on catalog edits and swaps the messages in place.

### The Vite plugin's dev hooks and inspector come in through the generated index, so frameworks that render their own HTML, such as TanStack Start, get them too

### Rust, Swift and Kotlin from the same catalog

`native: [{ language: 'rust', out: 'src-tauri/src/copy.rs', keys: ['tray'] }]` makes `generate` write an enum of the locales with a typed member per message, with CLDR's plural rules and number formats taken apart from `Intl`, so a tray, a menu bar or a CLI says what the browser says.

## prosebook@0.2.0

### `plural-count` leaves unit symbols alone: `{rate, number} kbps` is no plural

### `arm-endings` doesn't count an arm that trails off in an ellipsis, as in `Uploading # files…`

### A date skeleton's `j` is the hour as each locale writes it

`{when, date, ::yMMMdjmm}` read "Oct 28, 2026, 5"; it now reads "Oct 28, 2026, 2:05 PM", and "14:05" in German. A date field the formatter would drop, such as `J`, fails the build.

### A build fails on a read whose key it can't see

`prune` is `'strict'` by default: `t(item.key)` or `<Text id={id} />` fails the build instead of showing the key where its message was pruned. Mark a deliberate one `prosebook-ignore`, or set `prune: 'loose'`. `prune: true` is gone.

### The Vite plugin takes a `root` for apps that share one catalog

### Generated TypeScript passes `noUnusedParameters`

### Lint rules scoped by area: `on.area`, and `lint.areas` for severities per area

### A `path` rule under `strict`: `Settings › General`, with `lint.pathSeparator`

### The catalog schema offers the `key: message` shorthand only when no field is required

## prosebook@0.1.0

### A typed copy catalog: YAML entries compiled to plain functions, for React and any JavaScript

### ICU MessageFormat or MessageFormat 2, switchable per catalog, with `prosebook migrate`

### Stale translations marked from the lock, with a word diff of what changed

### `prosebook scan` and `extract` move hardcoded JSX text into the catalog

### In dev, Alt-click a string to open its entry; Alt-right-click edits it on the page

### Lint plugins, rules as data, translation linting, `lint --fix` and SARIF output
