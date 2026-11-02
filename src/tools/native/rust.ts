/**
 * The model as a Rust module: an enum of locales with a method per message, and what formats them in
 * a private `rt` module, so no argument a message names can shadow it.
 */
import type { NativeTarget } from '#src/tools/config.ts';
import { checkNames, conditionCode, float, leading, pascal, snake, stringLiteral, wordsOf } from './emit.ts';
import type { NativeMessage, NativeModel, Part } from './model.ts';
import type { NumberSpec } from './number.ts';

const KEYWORDS = new Set(
  'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv try typeof unsized virtual yield gen'.split(
    ' ',
  ),
);

const ident = (name: string) => (KEYWORDS.has(name) ? `${name}_` : name);
const lit = (value: string) => stringLiteral(value, 'rust');
const variant = (tag: string) => pascal(wordsOf(tag));
const argName = (name: string) => ident(leading(snake(wordsOf(name))));

function doc(lines: string[], indent: string): string {
  return lines.map((l) => (l === '' ? `${indent}///\n` : `${indent}/// ${l}\n`)).join('');
}

/** The parts as an expression of type `String`. */
function expr(parts: Part[], indent: string): string {
  if (parts.length === 0) return 'String::new()';
  const [only] = parts;
  if (parts.length === 1 && only !== undefined) {
    if (only.type === 'text') return `String::from(${lit(only.value)})`;
    return only.type === 'string' ? `${argName(only.arg)}.to_string()` : value(only, indent);
  }
  let format = '';
  const args: string[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      format += part.value.replaceAll('{', '{{').replaceAll('}', '}}');
      continue;
    }
    format += '{}';
    args.push(value(part, indent));
  }
  return `format!(${[lit(format), ...args].join(', ')})`;
}

function value(part: Exclude<Part, { type: 'text' }>, indent: string): string {
  const inner = `${indent}    `;
  if (part.type === 'string') return argName(part.arg);
  if (part.type === 'number') {
    const of = part.offset === 0 ? argName(part.arg) : `${argName(part.arg)} - ${float(part.offset)}`;
    return `rt::number(${of}, &rt::F${part.format}, ${lit(part.fallback)})`;
  }
  if (part.type === 'select') {
    const arms = part.arms.map((a) => `${inner}${lit(a.key)} => ${expr(a.parts, inner)},\n`).join('');
    return `match ${argName(part.arg)} {\n${arms}${inner}_ => ${expr(part.other, inner)},\n${indent}}`;
  }
  // A plural, the one kind left. With only `other`, there is nothing to select on.
  if (part.arms.length + part.exact.length === 0) return expr(part.other, indent);
  const arg = argName(part.arg);
  const on = part.on === 'round' ? `rt::round(${arg})` : part.on === 'percent' ? `${arg} * 100.0` : arg;
  const of = part.offset === 0 ? 'n' : `n - ${float(part.offset)}`;
  const { minFrac, maxFrac } = part.rounding;
  let select = expr(part.other, `${inner}    `);
  if (part.arms.length > 0) {
    const arms = part.arms.map((a) => `${inner}    ${lit(a.key)} => ${expr(a.parts, `${inner}    `)},\n`).join('');
    select = `match rt::category(rt::R${part.rules}, ${of}, ${minFrac}, ${maxFrac}) {\n${arms}${inner}    _ => ${select},\n${inner}}`;
  }
  const exact = part.exact
    .map((e) => `if n == ${float(e.value)} {\n${inner}    ${expr(e.parts, `${inner}    `)}\n${inner}} else `)
    .join('');
  const body = exact === '' ? select : `${exact}{\n${inner}    ${select}\n${inner}}`;
  return `{\n${inner}let n = ${on};\n${inner}${body}\n${indent}}`;
}

