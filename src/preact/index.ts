/**
 * `prosebook/preact`: the catalog in Preact components, as `prosebook/react` has it in React's.
 *
 * Written with `preact/hooks` alone, so it needs no `preact/compat`.
 */
import { createContext, Fragment, h, isValidElement, type ComponentChildren, type VNode } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';

import { bindCopy, type BoundCopy, type TextProps as Props } from '#src/runtime/bind.ts';
import type { Copy } from '#src/runtime/copy.ts';
import type { RegisteredLocale, RegisteredMessages, TagFn } from '#src/runtime/types.ts';

type M = RegisteredMessages;

/** `Copy`, with `rich` returning a `VNode`. */
export type PreactCopy = BoundCopy<ComponentChildren, VNode>;

type Tags = { readonly [tag: string]: TagFn<ComponentChildren> };

const CopyContext = createContext<{ copy: Copy; tags: Tags } | null>(null);

export interface CopyProviderProps {
  copy: Copy;
  /** Tag renderers every rich read under this provider gets, beside the copy's own. */
  tags?: Tags;
  children?: ComponentChildren;
}

export function CopyProvider({ copy, tags = {}, children }: CopyProviderProps) {
  const value = useMemo(() => ({ copy, tags }), [copy, tags]);
  return h(CopyContext.Provider, { value }, children);
}

function useContextOf(hook: string) {
  const context = useContext(CopyContext);
  if (context === null) throw new Error(`prosebook: ${hook}() needs a <CopyProvider> above it`);
  return context;
}

/** Renders the component again after each change to what the copy reads: a locale switch, or in dev a catalog edit. */
function useVersion(copy: Copy): number {
  const [, rerender] = useState(0);
  const version = copy.version;
  // Preact has no useSyncExternalStore outside compat: the effect subscribes once the component mounts.
  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    const stop = copy.subscribe(update);
    // A change between this render and the subscription would otherwise go unseen.
    if (copy.version !== version) update();
    return stop;
  }, [copy]);
  return version;
}

/** The catalog, in the current locale. Renders the component again when the locale changes, or in dev the catalog. */
export function useCopy(): PreactCopy {
  const { copy, tags } = useContextOf('useCopy');
  const version = useVersion(copy);
  // Rebuilt on each version, so its identity changes when what it reads does.
  return useMemo(() => bindCopy(copy, tags, { tag, whole }), [copy, tags, version]);
}

/** The current locale alone, for components that only format or switch. */
export function useLocale(): RegisteredLocale {
  const { copy } = useContextOf('useLocale');
  useVersion(copy);
  return copy.locale;
}

const tag = (render: (chunks: never) => unknown, chunks: unknown[]) => render(keyed(chunks) as never);
const whole = (parts: unknown[]): VNode => h(Fragment, null, keyed(parts));

/** Text joined where it can be, and each element under its own key, as `prosebook/react` does. */
function keyed(parts: unknown[]): ComponentChildren[] {
  if (parts.every((p) => typeof p === 'string')) return [parts.join('')];
  return parts.map((p, i) =>
    isValidElement(p) || typeof p === 'object' ? h(Fragment, { key: i }, p as ComponentChildren) : (p as ComponentChildren),
  );
}

export type TextProps<K extends Extract<keyof M, string>> = Props<K, ComponentChildren>;

/**
 * A message as an element: `<Text id="cart.items" values={{ count }} />`. Rich messages render their
 * tags through the provider's renderers and any given in `values`.
 */
export function Text<K extends Extract<keyof M, string>>(props: TextProps<K>): VNode {
  const copy = useCopy();
  const values = (props as { values?: object }).values;
  return copy.rich(props.id as never, values as never);
}
