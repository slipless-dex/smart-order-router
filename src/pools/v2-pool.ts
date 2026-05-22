// y_out = y * dx * (1 - fee) / (x + dx * (1 - fee))

import type { Pool, Quote, TokenAddress } from "../types.js";

export interface V2PoolConfig {
  id: string;
  tokens: readonly [TokenAddress, TokenAddress];
  reserves: readonly [bigint, bigint];
  /** Basis points. 30 = 0.30%. */
  feeBps: number;
}

const ONE_E18 = 10n ** 18n;
const BPS = 10_000n;

export class V2Pool implements Pool {
  readonly kind = "v2" as const;
  readonly id: string;
  readonly tokens: readonly [TokenAddress, TokenAddress];
  readonly feeBps: number;
  private readonly token0Lower: string;
  private readonly reserves: [bigint, bigint];
  private cachedLiquidity?: bigint;

  constructor(cfg: V2PoolConfig) {
    if (cfg.reserves[0] <= 0n || cfg.reserves[1] <= 0n) {
      throw new Error(`V2Pool ${cfg.id}: reserves must be > 0`);
    }
    this.id = cfg.id;
    this.tokens = cfg.tokens;
    this.feeBps = cfg.feeBps;
    this.token0Lower = cfg.tokens[0].toLowerCase();
    this.reserves = [cfg.reserves[0], cfg.reserves[1]];
  }

  liquidityScore(): bigint {
    if (this.cachedLiquidity !== undefined) return this.cachedLiquidity;
    this.cachedLiquidity = sqrtBig(this.reserves[0] * this.reserves[1]);
    return this.cachedLiquidity;
  }

  quoteExactIn(tokenIn: TokenAddress, amountIn: bigint): Quote {
    if (amountIn <= 0n) return { amountIn: 0n, amountOut: 0n, midPriceAfter: 0n };

    const inFirst = this.token0Lower === tokenIn.toLowerCase();
    if (!inFirst && this.tokens[1].toLowerCase() !== tokenIn.toLowerCase()) {
      throw new Error(`V2Pool ${this.id}: ${tokenIn} not in pool`);
    }
    const reserveIn = inFirst ? this.reserves[0] : this.reserves[1];
    const reserveOut = inFirst ? this.reserves[1] : this.reserves[0];

    const inAfterFee = amountIn * (BPS - BigInt(this.feeBps));
    const amountOut = (inAfterFee * reserveOut) / (reserveIn * BPS + inAfterFee);

    const newIn = reserveIn + amountIn;
    const newOut = reserveOut - amountOut;
    const midPriceAfter = newIn === 0n ? 0n : (newOut * ONE_E18) / newIn;

    return { amountIn, amountOut, midPriceAfter };
  }
}

function sqrtBig(value: bigint): bigint {
  if (value < 2n) return value < 0n ? 0n : value;
  let x0 = value;
  let x1 = (value >> 1n) + 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + value / x1) >> 1n;
  }
  return x0;
}
