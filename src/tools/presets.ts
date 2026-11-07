/**
 * The defaults: four kinds of string, the surfaces they sit on, the word lists of the strict lint preset,
 * and the voice guidelines.
 *
 * The kinds are the four any UI writing guide comes down to. A name identifies, an action says what
 * pressing it does, a description adds what the name cannot carry, a state reports what is true.
 * Each carries a budget and a grammar, which is what makes a mechanical check of the words possible.
 */
import type { Plugin } from './lint.ts';

export type Severity = 'error' | 'warn' | 'off';

export interface KindRule {
  /** What the kind is for, shown when an editor completes it. */
  doc: string;
  /** The most words it may have. Articles, short prepositions and asides in parentheses are free. */
  maxWords?: number;
  /** The most sentences it may have, and per surface where that differs. */
  maxSentences?: number;
  maxSentencesOn?: Record<string, number>;
  /** Whether it ends with a period: always, never, or only on the surfaces listed. */
  period?: 'always' | 'never' | string[];
  /** Capitalizes only its first word and proper nouns. */
  sentenceCase?: boolean;
  /** Carries no explanation after a dash or colon: `Quick capture`, not `Quick capture: choose an area`. */
  bare?: boolean;
}

export const DEFAULT_KINDS: Record<string, KindRule> = {
  name: {
    doc: 'Identifies a thing so it can be found again. One to four words, a noun phrase, no period.',
    maxWords: 4,
    period: 'never',
    sentenceCase: true,
    bare: true,
  },
  action: {
    doc: 'Says what pressing it does. One to three words, verb first, no period.',
    maxWords: 3,
    period: 'never',
    sentenceCase: true,
  },
  description: {
    doc: 'Adds only what the name cannot carry. One sentence, two at most, with a period.',
    maxSentences: 2,
    period: 'always',
  },
  state: {
    doc: 'Reports what is true right now, in the present tense: a phrase where one does, or one sentence; on an error or empty state, one more saying what to do.',
    maxSentences: 1,
    maxSentencesOn: { error: 2, empty: 2, hint: 2, status: 2 },
    period: ['hint', 'status', 'error', 'empty', 'confirm'],
  },
};

export const DEFAULT_SURFACES: Record<string, string> = {
  action: 'The text of a button or a menu entry.',
  aria: 'Reached only by a screen reader, so nothing on screen carries it.',
  choice: 'One option among a set offered together.',
  confirm: 'The question of a confirmation, or the verb that answers it.',
  detail:
    "A phrase beside or under the thing it qualifies: a row's detail line, a reading, a count. Not a sentence, so a state here ends without a period.",
  empty: 'Fills a list or a panel that has nothing in it.',
  error: 'Says what failed.',
  heading: 'Heads a section, group, dialog or list.',
  hint: 'A subordinate line under the thing it qualifies.',
  label: 'Names a control, a field, a section or a destination.',
  placeholder: 'Sits inside an empty field, and goes when typing starts.',
  status: 'Reports what is true right now, on a badge or beside a row.',
  title: 'The title of a page, window or document.',
  toast: 'A notification that comes and goes.',
  tooltip: 'Appears on hover.',
};

/** The word lists of the strict preset: filler, marketing and reassurance, and American spelling. */
export const STRICT_LISTS = {
  banned: [
    {
      words: ['seamless', 'seamlessly', 'effortless', 'effortlessly', 'hassle-free', 'frictionless'],
      why: 'promises a feeling rather than saying what happens',
    },
    {
      words: ['leverage', 'leverages', 'leveraging', 'utilize', 'utilizes', 'utilizing', 'harness', 'take advantage of'],
      why: 'is a long way to say use',
    },
    {
      words: [
        'delve',
        'dive into',
        'deep dive',
        'embark',
        'journey',
        'tapestry',
        'realm',
        'landscape',
        'testament',
        'synergy',
        'paradigm',
        'holistic',
      ],
      why: 'is filler, not a thing on the screen',
    },
    {
      words: [
        'robust',
        'powerful',
        'cutting-edge',
        'state-of-the-art',
        'best-in-class',
        'world-class',
        'next-generation',
        'revolutionary',
        'game-changing',
      ],
      why: 'is marketing: say what it does',
    },
    {
      words: ['streamline', 'streamlined', 'empower', 'unlock', 'unleash', 'elevate', 'supercharge', 'boost', 'enhance', 'enhanced'],
      why: 'claims an improvement without naming it',
    },
    { words: ['meticulous', 'crucial', 'pivotal', 'vital', 'paramount'], why: 'tells the reader how to feel instead of what it is' },
    {
      words: ['comprehensive', 'myriad', 'plethora', 'a variety of', 'a wide range of'],
      why: 'is padding: name the things, or say how many',
    },
    {
      words: ['furthermore', 'moreover', 'additionally', 'in order to', 'please note', 'note that', 'keep in mind', 'rest assured'],
      why: 'is a connective a short string has no room for',
    },
    { words: ['intuitive', 'sleek', 'stunning', 'beautiful', 'delightful', 'magical'], why: 'grades the product instead of describing it' },
    { words: ['simply', 'just', 'easily', 'easy', 'quickly'], why: 'says it is easy, which helps nobody it is not easy for' },
    { words: ['so you can', 'allows you to', 'lets you', 'enables you to', "don't worry"], why: 'justifies or reassures: state the fact' },
    { words: ['please', 'oops', 'whoops', 'sorry'], why: 'pleads or apologizes: say what failed and what to do' },
    { words: ['etc', 'and more', 'and so on'], why: 'trails off: name the things or stop' },
  ],
  spelling: {
    colour: 'color',
    colours: 'colors',
    behaviour: 'behavior',
    favourite: 'favorite',
    cancelled: 'canceled',
    cancelling: 'canceling',
    labelled: 'labeled',
    centre: 'center',
    licence: 'license',
    grey: 'gray',
    organise: 'organize',
    recognise: 'recognize',
    customise: 'customize',
    optimise: 'optimize',
    minimise: 'minimize',
    maximise: 'maximize',
    synchronise: 'synchronize',
    authorise: 'authorize',
    initialise: 'initialize',
    analyse: 'analyze',
    catalogue: 'catalog',
    dialogue: 'dialog',
    artefact: 'artifact',
    judgement: 'judgment',
    whilst: 'while',
    amongst: 'among',
  } as Record<string, string>,
};

