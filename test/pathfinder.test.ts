import { describe, expect, it } from "vitest";

import { V2Pool } from "../src/pools/v2-pool.js";
import { TokenGraph } from "../src/graph.js";
import { findRoutes } from "../src/pathfinder.js";

const A = "0x0000000000000000000000000000000000000001";
const B = "0x0000000000000000000000000000000000000002";
const C = "0x0000000000000000000000000000000000000003";
const D = "0x0000000000000000000000000000000000000004";

function bigPool(id: string, tokens: [string, string]) {
  return new V2Pool({
    id,
    tokens: [tokens[0] as `0x${string}`, tokens[1] as `0x${string}`],
    reserves: [10_000n * 10n ** 18n, 10_000n * 10n ** 18n],
    feeBps: 30,
  });
}

describe("findRoutes", () => {
  it("finds a direct route", () => {
    const graph = new TokenGraph([bigPool("ab", [A, B])]);
    const routes = findRoutes(graph, A, B, 1n * 10n ** 18n, { maxHops: 3, maxRoutes: 8 });
    expect(routes.length).toBe(1);
    expect(routes[0]!.hops.length).toBe(1);
  });

  it("finds two-hop routes through hub tokens", () => {
    const graph = new TokenGraph([
      bigPool("ac", [A, C]),
      bigPool("cb", [C, B]),
    ]);
    const routes = findRoutes(graph, A, B, 1n * 10n ** 18n, { maxHops: 3, maxRoutes: 8 });
    expect(routes.length).toBe(1);
    expect(routes[0]!.hops.length).toBe(2);
  });

  it("never repeats a pool within the same route", () => {
    const graph = new TokenGraph([
      bigPool("ab", [A, B]),
      bigPool("ab2", [A, B]),
    ]);
    const routes = findRoutes(graph, A, B, 1n * 10n ** 18n, { maxHops: 3, maxRoutes: 8 });
    for (const r of routes) {
      const ids = r.hops.map((h) => h.pool.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("returns multiple distinct routes when available", () => {
    const graph = new TokenGraph([
      bigPool("ab1", [A, B]),
      bigPool("ac", [A, C]),
      bigPool("cb", [C, B]),
      bigPool("ad", [A, D]),
      bigPool("db", [D, B]),
    ]);
    const routes = findRoutes(graph, A, B, 1n * 10n ** 18n, { maxHops: 3, maxRoutes: 8 });
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  it("respects maxHops", () => {
    // A → C → D → B is 3-hop; with maxHops=2 it should not appear.
    const graph = new TokenGraph([
      bigPool("ac", [A, C]),
      bigPool("cd", [C, D]),
      bigPool("db", [D, B]),
    ]);
    const routes = findRoutes(graph, A, B, 1n * 10n ** 18n, { maxHops: 2, maxRoutes: 8 });
    expect(routes.length).toBe(0);
  });

  it("returns [] when no path exists", () => {
    const graph = new TokenGraph([bigPool("ac", [A, C])]);
    const routes = findRoutes(graph, A, B, 1n * 10n ** 18n, { maxHops: 3, maxRoutes: 8 });
    expect(routes).toEqual([]);
  });
});
