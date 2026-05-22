import type {
  Pool,
  Quote,
  Route,
  RouteHop,
  RouteQuote,
  RouterContext,
  TokenAddress,
} from "./types.js";

const BASE_OVERHEAD_GAS = 60_000n;

export function quoteRoute(route: Route, amountIn: bigint, ctx: RouterContext): RouteQuote {
  if (route.hops.length === 0) throw new Error("quoteRoute: empty route");

  const perHop: Quote[] = [];
  let cur = amountIn;
  let gas = BASE_OVERHEAD_GAS;
  let activeIn: TokenAddress = route.inputToken;

  for (const hop of route.hops) {
    const q = hop.pool.quoteExactIn(activeIn, cur);
    perHop.push(q);
    if (q.amountOut === 0n) return zeroQuote(route, amountIn);
    cur = q.amountOut;
    activeIn = hop.tokenOut;
    gas += hopGas(hop) + (q.gasEstimate ?? 0n);
  }

  return {
    route,
    amountIn,
    amountOut: cur,
    gasEstimate: gas,
    netOut: applyGasAdjustment(cur, gas, ctx),
    perHop,
  };
}

/** Floats here because sub-wei precision in gas estimation is meaningless. */
export function applyGasAdjustment(amountOut: bigint, gas: bigint, ctx: RouterContext): bigint {
  if (ctx.gasPriceWei === 0n || gas === 0n || ctx.outputTokenPriceUsd === 0) return amountOut;
  const gasUsd = (Number(gas) * Number(ctx.gasPriceWei) * ctx.gasTokenPriceUsd) / 1e18;
  if (!Number.isFinite(gasUsd)) return amountOut;
  const inOut = (gasUsd / ctx.outputTokenPriceUsd) * 10 ** ctx.outputTokenDecimals;
  if (!Number.isFinite(inOut)) return amountOut;
  const cost = BigInt(Math.floor(Math.max(0, inOut)));
  return amountOut > cost ? amountOut - cost : 0n;
}

function hopGas(hop: RouteHop): bigint {
  switch (hop.pool.kind) {
    case "v2":   return 60_000n;
    case "v3":   return 90_000n;
    case "perp": return 150_000n;
  }
}

function zeroQuote(route: Route, amountIn: bigint): RouteQuote {
  return {
    route,
    amountIn,
    amountOut: 0n,
    gasEstimate: BASE_OVERHEAD_GAS,
    netOut: 0n,
    perHop: [],
  };
}

export function describeRoute(route: Route, poolName?: (p: Pool) => string): string {
  const parts: string[] = [route.inputToken.slice(0, 6)];
  for (const hop of route.hops) {
    parts.push(`-[${poolName ? poolName(hop.pool) : hop.pool.id.slice(0, 6)}]->`);
    parts.push(hop.tokenOut.slice(0, 6));
  }
  return parts.join("");
}
