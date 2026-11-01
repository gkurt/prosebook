import type { ReactNode } from 'react';

import { requestLocale, serverCopy } from '@/server-copy.ts';

import { Providers } from './providers.tsx';
import './globals.css';

export async function generateMetadata() {
  const { t } = await serverCopy();
  return { title: t('app.title') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await requestLocale();
  return (
    <html lang={locale}>
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
