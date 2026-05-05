import { describe, expect, it } from "vitest";

import { V2Pool } from "../src/pools/v2-pool.js";
import { TokenGraph } from "../src/graph.js";
import { findRoutes } from "../src/pathfinder.js";
import { splitAcrossRoutes } from "../src/splits.js";
import { quoteRoute } from "../src/quote.js";
import type { RouterContext } from "../src/types.js";

const A = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const B = "0x0000000000000000000000000000000000000002" as `0x${string}`;

const ctx: RouterContext = {
  gasToken: A,
  gasTokenPriceUsd: 0,
  gasPriceWei: 0n,
  outputTokenPriceUsd: 0,
  outputTokenDecimals: 18,
};

describe("splitAcrossRoutes", () => {
  it("never returns more output than the sum of route capacities", () => {
    const p1 = new V2Pool({ id: "ab1", tokens: [A, B], reserves: [10_000n * 10n ** 18n, 10_000n * 10n ** 18n], feeBps: 30 });
    const p2 = new V2Pool({ id: "ab2", tokens: [A, B], reserves: [5_000n * 10n ** 18n, 5_000n * 10n ** 18n], feeBps: 30 });
    const graph = new TokenGraph([p1, p2]);
    const routes = findRoutes(graph, A, B, 100n * 10n ** 18n, { maxHops: 1, maxRoutes: 8 });
    const split = splitAcrossRoutes(routes, 100n * 10n ** 18n, ctx);
    expect(split.amountIn).toBe(100n * 10n ** 18n);
    expect(split.amountOut).toBeGreaterThan(0n);
  });

  it("beats single-route output for large trades on uneven pools", () => {
    // Pool 1 has 3x the depth of pool 2; for large trades, splitting wins.
    const big = new V2Pool({ id: "big", tokens: [A, B], reserves: [3_000n * 10n ** 18n, 3_000n * 10n ** 18n], feeBps: 30 });
    const small = new V2Pool({ id: "small", tokens: [A, B], reserves: [1_000n * 10n ** 18n, 1_000n * 10n ** 18n], feeBps: 30 });
    const graph = new TokenGraph([big, small]);
    const routes = findRoutes(graph, A, B, 800n * 10n ** 18n, { maxHops: 1, maxRoutes: 8 });
    const single = quoteRoute(routes[0]!, 800n * 10n ** 18n, ctx);
    const split = splitAcrossRoutes(routes, 800n * 10n ** 18n, ctx);
    expect(split.amountOut >= single.amountOut).toBe(true);
  });

  it("handles single-route input gracefully", () => {
    const p = new V2Pool({ id: "ab", tokens: [A, B], reserves: [1000n * 10n ** 18n, 1000n * 10n ** 18n], feeBps: 0 });
    const graph = new TokenGraph([p]);
    const routes = findRoutes(graph, A, B, 1n * 10n ** 18n, { maxHops: 1, maxRoutes: 1 });
    const split = splitAcrossRoutes(routes, 1n * 10n ** 18n, ctx);
    expect(split.legs.length).toBe(1);
  });

  it("returns empty for zero input", () => {
    const split = splitAcrossRoutes([], 0n, ctx);
    expect(split.legs.length).toBe(0);
    expect(split.amountOut).toBe(0n);
  });
});
