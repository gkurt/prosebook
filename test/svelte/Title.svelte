<script lang="ts">
  import { getCopy } from 'prosebook/svelte';

  const { t } = getCopy() as unknown as { t: (key: string) => string };
</script>

<h1>{t('a.title')}</h1>
