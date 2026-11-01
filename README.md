# copydeck

Every string your app shows, in one typed catalog. For React and any JavaScript.

A _copy deck_ is the document UX writers keep with every string in a product. copydeck makes it
the source of truth: the words live in YAML, one entry per string, with the context a translator
needs beside them, and the code holds only keys. Changing what the app says is an edit to the
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
- **Compiled.** `copydeck generate` turns each ICU message into a plain function. The browser parses
  nothing: no ICU parser ships, no `eval`, and the runtime is about 2.5 KB gzipped.
- **Checked.** Placeholders that drift between the source and a translation fail the build. A
  translation whose source has changed since is marked stale, automatically.
- **Pruned.** A Vite build ships only the messages the code names.
- **Written well.** An optional lint holds the words to a writing guide: word budgets per kind of
  string, periods, sentence case, banned filler.

## Quick start

Not on npm yet: build it here (`bun run build`) and add it by path.

```bash
bun add copydeck
```

```bash
bunx copydeck init
```

`init` writes `copydeck.config.ts` and `copy/catalog/app.yaml`. Then:

```bash
bunx copydeck generate
```

This writes `src/copy/`: one module per locale and an `index.ts` with the types. With Vite, add the
plugin instead and generation happens on start and on every catalog edit:

```ts
// vite.config.ts
import { copydeck } from 'copydeck/vite';

export default defineConfig({ plugins: [react(), copydeck()] });
```

### In React

```tsx
import { createCopy, preferredLocales } from 'copydeck';
import { CopyProvider, Text, useCopy } from 'copydeck/react';
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

### In plain JavaScript

```js
import { createCopy } from 'copydeck';
import { catalog } from './copy/index.js';

const copy = createCopy(catalog, { locale: navigator.languages });
await copy.ready;
document.title = copy.t('app.title');
copy.subscribe(() => render());
```

Set `language: 'js'` in the config to generate `.js` modules with a `.d.ts` beside the index. On a
server, create one `copy` per request.

## The catalog

One file per area, `copy/catalog/<area>.yaml`. A key's first segment names its file, so
`cart.items` lives in `cart.yaml` and nowhere else; searching for a key finds its entry.

| Field      |                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `en`       | The message, in ICU MessageFormat. The field is named after `source` in the config.                     |
| `context`  | One sentence telling a translator where the string appears. Required by default.                        |
| `args`     | What each placeholder holds, one line each. Required for every placeholder when `context` is.           |
| `kind`     | What sort of string it is: `name`, `action`, `description`, `state`. The lint holds each to its budget. |
| `surface`  | Where it sits: `label`, `heading`, `tooltip`, `error`, `empty`, `hint`, ...                             |
| `fragment` | `true` where it completes something beside it, so sentence rules don't apply.                           |
| `allow`    | Lint rules the entry is exempt from, each with the reason.                                              |

`key: message` is the shorthand for an entry with nothing to say about itself (set `require: []`).
Kinds and surfaces are configurable; `copydeck generate` writes `catalog.schema.json` beside the
catalog, so an editor with the YAML language server completes and explains every field:

```yaml
# yaml-language-server: $schema=./catalog.schema.json
```

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
en: 'By checking out you agree to our <link>terms</link>.' # a tag: an element inside the sentence
```

A placeholder holds a number, a name or something a person typed, never a translated fragment: a
word that changes with the sentence belongs in a `plural` or `select` arm. A skeleton the formatter
would silently drop (`::compact-shortt`) fails the build instead of reaching the screen unformatted.

**Tags** keep a sentence with a link or bold run inside it as one entry, so a translator can move the
element. `t()` renders a tag as its text; `rich()` and `<Text>` render it through a function. Tags
the provider renders by default don't have to be passed at each call. Tell the types which ones those
are:

