import type {
  Pool,
  Route,
  RouteQuote,
  RouterContext,
  SearchParams,
  SplitQuote,
  TokenAddress,
} from "./types.js";
import { TokenGraph } from "./graph.js";
import { findRoutes } from "./pathfinder.js";
import { quoteRoute } from "./quote.js";
import { splitAcrossRoutes } from "./splits.js";
import { LruTtlCache } from "./cache.js";

export interface SmartOrderRouterOptions {
  pools: readonly Pool[];
  cacheTtlMs?: number;
  cacheCapacity?: number;
}

export interface QuoteRequest {
  tokenIn: TokenAddress;
  tokenOut: TokenAddress;
  amountIn: bigint;
  enableSplits?: boolean;
  search?: Partial<SearchParams>;
  context: RouterContext;
}

export interface QuoteResponse {
  best: RouteQuote;
  alternatives: RouteQuote[];
  split?: SplitQuote;
  recommended: RouteQuote | SplitQuote;
}

export class SmartOrderRouter {
  private readonly graph: TokenGraph;
  private readonly cache: LruTtlCache<string, QuoteResponse>;

  constructor(opts: SmartOrderRouterOptions) {
    this.graph = new TokenGraph(opts.pools);
    this.cache = new LruTtlCache(opts.cacheCapacity ?? 1024, opts.cacheTtlMs ?? 2_000);
  }

  quote(req: QuoteRequest): QuoteResponse {
    const cacheKey = this.cacheKey(req);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const params: SearchParams = {
      maxHops: req.search?.maxHops ?? 3,
      maxRoutes: req.search?.maxRoutes ?? 8,
      ...(req.search?.earlyStopAfterMs !== undefined && {
        earlyStopAfterMs: req.search.earlyStopAfterMs,
      }),
    };

    const routes = findRoutes(this.graph, req.tokenIn, req.tokenOut, req.amountIn, params);
    if (routes.length === 0) return this.cacheAndReturn(cacheKey, emptyResponse(req));

    const quotes = routes
      .map((r) => quoteRoute(r, req.amountIn, req.context))
      .filter((q) => q.amountOut > 0n)
      .sort((a, b) => (a.netOut > b.netOut ? -1 : a.netOut < b.netOut ? 1 : 0));

    if (quotes.length === 0) return this.cacheAndReturn(cacheKey, emptyResponse(req));

    const best = quotes[0]!;
    const alternatives = quotes.slice(1);

    let split: SplitQuote | undefined;
    if ((req.enableSplits ?? true) && quotes.length >= 2) {
      const trial = splitAcrossRoutes(
        quotes.slice(0, Math.min(4, quotes.length)).map((q) => q.route),
        req.amountIn,
        req.context,
      );
      if (trial.netOut > best.netOut) split = trial;
    }

    const response: QuoteResponse = {
      best,
      alternatives,
      ...(split !== undefined && { split }),
      recommended: split ?? best,
    };
    return this.cacheAndReturn(cacheKey, response);
  }

  /** Bucket amount by 0.1% so neighbouring requests hit the cache. */
  private cacheKey(req: QuoteRequest): string {
    const bucketed = (req.amountIn / 1000n) * 1000n;
    return `${req.tokenIn.toLowerCase()}|${req.tokenOut.toLowerCase()}|${bucketed}`;
  }

  private cacheAndReturn(key: string, response: QuoteResponse): QuoteResponse {
    this.cache.set(key, response);
    return response;
  }
}

function emptyResponse(req: QuoteRequest): QuoteResponse {
  const empty: RouteQuote = {
    route: { hops: [], inputToken: req.tokenIn, outputToken: req.tokenOut },
    amountIn: req.amountIn,
    amountOut: 0n,
    gasEstimate: 0n,
    netOut: 0n,
    perHop: [],
  };
  return { best: empty, alternatives: [], recommended: empty };
}
