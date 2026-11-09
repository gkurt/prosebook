<!--
  A message, its tags rendered by snippets of the same name: `<Text id="cart.items" values={{ count }} />`.
  Given `chunks` instead, as a tag's snippet is, renders what the tag wraps. A relative time in the
  message stays fresh: it renders again when it next reads differently, and nothing else does.
-->
<script lang="ts">
  import { getCopy, type RichPart } from 'prosebook/svelte';

  let { id, values, chunks, ...snippets }: { id?: string; values?: object; chunks?: RichPart[]; [tag: string]: unknown } = $props();
  const copy = getCopy();
  const parts = $derived(chunks ?? copy.rich(id as never, { ...snippets, ...values } as never));
</script>

{#each parts as part}{#if typeof part === 'string'}{part}{:else}{@render part.snippet(part.chunks)}{/if}{/each}
