# <img src="https://gkurt.com/prosebook/icon.svg" width="40" height="40" alt="" align="top"> prosebook

Every string your app shows, in one typed catalog. For React, React Native, Preact, Vue, Svelte, Solid and any JavaScript.

[Homepage](https://gkurt.com/prosebook/) · [Playground](https://gkurt.com/prosebook/#playground) · [API reference](API.md)

The words live in YAML, one entry per string, with the context a translator needs beside them. The code
holds only keys, so changing what the app says is an edit to the catalog, not to the code.

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

- **Typed.** A missing key, a misspelled key or a missing argument is a type error, and completing a key shows its text.
- **Compiled.** ICU MessageFormat or MessageFormat 2, compiled to plain functions. No parser ships; the runtime is under 4.7 KB gzipped.
- **Checked.** Placeholders that drift between the source and a translation fail the build, and a translation whose source
  changed is marked stale.
- **Pruned.** Vite, Next.js, webpack, Rspack, Metro, Bun and Astro builds ship only the messages the code reads; Vite, Next.js,
  Bun and Astro can split them by route.
- **Times as times.** `{at, relative}` says "5 minutes ago" from the time itself, and `<Text>` keeps it fresh:
  [relative times](API.md#relative-times).
- **Written well.** A lint holds the words to a writing guide: word budgets, periods, case, plurals, punctuation per language.
- **Native too.** The same catalog generates Rust, Swift and Kotlin, and Android's and Apple's string resources.

## Quick start

```bash
bun add prosebook
bunx prosebook init       # prosebook.config.ts and copy/catalog/app.yaml
bunx prosebook generate   # src/copy/: a module per locale, and the types
```

With a bundler, the plugin generates on start and on every catalog edit, and the page updates in place:

```ts
// vite.config.ts
import { prosebook } from 'prosebook/vite';

export default defineConfig({ plugins: [react(), prosebook()] });
```

```ts
// next.config.ts
import { withProsebook } from 'prosebook/next';

export default withProsebook({/* your Next config */});
```

```toml
# bunfig.toml
[serve.static]
plugins = ["prosebook/bun"]
```

`generate --check` compares what it writes byte for byte. The modules and `WRITING.md` carry the comments that keep linters
and formatters off them; keep `copy/catalog/catalog.schema.json`, which can't, and ideally `src/copy/` out of yours
([why](API.md#integrations)). See [Integrations](API.md#integrations) for Next.js, [webpack and Rspack](API.md#webpack-and-rspack),
[React Native and Expo](API.md#react-native-and-expo), Bun, [Astro](API.md#astro) and shared catalogs.

## Reading messages

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
  const { t, rich, setLocale } = useCopy();
  return (
    <>
      <h2>{t('cart.title')}</h2>
      <Text id="cart.items" values={{ count }} />
      <p>{rich('cart.terms')}</p>
      <button onClick={() => setLocale('de')}>Deutsch</button>
    </>
  );
}
```

| Framework         | Import                   | Reference                                   |
| ----------------- | ------------------------ | ------------------------------------------- |
| React             | `prosebook/react`        | [React](API.md#react)                       |
| Server Components | `prosebook/react/server` | [On a server](API.md#on-a-server)           |
| Preact            | `prosebook/preact`       | [Preact](API.md#preact)                     |
| Vue               | `prosebook/vue`          | [Vue](API.md#vue)                           |
| Svelte 5          | `prosebook/svelte`       | [Svelte](API.md#svelte)                     |
| Solid             | `prosebook/solid`        | [Solid](API.md#solid)                       |
| Anything else     | `prosebook`              | [Plain JavaScript](API.md#plain-javascript) |

## Writing messages

```yaml
en: 'Hello, {name}.'
en: '{n, plural, one {# file} other {# files}}'
en: '{mode, select, dark {Dark} other {Light}}'
en: 'Total: {total, number, ::currency/EUR}'
en: '{when, date, medium} at {when, time, short}'
en: 'Ran {tools, list} in {took, duration}' # "Ran grep, sed, and awk in 3 min, 5 sec"
en: 'By checking out you agree to our <link>terms</link>.'
```

Each placeholder's type comes from the message: `n: number`, `mode: 'dark' | (string & {})`, `when: Date | number`, `tools: readonly string[]`. Set
`messageFormat: 2` to write [MessageFormat 2](API.md#messageformat-2) instead, name formats used across the app once in
the config with [named formats](API.md#named-formats), and say a name in other messages with
[`{app.title, entry}`](API.md#names-in-other-messages).

## Translating

Translations hold only `key: translation`; the context stays in the catalog.

```yaml
# copy/locales/de/cart.yaml
cart.items: '{count, plural, =0 {Dein Warenkorb ist leer.} other {# Artikel im Warenkorb.}}'
```

```bash
prosebook status              # coverage and stale translations per locale
prosebook todo de > de.yaml   # what German is missing, with context
prosebook todo de --prompt    # the same, as a prompt for a model
prosebook import de de.yaml   # written back, each entry checked first
prosebook export de de.xlf    # XLIFF 2.0 or JSON for a translation tool
```

## Checking

```bash
prosebook lint      # the words against the writing rules (--fix)
prosebook scan      # hardcoded text, and keys no code reads
prosebook find "Save" # the entries that say it already, before adding one
prosebook extract   # move hardcoded JSX text into the catalog
prosebook check     # all of it, for CI (--format sarif for code scanning)
```

```text
error copy/catalog/cart.yaml:25:1 cart.add: [no-period] an action ends without a period
error copy/locales/de/cart.yaml:4:1 cart.add: [source-ending] the source ends with a stop, and this does not: end it as the source does
```

Add your own rules as code or as data, scoped by kind, surface, area and locale. What no rule can check goes in
`copy/catalog/WRITING.md`, generated for a coding agent to read before it writes, with [guidelines against the habits of
generated copy](API.md#voice-guidelines). See [Lint](API.md#lint).

## And more

- [**Inspector**](API.md#inspector): in dev, Alt-click any text on the page to edit its entry there.
- [**Splitting**](API.md#splitting): each route loads only the messages it reads, in every locale.
- [**Rename**](API.md#rename): a key or an area, renamed in the catalog, every translation and the code.
- [**Diff**](API.md#diff): the copy a pull request changes, as words, posted as a comment.
- [**Without a catalog**](API.md#without-a-catalog): the text in the code held to the same rules, for an app that hasn't moved it into a catalog.
- [**Tone**](API.md#tone): `extends: 'friendly'`, or `plain`, `professional`, `technical`, `playful`: a tone said in the writing guide, the translation prompt and to the judge, with the rules that go with it.
- [**Judge**](API.md#judge): each entry held to the guidelines no rule can check by decision models, asking only of what changed, and passed by its author's approval where they're wrong.
- [**Native targets**](API.md#native-targets): Rust, Swift, Kotlin, Android resources and Apple string tables.
- [**Pseudo-locale**](API.md#pseudo-locale): accented, padded text that shows what was missed.
- [**Playground**](API.md#playground): the tools in a browser, over files in memory, as the homepage's playground runs them.

## Examples

Each is a small shop in English, German and the pseudo-locale.

| Example                                              |                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| [`examples/vite`](examples/vite)                     | React with Vite and the inspector; the cart is a lazy route, split. |
| [`examples/preact`](examples/preact)                 | Preact with Vite.                                                   |
| [`examples/vue`](examples/vue)                       | Vue single-file components, typed by `vue-tsc`.                     |
| [`examples/svelte`](examples/svelte)                 | Svelte 5 with runes, typed by `svelte-check`.                       |
| [`examples/solid`](examples/solid)                   | Solid, updating in place on a locale switch.                        |
| [`examples/rspack`](examples/rspack)                 | React with Rspack, pruned in production.                            |
| [`examples/next`](examples/next)                     | Next.js, with server components reading a copy per request.         |
| [`examples/tanstack-start`](examples/tanstack-start) | TanStack Start, rendered on the server in the request's locale.     |
| [`examples/bun`](examples/bun)                       | `Bun.serve` with a React page and the inspector.                    |
| [`examples/node`](examples/node)                     | No framework and no bundler: a Node script prints a receipt.        |

The homepage, [`site`](site), is an Astro site reading its words from a catalog of its own.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
