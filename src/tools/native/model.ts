/**
 * The catalog as a native target writes it, before any language: per message, its arguments and one
 * tree per locale it renders in, with every fallback resolved here, so the generated code has no
 * lookup to do. Number formats and plural rules are read from `Intl` and CLDR once, and numbered.
 */
import { isDateElement, isNumberElement, isTimeElement } from '@formatjs/icu-messageformat-parser';

import { chainOf } from '#src/runtime/locale.ts';
import type { Catalog, Message, Problem } from '#src/tools/catalog.ts';
import type { Entry } from '#src/tools/compile.ts';
import type { NativeTarget } from '#src/tools/config.ts';
import { numberOptions, optionArgsOf, placeholderOf, selectionOf, TYPE, type MessageFormatElement } from '#src/tools/icu.ts';
import { docText } from './emit.ts';
import { numberSpec, roundingOf, type NumberSpec, type Rounding } from './number.ts';
import { pluralRules, type PluralRules } from './plurals.ts';

export type Part =
  | { type: 'text'; value: string }
  | { type: 'string'; arg: string }
  /** The argument less `offset`, in format `format`; `fallback` where it isn't a number. */
  | { type: 'number'; arg: string; offset: number; format: number; fallback: string }
  | { type: 'select'; arg: string; arms: Arm[]; other: Part[] }
  | {
      type: 'plural';
      arg: string;
      /** What it selects on: the value, rounded as `Math.round` does (MF2's `:integer`), or as a percent. */
      on: 'value' | 'round' | 'percent';
      offset: number;
      /** `=N` arms, matched on the value before its offset. */
      exact: { value: number; parts: Part[] }[];
      rules: number;
      rounding: Rounding;
      arms: Arm[];
      other: Part[];
    };

export interface Arm {
  key: string;
  parts: Part[];
}

export interface NativeMessage {
  key: string;
  /** The key less the prefix that took it in, as words: `tray.quit-app` is tray, quit, app. */
  words: string[];
  /** The source text, its context, and what's asked of it. */
  doc: string[];
  args: { name: string; type: 'string' | 'number'; doc?: string }[];
  /** A tree per locale that renders it its own way; every locale is in one. */
  bodies: { locales: string[]; parts: Part[] }[];
}

export interface NativeModel {
  /** Every locale, the source first. */
  locales: string[];
  source: string;
  messages: NativeMessage[];
  formats: NumberSpec[];
  rules: { name: string; rules: PluralRules }[];
}

/**
 * The words a target names `key` by, less the prefix that took it in (longest first): `tray.quit-app`
 * is quit, app under `['tray']`. Nothing when the target doesn't take the key.
 */
export function wordsFor(target: NativeTarget, key: string): string[] | undefined {
  const prefix = target.keys === undefined ? '' : [...target.keys].sort((a, b) => b.length - a.length).find((p) => key.startsWith(`${p}.`));
  if (prefix === undefined) return undefined;
  return key
    .slice(prefix === '' ? 0 : prefix.length + 1)
    .split(/[.\-_]/)
    .filter(Boolean);
}

/** The locale whose text `locale` shows for `key`: its own, else the first down its fallback chain that has it. */
export function foundIn(key: string, locale: string, locales: string[], asts: Map<string, Map<string, MessageFormatElement[]>>) {
  return chainOf(locale, locales, locales[0]!).find((l) => asts.get(l)?.has(key));
}

/** Values a file declares once each, numbered by what they hold, so locales that format alike share one. */
class Numbered<T> {
  readonly list: T[] = [];
  private readonly byJson = new Map<string, number>();

  add(value: T, json = JSON.stringify(value)): number {
    let at = this.byJson.get(json);
    if (at === undefined) {
      this.byJson.set(json, (at = this.list.length));
      this.list.push(value);
    }
    return at;
  }
}

/** The model of what `target` takes from the catalog, with a problem for every message it can't render. */
export function nativeModel(
  target: NativeTarget,
  catalog: Catalog,
  locales: string[],
  entries: Map<string, Entry[]>,
): { model: NativeModel; problems: Problem[] } {
  const source = locales[0]!;
  const asts = new Map([...entries].map(([locale, list]) => [locale, new Map(list)]));
  const formats = new Numbered<NumberSpec>();
  const rules = new Numbered<{ name: string; rules: PluralRules }>();
  const problems: Problem[] = [];
  const messages: NativeMessage[] = [];

  for (const m of catalog.messages) {
    const words = wordsFor(target, m.key);
    if (words === undefined) continue;
    const bodies = new Map<string, { locales: string[]; parts: Part[] }>();
    let failed = false;
    for (const locale of locales) {
      const found = foundIn(m.key, locale, locales, asts);
      if (found === undefined) continue;
      const body = bodies.get(found);
      if (body !== undefined) {
        body.locales.push(locale);
        continue;
      }
      try {
        bodies.set(found, { locales: [locale], parts: parts(asts.get(found)!.get(m.key)!, found, formats, rules, null) });
      } catch (e) {
        failed = true;
        problems.push({
          severity: 'error',
          file: fileOf(m, found, source),
          key: m.key,
          message: `${target.language}: ${(e as Error).message}`,
        });
      }
    }
    if (failed) continue;
    messages.push({
      key: m.key,
      words,
      doc: docOf(m),
      args: [...m.args].map(([name, type]) => ({
        name,
        type: type === 'number' ? 'number' : 'string',
        doc: m.argDocs.has(name) ? docText(m.argDocs.get(name)!) : undefined,
      })),
      bodies: [...bodies.values()],
    });
  }
  return { model: { locales, source, messages, formats: formats.list, rules: rules.list }, problems };
}

