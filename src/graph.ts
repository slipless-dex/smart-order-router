/**
 * Token graph. Each undirected edge is a pool; each node is a token.
 *
 * The graph stores pools indexed by token-pair so the pathfinder can
 * iterate neighbours in O(deg). We pre-sort each adjacency list by
 * descending liquidityScore so DFS visits high-quality pools first; this
 * is what makes branch-and-bound termination fast in practice.
 */

import type { Pool, TokenAddress } from "./types.js";

export class TokenGraph {
  /** token → list of (pool, otherToken) sorted by liquidity. */
  private readonly adj = new Map<TokenAddress, Array<{ pool: Pool; other: TokenAddress }>>();

  constructor(pools: readonly Pool[]) {
    for (const pool of pools) {
      const [a, b] = pool.tokens;
      this.push(a, pool, b);
      this.push(b, pool, a);
    }
    // Sort once.
    for (const list of this.adj.values()) {
      list.sort((x, y) => {
        const lx = x.pool.liquidityScore();
        const ly = y.pool.liquidityScore();
        return lx === ly ? 0 : lx < ly ? 1 : -1;
      });
    }
  }

  neighbours(token: TokenAddress): ReadonlyArray<{ pool: Pool; other: TokenAddress }> {
    return this.adj.get(token.toLowerCase() as TokenAddress) ?? [];
  }

  has(token: TokenAddress): boolean {
    return this.adj.has(token.toLowerCase() as TokenAddress);
  }

  private push(token: TokenAddress, pool: Pool, other: TokenAddress): void {
    const key = token.toLowerCase() as TokenAddress;
    let list = this.adj.get(key);
    if (!list) {
      list = [];
      this.adj.set(key, list);
    }
    list.push({ pool, other });
  }
}