/**
 * The habits of copy written off the code, as a model or a developer tends to write it, said in the
 * writing guide so the writer meets them first. Guidelines, not checks: each is a matter of meaning,
 * which a word list would flag in sound copy as often as it caught. Written for English, so on only
 * where the source is; `'voice/*': 'off'` turns them all off.
 */
export const VOICE: Plugin = {
  name: 'voice',
  rules: {
    'field-names': {
      type: 'guideline',
      description: 'A label over a value names the field, as a noun: `Reporter`, not `Reported by`; `Members`, not `People in this team`.',
    },
    'own-words': {
      type: 'guideline',
      description:
        'Use the word the app, or the platform it runs on, has for a thing, not an everyday paraphrase: `Get notified`, not `Hear of your notifications`.',
    },
    'no-intent': {
      type: 'guideline',
      description:
        "A thing doesn't want, know, decide, say, tell or take in: say what happens. `Runs on new issues`, not `The workflow takes in new issues`; `Alerts above 90%`, not `The metric tells it to alert above 90%`.",
    },
    'no-instructions': {
      type: 'guideline',
      description:
        'A control names what it does, not how to work it: `Replay`, not `Click this if you want to replay`. Say what the reader gets, not what the code does: `Saved`, not `Your changes were sent to the server`.',
    },
    'placeholder-values': {
      type: 'guideline',
      description:
        "A message reads right with every value its placeholders hold, long or short, plural, ending in s or starting with a vowel: a possessive or an article on one comes to `Sales's usage` or `a Enterprise plan`.",
    },
    // The habit of a writer who had the component in view: the pronoun's referent is in the code, the
    // entry's context or the prompt, never on screen.
    'familiar-context': {
      type: 'guideline',
      description:
        "A sentence doesn't lean on what only its writer had in view: `It`, `its`, `they`, `these` or `the questions`, standing for nothing named before them, point at what the reader can't see. `The workflow's name, instructions and models`, not `Its name, instructions and models`. A short status or label, `Added` or `Turned off`, sits beside what it's about and names nothing.",
    },
    phrases: {
      type: 'guideline',
      description:
        'A phrase where a phrase does: a status, a detail, a toast or a label says `Saved`, `Not connected` or `3 running`, not `Your changes have been saved.` A sentence is for what takes explaining.',
    },
  },
};

/**
 * Quotation marks by language, and by locale where a region writes them otherwise, as CLDR has them:
 * what the `quotes` rule holds a translation to. French sets a narrow no-break space inside.
 */
export const DEFAULT_QUOTES: Record<string, readonly [open: string, close: string]> = {
  cs: ['„', '“'],
  da: ['“', '”'],
  de: ['„', '“'],
  'de-CH': ['«', '»'],
  'de-LI': ['«', '»'],
  es: ['«', '»'],
  fi: ['”', '”'],
  fr: ['«\u202F', '\u202F»'],
  it: ['«', '»'],
  ja: ['「', '」'],
  ko: ['“', '”'],
  nb: ['«', '»'],
  no: ['«', '»'],
  pl: ['„', '”'],
  pt: ['“', '”'],
  'pt-PT': ['«', '»'],
  ru: ['«', '»'],
  sk: ['„', '“'],
  sv: ['”', '”'],
  tr: ['“', '”'],
  uk: ['«', '»'],
  zh: ['“', '”'],
  'zh-Hant': ['「', '」'],
  'zh-HK': ['「', '」'],
  'zh-TW': ['「', '」'],
};

/** The marks the `quotes` rule finds, as pairs: straight, English, German and Polish lower-upper, guillemets and corner brackets. */
export const QUOTED = /"([^"\n]+)"|“([^“”\n]+)”|„([^„“”\n]+)[“”]|«\s?([^«»\n]+?)\s?»|「([^「」\n]+)」|”([^“”\n]+)”/gu;

/** The punctuation written after Chinese and Japanese text in its full-width form, by language. */
export const FULL_WIDTH: Record<string, Record<string, string>> = {
  zh: { ',': '，', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；' },
  ja: { ',': '、', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；' },
};

/** A locale's own entry in a table by locale or language: `de-CH`'s, else `de`'s. */
export function byLocale<T>(table: Record<string, T>, locale: string): T | undefined {
  const lower = locale.toLowerCase();
  const own = Object.keys(table).find((l) => l.toLowerCase() === lower);
  if (own !== undefined) return table[own];
  const tags = lower.split('-');
  for (let n = tags.length - 1; n > 0; n--) {
    const parent = Object.keys(table).find((l) => l.toLowerCase() === tags.slice(0, n).join('-'));
    if (parent !== undefined) return table[parent];
  }
  return undefined;
}
