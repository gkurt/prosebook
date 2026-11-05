import { durationParts, formatIn, type DurationFormatOptions, type FormatKind, type Formats, type ListFormatOptions } from './formats.ts';
import { createHelpers, flatten, shownItems } from './helpers.ts';
import { chainOf, negotiate } from './locale.ts';
import type {
  AnyTagFn,
  ArgsParam,
  Chunks,
  Compiled,
  CompiledMessages,
  DateFormatName,
  DurationFormatName,
  Helpers,
  DevHooks,
  ListFormatName,
  MessageShapes,
  NumberFormatName,
  RegisteredLocale,
  RegisteredMessages,
  RichKey,
  RichParam,
  Values,
} from './types.ts';

type Loader = () => Promise<{ default: CompiledMessages }>;

/** Messages that ship in the bundle and loaders for the rest, per locale: a catalog's, or one area's. */
interface Pieces<L extends string = string> {
  readonly messages: { readonly [locale in L]?: CompiledMessages };
  readonly loaders: { readonly [locale in L]?: Loader };
}

/** A generated catalog: which locales exist, which ship in the bundle and how to fetch the rest. */
export interface Catalog<M extends MessageShapes = MessageShapes, L extends string = string> {
  /** The locale the catalog is written in, which every other falls back to. */
  readonly source: L;
  readonly locales: readonly L[];
  /** Locales whose messages ship in the bundle. Always holds the source. */
  readonly messages: { readonly [locale in L]?: CompiledMessages };
  /** Locales fetched when first asked for. */
  readonly loaders: { readonly [locale in L]?: Loader };
  /**
   * Set when a build splits the catalog by area (the Vite plugin's `split`): `messages` and `loaders`
   * are empty, and each area adds its own (`addArea`) as the code reading it loads.
   */
  readonly split?: { readonly id: string; readonly areas: readonly string[] };
  /**
   * Set in a server build whose client is split (the Vite plugin's `split`): the file the browser
   * loads each area's messages from, per lazy locale, which `CopyOptions.preload` is handed.
   */
  readonly areaFiles?: { readonly [area: string]: { readonly [locale in L]?: string } };
  /** The formats the config names, which `number` and `date` take by name. */
  readonly formats?: Formats;
  /** Type-only: carries the message shapes from the generated module to `createCopy`. */
  readonly '~messages'?: M;
}

/** A split catalog's areas, as they load, and each copy's hook for taking a new one in. */
interface Registry {
  areas: Map<string, Pieces>;
  copies: Set<(area: string) => Promise<unknown>>;
}

// By `split.id`, not by catalog: in dev an edit runs the index again, and an area that loads after it
// must still reach the copies made from the catalog before.
const registries = new Map<string, Registry>();

function registry(id: string): Registry {
  let r = registries.get(id);
  if (r === undefined) registries.set(id, (r = { areas: new Map(), copies: new Set() }));
  return r;
}

/**
 * Adds an area's messages to a split catalog. Called by generated code, from a module beside the code
 * that reads the area; settles once every copy holds the area in its locale, so that code's first
 * render reads it. A locale that fails to load reads in its fallback, and is reported.
 */
export async function addArea(id: string, area: string, messages: Pieces['messages'], loaders: Pieces['loaders']): Promise<void> {
  const r = registry(id);
  if (r.areas.has(area)) return;
  r.areas.set(area, { messages, loaders });
  for (const result of await Promise.allSettled([...r.copies].map((take) => take(area))))
    if (result.status === 'rejected') console.error(`prosebook: the ${area} area did not load:`, result.reason);
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
  /**
   * Told of a placeholder that had no value, or one `Intl` refused (`currency: 'euro'`): the message
   * still renders, showing `{name}` there. In a split build, also of a key read before its area
   * loaded. Defaults to `console.error`.
   */
  onError?: (error: Error, key: string, locale: L) => void;
  /**
   * On a server, handed each file the browser will load for the areas this copy reads, once each,
   * so the page can link it and the browser fetch it beside the code reading it rather than after:
   * `(href) => preloadModule(href, { as: 'script' })` under React. Only a catalog built for a split
   * client has such files (`Catalog.areaFiles`), and only its lazy locales.
   */
  preload?: (href: string) => void;
}

/** Its methods don't use `this`, so they can be passed around and destructured: `const { t } = copy`. */
/**
 * A copy's `t`, for a function that reads messages it is handed: `(t: Translate) => t('cart.title')`.
 * Every binding's reader has the same one.
 */
export type Translate<M extends MessageShapes = RegisteredMessages, L extends string = RegisteredLocale> = Copy<M, L>['t'];

