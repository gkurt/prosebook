/**
 * `prosebook/react`: the catalog in components.
 *
 * `useCopy()` re-renders its component when the locale changes, and its `rich` returns a ready
 * `ReactNode`: elements are keyed and tag functions receive keyed children, so a sentence with a
 * link inside it is one catalog entry and one call, with no wrapper to remember.
 */
import { createContext, Fragment, isValidElement, use, useEffect, useMemo, useReducer, useSyncExternalStore, type ReactNode } from 'react';

import { waitingReader, type BoundCopy, type TextProps as Props } from '#src/runtime/bind.ts';
import type { Copy } from '#src/runtime/copy.ts';
import type { MessageKey, RegisteredLocale, TagFn } from '#src/runtime/types.ts';

/** `Copy`, with `rich` returning a `ReactNode`. */
export type ReactCopy = BoundCopy<ReactNode>;

const CopyContext = createContext<{ copy: Copy; tags: Tags } | null>(null);

type Tags = { readonly [tag: string]: TagFn<ReactNode> };

export interface CopyProviderProps {
  copy: Copy;
  /**
   * Tag renderers every rich read under this provider gets, beside the copy's own. Keep the object
   * stable (a module constant, or `useMemo`): a new one makes every `useCopy()` reader new.
   */
  tags?: Tags;
  children?: ReactNode;
}

// One object for every render without tags, so `useCopy()`'s reader keeps its identity: a fresh `{}`
// each render would rebuild it, and every effect that depends on `t` would run again.
const NO_TAGS: Tags = Object.freeze({});

export function CopyProvider({ copy, tags = NO_TAGS, children }: CopyProviderProps) {
  const value = useMemo(() => ({ copy, tags }), [copy, tags]);
  return <CopyContext value={value}>{children}</CopyContext>;
}

/**
 * The catalog, in the current locale. Re-renders the component when the locale changes, or in dev the catalog, and
 * when a relative time it read, as text or a node, next reads differently: "5 minutes ago" from `t` stays current.
 */
export function useCopy(): ReactCopy {
  const context = use(CopyContext);
  if (context === null) throw new Error('prosebook: useCopy() needs a <CopyProvider> above it');
  const { copy, tags } = context;
  const version = useSyncExternalStore(
    copy.subscribe,
    () => copy.version,
    () => copy.version,
  );
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  // Rebuilt on each version, so its identity changes when what it reads does.
  const { reader, wait } = useMemo(() => waitingReader<ReactNode, ReactNode>(copy, tags, { tag, whole }), [copy, tags, version]);
  // Renders the component again when a relative time it read next reads differently. After every render, as reads
  // differ between them; an effect, so a server sets no timer, and a page hydrates before any time moves on.
  useEffect(() => wait(refresh));
  return reader;
}

/** The current locale alone, for components that only format or switch. */
export function useLocale(): RegisteredLocale {
  const context = use(CopyContext);
  if (context === null) throw new Error('prosebook: useLocale() needs a <CopyProvider> above it');
  return useSyncExternalStore(
    context.copy.subscribe,
    () => context.copy.locale,
    () => context.copy.locale,
  );
}

const tag = (render: (chunks: never) => unknown, chunks: unknown[]) => render(keyed(chunks) as never);
const whole = (parts: unknown[]): ReactNode => <>{keyed(parts)}</>;

/** Text joined where it can be, and each element under its own key, so React never warns about a list. */
function keyed(parts: unknown[]): (string | ReactNode)[] {
  if (parts.every((p) => typeof p === 'string')) return [parts.join('')];
  return parts.map((p, i) =>
    // oxlint-disable-next-line react/no-array-index-key -- the parts of one message never reorder, so positions are stable keys
    isValidElement(p) || typeof p === 'object' ? <Fragment key={i}>{p as ReactNode}</Fragment> : (p as ReactNode),
  );
}

export type TextProps<K extends MessageKey> = Props<K, ReactNode>;

/**
 * A message as an element: `<Text id="cart.items" values={{ count }} />`. Rich messages render their
 * tags through the provider's renderers and any given in `values`. A relative time in the message
 * stays fresh: the element renders itself again when it next reads differently, and nothing else does.
 */
export function Text<K extends MessageKey>(props: TextProps<K>) {
  const copy = useCopy();
  return <>{copy.rich(props.id as never, (props as { values?: object }).values as never)}</>;
}
