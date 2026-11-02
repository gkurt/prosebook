import { serverCopy } from '@/server-copy.ts';

import { LanguagePicker } from './language-picker.tsx';

export async function Header() {
  const { t } = await serverCopy();
  return (
    <header>
      <h1>{t('app.title')}</h1>
      <LanguagePicker />
    </header>
  );
}
