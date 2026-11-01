'use client';

import { useRouter } from 'next/navigation';
import { useCopy } from 'prosebook/react';

export function LanguagePicker() {
  const copy = useCopy();
  const router = useRouter();
  const languageName = (locale: string) => new Intl.DisplayNames([copy.locale], { type: 'language' }).of(locale) ?? locale;

  // The client switches at once; the server renders its part again in the locale the cookie names.
  const pick = async (locale: string) => {
    document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
    await copy.setLocale(locale);
    router.refresh();
  };

  return (
    <label>
      {copy.t('app.language')}
      <select value={copy.locale} onChange={(e) => void pick(e.target.value)}>
        {copy.locales.map((locale) => (
          <option key={locale} value={locale}>
            {languageName(locale)}
          </option>
        ))}
      </select>
    </label>
  );
}
