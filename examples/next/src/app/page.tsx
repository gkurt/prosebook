import Link from 'next/link';

import { serverCopy } from '@/server-copy.ts';

import { Header } from './header.tsx';

const lastVisit = new Date(2026, 9, 28, 14, 5);

// A server component reads the catalog through a copy made for the request; the client components
// read it through the provider, in the same locale.
export default async function Page() {
  const { t } = await serverCopy();
  return (
    <main>
      <Header />
      <section>
        <h2>{t('app.greeting', { name: 'Ada' })}</h2>
        <div className="muted">{t('app.last-visit', { when: lastVisit })}</div>
      </section>
      <p>
        <Link href="/cart">{t('cart.title')}</Link>
      </p>
    </main>
  );
}
