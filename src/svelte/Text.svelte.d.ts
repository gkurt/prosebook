// Beside `Text.svelte` in src and in dist, so it names prosebook by package rather than by path.
import type { MessageKey, RegisteredMessages } from 'prosebook';
import type { RichPart, TagSnippet } from 'prosebook/svelte';
import type { Component } from 'svelte';

type M = RegisteredMessages;

/**
 * A message's props: its key, `values` once it takes arguments, and a snippet per tag no default renders.
 * Per key, so a key Svelte's tooling widens to the union still needs its own `values`.
 */
export type TextProps<K extends MessageKey> = K extends unknown
  ? { id: K } & ({} extends M[K]['args'] ? { values?: M[K]['args'] } : { values: M[K]['args'] }) & { [T in M[K]['tags']]?: TagSnippet }
  : never;

/** A message as markup, or with `chunks`, what a tag wraps. */
declare const Text: <K extends MessageKey>(
  ...args: Parameters<Component<TextProps<K> | { chunks: RichPart[] }>>
) => ReturnType<Component<TextProps<K> | { chunks: RichPart[] }>>;
export default Text;
