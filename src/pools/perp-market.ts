import type { Pool, Quote, TokenAddress } from "../types.js";

export interface BookLevel {
  /** tokenOut per tokenIn, 1e18 fp. */
  price: bigint;
  /** Base-asset units. */
  size: bigint;
}

export interface PerpMarketConfig {
  id: string;
  /** [quote, base]. */
  tokens: readonly [TokenAddress, TokenAddress];
  /** Ascending. */
  asks: readonly BookLevel[];
  /** Descending. */
  bids: readonly BookLevel[];
  takerFeeBps: number;
}

const ONE_E18 = 10n ** 18n;

export class PerpMarket implements Pool {
  readonly kind = "perp" as const;
  readonly id: string;
  readonly tokens: readonly [TokenAddress, TokenAddress];
  readonly takerFeeBps: number;

  private readonly token0Lower: string;
  private readonly bids: readonly BookLevel[];
  private readonly asks: readonly BookLevel[];

  constructor(cfg: PerpMarketConfig) {
    this.id = cfg.id;
    this.tokens = cfg.tokens;
    this.token0Lower = cfg.tokens[0].toLowerCase();
    this.bids = cfg.bids;
    this.asks = cfg.asks;
    this.takerFeeBps = cfg.takerFeeBps;
  }

  liquidityScore(): bigint {
    return (this.asks[0]?.size ?? 0n) + (this.bids[0]?.size ?? 0n);
  }

  quoteExactIn(tokenIn: TokenAddress, amountIn: bigint): Quote {
    if (amountIn <= 0n) return { amountIn: 0n, amountOut: 0n, midPriceAfter: 0n };

    const buyingBase = tokenIn.toLowerCase() === this.token0Lower;
    const book = buyingBase ? this.asks : this.bids;
    if (book.length === 0) return { amountIn: 0n, amountOut: 0n, midPriceAfter: 0n };

    let remaining = amountIn;
    let out = 0n;
    let lastPrice = 0n;

    for (const level of book) {
      const fullCost = (level.size * level.price) / ONE_E18;
      if (remaining >= fullCost) {
        out += level.size;
        remaining -= fullCost;
        lastPrice = level.price;
        continue;
      }
      out += (remaining * ONE_E18) / level.price;
      remaining = 0n;
      lastPrice = level.price;
      break;
    }

    const fee = BigInt(this.takerFeeBps);
    return {
      amountIn: amountIn - remaining,
      amountOut: (out * (10_000n - fee)) / 10_000n,
      midPriceAfter: lastPrice,
    };
  }
}