function method(m: NativeMessage, name: string, enumName: string): string {
  const head = doc(m.doc, '    ');
  const arms = (render: (parts: Part[]) => string) =>
    m.bodies.map((b) => `            ${b.locales.map((l) => `${enumName}::${variant(l)}`).join(' | ')} => ${render(b.parts)},\n`).join('');
  const isStatic = m.bodies.every((b) => b.parts.every((p) => p.type === 'text'));
  if (isStatic && m.args.length === 0)
    return `${head}    pub fn ${name}(self) -> &'static str {\n        match self {\n${arms((parts) => lit(parts[0]?.type === 'text' ? parts[0].value : ''))}        }\n    }\n`;
  const params = m.args.map((a) => `, ${argName(a.name)}: ${a.type === 'number' ? 'impl Number' : '&str'}`).join('');
  const argDocs = m.args.filter((a) => a.doc !== undefined).map((a) => `* \`${argName(a.name)}\`: ${a.doc}`);
  const docs = argDocs.length > 0 ? `${head}    ///\n${doc(argDocs, '    ')}` : head;
  const numbers = m.args
    .filter((a) => a.type === 'number')
    .map((a) => `        let ${argName(a.name)} = ${argName(a.name)}.as_f64();\n`)
    .join('');
  return `${docs}    pub fn ${name}(self${params}) -> String {\n${numbers}        match self {\n${arms((parts) => expr(parts, '            '))}        }\n    }\n`;
}

function formatConst(spec: NumberSpec, i: number): string {
  const affix = ([prefix, suffix]: readonly [string, string]) => `(${lit(prefix)}, ${lit(suffix)})`;
  const fields = [
    `min_int: ${spec.minInt}`,
    `min_frac: ${spec.minFrac}`,
    `max_frac: ${spec.maxFrac}`,
    `shift: ${spec.shift}`,
    `primary: ${spec.grouping.primary}`,
    `secondary: ${spec.grouping.secondary}`,
    `min_group: ${spec.grouping.min}`,
    `decimal: ${lit(spec.decimal)}`,
    `group: ${lit(spec.group)}`,
    `digits: ${spec.digits === undefined ? 'None' : `Some([${spec.digits.map(lit).join(', ')}])`}`,
    `positive: ${affix(spec.positive)}`,
    `negative: ${affix(spec.negative)}`,
    `zero: ${affix(spec.zero)}`,
    `negative_zero: ${affix(spec.negativeZero)}`,
    `infinity: ${lit(spec.infinity)}`,
    `negative_infinity: ${lit(spec.negativeInfinity)}`,
  ];
  return `    pub const F${i}: Format = Format {\n${fields.map((f) => `        ${f},\n`).join('')}    };\n`;
}

