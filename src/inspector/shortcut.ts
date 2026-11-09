/**
 * The inspector's gesture: the keys held to show each string's key, and the button that, with them
 * held, opens its entry. The integrations take it as `inspect` and check it as they write the code
 * that starts the inspector (`installInspector`), so a wrong one fails the dev server, not the page.
 */

/** A modifier key, as `KeyboardEvent.key` names it. */
export type Modifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface Shortcut {
  /** Held, and no other, to show each string's key. `['Alt']` unset. */
  modifiers?: Modifier[];
  /** Pressed with them to open the entry. `'left'` unset. */
  button?: 'left' | 'middle' | 'right';
}

const FLAGS = { Alt: 'altKey', Control: 'ctrlKey', Meta: 'metaKey', Shift: 'shiftKey' } as const;
const BUTTONS = { left: 0, middle: 1, right: 2 } as const;

/** The shortcut with its defaults, or an error saying what to write instead. */
export function checkShortcut(shortcut: Shortcut = {}): Required<Shortcut> {
  const { modifiers = ['Alt'], button = 'left' } = shortcut;
  const named = Object.keys(FLAGS).join("', '");
  if (!Array.isArray(modifiers) || modifiers.length === 0)
    throw new Error(`prosebook: inspect.modifiers is empty: hold at least one of '${named}', or every click would open the inspector`);
  for (const m of modifiers)
    if (!Object.hasOwn(FLAGS, m)) throw new Error(`prosebook: inspect.modifiers has '${m}': name one of '${named}'`);
  if (!Object.hasOwn(BUTTONS, button))
    throw new Error(`prosebook: inspect.button is '${button}': name one of '${Object.keys(BUTTONS).join("', '")}'`);
  return { modifiers: [...new Set(modifiers)], button };
}

export interface Gesture {
  /** Whether exactly the shortcut's modifiers are down: AltGr, which is Control and Alt, isn't Alt. */
  held: (e: MouseEvent | KeyboardEvent) => boolean;
  /** Whether a key going down is one of them. */
  isModifier: (key: string) => boolean;
  /** The shortcut's button, as `MouseEvent.button` numbers it. */
  button: number;
}

export function gestureOf(shortcut: Required<Shortcut>): Gesture {
  const on = new Set<string>(shortcut.modifiers);
  const flags = Object.entries(FLAGS);
  return {
    held: (e) => flags.every(([key, flag]) => e[flag] === on.has(key)),
    isModifier: (key) => on.has(key),
    button: BUTTONS[shortcut.button],
  };
}
