/**
 * The built-in tones, as the writing guide says each: read out of the guide `generate` writes for a project
 * extending the preset, as the page is built, so the page shows what an agent would read.
 */
import { play } from 'prosebook/playground';

/** The presets with a tone of their own, as `extends` names them. */
const NAMES = ['plain', 'professional', 'friendly', 'technical', 'playful'] as const;
/** The moments shown, of the six every tone has an example of. */
const SHOWN = ['error', 'empty', 'toast'];

const FILES = { 'copy/catalog/app.yaml': 'app.title:\n  kind: name\n  surface: title\n  context: The title of the app.\n  en: App\n' };

export interface Tone {
  name: (typeof NAMES)[number];
  /** The tone's first sentence: its voice, and who it is for. */
  voice: string;
  examples: { kind: string; surface: string; say: string; not?: string }[];
}

function toneOf(name: Tone['name']): Tone {
  const guide = play(FILES, { extends: name }).generated['copy/catalog/WRITING.md'] ?? '';
  const section = guide.slice(guide.indexOf('## Tone')).split('\n## ')[0]!;
  const doc = section.split('\n\n')[1] ?? '';
  const examples = [...section.matchAll(/^- `(\w+)` on `(\w+)`: "(.*?)"(?:, not "(.*)")?$/gm)].map(([, kind, surface, say, not]) => ({
    kind: kind!,
    surface: surface!,
    say: say!,
    ...(not !== undefined && { not }),
  }));
  // A guide written another way would leave the page's section empty: fail the build instead.
  if (doc === '' || examples.length === 0) throw new Error(`the writing guide says no tone for "${name}": has its Tone section changed?`);
  return { name, voice: `${doc.split('. ')[0]}.`, examples: examples.filter((e) => SHOWN.includes(e.surface)) };
}

export const TONES = NAMES.map(toneOf);
export const START_TONE: Tone['name'] = 'friendly';
