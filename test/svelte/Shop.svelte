<script lang="ts">
  import type { Copy } from 'prosebook';
  import { getCopy, setCopy, Text } from 'prosebook/svelte';

  import Title from './Title.svelte';

  let { copy }: { copy: Copy } = $props();
  // Untyped, as in the React test: no catalog is registered here.
  // svelte-ignore state_referenced_locally
  setCopy(copy, { tags: { b } });
  const read = getCopy() as unknown as { locale: string };
</script>

{#snippet b(chunks)}<strong><Text {chunks} /></strong>{/snippet}
{#snippet link(chunks)}<a href="#t"><Text {chunks} /></a>{/snippet}

<div lang={read.locale}><Title /><Text id={'a.items' as never} values={{ n: 3 }} /><p><Text id={'a.terms' as never} {link} /></p></div>
