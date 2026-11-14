/**
 * `prosebook/ai`: judges for `prosebook judge` and a translator for `prosebook translate`, made from AI
 * SDK models. An entry of its own, so only a project that asks a model needs `ai`, an optional peer. `decisionJudge` takes a decision model, through the
 * SDK's `experimental_decide`: `typeSafeAi.decisionModel('jev-latest')` from `@ai-sdk/typesafe-ai`, or
 * a model ID the AI Gateway resolves (`'typesafe-ai/jev'`). `languageJudge` takes a language model,
 * through structured output, and can suggest a rewrite as well. `languageTranslator` is the model
 * `prosebook translate` asks.
 */
import {
  experimental_decide,
  generateText,
  jsonSchema,
  Output,
  type Experimental_DecisionModel,
  type LanguageModel,
  type ProviderMetadata,
} from 'ai';

import type { Judge } from './tools/judge.ts';
import type { Translator } from './tools/translate.ts';

type ProviderOptions = NonNullable<Parameters<typeof experimental_decide>[0]['providerOptions']>;

export interface DecisionJudgeOptions {
  /**
   * The model's prices in US dollars per million tokens, to say what a run cost where the provider
   * doesn't, a price not given being free: Jev's is `{ input: 0.042 }`. The AI Gateway says each request's cost.
   */
  price?: { input?: number; output?: number };
  /** Retries of a request the provider refused for now (429, 529): 2 by default. */
  maxRetries?: number;
  providerOptions?: ProviderOptions;
  headers?: Record<string, string>;
  /** `false` where this machine can't ask the model, as without its key: the lock's answers still count (`Judge.ask`). */
  ask?: boolean;
  /** The probability from which this model's answer is a break, over `judge.threshold` (`Judge.threshold`). */
  threshold?: number;
}

/** A judge asking `model`, which must answer boolean questions. */
export function decisionJudge(model: Experimental_DecisionModel, options: DecisionJudgeOptions = {}): Judge {
  const { price, maxRetries, providerOptions, headers, ask, threshold } = options;
  return {
    id: typeof model === 'string' ? model : `${model.provider}/${model.modelId}`,
    ...(ask !== undefined && { ask }),
    ...(threshold !== undefined && { threshold }),
    async judge({ state, questions, signal }) {
      const result = await experimental_decide({
        model,
        state,
        questions: Object.fromEntries(Object.entries(questions).map(([rule, q]) => [rule, { type: 'boolean' as const, ...q }])),
        ...(maxRetries !== undefined && { maxRetries }),
        ...(providerOptions !== undefined && { providerOptions }),
        ...(headers !== undefined && { headers }),
        ...(signal !== undefined && { abortSignal: signal }),
      });
      const probabilities: Record<string, number> = {};
      for (const [rule, answer] of Object.entries(result.answers)) if (answer.type === 'boolean') probabilities[rule] = answer.probability;
      const { inputTokens, outputTokens } = result.usage;
      const usage = { ...(inputTokens !== undefined && { inputTokens }), ...(outputTokens !== undefined && { outputTokens }) };
      const cost = gatewayCost(result.providerMetadata) ?? priced(price, inputTokens, outputTokens);
      return { probabilities, usage, ...(cost !== undefined && { cost }) };
    },
  };
}

export interface LanguageJudgeOptions extends DecisionJudgeOptions {
  /** Ask for a rewrite of each entry found breaking a guideline (`JudgeResponse.suggestion`): true by default. */
  suggest?: boolean;
}

/** What a language model is asked to judge by: the questions, and the rewrite where it finds one broken. */
const INSTRUCTIONS = `You judge one piece of an app's text, or of its docs, against writing guidelines.

The entry is JSON: \`message\` is the text, in a message syntax where \`{...}\` is a placeholder, plural or select and \`<tag>...</tag>\` a tag; \`language\` is the language it is written in; the rest says where it stands, what each placeholder holds, and the guidelines it is held to.

Each question has instructions, and what \`true\` and \`false\` mean. Answer each with the probability, from 0 to 1, that the answer is true: near 1 or 0 where it plainly is one, near 0.5 only where it could go either way.`;

const SUGGEST = `

Where you find a guideline broken, a \`breaks\` question you answer above 0.5 whose \`concerns\` question you also answer above 0.5, give \`suggestion\`: \`message\` rewritten to keep to every guideline the entry is held to, changing no more than it must. Write it in the same language and syntax, saying what the message says, with every placeholder, plural, select and tag kept exactly as written. Otherwise give null.`;

