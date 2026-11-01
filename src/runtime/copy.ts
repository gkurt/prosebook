import { createHelpers, flatten } from './helpers.ts';
import { chainOf, negotiate } from './locale.ts';
import type {
  AnyTagFn,
  ArgsParam,
  Chunks,
  Compiled,
  CompiledMessages,
  Helpers,
  MessageShapes,
  RichKey,
  RichParam,
  Values,
} from './types.ts';

type Loader = () => Promise<{ default: CompiledMessages }>;

/** A generated catalog: which locales exist, which ship in the bundle and how to fetch the rest. */
export interface Catalog<M extends MessageShapes = MessageShapes, L extends string = string> {
  /** The locale the catalog is written in, which every other falls back to. */
  readonly source: L;
  readonly locales: readonly L[];
  /** Locales whose messages ship in the bundle. Always holds the source. */
  readonly messages: { readonly [locale in L]?: CompiledMessages };
  /** Locales fetched when first asked for. */
  readonly loaders: { readonly [locale in L]?: Loader };
  /** Type-only: carries the message shapes from the generated module to `createCopy`. */
  readonly '~messages'?: M;
}

/** Ties a generated catalog to its message shapes. Called by generated code. */
export function defineCatalog<M extends MessageShapes, L extends string = string>(
  catalog: Omit<Catalog<M, L>, '~messages'>,
): Catalog<M, L> {
  return catalog;
}

export interface CopyOptions<L extends string> {
  /** The locale to start in, or the locales a reader prefers, most preferred first. Defaults to the source. */
  locale?: L | (string & {}) | readonly string[];
  /** Tag renderers every rich read gets unless it supplies its own, such as `b` or `link`. */
  tags?: { [tag: string]: AnyTagFn };
  /** What a key the catalog lacks reads as. Defaults to the key itself. */
  onMissing?: (key: string, locale: L) => string;
}

export interface Copy<M extends MessageShapes = MessageShapes, L extends string = string> {
  /** The locale messages are coming back in. */
  readonly locale: L;
  readonly locales: readonly L[];
  readonly source: L;
  /** The tag renderers rich reads fall back to, from `CopyOptions.tags`. */
  readonly tags: { readonly [tag: string]: AnyTagFn };
  /** Settles once the starting locale's messages are loaded. */
  readonly ready: Promise<void>;
  /** A message as plain text. Tags render as the text they wrap. */
  t<K extends keyof M & string>(key: K, ...args: ArgsParam<M[K]>): string;
  /** A message with elements inside it: each tag's function turns what it wraps into a node. */
  rich<K extends RichKey<M>, N = unknown>(key: K, ...values: RichParam<M[K], N>): Chunks<N>;
  has(key: string): key is keyof M & string;
  /** Switches locale once its messages (and its fallbacks') are loaded. */
  setLocale(next: L | (string & {}) | readonly string[]): Promise<void>;
  /** Called after each locale switch. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Formats a number in the current locale. */
  number(value: number | bigint, options?: Intl.NumberFormatOptions): string;
  /** Formats a date in the current locale. */
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  /** Joins items as a list in the current locale: `a, b and c`. */
  list(items: Iterable<string>, options?: Intl.ListFormatOptions): string;
  /** `in 3 days`, `2 hours ago`, in the current locale. */
  relative(value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
}

type Layer = { messages: CompiledMessages; h: Helpers };

/** A catalog reader with a current locale. Create one per app, or one per request on a server. */
export function createCopy<M extends MessageShapes, L extends string>(catalog: Catalog<M, L>, options: CopyOptions<L> = {}): Copy<M, L> {
  const loaded = new Map<L, Layer>();
  const pending = new Map<L, Promise<Layer>>();
  const listeners = new Set<() => void>();
  const defaultTags = options.tags ?? {};
  const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat | Intl.RelativeTimeFormat>();

  for (const [locale, messages] of Object.entries(catalog.messages) as [L, CompiledMessages][])
    loaded.set(locale, { messages, h: createHelpers(locale) });

  let locale = catalog.source;
  let chain: Layer[] = layers(chainOf(locale, catalog.locales, catalog.source));
  let latest = 0;

  function layers(locales: L[]): Layer[] {
    return locales.flatMap((l) => loaded.get(l) ?? []);
  }

  function load(l: L): Promise<Layer> {
    const done = loaded.get(l);
    if (done) return Promise.resolve(done);
    let p = pending.get(l);
    if (p === undefined) {
      const loader = catalog.loaders[l];
      if (loader === undefined) return Promise.reject(new Error(`copydeck: no messages for locale "${l}"`));
      p = loader().then((mod) => {
        const layer = { messages: mod.default, h: createHelpers(l) };
        loaded.set(l, layer);
        pending.delete(l);
        return layer;
      });
      p.catch(() => pending.delete(l));
      pending.set(l, p);
    }
    return p;
  }

  async function setLocale(next: L | (string & {}) | readonly string[]): Promise<void> {
    const target = negotiate(next as string | readonly string[], catalog.locales, catalog.source);
    const ticket = ++latest;
    const locales = chainOf(target, catalog.locales, catalog.source);
    await Promise.all(locales.map(load));
    // A slower load must not undo a later switch.
    if (ticket !== latest || target === locale) return;
    locale = target;
    chain = layers(locales);
    formatters.clear();
    for (const listener of listeners) listener();
  }

  function find(key: string): [Compiled, Helpers] | undefined {
    for (const layer of chain) {
      const message = layer.messages[key];
      if (message !== undefined) return [message, layer.h];
    }
    return undefined;
  }

  function render(key: string, values: Values): unknown {
    const found = find(key);
    if (found === undefined) return options.onMissing ? options.onMissing(key, locale) : key;
    const [message, h] = found;
    return typeof message === 'string' ? message : message(values, h);
  }

  function formatter<F>(kind: string, options: object | undefined, make: () => F): F {
    const id = `${kind}${JSON.stringify(options ?? {})}`;
    let made = formatters.get(id) as F | undefined;
    if (made === undefined) formatters.set(id, (made = make()) as never);
    return made;
  }

  const ready = options.locale === undefined ? Promise.resolve() : setLocale(options.locale);

  return {
    get locale() {
      return locale;
    },
    locales: catalog.locales,
    source: catalog.source,
    tags: defaultTags,
    ready,
    t(key, ...args) {
      const out = render(key, (args[0] as Values | undefined) ?? {});
      return typeof out === 'string' ? out : flatten(out).join('');
    },
    rich(key, ...values) {
      const out = render(key, { ...defaultTags, ...(values[0] as Values | undefined) });
      return flatten(out) as Chunks<never>;
    },
    has(key): key is keyof M & string {
      return find(key) !== undefined;
    },
    setLocale,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    number(value, opts) {
      return formatter('n', opts, () => new Intl.NumberFormat(locale, opts)).format(value);
    },
    date(value, opts) {
      return formatter('d', opts, () => new Intl.DateTimeFormat(locale, opts)).format(value);
    },
    list(items, opts) {
      return formatter('l', opts, () => new Intl.ListFormat(locale, opts)).format(items);
    },
    relative(value, unit, opts) {
      return formatter('r', opts, () => new Intl.RelativeTimeFormat(locale, opts)).format(value, unit);
    },
  };
}
