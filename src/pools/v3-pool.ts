// V3 concentrated liquidity, single-pool. SOR scope only — execution uses
// the on-chain quoter. Tick math here is float-based (Taylor expansion);
// relative error ~1e-6, fine for path selection.

import type { Pool, Quote, TokenAddress } from "../types.js";

const Q96 = 1n << 96n;
const ONE_E18 = 10n ** 18n;
const LN_1_0001 = 0.00009999500033330834;

export interface V3Tick {
  index: number;
  liquidityNet: bigint;
}

export interface V3PoolConfig {
  id: string;
  tokens: readonly [TokenAddress, TokenAddress];
  feeBps: number;
  tickSpacing: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  /** Ascending by index. */
  ticks: readonly V3Tick[];
}

export class V3Pool implements Pool {
  readonly kind = "v3" as const;
  readonly id: string;
  readonly tokens: readonly [TokenAddress, TokenAddress];
  readonly feeBps: number;
  readonly tickSpacing: number;

  private readonly token0Lower: string;
  private readonly sqrtPriceX96: bigint;
  private readonly liquidity: bigint;
  private readonly tick: number;
  private readonly ticks: readonly V3Tick[];

  constructor(cfg: V3PoolConfig) {
    this.id = cfg.id;
    this.tokens = cfg.tokens;
    this.feeBps = cfg.feeBps;
    this.tickSpacing = cfg.tickSpacing;
    this.token0Lower = cfg.tokens[0].toLowerCase();
    this.sqrtPriceX96 = cfg.sqrtPriceX96;
    this.liquidity = cfg.liquidity;
    this.tick = cfg.tick;
    this.ticks = cfg.ticks;
  }

  liquidityScore(): bigint {
    return (this.liquidity * this.sqrtPriceX96) / Q96;
  }

  quoteExactIn(tokenIn: TokenAddress, amountIn: bigint): Quote {
    if (amountIn <= 0n) return { amountIn: 0n, amountOut: 0n, midPriceAfter: 0n };

    const zeroForOne = tokenIn.toLowerCase() === this.token0Lower;
    if (!zeroForOne && tokenIn.toLowerCase() !== this.tokens[1].toLowerCase()) {
      throw new Error(`V3Pool ${this.id}: ${tokenIn} not in pool`);
    }

    let sqrtPriceX96 = this.sqrtPriceX96;
    let liquidity = this.liquidity;
    let tickIdx = this.activeTickIndex();
    let remaining = amountIn;
    let out = 0n;

    const fee = BigInt(this.feeBps);
    let safety = 0;

    while (remaining > 0n && liquidity > 0n && safety++ < 1024) {
      const next = zeroForOne ? this.ticks[tickIdx] : this.ticks[tickIdx + 1];
      if (!next) break;
      const sqrtTarget = tickToSqrtPriceX96(next.index);

      const step = computeStep({
        sqrtCurrent: sqrtPriceX96,
        sqrtTarget,
        liquidity,
        remaining,
        zeroForOne,
        feeBps: fee,
      });

      remaining -= step.amountIn;
      out += step.amountOut;
      sqrtPriceX96 = step.sqrtAfter;

      if (!step.exhausted) break;

      if (zeroForOne) {
        liquidity -= next.liquidityNet;
        tickIdx = indexOf(this.ticks, next.index) - 1;
      } else {
        liquidity += next.liquidityNet;
        tickIdx = indexOf(this.ticks, next.index);
      }
    }

    // mid = (sqrtP / 2^96)^2 in tokenOut/tokenIn 1e18 fp
    const priceAfter = (sqrtPriceX96 * sqrtPriceX96) / Q96;
    const midPriceAfter = zeroForOne
      ? (priceAfter * ONE_E18) / Q96
      : priceAfter === 0n ? 0n : (Q96 * ONE_E18) / priceAfter;

    return { amountIn: amountIn - remaining, amountOut: out, midPriceAfter };
  }

  /** Largest tick ≤ current. -1 if no ticks. */
  private activeTickIndex(): number {
    if (this.ticks.length === 0) return -1;
    let lo = 0;
    let hi = this.ticks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.ticks[mid]!.index <= this.tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

interface StepInputs {
  sqrtCurrent: bigint;
  sqrtTarget: bigint;
  liquidity: bigint;
  remaining: bigint;
  zeroForOne: boolean;
  feeBps: bigint;
}

interface StepOutputs {
  amountIn: bigint;
  amountOut: bigint;
  sqrtAfter: bigint;
  exhausted: boolean;
}

function computeStep(s: StepInputs): StepOutputs {
  const inAfterFee = (s.remaining * (10_000n - s.feeBps)) / 10_000n;
  const inToTarget = s.zeroForOne
    ? amount0Delta(s.sqrtTarget, s.sqrtCurrent, s.liquidity)
    : amount1Delta(s.sqrtCurrent, s.sqrtTarget, s.liquidity);

  if (inAfterFee >= inToTarget) {
    const outStep = s.zeroForOne
      ? amount1Delta(s.sqrtTarget, s.sqrtCurrent, s.liquidity)
      : amount0Delta(s.sqrtCurrent, s.sqrtTarget, s.liquidity);
    const inStep = (inToTarget * 10_000n) / (10_000n - s.feeBps) + 1n;
    return {
      amountIn: inStep > s.remaining ? s.remaining : inStep,
      amountOut: outStep,
      sqrtAfter: s.sqrtTarget,
      exhausted: true,
    };
  }

  const sqrtAfter = s.zeroForOne
    ? nextSqrtPriceFromInput0(s.sqrtCurrent, s.liquidity, inAfterFee)
    : nextSqrtPriceFromInput1(s.sqrtCurrent, s.liquidity, inAfterFee);
  const outStep = s.zeroForOne
    ? amount1Delta(sqrtAfter, s.sqrtCurrent, s.liquidity)
    : amount0Delta(s.sqrtCurrent, sqrtAfter, s.liquidity);
  return { amountIn: s.remaining, amountOut: outStep, sqrtAfter, exhausted: false };
}

function amount0Delta(lo: bigint, hi: bigint, L: bigint): bigint {
  if (lo === 0n || hi === 0n) return 0n;
  return ((L << 96n) * (hi - lo)) / (hi * lo);
}

function amount1Delta(lo: bigint, hi: bigint, L: bigint): bigint {
  return (L * (hi - lo)) / Q96;
}

function nextSqrtPriceFromInput0(sqrtP: bigint, L: bigint, amount: bigint): bigint {
  return (L * sqrtP) / (L + (amount * sqrtP) / Q96);
}

function nextSqrtPriceFromInput1(sqrtP: bigint, L: bigint, amount: bigint): bigint {
  return sqrtP + (amount * Q96) / L;
}

function tickToSqrtPriceX96(tick: number): bigint {
  const sqrt = Math.exp((tick * LN_1_0001) / 2);
  const scaled = sqrt * Number(Q96);
  if (!Number.isFinite(scaled)) throw new Error(`tickToSqrtPriceX96: tick ${tick} out of range`);
  return BigInt(Math.floor(scaled));
}

function indexOf(ticks: readonly V3Tick[], index: number): number {
  for (let i = 0; i < ticks.length; i++) if (ticks[i]!.index === index) return i;
  return -1;
}