/** Options, or a format's name where the config names some of that kind. */
type OrName<O, N extends string> = [N] extends [never] ? O : O | N;

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
  t<K extends keyof M & string>(this: void, key: K, ...args: ArgsParam<M[K]>): string;
  /** A message with elements inside it: each tag's function turns what it wraps into a node. */
  rich<K extends RichKey<M>, N = unknown>(this: void, key: K, ...values: RichParam<M[K], N>): Chunks<N>;
  has(this: void, key: string): key is keyof M & string;
  /** Switches locale once its messages (and its fallbacks') are loaded. */
  setLocale(this: void, next: L | (string & {}) | readonly string[]): Promise<void>;
  /** Counts changes to what messages read as: each locale switch, and each catalog edit in dev. */
  readonly version: number;
  /** Called after each locale switch, and in dev after each catalog edit. Returns the unsubscribe. */
  subscribe(this: void, listener: () => void): () => void;
  /** Formats a number in the current locale, with `Intl` options or a format the config names (`formats.number`). */
  number(this: void, value: number | bigint, format?: Intl.NumberFormatOptions | NumberFormatName): string;
  /** Formats a date in the current locale, with `Intl` options or a format the config names (`formats.date`). */
  date(this: void, value: Date | number, format?: Intl.DateTimeFormatOptions | DateFormatName): string;
  /**
   * Joins items as a list in the current locale, `a, b and c`, with `Intl` options or a format the config
   * names (`formats.list`), whose `max` shows that many and says the rest with the entry its `more` names.
   */
  list(this: void, items: Iterable<string>, format?: OrName<ListFormatOptions, ListFormatName>): string;
  /** Milliseconds as a duration in the current locale, `3 min, 5 sec`, with options or a format the config names (`formats.duration`). */
  duration(this: void, ms: number, format?: OrName<DurationFormatOptions, DurationFormatName>): string;
  /** `in 3 days`, `2 hours ago`, in the current locale. */
  relative(this: void, value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
}

/** A locale's messages, from each area loaded in it so far. */
type Layer = { messages: CompiledMessages; h: Helpers; areas: Set<string> };

/** The one area of a catalog that isn't split. */
const WHOLE = '';

const areaOf = (key: string) => key.slice(0, key.indexOf('.'));

function pick(messages: CompiledMessages, keep: (key: string) => boolean): CompiledMessages {
  const out: Record<string, Compiled> = {};
  for (const key in messages) if (keep(key)) out[key] = messages[key]!;
  return out;
}

/** A message as the text it puts on screen: rendered again with its tags left as their text. */
function textOf(message: Compiled, values: Values, h: Helpers): string {
  if (typeof message === 'string') return message;
  const plain = Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v !== 'function'));
  return flatten(message(plain, h)).join('');
}

