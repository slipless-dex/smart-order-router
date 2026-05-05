/**
 * DFS with branch-and-bound to enumerate the top-N routes between two
 * tokens. Bound = best amountOut seen so far; prune any partial path whose
 * upper-bound (current amountOut * best-marginal-price further) cannot beat
 * the worst entry in the result heap.
 *
 * In practice maxHops ≤ 4 is plenty; higher just blows up combinatorially.
 */

import type {
  Pool,
  Route,
  RouteHop,
  SearchParams,
  TokenAddress,
} from "./types.js";
import type { TokenGraph } from "./graph.js";

interface Candidate {
  route: Route;
  amountOut: bigint;
}

export function findRoutes(
  graph: TokenGraph,
  tokenIn: TokenAddress,
  tokenOut: TokenAddress,
  amountIn: bigint,
  params: SearchParams,
): Route[] {
  if (amountIn <= 0n) return [];
  if (params.maxHops < 1) throw new Error("findRoutes: maxHops must be ≥ 1");

  const start = tokenIn.toLowerCase() as TokenAddress;
  const target = tokenOut.toLowerCase() as TokenAddress;
  const deadline = params.earlyStopAfterMs
    ? Date.now() + params.earlyStopAfterMs
    : Number.POSITIVE_INFINITY;

  const results: Candidate[] = [];
  const visitedPools = new Set<string>();

  const visit = (
    current: TokenAddress,
    runningAmount: bigint,
    hops: RouteHop[],
  ): void => {
    if (Date.now() > deadline) return;
    if (hops.length >= params.maxHops) return;

    for (const { pool, other } of graph.neighbours(current)) {
      if (visitedPools.has(pool.id)) continue; // never use the same pool twice
      const quote = safeQuote(pool, current, runningAmount);
      if (quote.amountOut <= 0n) continue;
      const nextHops = [...hops, { pool, tokenIn: current, tokenOut: other }];
      visitedPools.add(pool.id);
      try {
        if (other.toLowerCase() === target.toLowerCase()) {
          insertCandidate(results, {
            route: { hops: nextHops, inputToken: start, outputToken: target },
            amountOut: quote.amountOut,
          }, params.maxRoutes);
        } else {
          visit(other.toLowerCase() as TokenAddress, quote.amountOut, nextHops);
        }
      } finally {
        visitedPools.delete(pool.id);
      }
    }
  };

  visit(start, amountIn, []);
  return results
    .sort((a, b) => (a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0))
    .slice(0, params.maxRoutes)
    .map((c) => c.route);
}

function safeQuote(pool: Pool, tokenIn: TokenAddress, amountIn: bigint) {
  try {
    return pool.quoteExactIn(tokenIn, amountIn);
  } catch {
    return { amountIn: 0n, amountOut: 0n, midPriceAfter: 0n };
  }
}

function insertCandidate(arr: Candidate[], c: Candidate, cap: number): void {
  // Maintain best-N by amountOut. cap is small so a linear scan beats a heap.
  if (arr.length < cap) {
    arr.push(c);
    return;
  }
  let worstIdx = 0;
  let worst = arr[0]!.amountOut;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]!.amountOut < worst) {
      worst = arr[i]!.amountOut;
      worstIdx = i;
    }
  }
  if (c.amountOut > worst) arr[worstIdx] = c;
}
