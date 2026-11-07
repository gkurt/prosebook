/**
 * `prosebook/ai`: a judge for `prosebook judge` made from an AI SDK decision model, through the
 * SDK's `experimental_decide`. An entry of its own, so only a project that judges needs `ai`, an
 * optional peer: `typeSafeAi.decisionModel('jev-latest')` from `@ai-sdk/typesafe-ai`, or a model ID
 * the AI Gateway resolves (`'typesafe-ai/jev'`).
 */
import { experimental_decide, type Experimental_DecisionModel, type ProviderMetadata } from 'ai';

import type { Judge } from './tools/judge.ts';

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
}

/** A judge asking `model`, which must answer boolean questions. */
export function decisionJudge(model: Experimental_DecisionModel, options: DecisionJudgeOptions = {}): Judge {
  const { price, maxRetries, providerOptions, headers } = options;
  return {
    id: typeof model === 'string' ? model : `${model.provider}/${model.modelId}`,
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
