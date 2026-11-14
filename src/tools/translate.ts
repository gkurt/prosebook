/**
 * `prosebook translate`: a locale's missing and stale entries, translated by the config's
 * `translate.model`. The model is told what `todo --prompt` says and its reply is read as `import`
 * reads one, so a translation is checked the same whoever wrote it: one that drops a placeholder or
 * breaks the catalog is left out, said back to the model once more, and failing that left for a person.
 */
import type { Problem } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { importTranslations } from './entry.ts';
import { generate, render } from './generate.ts';
import type { StaleTranslation } from './lock.ts';
import { todoMessages, todoOf } from './todo.ts';

export interface TranslateRequest {
  /** What `prosebook todo <locale> --prompt` writes for the entries asked: how to reply, then the entries. */
  prompt: string;
  /** The locale translated into. */
  locale: string;
  signal?: AbortSignal;
}

export interface TranslateResponse {
  /** The model's reply: a YAML block of each key and its translation, as `prosebook import` reads. */
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** What the request cost, in US dollars, where the provider says or the translator knows its prices. */
  cost?: number;
}

/** A model that translates, as the config's `translate.model` takes one. */
export interface Translator {
  id: string;
  translate(request: TranslateRequest): Promise<TranslateResponse>;
}

export interface TranslateConfig {
  /** `languageTranslator(model)` from `prosebook/ai`, or a `Translator` of your own. */
  model: Translator;
  /** How many entries one request holds: 40 by default. Fewer keeps each reply short enough to come back whole. */
  batch?: number;
  /** How many times a batch is asked, the second time with what the first reply got wrong: 2 by default. */
  attempts?: number;
}

export type ResolvedTranslate = Required<TranslateConfig>;

export interface Translated {
  /** Keys whose translation was written. */
  written: string[];
  /** Stale keys the model gave back unchanged, accepted as still right. */
  accepted: string[];
  /** Keys still wanting a translation: left empty, or left out for the problems below. */
  left: string[];
  /** What the last reply to each batch got wrong. */
  problems: Problem[];
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** In US dollars, over the requests whose cost is known. */
  cost: number;
  /** Requests whose cost isn't known. */
  unpriced: number;
}

export interface TranslateOptions {
  signal?: AbortSignal;
  /** After each batch: how many entries are settled, written or given up on, of how many wanted. */
  progress?: (done: number, total: number) => void;
}

/** `locale`'s missing and stale entries, asked of the model a batch at a time and written as each reply is read. */
export async function translateLocale(
  config: ResolvedConfig,
  translate: ResolvedTranslate,
  locale: string,
  options: TranslateOptions = {},
): Promise<Translated> {
  const done: Translated = {
    written: [],
    accepted: [],
    left: [],
    problems: [],
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    unpriced: 0,
  };
  const read = () => {
    const { catalog, stale } = render(config, undefined, { partial: true });
    return { catalog, stale: stale.get(locale) ?? new Map<string, StaleTranslation>() };
  };
  const first = read();
  const wanted = todoMessages(first.catalog, first.stale, locale).map((m) => m.key);

  for (let at = 0; at < wanted.length; at += translate.batch) {
    let keys = wanted.slice(at, at + translate.batch);
    let said: Problem[] = [];
    for (let attempt = 0; attempt < translate.attempts && keys.length > 0; attempt++) {
      // Read again: the batch before wrote translations, and an accepted one is no longer stale.
      const { catalog, stale } = read();
      const todo = todoOf(config, catalog, stale, locale, true, new Set(keys));
      const response = await translate.model.translate({
        prompt: said.length === 0 ? todo.text : `${todo.text}\n\n${retryNote(said)}`,
        locale,
        ...(options.signal !== undefined && { signal: options.signal }),
      });
      done.requests++;
      done.inputTokens += response.usage?.inputTokens ?? 0;
      done.outputTokens += response.usage?.outputTokens ?? 0;
      if (response.cost === undefined) done.unpriced++;
      else done.cost += response.cost;

      const imported = importTranslations(config, locale, response.text);
      // A stale translation given back unchanged was looked at and still holds, as `import` takes it.
      const kept = imported.unchanged.filter((key) => stale.has(key));
      if (imported.written.length + kept.length > 0) generate(config, { accept: new Map([[locale, new Set(kept)]]), partial: true });
      done.written.push(...imported.written);
      done.accepted.push(...kept);
      const landed = new Set([...imported.written, ...imported.unchanged]);
      keys = keys.filter((key) => !landed.has(key));
      said = imported.problems;
    }
    done.left.push(...keys);
    done.problems.push(...said);
    options.progress?.(Math.min(at + translate.batch, wanted.length), wanted.length);
  }
  return done;
}

/** What an earlier reply got wrong, for the model to give those entries again. */
function retryNote(problems: readonly Problem[]): string {
  const lines = problems.map((p) => `- ${p.key === undefined ? '' : `${p.key}: `}${p.message}`);
  return [
    'An earlier reply to these entries was left out, for these problems. Give every entry above again, with each fixed:',
    ...lines,
  ].join('\n');
}