/** A catalog reader with a current locale. Create one per app, or one per request on a server. */
export function createCopy<M extends MessageShapes, L extends string>(catalog: Catalog<M, L>, options: CopyOptions<L> = {}): Copy<M, L> {
  const loaded = new Map<L, Layer>();
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const defaultTags = options.tags ?? {};
  const formatters = new Map<
    string,
    Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat | Intl.RelativeTimeFormat | Intl.DurationFormat
  >();
  const split = catalog.split === undefined ? undefined : registry(catalog.split.id);
  // The key being rendered, which a helper's report names; none while the inspector renders it again.
  let reading: string | undefined;
  // The files handed to `preload`, and each area and locale read, which hands on nothing new after.
  const preloaded = new Set<string>();
  const report = (error: Error, key: string, l: L) => {
    if (options.onError) options.onError(error, key, l);
    else console.error(`prosebook: ${key} in ${l}: ${error.message}`);
  };
  const helpers = (l: L) =>
    createHelpers(l, (error) => {
      if (reading !== undefined) report(error, reading, l);
    });

  const areas = () => (split === undefined ? [WHOLE] : [...split.areas.keys()]);
  const piecesOf = (area: string): Pieces<L> => (area === WHOLE ? catalog : split!.areas.get(area)!);

  function layerOf(l: L): Layer {
    let layer = loaded.get(l);
    if (layer === undefined) loaded.set(l, (layer = { messages: {}, h: helpers(l), areas: new Set() }));
    return layer;
  }

  function take(l: L, area: string, messages: CompiledMessages) {
    const layer = layerOf(l);
    layer.areas.add(area);
    // In dev an area is handed its locales whole; only the area's own keys are its.
    layer.messages = area === WHOLE ? messages : { ...layer.messages, ...pick(messages, (key) => areaOf(key) === area) };
  }

  function takeBundled(area: string) {
    for (const [l, messages] of Object.entries(piecesOf(area).messages) as [L, CompiledMessages][]) take(l, area, messages);
  }

  for (const area of areas()) takeBundled(area);

  let locale = catalog.source;
  let chain: Layer[] = layers(chainOf(locale, catalog.locales, catalog.source));
  // The locales the latest switch asked for, which an area arriving during it loads in too.
  let wanted: L[] = chainOf(locale, catalog.locales, catalog.source);
  let latest = 0;
  let version = 0;

  function changed() {
    version++;
    for (const listener of listeners) listener();
  }

  // A layer's messages are swapped in place, so the chain that holds it reads the new ones.
  (globalThis as DevHooks).__PROSEBOOK_HOT__?.add((l, messages) => {
    const layer = loaded.get(l as L);
    if (layer === undefined) return;
    layer.messages = layer.areas.has(WHOLE) ? messages : pick(messages, (key) => layer.areas.has(areaOf(key)));
    changed();
  });

  // An area that loads after the copy was made comes in, in the locale shown and the one being switched to.
  split?.copies.add(async (area) => {
    takeBundled(area);
    const locales = new Set([...chainOf(locale, catalog.locales, catalog.source), ...wanted]);
    await Promise.all([...locales].map((l) => load(l, area)));
    changed();
  });

  function layers(locales: L[]): Layer[] {
    return locales.map(layerOf);
  }

  function load(l: L, area: string): Promise<void> {
    if (loaded.get(l)?.areas.has(area) === true) return Promise.resolve();
    const id = `${area}/${l}`;
    let p = pending.get(id);
    if (p === undefined) {
      // oxlint-disable-next-line typescript/no-unsafe-enum-assignment -- `L` is a string union, not an enum; the rule misreads the mapped type
      const loader = piecesOf(area).loaders[l];
      if (loader === undefined) {
        if (split === undefined) return Promise.reject(new Error(`prosebook: no messages for locale "${l}"`));
        // An area with nothing translated in a locale has no loader for it.
        take(l, area, {});
        return Promise.resolve();
      }
      p = loader().then((mod) => {
        take(l, area, mod.default);
        pending.delete(id);
      });
      p.catch(() => pending.delete(id));
      pending.set(id, p);
    }
    return p;
  }

  async function setLocale(next: L | (string & {}) | readonly string[]): Promise<void> {
    const target = negotiate(next, catalog.locales, catalog.source);
    const ticket = ++latest;
    const locales = chainOf(target, catalog.locales, catalog.source);
    wanted = locales;
    await Promise.all(locales.flatMap((l) => areas().map((area) => load(l, area))));
    // A slower load must not undo a later switch.
    if (ticket !== latest || target === locale) return;
    locale = target;
    chain = layers(locales);
    formatters.clear();
    changed();
  }

  function find(key: string): [Compiled, Helpers] | undefined {
    for (const layer of chain) {
      const message = layer.messages[key];
      if (message !== undefined) return [message, layer.h];
    }
    return undefined;
  }

  function preload(area: string) {
    const files = catalog.areaFiles?.[area];
    const read = `${area}/${locale}`;
    if (files === undefined || options.preload === undefined || preloaded.has(read)) return;
    preloaded.add(read);
    for (const l of chainOf(locale, catalog.locales, catalog.source)) {
      const href = files[l];
      if (href === undefined || preloaded.has(href)) continue;
      preloaded.add(href);
      options.preload(href);
    }
  }

  function render(key: string, values: Values): unknown {
    preload(areaOf(key));
    const found = find(key);
    if (found === undefined) {
      const area = areaOf(key);
      if (split !== undefined && !split.areas.has(area) && catalog.split!.areas.includes(area)) {
        const fix = `name one of its keys in the module that reads it, or keep it: \`keep: ['${area}.*']\``;
        report(new Error(`the ${area} area has not loaded: ${fix}`), key, locale);
      }
      return options.onMissing ? options.onMissing(key, locale) : key;
    }
    const [message, h] = found;
    reading = key;
    let out: unknown;
    try {
      out = typeof message === 'string' ? message : message(values, h);
    } finally {
      reading = undefined;
    }
    const read = (globalThis as DevHooks).__PROSEBOOK_READ__;
    if (read !== undefined) read(key, typeof out === 'string' ? out : textOf(message, values, h), h.locale);
    return out;
  }

  /** A named format's options in the current locale. The generated types allow only names the config gives. */
  function named<K extends FormatKind>(kind: K, name: string) {
    const options = formatIn(catalog.formats, kind, name, locale);
    if (options === undefined)
      throw new Error(`prosebook: no ${kind} format is named "${name}": name it under formats.${kind} in the config`);
    return options;
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
    get version() {
      return version;
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
    number(value, format) {
      const opts = typeof format === 'string' ? named('number', format) : format;
      return formatter('n', opts, () => new Intl.NumberFormat(locale, opts)).format(value);
    },
    date(value, format) {
      const opts = typeof format === 'string' ? named('date', format) : format;
      return formatter('d', opts, () => new Intl.DateTimeFormat(locale, opts)).format(value);
    },
    list(items, format) {
      const opts = typeof format === 'string' ? named('list', format) : format;
      const more = opts?.more;
      const rest = more === undefined ? undefined : (count: number) => render(more, { count });
      return formatter('l', opts, () => new Intl.ListFormat(locale, opts)).format(shownItems(items, opts, rest));
    },
    duration(ms, format) {
      const opts = typeof format === 'string' ? named('duration', format) : format;
      const { parts, zero } = durationParts(ms, opts);
      const all = zero === undefined ? opts : { ...opts, [`${zero}Display`]: 'always' };
      return formatter('u', all, () => new Intl.DurationFormat(locale, all as Intl.DurationFormatOptions)).format(parts);
    },
    relative(value, unit, opts) {
      return formatter('r', opts, () => new Intl.RelativeTimeFormat(locale, opts)).format(value, unit);
    },
  };
}
