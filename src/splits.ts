// Discrete water-filling. K buckets; each bucket goes to the route with the
// best marginal output. K=20 is sub-millisecond and converges to sub-bp.

import type { Route, RouterContext, SplitQuote } from "./types.js";
import { quoteRoute, applyGasAdjustment } from "./quote.js";

const DEFAULT_BUCKETS = 20;

export function splitAcrossRoutes(
  routes: readonly Route[],
  amountIn: bigint,
  ctx: RouterContext,
  buckets = DEFAULT_BUCKETS,
): SplitQuote {
  if (routes.length === 0 || amountIn <= 0n) {
    return { legs: [], amountIn, amountOut: 0n, gasEstimate: 0n, netOut: 0n };
  }
  if (buckets < 1) buckets = 1;

  const K = BigInt(buckets);
  const bucketSize = amountIn / K;
  const dust = amountIn - bucketSize * K;
  const alloc = routes.map(() => 0n);
  const baseOut = routes.map(() => 0n);

  for (let i = 0; i < buckets; i++) {
    const bucket = bucketSize + (i === buckets - 1 ? dust : 0n);
    if (bucket === 0n) continue;

    let bestRoute = -1;
    let bestMarginal = 0n;
    for (let r = 0; r < routes.length; r++) {
      const trial = quoteRoute(routes[r]!, alloc[r]! + bucket, ctx).amountOut;
      const marginal = trial - baseOut[r]!;
      if (marginal > bestMarginal) {
        bestMarginal = marginal;
        bestRoute = r;
      }
    }
    if (bestRoute === -1) break;
    alloc[bestRoute] = alloc[bestRoute]! + bucket;
    baseOut[bestRoute] = baseOut[bestRoute]! + bestMarginal;
  }

  const legs = routes
    .map((route, r) => {
      const a = alloc[r]!;
      if (a === 0n) return null;
      const q = quoteRoute(route, a, ctx);
      return { route, amountIn: a, amountOut: q.amountOut, gasEstimate: q.gasEstimate };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  let totalIn = 0n, totalOut = 0n, totalGas = 0n;
  for (const l of legs) {
    totalIn += l.amountIn;
    totalOut += l.amountOut;
    totalGas += l.gasEstimate;
  }
  return {
    legs,
    amountIn: totalIn,
    amountOut: totalOut,
    gasEstimate: totalGas,
    netOut: applyGasAdjustment(totalOut, totalGas, ctx),
  };
}
