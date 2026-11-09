# prosebook API reference

The full reference. For an overview, see the [README](README.md).

- [Integrations](#integrations): [Vite](#vite) · [Next.js](#nextjs) · [Bun](#bun) · [Astro](#astro) · [Options](#integration-options)
- [Runtime](#runtime): [`createCopy`](#createcopy) · [A copy](#a-copy) · [Locales](#locales) · [Types](#types) · [Errors](#errors)
- [Bindings](#bindings): [React](#react) · [Preact](#preact) · [Vue](#vue) · [Svelte](#svelte) · [Solid](#solid) ·
  [Plain JavaScript](#plain-javascript) · [On a server](#on-a-server) · [In tests](#in-tests)
- [The catalog](#the-catalog): [Fields](#fields) · [The writing guide](#the-writing-guide)
- [Messages](#messages): [ICU](#icu-messageformat) · [Named formats](#named-formats) · [Relative times](#relative-times) · [Formatters](#formatters) · [Tags](#tags) ·
  [MessageFormat 2](#messageformat-2)
- [Translations](#translations): [Stale](#stale-translations) · [With a model](#translating-with-a-model) ·
  [Translation tools](#translation-tools) · [Pseudo-locale](#pseudo-locale)
- [CLI](#cli): [Lint](#lint) · [Judge](#judge) · [Scan](#scan) · [SARIF](#sarif) · [Extract](#extract) · [Find](#find) · [Rename](#rename) · [Diff](#diff)
- [Builds](#builds): [Pruning](#pruning) · [Splitting](#splitting)
- [Inspector](#inspector)
- [Native targets](#native-targets): [Rust, Swift, Kotlin](#rust-swift-kotlin) · [Android](#android-resources) ·
  [Apple](#apple-string-tables)
- [Config](#config)

## Integrations

Without one, run `prosebook generate` yourself. It writes `src/copy/`: a module per locale and an `index.ts` with the types.

What `generate` writes is checked byte for byte by `generate --check`, so a formatter or linter must leave it as written. The
modules say so to every tool that reads a comment for it: `/* eslint-disable */` (ESLint, oxlint, `bun lint`), Biome's
`biome-ignore-all`, Deno's and dprint's `ignore-file`, and `// prettier-ignore` before each statement, as oxfmt, Prettier and
`bun fmt` skip no whole JavaScript file; `WRITING.md` sits between `prettier-ignore-start` and `-end`, and native targets carry
their languages' own (`rustfmt_skip`, `swiftlint:disable all`, ktlint's `Suppress`). JSON takes no comment, so keep
`copy/catalog/catalog.schema.json` out yourself, and better still `src/copy/` too (Prettier's `.prettierignore`, oxfmt's and
`bun fmt`'s `ignorePatterns`, Biome's `files.includes`): a rule on the file's name, such as `unicorn/filename-case` on
`en-XA.ts`, can't be turned off from inside it, and a linter reporting unused disable comments reports the module's own.

### Vite

```ts
// vite.config.ts
import { prosebook } from 'prosebook/vite';

export default defineConfig({ plugins: [react(), prosebook()] });
```

Generates on start and on every catalog edit; the page shows the new text without reloading, in the locale and state it was in.
TanStack Start, React Router and other frameworks built on Vite take the plugin as it is.

Several apps sharing one catalog each point at its folder, so every app generates the same files:

```ts
prosebook({ root: '../../packages/copy' });
```

### Next.js

```ts
// next.config.ts
import { withProsebook } from 'prosebook/next';

export default withProsebook({/* your Next config */});
```

- Takes the config as an object or as Next's phase function; [options](#integration-options) go second.
- `next dev` and `next build` generate first; dev regenerates on every edit.
- Turbopack doesn't resolve `./en.js` to `en.ts`: set `importExtension: ''` in the prosebook config.
- Turbopack only: Next 16 fails a Turbopack build whose config has a `webpack` key.

### webpack and Rspack

```ts
// webpack.config.ts or rspack.config.ts
import { ProsebookPlugin } from 'prosebook/webpack';

export default {
  plugins: [new ProsebookPlugin()],
  // The generated index imports `./en.js`, as TypeScript writes it, for `en.ts`.
  resolve: { extensionAlias: { '.js': ['.ts', '.js'] } },
};
```

- Generates before each build; watching, and so under the dev server, again on every edit, and the page shows the new text
  without reloading, in the locale and state it was in.
- In `production` mode, the default, the build ships only the messages the code reads and leaves the pseudo-locale out.
- Without `extensionAlias`, set `importExtension: ''` in the prosebook config instead.
- Takes `config`, `root`, `prune` and `keep` ([options](#integration-options)); not `split`, and no [inspector](#inspector).
  Rsbuild takes it as `tools.rspack.plugins`.

### React Native and Expo

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config'); // or @react-native/metro-config
const { withProsebook } = require('prosebook/metro');

module.exports = withProsebook(getDefaultConfig(__dirname));
```

```tsx
import { getLocales } from 'expo-localization';
import { Text } from 'react-native';

const copy = createCopy(catalog, { locale: getLocales().map((l) => l.languageTag) });

function Cart({ count }: { count: number }) {
  const { t } = useCopy(); // prosebook/react
  return <Text>{t('cart.items', { count })}</Text>;
}
```

- Generates as Metro reads its config, and again on every edit while the dev server runs; the app shows the new text without
  reloading, in the locale and state it was in.
- A production bundle ships only the messages the code reads and leaves the pseudo-locale out; a read whose key it can't see
  fails it, as `prune` says, while the dev server still starts.
- Takes `config`, `root`, `prune` and `keep` ([options](#integration-options)), the Metro config as an object, a promise or a
  function, and returns a promise, which Metro waits for. Not `split`, and no [inspector](#inspector).
- prosebook is ESM: `require('prosebook/metro')` needs Node 20.19 or later.
- React Native renders text only inside `<Text>`: read with `t`, or put prosebook's `<Text>` inside React Native's. Hermes
  implements part of `Intl`: a placeholder whose format it lacks shows as `{name}`, and `onError` says why.

### Bun

```toml
# bunfig.toml: the dev server's plugins
[serve.static]
plugins = ["prosebook/bun"]
```

```ts
// src/server.ts: the inspector's routes, in dev only
const dev = process.env.NODE_ENV !== 'production';

Bun.serve({
  routes: { ...(dev ? (await import('prosebook/bun')).inspector() : {}), '/': index },
  development: dev && { hmr: true },
});
```

```ts
// build.ts: `bun build` reads no plugins, so a build that prunes calls Bun.build
import { prosebook } from 'prosebook/bun';

await Bun.build({
  entrypoints: ['./src/server.ts'],
  target: 'bun',
  outdir: './dist',
  external: ['prosebook/bun'], // keeps the dev-only routes out
  plugins: [prosebook()],
});
```

bunfig.toml takes a module's default export, so options go in a file of your own:

```ts
// prosebook.plugin.ts, named in bunfig.toml: plugins = ["./prosebook.plugin.ts"]
import { prosebook } from 'prosebook/bun';

export default prosebook({ split: true });
```

### Astro

```ts
// astro.config.ts
import { prosebook } from 'prosebook/astro';

export default defineConfig({ integrations: [prosebook()] });
```

```astro
---
import { rich, t } from '../copy.ts'; // export const { t, rich } = createCopy(catalog);
---

<h1>{t('home.title')}</h1>
<p>{rich('home.terms', { link: (chunks) => <a href="/terms">{chunks}</a> })}</p>
```

- The Vite plugin, with its [options](#integration-options), and the [inspector](#inspector) on every page in dev, a page with no
  script included.
- A page reads as the server renders it; a `<script>` reads in the browser. Each build ships only the messages its side reads.
- An edit reloads the page, rendered again with the new text.
- With Astro's i18n routing, a copy per page: `createCopy(catalog, { locale: Astro.currentLocale })`, then `await copy.ready`.

### Integration options

Each of `prosebook()` (Vite), `withProsebook(config, options)`, `prosebook()` (Bun) and `prosebook()` (Astro) takes, and
`new ProsebookPlugin()` (webpack) and `withProsebook()` (Metro) the first four:

| Option    | Default    |                                                                                                              |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `config`  |            | The config, inline. Without it, `prosebook.config.*` at `root` is read.                                      |
| `root`    | the app's  | The folder the config is found in and its paths resolve from.                                                |
| `prune`   | `'strict'` | Ship only the messages the code reads. `'loose'` skips the [unseen read](#pruning) check, `false` ships all. |
| `keep`    | `[]`       | Keys a build always keeps, exactly or as `prefix.*`.                                                         |
| `split`   | `false`    | [Split](#splitting) each locale by area.                                                                     |
| `inspect` | `true`     | The [inspector](#inspector), in dev, and its [shortcut](#inspector).                                         |

In dev, an edit to `prosebook.config.*` restarts Vite's and Astro's server. Next, webpack, Metro, Bun and `generate --watch`
regenerate with
the new config, but keep the paths (`catalog`, `locales`, `out`) they started with: restart them after moving one. A module the
config file imports is read once per process.

## Runtime

### `createCopy`

```ts
import { createCopy } from 'prosebook';
import { catalog } from './copy';

const copy = createCopy(catalog, {
  locale: navigator.languages, // a locale, or the reader's, most preferred first
  tags: { b: (chunks) => `**${chunks.join('')}**` },
  onMissing: (key, locale) => key,
  onError: (error, key, locale) => report(error, { key, locale }),
  preload: (href) => preloadModule(href, { as: 'script' }),
  timeZone: 'Europe/Berlin',
  now: renderedAt, // what relative times are measured from: a server's render time, or a clock
  live: false,
});
await copy.ready;
```

| Option      |                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `locale`    | The locale to start in, or the locales a reader prefers. Defaults to the source.                     |
| `tags`      | Tag renderers every rich read gets unless it passes its own.                                         |
| `onMissing` | What a key the catalog lacks reads as. Defaults to the key.                                          |
| `onError`   | Told of a placeholder with no value or one `Intl` refuses. Defaults to `console.error`.              |
| `preload`   | On a server, handed each file a [split](#splitting) client will load for the areas this copy reads.  |
| `timeZone`  | The IANA zone dates show in, unless a message names its own. Defaults to the environment's.          |
| `now`       | What [relative times](#relative-times) are measured from: a clock, or the time a server rendered at. |
| `live`      | Keeps relative times read outside any binding fresh, by changing `version` when they next change.    |

### A copy

```ts
copy.t('cart.items', { count: 3 }); // "3 items in your cart."
copy.rich('cart.terms', { link: (chunks) => h('a', chunks) }); // ['By checking out you agree to our ', <a>…</a>, '.']
copy.number(9, 'price'); // "€9.00", a named format or Intl options
copy.date(when, { weekday: 'long' });
copy.list(['a', 'b', 'c']); // "a, b, and c"; a named format too, with its max and more, or its separator
copy.list([author, draft && 'Draft'], 'facts'); // "Ann · Draft": empty items, null and false left out
copy.duration(185_400, 'compact'); // "3m 5s": milliseconds, with a named format or options
copy.relative(openedAt, 'recent'); // "2 hours ago", "yesterday": a Date, milliseconds or ISO string
repos.sort((a, b) => copy.compare(a.name, b.name, { numeric: true })); // "file9" before "file10", as the locale sorts
names.sort(copy.collator({ sensitivity: 'base' }).compare); // one collator per locale and options
copy.has(key); // narrows key to a key of the catalog
await copy.setLocale('de'); // once its messages and its fallbacks' are loaded
const stop = copy.subscribe(render); // after each locale switch, and each catalog edit in dev
copy.locale; // 'de'
copy.dir; // 'ltr', or 'rtl' in Arabic, Hebrew, Persian, Urdu...
copy.locales; // every locale of the catalog
copy.source; // 'en'
copy.timeZone; // 'Europe/Berlin', or undefined for the environment's
copy.version; // counts changes to what messages read as
copy.now(); // the copy's clock, in milliseconds
copy.nextChange(); // when the last read's relative time next reads differently, or undefined
copy.at(time, render); // runs render once the copy's clock reaches time; returns what cancels it
```

Methods don't use `this`: `const { t, rich } = copy` works.

Formatting from code is cheap enough for a value that changes every frame: each formatter is made once per locale and
options, so `copy.number(fps, 'rate')` costs what `Intl.NumberFormat`'s `format` does, under a microsecond (about 0.4 µs in Bun
on a laptop, against 16 ms a frame). A named format, or options kept in a constant, is found by the object itself; options
written inline at the call, `{ maximumFractionDigits: 1 }`, are serialized each call to find it, about 0.2 µs more.

### Locales

```ts
import { acceptedLocales, chainOf, dirOf, negotiate, preferredLocales } from 'prosebook';

preferredLocales(); // the browser's languages
acceptedLocales('de;q=0.1, en;q=0.9'); // ['en', 'de'], by weight
negotiate(['de-AT', 'en'], catalog.locales, 'en'); // the best the catalog has, else the fallback
chainOf('pt-BR', catalog.locales, 'en'); // ['pt-BR', 'pt', 'en']: the fallback chain
dirOf('ar-EG'); // 'rtl': the direction its script runs in, for <html dir>
```

A key a locale leaves out falls back, key by key, through its parents to the source, and is formatted in its own locale.

`dirOf` reads the script a tag names, or its language's usual one (`pa-PK` is Arabic script). Set `<html lang={copy.locale}
dir={copy.dir}>`, and write layout with logical properties (`margin-inline-start`), which follow it.

### Types

```ts
import type { MessageKey, Translate } from 'prosebook';

const STATUS: Record<Status, MessageKey> = { started: 'run.started', done: 'run.done' };
const summary = (t: Translate, run: Run) => t(STATUS[run.status]);
```

`MessageKey` is any key of the catalog; `Translate` is a copy's `t`. A map of labels holds keys rather than text, so each is read in
the locale of the moment it renders. A [pruned build](#pruning) sees reads through a module's `const` map of keys.

Tags the provider renders by default needn't be passed at each call. Tell the types which ones:

```ts
declare module 'prosebook' {
  interface Register {
    tags: 'link' | 'b';
  }
}
```

### Errors

A message never throws. A placeholder with no value, or one `Intl` refuses (an invalid date, `currency: 'euro'`), shows as `{name}`
(`{$name}` in MF2), the rest renders, and the problem goes to `onError`.

Generated code names the runtime it was written for. A catalog generated by a prosebook whose output the installed runtime
can't read, newer or much older, throws as it loads and says which to update, rather than garbling messages one by one.

## Bindings

Every binding's reader has `t`, `rich`, `setLocale` and the rest of [a copy](#a-copy), and a `<Text>` component. A message
saying a [relative time](#relative-times) stays current, as a `<Text>` or as a string from `t`: when it next reads
differently, what read it renders again, and nothing else does. React and Preact render again the component whose
`useCopy()` read it; Vue, Svelte and Solid run again only the template, effect or `computed` that read it.

### React

```tsx
import { CopyProvider, Text, useCopy, useLocale } from 'prosebook/react';

<CopyProvider copy={copy} tags={{ link: (chunks) => <a href="/terms">{chunks}</a> }}>
  <App />
</CopyProvider>;

function Cart({ count }: { count: number }) {
  const { t, rich } = useCopy(); // re-renders when the locale changes
  const locale = useLocale();
  return (
    <>
      <h2>{t('cart.title')}</h2>
      <Text id="cart.items" values={{ count }} />
      <p>{rich('cart.terms')}</p>
    </>
  );
}
```

- What `useCopy()` returns keeps its identity until the locale changes (or, in dev, the catalog), so `t` can be an effect's
  dependency.
- Give `tags` as a module constant or a `useMemo`: a new object on each render makes a new reader.

### Preact

```tsx
import { CopyProvider, Text, useCopy, useLocale } from 'prosebook/preact';
```

Used as in React. Written on `preact/hooks`, so it needs no `preact/compat`.

### Vue

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

const copy = useCopy();
</script>

<template>
  <h2>{{ copy.t('cart.title') }}</h2>
  <Text id="cart.items" :values="{ count }" />
  <Text id="cart.terms">
    <template #link="{ chunks }"
      ><RouterLink to="/terms"><component :is="chunks" /></RouterLink
    ></template>
  </Text>
</template>
```

- `provideCopy(copy)` in `setup` gives a subtree its own copy; `useLocale()` is a `ComputedRef`.
- Reads go through a ref, so templates and `computed`s that read a message run again on a locale switch.
- `rich` returns a `VNode`. `<Text>` takes each tag as a slot of the same name, given what the tag wraps as `chunks`.
- Templates are typed with `vue-tsc`, on TypeScript 6 until TypeScript 7 ships its API.

### Svelte

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
</script>

<h2>{copy.t('cart.title')}</h2>
<Text id="cart.items" values={{ count }} />
<Text id="cart.terms" />
```

- Reads are reactive: markup, `$derived` and effects that read a message run again on a locale switch.
- Tags render through snippets, given to `<Text>` by name or to `setCopy` for every message.
- `Text` ships as a `.svelte` file, so it needs Svelte 5 and its Vite plugin (or SvelteKit). `svelte-check` runs on TypeScript 6
  for now.

### Solid

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
  const [count] = createSignal(2);
  return <Text id="cart.items" values={{ count: count() }} />;
}
```

Each read tracks a signal, so what reads a message updates in place and components never run again. `useLocale()` is an
accessor.

### Plain JavaScript

```js
import { createCopy } from 'prosebook';
import { catalog } from './copy/index.js';

const copy = createCopy(catalog, { locale: navigator.languages });
await copy.ready;
document.title = copy.t('app.title');
copy.subscribe(() => render());
```

Set `language: 'js'` to generate `.js` modules with a `.d.ts`, or `importExtension: '.ts'` to run the generated TypeScript in
Node as it is.

### On a server

One copy per request, in the locale it asks for:

```ts
import { acceptedLocales, createCopy } from 'prosebook';

const copy = createCopy(catalog, { locale: acceptedLocales(request.headers.get('accept-language')) });
await copy.ready;
```

**React Server Components** can't read context. `createServerCopy` gives each request one copy every server component shares,
through React 19's `cache`:

```ts
// server-copy.ts
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
  const { t, locale } = await serverCopy();
  return <h1 lang={locale}>{t('app.title')}</h1>;
}
```

**Hydration.** A server-rendered page must hydrate in the same locale, so the browser's copy waits too. Create it above a
`<Suspense>` and wait below it, since a component that suspends before it mounts loses its state:

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

**Time zones.** A date shows in the environment's zone, and a server's is rarely its reader's: `{when, date}` at 23:30 UTC is
tomorrow in Tokyo, and the page hydrates as another day. Give both copies the same `timeZone`: the reader's, kept in a cookie
the browser sets from `Intl.DateTimeFormat().resolvedOptions().timeZone`, or `'UTC'`. `createServerCopy` asks for its options
per request when they are a function:

```ts
export const serverCopy = createServerCopy(catalog, locale, async () => ({
  timeZone: (await cookies()).get('tz')?.value ?? 'UTC',
}));
```

A zone `Intl` refuses shows each date as its placeholder, `{when}`, and `onError` says why.

### In tests

An end-to-end test finds the page's text through the catalog, so a copy edit doesn't break it:

```ts
// e2e/copy.ts
import { createCopy } from 'prosebook';
import { catalog } from '../src/copy/index.ts';

export const copy = createCopy(catalog); // the source locale; await copy.setLocale('de') for another
```

```ts
import { copy } from './copy.ts';

test('checks out', async ({ page }) => {
  await page.getByRole('button', { name: copy.t('cart.checkout') }).click();
  await expect(page.getByText(copy.t('cart.items', { count: 2 }))).toBeVisible();
});
```

- It reads the generated modules on disk, so run `prosebook generate` before the tests, as a build does.
- A runner that doesn't resolve the index's `./en.js` to `en.ts` runs it with `importExtension: '.ts'`.
- `copy.t` gives plain text, a tag's words without the tag, as `getByText` and an accessible name read them.
- A fixed clock, `createCopy(catalog, { now: () => Date.UTC(2026, 10, 9) })`, reads a relative time the same on every run.

## The catalog

One file per area, `copy/catalog/<area>.yaml`. A key's first segment names its file: `cart.items` lives in `cart.yaml`.

```yaml
# yaml-language-server: $schema=./catalog.schema.json
cart.checkout:
  kind: action
  surface: action
  context: The button that starts paying for the cart.
  en: Check out

cart.title: Cart # the shorthand, with `require: []`
```

`generate` writes `catalog.schema.json` beside the catalog and starts each file with the line naming it, so an editor completes
and explains every field. `generate --check` fails on a file without it; a file naming a schema of its own keeps it.

### Fields

| Field      |                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `en`       | The message. The field is named after `source` in the config.                                           |
| `context`  | One sentence telling a translator where the string appears. Required by default.                        |
| `args`     | What each placeholder holds, and what each tag wraps. Required for every placeholder when `context` is. |
| `kind`     | `name`, `action`, `description` or `state`. The lint holds each to its budget.                          |
| `surface`  | Where it sits: `label`, `heading`, `tooltip`, `error`, `empty`, `hint`, ...                             |
| `closed`   | Selects that take only the arms they name: `closed: [mode]` types `mode` as `'dark' \| 'light'`.        |
| `min`      | The least a plural's count can be: `min: { sites: 2 }` asks no `one` of English, but still of Russian.  |
| `fragment` | `true` where it completes something beside it, so sentence rules don't apply.                           |
| `allow`    | Lint rules the entry is exempt from, each with the reason.                                              |
| `comment`  | A change asked of whoever edits the entry next. A warning until made and deleted.                       |
| `remove`   | `true` asks for the entry to go, with its translations and the code reading it. A warning until then.   |

Kinds and surfaces are configurable. A key can name an entry and prefix others: `alerts.mute` and `alerts.mute.hint`.

### The writing guide

`generate` writes `copy/catalog/WRITING.md`: where an entry goes, what each kind and surface is for, the named formats, and the
rules with no check. Point your agent at it:

```markdown
<!-- AGENTS.md -->

Before writing or changing UI copy, read copy/catalog/WRITING.md.
```

Claude Code reads it with `@copy/catalog/WRITING.md` in CLAUDE.md. Set `guide` to write it elsewhere, `guide: false` for none. A
checked rule is in it when it says `guide: true`.

Each format's samples are written as the runtime's `Intl` writes them, which differs between Bun and Node and between ICU
versions. A guide whose samples differ only that way, its formats unchanged, is kept as it is, so neither runtime rewrites the
other's and `generate --check` passes on both.

#### Voice guidelines

The guide also says seven guidelines against the habits of copy written off the code, as an agent tends to write it:

| Rule                       | Says                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `voice/field-names`        | A label over a value is a noun: `Reporter`, not `Reported by`                            |
| `voice/own-words`          | The app's or the platform's word, not a paraphrase: `Get notified`, not `Hear of…`       |
| `voice/no-intent`          | Things don't want, know, say or tell: `Runs on new issues`, not `The workflow takes in…` |
| `voice/no-instructions`    | A control names what it does: `Replay`, not `Click this if you want to replay`           |
| `voice/placeholder-values` | Every value a placeholder holds reads right: `{team}'s usage` comes to `Sales's usage`   |
| `voice/familiar-context`   | A sentence names what it's about: `The workflow's name`, not `Its name`                  |
| `voice/phrases`            | A phrase where a phrase does: `Saved`, not `Your changes have been saved.`               |

They're guidelines, not checks: each is about meaning, which a word list would flag in sound copy as often as it caught, but a
model can judge, with [`prosebook judge`](#judge). They're written in English, so they're on only where the source is. Turn them
all off, or one, or in an area:

```ts
lint: {
  rules: { 'voice/*': 'off', 'voice/no-intent': 'warn' }, // <plugin>/* sets every rule of a plugin, a rule's own name wins
  areas: { marketing: { 'voice/*': 'off' } },
},
```

#### Tone

A preset gives the copy a tone, said in the guide with an example per kind of string, in `prosebook todo --prompt` with the
form of `you` translations take, and to the judge, beside the rules that go with it:

```ts
export default defineConfig({
  extends: 'friendly',
  tone: {
    notes: 'We sell to bakeries: warm, no puns.', // said after the preset's tone
    formality: { '*': 'informal', fr: 'formal' }, // over the preset's, by locale and language; or one for all: 'formal'
    areas: { legal: 'plain' }, // an area's own preset: its tone said for it, its rules held there alone
  },
});
```

| Preset         | For                               | Rules                                                                                                |
| -------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `plain`        | government, health, banking       | `formal`'s, `plain/words` (`commence` is `start`), and `plain/idioms`, a guideline                   |
| `professional` | tools people use at work          | `formal`'s                                                                                           |
| `friendly`     | apps people choose to use         | `contractions` on                                                                                    |
| `technical`    | developers and operators          | none                                                                                                 |
| `playful`      | games, hobbies, lifestyle         | `contractions` on, and `playful/serious-moments`, a guideline keeping errors and confirmations plain |
| `formal`       | the formal form of `you`, no more | `contractions` off, `formal/expanded` (`can't` is `cannot`) and `formal/exclamation` on              |

A preset's severities sit over `lint.extends` and under `lint.rules`: `off` turns a rule off, and `warn` or `error` turns it on at
least that high, so `friendly` under `strict` keeps `contractions` an error. A team's own preset extends prosebook's, each field of
its tone over theirs, and adds its own rules and words:

```ts
import { definePreset } from 'prosebook/config';

export const house = definePreset({
  name: 'house',
  extends: ['professional'],
  tone: { doc: 'Calm and exact, for the people who run a kitchen.' },
  lint: { rules: { 'formal/exclamation': 'error' }, banned: [{ words: ['synergy'], why: 'is jargon' }], plugins: [] },
});
// prosebook.config.ts: extends: [house]
```

An area's preset may not add words (`banned`, `spelling`, `concepts`, `properNouns`), which hold for the whole catalog.

`formality` is said in each language's own words: `du, dich, dir, dein, not Sie, Ihnen, Ihr` to a German translator, the
polite forms (`です`, `ます`) to a Japanese one, nothing where a language has one form of `you` (English, Swedish, Danish,
Norwegian). The `formality` rule finds the other form's pronouns in German, French, Spanish, Italian, Dutch, Polish, Czech,
Russian, Ukrainian, Turkish and Chinese, in the source and every translation; a capitalized one (`Sie`, `Ihr`) only past a
sentence's start, where it may mean "they". Without `tone.formality`, it holds a locale to the form most of its entries take.

## Messages

### ICU MessageFormat

```yaml
en: 'Hello, {name}.' # name: string
en: '{n, plural, =0 {No files} one {# file} other {# files}}' # n: number
en: '{rank, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}'
en: '{mode, select, dark {Dark} other {Light}}' # mode: 'dark' | (string & {})
en: '{mode, select, dark {Dark} light {Light} other {Light}}' # with closed: [mode], mode: 'dark' | 'light'
en: '{on, select, true {On} other {Off}}' # on: boolean
en: 'Assigned to {name}{role, select, null {} other {, as {role}}}' # role?: string | null
en: '{size, number, ::.0 unit/megabyte}' # 1.4 MB
en: '{total, number, ::currency/EUR}' # €9.00
en: '{views, number, ::compact-short}' # 1.4K
en: '{line, number, ::group-off}' # 1234 in every locale: a number that names, not counts
en: '{when, date, medium} at {when, time, short}' # Oct 28, 2026 at 2:05 PM
en: '{when, date, ::yMMMdjmm}' # j: the locale's hour cycle
en: 'With {names, list}' # names: readonly string[]; "With Ann, Bob, and Cy", "Mit Ann, Bob und Cy"
en: '{names, list, disjunction}' # "Ann, Bob, or Cy"; conjunction, disjunction, unit and long, short, narrow
en: 'Took {took, duration}' # took: number of milliseconds; "Took 3 min, 5 sec"
en: '{took, duration, narrow}' # "3m 5s", "850ms"; long, short, narrow, digital ("0:03:05")
en: 'Opened {at, relative}' # at: Date | number | string; "Opened 3 days ago", "Opened yesterday", "Opened now"
en: 'Due {at, relative, short}' # "Due in 2 hr."; long, short, narrow
en: 'By checking out you agree to our <link>terms</link>.' # a tag
```

- A bare `{n}` is a `string`. A number says how it's shown: `{n, number}` is 1,234 in English, 1.234 in German.
- A placeholder holds a value, never a translated fragment. A word that changes with the sentence belongs in an arm.
- An argument used twice must agree: a select's argument can be printed too, and two selects take both's arms. A number and a
  select on one argument fail.
- A skeleton the formatter would drop (`::compact-shortt`) fails the build.
- A select arm's name is letters, digits and `_`. Map a value like `application/pdf` to one in code.
- `list` and `duration` are prosebook's, beyond ICU: `{names, list}` joins with `Intl.ListFormat`, `{took, duration}` writes
  milliseconds with `Intl.DurationFormat`, from the largest unit it reaches, two units at most, the last rounded. In MF2,
  `{$names :list type=disjunction}` and `{$took :duration style=narrow}`. Where a browser lacks `Intl.DurationFormat`, the
  placeholder's fallback shows and `onError` says why. Native targets refuse both; pass the text formatted in code.
- `relative` is prosebook's too: `{at, relative}` shows a point in time as how long ago or ahead of now it is, as
  [relative times](#relative-times) says. In MF2, `{$at :relative style=short}`.

### Named formats

```ts
// prosebook.config.ts
formats: {
  number: {
    price: { style: 'currency', currency: 'EUR' },
    views: { notation: 'compact', maximumSignificantDigits: 3 },
    dollars: { style: 'currency', currency: 'USD', steps: [{ from: 10, maximumFractionDigits: 0 }] }, // $9.99, $13
    // 512B, 1.5 kB, 12 kB, 1 MB (999,999 bytes): tenths below 10, in the largest unit it has a whole one of
    bytes: {
      maximumFractionDigits: 1,
      steps: [{ from: 10, maximumFractionDigits: 0 }],
      ladder: { units: [{ unit: 'byte', unitDisplay: 'narrow' }, 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] },
    },
    took: { maximumFractionDigits: 1, ladder: { units: ['millisecond', 'second', { unit: 'minute', per: 60 }] } }, // 850 ms, 1.5 min
  },
  date: {
    receipt: { dateStyle: 'medium', timeStyle: 'short' },
  },
  list: {
    tools: { type: 'unit', max: 3, more: { entry: 'common.more' } }, // "grep, sed, awk, 2 more"
    facts: { separator: ' · ' }, // "Ann · Draft · 2 new commits"
  },
  duration: {
    compact: { style: 'narrow', smallest: 'seconds' }, // "3m 5s"; largest, smallest, units (2)
    tenths: { style: 'narrow', fractionalDigits: 1 }, // "4.2s", "12s", "3m 5s"
  },
  relative: {
    recent: { now: { entry: 'time.now' }, date: { after: 7 * 86_400_000, format: 'receipt' } }, // "just now", "5 minutes ago", "Oct 28, 2026"
  },
  locales: {
    de: { date: { receipt: { dateStyle: 'long', timeStyle: 'short' } } },
    ja: { list: { facts: { separator: '・' } } }, // "重大・トリガー済み"
  },
},
```

```yaml
en: 'Total: {total, number, price}' # €9.00
en: 'Ordered {when, date, receipt}'
en: 'Total: {$total :number format=price}' # MF2; :date, :time and :datetime take format= too
en: 'Used {tools, list, tools}' # {$tools :list format=tools}
en: 'Took {took, duration, compact}' # {$took :duration format=compact}
en: 'Opened {at, relative, recent}' # {$at :relative format=recent}
```

```yaml
common.more:
  context: Counts the items a list leaves out.
  en: '{count, plural, other {# more}}'
```

```ts
copy.number(total, 'price');
copy.date(when, 'receipt');
copy.list(tools, 'tools');
copy.duration(took, 'compact');
copy.relative(at, 'recent');
```

- One change in the config changes every message and call, in every locale.
- Names are typed: a misspelled one fails to compile in code and fails `generate` in a message.
- A name can't be a built-in style (`short`, `medium`, `long`, `full`, `integer`, `percent`, `currency`), and options are checked
  as the config loads.
- In MF2, `format=` stands alone: a variant is another name.
- What a format says itself, a list's `more` and `separator` and a relative time's `now`, is text or an entry. Text is a
  message in the catalog's syntax, `' · '` or `'{count, plural, other {# more}}'`, set per locale under `locales`. `{ entry:
  'common.more' }` names the entry that says it, translated as any entry is, and kept in every build. Either may hold a tag,
  `'<dot> · </dot>'`: a rich read and `<Text>` render it as the message's own tags, through the renderers the read is given,
  and `t` reads its text. A message is compiled with what is said in the locale it is read in.
- A list format's `separator` joins the items with it alone, in place of the locale's commas and "and": a line of facts,
  `{facts, list, facts}` given `[author, draft && 'Draft', commits]`. `type` and `style`, which pick the locale's words, don't
  go with it. `copy.list(items, { separator: ' · ' })` takes it in code too, as plain text.
- Every list leaves out an empty item, `''`, `null`, `undefined` or `false`, so an optional one needs no filtering in code.
- A list format's `max` shows that many items and says the rest with `more`, given `{count}`, as the last item, in each
  locale's words; `max` and `more` go together, and only in a named format.
- A number format's `steps` show a number otherwise from a size up, either side of 0: each is options over the format's
  own from its `from`, listed from the smallest size up. The size is the number as shown, so 9.996, "$10.00" in cents, is in
  the step from 10, "$10". A message can't `.match` on a format with steps, and native targets refuse it.
- A number format's `ladder` shows a number in the largest of its units it has one whole of, as `style: 'unit'` would:
  file sizes, rates (`'bit-per-second'`, `'megabit-per-second'`), or any series of the units `Intl.NumberFormat` names. Each
  unit is `per` of the one before, 1000 unless said: `{ per: 1024, units: [...] }` counts bytes in binary, and a unit's own
  `per` sets its own, 60 minutes to the hour. A unit given as options has its own beside the format's, `unitDisplay` above all
  ("512B" beside "1.5 kB"). `steps` read the number in its unit, so "tenths below 10" is one step. The unit is checked after
  rounding: 999,999 bytes rounds to 1,000 kB, so it shows "1 MB". The format names no `style` or `unit` of its own. A message
  can't `.match` on it, and native targets refuse it. What climbs the ladder ships only in an app whose config has one.
- A duration format's `largest` and `smallest` units bound what it counts in (`hours` writes a day as 24 hours), and `units` how
  many it shows from the largest it reaches. `fractionalDigits` (1 to 3) shows the milliseconds as the seconds' fraction, "4.2s"
  where milliseconds would show "4s 200ms", rounded to its last digit and without trailing zeros ("12s"). The fraction is one of
  the `units`, so with 2, "3m 5s" shows none; `units: 3` shows "3m 5.2s". Digital keeps every digit, "0:03:05.40".
- A relative format's options are under [relative times](#relative-times).
- The `named-format` lint warns of a message that spells out a named format's options.

### Relative times

`{at, relative}` shows a point in time, a `Date`, milliseconds or an ISO 8601 string, as how long ago or ahead of now it is,
worked out as the message is read. The translator sees a time, not finished text, and code says the same with `copy.relative`:

```yaml
pr.opened:
  context: When the pull request was opened, on its card.
  en: 'Opened {at, relative, recent}'
time.now:
  context: A time under a minute from now, in place of "0 minutes ago".
  en: '{tense, select, future {in a moment} other {just now}}'
```

```ts
formats: {
  date: { day: { dateStyle: 'medium' } },
  relative: {
    recent: {
      now: { entry: 'time.now' }, // what a time under the smallest unit reads as, or text: now: 'just now'; Intl's "now" unless said
      date: { after: 7 * 86_400_000, format: 'day' }, // a date past a week, either way
      // largest: 'year', smallest: 'minute', skip: ['quarter'], rounding: 'nearest',
      // numeric: 'auto', style: 'long' are the defaults
    },
  },
},
```

```tsx
<Text id="pr.opened" values={{ at: pr.createdAt }} /> // "Opened just now", "Opened 5 minutes ago", "Opened yesterday"
```

- A time is counted in the largest unit it has a whole one of, from `largest` down to `smallest`, `skip` left out (quarters
  unless said). The units' lengths are fixed: a day is 24 hours, a week 7 days, a month 30 days, a quarter 90 days, a year 365
  days, so every page and every locale counts alike.
- `rounding: 'nearest'` (the default) rounds in its unit, and moves to the unit above where it reaches it: 1 day and 14 hours
  is "2 days ago", 23 hours and 40 minutes "yesterday". `down` counts whole units only.
- `numeric` and `style` are `Intl.RelativeTimeFormat`'s: `auto` (the default) says "yesterday", `always` "1 day ago".
- Under one of the smallest unit, a time is now: `Intl`'s word for it, or what `now` says, text or an entry, given `{tense}`,
  `past` or `future`. It is checked as the catalog loads; a tag in it renders as the message's own do.
- Past `date.after` milliseconds either way, the time shows in the date format `date.format` names.
- A message without a format reads with the defaults; `long`, `short` and `narrow` set the style alone.
- The generated index imports what says relative times only where a message or a format says one, so an app that says none
  ships none of it. `copy.relative` in such an app throws, naming the fix.

**Now.** A copy measures from `Date.now()` unless given `now`. A function is its clock, `() => fixed` in a test. A number is
the time a server rendered the page at, which the browser's copy reads as now until it is first subscribed to, as a binding
does once the page has hydrated, so the server's "5 minutes ago" hydrates as the same text:

```tsx
// the server puts its render time in the page; the browser's copy starts from it
const [copy] = useState(() => createCopy(catalog, { locale, now: renderedAt }));
```

**Staying fresh.** Each read notes when its text next reads differently: a count changing, a unit, or turning now or a date.
A binding waits for it and renders again what read it, alone: a `<Text>`, and a component that read the time as a string
with `t` (an incident's line, "Service · Triggered 5 minutes ago", measured to truncate) or `rich`. One timer serves every
time on the page, and a hidden tab catches up when it shows. `live: true` keeps fresh a time read straight from the copy,
outside any binding, by changing its `version`, which renders every reader again, at the soonest such moment.
`copy.nextChange()` says when the last read changes, for code that keeps its own fresh, and `copy.at(time, run)` waits for it
on the same timer.

### Formatters

For what options and steps can't say, a format of the app's own, as code. The config names the module:

```ts
// prosebook.config.ts
formatters: 'src/copy/formatters.ts',
```

```ts
// src/copy/formatters.ts
import { defineFormatters } from 'prosebook';

export default defineFormatters({
  number: {
    money: (value, { locale }) => (value < 1 ? `${Math.round(Number(value) * 100)}¢` : new Intl.NumberFormat(locale).format(value)),
  },
  date: {
    stamp: (value, { locale, timeZone }) => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'short' }).format(value),
  },
  relative: {
    // Given the time and the copy's clock; `next` says when it reads differently, for <Text> and `live`.
    hours: (at, { now }) => {
      const hours = Math.floor((now - at.getTime()) / 3_600_000);
      return { text: `${hours}h`, next: at.getTime() + (hours + 1) * 3_600_000 };
    },
  },
});
```

```yaml
en: 'Total: {total, number, money}' # MF2: {$total :number format=money}
```

```ts
copy.number(total, 'money');
```

- Each is named as a format of the config's is, typed, and checked: a name `formats` has too, or a built-in style, fails as the
  config loads. It is given the value and the locale, and the copy's `timeZone` where it has one, and gives the text.
- The generated index imports the module, so it ships to the browser, and everything it imports with it: keep it small, free
  of secrets and of server-only code, and its text a function of the value and the locale alone, so the server and the browser
  show the same.
- `generate` and every dev server run it, as they run the config: on a checkout you don't trust, both are code you run.
- One that throws shows the placeholder's fallback and tells `onError` why, as `Intl` refusing a value does.
- The writing guide shows each on its samples. A message can't `.match` on one, native targets refuse one, and the
  `named-format` lint never names one. Dev servers read the module again when it changes.

### Tags

```yaml
cart.terms:
  args:
    link: links to the terms of sale
  en: 'By checking out you agree to our <link>terms</link>.'
```

```tsx
t('cart.terms'); // the tag as its text
rich('cart.terms', { link: (chunks) => <a href="/terms">{chunks}</a> });
<Text id="cart.terms" values={{ link: (chunks) => <a href="/terms">{chunks}</a> }} />;
```

A tag keeps a sentence with a link inside it as one entry, so a translator can move the link.

### Names in other messages

```yaml
# copy/catalog/app.yaml
app.title:
  kind: name
  en: Corner Shop
app.welcome: 'Welcome to {app.title, entry}, {name}.' # MF2: {app.title :pb:entry}
app.reviews: 'Reviews of {app.title, entry}' # "Reviews of Corner Shop"

# copy/locales/de.yaml
app.title: '{case, select, genitive {des Eckladens} other {Eckladen}}'
app.reviews: 'Bewertungen {app.title, entry, genitive}' # MF2: {app.title :pb:entry form=genitive}
```

- Only an entry of kind `name` can be said, and it is text: selects for its forms, other names, no placeholders or tags.
- It is said where it stands, never handed to another formatter. In MF2 a `.local` may hold one, said as `{$shop}`; no other
  function, option or `.match` takes it.
- The form picks the arm of that name in each of the name's selects, `other` without one. A name's translation may select on a
  form its source doesn't have.
- Each locale says the name in its own words, or its nearest parent's. A message that isn't translated falls back whole, its
  names with it.
- Filled in as the catalog loads: the message compiles to the name's text, no key is read for another as the app runs, and
  native targets write it as text. Lint reads the message with the name in it.
- A key the catalog lacks, an entry of another kind, a form the name doesn't have and a name saying itself fail `generate`.
  `prosebook rename` renames the references with the entry.

### MessageFormat 2

Set `messageFormat: 2`. The types, checks, lint and runtime are the same.

```yaml
en: 'Hello, {$name}.'
en: 'Total: {$total :currency currency=EUR}'
en: '{$size :unit unit=megabyte maximumFractionDigits=1}'
en: '{$when :datetime dateLength=long}'
en: '{$line :integer useGrouping=never}'
en: 'By checking out you agree to our {#link}terms{/link}.'
en: |-
  .input {$n :number}
  .match $n
  0 {{No files}}
  one {{{$n} file}}
  * {{{$n} files}}
```

- Functions: `:string`, `:number`, `:integer`, `:percent`, `:currency`, `:unit`, `:offset`, `:date`, `:time`, `:datetime` (still a
  draft in the spec, followed as the `messageformat` package does), and prosebook's `:list`, `:duration`, `:relative` and
  `:pb:entry`.
- `.match` selects as MF2 does: an exact number beats its category, and a number matches as shown (`1.0` is `other`).
  `:integer` matches the value rounded, `:percent` times 100.
- **Text direction.** In right-to-left locales each placeholder is wrapped in isolation marks. `u:dir=ltr` picks a direction;
  `isolate: 'always'` isolates everywhere, `false` nowhere.
- **Options from arguments.** `currency`, `currencyDisplay`, `currencySign`, `unit`, `unitDisplay`, `signDisplay`, the digit
  counts, `timeZone` and `calendar` can come from an argument, which is typed with the rest:

  ```yaml
  en: 'Total: {$price :currency currency=$code}' # t('cart.total', { price: 9, code: 'USD' }): $9.00
  ```

**Switching.** `prosebook migrate 2` rewrites the catalog and translations in MF2, `migrate 1` goes back. A dry run unless `--write`;
then set `messageFormat`. It renders each message both ways first and reports any that would differ, and stops at a message the
other syntax can't say.

## Translations

`copy/locales/<locale>/<area>.yaml`, or one `copy/locales/<locale>.yaml`, holds only `key: translation`:

```yaml
# copy/locales/de/cart.yaml
cart.items: '{count, plural, =0 {Dein Warenkorb ist leer.} other {# Artikel im Warenkorb.}}'
```

A translation whose placeholders or tags differ from the source fails the build. A missing key falls back through the locale's
parents (`pt-BR` → `pt`) to the source.

### Stale translations

`copy/lock.json` records the source text each translation was made from. Edit an English message and its translations are stale
until edited or accepted:

```bash
prosebook status            # coverage and stale counts per locale
prosebook todo de > de.yaml # missing and stale entries, with context
prosebook import de de.yaml # each filled-in entry into its file, checked first
prosebook accept de cart.items
```

```text
$ prosebook todo de
# The button on a product that adds one to the cart.
# kind: action, surface: action
# en: Add one to cart
# stale, the source changed: Add {+one +}to cart
cart.add: In den Warenkorb
```

Stale translations still show; `stale: 'fallback'` shows the source instead.

### Translating with a model

prosebook calls no model. `todo --prompt` writes the prompt: how to reply, the locale's plural forms, the kinds and surfaces, the
guidelines that read the locale. `import` reads the YAML block out of the reply:

```bash
prosebook todo de --prompt | pbcopy
prosebook import de reply.md
```

An entry whose placeholders, tags or syntax don't hold is left out with its fix; the rest are written and linted. A stale
translation given back unchanged is accepted.

### Translation tools

```bash
prosebook export de de.xlf   # what todo lists, as XLIFF 2.0; --all for every entry
prosebook export en en.json  # the source, for a tool that translates JSON
prosebook import de de.xlf   # or de.json, flat or nested
```

- An XLIFF unit carries its key, context, kind, surface, args and, when stale, the word diff. Messages travel as ICU or MF2 text,
  not inline codes: a target with a `<ph>` is left out.
- A missing translation goes out `initial`, a stale one `initial` with its translation, a current one `translated`. A stale one
  comes back accepted only once the tool has moved it past `initial`.
- A unit whose source changed since it was exported is left out until exported again.

### Pseudo-locale

```ts
pseudo: 'en-XA'; // ⟦Ýóóúúŕ çááŕţ ·····⟧
```

Plain text on screen is hardcoded, a missing bracket is clipped text, and brackets inside brackets are a spliced sentence. Each
message is padded to the length a translation is likely to reach. Builds through the integrations leave it out.

## CLI

| Command                  |                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `init`                   | A config and a first catalog file.                                                              |
| `generate`               | The typed modules (`--check`, `--watch`).                                                       |
| `lint`                   | The words against the writing rules (`--fix`, `--fix --unsafe`); [in code](#without-a-catalog). |
| `status`                 | Coverage and stale translations per locale (`--strict`, `--verbose`).                           |
| `accept <locale> [keys]` | Marks stale translations as still right (`--all`).                                              |
| `todo <locale>`          | Missing and stale entries, ready to translate (`--prompt`).                                     |
| `export <locale> [file]` | XLIFF 2.0 or JSON for a translation tool (`--all`, `--format xliff\|json`).                     |
| `import <locale> [file]` | Translations from `todo`'s YAML, a model's reply, XLIFF or JSON (stdin without a file).         |
| `scan`                   | Hardcoded text, unread keys and unseen reads (`--strict`, `--lint`).                            |
| `extract [paths]`        | Hardcoded JSX text into the catalog (`--write`, `--area`).                                      |
| `migrate <1\|2>`         | The catalog in ICU MessageFormat or MessageFormat 2 (`--write`).                                |
| `diff [base]`            | The copy changed since a git revision (`--format markdown`).                                    |
| `rename <from> <to>`     | A key, or an area, everywhere it's written (`--write`).                                         |
| `find <words>`           | The entries saying those words, to read before adding one (`--kind`, `--surface`).              |
| `judge`                  | Each entry held to the guidelines by a model, asking only of what changed (`--check`).          |
| `approve [keys]`         | Pass entries as written against the rules they break, until they change ([Judge](#approving)).  |
| `check`                  | `generate --check`, `lint` and `status --strict`, for CI.                                       |

`--root <dir>` sets the project root. `lint`, `scan`, `status`, `judge` and `check` take `--format sarif`.

**Broken entries** (a message that doesn't parse, a missing field, drifted placeholders) are reported with their fix and left out;
every command carries on with the rest and fails at the end. An edit, fix or import is refused only for the problems it brings.

### Lint

`recommended` checks shape; `strict` adds sentence case, contractions, em dashes, `…`, American spelling, one path separator
(`Settings › General`) and banned filler words. A spaced hyphen between numbers or dates is a range, which takes an en dash
(`9am–5pm`, `Mar 30 – Apr 6`); an arrow with nothing after it (`View loop →`), a lone separator with no capital after it
(`origin → {hops}`) and a single slash (`Read / Write`) are no paths.

| Kind          | Words                                                | Ends with a period                               | No period | Case                       |
| ------------- | ---------------------------------------------------- | ------------------------------------------------ | --------- | -------------------------- |
| `name`        | 4                                                    |                                                  | yes       | sentence case, `bare-name` |
| `action`      | 3                                                    |                                                  | yes       | sentence case              |
| `description` | 2 sentences                                          | always                                           |           |                            |
| `state`       | 1 sentence (2 on `error`, `empty`, `hint`, `status`) | on `hint`, `status`, `error`, `empty`, `confirm` |           |                            |

An entry with no kind is held to none of these; `fragment: true` lifts the period and sentence rules.

| Rule                 | Catches                                                                         |
| -------------------- | ------------------------------------------------------------------------------- |
| `plural-count`       | `{count} files` outside a plural, which reads "1 files"                         |
| `plural-one`         | a `one` arm that writes `other`'s plural (`# files`), or `1` where `#` belongs  |
| `plural-forms`       | a plural missing a form its locale counts in (Polish's `few` and `many`); error |
| `plural-unused-form` | an arm for a form the locale never picks (English's `zero`)                     |
| `arm-endings`        | arms where some end with a stop and some don't                                  |
| `formatted-by-hand`  | `${price}`, `{rate}%`, `{hours}h`, or digits grouped by hand                    |
| `named-format`       | a [named format](#named-formats)'s options spelled out                          |
| `source-ending`      | a translation ending with a stop where its source doesn't, or the other way     |
| `duplicate`          | an entry saying what another says, as the same kind on the same surface         |
| `quotes`             | `"Einstellungen"` in German, which quotes `„Einstellungen“` (`lint.quotes`)     |
| `formality`          | `Sie` in German copy that says `du`, by `tone.formality` or the most entries    |
| `french-spacing`     | `Prêt?` in French, which takes a narrow no-break space before `?`               |
| `inverted-marks`     | a Spanish question that doesn't open with `¿`                                   |
| `full-width`         | `,` after Chinese or Japanese text, which take `，`                             |

`plural-forms` asks for `one` even where it says what `other` says (`one {# failed} other {# failed}`), for translators whose
language tells them apart; `plural-one` warns only where `other` counts a plural noun. A count that is never 1 says so with
`min: { count: 2 }`, and its plural is asked only for the forms counts from 2 take, in each language; `todo` and `export` tell
translators.

Translations are linted by the rules that hold in any language. Spellings, concepts, contractions, `…`, spacing and punctuation are
fixable: `prosebook lint --fix` writes them, checking the whole catalog first.

The summary counts each rule's findings, and names words `sentence-case` finds capitalized in 3 or more strings and
never written in lowercase, for `lint.properNouns`. Warnings alone exit 0: a rule CI should fail on is set to `'error'` under `lint.rules`.

`duplicate` says each group once, at the entry to keep. `prosebook lint --fix --unsafe` also merges each group: the first entry
stays (moved into `extract.shared` where the group spans areas), the others go with their translations, and every string literal
naming one reads the kept key. It's unsafe because words alike may be translated apart: a group whose translations differ in a
locale is left and named, and an entry exempt from `duplicate` is never merged. A read through a key prefix is named, to fix by
hand.

**Exemptions.** Where a rule is wrong about an entry, say why:

```yaml
legal.privacy:
  kind: name
  context: Links to the privacy policy.
  allow:
    sentence-case: The title of a legal document, which keeps its published capitals.
  en: Privacy Policy
```

```ts
lint: {
  reasons: { 'card-detail': "A card's detail line, which reads as a label." }, // allow: { period: card-detail }
  areas: { native: { 'sentence-case': 'off' } }, // a severity per area
  banned: ['simply'],
  spelling: { colour: 'color' },
  concepts: { tablet: 'device' }, // one word per concept
  properNouns: ['GitHub'],
},
```

A shrug (`Intentional.`) fails, and so does an exemption the entry no longer needs.

**Plugins as code.** A rule gets the entry and its readings, and returns findings:

```ts
import { defineConfig, definePlugin, words } from 'prosebook/config';

const house = definePlugin({
  name: 'house',
  rules: {
    'error-says-what-to-do': {
      description: 'An error says what failed and what to do next.',
      on: { surface: ['error'] }, // and kind, area, locale: 'all' or ['de']
      recommended: 'warn',
      check: ({ text }) => (words(text.primary).length < 4 ? ['say what to do next, not only what failed'] : []),
    },
  },
});

export default defineConfig({ lint: { plugins: [house], rules: { 'house/error-says-what-to-do': 'error' } } });
```

- `text.primary` takes every `other` arm, `text.variants` one reading per arm, `text.skeleton` the words every arm carries.
  Placeholders read as `HOLE`, and `’` as `'` in `variants`. `asWritten(match, context)` is a match as the message writes it
  (`{team}’s` for `${HOLE}'s`), which is what `{match}` shows in a data rule's message.
- With `on.locale`, a rule also gets `locale`, `ast` and the `source` readings. `catalog` holds every entry.
- A finding can be `{ message, match, fix, group }`: `match` (words or a regular expression) is what it points at, `fix` what
  `--fix` writes, and `group` (`{ key, message }`) a problem across entries, said once at `key`. A `match` taking in a `HOLE`
  points at the placeholder too, and has no fix, since a fix can't write the placeholder back.
- `recommended` and `strict` set the severity under each preset; `guide: true` puts the description in the writing guide.
  `lint.rules` and `lint.areas` set one rule's (`house/error-says-what-to-do`) or every rule's of the plugin (`house/*`).

**Plugins as data**, after [Vale](https://vale.sh)'s rule types, in a `prosebook.config.json` too:

| `type`           | Fields                                                                 | Fails when                                                    |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `existence`      | `words`, `patterns`, `message`                                         | the string says one of them                                   |
| `substitution`   | `swap: { word: use }`, `message`                                       | the string says a word the product writes another way         |
| `occurrence`     | `count` (`words`, `sentences`, `characters`), `max`, `min`, `relative` | the count is out of bounds, or out of ratio with the source's |
| `capitalization` | `case` (`sentence`, `title`, `lower`, `upper`), `exceptions`           | a word is out of case                                         |
| `conditional`    | `when`, `require`, `message`                                           | the string matches `when` but not `require`                   |
| `guideline`      | `description`                                                          | a model judges it broken, with [`judge`](#judge)              |

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
            "relative": true
          },
          "sign-in": { "type": "substitution", "description": "One verb for signing in.", "swap": { "log in": "sign in" } },
          "du": { "type": "guideline", "description": "Address the reader as du, never Sie.", "on": { "locale": ["de"] } }
        }
      }
    ]
  }
}
```

Every rule is checked when the config loads.

### Judge

A guideline is about meaning, so no rule finds a string breaking it. A decision model can: `prosebook judge` asks one, or
several, whether each entry keeps to each guideline that reads it, the [voice guidelines](#voice-guidelines) and your own.
The author is a judge too: `prosebook approve` passes an entry as written, whatever the models say.

```bash
npm install ai @ai-sdk/typesafe-ai # TYPESAFE_AI_API_KEY; or ai alone, through the AI Gateway
```

```ts
// prosebook.config.ts
import { typeSafeAi } from '@ai-sdk/typesafe-ai';
import { decisionJudge } from 'prosebook/ai';
import { defineConfig } from 'prosebook/config';

export default defineConfig({
  judge: {
    models: [decisionJudge(typeSafeAi.decisionModel('jev-latest'), { price: { input: 0.042 } })], // dollars per million tokens
    prompt: 'An incident tool for on-call engineers, read mid-incident.', // beside every entry, as `notes`
    threshold: 0.7, // the probability from which an entry breaks a guideline
    concurrency: 8, // requests in flight
  },
});
```

```text
prosebook: judged 1,345 of 1,345 entries (1,345 requests, 18,830 questions) in 35.7s; the lock had the other 0
  207ms a request (median), 451ms at most; 4,250,907 input tokens, 353,735 output; $0.1785
warn  copy/catalog/form.yaml:12:1 form.assignee: [voice/field-names, voice/own-words] breaks these guidelines, the models judge

Guidelines:
  voice/field-names: A label over a value names the field, as a noun: …
```

Each entry's broken guidelines are one line, and each guideline's words are said once, after them; SARIF has a result per
guideline, with its words.

- **One request per entry, locale and model**, through the AI SDK's `experimental_decide`. The entry is the state: its
  message, key, context, kind, surface, what its placeholders hold, the source beside a translation, the `prompt` as `notes`,
  and every guideline it's held to. Each guideline is two yes-or-no questions: whether it speaks of a message in this role,
  and whether the message breaks it, weighed with the other guidelines, which give way to one another where they pull apart.
  The probability it's broken is their product.
- **Several models** each answer, and an entry breaks a guideline by the mean of their probabilities. A model of your own, for
  one the AI SDK doesn't reach, is a `Judge` from `prosebook/config`: an `id`, which names its answers in the lock, and
  `judge({ state, questions })` giving each question's probability of a yes.
- **Verdicts live in the lock**, under `judged`, one line per entry and locale, by guideline and judge, each beside a hash of everything its
  request said: the model, the prompt, the entry and the guidelines, so changing one asks again of every entry it reads. A
  run asks only of what changed since, and only the models that haven't answered, and says how long it took, the tokens and
  what they cost.
- **`lint` and `check` read the verdicts** from the lock, with no model and no key, and `check` warns of entries not judged
  as they are now. The lock keeps the probability, so a new `threshold` needs no new run.
- **`--check`** asks nothing and fails on any entry not judged as it is now.

#### Approving

Where the models, or a rule, are wrong about an entry, its author approves it as written:

```bash
prosebook approve form.assignee            # every rule it breaks, and every guideline it's held to, in the source
prosebook approve form.assignee --rule voice/field-names --locale de
prosebook approve --all                    # every entry breaking one
```

An approval is the author's verdict, kept in the lock as `author` beside the models', under a hash of the entry and the
rule alone. It passes the entry whatever the rule or the models say, and no model is asked of it, until the entry's words,
role or context change, or the rule's description; a new model or prompt keeps it. It needs no `judge` for a rule that isn't
a guideline. `allow: { voice/no-intent: <why> }` passes an entry for good instead, through every edit, and is called stale
only once a verdict says the entry keeps to the guideline.

The default threshold is from the guidelines' own examples: Jev judged each bad example broken from 0.7 to 0.96, and none of
the good ones from 0.7. Below it, the model is more often unsure than right.

### Scan

```bash
prosebook scan
```

Finds text a person reads that is still in the code: JSX text, readable attributes (`title`, `alt`, `placeholder`, `aria-label`),
what expressions render (`{pending ? 'Saving…' : 'Save'}`, `{name ?? 'Guest'}`), the text given to `scan.calls` (`toast`, `alert`,
`confirm`), and in components the values of `scan.properties`. Also catalog keys no code reads, and [unseen reads](#pruning). Tests
and stories are left out, and their helpers (`A.spec.helper.tsx`); mark a deliberate literal with `prosebook-ignore` on its line or the line above.

JSX text is read as it renders: `&nbsp;` and `&ge;` as their characters, and a sentence with values in it as one string,
`Restart from {clientName}.` found as `Restart from ${clientName}.`. Classes are not text: `className=`, what `cn`, `clsx`,
`cva`, `tv` and `twMerge` are given, and any string of utility classes (`block h-full cursor-[inherit]`).

It also finds numbers, dates, lists and relative times formatted in code, which show the browser's locale rather than the
copy's: `toLocaleString()`, `toLocaleDateString()`, `new Intl.NumberFormat(…)` and the other `Intl` formatters, a relative
time's unit picked in code (`rtf.format(-days, 'day')`), and in components: items joined as text a person reads, `.join(', ')`
or with any separator, `.join(' · ')` (naming the list format with that separator; not `','`, `'/'`, spaces alone or classes,
which build ids, paths and lines), numbers rounded as text,
`n.toFixed(1)` and `n.toPrecision(3)`, which ignore the locale (1.5 stays "1.5" in German), a value with a unit written after it,
`{size} MB` or `` `${ms} ms` ``, which keeps English order and words, and text sorted in the environment's
locale, `a.localeCompare(b)` and `new Intl.Collator()` with no locale given (`copy.compare` sorts in the copy's; ids and ISO times,
`a.id`, `b.createdAt`, sort as raw strings and aren't reported). A rounded number in a style or an attribute no person reads,
before a CSS unit (`${w.toFixed(1)}px`) or turned back into a number (`Number(n.toFixed(2))`) isn't reported either. Each says what to read instead, naming the [format](#named-formats) its options match:

```
src/Usage.tsx:4:13 formatted in code: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }): read copy.number(…, 'price'), which shows it as the format the config names
src/Metric.tsx:7:9 formatted in code: ms.toFixed(1): read copy.number(ms, { minimumFractionDigits: 1, maximumFractionDigits: 1, style: 'unit', unit: 'millisecond' }), or name them under formats.number and pass the name
```

`scan` reports them; `scan --strict` fails on them, as on hardcoded text. A formatter only asked its options, as in
`Intl.DateTimeFormat().resolvedOptions().timeZone`, formats nothing and isn't reported, nor is the [formatters](#formatters) module,
whose `Intl` calls are the copy's own formats.

Code whose text no person reads, as a server tool's results, leaves a check out by folder, file or glob:

```ts
scan: {
  ignore: {
    'formatted-in-code': ['src/server', '**/*.server.ts'], // and 'hardcoded-text'
    '*': ['src/admin'], // every check
  },
},
```

- Paths are from the config's folder; a folder covers everything under it, and `**/server` every folder named so.
- The keys an ignored file names still count, so they aren't reported unused.

`scan --lint` holds the hardcoded text to the writing rules too, as [without a catalog](#without-a-catalog), until `extract`
moves it into the catalog.

### Without a catalog

An app that keeps its text in the code can still hold it to the writing rules:

```ts
export default defineConfig({ catalog: false, lint: { extends: 'strict' } });
```

```bash
prosebook lint
```

```text
error src/Sync.tsx:12:7 "It syncs every five minutes.": [voice/stands-alone] …
```

- `lint`, `judge`, `approve` and `check` read the text `scan` finds, each string an entry of its own. A template's
  `${user.name}` reads as the placeholder `{name}`, and `${rate.toFixed(1)}` as `{rate}`. A pick between two strings
  stays in its sentence: `{n === 1 ? 'hop' : 'hops'}` reads as `{n, plural, one {hop} other {hops}}`, any other test as
  a select, so each arm is linted in place.
- Each takes the [kind and surface](#fields) its place says plainly, where the config defines them: a `<button>` or a
  component named `…Button` or `…MenuItem` is an action; `<h1>`–`<h6>`, `<th>` and `…Title` or `…Heading` a name on a heading;
  `<label>`, `<legend>`, `<dt>`, `…Label`, and `label=` or `label:` a name on a label, though `label=` takes its element's role
  where it has one (`<Tooltip label>` a tooltip, `<MenuItem label>` an action); `<option>` a choice; `placeholder=` a
  placeholder; `aria-label=` and `alt=` aria; `title=` and `…Tooltip` a tooltip; `toast(…)` a state on a toast, and
  `….error(…)` on an error; a `description:` a description. Words styled in a `<span>` or `<strong>` take the role of the
  element around them. Text anywhere else, in a `<p>` or a `<Link>`, has none, so rules that name one pass it by.
- A guess can be wrong, so `lint.guessed` sets severities for text whose role was guessed, as `lint.areas` does for an
  area, which text in code has none of. `scan.roles` turns guesses off: `false` for all of them, or a kind or surface named
  `false`, which takes every guess naming it with it.

  ```ts
  lint: { guessed: { 'word-budget': 'off', 'sentence-case': 'warn' } },
  scan: { roles: { heading: false } }, // a heading is no name either
  ```

- An exemption is a comment on the line or the line above, held to the reasons an `allow` is:
  `{/* prosebook-allow voice/stands-alone: the heading above names the sync */}`.
- `prosebook approve src/Sync.tsx:12`, or the text itself, approves the words: the approval holds wherever they move, and
  ends once they change. Each approval drops those of words no longer in the code.
- No `--fix`, and the commands that read a catalog, such as `generate` and `status`, are refused. So are config options only a
  catalog reads (`locales`, `out`, `messageFormat`, `native`, ...).
- Set `catalog` to a folder and run `prosebook extract` to move the text into a catalog.

### SARIF

```yaml
- run: npx prosebook check --format sarif > prosebook.sarif
- uses: github/codeql-action/upload-sarif@v4
  if: always()
  with:
    sarif_file: prosebook.sarif
    category: prosebook
```

A [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) log on stdout, text on stderr, the same exit code.
Each result points at its line in the catalog, translation or JSX. `scan` writes a log of its own: upload it with its own `category`.

### Extract

```bash
prosebook extract                     # the plan, for every .tsx/.jsx under scan.dirs
prosebook extract src/Cart.tsx --write
prosebook extract src/settings --area settings --write
```

```tsx
// before
<p>Hi {user.name}, read the <a href="/terms">terms of <b>sale</b></a>.</p>
<input placeholder="Search items" />

// after
<p><Text id="profile.hi-read-the-terms" values={{ name: user.name, a: (chunks) => <a href="/terms">{chunks}</a>, b: (chunks) => <b>{chunks}</b> }} /></p>
<input placeholder={t('profile.search-items-placeholder')} />
```

```yaml
# TODO(prosebook extract): check the key, kind and context.
profile.hi-read-the-terms:
  context: 'TODO: say where this appears and what it does (found in Profile, the text of a <p>).'
  args:
    name: 'TODO: what `user.name` holds'
  en: Hi {name}, read the <a>terms of <b>sale</b></a>.
```

- Whole sentences, not fragments: text, simple expressions and inline elements in one element become one message.
- The area is the file's name in kebab case (`CartPanel.tsx` → `cart-panel`). `extract: { shared: 'common' }` gathers words every
  feature says (`Cancel`) in one area.
- `kind` and `surface` come from the element (`<button>` → action, `<h2>` → heading).
- `{n} {n === 1 ? 'file' : 'files'}` becomes one plural. A sentence whose parts code picks stays, with a warning.
- Placeholders are typed through the project's TypeScript 7: a number becomes `{n, number}`, a `Date` `{when, date, medium}`, a
  number before a plural noun a plural. Without it, the syntax decides.
- Code-like text, `<code>`, `<pre>`, `<kbd>` and `prosebook-ignore` lines stay.
- Draft contexts and args are warnings in `generate` and `check` until rewritten.

### Find

```text
$ prosebook find "check out" --kind action
prosebook: 1 entry says "check out" as kind action: read it rather than adding another
  cart.checkout (action, action): Check out  copy/catalog/cart.yaml:37
```

The entries saying those words, the closest first: every arm of a message is read, without case or punctuation, and the words of
a key past its area. The writing guide tells whoever writes next to run it before adding an entry.

### Rename

```bash
prosebook rename cart.checkout pay.button   # and cart.checkout.hint with it
prosebook rename cart basket                 # an area: cart.yaml becomes basket.yaml
```

Renames in the catalog, every translation, the lock, every message [saying it](#names-in-other-messages) and every string literal
naming the key under `scan.dirs`. A read through a
prefix moves with an area (``t(`cart.${id}`)``); one that only may reach a renamed key is named, to rename by hand. A dry run
unless `--write`, checked first, then regenerated.

### Diff

```text
$ prosebook diff origin/main
prosebook: 3 entries changed since origin/main: 2 changed, 1 added. 1 translation now stale.

changed  cart.checkout: [-Check out-]{+Pay now+}
         stale in de: their translations were made from the text before
changed  cart.title: Your cart
  de     [-Warenkorb-]{+Einkaufswagen+}
added    cart.total: {+Total: {sum, number, ::currency/EUR}+}
         not yet translated in de
```

The base is `HEAD` by default. A key gone and one come with the same words is a rename. `--format markdown` writes a table for a
pull request's comment:

```yaml
# .github/workflows/copy.yml
name: Copy review
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  copy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # the base branch, to compare with
      - uses: actions/setup-node@v7
      - run: npm ci
      - run: npx prosebook diff origin/${{ github.base_ref }} --format markdown > copy.md
      - name: Post the review, or update the one posted before
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.number }}
        run: |
          marker='<!-- prosebook diff -->'
          id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" --paginate \
            --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | head -n 1)
          if [ -n "$id" ]; then gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -F body=@copy.md
          else gh pr comment "$PR" --body-file copy.md; fi
```

A pull request from a fork gets a token that can't comment: post from a `workflow_run` workflow instead.

## Builds

### Pruning

A build ships only the messages some module names. Any string literal equal to a key counts, so keys in arrays and maps are kept;
``t(`status.${state}`)`` and `t('status.' + state)` keep every key under `status.`. For keys built another way:

```ts
prosebook({ keep: ['plan.*'] });
```

A pruned message would show as its key, so a build fails on a read whose key it can't see:

```ts
t(item.key); // fails the build
t(STATUS[s]); // fine: STATUS is a const map of keys in this module
t(id); // prosebook-ignore: every key it reads is written elsewhere
```

Reads are known by name: `t` and `rich`, alone, as methods or destructured, and `<Text>` from any binding, in `.vue`, `.svelte`
and `.astro` markup too. `prune: 'loose'` skips the check, `prune: false` ships everything. Under Next and Bun the source under `scan.dirs` is
read for keys.

### Splitting

```ts
prosebook({ split: true }); // Vite and Bun
withProsebook(config, { split: true }); // Next.js
```

Each locale is split by area, so `lazy(() => import('./Cart.tsx'))` brings the `cart` messages with it:

- An area goes in the chunk of the modules that read it: the main chunk, a route's, or a shared one.
- The source and the `bundled` locales ship with their areas; other locales load area by area, a file per chunk.
- A lazy route renders in the reader's language from its first frame, with no change to the code reading it.
- In the browser only: a server render loads whole locales. Needs top-level `await`.
- Bun's `Bun.build` needs `splitting: true`; in a full-stack build only the pages split. Under Next, client components split.
- A `prosebook-ignore` read finds its area only once some module loaded before it names one of its keys; before then it shows its
  key, reported through `onError`.

**Preloading.** A server-rendered page in a lazy locale hydrates once its areas' files load. Under Vite and Bun, the server can link
them ahead (build the client before the server):

```tsx
import { preloadModule } from 'react-dom';

const copy = createCopy(catalog, { locale, preload: (href) => preloadModule(href, { as: 'script' }) });
```

Under Next the server can't link them; only hydration waits one request more.

## Inspector

In dev, with any integration: hold <kbd>Alt</kbd> to see which entry each string comes from, and Alt-click one to edit it on
the page.

- The dialog opens on the text as read, in its locale, the source beside a translation, with lint's findings as you type and a
  **Fix** for each. **More** holds the rest of the entry: its other locales, context, kind, surface, what each placeholder holds,
  and stays open once opened.
- <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> saves after checking the whole catalog; the page updates in place.
  **Open in editor** opens the entry in your editor instead, in the file of the field last in focus.
- **Comment** and **Mark for removal** write `comment:` and `remove: true`, warnings in `generate` and `check` for whoever edits
  next, a coding agent included.
- It matches the text under the pointer to what the runtime read: text changed after reading (`.toUpperCase()`) can't be traced.
  Under Vite and Astro that includes what the dev server rendered; under Next and Bun, only text read in the browser.
- The editor: Vite's and Astro's `/__open-in-editor` (`LAUNCH_EDITOR`), Next's `/__nextjs_launch-editor` (`REACT_EDITOR`), Bun's
  `Bun.openInEditor` (`VISUAL`, `EDITOR`). Turn it off with `inspect: false`.
- Another shortcut, where Alt is taken: `inspect: { modifiers: ['Control', 'Shift'], button: 'right' }`. `modifiers` are held,
  and no others, to show the keys (`'Alt'`, `'Control'`, `'Meta'`, `'Shift'`; `['Alt']` unset), and `button` is pressed with
  them to edit (`'left'`, `'middle'`, `'right'`; `'left'` unset). Exactly those keys, so AltGr, which is Control and Alt, is
  not Alt.

## Playground

`prosebook/playground` is the tools built for a browser, over files held in memory: what `generate`, `lint` and `lint --fix`
make of a catalog, for an editor or a demo of your own. The [homepage's playground](https://gkurt.com/prosebook/#playground)
runs on it.

```ts
import { createCopy } from 'prosebook';
import { fix, play } from 'prosebook/playground';

const files = { 'copy/catalog/cart.yaml': yaml, 'copy/locales/de/cart.yaml': german };
const config = { pseudo: 'en-XA', lint: { extends: 'strict' }, native: [{ language: 'swift', out: 'ios/Copy.swift' }] };

const played = play(files, config);
played.generated['src/copy/index.ts']; // the types, as generate writes them; native targets' files too
played.problems; // an entry or translation with an error is left out, and said
played.findings; // the lint's, each with its fix where it has one
const copy = createCopy(played.catalog); // compiled and run, in every locale

const fixed = fix(files, played.findings, config); // the files with the fixes made, if the catalog still loads
```

- The config is the object `prosebook.config.ts` would export; nothing is read from disk, and `scan` doesn't run.
- It compiles with `new Function`, which a page's Content Security Policy must allow (`'unsafe-eval'`).

## Native targets

### Rust, Swift, Kotlin

```ts
// prosebook.config.ts
native: [
  { language: 'rust', out: 'src-tauri/src/copy.rs', keys: ['tray', 'menu'] },
  { language: 'swift', out: 'mac/Sources/Copy.swift' },
  { language: 'kotlin', out: 'android/app/src/main/java/shop/Copy.kt', package: 'shop' },
],
```

```rust
let copy = Locale::negotiate(&["de-AT", "en"]); // de-AT, then de, then the source
let quit: &'static str = copy.quit();           // tray.quit, less the `keys` prefix
let count = copy.recordings(3);                 // "3 Aufnahmen"
copy.printed(copy::DateTime::from_unix(seconds, offset));
```

```swift
let copy = Copy.negotiate(Locale.preferredLanguages)
label.stringValue = copy.trayRecordings(count: 3)
```

```kotlin
val copy = Copy.negotiate(listOf(Locale.getDefault().toLanguageTag()))
label.text = copy.trayRecordings(3)
```

- A file per target, holding every locale, with no dependencies. Members are named for their keys (`tray_recordings`,
  `trayRecordings`); `keys` takes only the keys under those prefixes.
- Plurals, numbers and dates are checked against `Intl` as they're generated, so they say what the browser says.
- A date is a `Date` in Swift and an `Instant` in Kotlin, in the device's time zone; Rust's `DateTime::from_unix` takes the offset.
- `generate` fails, with the fix, on what can't be written: tags, compact notation, significant digits, a long unit, a time zone
  name, a non-Gregorian calendar, an MF2 option from an argument. Leave such keys out of `keys`.

### Android resources

```ts
native: [{ language: 'android', out: 'android/app/src/main/res', keys: ['android'] }],
```

```xml
<!-- Counts the cart. count: how many items the cart holds. -->
<plurals name="cart_items">
    <item quantity="one">%1$d item in the cart.</item>
    <item quantity="other">%1$d items in the cart.</item>
</plurals>
```

- `values/strings.xml` for the source and `values-de`, `values-pt-rBR`, `values-b+sr+Latn` for the rest. `name` renames the file.
- `android.sign-in.denied` is `R.string.sign_in_denied`; read a plural with `getQuantityString(R.plurals.cart_items, count, count)`.
- Holds text, `{name}` placeholders as `%1$s`, and one cardinal plural. A select, a date, a formatted number, an ordinal, an offset,
  an exact arm or a tag fails `generate`.

### Apple string tables

```ts
native: [{ language: 'apple', out: 'src-tauri/Resources', keys: ['macos'], plist: 'src-tauri/Info.plist' }],
```

```c
/* Asks for the camera. */
"NSCameraUsageDescription" = "Corner Shop scans a product's barcode with the camera.";
```

- A `<locale>.lproj/<name>.strings` per locale: plain `.strings`, which any bundler can copy into `Contents/Resources`.
- With `plist`, the table is `InfoPlist`, and `macos.ns-camera-usage-description` is `NSCameraUsageDescription`. The key must be in
  the plist, and the plist's text must be the source's.
- Without it, the table is `Localizable`, placeholders `%1$@`. A plural goes into a `.stringsdict` beside it, its count `%N$lld`.
- A select, a date, a formatted number, a tag or a nested plural fails `generate`; use the Swift target for those.

## Config

```ts
// prosebook.config.ts
import { defineConfig } from 'prosebook/config';

export default defineConfig({
  catalog: 'copy/catalog', // source YAML; false to lint the text in code
  locales: 'copy/locales', // translations
  out: 'src/copy', // generated modules
  lock: 'copy/lock.json',
  source: 'en',
  messageFormat: 1, // or 2
  isolate: 'rtl', // MF2: isolate placeholders in right-to-left locales; 'always', or false
  formats: {}, // named number, date, list, duration and relative formats
  formatters: undefined, // a module of the app's own number, date and relative formats, as code
  bundled: [], // locales shipped in the main bundle; the rest load on first use
  pseudo: false, // or 'en-XA', in dev only
  stale: 'use', // or 'fallback'
  language: 'ts', // or 'js'
  importExtension: '.js', // '.ts' for Node's type stripping, '' for bundler resolution
  require: ['context'],
  extends: [], // presets: 'plain', 'professional', 'friendly', 'technical', 'playful', 'formal', or a team's own
  tone: {}, // notes, formality, areas: over the presets' tone
  kinds: {/* name, action, description, state */},
  surfaces: {/* label, heading, tooltip, ... */},
  lint: {
    extends: 'recommended', // or 'strict'
    plugins: [],
    rules: {},
    areas: {},
    guessed: {}, // severities for text in code whose role was guessed
    reasons: {},
    quotes: {}, // { de: ['»', '«'] }
    banned: [],
    spelling: {},
    concepts: {},
    properNouns: [],
    pathSeparator: '›',
  },
  judge: undefined, // { models, prompt, threshold: 0.7, concurrency: 8 }: decision models for `prosebook judge`
  guide: 'copy/catalog/WRITING.md', // false for none
  native: [], // Rust, Swift, Kotlin, Android, Apple
  extract: {}, // shared: an area for words every feature says
  scan: { dirs: ['src'] }, // and attributes, calls, properties, ignore, roles
});
```
