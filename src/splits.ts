/**
 * Multi-route splitting.
 *
 * The optimal allocation across N routes minimises total price impact,
 * which (for monotonic, concave amountOut functions) happens when the
 * marginal output rate is equal across routes. We approximate this with
 * discrete water-filling:
 *
 *   1. Divide amountIn into K equal "buckets".
 *   2. Repeat K times: assign the next bucket to whichever route has the
 *      highest marginal amountOut at its current allocation.
 *
 * `K` is the granularity knob; K=20 is a good default — fine enough for
 * sub-bp differences on real pools, coarse enough to stay sub-millisecond.
 */

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

  const bucketSize = amountIn / BigInt(buckets);
  // Route allocations.
  const alloc = routes.map(() => 0n);

  // Carry residual from integer division on the last bucket.
  let dust = amountIn - bucketSize * BigInt(buckets);

  for (let i = 0; i < buckets; i++) {
    const bucket = bucketSize + (i === buckets - 1 ? dust : 0n);
    if (bucket === 0n) continue;
    let bestRoute = -1;
    let bestMarginal = 0n;

    for (let r = 0; r < routes.length; r++) {
      const baseQ = alloc[r] === 0n
        ? 0n
        : quoteRoute(routes[r]!, alloc[r]!, ctx).amountOut;
      const trialAlloc = alloc[r]! + bucket;
      const trialQ = quoteRoute(routes[r]!, trialAlloc, ctx).amountOut;
      const marginal = trialQ - baseQ;
      if (marginal > bestMarginal) {
        bestMarginal = marginal;
        bestRoute = r;
      }
    }

    if (bestRoute === -1) break; // no route can absorb more.
    alloc[bestRoute] = alloc[bestRoute]! + bucket;
    dust = 0n; // already attached to the last bucket.
  }

  const legs = routes.map((route, r) => {
    const q = quoteRoute(route, alloc[r]!, ctx);
    return {
      route,
      amountIn: alloc[r]!,
      amountOut: q.amountOut,
      gasEstimate: q.gasEstimate,
    };
  }).filter((l) => l.amountIn > 0n);

  const totalIn = legs.reduce((s, l) => s + l.amountIn, 0n);
  const totalOut = legs.reduce((s, l) => s + l.amountOut, 0n);
  const totalGas = legs.reduce((s, l) => s + l.gasEstimate, 0n);
  const netOut = applyGasAdjustment(totalOut, totalGas, ctx);

  return { legs, amountIn: totalIn, amountOut: totalOut, gasEstimate: totalGas, netOut };
}