export function fileOf(m: Message, locale: string, source: string): string {
  return locale === source ? m.file : (m.translations.get(locale)?.file ?? m.file);
}

function docOf(m: Message): string[] {
  const lines = (m.text.length > 400 ? `${m.text.slice(0, 397)}...` : m.text).split('\n');
  if (m.context) lines.push('', m.context);
  if (m.remove) lines.push('', 'Marked for removal in the catalog.');
  if (m.comment) lines.push('', `Comment: ${m.comment}`);
  return lines.map(docText);
}

export const LEAVE_OUT = "or leave the key out of this target's `keys`";

/** Specs by locale and options, kept across runs: taking a format apart checks it against `Intl` dozens of times. */
const SPECS = new Map<string, NumberSpec | Error>();

function format(formats: Numbered<NumberSpec>, locale: string, options: Intl.NumberFormatOptions | undefined): number {
  const key = JSON.stringify([locale, options ?? {}]);
  let spec = SPECS.get(key);
  if (spec === undefined) {
    try {
      spec = numberSpec(locale, options);
    } catch (e) {
      spec = new Error(`native code can't format this number in ${locale}: ${(e as Error).message}. Format it another way, ${LEAVE_OUT}`, {
        cause: e,
      });
    }
    SPECS.set(key, spec);
  }
  if (spec instanceof Error) throw spec;
  return formats.add(spec);
}

type Pound = { arg: string; offset: number } | null;

function parts(
  elements: MessageFormatElement[],
  locale: string,
  formats: Numbered<NumberSpec>,
  rules: Numbered<{ name: string; rules: PluralRules }>,
  pound: Pound,
): Part[] {
  const out: Part[] = [];
  const text = (value: string) => {
    const last = out.at(-1);
    if (last?.type === 'text') last.value += value;
    else if (value !== '') out.push({ type: 'text', value });
  };
  const placed = (el: MessageFormatElement, name: string, part: Part) => {
    const { isolate } = placeholderOf(el, name);
    if (isolate !== undefined) text(isolate[0]);
    out.push(part);
    if (isolate !== undefined) text(isolate[1]);
  };
  const arms = (options: Record<string, { value: MessageFormatElement[] }>, own: Pound) =>
    Object.entries(options).map(([key, option]) => ({ key, parts: parts(option.value, locale, formats, rules, own) }));

  for (const el of elements) {
    if (Object.keys(optionArgsOf(el) ?? {}).length > 0) {
      throw new Error(
        `{${'value' in el ? el.value : ''}} takes a formatting option from an argument: native code formats with options the message fixes, ${LEAVE_OUT}`,
      );
    }
    if (isDateElement(el) || isTimeElement(el)) {
      throw new Error(
        `{${el.value}} is a date, which native code doesn't format: pass it formatted, as a plain {${el.value}}, ${LEAVE_OUT}`,
      );
    }
    if (isNumberElement(el)) {
      const fallback = placeholderOf(el, el.value).fallback;
      placed(el, el.value, { type: 'number', arg: el.value, offset: 0, format: format(formats, locale, numberOptions(el)), fallback });
      continue;
    }
    switch (el.type) {
      case TYPE.literal:
        text(el.value);
        break;
      case TYPE.argument:
        placed(el, el.value, { type: 'string', arg: el.value });
        break;
      case TYPE.pound:
        if (pound === null) {
          text('#');
          break;
        }
        placed(el, pound.arg, {
          type: 'number',
          arg: pound.arg,
          offset: pound.offset,
          format: format(formats, locale, undefined),
          fallback: placeholderOf(el, pound.arg).fallback,
        });
        break;
      case TYPE.select: {
        const all = arms(el.options, pound);
        out.push({
          type: 'select',
          arg: el.value,
          arms: all.filter((a) => a.key !== 'other'),
          other: all.find((a) => a.key === 'other')!.parts,
        });
        break;
      }
      case TYPE.plural: {
        const selection = selectionOf(el);
        const type = el.pluralType === 'ordinal' ? 'ordinal' : 'cardinal';
        const all = arms(el.options, { arg: el.value, offset: el.offset });
        let rounding: Rounding;
        try {
          rounding = roundingOf(locale, { ...selection?.options, type });
        } catch (e) {
          throw new Error(`{${el.value}} can't select in native code: ${(e as Error).message}, ${LEAVE_OUT}`, { cause: e });
        }
        const found = pluralRules(locale, type);
        out.push({
          type: 'plural',
          arg: el.value,
          on: selection?.value ?? 'value',
          offset: el.offset,
          // Matched as the runtime does, by the value's own `String()`, so `=1.50` never matches.
          exact: all
            .filter((a) => a.key.startsWith('=') && String(Number(a.key.slice(1))) === a.key.slice(1))
            .map((a) => ({ value: Number(a.key.slice(1)), parts: a.parts })),
          rules: rules.add({ name: `${type}, as ${locale} has them`, rules: found }, JSON.stringify(found)),
          rounding,
          arms: all.filter((a) => !a.key.startsWith('=') && a.key !== 'other'),
          other: all.find((a) => a.key === 'other')!.parts,
        });
        break;
      }
      case TYPE.tag:
        throw new Error(`<${el.value}> is a tag, and native code writes plain text: say it without the tag, ${LEAVE_OUT}`);
      default:
        throw new Error(`prosebook: no native writer for ICU element type ${(el as MessageFormatElement).type}`);
    }
  }
  return out;
}
