import { describe, expect, it } from "vitest";

import { SmartOrderRouter } from "../src/router.js";
import { V2Pool } from "../src/pools/v2-pool.js";
import type { RouterContext } from "../src/types.js";

const A = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const B = "0x0000000000000000000000000000000000000002" as `0x${string}`;
const C = "0x0000000000000000000000000000000000000003" as `0x${string}`;

const ctx: RouterContext = {
  gasToken: A,
  gasTokenPriceUsd: 3000,
  gasPriceWei: 50_000_000n, // 0.05 gwei
  outputTokenPriceUsd: 1,
  outputTokenDecimals: 18,
};

describe("SmartOrderRouter", () => {
  it("returns the recommended quote", () => {
    const router = new SmartOrderRouter({
      pools: [
        new V2Pool({ id: "ab", tokens: [A, B], reserves: [1000n * 10n ** 18n, 1000n * 10n ** 18n], feeBps: 30 }),
        new V2Pool({ id: "ac", tokens: [A, C], reserves: [1000n * 10n ** 18n, 1000n * 10n ** 18n], feeBps: 30 }),
        new V2Pool({ id: "cb", tokens: [C, B], reserves: [1000n * 10n ** 18n, 1000n * 10n ** 18n], feeBps: 30 }),
      ],
    });
    const out = router.quote({
      tokenIn: A,
      tokenOut: B,
      amountIn: 10n * 10n ** 18n,
      context: ctx,
    });
    expect(out.best.amountOut).toBeGreaterThan(0n);
    expect(out.recommended).toBeDefined();
  });

  it("returns an empty response when no path exists", () => {
    const router = new SmartOrderRouter({
      pools: [
        new V2Pool({ id: "ac", tokens: [A, C], reserves: [10n, 10n], feeBps: 0 }),
      ],
    });
    const out = router.quote({
      tokenIn: A,
      tokenOut: B,
      amountIn: 1n,
      context: ctx,
    });
    expect(out.best.amountOut).toBe(0n);
    expect(out.alternatives).toEqual([]);
    expect(out.split).toBeUndefined();
  });

  it("caches identical requests", () => {
    const router = new SmartOrderRouter({
      pools: [
        new V2Pool({ id: "ab", tokens: [A, B], reserves: [1000n * 10n ** 18n, 1000n * 10n ** 18n], feeBps: 30 }),
      ],
    });
    const r1 = router.quote({ tokenIn: A, tokenOut: B, amountIn: 1_000_000n, context: ctx });
    const r2 = router.quote({ tokenIn: A, tokenOut: B, amountIn: 1_000_000n, context: ctx });
    expect(r1).toBe(r2);
  });
});
