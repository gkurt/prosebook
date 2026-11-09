<script lang="ts">
  import type { Copy } from 'prosebook';
  import { setCopy } from 'prosebook/svelte';

  let { copy, at, line, other }: { copy: Copy; at: number; line: () => number; other: () => number } = $props();
  // svelte-ignore state_referenced_locally
  const { t, locale } = setCopy(copy) as unknown as { t: (key: string, values: object) => string; locale: string };
  // svelte-ignore state_referenced_locally
  const text = $derived((line(), t('a.opened', { at })));
  // svelte-ignore state_referenced_locally
  const lang = $derived((other(), locale === 'en' ? '' : locale));
</script>

<span title={text}>{text}</span><i>{lang}</i>