/**
 * A judge asking a language model, `anthropic('claude-haiku-5-5')` from `@ai-sdk/anthropic` or any the
 * AI SDK reaches, through structured output: the same questions a decision model answers, each a
 * probability, and with `suggest`, a rewrite of an entry it finds breaking a guideline.
 */
export function languageJudge(model: LanguageModel, options: LanguageJudgeOptions = {}): Judge {
  const { price, maxRetries, providerOptions, headers, ask, threshold, suggest = true } = options;
  return {
    id: typeof model === 'string' ? model : `${model.provider}/${model.modelId}`,
    ...(ask !== undefined && { ask }),
    ...(threshold !== undefined && { threshold }),
    async judge({ state, questions, signal }) {
      const ids = Object.keys(questions);
      const answers = {
        type: 'object' as const,
        properties: Object.fromEntries(
          ids.map((id) => [id, { type: 'number' as const, description: 'The probability, from 0 to 1, that the answer is true.' }]),
        ),
        required: ids,
        additionalProperties: false,
      };
      const suggestion = { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] };
      const schema = jsonSchema<{ answers: Record<string, number>; suggestion?: string | null }>({
        type: 'object',
        properties: suggest ? { answers, suggestion } : { answers },
        required: suggest ? ['answers', 'suggestion'] : ['answers'],
        additionalProperties: false,
      });
      const result = await generateText({
        model,
        system: suggest ? INSTRUCTIONS + SUGGEST : INSTRUCTIONS,
        prompt: JSON.stringify({ entry: state, questions }, null, 2),
        output: Output.object({ schema }),
        ...(maxRetries !== undefined && { maxRetries }),
        ...(providerOptions !== undefined && { providerOptions }),
        ...(headers !== undefined && { headers }),
        ...(signal !== undefined && { abortSignal: signal }),
      });
      const probabilities: Record<string, number> = {};
      // A model writes a number, not a probability: one past either end is read as that end.
      for (const id of ids) {
        const p = result.output.answers[id];
        if (typeof p === 'number' && !Number.isNaN(p)) probabilities[id] = Math.min(1, Math.max(0, p));
      }
      const { inputTokens, outputTokens } = result.usage;
      const usage = { ...(inputTokens !== undefined && { inputTokens }), ...(outputTokens !== undefined && { outputTokens }) };
      const cost = gatewayCost(result.providerMetadata) ?? priced(price, inputTokens, outputTokens);
      const rewrite = result.output.suggestion;
      return {
        probabilities,
        usage,
        ...(cost !== undefined && { cost }),
        ...(typeof rewrite === 'string' && rewrite.trim() !== '' && { suggestion: rewrite }),
      };
    },
  };
}

export type TranslatorOptions = Pick<DecisionJudgeOptions, 'price' | 'maxRetries' | 'providerOptions' | 'headers'>;

/**
 * A translator for `prosebook translate` asking a language model, `anthropic('claude-sonnet-5-5')` from
 * `@ai-sdk/anthropic` or any the AI SDK reaches: the prompt `prosebook todo --prompt` writes goes in,
 * and the reply comes back as text, which prosebook checks as `import` does.
 */
export function languageTranslator(model: LanguageModel, options: TranslatorOptions = {}): Translator {
  const { price, maxRetries, providerOptions, headers } = options;
  return {
    id: typeof model === 'string' ? model : `${model.provider}/${model.modelId}`,
    async translate({ prompt, signal }) {
      const result = await generateText({
        model,
        prompt,
        ...(maxRetries !== undefined && { maxRetries }),
        ...(providerOptions !== undefined && { providerOptions }),
        ...(headers !== undefined && { headers }),
        ...(signal !== undefined && { abortSignal: signal }),
      });
      const { inputTokens, outputTokens } = result.usage;
      const usage = { ...(inputTokens !== undefined && { inputTokens }), ...(outputTokens !== undefined && { outputTokens }) };
      const cost = gatewayCost(result.providerMetadata) ?? priced(price, inputTokens, outputTokens);
      return { text: result.text, usage, ...(cost !== undefined && { cost }) };
    },
  };
}

/** The AI Gateway's cost of the request, which it writes in dollars, as a string. */
function gatewayCost(metadata: ProviderMetadata | undefined): number | undefined {
  const cost = Number(metadata?.['gateway']?.['cost']);
  return metadata?.['gateway']?.['cost'] === undefined || Number.isNaN(cost) ? undefined : cost;
}

function priced(price: DecisionJudgeOptions['price'], input: number | undefined, output: number | undefined): number | undefined {
  if (price === undefined) return undefined;
  // A price not given is free, as Jev's output is.
  return ((input ?? 0) * (price.input ?? 0) + (output ?? 0) * (price.output ?? 0)) / 1e6;
}
