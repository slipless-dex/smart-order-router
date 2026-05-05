/**
 * Perp-market pool. Quotes against the orderbook by sweeping levels.
 *
 * Behaves like a one-sided pool from the SOR's POV: tokenIn is the quote
 * asset, tokenOut is the base asset (or vice-versa, depending on side).
 * Slippage = walking the book.
 */

import type { Pool, Quote, TokenAddress } from "../types.js";

export interface BookLevel {
  /** Price in tokenOut per tokenIn, in 1e18 fp. */
  price: bigint;
  /** Available size in tokenOut units (sized in the *base* asset). */
  size: bigint;
}

export interface PerpMarketConfig {
  id: string;
  /** [quote, base] — buying base means tokenIn = quote. */
  tokens: readonly [TokenAddress, TokenAddress];
  /** Asks sorted ascending by price (for buys). */
  asks: readonly BookLevel[];
  /** Bids sorted descending (for sells). */
  bids: readonly BookLevel[];
  /** Taker fee in bps. */
  takerFeeBps: number;
}

const ONE_E18 = 10n ** 18n;

export class PerpMarket implements Pool {
  readonly kind = "perp" as const;
  readonly id: string;
  readonly tokens: readonly [TokenAddress, TokenAddress];
  readonly takerFeeBps: number;

  private readonly bids: BookLevel[];
  private readonly asks: BookLevel[];

  constructor(cfg: PerpMarketConfig) {
    this.id = cfg.id;
    this.tokens = cfg.tokens;
    this.bids = [...cfg.bids];
    this.asks = [...cfg.asks];
    this.takerFeeBps = cfg.takerFeeBps;
  }

  liquidityScore(): bigint {
    const topAsk = this.asks[0]?.size ?? 0n;
    const topBid = this.bids[0]?.size ?? 0n;
    return topAsk + topBid;
  }

  quoteExactIn(tokenIn: TokenAddress, amountIn: bigint): Quote {
    if (amountIn <= 0n) return { amountIn: 0n, amountOut: 0n, midPriceAfter: 0n };
    const buyingBase = tokenIn.toLowerCase() === this.tokens[0].toLowerCase();
    const book = buyingBase ? this.asks : this.bids;
    if (book.length === 0) return { amountIn: 0n, amountOut: 0n, midPriceAfter: 0n };

    let remainingIn = amountIn;
    let outTotal = 0n;
    let lastPrice = 0n;
    const fee = BigInt(this.takerFeeBps);

    for (const level of book) {
      // Convert level.size (base) to its quote-cost using level.price.
      const quoteCostFull = (level.size * level.price) / ONE_E18;
      if (remainingIn >= quoteCostFull) {
        outTotal += level.size;
        remainingIn -= quoteCostFull;
        lastPrice = level.price;
        continue;
      }
      // Partial fill at this level.
      const baseTaken = (remainingIn * ONE_E18) / level.price;
      outTotal += baseTaken;
      remainingIn = 0n;
      lastPrice = level.price;
      break;
    }

    // Apply taker fee on the *output* side — the matcher charges fees in
    // the asset being received, which is what an integrator expects.
    const outAfterFee = (outTotal * (10_000n - fee)) / 10_000n;
    return {
      amountIn: amountIn - remainingIn,
      amountOut: outAfterFee,
      midPriceAfter: lastPrice,
    };
  }
}
