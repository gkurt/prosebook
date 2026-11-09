/**
 * What every framework binding shares: a copy read through the framework's reactivity, with a
 * provider's tag renderers under each rich read's own.
 */
import type { Copy } from './copy.ts';
import type { MessageKey, MessageShape, RegisteredLocale, RegisteredMessages, RichKey, RichParam, TagFn } from './types.ts';

type M = RegisteredMessages;

/**
 * `Copy`, with `rich` returning `R`, a node of the framework's, whose tag renderers make `N`s. The locale is
 * a parameter so it survives a lint that, where no catalog is registered, sees `RegisteredLocale` as the default.
 */
export interface BoundCopy<N, R = N, L extends string = RegisteredLocale> extends Omit<Copy<M, L>, 'rich'> {
  rich<K extends RichKey<M>>(this: void, key: K, ...values: RichParam<M[K], N>): R;
}

export type Tags = { readonly [tag: string]: (chunks: never) => unknown };

export interface Binding<R> {
  /** Called on every read, so the framework knows the reader depends on the copy's version. */
  track?: () => void;
  /** What a tag's renderer is turned into, given what it wraps. Calls it by default. */
  tag?: (render: (chunks: never) => unknown, chunks: unknown[]) => unknown;
  /** What a rich read returns, given its parts. */
  whole: (parts: unknown[]) => R;
  /**
   * Told, of a read whose text says a relative time, the moment by the copy's clock it next reads differently, so the
   * binding renders what read it again then: `t`, `rich` and `relative`. The read is claimed, so a `live` copy leaves it.
   */
  fresh?: (next: number) => void;
}

/**
 * A reader for a binding that renders a component again, not a read (React's, Preact's): it keeps the soonest moment a
 * read of it next reads differently, which `wait` waits for, calling `run` then. Kept until then, so an effect run twice
 * waits twice; a component that stopped reading the time renders once more for nothing.
 */
export function waitingReader<N, R>(copy: Copy, tags: Tags, binding: Binding<R>) {
  let soonest: number | undefined;
  const reader = bindCopy<N, R>(copy, tags, { ...binding, fresh: (next) => (soonest = Math.min(next, soonest ?? next)) });
  const wait = (run: () => void) => {
    const at = soonest;
    if (at === undefined) return undefined;
    return copy.at(at, () => {
      soonest = undefined;
      run();
    });
  };
  return { reader, wait };
}

/**
 * The moments reads next change, each a signal of the framework's that is bumped then: what read the text tracks it, so
 * that alone runs again. Made on first read and gone once bumped. A server sets no timer: nothing there renders twice.
 */
export function freshness(copy: Copy, signal: (wait: (run: () => void) => () => void) => () => void): (next: number) => void {
  const signals = new Map<number, () => void>();
  return (next) => {
    let read = signals.get(next);
    if (read === undefined) {
      read = signal((run) => {
        if (typeof document === 'undefined') return () => {};
        return copy.at(next, () => {
          signals.delete(next);
          run();
        });
      });
      signals.set(next, read);
    }
    read();
  };
}

/** A reader of `copy` whose reads go through `track`, and whose rich reads get `tags` unless they give their own. */
export function bindCopy<N, R>(copy: Copy, tags: Tags, { track = () => {}, tag, whole, fresh }: Binding<R>): BoundCopy<N, R> {
  const merged = { ...copy.tags, ...tags };
  // A read, told to `fresh` where its text changes in time.
  const kept = <T>(out: T): T => {
    const next = fresh === undefined ? undefined : copy.nextChange();
    if (next !== undefined) fresh!(next);
    return out;
  };
  return {
    get locale() {
      track();
      return copy.locale;
    },
    get dir() {
      track();
      return copy.dir;
    },
    get version() {
      track();
      return copy.version;
    },
    locales: copy.locales,
    source: copy.source,
    timeZone: copy.timeZone,
    tags: copy.tags,
    ready: copy.ready,
    t(key, ...args) {
      track();
      return kept(copy.t(key, ...args));
    },
    has(key): key is keyof M & string {
      track();
      return copy.has(key);
    },
    setLocale: copy.setLocale,
    subscribe: copy.subscribe,
    number(value, options) {
      track();
      return copy.number(value, options);
    },
    date(value, options) {
      track();
      return copy.date(value, options);
    },
    list(items, options) {
      track();
      return copy.list(items, options);
    },
    duration(ms, options) {
      track();
      return copy.duration(ms, options);
    },
    relative(at, format) {
      track();
      return kept(copy.relative(at, format));
    },
    compare(a, b, options) {
      track();
      return copy.compare(a, b, options);
    },
    collator(options) {
      track();
      return copy.collator(options);
    },
    now: copy.now,
    nextChange: copy.nextChange,
    at: copy.at,
    rich(key, ...values) {
      track();
      const all: Record<string, unknown> = { ...merged, ...(values[0] as object | undefined) };
      if (tag !== undefined) {
        for (const [name, value] of Object.entries(all))
          if (typeof value === 'function') all[name] = (chunks: unknown[]) => tag(value as (chunks: never) => unknown, chunks);
      }
      return whole(kept(copy.rich(key, all as never)));
    },
  };
}

type NoValues<S extends MessageShape> = {} extends S['args'] & { [T in S['tags']]: unknown } ? true : false;

/**
 * A `<Text>`'s props where the call site renders every tag the provider doesn't: `values` is needed
 * once the message takes arguments or wraps text in a tag.
 */
export type TextProps<K extends MessageKey, N> = { id: K } & (NoValues<M[K]> extends true
  ? { values?: M[K]['args'] & { [T in M[K]['tags']]?: TagFn<N> } }
  : { values: RichParam<M[K], N>[0] });

/** A `<Text>`'s props where tags may come from elsewhere (slots, snippets): `values` holds arguments, and tags if you like. */
export type LooseTextProps<K extends MessageKey, N> = { id: K } & ({} extends M[K]['args']
  ? { values?: M[K]['args'] & { [T in M[K]['tags']]?: TagFn<N> } }
  : { values: M[K]['args'] & { [T in M[K]['tags']]?: TagFn<N> } });
