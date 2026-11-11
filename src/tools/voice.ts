/**
 * The `voice` plugin: the habits of copy written off the code, as a model or a developer tends to write
 * the copy, said in the writing guide so the writer meets them first. Written for English, so on only
 * where the source is; `'voice/*': 'off'` turns them all off.
 *
 * Most are guidelines, matters of meaning a word list would flag in sound copy as often as it caught,
 * which a judge weighs (`judge.ts`). The rest are checks, each a pattern found reliably enough to flag
 * every time: words that point at a thing in place of naming the thing, semicolons, a colon before a
 * clause, and verbs that give a thing a voice or legs. The pointing words, the semicolons and the
 * verbs are checked in each entry's `context` too, as a writer copies the context's words into the copy.
 */
import { phrase, type CheckRule, type Plugin, type Report, type RuleContext } from './lint.ts';
import { asWritten, HOLE } from './places.ts';

/** `of its own`, `of their own` and `of {name}'s own`: a thing named before, pointed at. */
const OF_OWN = new RegExp(String.raw`(?<![\p{L}\p{N}'’-])of\s+(?:its|their|[\p{L}\p{N}${HOLE}]+['’]s)\s+own(?![\p{L}\p{N}'’-])`, 'giu');

/** `there is` and `is there` say that something exists, and point at no place. */
const EXISTENTIAL = /^(?:is|are|was|were|isn't|aren't|wasn't|weren't|'s|will be|has been|have been)(?![\p{L}'’-])/iu;
const ASKED = /(?<![\p{L}'’-])(?:is|are|was|were)\s+$/iu;

const POINTING = ['it', 'its', "it's", 'they', 'their', 'them', "they're"];

/** Whether `there` at `index` of `text` says that something exists, rather than naming a place. */
function existential(text: string, index: number): boolean {
  return EXISTENTIAL.test(text.slice(index + 'there'.length).trimStart()) || ASKED.test(text.slice(0, index));
}

const THERE = /(?<![\p{L}\p{N}'’-])there(?![\p{L}\p{N}'’-])/giu;

/** Every reading of the message, with `of its own` left out: `of-its-own` finds that, and says the fix. */
const unowned = ({ text }: RuleContext) => text.variants.map((v) => v.replace(OF_OWN, ' '));

const pointing: CheckRule = {
  description: 'Copy names the thing, never `it`, `its`, `they`, `their`, `them` or a place as `there`.',
  recommended: 'warn',
  context: true,
  check: (context) => {
    const variants = unowned(context);
    const said: Report[] = POINTING.filter((word) => variants.some((v) => phrase(word).test(v))).map((word) => ({
      message: `"${word}" points at a thing in place of naming the thing: write the name, as "the workflow's name" in place of "its name"`,
      match: word,
    }));
    const there = variants.some((v) => [...v.matchAll(THERE)].some((m) => !existential(v, m.index)));
    if (there) said.push({ message: '"there" points at a place: name the place, as "in the sandbox"', match: 'there' });
    return said;
  },
};

const ofItsOwn: CheckRule = {
  description: '`of its own` points at a thing named before: `Each session gets a separate folder`.',
  recommended: 'warn',
  context: true,
  check: (context) => {
    const found = context.text.variants.flatMap((v) => [...v.matchAll(OF_OWN)].map((m) => m[0]))[0];
    if (found === undefined) return [];
    const message = `"${asWritten(found, context)}" points at a thing named before: write "separate", "dedicated" or "per session", as "Each session gets a separate folder"`;
    return [{ message, match: found }];
  },
};

const semicolons: CheckRule = {
  description: 'Two facts make two sentences, never one joined with a semicolon.',
  recommended: 'warn',
  context: true,
  check: ({ text }) =>
    text.variants.some((v) => /(?<!&#?\w+);(?=\s|$)/.test(v))
      ? [
          {
            message: 'a semicolon joins two facts: end the first with a period, and start the second as a new sentence',
            match: /(?<!&#?\w+);(?=\s|$)/,
          },
        ]
      : [],
};

/** A colon, then a lowercase word: the start of a clause, or of a list. */
const COLON = new RegExp(String.raw`(?<=[\p{L}\p{N})"'”’])\s*:\s+(?=\p{Ll})`, 'gu');

/** A list's items: each three words at most, two items or more, between commas, `and` and `or`. */
function isList(after: string): boolean {
  const items = after.split(/,\s*|\s+(?:and|or)\s+/u).filter((s) => s.trim() !== '');
  return items.length > 1 && items.every((item) => (item.match(/\p{L}[\p{L}'’-]*/gu) ?? []).length <= 3);
}

const colonClause: CheckRule = {
  description:
    'A colon before a lowercase clause joins two facts: write two sentences. A value after a label, `Region: {region}`, and an error with the cause after a colon stay.',
  recommended: 'warn',
  on: { kind: ['description', 'state'] },
  check: ({ message, text }) => {
    if (message.surface === 'error') return [];
    for (const v of text.variants) {
      for (const m of v.matchAll(COLON)) {
        // To the sentence's end: a clause is three words or more, and not a list of short items.
        const after = /^[^.!?…]*/u.exec(v.slice(m.index + m[0].length))![0];
        const words = after.match(/\p{L}[\p{L}'’-]*/gu) ?? [];
        if (words.length < 3 || isList(after)) continue;
        return [
          {
            message:
              'a colon joins two facts here: end the first with a period, and start the second as a new sentence, as "None. Every event starts work."',
            match: ':',
          },
        ];
      }
    }
    return [];
  },
};

/** Verbs that give a thing a voice or legs, and the verbs a product uses in their place. */
const FIGURES: [words: string[], fix: string][] = [
  [
    ['come', 'comes', 'came'],
    'makes a thing move: write the verb the product uses, as "runs" for a schedule or "is received" for an event',
  ],
  [['say', 'says', 'said'], 'gives a thing a voice: write what happens, as "sets", "shows" or "lists"'],
  [['ask for', 'asks for', 'asked for'], 'gives a thing a voice: write "requests" or "requires"'],
];

const figurativeVerbs: CheckRule = {
  description: 'A thing never comes, says or asks for: `Runs every Monday`, not `Comes every Monday`.',
  recommended: 'warn',
  context: true,
  check: ({ text }) =>
    FIGURES.flatMap(([words, fix]) => {
      const word = words.find((w) => text.variants.some((v) => phrase(w).test(v)));
      return word === undefined ? [] : [{ message: `"${word}" ${fix}`, match: word }];
    }),
};

export const VOICE: Plugin = {
  name: 'voice',
  rules: {
    'field-names': {
      type: 'guideline',
      description: 'A label over a value names the field, as a noun: `Reporter`, not `Reported by`. `Members`, not `People in this team`.',
    },
    'own-words': {
      type: 'guideline',
      description:
        'Every noun and verb is the word the product or the platform uses, the word a reader would search the docs for, never a figure of speech. A schedule runs, not comes. The app parses or accepts a value, not reads the value. A setting sets a value, not says the value. A model generates text, not writes text. The reader enters a value, not writes a value. A switch is `Enabled` or `Disabled` (or `On` or `Off`), never a phrase for what the switch does, such as `Starts work`. Nothing wants, knows, says, tells or moves: `Times less than 15 minutes apart`, not `Times come closer together than 15 minutes`.',
    },
    'no-instructions': {
      type: 'guideline',
      description:
        'A control names what the control does, not how to work the control: `Replay`, not `Click this if you want to replay`. Name what the reader gets, not what the code does: `Saved`, not `Your changes were sent to the server`.',
    },
    'placeholder-values': {
      type: 'guideline',
      description:
        "A message reads right with every value a placeholder holds, long or short, plural, ending in s or starting with a vowel: a possessive or an article on a placeholder turns into `Sales's usage` or `a Enterprise plan`.",
    },
    // The habit of a writer who had the component in view: the pronoun's referent is in the code, the
    // entry's context or the prompt, and seldom on screen beside the line.
    'familiar-context': {
      type: 'guideline',
      description:
        'Copy names each thing outright, every time, and never points at a thing with `it`, `its`, `they`, `their`, `them`, `these` or `there`, even one named earlier in the sentence. A reader lands on one line alone, and a translator has to guess what a pronoun stands for. `The workflow’s name, instructions and models`, not `Its name, instructions and models`. `Each session gets a separate folder`, not `Each session gets a folder of its own`. `Sandboxes have no shell or files`, not `The agent has no shell or files there`. A short status or label beside the thing, `Added` or `Disabled`, needs no name.',
    },
    phrases: {
      type: 'guideline',
      description:
        'A phrase where a phrase does: a status, a detail, a toast or a label reads `Saved`, `Not connected` or `3 running`, not `Your changes have been saved.` A phrase leaves out the subject and the helping verb, and may run as long as the phrase needs: `Saved the sandbox to resume later` is one. A sentence, with a subject, is for what takes explaining.',
    },
    pointing,
    'of-its-own': ofItsOwn,
    semicolons,
    'colon-clause': colonClause,
    'figurative-verbs': figurativeVerbs,
  },
};
