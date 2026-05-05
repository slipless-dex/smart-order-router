/**
 * Concentrated-liquidity pool (UniswapV3-style).
 *
 *     price = (sqrtPriceX96 / 2^96)^2     (token1/token0)
 *     L     = liquidity active at the current tick
 *
 * Swapping crosses ticks: each tick may add/remove `liquidityNet`. Inside a
 * single tick, the relationship between sqrtPrice and reserves is
 *
 *     ΔX = L * (1/sqrtP_lo - 1/sqrtP_hi)
 *     ΔY = L * (sqrtP_hi - sqrtP_lo)
 *
 * We implement only the parts the SOR needs to quote a single-pool swap.
 * No collected-fees, no protocol fees, no overflow checks beyond what the
 * algorithm requires — keep this auditable. For execution the integrator
 * calls the on-chain quoter; this is for *path selection*.
 */

import type { Pool, Quote, TokenAddress } from "../types.js";

const Q96 = 1n << 96n;
const ONE_E18 = 10n ** 18n;

export interface V3Tick {
  /** Tick index. Must be a multiple of `tickSpacing`. */
  index: number;
  /** Net liquidity that activates when crossing left-to-right; `liquidityNet`. */
  liquidityNet: bigint;
}

export interface V3PoolConfig {
  id: string;
  tokens: readonly [TokenAddress, TokenAddress];
  feeBps: number;          // e.g. 5 = 0.05%
  tickSpacing: number;
  sqrtPriceX96: bigint;    // current price
  liquidity: bigint;       // active L
  tick: number;            // current tick
  /** Sorted ascending by index, including the current tick if liquidityNet ≠ 0. */
  ticks: readonly V3Tick[];
}

export class V3Pool implements Pool {
  readonly kind = "v3" as const;
  readonly id: string;
  readonly tokens: readonly [TokenAddress, TokenAddress];
  readonly feeBps: number;
  readonly tickSpacing: number;

  private sqrtPriceX96: bigint;
  private liquidity: bigint;
  private tick: number;
  private readonly ticks: V3Tick[];

  constructor(cfg: V3PoolConfig) {
    this.id = cfg.id;
    this.tokens = cfg.tokens;
    this.feeBps = cfg.feeBps;
    this.tickSpacing = cfg.tickSpacing;
    this.sqrtPriceX96 = cfg.sqrtPriceX96;
    this.liquidity = cfg.liquidity;
    this.tick = cfg.tick;
    this.ticks = [...cfg.ticks];
  }

  liquidityScore(): bigint {
    // Use *current* L scaled by sqrt-price as a rough notional.
    const sqrtP = this.sqrtPriceX96;
    return (this.liquidity * sqrtP) / Q96;
  }

  quoteExactIn(tokenIn: TokenAddress, amountIn: bigint): Quote {
    if (amountIn <= 0n) return { amountIn: 0n, amountOut: 0n, midPriceAfter: 0n };

    const zeroForOne = tokenIn.toLowerCase() === this.tokens[0].toLowerCase();
    if (!zeroForOne && tokenIn.toLowerCase() !== this.tokens[1].toLowerCase()) {
      throw new Error(`V3Pool ${this.id}: token ${tokenIn} not in pool`);
    }

    // Snapshot — quoting must not mutate.
    let sqrtPriceX96 = this.sqrtPriceX96;
    let liquidity = this.liquidity;
    let tickIdx = this.indexOfActiveTick();

    let amountRemaining = amountIn;
    let amountOut = 0n;

    const feeBps = BigInt(this.feeBps);
    let safety = 0;

    while (amountRemaining > 0n && liquidity > 0n) {
      if (++safety > 1024) break; // pathological pools — fail soft.

      const nextTick = zeroForOne
        ? this.previousTick(tickIdx)
        : this.nextTick(tickIdx);
      if (!nextTick) break;

      const sqrtPriceNextX96 = tickToSqrtPriceX96(nextTick.index);

      // Step within the current tick: how much amountIn does the full
      // step consume, and how much amountOut does it yield?
      const { amountInStep, amountOutStep, sqrtPriceAfter, exhausted } =
        computeStep({
          sqrtPriceCurrentX96: sqrtPriceX96,
          sqrtPriceTargetX96: sqrtPriceNextX96,
          liquidity,
          amountInRemaining: amountRemaining,
          zeroForOne,
          feeBps,
        });

      amountRemaining -= amountInStep;
      amountOut += amountOutStep;
      sqrtPriceX96 = sqrtPriceAfter;

      if (exhausted) {
        // Cross the tick: update active liquidity.
        if (zeroForOne) {
          liquidity -= nextTick.liquidityNet;
          tickIdx = this.indexOfTick(nextTick.index) - 1;
        } else {
          liquidity += nextTick.liquidityNet;
          tickIdx = this.indexOfTick(nextTick.index);
        }
      } else {
        break; // step ran out of amountIn before reaching the next tick.
      }
    }

    // Marginal price after, expressed in tokenOut/tokenIn 1e18 fp.
    const priceAfter = (sqrtPriceX96 * sqrtPriceX96) / Q96; // *2^96 / 2^96 net; readability comment below.
    const midPriceAfter = zeroForOne
      ? (priceAfter * ONE_E18) / Q96 // token1/token0
      : (Q96 * ONE_E18) / priceAfter; // invert for token0/token1

    return {
      amountIn: amountIn - amountRemaining,
      amountOut,
      midPriceAfter,
    };
  }

