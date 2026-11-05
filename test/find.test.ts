import { expect, test } from 'bun:test';

import { loadCatalog } from 'prosebook/tools';

import { findEntries } from '#src/tools/find.ts';
import { cli, fixture } from './fixture.ts';

const shop = () =>
  fixture(
    {
      'prosebook.config.json': '{ "require": [] }',
      'copy/catalog/app.yaml': [
        'app.save:\n  kind: action\n  en: Save',
        'app.save-all:\n  kind: action\n  en: Save all',
        'app.saved:\n  kind: state\n  en: Saved.',
        'app.items: "{count, plural, one {# item} other {# items}}"',
        'app.fullscreen:\n  kind: action\n  en: Expand',
        'app.gone:\n  remove: true\n  en: Save',
      ].join('\n'),
    },
    { require: [] },
  );

test('find gives the entry saying the words first, then those saying most of them, in the role asked', () => {
  const config = shop();
  const keys = (query: string, options = {}) => findEntries(loadCatalog(config).messages, query, options).map((f) => f.message.key);
  expect(keys('save')).toEqual(['app.save', 'app.save-all', 'app.saved']);
  expect(keys('Save', { kind: 'state' })).toEqual(['app.saved']);
  // Every arm is read, and not the plural's own words; a key's words past its area count too.
  expect(keys('item')).toEqual(['app.items']);
  expect(keys('plural')).toEqual([]);
  expect(keys('full screen')).toEqual(['app.fullscreen']);
});

test('the command names the entry to read, or says to add one', () => {
  const config = shop();
  expect(cli(config.root, 'find', 'Save').stdout).toContain(
    'prosebook: 1 entry says "Save": read it rather than adding another\n  app.save (action): Save  copy/catalog/app.yaml:1',
  );
  expect(cli(config.root, 'find', 'Delete', '--kind', 'action').stdout).toContain('no entry says "Delete" as kind action: add one');
});
