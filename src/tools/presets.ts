/**
 * The defaults: four kinds of string, the surfaces they sit on, the word lists of the strict lint preset,
 * the voice guidelines, and the presets a config extends for a tone.
 *
 * The kinds are the four any UI writing guide comes down to. A name identifies, an action says what
 * pressing it does, a description adds what the name cannot carry, a state reports what is true.
 * Each carries a budget and a grammar, which is what makes a mechanical check of the words possible.
 */
import type { Preset, ResolvedConfig, ResolvedTone } from './config.ts';
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
    doc: 'Reports what is true right now. One sentence, present tense; on an error or empty state, one more saying what to do.',
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
        'A phrase where a phrase does: a status, a detail, a toast or a label says `Saved`, `Not connected` or `3 running`, not `Your changes have been saved.` A phrase leaves out the subject and the helping verb, and may run as long as it needs: `Saved the sandbox to resume later` is one. A sentence, with its subject, is for what takes explaining.',
    },
  },
};

/** How a product sounds, said in the writing guide, the translation prompt and the judge's notes. */
export interface Tone {
  /** The tone, what it's for and where it stops. */
  doc: string;
  /** The form of `you` a translation takes where a language has two: Sie, vous, usted, or du, tu, tú. */
  formality: Formality;
  /** The same few moments in every tone, so two tones compare line by line, each with what it avoids. */
  examples: ToneExample[];
}

export type Formality = 'formal' | 'informal';

export interface ToneExample {
  kind: string;
  surface: string;
  /** What the tone writes there. */
  say: string;
  /** What it doesn't, where a writer would reach for it. */
  not?: string;
}

/** A language's two ways of addressing the reader. */
export interface FormsOfYou {
  /** Each form, as a writer is told it. */
  formal: string;
  informal: string;
  /**
   * Words only one form says, for the `formality` rule: lowercase in any case and anywhere,
   * capitalized as written and not a sentence's first word (German's `Sie` is also "they"), Chinese
   * characters within a word. Words both forms say, or another meaning does, are left out.
   */
  words?: Record<Formality, string[]>;
}

/** Languages with one form of `you`, which nothing need be said of. */
const ONE_FORM = new Set(['en', 'sv', 'da', 'nb', 'nn', 'no']);

