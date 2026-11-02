# prosebook

Every string your app shows, in one typed catalog. For React, Preact, Vue, Svelte, Solid and any JavaScript.

[Homepage](https://gkurt.com/prosebook/) · [Try it on the page](https://gkurt.com/prosebook/#in-context)

UX writers keep every string in a product in one document, the copy deck. prosebook makes that
book of your app's prose the source of truth: the words live in YAML, one entry per string, with the
context a translator needs beside them, and the code holds only keys. Changing what the app says is an edit to the
catalog, not a code change.

```yaml
# copy/catalog/cart.yaml
cart.items:
  kind: state
  surface: status
  context: Under the cart heading, counts what is in the cart.
  args:
    count: how many items are in the cart
  en: '{count, plural, =0 {Your cart is empty.} one {# item in your cart.} other {# items in your cart.}}'
```

```tsx
const { t } = useCopy();
<p>{t('cart.items', { count })}</p>; // "3 items in your cart."
```

- **Typed.** A missing key, a misspelled key or a missing argument is a type error. Completing a key
  shows its English text and context.
- **Compiled.** `prosebook generate` turns each message, in ICU MessageFormat or MessageFormat 2, into
  a plain function. The browser parses nothing: no parser ships, no `eval`, and the runtime is about
  2.5 KB gzipped.
- **Checked.** Placeholders that drift between the source and a translation fail the build. A
  translation whose source has changed since is marked stale, automatically.
- **Pruned.** A Vite, Next.js or Bun build ships only the messages the code names, and fails on a
  read whose key it can't see rather than show a key where a message was.
- **Written well.** An optional lint holds the words to a writing guide: word budgets per kind of
  string, periods, sentence case, banned filler, and `{count} files` outside a plural. Plugins add your
  own rules, scoped by kind, surface and locale, and translations are held to their source.
- **Native too.** The same catalog generates Rust, Swift and Kotlin for a tray, a menu bar or a CLI,
  with plurals, numbers and dates that say what the browser says, and the string resources Android and Apple read.

## Quick start

```bash
bun add prosebook
```

```bash
bunx prosebook init
```

`init` writes `prosebook.config.ts` and `copy/catalog/app.yaml`. Then:

```bash
bunx prosebook generate
```

This writes `src/copy/`: one module per locale and an `index.ts` with the types. With Vite, add the
plugin instead and generation happens on start and on every catalog edit, and the page shows the new
text without reloading, in the locale and state it was in:

```ts
// vite.config.ts
import { prosebook } from 'prosebook/vite';

export default defineConfig({ plugins: [react(), prosebook()] });
```

Several apps that share one catalog each point the plugin at it: `prosebook({ root: '../../packages/copy' })`
reads the config there and resolves its paths from there, so every app generates the same files.

### With Next.js

```ts
// next.config.ts
import { withProsebook } from 'prosebook/next';

export default withProsebook({/* the rest of your Next config */});
```

`next dev` and `next build` generate first, and dev regenerates on every catalog edit: server
components read the new text on their next render, and in the browser the messages change in
place. A build ships only the messages the code names. It works with Turbopack, Next's default
bundler, which doesn't resolve `./en.js` to `en.ts`, so set `importExtension: ''` in the prosebook
config. In dev the [inspector](#finding-a-strings-entry) comes with it, with nothing to add to the app.

### With Bun

`Bun.serve`'s dev server bundles a page with the plugins bunfig.toml names, and regenerates and
swaps the messages in place with this one:

```toml
# bunfig.toml
[serve.static]
plugins = ["prosebook/bun"]
```

In dev the page gets the [inspector](#finding-a-strings-entry) too. Its endpoints are routes for
`Bun.serve` to spread into its own, imported only in dev:

```ts
// src/server.ts
const dev = process.env.NODE_ENV !== 'production';

Bun.serve({
  routes: { ...(dev ? (await import('prosebook/bun')).inspector() : {}), '/': index },
  development: dev && { hmr: true },
});
```

The `bun build` command reads no plugins, so a build that prunes calls `Bun.build`, with
`prosebook/bun` left `external` so the dev-only routes stay out of the bundle:

```ts
// build.ts
import { prosebook } from 'prosebook/bun';

await Bun.build({
  entrypoints: ['./src/server.ts'],
  target: 'bun',
  outdir: './dist',
  external: ['prosebook/bun'],
  plugins: [prosebook()],
});
```

TanStack Start, React Router and other frameworks built on Vite take the Vite plugin as it is.

### In React

```tsx
import { createCopy, preferredLocales } from 'prosebook';
import { CopyProvider, Text, useCopy } from 'prosebook/react';
import { catalog } from './copy';

const copy = createCopy(catalog, { locale: preferredLocales() });

root.render(
  <CopyProvider copy={copy} tags={{ link: (chunks) => <a href="/terms">{chunks}</a> }}>
    <App />
  </CopyProvider>,
);

function Cart({ count }: { count: number }) {
  const copy = useCopy(); // re-renders when the locale changes
  return (
    <>
      <h2>{copy.t('cart.title')}</h2>
      <Text id="cart.items" values={{ count }} />
      <p>{copy.rich('cart.terms')}</p>
      <button onClick={() => copy.setLocale('de')}>Deutsch</button>
    </>
  );
}
```

### In Preact

`prosebook/preact` is the React binding for Preact, written on `preact/hooks`, so it needs no
`preact/compat`: `CopyProvider`, `useCopy`, `useLocale` and `Text`, used as above.

```tsx
import { CopyProvider, Text, useCopy } from 'prosebook/preact';
```

### In Vue

Install the copy as a plugin, or give a subtree its own with `provideCopy(copy)` in `setup`. What
`useCopy()` returns reads through a ref, so a template or `computed` that reads a message runs again
when the locale changes. `rich` returns a `VNode`; in a template, `<Text>` renders a message and takes
each tag as a slot of the same name, which gets what the tag wraps as `chunks`:

```ts
// main.ts
import { copyPlugin } from 'prosebook/vue';

createApp(App)
  .use(copyPlugin(copy, { tags: { link: (chunks) => h('a', { href: '/terms' }, chunks) } }))
  .mount('#app');
```

```vue
<script setup lang="ts">
import { Text, useCopy } from 'prosebook/vue';
import { ref } from 'vue';

const copy = useCopy();
const count = ref(2);
</script>

<template>
  <h2>{{ copy.t('cart.title') }}</h2>
  <Text id="cart.items" :values="{ count }" />
  <Text id="cart.terms">
    <template #link="{ chunks }"
      ><RouterLink to="/terms"><component :is="chunks" /></RouterLink
    ></template>
  </Text>
  <button @click="copy.setLocale('de')">Deutsch</button>
</template>
```

Templates are typed with `vue-tsc`, which runs on TypeScript 6 until TypeScript 7 ships its API.

### In Svelte

`setCopy(copy)` in a component gives it and everything below it the copy; `getCopy()` reads it. Its
reads are reactive, so markup, `$derived` and effects that read a message run again when the locale
changes. Tags render through snippets: give `<Text>` one of the same name, or `setCopy` one for every
message. A snippet gets what its tag wraps as `chunks`, which `<Text {chunks} />` renders:

```svelte
<!-- App.svelte -->
<script lang="ts">
  import { setCopy, Text, type RichPart } from 'prosebook/svelte';

  let { copy } = $props();
  setCopy(copy, { tags: { link } });
</script>

{#snippet link(chunks: RichPart[])}<a href="/terms"><Text {chunks} /></a>{/snippet}
```

```svelte
<!-- Cart.svelte -->
<script lang="ts">
  import { getCopy, Text } from 'prosebook/svelte';

  const copy = getCopy();
  let count = $state(2);
</script>

<h2>{copy.t('cart.title')}</h2>
<Text id="cart.items" values={{ count }} />
<Text id="cart.terms" />
<button onclick={() => copy.setLocale('de')}>Deutsch</button>
```

`Text` ships as a `.svelte` file for your Svelte compiler to build, so it needs Svelte 5 and its Vite
plugin (or SvelteKit). `svelte-check` types it, and runs on TypeScript 6 for now.

### In Solid

Each read tracks a signal the copy sets, so what reads a message updates in place when the locale
changes, and components never run again. `rich` returns your tag renderers' elements beside the text.

```tsx
import { CopyProvider, Text, useCopy } from 'prosebook/solid';

render(
  () => (
    <CopyProvider copy={copy} tags={{ link: (chunks) => <a href="/terms">{chunks}</a> }}>
      <Cart />
    </CopyProvider>
  ),
  root,
);

function Cart() {
  const copy = useCopy();
  const [count, setCount] = createSignal(2);
  return (
    <>
      <h2>{copy.t('cart.title')}</h2>
      <Text id="cart.items" values={{ count: count() }} />
      <p>{copy.rich('cart.terms')}</p>
    </>
  );
}
```

### In plain JavaScript

```js
import { createCopy } from 'prosebook';
import { catalog } from './copy/index.js';

const copy = createCopy(catalog, { locale: navigator.languages });
await copy.ready;
document.title = copy.t('app.title');
copy.subscribe(() => render()); // after a locale switch, and in dev after a catalog edit
```

Set `language: 'js'` in the config to generate `.js` modules with a `.d.ts` beside the index, or
`importExtension: '.ts'` to run the generated TypeScript in Node as it is.

A message never throws. A placeholder with no value, or with one `Intl` refuses (an invalid date,
`currency: 'euro'`), shows as `{name}` (`{$name}` in MF2), and the rest of the message renders. The
problem goes to `console.error`, or to `onError` if you pass one:

```js
createCopy(catalog, { onError: (error, key, locale) => report(error, { key, locale }) });
```

### On a server

Create one `copy` per request, in the locale it asks for, and wait for its messages.
`acceptedLocales` reads an `Accept-Language` header into the locales it asks for, by weight, so
`de;q=0.1, en;q=0.9` asks for English first:

```ts
import { acceptedLocales, createCopy } from 'prosebook';

const copy = createCopy(catalog, { locale: acceptedLocales(request.headers.get('accept-language')) });
await copy.ready;
```

**React Server Components** can't read context, so `prosebook/react/server` hands each request one
copy that every server component in it shares. Your function is asked for the locale once per
request, and React's `cache` keeps one request's copy from reaching another's:

```ts
// server-copy.ts, here with Next.js
import { cookies, headers } from 'next/headers';
import { acceptedLocales } from 'prosebook';
import { createServerCopy } from 'prosebook/react/server';

export const serverCopy = createServerCopy(catalog, async () => {
  const picked = (await cookies()).get('locale')?.value;
  const asked = acceptedLocales((await headers()).get('accept-language'));
  return picked === undefined ? asked : [picked, ...asked];
});
```

```tsx
export default async function Page() {
  const { t, locale } = await serverCopy(); // ready, in the locale negotiated for the request
  return <h1 lang={locale}>{t('app.title')}</h1>;
}
```

It's its own entry because `prosebook/react` creates a context when it loads, which the server
build of React refuses. It needs React 19, where `cache` is.

A page rendered on the server must hydrate in the same locale, so the browser's copy waits for its
messages too. Create it above a `<Suspense>` boundary and wait below it: a component that suspends
before it first mounts loses its state, copy included.

```tsx
function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [copy] = useState(() => createCopy(catalog, { locale }));
  return (
    <Suspense>
      <Ready copy={copy}>{children}</Ready>
    </Suspense>
  );
}

function Ready({ copy, children }: { copy: Copy; children: ReactNode }) {
  use(copy.ready);
  return <CopyProvider copy={copy}>{children}</CopyProvider>;
}
```

### Outside the browser: Rust, Swift, Kotlin, Android and Apple

The parts of an app the browser doesn't draw, a tray, a menu bar, a CLI, an Android shell, can read
the same catalog. `generate` writes one file per target in `native`, holding every locale:

```ts
// prosebook.config.ts
export default defineConfig({
  native: [
    { language: 'rust', out: 'src-tauri/src/copy.rs', keys: ['tray', 'menu'] },
    { language: 'swift', out: 'mac/Sources/Copy.swift' },
    { language: 'kotlin', out: 'android/app/src/main/java/shop/Copy.kt', package: 'shop' },
  ],
});
```

Each is an enum of the locales with a member per message, named for its key (`tray.recordings` is
`tray_recordings` in Rust, `trayRecordings` in Swift and Kotlin). `keys` takes only the keys under
those prefixes and names them without the prefix, so `tray.quit` above is `quit`:

```rust
mod copy;
use copy::Locale;

let copy = Locale::negotiate(&["de-AT", "en"]); // de-AT, then de, then the source
let quit: &'static str = copy.quit();
let count = copy.recordings(3); // "3 Aufnahmen": any integer or float
```

```swift
let copy = Copy.negotiate(Locale.preferredLanguages)
menu.title = copy.trayQuit
label.stringValue = copy.trayRecordings(count: 3)
```

```kotlin
val copy = Copy.negotiate(listOf(Locale.getDefault().toLanguageTag()))
item.title = copy.trayQuit
label.text = copy.trayRecordings(3)
```

A message with no placeholders is a `&'static str` in Rust and a property in Swift and Kotlin; one
with placeholders is a function taking them in order, a string or a number of any integer or float type. Each member's doc comment
is the source text, its context and what each argument holds.

A date is a `Date` in Swift and a `java.time.Instant` in Kotlin, shown in the device's time zone. Rust's
standard library has no time zones, so its file brings a `DateTime` holding the clock's fields, made
from a moment and the offset it is shown at:

```rust
let printed = copy::DateTime::from_unix(seconds, offset); // offset in seconds east of UTC
copy.printed(printed); // "Printed Jan 5, 2026 at 2:05 PM."
```

The files need nothing beside them: each brings the plural rules of its locales, compiled from CLDR's
(the data `Intl.PluralRules` is built on), and its number and date formats, taken apart from `Intl`
when it is generated: the digits, the separators, how integers group, the text around a currency or a
percent; the order of a date's fields, the month and weekday names, AM and PM or the locale's periods
of the day, and its clock. Each format is checked against `Intl` before any code is written, so native
code writes what the browser does, Arabic digits and Indian grouping included. A key with no
translation falls back through its parents to the source as the runtime's do, resolved when the file
is written.

What can't be written that way fails `generate`, with the fix: a tag, compact notation, significant
digits, a unit or currency name that changes with the count (`unitDisplay: 'long'`), a date with its
time zone's name (`{when, time, full}`) or a time zone of its own, a locale that counts in another
calendar than the Gregorian (Thai's Buddhist, Persian), and an MF2 option read from an argument. Leave
such keys out of the target's `keys`.

#### Android resources

An Android app needs string resources even with the Kotlin target: its manifest, launcher shortcuts,
an accessibility service's description and every other XML resource name strings as `@string/…`, and
only a resource answers that. The `android` target writes them, with `out` naming the `res` folder:

```ts
native: [{ language: 'android', out: 'android/app/src/main/res', keys: ['android'] }],
```

`values/strings.xml` holds the source locale, and each other locale gets a folder named as Android
names it (`values-de`, `values-pt-rBR`, `values-b+sr+Latn` for a script), holding what that locale
shows, every fallback resolved. `name` renames the file, `strings` by default, so it can sit beside
strings you write yourself. A resource is named for its key, less the prefix, with `.` and `-` as
`_`: `android.sign-in.denied` is `R.string.sign_in_denied`. Above each is a comment with its context
and what each argument holds.

```xml
<!-- Counts the cart. count: how many items the cart holds. -->
<plurals name="cart_items">
    <item quantity="one">%1$d item in the cart.</item>
    <item quantity="other">%1$d items in the cart.</item>
</plurals>
<!-- Greets the person signed in. firstName: the person's first name. -->
<string name="hello">Hello, %1$s!</string>
```

Android fills placeholders in with `String.format` and picks a plural's arm itself, so a resource
holds less than the other targets: text, plain `{name}` placeholders, written `%1$s` by their place in
the source so a translation can reorder them, and one plural, which becomes `<plurals>` with its count
as `%1$d` (the text around it goes into each arm). Call it as Android does,
`resources.getQuantityString(R.plurals.cart_items, count, count)`. `String.format` isn't `Intl`, so
nothing here is checked against it: `%d` writes 1234 without grouping. Android picks the arm by the
device's language, so a plural a locale doesn't translate picks among the source's arms by that
language's rules. Escaping is done for you: quotes, apostrophes, `\`, `&`, `<`, a newline, a leading
`@` or `?`, `%` where the string is formatted, and spaces Android would collapse or trim.

What a resource can't hold fails `generate`, with the fix: a select, a date, a formatted number, a
second plural, an ordinal, an offset, an exact arm such as `=0` (Android's `zero` is a category, which
English never picks), a selector other than a bare `:number` or `:integer`, and a tag.

#### Apple string tables

An Apple app has the same gap: macOS and iOS read the permission prompts, the app's name and other
Info.plist strings from the bundle, never from Swift. The `apple` target writes `.strings` tables, a
`<locale>.lproj/<name>.strings` per locale under `out`, each holding what that locale shows. They are
plain `.strings` files, not a String Catalog, which only Xcode compiles: an app bundled by Tauri or a
script copies the `.lproj` folders into `Contents/Resources` as they are.

With `plist`, the table is `InfoPlist` and translates that Info.plist. A catalog key can't be written
`NSCameraUsageDescription`, so its words spell the plist key: `macos.ns-camera-usage-description` is
`NSCameraUsageDescription`. The key must be in the plist, since the system reads only the keys there,
and the plist's own text must be the source's, since it shows where no `.lproj` matches. Either way
round, `generate` fails with the fix:

```ts
native: [{ language: 'apple', out: 'src-tauri/Resources', keys: ['macos'], plist: 'src-tauri/Info.plist' }],
```

```c
/* Asks for the camera. */
"NSCameraUsageDescription" = "Corner Shop scans a product's barcode with the camera.";
```

Without `plist`, the table is `Localizable`, for what the system looks up by key, such as a push
notification's `loc-key`. An entry is named for its key less the prefix, as written (`tray.quit` is
`"quit"` under `['tray']`), and placeholders are written `%1$@` by their place in the source, filled
in by `String(format:)`, not `Intl`. A table holds text and plain `{name}` placeholders.

A message with a plural goes into a `.stringsdict` of the same name beside the table, where the
system looks first. Each plural is a variable in its format, so the text around it stays where it is
and a message can hold two; its count is `%N$lld`, for an `Int`, and the system picks the arm by its
own CLDR rules:

```xml
<key>items</key>
<dict>
    <key>NSStringLocalizedFormatKey</key>
    <string>%1$@ has %2$#@count@ in the cart.</string>
    <key>count</key>
    <dict>
        <key>NSStringFormatSpecTypeKey</key>
        <string>NSStringPluralRuleType</string>
        <key>NSStringFormatValueTypeKey</key>
        <string>lld</string>
        <key>one</key>
        <string>%2$lld item</string>
        <key>other</key>
        <string>%2$lld items</string>
    </dict>
</dict>
```

A plural there is cardinal, on a bare count, with no offset and no exact arm such as `=0`, as on
Android; a select, a date, a formatted number, a tag and a plural inside another fail `generate`, and
an Info.plist string takes no placeholders at all. Show those from the Swift target.

## The catalog

One file per area, `copy/catalog/<area>.yaml`. A key's first segment names its file, so
`cart.items` lives in `cart.yaml` and nowhere else; searching for a key finds its entry.

| Field      |                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `en`       | The message, in ICU MessageFormat or MessageFormat 2. The field is named after `source` in the config.   |
| `context`  | One sentence telling a translator where the string appears. Required by default.                         |
| `args`     | What each placeholder holds, one line each. Required for every placeholder when `context` is.            |
| `kind`     | What sort of string it is: `name`, `action`, `description`, `state`. The lint holds each to its budget.  |
| `surface`  | Where it sits: `label`, `heading`, `tooltip`, `error`, `empty`, `hint`, ...                              |
| `fragment` | `true` where it completes something beside it, so sentence rules don't apply.                            |
| `allow`    | Lint rules the entry is exempt from, each with the reason.                                               |
| `comment`  | A change asked of whoever edits the entry next. A warning until it is made and the comment deleted.      |
| `remove`   | `true` asks for the entry to go, with its translations and the code that reads it. A warning until then. |

`key: message` is the shorthand for an entry with nothing to say about itself (set `require: []`;
the schema offers it only then).
Kinds and surfaces are configurable; `prosebook generate` writes `catalog.schema.json` beside the
catalog, so an editor with the YAML language server completes and explains every field:

```yaml
# yaml-language-server: $schema=./catalog.schema.json
```

That line is how the editor finds the schema, so `generate` starts each catalog file with it, and
`generate --check` (and `check`) fails on a file without it. A file that names a schema of its own on
its first line keeps it.

### Messages

ICU MessageFormat, checked at build time:

```yaml
en: 'Hello, {name}.' # name: string
en: '{n, plural, =0 {No files} one {# file} other {# files}}' # n: number
en: '{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}'
en: '{mode, select, dark {Dark} other {Light}}' # mode: 'dark' | (string & {})
en: '{size, number, ::.0 unit/megabyte}' # 1.4 MB
en: '{total, number, ::currency/EUR}' # €9.00
en: '{when, date, medium} at {when, time, short}' # Oct 28, 2026 at 2:05 PM
en: '{when, date, ::yMMMdjmm}' # Oct 28, 2026, 2:05 PM; 28. Okt. 2026, 14:05 in German
en: 'By checking out you agree to our <link>terms</link>.' # a tag: an element inside the sentence
```

A placeholder holds a number, a name or something a person typed, never a translated fragment: a
word that changes with the sentence belongs in a `plural` or `select` arm. A skeleton's `j` is the
hour as each locale writes it, 12 or 24. A skeleton the formatter would silently drop
(`::compact-shortt`, a date's `J`) fails the build instead of reaching the screen unformatted.

**Tags** keep a sentence with a link or bold run inside it as one entry, so a translator can move the
element. `t()` renders a tag as its text; `rich()` and `<Text>` render it through a function. Tags
the provider renders by default don't have to be passed at each call. Tell the types which ones those
are:

```ts
declare module 'prosebook' {
  interface Register {
    tags: 'link' | 'b';
  }
}
```

### MessageFormat 2

Set `messageFormat: 2` and the catalog and its translations are written in
[Unicode MessageFormat 2](https://messageformat.unicode.org) instead. Everything past reading is the
same: the types, the checks, the lint, the pseudo-locale and the compiled functions, so the runtime
doesn't change and nothing extra ships.

```yaml
en: 'Hello, {$name}.' # name: string
en: 'Total: {$total :currency currency=EUR}' # €9.00
en: '{$size :unit unit=megabyte maximumFractionDigits=1}' # 1.4 MB
en: '{$when :datetime dateLength=long}' # October 28, 2026 at 2:05 PM
en: 'By checking out you agree to our {#link}terms{/link}.' # a tag
en: |-
  .input {$n :number}
  .match $n
  0 {{No files}}
  one {{{$n} file}}
  * {{{$n} files}}
en: |-
  .input {$mode :string}
  .match $mode
  dark {{Dark}}
  * {{Light}}
```

A message with `.match` holds whole sentences per variant, so a translator never stitches a sentence
from an arm and the text around it. Several selectors pick the variant MF2's rules pick: the best
match on the first, then the next, an exact number beating its plural category. A number is matched
as it's shown: under `.input {$n :number minimumFractionDigits=1}`, 1 shows as "1.0", which English
counts as `other`. `:integer` matches the value rounded, and `:percent` matches it times 100.
`:offset` covers MF1's plural offset.

The functions are MF2's defaults: `:string`, `:number`, `:integer`, `:percent`, `:currency`, `:unit`,
`:offset`, and the date and time functions `:date`, `:time` and `:datetime`, which are still a draft
in the spec and follow it as the `messageformat` package does. `.match` selects with `:number`,
`:integer`, `:percent` or `:string`.

**Text direction.** In a locale written right to left, each placeholder is wrapped in Unicode
isolation marks, so a value written the other way can't reorder the text around it. Without them, a
Latin name in a Hebrew sentence can pull the punctuation after it to the wrong side. `u:dir` on an
expression picks its direction (`{$name :string u:dir=ltr}`) and asks for isolation in any locale.
`isolate: 'always'` in the config also isolates every string placeholder in left-to-right locales,
as the spec's default does. `isolate: false` turns it off.

**Options from arguments.** An option can take its value from an argument, so one message formats
whatever currency the order is in:

```yaml
en: 'Total: {$price :currency currency=$code}' # t('cart.total', { price: 9, code: 'USD' }): $9.00
en: 'Due {$when :time timeZone=$tz}'
```

The argument is typed with the rest (`code: string`; `currencyDisplay=$d` takes only the values the
option does), and a translation must use it too. These options can come from an argument: `currency`,
`currencyDisplay`, `currencySign`, `unit`, `unitDisplay`, `signDisplay`, `fractionDigits` and the
other digit counts, `timeZone` and `calendar`. The rest, such as a date's `fields` or a number's
`select`, decide what the formatter is, so they're written in the message and the message says so.
Literal options are still settled at build time. The ones from arguments are merged in as the
message renders, and each locale keeps one formatter per distinct value. A value `Intl` refuses,
such as `code: 'euro'`, throws a `RangeError` there. MF1 has no way to say this, so `migrate 1`
stops at such a message.

**Switching.** `prosebook migrate 2` rewrites the catalog and every translation in MF2, and
`prosebook migrate 1` goes back. It's a dry run unless `--write`; then set `messageFormat` in the
config. Before writing, it renders each message both ways over sample values and reports any that
would come out different, such as German's medium date, numeric in MF1 and spelled out in MF2's
nearest. A message the other syntax can't say (`::compact-short` has no MF2 word) stops the write
and is named, so nothing changes until it's resolved. `prosebook extract` writes new entries in
whichever syntax the catalog uses.

## Translations

`copy/locales/<locale>/<area>.yaml` (or one `copy/locales/<locale>.yaml`) holds only
`key: translation`. The metadata stays in the catalog, so a translator merges against nothing.

```yaml
# copy/locales/de/cart.yaml
cart.items: '{count, plural, =0 {Dein Warenkorb ist leer.} other {# Artikel im Warenkorb.}}'
```

A key a locale leaves out falls back, key by key, through its parents (`pt-BR` → `pt`) to the
source, and the fallback is formatted in its own locale. A translation whose placeholders or tags
differ from the source fails the build.

**Stale translations.** `copy/lock.json` records which source text each translation was made from.
Edit an English message and its translations are stale until someone edits them, or confirms they
still hold:

```bash
prosebook status            # coverage and stale counts per locale
prosebook todo de > de.yaml # missing and stale entries, with context, ready to translate
prosebook import de de.yaml # each filled-in entry into its file, checked first
prosebook accept de cart.items
```

The lock also keeps the text each translation was made from, so a translator sees what changed,
in the notation of `git diff --word-diff`:

```text
$ prosebook status --verbose
de           13/14  92%        1      2
  stale   cart.add: Add {+one +}to cart
  stale   cart.checkout: [-Check out-]{+Pay now+}

$ prosebook todo de
# The button on a product that adds one to the cart.
# kind: action, surface: action
# en: Add one to cart
# stale, the source changed: Add {+one +}to cart
cart.add: In den Warenkorb
```

Stale translations still show by default; `stale: 'fallback'` shows the source instead.

**Translating with a model.** prosebook calls no model itself. `prosebook todo de --prompt` prints
the same entries as a prompt for whichever model you use: how to reply, the plural forms German
takes, what each kind of string and surface asks for, and how to treat a stale entry. Hand it to the
model and give its reply to `import`, as a file or on stdin:

```bash
prosebook todo de --prompt | pbcopy  # paste into a chat, or hand it to an agent
prosebook import de reply.md         # the YAML block is read out of the reply
```

`import` checks every entry as the whole catalog before writing it. One whose placeholders, tags
or syntax don't hold is left out with its fix, which you can give back to the model, and the rest
are written. A stale translation given back unchanged is accepted as still right. The imported
translations are then linted, as a person's would be. An agent working in the repository needs none
of this: it can read `prosebook todo de`, write the translation files itself, and run
`prosebook check`.

**Translation tools.** `prosebook export` writes the same entries for a translation tool, as XLIFF
2.0 or JSON by the file's extension (`--format xliff|json` on stdout), and `import` takes the tool's
file back as it takes a reply:

```bash
prosebook export de de.xlf        # what todo lists; --all for every entry
prosebook export en en.json       # the source, every entry, for a tool that translates JSON
prosebook import de de.xlf        # or de.json, flat or nested by key
```

In XLIFF, each entry is a unit named for its key, in a file per area, with its context, kind, surface,
what each placeholder holds and, for a stale one, the word diff as notes. A message travels as its
ICU or MF2 text, which tools that take these formats read, not as XLIFF's inline codes: a target that
comes back with a `<ph>` is left out with the fix. A missing translation goes out `initial`, a stale
one `initial` with its translation, and a current one `translated`. A stale translation given back
unchanged is accepted only once the tool has moved it on from `initial`, since only then has someone
looked at it. Each unit carries its source as exported, so a translation of a source that has changed
since is left out until it is exported again. JSON is `key: text` in the locale, empty where it has
none, and carries no context: give the tool the XLIFF where it reads both.

**Pseudo-locale.** `pseudo: 'en-XA'` generates `⟦Ýóóúúŕ çááŕţ⟧` from the source. Switch to it and
any plain text on screen is hardcoded, a missing bracket is clipped text, and brackets inside
brackets are a sentence spliced from fragments.

## Checks

```bash
prosebook lint     # the words against the writing rules (--fix writes the fixes they offer)
prosebook scan     # hardcoded text in JSX, and catalog keys no code reads
prosebook extract  # move that text into the catalog (see below)
prosebook migrate  # rewrite the catalog in ICU MessageFormat (1) or MessageFormat 2
prosebook check    # generate --check, lint and status --strict, for CI
```

**Lint.** `recommended` checks shape: word budgets per kind, periods, bare names, whitespace. It
reads the message format too:

| Rule                | Catches                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `plural-count`      | `{count} files` outside a plural, which reads "1 files" (English)                         |
| `plural-one`        | a `one` arm that says what `other` says, or writes `1` where `#` belongs                  |
| `arm-endings`       | plural or select arms where some end with a stop and some don't                           |
| `formatted-by-hand` | `${price}` or `{rate}%` typed around a placeholder, and digits grouped by hand (`10,000`) |
| `source-ending`     | a translation that ends with a stop where its source doesn't, or the other way round      |

Translations are linted too, by the rules that hold in any language: `whitespace`, `ellipsis`,
`arm-endings`, `formatted-by-hand`, `source-ending`, and `plural-one`'s `#` (not its `one`
and `other` saying the same, which Turkish does: `# dosya`). The rest read the source only. A
finding names the translation's file.

A finding points at the words it is about, `file:line:column`, when the message is written in the
file as it reads (plain, or quoted on one line); otherwise at the entry's key. Spellings, the one word
per concept, contractions, `…` and doubled spaces are marked `(fixable)`: `prosebook lint --fix`
writes them, in the case of the words they replace, wherever in the message they stand. Every fix is
checked as the whole catalog first, and nothing is written if any would break it. Only the message
changes: a `key: message` entry stays one, and quoting and comments elsewhere stay as they were.

`strict` adds sentence case, contractions, em-dashes, `…`, American spelling, paths written with one
separator (`Settings › General`, not `→` or `>`; set `pathSeparator`) and a list of filler and
marketing words. Add your own `banned`, `spelling` and `concepts` (one word per concept:
`{ tablet: 'device' }`), and `properNouns` for sentence case. Where a rule is wrong about an
entry, say why:

```yaml
legal.privacy:
  kind: name
  context: Links to the privacy policy.
  allow:
    sentence-case: The title of a legal document, which keeps its published capitals.
  en: Privacy Policy
```

A reason that is a shrug (`Intentional.`) fails, and so does an exemption the entry no longer needs.
An exemption covers the entry in every locale, and is needed while any of them needs it.

Where a rule is wrong about a whole area, set its severity there. A key's first segment is its area:

```ts
lint: { areas: { native: { 'sentence-case': 'off' } } }, // menu bars and trays write Title Case
```

**Lint plugins.** A plugin's rules are named `<plugin>/<rule>` in `lint.rules` and `allow`. A rule
is given the entry and its readings: `primary` takes every `other` arm, `variants` holds one reading
per plural or select arm, and `skeleton` only the words every arm carries. Placeholders and verbatim
tags (`code`, `kbd`, ...) read as `HOLE`. `on` limits a rule to kinds, surfaces or areas, and says which
locales it reads: the source when unset, `'all'`, or a list of languages (`['de']` covers `de-CH`).
A rule is then given the `locale`, that locale's `ast` and `text`, and the `source` readings to
compare with. `recommended` is its severity under that preset (off when unset), `strict` under
strict (`error` when unset).

```ts
import { defineConfig, definePlugin, words } from 'prosebook/config';

const house = definePlugin({
  name: 'house',
  rules: {
    'error-says-what-to-do': {
      description: 'An error says what failed and what to do next.',
      on: { surface: ['error'] },
      recommended: 'warn',
      check: ({ text }) => (words(text.primary).length < 4 ? ['say what to do next, not only what failed'] : []),
    },
  },
});

export default defineConfig({ lint: { plugins: [house], rules: { 'house/error-says-what-to-do': 'error' } } });
```

`words`, `sentences` and `phrase` are the helpers the core rules count and match with. A rule can
return `{ message, match, fix }` instead of a string: `match` is the words as a reading has them,
which the finding then points at, and `fix` what `--fix` writes in their place. Data rules do this
themselves: `existence` and `capitalization` point at what they found, and `substitution` fixes it.

A rule can also be data, after [Vale](https://vale.sh)'s rule types, which a `prosebook.config.json`
can carry. Words are matched whole and in any case; a pattern is a regular expression (`u` flag,
`ignoreCase` to add `i`). Words and patterns are looked for in every plural and select arm; counts
and case read the `other` arms. A message names what was found with `{match}`.

| `type`           | Fields                                                                 | Fails when                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `existence`      | `words`, `patterns`, `message`                                         | the string says one of them                                                                                                                                            |
| `substitution`   | `swap: { word: use }`, `message` (`{use}`)                             | the string says a word the product writes another way                                                                                                                  |
| `occurrence`     | `count` (`words`, `sentences`, `characters`), `max`, `min`, `relative` | the count is out of bounds (`{count}`); placeholders count as words, not characters. With `relative`, `max` and `min` are multiples of the source's count (`{source}`) |
| `capitalization` | `case` (`sentence`, `title`, `lower`, `upper`), `exceptions`           | a word is out of case; `lint.properNouns` keep theirs too                                                                                                              |
| `conditional`    | `when`, `require`, `message`                                           | the string matches `when` (or `when` is unset) but not `require`                                                                                                       |

```json
{
  "lint": {
    "plugins": [
      {
        "name": "house",
        "rules": {
          "toast-budget": {
            "type": "occurrence",
            "description": "A toast is read in passing.",
            "on": { "surface": ["toast"] },
            "count": "characters",
            "max": 40,
            "recommended": "warn"
          },
          "button-growth": {
            "type": "occurrence",
            "description": "A translated button is half again as long as the source at most.",
            "on": { "surface": ["action"], "locale": "all" },
            "count": "characters",
            "max": 1.5,
            "relative": true,
            "recommended": "warn"
          },
          "sign-in": { "type": "substitution", "description": "One verb for signing in.", "swap": { "log in": "sign in" } }
        }
      }
    ]
  }
}
```

Every rule is checked when the config loads: a name in `lint.rules` that no rule has, a plugin
added twice, a pattern that is not a regular expression, or a rule missing what its type needs.

**Scan** reports JSX text and readable attributes (`title`, `alt`, `placeholder`, `aria-label`, ...)
written as literals, and catalog keys no code names. Mark a deliberate literal with
`prosebook-ignore` on its line or the line above.

**SARIF.** `lint`, `scan`, `status` and `check` take `--format sarif` and write a
[SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) log to stdout for
code scanning; the usual text goes to stderr and the exit code is the same. Each result points at
the line it is about: the entry in the catalog or translation file, or the JSX for hardcoded text.
Lint results carry the rule's name and description; the other checks are `catalog`, `out-of-date`,
`missing-translation`, `stale-translation`, `hardcoded-text` and `unused-key`. In GitHub Actions:

```yaml
- run: npx prosebook check --format sarif > prosebook.sarif
- uses: github/codeql-action/upload-sarif@v4
  if: always()
  with:
    sarif_file: prosebook.sarif
    category: prosebook
```

Paths are relative to the project root, which the log names as `%SRCROOT%`, so a project in a
subfolder of its repository resolves too. `scan` writes a log of its own; upload it with its own
`category`.

## Extracting hardcoded text

`prosebook extract` moves what `scan` finds into the catalog and rewrites the code to read it. It
prints the plan by default and changes nothing until you pass `--write`:

```bash
prosebook extract                     # every .tsx/.jsx under scan.dirs
prosebook extract src/Cart.tsx --write
prosebook extract src/settings --area settings --write
```

It extracts whole sentences, not fragments. The text, simple expressions and inline elements
(`a`, `b`, `strong`, `em`, `span`, `*Link`, ...) that sit together in one element become one
message, so a translator can reorder all of it:

```tsx
// before
<p>
  Hi {user.name}, read the <a href="/terms">terms of <b>sale</b></a>.
</p>
<input placeholder="Search items" />

// after
<p>
  <Text id="profile.hi-read-the-terms" values={{ name: user.name, a: (chunks) => <a href="/terms">{chunks}</a>, b: (chunks) => <b>{chunks}</b> }} />
</p>
<input placeholder={t("profile.search-items-placeholder")} />
```

```yaml
# TODO(prosebook extract): check the key, kind and context.
profile.hi-read-the-terms:
  context: In Profile, the text of a <p>.
  args:
    name: 'TODO: what `user.name` holds'
  en: Hi {name}, read the <a>terms of <b>sale</b></a>.
```

- Text becomes `<Text>`, which needs no hook, so it works in class components and in callbacks too.
  A readable attribute becomes `t('…')`. extract adds `const { t } = useCopy()` to the component,
  joins an existing `useCopy()` call, or uses `copy.t` where the component already binds a `t` of its
  own. It adds the imports too.
- The area is the file's name in kebab case (`CartPanel.tsx` → `cart-panel`), or its folder's for an
  `index`; `--area` overrides it. The key adds the message's first words, and a suffix for an
  attribute (`-placeholder`, `-tooltip`, `-aria`). Text identical to an entry already in the area
  reuses that key.
- `kind` and `surface` come from the element where it's clear (`<button>` → action, `<h2>` →
  heading, `placeholder` → placeholder). `context` names the component and the element.
- Whitespace renders exactly as before. Code-like tokens (`form.json()`, `src/index.ts`), text in
  `<code>` and `<pre>`, and lines marked `prosebook-ignore` stay where they are.

**Typed placeholders.** extract asks the project's TypeScript (7 or later, found through the nearest
`tsconfig.json`) what each expression holds:

| The value is                                   | The placeholder becomes                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| text                                           | `{name}`                                                                |
| a number                                       | `{count, number}`, so it's formatted for the locale (`1,234`, `1.234`)  |
| a number followed by a plural noun, in English | `{count, plural, one {# file} other {# files}}`                         |
| a `Date`                                       | `{when, date, medium}`                                                  |
| markup (`ReactNode`, elements)                 | nothing: the sentence is left as it is, with a warning to make it a tag |

Without TypeScript (a JavaScript project, a file outside any tsconfig) the syntax decides where it can:
`items.length`, arithmetic and number literals are numbers, `new Date()` is a date. The report says
which of the two it used.

Every new entry is marked `TODO(prosebook extract)`. The key is a suggestion: rename it to say what
the string is for, then fill in the context a translator needs. Check a drafted plural's arms too:
the singular is the plural less its `s`, `es` or `ies`.

## Pruning

The Vite plugin replaces each locale module in a build with only the messages some module
references. Next's Turbopack and Bun load a locale before the code that reads it, so their
integrations read the source under `scan.dirs` instead, and every key a file there names is kept. A reference is any string literal equal to a key, so keys kept in arrays or maps count;
``t(`status.${state}`)`` and `t('status.' + state)` keep every key under `status.`. For keys built
some other way, list them: `prosebook({ keep: ['plan.*'] })`.

A message the build leaves out shows as its key, so by default a build fails on any read whose key
it can't see: `t(item.key)`, ``rich(`${area}.title`)``, `<Text id={id} />`. Write the key at the read,
or, where every key it reads is written elsewhere (in an array, say) or listed in `keep`, mark the
line with `prosebook-ignore`. Reads are known by name: `t` and `rich` alone or as methods, the names
they're destructured to (`const { rich: tRich } = copy`) in any module, and `<Text>` from any of the
bindings. In `.vue` and `.svelte` files the scripts and the expressions in the markup are read alike
(`{{ t(key) }}`, `:id="key"`, `{copy.t(key)}`, `<Text {id} />`), and `<!-- prosebook-ignore -->` marks
a line there. `prune: 'loose'` prunes without the check, and `prune: false` ships everything.
`prune` and `keep` are options of each integration.

## Splitting

Pruning drops what no code reads; splitting ships the rest with the code that reads it. With
`prosebook({ split: true })`, the Vite plugin splits each locale by area, the file a key's first
segment names, so a route loaded with `lazy(() => import('./Cart.tsx'))` brings the `cart` messages
with it and the main bundle holds none of them:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react(), prosebook({ split: true })],
});
```

A module that names an area's keys imports that area, and the bundler puts it beside that module:
in the main chunk when the shell reads it, in a route's chunk when only the route does, in a shared
chunk when two routes do. An area holds the source's messages and the `bundled` locales'; every
other locale loads area by area, as it is needed: switching language fetches only the areas
already on the page. The area's module waits for that load (a top-level `await`), so a lazy route
renders in the reader's language from its first frame, in every binding, with no change to the code
reading it.

A read the build can't see, marked `prosebook-ignore`, finds its area only if some module loaded
before it names one of the area's keys; one read before then shows its key and is reported through
`onError`, with the fix. Areas `keep` names load with the catalog. Splitting runs in the browser
only: a server render, and an app without the Vite plugin, load whole locales. It needs a build
target with top-level `await`, which Vite's default has.

## Finding a string's entry

In dev, hold Alt (Option on a Mac) and point at text on the page: the inspector outlines the
string and names its key and the locale it came from. Alt-click opens its entry in your editor: the
translation for a translated string, the catalog entry for one that fell back. Alt-Shift-click opens
the catalog entry either way. Save, and the string changes on the page, which keeps its locale and
state. Only adding or removing a locale reloads it.

Alt-right-click edits the entry without leaving the page. A dialog opens beside the string with its
fields: the source message and its translation in every locale (the one the string was read in
first), context, kind, surface, fragment and what each placeholder holds. A YAML tab shows the entry
as written in each file. A translation left empty is none, so the locale falls back; filling one in
adds it to that locale's file, the area's file for a locale kept in a folder. Save checks the whole
catalog with the edit first, so a broken message or a missing argument doc shows in the dialog and
nothing is written; a clean edit is written into the file, which keeps its comments and layout, and
the page updates in place. <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> saves, <kbd>Esc</kbd> closes.

As you type, the dialog has the edit checked unsaved and shows what lint says of each locale under
its text, with every rule the config has, plugins included. Clicking a finding selects its words;
Fix makes the fix `prosebook lint --fix` would. Findings don't stop a save: they are the writing
guide's, not the catalog's.

To ask for a change rather than make it, write a comment, or press Mark for removal. Both are written
into the catalog entry (`comment:`, `remove: true`), and every `prosebook generate` and `check` lists
them as warnings with their file and key, so a coding agent asked to "act on the prosebook comments"
finds each one, makes the change, and deletes the comment or the entry. Hovering the key at its call
site shows them too.

Nothing is added to the page to make this work. In dev the runtime reports each string it hands out,
and the inspector matches the text under the pointer back to it, so `t()`, `<Text>`, a sentence with
a link inside it and readable attributes (`placeholder`, `title`, `aria-label`, `alt`) all work. Text
the code changes after reading it (`t('…').toUpperCase()`) can't be traced. Where two keys read the
same text, the label says so and the click opens the one read last. Under Next.js, only text read in
the browser is found: a server component's reads happen where the inspector can't see them.

The inspector comes with each integration, in dev only, and opens the editor its dev server already
launches. Under Vite, and so in any framework built on it, TanStack Start among them, that is the one
`/__open-in-editor` launches: one it finds running, or the command in `LAUNCH_EDITOR`. Under Next.js
it is the one `/__nextjs_launch-editor` launches, from `REACT_EDITOR` or one it finds running; the
endpoints are served on a local port of their own, which a rewrite of `/__prosebook/*` sends to.
Under Bun it is the one `Bun.openInEditor` finds, from `VISUAL`, `EDITOR` or bunfig.toml's
`[debug] editor`, and the endpoints are the `inspector()` routes [above](#with-bun). Turn it off with
`inspect: false` in the options of the Vite plugin, `withProsebook` or the Bun plugin.

## Config

```ts
// prosebook.config.ts
import { defineConfig } from 'prosebook/config';

export default defineConfig({
  catalog: 'copy/catalog', // source YAML
  locales: 'copy/locales', // translations
  out: 'src/copy', // generated modules
  lock: 'copy/lock.json',
  source: 'en',
  messageFormat: 1, // or 2, for Unicode MessageFormat 2
  isolate: 'rtl', // MF2: isolate placeholders in right-to-left locales; 'always', or false
  bundled: [], // locales shipped in the main bundle; the rest load on first use
  pseudo: false, // or 'en-XA'
  stale: 'use', // or 'fallback'
  language: 'ts', // or 'js'
  importExtension: '.js', // '.ts' for Node's type stripping, '' for bundler resolution
  require: ['context'],
  kinds: {/* name, action, description, state */},
  surfaces: {/* label, heading, tooltip, ... */},
  lint: {
    extends: 'recommended',
    plugins: [],
    rules: {},
    areas: {}, // severities per area: { native: { 'sentence-case': 'off' } }
    banned: [],
    spelling: {},
    concepts: {},
    properNouns: [],
    pathSeparator: '›',
  },
  native: [], // Rust, Swift or Kotlin files, Android's res or Apple's .lproj: { language: 'rust', out: 'src/copy.rs', keys: ['tray'] }
  scan: { dirs: ['src'] },
});
```

## Examples

Each is a small shop in English, German and the pseudo-locale, and uses prosebook as an app would,
from the package. CI generates, lints, typechecks and builds each one, then checks what its build
serves.

| Example                                              |                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`examples/vite`](examples/vite)                     | React with Vite, a part-translated Turkish and the inspector. The cart is a lazy route, split by area. |
| [`examples/preact`](examples/preact)                 | Preact with Vite's own JSX transform, the same app as the React one.                                   |
| [`examples/vue`](examples/vue)                       | Vue single-file components: `<Text>` in templates, typed by `vue-tsc`.                                 |
| [`examples/svelte`](examples/svelte)                 | Svelte 5 with runes: the copy set in the root, the link a snippet, typed by `svelte-check`.            |
| [`examples/solid`](examples/solid)                   | Solid: reads update in place on a locale switch, and the components run once.                          |
| [`examples/next`](examples/next)                     | Next.js: server components read a copy per request, client components the provider's.                  |
| [`examples/tanstack-start`](examples/tanstack-start) | TanStack Start, rendered on the server in the request's locale with the Vite plugin.                   |
| [`examples/bun`](examples/bun)                       | `Bun.serve` with a React page, a route that answers in the request's locale, the inspector.            |
| [`examples/node`](examples/node)                     | No framework and no bundler: a Node script prints a receipt from the generated TypeScript.             |

```bash
bun run build                      # the examples import prosebook from dist
bun run --cwd examples/next dev
```

## Further

Ideas not built yet, roughly in order of value:

1. **A locale's areas in one file per chunk**: a route reading three areas loads German in one request, not three.
2. **Preloading a split render's areas**: a server render records the areas it read and links their files in the request's locale.
3. **Splitting under Next and Bun**: Turbopack has no hook after chunking and no virtual modules, so it needs areas written as files and a loader over the app's source.
