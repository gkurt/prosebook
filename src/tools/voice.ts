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

/**
 * What may follow a participle that modifies: a preposition, a particle or a complement, `Opened from the Finder`,
 * `Left empty`, `Turned off`, or an adverb in `-ly`. A noun, an article or a placeholder makes the participle an
 * adjective, `Named values`, or a verb with the verb's object, `Added {name}`, and neither is a modifier.
 */
const MODIFIES = String.raw`(?:from|to|in|into|on|onto|off|by|for|with|without|at|as|through|over|under|after|before|during|via|per|across|inside|outside|alone|empty|blank|unset|once|again|here|up|down|out|back|away|together|\p{L}+ly)(?![\p{L}'’-])`;

const FRONT_WORD = String.raw`[\p{L}\p{N}${HOLE}'’-]+`;

/**
 * A modifier that opens a sentence before a comma: `Enabled,`, `Left empty,`, `Opened from the Finder,`,
 * `Set to Always,`, `Based on your plan,`, `Off,`. Whether the modifier describes the subject after the comma
 * or a thing the sentence leaves out, the sentence reads compressed: the subject, or a whole clause, goes
 * first. `When enabled,` opens with a conjunction, and `On a server,` with a preposition, so neither is found.
 * `-eed` is `need`, `speed`.
 */
const FRONTED = new RegExp(
  String.raw`(?:^|(?<=[.!?…]\s+))((?:\p{L}{2,}(?<!e)ed|left|shown|hidden|written|given|held|kept|chosen|taken|built|run|made|done|seen|known|found|sent|bound|unset|set(?=\s+to\s))(?:\s+${MODIFIES}(?:\s+${FRONT_WORD}){0,4})?|based\s+on(?:\s+${FRONT_WORD}){1,4}|on|off|empty|blank),\s*`,
  'giu',
);

/** Words that start a second clause about the same subject, `Saved, but not published`, not the subject. */
const JOINED = /^(?:but|not|so|and|then|yet|now|ready|since|as|until)(?![\p{L}'’-])/iu;

/** A second participle after the comma: `Accented, padded text` is two adjectives on one noun. */
const STACKED = /^\p{L}{2,}(?<!e)ed(?![\p{L}'’-])/iu;

/** A series: `Generated, formatting, imports and whitespace hunks` opens with the series' first item. */
const SERIES = /^[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+)?\s*,/u;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

const frontedModifier: CheckRule = {
  description:
    'A sentence opens with the subject or a whole clause, never a modifier and a comma: `When worktrees are enabled, a session works in a worktree`, not `Enabled, a session works in a worktree`, and `The app takes the folder it was opened from`, not `Opened from the Finder, the app takes the folder`.',
  recommended: 'warn',
  check: ({ text }) => {
    for (const v of text.variants) {
      for (const m of v.matchAll(FRONTED)) {
        // A clause of three words or more follows, to the sentence's end, past an `or` that runs the modifier on.
        let rest = /^[^.!?…]*/u.exec(v.slice(m.index + m[0].length))![0];
        if (/^or\s/iu.test(rest)) rest = rest.includes(',') ? rest.slice(rest.indexOf(',') + 1).trimStart() : '';
        const words = (rest.match(WORD) ?? []).length;
        if (words < 3 || JOINED.test(rest) || STACKED.test(rest) || SERIES.test(rest) || isList(rest)) continue;
        const opening = m[1]!;
        return [
          {
            message: `"${opening}," opens the sentence with a modifier: start with the subject or a whole clause, as "When worktrees are enabled, a session…" or "A session works in a worktree when…"`,
            match: opening,
          },
        ];
      }
    }
    return [];
  },
};

export const VOICE: Plugin = {
  name: 'voice',
  rules: {
    'field-names': {
      type: 'guideline',
      description:
        'A label over a value names the field, as a noun: `Reporter`, not `Reported by`. `Members`, not `People in this team`. A heading or a grouping, such as `By kind`, is no label over a value.',
    },
    'own-words': {
      type: 'guideline',
      description:
        'Every noun and verb is the word the product or the platform uses, the word a reader would search the docs for, never a figure of speech. A schedule runs, not comes. The app parses or accepts a value, not reads the value. A setting sets a value, not says the value. A model generates text, not writes text. The reader enters a value, not writes a value. Read and write stay where a thing reads or writes in fact, as a tool reads a file: `Couldn’t read the file`, `Tool calls that write`. A switch is `Enabled` or `Disabled` (or `On` or `Off`), never a phrase for what the switch does, such as `Starts work`. Nothing wants, knows, says, tells or moves: `Times less than 15 minutes apart`, not `Times come closer together than 15 minutes`.',
    },
    'no-instructions': {
      type: 'guideline',
      description:
        'A control names what the control does, not how to work the control: `Replay`, not `Click this if you want to replay`. A hint or a tooltip for a gesture no label shows, such as `Drag to reorder`, is the exception. Name what the reader gets, not what the code does: `Saved`, not `Your changes were sent to the server`.',
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
        'A phrase where a phrase does: a status, a detail, a toast or a label reads `Saved`, `Not connected` or `3 running`, not `Your changes have been saved.` A phrase leaves out the subject and the helping verb, and may run as long as the phrase needs: `Sandbox saved to resume later`, `Password set for {email}` and `Signing in with GitHub…` are phrases, and keep to this guideline. Only a full sentence, with a subject and a helping verb, on a surface where a phrase would do, breaks the guideline.',
    },
    pointing,
    'of-its-own': ofItsOwn,
    semicolons,
    'colon-clause': colonClause,
    'figurative-verbs': figurativeVerbs,
    'fronted-modifier': frontedModifier,
  },
};