/** The forms of `you` by language, and by locale where a region's differ. */
export const FORMS: Record<string, FormsOfYou> = {
  de: {
    formal: 'Sie, Ihnen, Ihr',
    informal: 'du, dich, dir, dein',
    words: {
      formal: ['Sie', 'Ihnen', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres'],
      informal: [
        'du',
        'dich',
        'dir',
        'dein',
        'deine',
        'deinen',
        'deinem',
        'deiner',
        'deines',
        'euch',
        'euer',
        'eure',
        'euren',
        'eurem',
        'eurer',
      ],
    },
  },
  fr: {
    formal: 'vous, votre, vos',
    informal: 'tu, te, toi, ta, tes',
    words: { formal: ['vous', 'votre', 'vos'], informal: ['tu', 'te', 'toi', 'ta', 'tes'] },
  },
  es: {
    formal: 'usted, su',
    informal: 'tú, te, tu',
    words: {
      formal: ['usted'],
      informal: ['tú', 'ti', 'te', 'tu', 'tus', 'contigo', 'vosotros', 'vosotras', 'vuestro', 'vuestra', 'vuestros', 'vuestras'],
    },
  },
  it: {
    formal: 'Lei, La, Le, Suo',
    informal: 'tu, ti, te, tuo',
    words: { formal: ['Lei', 'Suo', 'Sua', 'Suoi', 'Sue'], informal: ['tu', 'ti', 'te', 'tuo', 'tua', 'tuoi', 'tue'] },
  },
  nl: {
    formal: 'u, uw',
    informal: 'je, jij, jouw',
    words: { formal: ['u', 'uw'], informal: ['je', 'jij', 'jou', 'jouw'] },
  },
  pt: { formal: 'o senhor, a senhora, or the verb alone', informal: 'tu' },
  'pt-BR': { formal: 'o senhor, a senhora', informal: 'você' },
  pl: {
    formal: 'Pan, Pani, Państwo',
    informal: 'ty, ciebie, twój',
    words: {
      formal: ['Pan', 'Pani', 'Państwo', 'Pana', 'Panu', 'Panią', 'Państwa', 'Państwu'],
      informal: ['ty', 'ciebie', 'tobie', 'twój', 'twoja', 'twoje', 'twojego', 'twojej', 'twoim', 'twoich', 'twoją'],
    },
  },
  cs: {
    formal: 'vy, vás, váš',
    informal: 'ty, tebe, tvůj',
    words: {
      formal: ['vy', 'vás', 'vám', 'váš', 'vaše', 'vaši'],
      informal: ['ty', 'tebe', 'tobě', 'tvůj', 'tvoje', 'tvá', 'tvé', 'tvoji'],
    },
  },
  ru: {
    formal: 'вы, вас, ваш',
    informal: 'ты, тебя, твой',
    words: {
      formal: ['вы', 'вас', 'вам', 'вами', 'ваш', 'ваша', 'ваше', 'ваши', 'вашего', 'вашей', 'вашим', 'ваших'],
      informal: ['ты', 'тебя', 'тебе', 'тобой', 'твой', 'твоя', 'твоё', 'твои', 'твоего', 'твоей', 'твоим', 'твоих'],
    },
  },
  uk: {
    formal: 'ви, вас, ваш',
    informal: 'ти, тебе, твій',
    words: {
      formal: ['ви', 'вас', 'вам', 'вами', 'ваш', 'ваша', 'ваше', 'ваші'],
      informal: ['ти', 'тебе', 'тобі', 'тобою', 'твій', 'твоя', 'твоє', 'твої'],
    },
  },
  tr: {
    formal: 'siz, sizin',
    informal: 'sen, senin',
    words: { formal: ['siz', 'sizi', 'size', 'sizin', 'sizde', 'sizden'], informal: ['sen', 'seni', 'sana', 'senin', 'sende', 'senden'] },
  },
  zh: { formal: '您', informal: '你', words: { formal: ['您'], informal: ['你'] } },
  ja: { formal: 'the polite forms, です and ます', informal: 'the plain forms, だ and る, which few interfaces use' },
  ko: { formal: 'the polite forms, 해요 and 합니다', informal: 'the plain forms, 반말, which few interfaces use' },
};

/** The form of `you` a locale takes: its own, its language's, else every locale's (`*`). */
export function formalityIn(formality: Record<string, Formality>, locale: string): Formality | undefined {
  return byLocale(formality, locale) ?? formality['*'];
}

/**
 * How to address the reader in a locale, as a writer or a model acts on it; nothing for a language
 * with one form of `you`.
 */
export function addressIn(formality: Formality, locale: string): string | undefined {
  if (ONE_FORM.has(locale.split('-')[0]!.toLowerCase())) return undefined;
  const forms = byLocale(FORMS, locale);
  if (forms === undefined) return `Address the reader with the ${formality} form of \`you\`, where the language has two.`;
  const other = formality === 'formal' ? 'informal' : 'formal';
  return `Address the reader ${formality === 'formal' ? 'formally' : 'informally'}: ${forms[formality]}, not ${forms[other]}.`;
}

/** The tone an entry of an area is written in: its area's, else the config's; text in code has no area. */
export function toneIn(config: Pick<ResolvedConfig, 'tone'>, area: string | undefined): ResolvedTone & { notes?: string } {
  const own = area === undefined ? undefined : config.tone.areas[area];
  if (own === undefined) return config.tone;
  return { ...own, ...(config.tone.notes !== undefined && { notes: config.tone.notes }) };
}

/**
 * The tones of the built-in presets. Each example keeps to the kinds' budgets and the voice
 * guidelines, so a tone never asks for what the lint finds: warmth or humor is in the words, not in
 * apologies, exclamations or whole sentences where a phrase does.
 */
const TONES = {
  plain: {
    doc: 'Plain and neutral, for services anyone may have to use: government, health, banking, insurance. Short, common words, one idea a sentence, the main point first. No jokes, no exclamation marks, no idioms a reader of English as a second language would stumble on. Say what happened, then what the reader can do. Address the reader as `you`.',
    formality: 'formal',
    examples: [
      { kind: 'name', surface: 'heading', say: 'Your applications' },
      {
        kind: 'state',
        surface: 'error',
        say: 'Your application was not sent. Check your internet connection, then send it again.',
        not: 'Submission failed due to a network error.',
      },
      { kind: 'state', surface: 'empty', say: 'You have no applications. Start one to apply for a permit.' },
      { kind: 'state', surface: 'toast', say: 'Application sent', not: 'Success! Your application is on its way.' },
      { kind: 'description', surface: 'hint', say: 'Write your name as it is on your passport.', not: 'Must match identity document.' },
      { kind: 'action', surface: 'confirm', say: 'Withdraw application' },
    ],
  },
  professional: {
    doc: 'Calm, exact and brief, for tools people use at work all day. Neutral words, few contractions, no exclamation marks, no humor: the reader is busy, and the copy stays out of the way. An error names the cause and the next step without apologizing. Terms of the trade are fine where the reader uses them; terms of the product are not.',
    formality: 'formal',
    examples: [
      { kind: 'name', surface: 'heading', say: 'Billing contacts' },
      {
        kind: 'state',
        surface: 'error',
        say: 'The report could not be exported: it has more rows than an export holds. Choose a shorter date range.',
        not: "Sorry, we couldn't export your report. Please try again later.",
      },
      { kind: 'state', surface: 'empty', say: 'No invoices match these filters. Clear a filter to see more.' },
      { kind: 'state', surface: 'toast', say: 'Invoice sent' },
      { kind: 'description', surface: 'hint', say: 'Shown on invoices and in emails to customers.' },
      { kind: 'action', surface: 'confirm', say: 'Delete invoices' },
    ],
  },
  friendly: {
    doc: "Warm and direct, for apps people choose to use. Contractions and everyday words; the reader is `you`, and the product is `we` where it does something on the reader's behalf. Warmth comes from being clear and on the reader's side, not from exclamation marks, apologies or emoji. A little personality in empty states and onboarding; errors stay straightforward.",
    formality: 'informal',
    examples: [
      { kind: 'name', surface: 'heading', say: 'Your lists' },
      {
        kind: 'state',
        surface: 'error',
        say: "We couldn't save your list. Check your connection, then try again.",
        not: 'Oops! Something went wrong.',
      },
      {
        kind: 'state',
        surface: 'empty',
        say: "You haven't saved any recipes yet. Tap the heart on a recipe to keep it here.",
        not: 'No saved recipes.',
      },
      { kind: 'state', surface: 'toast', say: 'Recipe saved', not: 'Yay! Your recipe has been saved!' },
      { kind: 'description', surface: 'hint', say: 'Friends see this name when you share a list.' },
      { kind: 'action', surface: 'confirm', say: 'Delete list' },
    ],
  },
  technical: {
    doc: 'Terse and exact, for developers and operators. The precise term over the friendly one, and names, commands, codes and values exactly as the system writes them, so the reader can search for them. Numbers with their units. An error says what failed as the system reported it, then the fix; no reassurance, no humor. The reader knows the domain: explain the product, not the field.',
    formality: 'formal',
    examples: [
      { kind: 'name', surface: 'heading', say: 'Environment variables' },
      {
        kind: 'state',
        surface: 'error',
        say: 'Build failed: npm run build exited with code 1. Open the build log for the error.',
        not: "Something went wrong while building your app. We're looking into it.",
      },
      { kind: 'state', surface: 'empty', say: 'No API keys. Create one to call the API from a server.' },
      { kind: 'state', surface: 'toast', say: 'Key copied' },
      { kind: 'description', surface: 'hint', say: 'A cron expression, run in UTC.', not: 'Choose when you would like this job to run.' },
      { kind: 'action', surface: 'confirm', say: 'Revoke key' },
    ],
  },
  playful: {
    doc: "Light and personable, for products people use for fun: games, hobbies, lifestyle. Humor goes where nothing is at stake: empty states, success, onboarding. Errors, payments, deletion and privacy stay plain, since a joke there reads as not taking the problem seriously. One joke a screen at most, never at the reader's expense, and never one a translation can't carry. Contractions throughout; an exclamation mark only for a real success.",
    formality: 'informal',
    examples: [
      { kind: 'name', surface: 'heading', say: 'Up next' },
      {
        kind: 'state',
        surface: 'error',
        say: "We couldn't load your shelf. Check your connection, then try again.",
        not: 'Uh-oh, the bookworms ate your shelf!',
      },
      { kind: 'state', surface: 'empty', say: 'Nothing on your shelf yet. Add a book to break the silence.' },
      { kind: 'state', surface: 'toast', say: 'Shelved!' },
      { kind: 'description', surface: 'hint', say: 'Other readers see this name next to your reviews.' },
      { kind: 'action', surface: 'confirm', say: 'Delete history', not: 'Yeet it' },
    ],
  },
} satisfies Record<string, Tone>;

// Each English word list reads English text alone, in the source or a translation, as the voice
// guidelines do; the exclamation mark is every language's.
const ENGLISH = { locale: ['en'] };

/** What formal copy writes out, which `plain` and `professional` share. */
const FORMAL: Plugin = {
  name: 'formal',
  rules: {
    expanded: {
      type: 'substitution',
      description: 'A negative is written out: `cannot`, `do not`, `was not`.',
      recommended: 'warn',
      on: ENGLISH,
      message: '"{match}" is written out: "{use}"',
      swap: {
        "can't": 'cannot',
        "couldn't": 'could not',
        "didn't": 'did not',
        "doesn't": 'does not',
        "don't": 'do not',
        "hadn't": 'had not',
        "hasn't": 'has not',
        "haven't": 'have not',
        "isn't": 'is not',
        "aren't": 'are not',
        "mustn't": 'must not',
        "shouldn't": 'should not',
        "wasn't": 'was not',
        "weren't": 'were not',
        "won't": 'will not',
        "wouldn't": 'would not',
      },
    },
    exclamation: {
      type: 'existence',
      description: 'No exclamation marks.',
      recommended: 'warn',
      on: { locale: 'all' },
      patterns: ['[!¡]'],
      message: 'no exclamation mark: a period, or nothing, says it as plainly',
    },
  },
};

/**
 * The presets a config extends by name. Each sets a tone and the rules that go with it, over
 * `lint.extends` and under the config's own `lint.rules`.
 */
export const PRESETS: Record<string, Preset> = {
  formal: {
    name: 'formal',
    tone: { formality: 'formal' },
    lint: { rules: { contractions: 'off' }, plugins: [FORMAL] },
  },
  plain: {
    name: 'plain',
    extends: ['formal'],
    tone: TONES.plain,
    lint: {
      plugins: [
        {
          name: 'plain',
          rules: {
            words: {
              type: 'substitution',
              description: 'The common word over the official one: `start`, not `commence`.',
              recommended: 'warn',
              on: ENGLISH,
              swap: {
                'a number of': 'some',
                additional: 'more',
                approximately: 'about',
                ascertain: 'find out',
                assist: 'help',
                assistance: 'help',
                commence: 'start',
                demonstrate: 'show',
                endeavour: 'try',
                endeavor: 'try',
                facilitate: 'help',
                'in order to': 'to',
                'in the event that': 'if',
                numerous: 'many',
                obtain: 'get',
                'prior to': 'before',
                regarding: 'about',
                'subsequent to': 'after',
                sufficient: 'enough',
                terminate: 'end',
                utilise: 'use',
                utilize: 'use',
                'with regard to': 'about',
              },
            },
            idioms: {
              type: 'guideline',
              description:
                'No idioms or figures of speech, which a reader of the language as a second one takes word by word: `Start again`, not `Back to square one`.',
            },
          },
        },
      ],
    },
  },
  professional: { name: 'professional', extends: ['formal'], tone: TONES.professional },
  friendly: { name: 'friendly', tone: TONES.friendly, lint: { rules: { contractions: 'warn' } } },
  technical: { name: 'technical', tone: TONES.technical },
  playful: {
    name: 'playful',
    tone: TONES.playful,
    lint: {
      rules: { contractions: 'warn' },
      plugins: [
        {
          name: 'playful',
          rules: {
            'serious-moments': {
              type: 'guideline',
              description:
                'An error or a confirmation stays plain: no joke, wordplay or exclamation mark where something failed or is about to be lost.',
              on: { surface: ['error', 'confirm'] },
            },
          },
        },
      ],
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
