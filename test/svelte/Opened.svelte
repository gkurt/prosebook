<script lang="ts">
  import type { Copy } from 'prosebook';
  import { setCopy, Text } from 'prosebook/svelte';

  let { copy, at, rendered }: { copy: Copy; at: number; rendered: () => void } = $props();
  // svelte-ignore state_referenced_locally
  setCopy(copy);
  // svelte-ignore state_referenced_locally
  rendered();
</script>

<p><Text id={'a.opened' as never} values={{ at }} /></p>
