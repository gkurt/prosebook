/**
 * The shapes the generated catalog and the runtime agree on.
 *
 * A catalog is compiled at build time: every ICU message becomes either a string (no placeholders)
 * or a small function over its arguments and a set of locale-bound helpers. The runtime never parses
 * ICU, so it carries no parser, needs no `eval`, and a message costs a property read or one call.
 */

import type { DateFormatOptions, DurationFormatOptions, ListFormatOptions, NumberFormatOptions, RelativeFormatOptions } from './formats.ts';

/** What the generator knows about one message: the arguments it takes and the tags it wraps text in. */
export interface MessageShape {
  args: object;
  tags: string;
}

/** Every key of a catalog, mapped to its shape. The generated `Messages` interface is one of these. */
export type MessageShapes = { [key: string]: MessageShape };

/**
 * Augmented by the generated module, so hooks and components that are not handed a catalog
 * (`useCopy()`, `<Text>`) still know its keys:
 *
 * ```ts
 * declare module 'prosebook' {
 *   interface Register { messages: Messages; locale: Locale }
 * }
 * ```
 *
 * Add `tags: 'b' | 'link'` to say which tags the provider renders by default, so a call site
 * needs to supply only the others. The generated module adds `formats` where the config names some.
 */
// oxlint-disable-next-line typescript/no-empty-interface -- filled in by declaration merging
export interface Register {}

export type RegisteredMessages = Register extends { messages: infer M extends MessageShapes } ? M : MessageShapes;
export type RegisteredLocale = Register extends { locale: infer L extends string } ? L : string;
/**
 * A key of the catalog, as a string: for a prop, a map or a parameter that holds one, so it type-checks
 * as a key at every read. `MessageKey<M>` is a key of another catalog's `Messages`.
 */
export type MessageKey<M extends MessageShapes = RegisteredMessages> = Extract<keyof M, string>;
/** Tags the provider renders unless a call site says otherwise. */
export type DefaultTags = Register extends { tags: infer T extends string } ? T : never;
/** The number formats the config names (`formats.number`), which `copy.number` takes by name. */
export type NumberFormatName = Register extends { formats: { number: infer N extends string } } ? N : never;
/** The date formats the config names (`formats.date`), which `copy.date` takes by name. */
export type DateFormatName = Register extends { formats: { date: infer N extends string } } ? N : never;
/** The list formats the config names (`formats.list`), which `copy.list` takes by name. */
export type ListFormatName = Register extends { formats: { list: infer N extends string } } ? N : never;
/** The duration formats the config names (`formats.duration`), which `copy.duration` takes by name. */
export type DurationFormatName = Register extends { formats: { duration: infer N extends string } } ? N : never;
/** The relative formats the config names (`formats.relative`), which `copy.relative` takes by name. */
export type RelativeFormatName = Register extends { formats: { relative: infer N extends string } } ? N : never;

/**
 * The helpers a compiled message calls, bound to the locale its words are in. Names are one letter
 * because they appear once per placeholder in every generated module.
 */
/** An item of a list: an empty one, `null`, `undefined` or `false` included, is left out, so `draft && 'Draft'` reads. */
export type ListItem = string | number | null | undefined | false;

