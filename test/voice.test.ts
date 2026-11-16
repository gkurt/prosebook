import { describe, expect, test } from 'bun:test';

import { lint, loadCatalog } from 'prosebook/tools';

import { fixture } from './fixture.ts';

/** One entry per row, in the role given, with a context that breaks no rule unless the row gives one. */
interface Row {
  text: string;
  kind?: string;
  surface?: string;
  context?: string;
}

const yamlOf = (rows: Row[]) =>
  rows
    .map(({ text, kind, surface, context = 'A string in the app.' }, i) => {
      const names = [...new Set([...text.matchAll(/\{([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]))];
      const args = names.length === 0 ? '' : `  args:\n${names.map((n) => `    ${n}: A value.\n`).join('')}`;
      const role = `${kind === undefined ? '' : `  kind: ${kind}\n`}${surface === undefined ? '' : `  surface: ${surface}\n`}`;
      return `app.e${i}:\n${role}  context: ${JSON.stringify(context)}\n${args}  en: ${JSON.stringify(text)}\n`;
    })
    .join('');

/** The `voice/<rule>` findings on each row, in the row's order: `[]` where a row passes. */
function found(rule: string, rows: Row[]): string[][] {
  const config = fixture({ 'copy/catalog/app.yaml': yamlOf(rows) }, { require: [] });
  const catalog = loadCatalog(config);
  expect(catalog.problems.filter((p) => p.severity === 'error')).toEqual([]);
  const findings = lint(catalog.messages, config).filter((f) => f.rule === `voice/${rule}`);
  return rows.map((_, i) => findings.filter((f) => f.key === `app.e${i}`).map((f) => f.message));
}

/** Rows that break the rule each give a finding; rows that keep to it give none. */
function holds(rule: string, broken: Row[], kept: Row[]) {
  const results = found(rule, [...broken, ...kept]);
  broken.forEach((row, i) => expect([row.text, results[i]!.length > 0]).toEqual([row.text, true]));
  kept.forEach((row, i) => expect([row.text, results[broken.length + i]]).toEqual([row.text, []]));
}

describe('voice', () => {
  test('pointing: it, its, they, their, them and a place as there', () => {
    holds(
      'pointing',
      [
        { text: 'Name it, then connect the schedule to a workflow.' },
        { text: '{device} is offline: start its agent to browse the folders.' },
        { text: 'The agent has no shell or files there.' },
        { text: "It's ready." },
        { text: 'Admins choose repositories, and members see them.' },
        { text: 'Members keep their roles.' },
        { text: 'They appear in search results.' },
        { text: '{count, plural, one {# file is} other {# files are}} ready to review them' },
      ],
      [
        { text: 'Item saved' },
        // A word holding the letters is no pronoun.
        { text: 'Items, iterations and themes' },
        { text: 'Edit the theory, then the thesis' },
        // `there is` says something exists, and points at no place.
        { text: 'There are no runs yet.' },
        { text: 'Is there a newer version?' },
        // `of its own` is `of-its-own`'s, which says the fix.
        { text: 'Each session gets a folder of its own.' },
        { text: 'Status: {status}', kind: 'state', surface: 'status' },
      ],
    );
    expect(found('pointing', [{ text: 'The agent has no shell or files there.' }])[0]).toEqual([
      '"there" points at a place: name the place, as "in the sandbox"',
    ]);
  });

  test('of-its-own: a thing named before, pointed at', () => {
    holds(
      'of-its-own',
      [
        { text: 'Each session gets a folder of its own.' },
        { text: 'Sessions get folders of their own.' },
        { text: "Each session works on a branch of {repo}'s own." },
        { text: 'Each team has a canvas of Canvas’s own.' },
      ],
      [{ text: 'Bring a key of your own.' }, { text: 'Each session gets a separate folder.' }, { text: 'Own the incident' }],
    );
    expect(found('of-its-own', [{ text: "A branch of {repo}'s own" }])[0]).toEqual([
      `"of {repo}'s own" points at a thing named before: write "separate", "dedicated" or "per session", as "Each session gets a separate folder"`,
    ]);
  });

  test('semicolons: two facts make two sentences', () => {
    holds(
      'semicolons',
      [
        { text: 'Your personal team is just for you; create a team to work with others.' },
        { text: 'Ready in seconds; files are fetched on demand' },
        { text: 'Saved;' },
      ],
      [
        { text: 'Your personal team is for you alone. Create a team to work with others.' },
        // A semicolon inside code is the code's.
        { text: 'Run <code>a; b</code> in the shell.' },
        { text: 'Escape &amp; to write an ampersand.' },
      ],
    );
  });

  test('colon-clause: a colon before a lowercase clause in a description or a state', () => {
    holds(
      'colon-clause',
      [
        { text: 'None: every event starts work.', kind: 'state', surface: 'empty' },
        { text: 'Notifications are blocked: allow them in site settings.', kind: 'description', surface: 'hint' },
        { text: 'Skipped: the route is off.', kind: 'state', surface: 'detail' },
      ],
      [
        // A value after a label.
        { text: 'Region: {region}', kind: 'state', surface: 'status' },
        { text: 'Canvas review: failed', kind: 'state', surface: 'tooltip' },
        { text: 'Not answered: request from {name}', kind: 'state', surface: 'status' },
        // An error names the cause after a colon.
        { text: 'Build failed: npm run build exited with code 1.', kind: 'state', surface: 'error' },
        // A list of short items.
        { text: 'Three formats: json, yaml and toml.', kind: 'description', surface: 'hint' },
        { text: 'No diff to show: binary, or too large.', kind: 'state', surface: 'empty' },
        // A capital after the colon starts a sentence.
        { text: 'Heads up: Canvas restarts at noon.', kind: 'description', surface: 'hint' },
        // Other kinds are left to `bare-name`.
        { text: 'Quick capture: choose an area', kind: 'action', surface: 'action' },
        { text: 'Ratio: 3:1', kind: 'state', surface: 'status' },
      ],
    );
  });

  test('figurative-verbs: a thing never comes, says or asks for', () => {
    holds(
      'figurative-verbs',
      [
        { text: 'Name the schedule, say when it comes, then connect the schedule to a workflow' },
        { text: 'Never comes again' },
        { text: 'Times come closer together than 15 minutes.' },
        { text: 'The comment on GitHub says which.' },
        { text: 'The session it came from is private' },
        { text: 'The tool asks for approval.' },
      ],
      [
        { text: 'Runs every Monday' },
        { text: 'Coming soon' },
        { text: 'Times less than 15 minutes apart' },
        { text: 'Request approval' },
        { text: 'Sayings and comedies' },
      ],
    );
  });

  test('dangling-modifier: a sentence opens with a setting’s state', () => {
    holds(
      'dangling-modifier',
      [
        { text: 'Enabled, a session in a git repository works in a worktree.' },
        { text: 'Left empty, each session gets a separate folder.' },
        { text: "Disabled, or in a folder that isn't a repository, sessions share the configuration folder." },
        { text: 'Saved to the cloud. Enabled for a team, members see the drafts.' },
        { text: 'Turned off, the inspector hides each key.' },
        { text: 'Based on your plan, we recommend the team tier.' },
        { text: 'Off, sessions share the configuration folder.' },
        { text: 'Set to {mode}, the agent asks before each command.' },
      ],
      [
        { text: 'With worktrees enabled, a session in a git repository works in a worktree.' },
        { text: 'When enabled, each session gets a separate folder.' },
        { text: 'If the field is empty, each session gets a separate folder.' },
        // A second clause about the same subject, a short detail, or a list.
        { text: 'Saved, but not published yet.' },
        { text: 'Copied, ready to paste.' },
        { text: 'Connected, 3 devices' },
        { text: 'Archived, then deleted after 30 days.' },
        { text: 'Detailed logs, traces and metrics' },
        { text: 'Accented, padded text shows the strings the catalog missed.' },
        // `need` and `speed` are no participles.
        { text: 'Need help, reach out to the team.' },
        { text: 'Embedded in the page.' },
        // A preposition, a clause, and a pronoun naming what the modifier describes.
        { text: 'On a server, each request gets a separate copy.' },
        { text: 'Hardcoded text is the code’s, and the scan finds the text.' },
        { text: 'Unset, it is the provider’s name.' },
        // A participle naming the subject after it, a verb with its object, and words that modify nothing.
        { text: 'Opened from the Finder, the app takes the folder as its root.' },
        { text: 'Left alone, OpenCode fetches the model list once a day.' },
        { text: 'Signed in, the connector syncs every hour.' },
        { text: 'Added {name}, and the list is sorted again.' },
        { text: 'Enabled {name}, so the workflow runs on every push.' },
        { text: 'Generated, formatting, imports and whitespace hunks are folded.' },
        { text: 'Named values, with a format for each.' },
      ],
    );
    expect(found('dangling-modifier', [{ text: 'Left empty, each session gets a separate folder.' }])[0]).toEqual([
      '"Left empty," is the state of a setting the sentence never names, so it reads as the state of the subject after it: name the setting, as "With worktrees enabled, a session…" or "If the field is empty, each session…"',
    ]);
  });

  test('a context is held to the rules against pointing, semicolons and figurative verbs, and not to the rest', () => {
    const context = (text: string) => found('pointing', [{ text: 'Saved', context: text }])[0];
    expect(context('A toast after the form is saved; it closes after a few seconds.')).toEqual([
      'in the context, "it" points at a thing in place of naming the thing: write the name, as "the workflow\'s name" in place of "its name"',
    ]);
    const config = fixture(
      {
        'copy/catalog/app.yaml': yamlOf([
          {
            text: 'Saved',
            kind: 'state',
            surface: 'toast',
            context: 'Says the form was saved: it closes after a few seconds; then the next comes.',
          },
        ]),
      },
      { require: [] },
    );
    const rules = lint(loadCatalog(config).messages, config).map((f) => f.rule);
    // `says` and `comes`, each with the verb the product uses in its place.
    expect(rules).toEqual(['voice/pointing', 'voice/semicolons', 'voice/figurative-verbs', 'voice/figurative-verbs']);
    // An exemption covers the message and the context alike.
    const allowed = fixture(
      {
        'copy/catalog/app.yaml':
          'app.a:\n  context: Says the form was saved.\n  allow:\n    voice/figurative-verbs: The context names what the message reads.\n  en: Saved\n',
      },
      { require: [] },
    );
    expect(lint(loadCatalog(allowed).messages, allowed)).toEqual([]);
  });

  test('the checked rules are warnings in recommended, errors in strict, off in the docs, and off with voice/*', () => {
    const config = fixture({}, { lint: { extends: 'strict' } });
    for (const rule of ['pointing', 'of-its-own', 'semicolons', 'colon-clause', 'figurative-verbs', 'dangling-modifier']) {
      expect(fixture({}).lint.rules[`voice/${rule}`]?.severity).toBe('warn');
      expect(config.lint.rules[`voice/${rule}`]?.severity).toBe('error');
      expect(fixture({}, { lint: { rules: { 'voice/*': 'off' } } }).lint.rules[`voice/${rule}`]?.severity).toBe('off');
      expect(fixture({}, { source: 'de' }).lint.rules[`voice/${rule}`]?.severity).toBe('off');
    }
    expect(config.lint.docs).toMatchObject({
      'voice/pointing': 'off',
      'voice/of-its-own': 'off',
      'voice/semicolons': 'off',
      'voice/figurative-verbs': 'off',
    });
  });
});
