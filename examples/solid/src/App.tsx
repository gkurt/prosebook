import { Text, useCopy } from 'prosebook/solid';
import { createSignal, For } from 'solid-js';

const PRICE = 4.5;
const lastVisit = new Date(2026, 9, 28, 14, 5);

/** When the cart last changed, which <Text> says as how long ago, and says again as time passes; and what marks a change. */
function lastChange() {
  const [at, setAt] = createSignal(Date.now());
  return [at, () => setAt(Date.now())] as const;
}

export function App() {
  // Runs once: each read below updates in place when the locale changes.
  const copy = useCopy();
  const [count, setCount] = createSignal(2);
  const [express, setExpress] = createSignal(false);
  const [savedAt, saved] = lastChange();
  const change = (to: number) => {
    setCount(to);
    saved();
  };
  const languageName = (locale: string) => new Intl.DisplayNames([copy.locale], { type: 'language' }).of(locale) ?? locale;

  return (
    <main lang={copy.locale}>
      <header>
        <h1>{copy.t('app.title')}</h1>
        <label>
          {copy.t('app.language')}
          <select value={copy.locale} onChange={(e) => void copy.setLocale(e.currentTarget.value)}>
            <For each={copy.locales}>{(locale) => <option value={locale}>{languageName(locale)}</option>}</For>
          </select>
        </label>
      </header>

      <section>
        <h2>{copy.t('app.greeting', { name: 'Ada' })}</h2>
        <div class="muted">{copy.t('app.last-visit', { when: lastVisit })}</div>
      </section>

      <section>
        <h2>{copy.t('cart.title')}</h2>
        <Text id="cart.items" values={{ count: count() }} />
        <p class="muted">
          <Text id="cart.saved" values={{ at: savedAt() }} />
        </p>
        <div class="row">
          <button type="button" onClick={() => change(count() + 1)}>
            {copy.t('cart.add')}
          </button>
          <button type="button" onClick={() => change(0)}>
            {copy.t('cart.remove')}
          </button>
          <label>
            <input type="checkbox" checked={express()} onChange={(e) => setExpress(e.currentTarget.checked)} />
            {copy.t('cart.express')}
          </label>
        </div>
        <div class="row">
          <strong>{copy.t('cart.total', { amount: count() * PRICE })}</strong>
          <button type="button" class="primary" disabled={count() === 0}>
            {copy.t('cart.checkout')}
          </button>
        </div>
        <div class="muted">{copy.t('cart.shipping', { days: express() ? 1 : 3, speed: express() ? 'express' : 'standard' })}</div>
        <p class="muted">{copy.rich('cart.terms')}</p>
        <p>{copy.t('cart.place', { rank: count() + 1 })}</p>
      </section>
    </main>
  );
}
