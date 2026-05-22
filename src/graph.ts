import type { Pool, TokenAddress } from "./types.js";

interface Edge { pool: Pool; other: TokenAddress }

export class TokenGraph {
  private readonly adj = new Map<string, Edge[]>();

  constructor(pools: readonly Pool[]) {
    for (const pool of pools) {
      const [a, b] = pool.tokens;
      this.push(a, pool, b);
      this.push(b, pool, a);
    }
    // High-liquidity neighbours first → DFS prunes faster.
    for (const list of this.adj.values()) {
      list.sort((x, y) => {
        const lx = x.pool.liquidityScore();
        const ly = y.pool.liquidityScore();
        return lx === ly ? 0 : lx < ly ? 1 : -1;
      });
    }
  }

  neighbours(token: TokenAddress): ReadonlyArray<Edge> {
    return this.adj.get(token.toLowerCase()) ?? [];
  }

  has(token: TokenAddress): boolean {
    return this.adj.has(token.toLowerCase());
  }

  private push(token: TokenAddress, pool: Pool, other: TokenAddress): void {
    const key = token.toLowerCase();
    let list = this.adj.get(key);
    if (!list) {
      list = [];
      this.adj.set(key, list);
    }
    list.push({ pool, other });
  }
}
