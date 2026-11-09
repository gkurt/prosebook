<script lang="ts">
  import { getCopy, Text } from 'prosebook/svelte';

  const PRICE = 4.5;
  const lastVisit = new Date(2026, 9, 28, 14, 5);

  // Reads in markup run again when the locale changes.
  const copy = getCopy();
  let count = $state(2);
  let express = $state(false);
  // When the cart last changed, which <Text> says as how long ago, and says again as time passes.
  let savedAt = $state(Date.now());
  const change = (to: number) => {
    count = to;
    savedAt = Date.now();
  };
  const languageName = (locale: string) => new Intl.DisplayNames([copy.locale], { type: 'language' }).of(locale) ?? locale;
</script>

<main lang={copy.locale}>
  <header>
    <h1>{copy.t('app.title')}</h1>
    <label>
      {copy.t('app.language')}
      <select value={copy.locale} onchange={(e) => void copy.setLocale(e.currentTarget.value)}>
        {#each copy.locales as locale (locale)}
          <option value={locale}>{languageName(locale)}</option>
        {/each}
      </select>
    </label>
  </header>

  <section>
    <h2>{copy.t('app.greeting', { name: 'Ada' })}</h2>
    <div class="muted">{copy.t('app.last-visit', { when: lastVisit })}</div>
  </section>

  <section>
    <h2>{copy.t('cart.title')}</h2>
    <Text id="cart.items" values={{ count }} />
    <p class="muted"><Text id="cart.saved" values={{ at: savedAt }} /></p>
    <div class="row">
      <button type="button" onclick={() => change(count + 1)}>{copy.t('cart.add')}</button>
      <button type="button" onclick={() => change(0)}>{copy.t('cart.remove')}</button>
      <label><input type="checkbox" bind:checked={express} />{copy.t('cart.express')}</label>
    </div>
    <div class="row">
      <strong>{copy.t('cart.total', { amount: count * PRICE })}</strong>
      <button type="button" class="primary" disabled={count === 0}>{copy.t('cart.checkout')}</button>
    </div>
    <div class="muted">{copy.t('cart.shipping', { days: express ? 1 : 3, speed: express ? 'express' : 'standard' })}</div>
    <p class="muted"><Text id="cart.terms" /></p>
    <p>{copy.t('cart.place', { rank: count + 1 })}</p>
  </section>
</main>
