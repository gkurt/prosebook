<script setup lang="ts">
import { Text, useCopy } from 'prosebook/vue';
import { ref } from 'vue';

const PRICE = 4.5;
const lastVisit = new Date(2026, 9, 28, 14, 5);

// Reads in the template run again when the locale changes.
const copy = useCopy();
const count = ref(2);
const express = ref(false);
const languageName = (locale: string) => new Intl.DisplayNames([copy.locale], { type: 'language' }).of(locale) ?? locale;
const switchTo = (event: Event) => void copy.setLocale((event.target as HTMLSelectElement).value);
</script>

<template>
  <main :lang="copy.locale">
    <header>
      <h1>{{ copy.t('app.title') }}</h1>
      <label>
        {{ copy.t('app.language') }}
        <select :value="copy.locale" @change="switchTo">
          <option v-for="locale in copy.locales" :key="locale" :value="locale">{{ languageName(locale) }}</option>
        </select>
      </label>
    </header>

    <section>
      <h2>{{ copy.t('app.greeting', { name: 'Ada' }) }}</h2>
      <div class="muted">{{ copy.t('app.last-visit', { when: lastVisit }) }}</div>
    </section>

    <section>
      <h2>{{ copy.t('cart.title') }}</h2>
      <Text id="cart.items" :values="{ count }" />
      <div class="row">
        <button type="button" @click="count++">{{ copy.t('cart.add') }}</button>
        <button type="button" @click="count = 0">{{ copy.t('cart.remove') }}</button>
        <label><input v-model="express" type="checkbox" />{{ copy.t('cart.express') }}</label>
      </div>
      <div class="row">
        <strong>{{ copy.t('cart.total', { amount: count * PRICE }) }}</strong>
        <button type="button" class="primary" :disabled="count === 0">{{ copy.t('cart.checkout') }}</button>
      </div>
      <div class="muted">{{ copy.t('cart.shipping', { days: express ? 1 : 3, speed: express ? 'express' : 'standard' }) }}</div>
      <p class="muted"><Text id="cart.terms" /></p>
      <p>{{ copy.t('cart.place', { rank: count + 1 }) }}</p>
    </section>
  </main>
</template>
