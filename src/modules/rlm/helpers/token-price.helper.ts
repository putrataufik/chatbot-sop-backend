// FILE: src/modules/rlm/helpers/token-price.helper.ts
//
// Harga per 1 juta token (dalam USD), sumber: OpenAI Pricing
// gpt-5.1  : Input $1.25 / Output $10.00
// gpt-5-mini: Input $0.25 / Output $2.00

export const TOKEN_PRICE = {
  ROOT: {
    // gpt-5.1
    INPUT_PER_M:  1.25,
    OUTPUT_PER_M: 10.00,
  },
  SUB: {
    // gpt-5-mini
    INPUT_PER_M:  0.25,
    OUTPUT_PER_M: 2.00,
  },
} as const;

export interface ModelCost {
  input_tokens:  number;
  output_tokens: number;
  input_cost_usd:  number;
  output_cost_usd: number;
  total_cost_usd:  number;
}

export interface TokenCostBreakdown {
  // Root LM (gpt-5.1)
  root: ModelCost;
  // Sub LM (gpt-5-mini) — 0 untuk CONV
  sub: ModelCost;
  // Total gabungan
  total_cost_usd: number;
}

/**
 * Hitung biaya dalam USD berdasarkan jumlah token.
 * @param tokens    jumlah token
 * @param pricePerM harga per 1 juta token
 */
function calcCost(tokens: number, pricePerM: number): number {
  return (tokens / 1_000_000) * pricePerM;
}

/**
 * Hitung breakdown biaya lengkap dari token log.
 */
export function calcTokenCost(params: {
  root_input_tokens:  number;
  root_output_tokens: number;
  sub_input_tokens:   number;
  sub_output_tokens:  number;
}): TokenCostBreakdown {
  const rootInputCost  = calcCost(params.root_input_tokens,  TOKEN_PRICE.ROOT.INPUT_PER_M);
  const rootOutputCost = calcCost(params.root_output_tokens, TOKEN_PRICE.ROOT.OUTPUT_PER_M);
  const subInputCost   = calcCost(params.sub_input_tokens,   TOKEN_PRICE.SUB.INPUT_PER_M);
  const subOutputCost  = calcCost(params.sub_output_tokens,  TOKEN_PRICE.SUB.OUTPUT_PER_M);

  const root: ModelCost = {
    input_tokens:    params.root_input_tokens,
    output_tokens:   params.root_output_tokens,
    input_cost_usd:  round8(rootInputCost),
    output_cost_usd: round8(rootOutputCost),
    total_cost_usd:  round8(rootInputCost + rootOutputCost),
  };

  const sub: ModelCost = {
    input_tokens:    params.sub_input_tokens,
    output_tokens:   params.sub_output_tokens,
    input_cost_usd:  round8(subInputCost),
    output_cost_usd: round8(subOutputCost),
    total_cost_usd:  round8(subInputCost + subOutputCost),
  };

  return {
    root,
    sub,
    total_cost_usd: round8(root.total_cost_usd + sub.total_cost_usd),
  };
}

/**
 * Format USD dengan presisi tinggi untuk tampilan.
 * Contoh: 0.00123456 → "$0.001235"
 */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.000000';
  if (amount < 0.000001) return `$${amount.toExponential(4)}`;
  return `$${amount.toFixed(6)}`;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}