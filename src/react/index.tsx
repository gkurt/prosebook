/**
 * `prosebook/react`: the catalog in components.
 *
 * `useCopy()` re-renders its component when the locale changes, and its `rich` returns a ready
 * `ReactNode`: elements are keyed and tag functions receive keyed children, so a sentence with a
 * link inside it is one catalog entry and one call, with no wrapper to remember.
 */
import { createContext, Fragment, isValidElement, use, useMemo, useSyncExternalStore, type ReactNode } from 'react';

import type { Copy } from '#src/runtime/copy.ts';
import type { MessageShape, RegisteredLocale, RegisteredMessages, RichKey, RichParam, TagFn } from '#src/runtime/types.ts';

type M = RegisteredMessages;
type L = RegisteredLocale;

/** `Copy`, with `rich` returning a `ReactNode`. */
export interface ReactCopy extends Omit<Copy<M, L>, 'rich'> {
  rich<K extends RichKey<M>>(this: void, key: K, ...values: RichParam<M[K], ReactNode>): ReactNode;
}

const CopyContext = createContext<{ copy: Copy<M, L>; tags: Tags } | null>(null);

type Tags = { readonly [tag: string]: TagFn<ReactNode> };

export interface CopyProviderProps {
  copy: Copy<M, L> | Copy;
  /** Tag renderers every rich read under this provider gets, beside the copy's own. */
  tags?: Tags;
  children?: ReactNode;
}

export function CopyProvider({ copy, tags, children }: CopyProviderProps) {
  const value = useMemo(() => ({ copy: copy as Copy<M, L>, tags: { ...(copy.tags as unknown as Tags), ...tags } }), [copy, tags]);
  return <CopyContext value={value}>{children}</CopyContext>;
}

/** The catalog, in the current locale. Re-renders the component when the locale changes. */
export function useCopy(): ReactCopy {
  const context = use(CopyContext);
  if (context === null) throw new Error('prosebook: useCopy() needs a <CopyProvider> above it');
  const { copy, tags } = context;
  const locale = useSyncExternalStore(
    copy.subscribe,
    () => copy.locale,
    () => copy.locale,
  );
  return useMemo(() => readerFor(copy, tags, locale), [copy, tags, locale]);
}

/** The current locale alone, for components that only format or switch. */
export function useLocale(): L {
  const context = use(CopyContext);
  if (context === null) throw new Error('prosebook: useLocale() needs a <CopyProvider> above it');
  return useSyncExternalStore(
    context.copy.subscribe,
    () => context.copy.locale,
    () => context.copy.locale,
  );
}

// Takes the locale only so the reader is rebuilt, and its identity changes, when the locale does.
function readerFor(copy: Copy<M, L>, tags: Tags, _locale: string): ReactCopy {
  return {
    locale: copy.locale,
    locales: copy.locales,
    source: copy.source,
    tags: copy.tags,
    ready: copy.ready,
    t: copy.t,
    has: copy.has,
    setLocale: copy.setLocale,
    subscribe: copy.subscribe,
    number: copy.number,
    date: copy.date,
    list: copy.list,
    relative: copy.relative,
    rich(key, ...values) {
      const given = (values[0] ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...tags, ...given };
      for (const [name, value] of Object.entries(merged))
        if (typeof value === 'function') merged[name] = (chunks: unknown[]) => (value as TagFn<ReactNode>)(keyed(chunks));

      return <>{keyed(copy.rich(key as never, merged as never))}</>;
    },
  };
}

/** Text joined where it can be, and each element under its own key, so React never warns about a list. */
function keyed(parts: unknown[]): (string | ReactNode)[] {
  if (parts.every((p) => typeof p === 'string')) return [parts.join('')];
  return parts.map((p, i) =>
    // oxlint-disable-next-line react/no-array-index-key -- the parts of one message never reorder, so positions are stable keys
    isValidElement(p) || typeof p === 'object' ? <Fragment key={i}>{p as ReactNode}</Fragment> : (p as ReactNode),
  );
}

type ValuesProp<S extends MessageShape> = {} extends S['args'] & { [T in S['tags']]: unknown }
  ? { values?: S['args'] & { [T in S['tags']]?: TagFn<ReactNode> } }
  : { values: RichParam<S, ReactNode>[0] };

export type TextProps<K extends Extract<keyof M, string>> = { id: K } & ValuesProp<M[K]>;

/**
 * A message as an element: `<Text id="cart.items" values={{ count }} />`. Rich messages render their
 * tags through the provider's renderers and any given in `values`.
 */
export function Text<K extends Extract<keyof M, string>>(props: TextProps<K>) {
  const copy = useCopy();
  const values = (props as { values?: object }).values;
  return <>{copy.rich(props.id as RichKey<M>, values)}</>;
}