const NUMBER = `
    /// A number format, taken apart when the file was generated.
    pub struct Format {
        pub min_int: usize,
        pub min_frac: usize,
        pub max_frac: usize,
        pub shift: usize,
        pub primary: usize,
        pub secondary: usize,
        pub min_group: usize,
        pub decimal: &'static str,
        pub group: &'static str,
        pub digits: Option<[&'static str; 10]>,
        pub positive: (&'static str, &'static str),
        pub negative: (&'static str, &'static str),
        pub zero: (&'static str, &'static str),
        pub negative_zero: (&'static str, &'static str),
        pub infinity: &'static str,
        pub negative_infinity: &'static str,
    }

    /// \`value\` as \`format\` writes it, or \`fallback\` where it isn't a number.
    pub fn number(value: f64, format: &Format, fallback: &str) -> String {
        if value.is_nan() {
            return fallback.to_string();
        }
        if value.is_infinite() {
            return (if value > 0.0 { format.infinity } else { format.negative_infinity }).to_string();
        }
        let (mut int, frac) = digits(value.abs(), format.shift, format.min_frac, format.max_frac);
        let zero = int.bytes().chain(frac.bytes()).all(|b| b == b'0');
        let (prefix, suffix) = match (zero, value.is_sign_negative()) {
            (true, true) => format.negative_zero,
            (true, false) => format.zero,
            (false, true) => format.negative,
            (false, false) => format.positive,
        };
        while int.len() < format.min_int.max(1) {
            int.insert(0, '0');
        }
        let grouped = format.min_group > 0 && int.len() >= format.primary + format.min_group;
        let mut out = String::from(prefix);
        for (i, digit) in int.bytes().enumerate() {
            let left = int.len() - i;
            if grouped && i > 0 && (left == format.primary || (left > format.primary && (left - format.primary) % format.secondary == 0)) {
                out.push_str(format.group);
            }
            push_digit(&mut out, digit, format);
        }
        if !frac.is_empty() {
            out.push_str(format.decimal);
            for digit in frac.bytes() {
                push_digit(&mut out, digit, format);
            }
        }
        out.push_str(suffix);
        out
    }

    fn push_digit(out: &mut String, digit: u8, format: &Format) {
        match format.digits {
            Some(digits) => out.push_str(digits[(digit - b'0') as usize]),
            None => out.push(digit as char),
        }
    }

    /// The shortest digits that read back as \`value\`, as \`Intl\` rounds them: moved \`shift\` places
    /// right, rounded half away from zero to \`max\` fraction digits, and trailing zeros cut to \`min\`.
    pub fn digits(value: f64, shift: usize, min: usize, max: usize) -> (String, String) {
        // Display writes the shortest digits that read back, and never an exponent.
        let shortest = value.to_string();
        let (int, frac) = shortest.split_once('.').unwrap_or((&shortest, ""));
        let mut all: Vec<u8> = int.bytes().map(|b| b - b'0').collect();
        let mut rest = frac.bytes().map(|b| b - b'0');
        let mut point = all.len() + shift;
        for _ in 0..shift + max {
            all.push(rest.next().unwrap_or(0));
        }
        if rest.next().unwrap_or(0) >= 5 {
            let mut at = all.len();
            loop {
                if at == 0 {
                    all.insert(0, 1);
                    point += 1;
                    break;
                }
                at -= 1;
                if all[at] == 9 {
                    all[at] = 0;
                } else {
                    all[at] += 1;
                    break;
                }
            }
        }
        let mut frac = all.split_off(point);
        while frac.len() > min && frac.last() == Some(&0) {
            frac.pop();
        }
        let first = all.iter().position(|&d| d != 0).unwrap_or(all.len());
        let text = |d: &[u8]| d.iter().map(|&d| (b'0' + d) as char).collect::<String>();
        (text(&all[first..]), text(&frac))
    }
`;

const PLURAL = `
    /// CLDR's plural operands of a number as written.
    pub struct Operands {
        pub n: f64,
        pub i: f64,
        pub v: f64,
        pub w: f64,
        pub f: f64,
        pub t: f64,
        pub c: f64,
        pub e: f64,
    }

    /// The category \`rules\` give \`value\`, rounded to between \`min\` and \`max\` fraction digits.
    pub fn category(rules: fn(&Operands) -> &'static str, value: f64, min: usize, max: usize) -> &'static str {
        if !value.is_finite() {
            return "other";
        }
        let (int, frac) = digits(value.abs(), 0, min, max);
        let int = if int.is_empty() { String::from("0") } else { int };
        let trimmed = frac.trim_end_matches('0');
        let read = |s: &str| if s.is_empty() { 0.0 } else { s.parse().unwrap_or(0.0) };
        rules(&Operands {
            n: if frac.is_empty() { read(&int) } else { read(&format!("{}.{}", int, frac)) },
            i: read(&int),
            v: frac.len() as f64,
            w: trimmed.len() as f64,
            f: read(&frac),
            t: read(trimmed),
            c: 0.0,
            e: 0.0,
        })
    }

    /// An integer in the range, as CLDR's ranges hold.
    fn within(value: f64, from: f64, to: f64) -> bool {
        value.fract() == 0.0 && value >= from && value <= to
    }

    /// \`Math.round\`: half up, toward positive infinity.
    pub fn round(value: f64) -> f64 {
        let floor = value.floor();
        if value - floor >= 0.5 { floor + 1.0 } else { floor }
    }
`;

