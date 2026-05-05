import { describe, expect, it } from "vitest";
import { V2Pool } from "../src/pools/v2-pool.js";

const A = "0x0000000000000000000000000000000000000001";
const B = "0x0000000000000000000000000000000000000002";

describe("V2Pool", () => {
  it("recovers the canonical formula y_out = y * dx*(1-f) / (x + dx*(1-f))", () => {
    const pool = new V2Pool({
      id: "ab30",
      tokens: [A, B],
      reserves: [1000n * 10n ** 18n, 1000n * 10n ** 18n],
      feeBps: 30,
    });
    const q = pool.quoteExactIn(A, 100n * 10n ** 18n);
    // Manually computed: x=1000, y=1000, dx=100, f=0.003
    //   inAfterFee = 100*9970/10000 = 99.7
    //   y_out = 1000*99.7 / (1000+99.7) ≈ 90.6611...
    expect(q.amountOut).toBeGreaterThan(90n * 10n ** 18n);
    expect(q.amountOut).toBeLessThan(91n * 10n ** 18n);
  });

  it("is monotonic in input", () => {
    const pool = new V2Pool({
      id: "ab30",
      tokens: [A, B],
      reserves: [1_000_000n * 10n ** 18n, 1_000_000n * 10n ** 18n],
      feeBps: 30,
    });
    const q1 = pool.quoteExactIn(A, 1n * 10n ** 18n);
    const q2 = pool.quoteExactIn(A, 100n * 10n ** 18n);
    const q3 = pool.quoteExactIn(A, 10_000n * 10n ** 18n);
    expect(q1.amountOut < q2.amountOut).toBe(true);
    expect(q2.amountOut < q3.amountOut).toBe(true);
  });

  it("has decreasing marginal output (concavity)", () => {
    const pool = new V2Pool({
      id: "ab30",
      tokens: [A, B],
      reserves: [1_000n * 10n ** 18n, 1_000n * 10n ** 18n],
      feeBps: 30,
    });
    // Marginal = (q(2x) - q(x)) for incrementing x.
    const q100 = pool.quoteExactIn(A, 100n * 10n ** 18n).amountOut;
    const q200 = pool.quoteExactIn(A, 200n * 10n ** 18n).amountOut;
    const q300 = pool.quoteExactIn(A, 300n * 10n ** 18n).amountOut;
    // Marginal contribution should shrink with size:
    expect(q200 - q100).toBeGreaterThan(q300 - q200);
  });

  it("rejects unknown tokens", () => {
    const pool = new V2Pool({
      id: "ab30",
      tokens: [A, B],
      reserves: [10n, 10n],
      feeBps: 0,
    });
    expect(() => pool.quoteExactIn("0x0000000000000000000000000000000000000099", 1n)).toThrow();
  });

  it("returns zero for zero input", () => {
    const pool = new V2Pool({
      id: "ab30",
      tokens: [A, B],
      reserves: [10n, 10n],
      feeBps: 0,
    });
    const q = pool.quoteExactIn(A, 0n);
    expect(q.amountIn).toBe(0n);
    expect(q.amountOut).toBe(0n);
  });
});
