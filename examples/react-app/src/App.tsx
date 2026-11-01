import { Text, useCopy } from 'prosebook/react';
import { useState } from 'react';

const PRICE = 4.5;
const lastVisit = new Date(2026, 9, 28, 14, 5);

export function App() {
  const copy = useCopy();
  const [count, setCount] = useState(2);
  const [express, setExpress] = useState(false);
  const languageName = (locale: string) => new Intl.DisplayNames([copy.locale], { type: 'language' }).of(locale) ?? locale;

  return (
    <main lang={copy.locale}>
      <header>
        <h1>{copy.t('app.title')}</h1>
        <label>
          {copy.t('app.language')}
          <select value={copy.locale} onChange={(e) => void copy.setLocale(e.target.value)}>
            {copy.locales.map((locale) => (
              <option key={locale} value={locale}>
                {languageName(locale)}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section>
        <h2>{copy.t('app.greeting', { name: 'Ada' })}</h2>
        <div className="muted">{copy.t('app.last-visit', { when: lastVisit })}</div>
      </section>

      <section>
        <h2>{copy.t('cart.title')}</h2>
        <Text id="cart.items" values={{ count }} />
        <div className="row">
          <button type="button" onClick={() => setCount((n) => n + 1)}>
            {copy.t('cart.add')}
          </button>
          <button type="button" onClick={() => setCount(0)}>
            {copy.t('cart.remove')}
          </button>
          <label>
            <input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} />
            {copy.t('cart.express')}
          </label>
        </div>
        <div className="row">
          <strong>{copy.t('cart.total', { amount: count * PRICE })}</strong>
          <button type="button" className="primary" disabled={count === 0}>
            {copy.t('cart.checkout')}
          </button>
        </div>
        <div className="muted">{copy.t('cart.shipping', { days: express ? 1 : 3, speed: express ? 'express' : 'standard' })}</div>
        <p className="muted">{copy.rich('cart.terms')}</p>
        <p>{copy.t('cart.place', { rank: count + 1 })}</p>
      </section>
    </main>
  );
}
