# prosebook

Every string your app shows, in one typed catalog. For React and any JavaScript.

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
- **Pruned.** A Vite build ships only the messages the code names.
- **Written well.** An optional lint holds the words to a writing guide: word budgets per kind of
  string, periods, sentence case, banned filler.

## Quick start

Not on npm yet: build it here (`bun run build`) and add it by path.

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

### In plain JavaScript

```js
import { createCopy } from 'prosebook';
import { catalog } from './copy/index.js';

const copy = createCopy(catalog, { locale: navigator.languages });
await copy.ready;
document.title = copy.t('app.title');
copy.subscribe(() => render()); // after a locale switch, and in dev after a catalog edit
```

Set `language: 'js'` in the config to generate `.js` modules with a `.d.ts` beside the index. On a
server, create one `copy` per request.

## The catalog

One file per area, `copy/catalog/<area>.yaml`. A key's first segment names its file, so
`cart.items` lives in `cart.yaml` and nowhere else; searching for a key finds its entry.

| Field      |                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `en`       | The message, in ICU MessageFormat or MessageFormat 2. The field is named after `source` in the config.  |
| `context`  | One sentence telling a translator where the string appears. Required by default.                        |
| `args`     | What each placeholder holds, one line each. Required for every placeholder when `context` is.           |
| `kind`     | What sort of string it is: `name`, `action`, `description`, `state`. The lint holds each to its budget. |
| `surface`  | Where it sits: `label`, `heading`, `tooltip`, `error`, `empty`, `hint`, ...                             |
| `fragment` | `true` where it completes something beside it, so sentence rules don't apply.                           |
| `allow`    | Lint rules the entry is exempt from, each with the reason.                                              |

`key: message` is the shorthand for an entry with nothing to say about itself (set `require: []`).
Kinds and surfaces are configurable; `prosebook generate` writes `catalog.schema.json` beside the
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
match on the first, then the next, an exact number beating its plural category. `:offset` covers
MF1's plural offset.

The functions are MF2's defaults: `:string`, `:number`, `:integer`, `:percent`, `:currency`, `:unit`,
`:offset`, and the date and time functions `:date`, `:time` and `:datetime`, which are still a draft
in the spec and follow it as the `messageformat` package does. Option values are literals, since
formatting is settled at build time; `currency=$code` is refused with that reason. Placeholders
aren't wrapped in bidi isolation marks.

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
prosebook todo de           # missing and stale entries, with context, ready to translate
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
# en: Add one to cart
# stale, the source changed: Add {+one +}to cart
cart.add: In den Warenkorb
```

Stale translations still show by default; `stale: 'fallback'` shows the source instead.

**Pseudo-locale.** `pseudo: 'en-XA'` generates `⟦Ýóóúúŕ çááŕţ⟧` from the source. Switch to it and
any plain text on screen is hardcoded, a missing bracket is clipped text, and brackets inside
brackets are a sentence spliced from fragments.

## Checks

```bash
prosebook lint     # the words against the writing rules
prosebook scan     # hardcoded text in JSX, and catalog keys no code reads
prosebook extract  # move that text into the catalog (see below)
prosebook migrate  # rewrite the catalog in ICU MessageFormat (1) or MessageFormat 2
prosebook check    # generate --check, lint and status --strict, for CI
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
`prosebook-ignore` on its line or the line above.

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
references. A reference is any string literal equal to a key, so keys kept in arrays or maps count;
``t(`status.${state}`)`` and `t('status.' + state)` keep every key under `status.`. For keys built
some other way, list them: `prosebook({ keep: ['plan.*'] })`.

## Finding a string's entry

In dev, hold Alt (Option on a Mac) and point at text on the page: the Vite plugin outlines the
string and names its key and the locale it came from. Alt-click opens its entry in your editor: the
translation for a translated string, the catalog entry for one that fell back. Alt-Shift-click opens
the catalog entry either way. Save, and the string changes on the page, which keeps its locale and
state. Only adding or removing a locale reloads it.

Nothing is added to the page to make this work. In dev the runtime reports each string it hands out,
and the inspector matches the text under the pointer back to it, so `t()`, `<Text>`, a sentence with
a link inside it and readable attributes (`placeholder`, `title`, `aria-label`, `alt`) all work. Text
the code changes after reading it (`t('…').toUpperCase()`) can't be traced. Where two keys read the
same text, the label says so and the click opens the one read last.

The editor is the one Vite's `/__open-in-editor` launches: one it finds running, or the command in
`LAUNCH_EDITOR`. Turn the inspector off with `prosebook({ inspect: false })`.

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

prosebook generalizes `@drasyn/text`, the catalog behind Drasyn's UI. It keeps that design: YAML
entries with `kind`, `surface` and `context`, ICU checked at build time, generated types, tags for
elements inside a sentence, a lint for the writing guide with reasoned exemptions, build-time
pruning, and the YAML 1.1/1.2 divergence check. What changed:

| Drasyn's text package                                       | prosebook                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Parses ICU at runtime with `intl-messageformat`             | Compiles messages to functions; no parser ships                             |
| One global language; components don't re-render on a switch | `createCopy` instances; `useCopy()` re-renders; one per request on a server |
| Falls back to English only                                  | Negotiates the locale and falls back key by key through parents             |
| No way to know a translation is out of date                 | The lock marks stale translations; `status`, `todo`, `accept`               |
| Kinds, surfaces and word lists are Drasyn's                 | All configurable; `recommended` and `strict` presets                        |
| A rich message needs `rich: true` and a `RichText` wrapper  | Tags are detected; React output is keyed; default tags in the provider      |
| Pruning fails the build on a key it can't read              | Pruning reads string literals and prefixes, so keys in data still work      |
| Bun scripts inside one repo                                 | A CLI, a Vite plugin and `prosebook/tools` for other bundlers               |
| —                                                           | Hardcoded-text `scan` and `extract`, pseudo-locale, translator `todo`       |
| —                                                           | Alt-click a string in dev to open its entry                                 |

## Further

Ideas not built yet, roughly in order of value:

1. **Draft translations with an LLM**: `prosebook translate de --draft`, prompted with `context`,
   `kind`, `surface` and `args`, written to a draft file a person reviews before it ships.
2. **Exchange formats**: XLIFF 2 and JSON export and import for translation tools.
3. **Per-area splitting**: one chunk per area and locale, so a lazy route loads only its own messages.
4. **Server rendering helpers**: `Accept-Language` negotiation and a React Server Components reader.
5. **Native targets**: generate Rust, Swift or Kotlin from the same catalog, as Drasyn generates
   Rust for its tray and menus.
6. **Variable MF2 options**: `{$price :currency currency=$code}`, compiled to a formatter cached per
   value.
