import { serverCopy } from '@/server-copy.ts';

import { Cart } from './cart.tsx';
import { LanguagePicker } from './language-picker.tsx';

const lastVisit = new Date(2026, 9, 28, 14, 5);

// A server component reads the catalog through a copy made for the request; the client components
// below read it through the provider, in the same locale.
export default async function Page() {
  const { t } = await serverCopy();
  return (
    <main>
      <header>
        <h1>{t('app.title')}</h1>
        <LanguagePicker />
      </header>
      <section>
        <h2>{t('app.greeting', { name: 'Ada' })}</h2>
        <div className="muted">{t('app.last-visit', { when: lastVisit })}</div>
      </section>
      <Cart />
    </main>
  );
}
