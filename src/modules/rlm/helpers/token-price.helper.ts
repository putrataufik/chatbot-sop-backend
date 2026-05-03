// FILE: src/modules/rlm/helpers/token-price.helper.ts
//
// Harga per 1 juta token (dalam USD), sumber: OpenAI Pricing
// gpt-5.4   : Input $2.50 / Cached $0.25 / Output $15.00
// gpt-5-mini: Input $0.25 / Cached $0.025 / Output $2.00
//
// VERIFY: https://openai.com/api/pricing

export const TOKEN_PRICE = {
  ROOT: {
    // gpt-5.4
    INPUT_PER_M:        2.50,
    CACHED_INPUT_PER_M: 0.25,
    OUTPUT_PER_M:       15.00,
  },
  SUB: {
    // gpt-5-mini
    INPUT_PER_M:        0.25,
    CACHED_INPUT_PER_M: 0.025,
    OUTPUT_PER_M:       2.00,
  },
} as const;

export interface ModelCost {
  // Tokens
  input_tokens:        number;
  cached_input_tokens: number;
  output_tokens:       number;
  // Costs
  input_cost_usd:        number;  // biaya untuk full-price input (input_tokens - cached_input_tokens)
  cached_input_cost_usd: number;  // biaya untuk cached input
  output_cost_usd:       number;
  total_cost_usd:        number;
  // Cache metric
  cache_hit_rate:        string;  // "84.5%" atau "0.0%"
}

export interface TokenCostBreakdown {
  root: ModelCost;
  sub:  ModelCost;
  total_cost_usd:           number;
  total_cached_input_tokens: number;
  total_savings_usd:         number; // perkiraan hemat dari caching
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
 * Hitung biaya untuk satu model (Root atau Sub) dengan memperhitungkan cached input.
 *
 * Logika:
 * - input_tokens dari API = TOTAL prompt tokens (sudah termasuk cached)
 * - cached_input_tokens = subset dari input_tokens yang kena cache hit
 * - full_price_tokens = input_tokens - cached_input_tokens → dihargai INPUT_PER_M
 * - cached_input_tokens → dihargai CACHED_INPUT_PER_M (lebih murah)
 */
function calcModelCost(
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  inputPerM: number,
  cachedInputPerM: number,
  outputPerM: number,
): ModelCost {
  // Pastikan cached tidak lebih besar dari total input (defensive)
  const safeCached = Math.min(cachedInputTokens, inputTokens);
  const fullPrice  = Math.max(0, inputTokens - safeCached);

  const inputCost       = calcCost(fullPrice,  inputPerM);
  const cachedInputCost = calcCost(safeCached, cachedInputPerM);
  const outputCost      = calcCost(outputTokens, outputPerM);
  const totalCost       = inputCost + cachedInputCost + outputCost;

  const cacheHitPct = inputTokens > 0
    ? ((safeCached / inputTokens) * 100).toFixed(1) + '%'
    : '0.0%';

  return {
    input_tokens:          inputTokens,
    cached_input_tokens:   safeCached,
    output_tokens:         outputTokens,
    input_cost_usd:        round8(inputCost),
    cached_input_cost_usd: round8(cachedInputCost),
    output_cost_usd:       round8(outputCost),
    total_cost_usd:        round8(totalCost),
    cache_hit_rate:        cacheHitPct,
  };
}

/**
 * Hitung breakdown biaya lengkap dari token log, termasuk diskon cached input.
 *
 * Field cached opsional: kalau tidak diisi (atau undefined), dianggap 0
 * (backward-compatible dengan log lama yang belum punya kolom cached).
 */
export function calcTokenCost(params: {
  root_input_tokens:         number;
  root_output_tokens:        number;
  root_cached_input_tokens?: number;
  sub_input_tokens:          number;
  sub_output_tokens:         number;
  sub_cached_input_tokens?:  number;
}): TokenCostBreakdown {
  const rootCached = params.root_cached_input_tokens ?? 0;
  const subCached  = params.sub_cached_input_tokens  ?? 0;

  const root = calcModelCost(
    params.root_input_tokens,
    rootCached,
    params.root_output_tokens,
    TOKEN_PRICE.ROOT.INPUT_PER_M,
    TOKEN_PRICE.ROOT.CACHED_INPUT_PER_M,
    TOKEN_PRICE.ROOT.OUTPUT_PER_M,
  );

  const sub = calcModelCost(
    params.sub_input_tokens,
    subCached,
    params.sub_output_tokens,
    TOKEN_PRICE.SUB.INPUT_PER_M,
    TOKEN_PRICE.SUB.CACHED_INPUT_PER_M,
    TOKEN_PRICE.SUB.OUTPUT_PER_M,
  );

  // Hitung "savings" — perkiraan biaya kalau cached tokens dibayar full price
  const rootSavings = calcCost(
    rootCached,
    TOKEN_PRICE.ROOT.INPUT_PER_M - TOKEN_PRICE.ROOT.CACHED_INPUT_PER_M,
  );
  const subSavings = calcCost(
    subCached,
    TOKEN_PRICE.SUB.INPUT_PER_M - TOKEN_PRICE.SUB.CACHED_INPUT_PER_M,
  );

  return {
    root,
    sub,
    total_cost_usd:            round8(root.total_cost_usd + sub.total_cost_usd),
    total_cached_input_tokens: rootCached + subCached,
    total_savings_usd:         round8(rootSavings + subSavings),
  };
}

/**
 * Format USD dengan presisi tinggi untuk tampilan.
 * Contoh: 0.00123456 → "$0.001235"
 */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.000000';
  if (Math.abs(amount) < 0.000001) return `$${amount.toExponential(4)}`;
  return `$${amount.toFixed(6)}`;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}