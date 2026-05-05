<div align="center">
  <a href="https://slipless.xyz">
    <img src=".github/logo.svg" width="140" alt="Slipless" />
  </a>
</div>

<h1 align="center">@slipless/smart-order-router</h1>

<p align="center"><strong>Pathfinder + multi-route splitter across V2 / V3 / perp pools. Gas-adjusted scoring.</strong></p>

<p align="center">
  <a href="https://github.com/slipless-dex/smart-order-router/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/slipless-dex/smart-order-router/ci.yml?branch=main&style=flat-square&color=5cd8ff&label=ci"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-ff6bdb?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@slipless/smart-order-router"><img alt="npm" src="https://img.shields.io/npm/v/@slipless/smart-order-router?style=flat-square&color=b965ff&label=npm"></a>
</p>

<p align="center">
  <a href="https://slipless.xyz">Site</a> &middot;
  <a href="https://app.slipless.xyz">App</a> &middot;
  <a href="https://docs.slipless.xyz">Docs</a> &middot;
  <a href="https://twitter.com/slipless">Twitter</a>
</p>

---

Smart-order router for Slipless. Discovers the best path between two tokens across V2-style, V3-style, and perp-orderbook pools, splits across routes when worthwhile, and gas-adjusts the score.

## Architecture

```
Pool (interface)
  ├── V2Pool          xy = k math
  ├── V3Pool          concentrated liquidity, walks ticks
  └── PerpMarket      sweeps an orderbook level by level

TokenGraph              undirected, adjacency sorted by liquidity
  ↓
findRoutes              DFS with branch-and-bound, top-N best routes
  ↓
quoteRoute              end-to-end pipeline + gas-adjusted score
  ↓
splitAcrossRoutes       discrete water-filling across the top N routes
  ↓
SmartOrderRouter        wires it together with an LRU+TTL cache
```

The router never mutates pools — `quoteExactIn` is pure. That property is what lets us safely recurse during pathfinding and call the same pool dozens of times during splitting.

## Quick start

```ts
import {
  SmartOrderRouter, V2Pool, V3Pool, PerpMarket,
} from "@slipless/smart-order-router";

const router = new SmartOrderRouter({
  pools: [
    new V2Pool({ id: "0xabc...", tokens: [USDC, WETH], reserves: [...], feeBps: 30 }),
    new V3Pool({ id: "0xdef...", tokens: [USDC, WETH], ... }),
    new PerpMarket({ id: "ETH-PERP", tokens: [USDC, WETH], asks, bids, takerFeeBps: 5 }),
  ],
});

const out = router.quote({
  tokenIn: USDC,
  tokenOut: WETH,
  amountIn: 100_000_000_000n,    // 100 000 USDC (6 decimals)
  context: {
    gasToken: WETH,
    gasTokenPriceUsd: 3_000,
    gasPriceWei: 50_000_000n,    // 0.05 gwei (rollup)
    outputTokenPriceUsd: 3_000,
    outputTokenDecimals: 18,
  },
});

console.log(out.recommended); // best single route OR a multi-route split
```

## Why split across routes?

For a deep pool, single-route execution is optimal. For *uneven* depth (e.g. one big V3 pool plus a few V2 pools), splitting equates marginal output rates and beats single-route output for trades above ~1% of the deepest pool. The water-filling heuristic in `splits.ts` converges in K iterations (default 20).

## Performance

- **Pathfinding** is bounded by `maxHops` (default 3) and `maxRoutes` (default 8). Adjacency lists are pre-sorted by liquidity so high-quality candidates dominate the search early.
- **Caching** is LRU+TTL keyed on `(tokenIn, tokenOut, amountInBucketed)` with a 2s TTL — appropriate for L2 block times.
- **No I/O** in any quote function. Run this in a worker, on the edge, in a Lambda — wherever.

## License

MIT © Slipless Labs
