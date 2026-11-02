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
