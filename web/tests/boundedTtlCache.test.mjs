import assert from "node:assert/strict";
import test from "node:test";
import { BoundedTtlCache } from "../lib/cache/boundedTtlCache.ts";

test("keeps the cache within its hard entry limit", () => {
  let now = 1_000;
  const cache = new BoundedTtlCache({ maxEntries: 2, ttlMs: 100, now: () => now });

  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  assert.equal(cache.size, 2);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
});

test("evicts the least recently used live entry", () => {
  const cache = new BoundedTtlCache({ maxEntries: 2, ttlMs: 100, now: () => 1_000 });

  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);

  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("c"), 3);
});

test("removes expired entries without extending TTL on reads", () => {
  let now = 1_000;
  const cache = new BoundedTtlCache({ maxEntries: 2, ttlMs: 100, now: () => now });

  cache.set("a", 1);
  now = 1_050;
  assert.equal(cache.get("a"), 1);
  now = 1_100;

  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size, 0);
});