export interface Helpers {
  readonly locale: string;
  /**
   * `{x, number, …}` and the `#` of a plural; `given` holds the options arguments give, in MF2.
   * Nothing where there is no value or `Intl` refuses it, so the message shows `e`'s fallback.
   */
  n(value: number, options?: NumberFormatOptions, given?: Intl.NumberFormatOptions): string | undefined;
  /** `{x, date, …}` and `{x, time, …}`, as `n`. */
  d(value: Date | number, options?: DateFormatOptions, given?: Intl.DateTimeFormatOptions): string | undefined;
  /**
   * `{x, list, …}`: the items joined as the locale joins a list. A format with `max` shows that many,
   * and `more`, the entry its format names, rendered with the number of the rest as the last item.
   */
  /** A list: text, or parts where what `more` or `separator` say holds an element. */
  l(value: Iterable<ListItem>, options?: ListFormatOptions, more?: (count: number) => unknown, separator?: unknown): unknown;
  /** `{x, duration, …}`: milliseconds, in the units the format shows, as `Intl.DurationFormat` writes them. */
  u(value: number, options?: DurationFormatOptions): string | undefined;
  /**
   * `{x, relative, …}`: a point in time as how long ago or ahead of now it is. `said` renders what the
   * format's `now` says, given the tense, for a time under one of its smallest unit: text, or parts where
   * it holds an element.
   */
  r(value: Date | number | string, options?: RelativeFormatOptions, said?: (tense: 'past' | 'future') => unknown): unknown;
  /** A placeholder's fallback, `{x}`, where it has no value or `n` or `d` gave nothing: reports why. */
  e(fallback: string): string;
  /**
   * `{x, plural, …}` and `{x, selectordinal, …}`: picks an arm and renders it. MF2 passes the
   * options its selector formats with, since those decide the category: `1.0` is `other` in English.
   */
  p(
    value: number,
    offset: number,
    ordinal: boolean,
    arms: Arms,
    options?: Intl.PluralRulesOptions,
    given?: Intl.PluralRulesOptions,
  ): unknown;
  /** `{x, select, …}`. */
  s(value: unknown, arms: Arms): unknown;
  /** `<tag>…</tag>`: the tag's function from the values, or the bare children when there is none. */
  t(values: Values, tag: string, children: unknown): unknown;
}

export type Arms = { [arm: string]: () => unknown };
// `any`, not `unknown`: call sites are checked against the generated `Messages`, so a compiled
// message can hand its arguments to the helpers without a cast per placeholder.
// oxlint-disable-next-line typescript/no-explicit-any
export type Values = { readonly [name: string]: any };

/**
 * Told of every message read: its key, the text it came to and the locale it was found in, which is
 * the fallback's when the current locale lacks it. The Vite plugin's dev inspector sets one on
 * `globalThis` to map text on screen back to keys; nothing sets it in a build.
 */
export type ReadHook = (key: string, text: string, locale: string) => void;

/** Hands a copy a locale's messages, regenerated after a catalog edit, in place of the ones it loaded. */
export type HotHook = (locale: string, messages: CompiledMessages) => void;

/**
 * What the Vite plugin sets on `globalThis` in dev. `__PROSEBOOK_HOT__` is there before the app runs,
 * so each copy adds itself, and the generated modules call every copy when they are updated.
 */
export type DevHooks = { __PROSEBOOK_READ__?: ReadHook; __PROSEBOOK_HOT__?: Set<HotHook> };

/** One compiled message. */
export type Compiled = string | ((values: Values, h: Helpers) => unknown);

/** One locale's compiled messages: what a generated `<locale>.ts` module exports by default. */
export type CompiledMessages = { readonly [key: string]: Compiled };

/** What a tag's function receives: the pieces it wraps, adjacent text already joined. */
export type Chunks<N> = (string | N)[];
export type TagFn<N> = (chunks: Chunks<N>) => N;
/** A tag renderer for any kind of node, as configured once on a `Copy`. */
export type AnyTagFn = (chunks: never) => unknown;

type NoArgs<T> = {} extends T ? true : false;

/** The arguments of a plain read: optional when the message takes none. */
export type ArgsParam<S extends MessageShape> = NoArgs<S['args']> extends true ? [args?: S['args']] : [args: S['args']];

type TagValues<S extends MessageShape, N> = { [T in Exclude<S['tags'], DefaultTags>]: TagFn<N> } & {
  [T in Extract<S['tags'], DefaultTags>]?: TagFn<N>;
};

/** A rich read takes the message's arguments and a function per tag it wraps, beside the defaults. */
export type RichValues<S extends MessageShape, N> = S['args'] & TagValues<S, N>;
export type RichParam<S extends MessageShape, N> =
  NoArgs<RichValues<S, N>> extends true ? [values?: RichValues<S, N>] : [values: RichValues<S, N>];

/** The keys whose message wraps part of itself in a tag. */
export type RichKey<M extends MessageShapes> = { [K in keyof M]: [M[K]['tags']] extends [never] ? never : K }[keyof M] & string;