  private indexOfActiveTick(): number {
    // Index into `ticks` of the largest tick ≤ current tick.
    let lo = 0;
    let hi = this.ticks.length - 1;
    if (hi < 0) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.ticks[mid]!.index <= this.tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private indexOfTick(index: number): number {
    return this.ticks.findIndex((t) => t.index === index);
  }

  private previousTick(fromIndex: number): V3Tick | undefined {
    return this.ticks[fromIndex];
  }
  private nextTick(fromIndex: number): V3Tick | undefined {
    return this.ticks[fromIndex + 1];
  }
}

interface StepInputs {
  sqrtPriceCurrentX96: bigint;
  sqrtPriceTargetX96: bigint;
  liquidity: bigint;
  amountInRemaining: bigint;
  zeroForOne: boolean;
  feeBps: bigint;
}

interface StepOutputs {
  amountInStep: bigint;
  amountOutStep: bigint;
  sqrtPriceAfter: bigint;
  /** True iff the step consumed all the way to the target. */
  exhausted: boolean;
}

/**
 * Walk a single tick. Closed-form math; cribbed from the V3 white paper
 * §6 with fee applied on the input side as `amountIn * (1 - feeBps)`.
 */
function computeStep(s: StepInputs): StepOutputs {
  const inAfterFee = (s.amountInRemaining * (10_000n - s.feeBps)) / 10_000n;

  // Amount needed to move sqrtPrice fully from current → target.
  const amountInToReachTarget = s.zeroForOne
    ? amount0Delta(s.sqrtPriceTargetX96, s.sqrtPriceCurrentX96, s.liquidity)
    : amount1Delta(s.sqrtPriceCurrentX96, s.sqrtPriceTargetX96, s.liquidity);

  if (inAfterFee >= amountInToReachTarget) {
    // Full step: exhaust to the target.
    const amountOutStep = s.zeroForOne
      ? amount1Delta(s.sqrtPriceTargetX96, s.sqrtPriceCurrentX96, s.liquidity)
      : amount0Delta(s.sqrtPriceCurrentX96, s.sqrtPriceTargetX96, s.liquidity);
    // Pre-fee equivalent of the consumed input.
    const amountInStep = (amountInToReachTarget * 10_000n) / (10_000n - s.feeBps) + 1n;
    return {
      amountInStep: amountInStep > s.amountInRemaining ? s.amountInRemaining : amountInStep,
      amountOutStep,
      sqrtPriceAfter: s.sqrtPriceTargetX96,
      exhausted: true,
    };
  }

  // Partial step: solve for the new sqrtPrice that absorbs `inAfterFee`.
  const sqrtPriceAfter = s.zeroForOne
    ? nextSqrtPriceFromInput0(s.sqrtPriceCurrentX96, s.liquidity, inAfterFee)
    : nextSqrtPriceFromInput1(s.sqrtPriceCurrentX96, s.liquidity, inAfterFee);
  const amountOutStep = s.zeroForOne
    ? amount1Delta(sqrtPriceAfter, s.sqrtPriceCurrentX96, s.liquidity)
    : amount0Delta(s.sqrtPriceCurrentX96, sqrtPriceAfter, s.liquidity);
  return {
    amountInStep: s.amountInRemaining,
    amountOutStep,
    sqrtPriceAfter,
    exhausted: false,
  };
}

/** ΔX in token0 between two sqrt-prices (lo < hi). Always positive. */
function amount0Delta(sqrtLoX96: bigint, sqrtHiX96: bigint, L: bigint): bigint {
  if (sqrtLoX96 === 0n || sqrtHiX96 === 0n) return 0n;
  const num = (L << 96n) * (sqrtHiX96 - sqrtLoX96);
  const den = sqrtHiX96 * sqrtLoX96;
  return num / den;
}

/** ΔY in token1 between two sqrt-prices (lo < hi). Always positive. */
function amount1Delta(sqrtLoX96: bigint, sqrtHiX96: bigint, L: bigint): bigint {
  return (L * (sqrtHiX96 - sqrtLoX96)) / Q96;
}

/** Solve for sqrtPrice after consuming `amount` of token0. */
function nextSqrtPriceFromInput0(sqrtPX96: bigint, L: bigint, amountIn: bigint): bigint {
  // sqrtP_new = L * sqrtP / (L + amountIn * sqrtP / 2^96)
  const numerator = L * sqrtPX96;
  const denominator = L + (amountIn * sqrtPX96) / Q96;
  return numerator / denominator;
}

/** Solve for sqrtPrice after consuming `amount` of token1. */
function nextSqrtPriceFromInput1(sqrtPX96: bigint, L: bigint, amountIn: bigint): bigint {
  // sqrtP_new = sqrtP + amountIn * 2^96 / L
  return sqrtPX96 + (amountIn * Q96) / L;
}

/**
 * Compute sqrtPriceX96 for a given tick. Lossy for our purposes — we use
 * the Taylor series around 1.0001^(tick/2) good to ~1e-6 relative error,
 * which is more than sufficient for path selection.
 *
 * For execution, callers must use the on-chain TickMath.getSqrtRatioAtTick.
 */
function tickToSqrtPriceX96(tick: number): bigint {
  // 1.0001^(tick/2) ≈ exp(tick * ln(1.0001) / 2)
  const ln10001 = 0.00009999500033330834; // ln(1.0001)
  const sqrt = Math.exp((tick * ln10001) / 2);
  // Multiply by 2^96 with Math.* care; 2^96 ≈ 7.92e28.
  const Q = Number(Q96);
  const scaled = sqrt * Q;
  if (!Number.isFinite(scaled)) {
    throw new Error(`tickToSqrtPriceX96: tick ${tick} out of range`);
  }
  return BigInt(Math.floor(scaled));
}
