import type { Address, Hex } from "viem";

export type TokenAddress = Address;

export interface Token {
  address: TokenAddress;
  symbol: string;
  decimals: number;
  /** Price in USD as a number — used purely for gas-adjustment scoring. */
  priceUsd?: number;
}

export interface Quote {
  /** Effective input the pool can absorb (== amountIn unless we hit a cap). */
  amountIn: bigint;
  /** What the pool gives back. */
  amountOut: bigint;
  /** Marginal price *after* this trade, in tokenOut per tokenIn (1e18 fp). */
  midPriceAfter: bigint;
  /** Optional per-pool gas estimate for this hop, in wei-units. */
  gasEstimate?: bigint;
  /** Implementation-specific debug payload (tick crossings, etc.). */
  trace?: unknown;
}

/**
 * Common interface every pool implementation satisfies. The router only
 * needs `quoteExactIn`; everything else is for diagnostics & graph building.
 */
export interface Pool {
  /** Stable identifier — typically the pool's contract address. */
  readonly id: string;
  readonly tokens: readonly [TokenAddress, TokenAddress];
  readonly kind: "v2" | "v3" | "perp";
  /** Liquidity proxy used for pruning low-quality paths. */
  liquidityScore(): bigint;
  /**
   * Quote `amountIn` of `tokenIn` against this pool. Must NOT mutate state;
   * the router calls this many times during pathfinding.
   */
  quoteExactIn(tokenIn: TokenAddress, amountIn: bigint): Quote;
}

export interface RouteHop {
  pool: Pool;
  tokenIn: TokenAddress;
  tokenOut: TokenAddress;
}

export interface Route {
  hops: RouteHop[];
  /** Token at hop[0].tokenIn */
  inputToken: TokenAddress;
  /** Token at hops[last].tokenOut */
  outputToken: TokenAddress;
}

export interface RouteQuote {
  route: Route;
  amountIn: bigint;
  amountOut: bigint;
  /** End-to-end gas estimate (sum across hops + base overhead). */
  gasEstimate: bigint;
  /** `amountOut` minus the USD-equivalent gas cost. Used for ranking. */
  netOut: bigint;
  /** Raw per-hop quotes for the chosen route. */
  perHop: Quote[];
}

export interface SplitQuote {
  /** Per-route allocations, summing to `amountIn`. */
  legs: Array<{ route: Route; amountIn: bigint; amountOut: bigint; gasEstimate: bigint }>;
  amountIn: bigint;
  amountOut: bigint;
  gasEstimate: bigint;
  netOut: bigint;
}

export interface RouterContext {
  /** Token in which gas is denominated (native wrapper, e.g. WETH). */
  gasToken: TokenAddress;
  /** Native price in USD — pass it to convert wei → USD for scoring. */
  gasTokenPriceUsd: number;
  /** Gas price in wei per gas unit. */
  gasPriceWei: bigint;
  /** USD price per unit of `outputToken`, used to convert gas cost to outputToken units. */
  outputTokenPriceUsd: number;
  /** Decimals of the output token. */
  outputTokenDecimals: number;
}

/** Used by `pathfinder` to bound search. */
export interface SearchParams {
  /** Maximum hops in any single route (≤ 4 in production; default 3). */
  maxHops: number;
  /** Maximum number of routes to return; defaults to 8. */
  maxRoutes: number;
  /** If we run out of viable paths, stop early. */
  earlyStopAfterMs?: number;
}

export const ZERO_QUOTE: Quote = {
  amountIn: 0n,
  amountOut: 0n,
  midPriceAfter: 0n,
};

export interface QuoteSwapHash {
  /** A deterministic hash of (token, amountIn, blocknum) used as a cache key. */
  hash: Hex;
}
