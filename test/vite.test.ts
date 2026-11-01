import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { build } from 'vite';

import { copydeck } from '#src/vite.ts';
import { fixture } from './fixture.ts';

test('a build ships only the messages the code names', async () => {
  const config = fixture({
    'copy/catalog/app.yaml': [
      'app.used: Used message',
      'app.unused: Unused message',
      'app.status.ok: Status ok',
      'app.status.down: Status down',
    ].join('\n'),
    'copy/locales/de/app.yaml': 'app.used: Benutzte Nachricht\napp.unused: Unbenutzte Nachricht\n',
    'index.html': '<script type="module" src="/src/main.ts"></script>',
    'src/main.ts': [
      "import { createCopy } from 'copydeck';",
      "import { catalog } from './copy/index.ts';",
      'const copy = createCopy(catalog);',
      "const state = location.hash ? 'ok' : 'down';",
      "document.body.textContent = copy.t('app.used') + copy.t(`app.status.${state}`);",
    ].join('\n'),
  });
  const outDir = join(config.root, 'dist');
  await build({
    root: config.root,
    logLevel: 'silent',
    configFile: false,
    plugins: [copydeck({ config: { require: [] } })],
    resolve: { alias: [{ find: /^copydeck$/, replacement: join(import.meta.dir, '..', 'src', 'index.ts') }] },
    build: { outDir, minify: false },
  });
  const js = readdirSync(join(outDir, 'assets'))
    .map((f) => readFileSync(join(outDir, 'assets', f), 'utf8'))
    .join('\n');
  expect(js).toContain('Used message');
  expect(js).toContain('Benutzte Nachricht');
  expect(js).toContain('Status ok');
  expect(js).toContain('Status down');
  expect(js).not.toContain('Unused message');
  expect(js).not.toContain('Unbenutzte Nachricht');
});
