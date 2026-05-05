/**
 * Take a discovered Route and compute its end-to-end quote, including
 * gas-adjusted score in `outputToken` units.
 */

import type {
  Pool,
  Quote,
  Route,
  RouteHop,
  RouteQuote,
  RouterContext,
  TokenAddress,
} from "./types.js";

const BASE_OVERHEAD_GAS = 60_000n; // call into LimitOrderProtocol etc.

export function quoteRoute(
  route: Route,
  amountIn: bigint,
  ctx: RouterContext,
): RouteQuote {
  if (route.hops.length === 0) {
    throw new Error("quoteRoute: empty route");
  }

  const perHop: Quote[] = [];
  let cur = amountIn;
  let gas = BASE_OVERHEAD_GAS;
  let activeIn: TokenAddress = route.inputToken;

  for (const hop of route.hops) {
    const q = hop.pool.quoteExactIn(activeIn, cur);
    perHop.push(q);
    if (q.amountOut === 0n) {
      // Path failed mid-way; surface a zero quote.
      return zeroQuote(route, amountIn, ctx);
    }
    cur = q.amountOut;
    activeIn = hop.tokenOut;
    gas += hopGasFor(hop) + (q.gasEstimate ?? 0n);
  }

  const netOut = applyGasAdjustment(cur, gas, ctx);
  return {
    route,
    amountIn,
    amountOut: cur,
    gasEstimate: gas,
    netOut,
    perHop,
  };
}

/**
 * Subtract the gas cost (denominated in outputToken units) from amountOut.
 * Done in floating-point because gas-cost approximation doesn't need
 * sub-wei precision; the truncation back to bigint keeps balances exact.
 */
export function applyGasAdjustment(
  amountOut: bigint,
  gasEstimate: bigint,
  ctx: RouterContext,
): bigint {
  if (ctx.gasPriceWei === 0n || gasEstimate === 0n) return amountOut;
  const gasUsdNum = Number(gasEstimate) * Number(ctx.gasPriceWei) * ctx.gasTokenPriceUsd / 1e18;
  if (!Number.isFinite(gasUsdNum) || ctx.outputTokenPriceUsd === 0) return amountOut;
  const gasInOutputUnitsNum = (gasUsdNum / ctx.outputTokenPriceUsd) * 10 ** ctx.outputTokenDecimals;
  if (!Number.isFinite(gasInOutputUnitsNum)) return amountOut;
  const gasInOutputUnits = BigInt(Math.floor(Math.max(0, gasInOutputUnitsNum)));
  return amountOut > gasInOutputUnits ? amountOut - gasInOutputUnits : 0n;
}

function hopGasFor(hop: RouteHop): bigint {
  switch (hop.pool.kind) {
    case "v2":
      return 60_000n;
    case "v3":
      return 90_000n; // ticks may cross; this is the typical case.
    case "perp":
      return 150_000n; // settlement is heavier.
  }
}

function zeroQuote(route: Route, amountIn: bigint, _ctx: RouterContext): RouteQuote {
  return {
    route,
    amountIn,
    amountOut: 0n,
    gasEstimate: BASE_OVERHEAD_GAS,
    netOut: 0n,
    perHop: [],
  };
}

/** Helper used by tests / debug: route description. */
export function describeRoute(route: Route, poolName?: (p: Pool) => string): string {
  const parts: string[] = [route.inputToken.slice(0, 6)];
  for (const hop of route.hops) {
    parts.push(`-[${poolName ? poolName(hop.pool) : hop.pool.id.slice(0, 6)}]->`);
    parts.push(hop.tokenOut.slice(0, 6));
  }
  return parts.join("");
}
