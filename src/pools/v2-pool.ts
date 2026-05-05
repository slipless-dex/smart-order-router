/**
 * Constant-product pool (UniswapV2-style).
 *
 *     y_out = y - k / (x + dx*(1 - fee))
 *           = y * dx*(1 - fee) / (x + dx*(1 - fee))
 *
 * Fee is in basis points (e.g. 30 = 0.30%). Math is fully exact when the
 * reserves stay below 2^96 — which gives us roughly 8.4e28 base units of
 * headroom, far above any real pool.
 */

import type { Pool, Quote, TokenAddress } from "../types.js";

export interface V2PoolConfig {
  id: string;
  tokens: readonly [TokenAddress, TokenAddress];
  /** Reserves match `tokens` in order. */
  reserves: readonly [bigint, bigint];
  /** Fee in basis points; e.g. 30 = 0.30%. */
  feeBps: number;
}

const ONE_E18 = 10n ** 18n;
const BPS_DENOM = 10_000n;

export class V2Pool implements Pool {
  readonly kind = "v2" as const;
  readonly id: string;
  readonly tokens: readonly [TokenAddress, TokenAddress];
  readonly feeBps: number;
  private readonly reserves: [bigint, bigint];

  constructor(cfg: V2PoolConfig) {
    if (cfg.reserves[0] <= 0n || cfg.reserves[1] <= 0n) {
      throw new Error(`V2Pool ${cfg.id}: reserves must be > 0`);
    }
    this.id = cfg.id;
    this.tokens = cfg.tokens;
    this.feeBps = cfg.feeBps;
    this.reserves = [cfg.reserves[0], cfg.reserves[1]];
  }

  liquidityScore(): bigint {
    // sqrt(x*y) is the canonical V2 liquidity proxy.
    return sqrtBig(this.reserves[0] * this.reserves[1]);
  }

  quoteExactIn(tokenIn: TokenAddress, amountIn: bigint): Quote {
    if (amountIn <= 0n) {
      return { amountIn: 0n, amountOut: 0n, midPriceAfter: 0n };
    }
    const inFirst = this.tokens[0].toLowerCase() === tokenIn.toLowerCase();
    if (!inFirst && this.tokens[1].toLowerCase() !== tokenIn.toLowerCase()) {
      throw new Error(`V2Pool ${this.id}: token ${tokenIn} not in pool`);
    }
    const [reserveIn, reserveOut] = inFirst
      ? [this.reserves[0], this.reserves[1]]
      : [this.reserves[1], this.reserves[0]];

    // Apply fee on the input side.
    const inAfterFee = amountIn * (BPS_DENOM - BigInt(this.feeBps));
    const numerator = inAfterFee * reserveOut;
    const denominator = reserveIn * BPS_DENOM + inAfterFee;
    const amountOut = numerator / denominator;

    // Marginal price after the trade (output per input, 1e18 fp).
    const newReserveIn = reserveIn + amountIn;
    const newReserveOut = reserveOut - amountOut;
    const midPriceAfter = newReserveIn === 0n
      ? 0n
      : (newReserveOut * ONE_E18) / newReserveIn;

    return { amountIn, amountOut, midPriceAfter };
  }
}

/** Babylonian sqrt for bigint. Used only for liquidity scoring. */
function sqrtBig(value: bigint): bigint {
  if (value < 0n) throw new Error("sqrtBig: negative");
  if (value < 2n) return value;
  let x0 = value;
  let x1 = (value >> 1n) + 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + value / x1) >> 1n;
  }
  return x0;
}