const NUMBER_TRAIT = `
/// A number a message formats: any of Rust's integers or floats.
pub trait Number: Copy {
    fn as_f64(self) -> f64;
}

macro_rules! number {
    ($($t:ty),*) => {$(
        impl Number for $t {
            fn as_f64(self) -> f64 {
                self as f64
            }
        }
    )*};
}

number!(i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, f32, f64);
`;

export function rustModule(model: NativeModel, target: NativeTarget & { name: string }, banner: string): string {
  const name = target.name;
  const names = model.messages.map((m): [string, string] => [m.key, ident(leading(snake(m.words)))]);
  checkNames('rust', names, ['tag', 'negotiate']);
  const variants = model.locales.map((l) => `    /// \`${l}\`${l === model.source ? ', the source' : ''}.\n    ${variant(l)},\n`).join('');
  const tags = model.locales.map((l) => `            ${name}::${variant(l)} => ${lit(l)},\n`).join('');
  const methods = model.messages.map((m, i) => method(m, names[i]![1], name)).join('\n');
  const usesNumbers = model.messages.some((m) => m.args.some((a) => a.type === 'number'));
  const rules = model.rules
    .map(({ name: rule, rules }, i) => {
      const checks = rules.map(
        ([category, condition]) =>
          `        if ${conditionCode(condition, { field: (op) => `o.${op}`, mod: (v, by) => `${v} % ${by}`, within: (v, from, to) => `within(${v}, ${from}, ${to})` })} {\n            return ${lit(category)};\n        }\n`,
      );
      return `    /// ${rule}\n    pub fn R${i}(${rules.length > 0 ? 'o' : '_o'}: &Operands) -> &'static str {\n${checks.join('')}        "other"\n    }\n`;
    })
    .join('\n');
  const runtime =
    model.formats.length + model.rules.length === 0
      ? ''
      : `
/// What formats the messages, generated with them.
mod rt {${NUMBER}${model.rules.length > 0 ? PLURAL : ''}
${model.formats.map(formatConst).join('\n')}${rules === '' ? '' : `\n${rules}`}}
`;

  return `${banner}
#![allow(dead_code, non_snake_case, clippy::all)]
${usesNumbers ? NUMBER_TRAIT : ''}
/// A locale the catalog is written or translated in, and its messages.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ${name} {
${variants}}

impl ${name} {
    /// Every locale, the source first.
    pub const ALL: [${name}; ${model.locales.length}] = [${model.locales.map((l) => `${name}::${variant(l)}`).join(', ')}];

    /// The locale the catalog is written in, which every message falls back to.
    pub const SOURCE: ${name} = ${name}::${variant(model.source)};

    /// The locale's BCP 47 tag.
    pub fn tag(self) -> &'static str {
        match self {
${tags}        }
    }

    /// The best locale for what was asked, most preferred first: each tag tries an exact match, then
    /// its parents (\`pt-BR\` finds \`pt\`), then any locale of its language. The source if none is.
    pub fn negotiate<S: AsRef<str>>(requested: &[S]) -> ${name} {
        let language = |tag: &str| tag.split('-').next().unwrap_or("").to_ascii_lowercase();
        for want in requested {
            let want = want.as_ref();
            let mut tag = want;
            loop {
                if let Some(found) = Self::ALL.iter().find(|l| l.tag().eq_ignore_ascii_case(tag)) {
                    return *found;
                }
                match tag.rfind('-') {
                    Some(cut) => tag = &tag[..cut],
                    None => break,
                }
            }
            if let Some(found) = Self::ALL.iter().find(|l| language(l.tag()) == language(want)) {
                return *found;
            }
        }
        Self::SOURCE
    }

${methods}}
${runtime}`;
}
