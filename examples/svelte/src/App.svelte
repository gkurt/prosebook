<script lang="ts">
  import type { Copy } from 'prosebook';
  import { setCopy, Text, type RichPart } from 'prosebook/svelte';

  import Shop from './Shop.svelte';

  let { copy }: { copy: Copy } = $props();
  // The copy, and the snippet every message's <link> renders through, for everything below.
  // svelte-ignore state_referenced_locally
  setCopy(copy, { tags: { link } });
</script>

{#snippet link(chunks: RichPart[])}<a href="#terms"><Text {chunks} /></a>{/snippet}

<Shop />
