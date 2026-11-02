/**
 * `prosebook/solid`: the catalog in Solid components.
 *
 * Every read tracks a signal the copy sets on each change, so JSX that reads a message updates in
 * place when the locale switches; components never run again. `rich` returns what its tag renderers
 * made, beside the text, ready to put in JSX. Written without JSX, so it needs no Solid compiler.
 */
import { createComponent, createContext, createMemo, createSignal, onCleanup, useContext, type Accessor, type JSX } from 'solid-js';

import { bindCopy, type BoundCopy, type TextProps as Props } from '#src/runtime/bind.ts';
import type { Copy } from '#src/runtime/copy.ts';
import type { RegisteredLocale, RegisteredMessages, TagFn } from '#src/runtime/types.ts';

type M = RegisteredMessages;

/** `Copy`, with `rich` returning a `JSX.Element`, whose reads are tracked. */
export type SolidCopy = BoundCopy<JSX.Element>;

type Tags = { readonly [tag: string]: TagFn<JSX.Element> };

const CopyContext = createContext<SolidCopy>();

export interface CopyProviderProps {
  /** Read once: give a provider a new key to change the copy under it. */
  copy: Copy;
  /** Tag renderers every rich read under this provider gets, beside the copy's own. */
  tags?: Tags;
  children?: JSX.Element;
}

export function CopyProvider(props: CopyProviderProps): JSX.Element {
  const { copy, tags = {} } = props;
  const [version, setVersion] = createSignal(copy.version);
  onCleanup(copy.subscribe(() => setVersion(copy.version)));
  const value = bindCopy<JSX.Element, JSX.Element>(copy, tags, { track: version, whole: (parts) => parts as JSX.Element });
  return createComponent(CopyContext.Provider, {
    value,
    get children() {
      return props.children;
    },
  });
}

/** The catalog, in the current locale. What reads it updates when the locale changes, or in dev the catalog. */
export function useCopy(): SolidCopy {
  const reader = useContext(CopyContext);
  if (reader === undefined) throw new Error('prosebook: useCopy() needs a <CopyProvider> above it');
  return reader;
}

/** The current locale, as an accessor. */
export function useLocale(): Accessor<RegisteredLocale> {
  const reader = useCopy();
  return () => reader.locale;
}

export type TextProps<K extends Extract<keyof M, string>> = Props<K, JSX.Element>;

/**
 * A message as an element: `<Text id="cart.items" values={{ count }} />`. Rich messages render their
 * tags through the provider's renderers and any given in `values`.
 */
export function Text<K extends Extract<keyof M, string>>(props: TextProps<K>): JSX.Element {
  const copy = useCopy();
  // An accessor is something JSX renders, and runs again when the message or its values change.
  return createMemo(() => copy.rich(props.id as never, (props as { values?: object }).values as never)) as unknown as JSX.Element;
}
