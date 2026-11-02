import { useCopy } from 'prosebook/react';
import { lazy, Suspense } from 'react';

const Cart = lazy(() => import('./Cart.tsx'));
const lastVisit = new Date(2026, 9, 28, 14, 5);

export function App() {
  const copy = useCopy();
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

      <Suspense fallback={null}>
        <Cart />
      </Suspense>
    </main>
  );
}