```ts
declare module 'copydeck' {
  interface Register {
    tags: 'link' | 'b';
  }
}
```

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
copydeck status            # coverage and stale counts per locale
copydeck todo de           # missing and stale entries, with context, ready to translate
copydeck accept de cart.items
```

Stale translations still show by default; `stale: 'fallback'` shows the source instead.

**Pseudo-locale.** `pseudo: 'en-XA'` generates `⟦Ýóóúúŕ çááŕţ⟧` from the source. Switch to it and
any plain text on screen is hardcoded, a missing bracket is clipped text, and brackets inside
brackets are a sentence spliced from fragments.

## Checks

```bash
copydeck lint     # the words against the writing rules
copydeck scan     # hardcoded text in JSX, and catalog keys no code reads
copydeck check    # generate --check, lint and status --strict, for CI
```

**Lint.** `recommended` checks shape: word budgets per kind, periods, bare names, whitespace.
`strict` adds sentence case, contractions, em-dashes, `…`, American spelling and a list of filler
and marketing words. Add your own `banned`, `spelling` and `concepts` (one word per concept:
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

**Scan** reports JSX text and readable attributes (`title`, `alt`, `placeholder`, `aria-label`, ...)
written as literals, and catalog keys no code names. Mark a deliberate literal with
`copydeck-ignore` on its line or the line above.

## Pruning

The Vite plugin replaces each locale module in a build with only the messages some module
references. A reference is any string literal equal to a key, so keys kept in arrays or maps count;
``t(`status.${state}`)`` and `t('status.' + state)` keep every key under `status.`. For keys built
some other way, list them: `copydeck({ keep: ['plan.*'] })`.

## Config

```ts
// copydeck.config.ts
import { defineConfig } from 'copydeck/config';

export default defineConfig({
  catalog: 'copy/catalog', // source YAML
  locales: 'copy/locales', // translations
  out: 'src/copy', // generated modules
  lock: 'copy/lock.json',
  source: 'en',
  bundled: [], // locales shipped in the main bundle; the rest load on first use
  pseudo: false, // or 'en-XA'
  stale: 'use', // or 'fallback'
  language: 'ts', // or 'js'
  importExtension: '.js', // '.ts' for Node's type stripping, '' for bundler resolution
  require: ['context'],
  kinds: {/* name, action, description, state */},
  surfaces: {/* label, heading, tooltip, ... */},
  lint: { extends: 'recommended', rules: {}, banned: [], spelling: {}, concepts: {}, properNouns: [] },
  scan: { dirs: ['src'] },
});
```

## Example

[`examples/react-app`](examples/react-app) is a small shop in English, German, a part-translated
Turkish and the pseudo-locale.

```bash
bun run example
```

## Where it came from

copydeck generalizes `@drasyn/text`, the catalog behind Drasyn's UI. It keeps that design: YAML
entries with `kind`, `surface` and `context`, ICU checked at build time, generated types, tags for
elements inside a sentence, a lint for the writing guide with reasoned exemptions, build-time
pruning, and the YAML 1.1/1.2 divergence check. What changed:

| Drasyn's text package                                       | copydeck                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Parses ICU at runtime with `intl-messageformat`             | Compiles messages to functions; no parser ships                             |
| One global language; components don't re-render on a switch | `createCopy` instances; `useCopy()` re-renders; one per request on a server |
| Falls back to English only                                  | Negotiates the locale and falls back key by key through parents             |
| No way to know a translation is out of date                 | The lock marks stale translations; `status`, `todo`, `accept`               |
| Kinds, surfaces and word lists are Drasyn's                 | All configurable; `recommended` and `strict` presets                        |
| A rich message needs `rich: true` and a `RichText` wrapper  | Tags are detected; React output is keyed; default tags in the provider      |
| Pruning fails the build on a key it can't read              | Pruning reads string literals and prefixes, so keys in data still work      |
| Bun scripts inside one repo                                 | A CLI, a Vite plugin and `copydeck/tools` for other bundlers                |
| —                                                           | Hardcoded-text scan, pseudo-locale, translator `todo` output                |

## Further

Ideas not built yet, roughly in order of value:

1. **`copydeck extract`**: turn what `scan` finds into catalog entries and `t()` calls, with a key
   suggested from the component and surface.
2. **Show what changed** for a stale translation: keep the old source text in the lock, so `todo`
   prints a diff rather than only the new English.
3. **Draft translations with an LLM**: `copydeck translate de --draft`, prompted with `context`,
   `kind`, `surface` and `args`, written to a draft file a person reviews before it ships.
4. **Exchange formats**: XLIFF 2 and JSON export and import for translation tools.
5. **Per-area splitting**: one chunk per area and locale, so a lazy route loads only its own messages.
6. **In-context editing in dev**: alt-click a string to open its YAML entry, using a key attribute
   `<Text>` adds in dev builds.
7. **Server rendering helpers**: `Accept-Language` negotiation and a React Server Components reader.
8. **Native targets**: generate Rust, Swift or Kotlin from the same catalog, as Drasyn generates
   Rust for its tray and menus.
9. **MessageFormat 2** once `Intl.MessageFormat` lands.
