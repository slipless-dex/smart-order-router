import { describe, expect, it, vi } from "vitest";
import { LruTtlCache } from "../src/cache.js";

describe("LruTtlCache", () => {
  it("evicts oldest beyond capacity", () => {
    const c = new LruTtlCache<string, number>(2, 60_000);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  it("touches recency on get", () => {
    const c = new LruTtlCache<string, number>(2, 60_000);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now most recent
    c.set("c", 3);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
  });

  it("respects ttl", () => {
    vi.useFakeTimers();
    const c = new LruTtlCache<string, number>(8, 1_000);
    c.set("a", 1);
    vi.advanceTimersByTime(500);
    expect(c.get("a")).toBe(1);
    vi.advanceTimersByTime(600);
    expect(c.get("a")).toBeUndefined();
    vi.useRealTimers();
  });
});
