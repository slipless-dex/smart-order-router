import type { Address } from "viem";

export type TokenAddress = Address;

export interface Token {
  address: TokenAddress;
  symbol: string;
  decimals: number;
  priceUsd?: number;
}

export interface Quote {
  amountIn: bigint;
  amountOut: bigint;
  /** tokenOut per tokenIn, 1e18 fp. */
  midPriceAfter: bigint;
  /** Gas for this hop. */
  gasEstimate?: bigint;
  trace?: unknown;
}

export interface Pool {
  readonly id: string;
  readonly tokens: readonly [TokenAddress, TokenAddress];
  readonly kind: "v2" | "v3" | "perp";
  /** Pruning hint. */
  liquidityScore(): bigint;
  /** Pure. Called many times during pathfinding. */
  quoteExactIn(tokenIn: TokenAddress, amountIn: bigint): Quote;
}

export interface RouteHop {
  pool: Pool;
  tokenIn: TokenAddress;
  tokenOut: TokenAddress;
}

export interface Route {
  hops: RouteHop[];
  inputToken: TokenAddress;
  outputToken: TokenAddress;
}

export interface RouteQuote {
  route: Route;
  amountIn: bigint;
  amountOut: bigint;
  gasEstimate: bigint;
  /** amountOut minus gas in outputToken units; used for ranking. */
  netOut: bigint;
  perHop: Quote[];
}

export interface SplitQuote {
  legs: Array<{ route: Route; amountIn: bigint; amountOut: bigint; gasEstimate: bigint }>;
  amountIn: bigint;
  amountOut: bigint;
  gasEstimate: bigint;
  netOut: bigint;
}

export interface RouterContext {
  gasToken: TokenAddress;
  gasTokenPriceUsd: number;
  gasPriceWei: bigint;
  outputTokenPriceUsd: number;
  outputTokenDecimals: number;
}

export interface SearchParams {
  /** ≤ 4 in production. */
  maxHops: number;
  maxRoutes: number;
  earlyStopAfterMs?: number;
}

export const ZERO_QUOTE: Quote = {
  amountIn: 0n,
  amountOut: 0n,
  midPriceAfter: 0n,
};
