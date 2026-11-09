/**
 * `prosebook/svelte`: the catalog in Svelte 5 components.
 *
 * Every read goes through a subscriber the copy updates on each change, so markup, `$derived` and
 * effects that read a message run again when the locale switches. Tags render through snippets:
 * a rich read returns text and `{ snippet, chunks }` parts, which `<Text>` renders.
 */
import { getContext, setContext, type Snippet } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';

import { bindCopy, freshness, type BoundCopy } from '#src/runtime/bind.ts';
import type { Copy } from '#src/runtime/copy.ts';
import type { DefaultTags, MessageShape, RegisteredMessages, RichKey } from '#src/runtime/types.ts';

export { default as Text } from './Text.svelte';

type M = RegisteredMessages;

/** What a rich read returns: text, and each tag as the snippet that renders it and what it wraps. */
export type RichPart = string | { snippet: TagSnippet; chunks: RichPart[] };

/** Renders a tag: `{#snippet link(chunks)}<a href="/terms"><Text {chunks} /></a>{/snippet}`. */
export type TagSnippet = Snippet<[chunks: RichPart[]]>;

type Tags = { readonly [tag: string]: TagSnippet };

/** The arguments of a rich read, and a snippet for each tag no default renders. */
export type RichSnippets<S extends MessageShape> = S['args'] & { [T in Exclude<S['tags'], DefaultTags>]: TagSnippet } & {
  [T in Extract<S['tags'], DefaultTags>]?: TagSnippet;
};

/** `Copy`, whose reads are reactive, with `rich` taking snippets and returning parts for `<Text>`. */
export interface SvelteCopy extends Omit<BoundCopy<never>, 'rich'> {
  rich<K extends RichKey<M>>(
    this: void,
    key: K,
    ...values: {} extends RichSnippets<M[K]> ? [values?: RichSnippets<M[K]>] : [values: RichSnippets<M[K]>]
  ): RichPart[];
}

export interface CopyOptions {
  /** Snippets every rich read gets for these tags, beside the copy's own renderers. */
  tags?: Tags;
}

const KEY = Symbol('prosebook');

/** Gives this component and those under it the copy, and returns it as `getCopy()` would. Call it while the component initialises. */
export function setCopy(copy: Copy, options: CopyOptions = {}): SvelteCopy {
  const track = createSubscriber((update) => copy.subscribe(update));
  const reader = bindCopy<never, RichPart[]>(copy, options.tags ?? {}, {
    track,
    // A subscriber per moment a read next changes, waiting only while something reads it: what read the text alone runs again.
    fresh: freshness(copy, (wait) => createSubscriber(wait)),
    // A snippet renders only inside markup, so a tag's parts wait there for `<Text>`.
    tag: (snippet, chunks) => ({ snippet, chunks }),
    whole: (parts) => parts as RichPart[],
  });
  return setContext(KEY, reader as unknown as SvelteCopy);
}

/** The catalog, in the current locale. What reads it runs again when the locale changes, or in dev the catalog. */
export function getCopy(): SvelteCopy {
  const reader = getContext<SvelteCopy | undefined>(KEY);
  if (reader === undefined) throw new Error('prosebook: getCopy() needs setCopy(copy) in a component above it');
  return reader;
}
