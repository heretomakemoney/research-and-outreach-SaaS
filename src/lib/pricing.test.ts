// Tests for usage summing and cost estimation. Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost, sumUsage } from "./pricing.ts";

test("usage is summed across every request of a stage", () => {
  const usage = sumUsage("claude-opus-5-5", [
    { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 5000, cache_read_input_tokens: null, server_tool_use: { web_search_requests: 3, web_fetch_requests: 1 } },
    { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 5000, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } },
  ]);
  assert.equal(usage.apiRequests, 2);
  assert.equal(usage.inputTokens, 1500);
  assert.equal(usage.outputTokens, 300);
  assert.equal(usage.cacheWriteTokens, 5000);
  assert.equal(usage.cacheReadTokens, 5000);
  assert.equal(usage.searchRequests, 5);
  assert.equal(usage.fetchRequests, 1);
});

test("cost estimate follows the published price table (Opus 5.5)", () => {
  const usage = sumUsage("claude-opus-5-5", [
    { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, server_tool_use: { web_search_requests: 10 } },
  ]);
  const cost = estimateCost(usage)!;
  assert.equal(cost.inputUsd, 4); // 1M x $4
  assert.equal(cost.outputUsd, 2); // 0.1M x $20
  assert.equal(cost.cacheWriteUsd, 5); // 1M x $5
  assert.equal(cost.cacheReadUsd, 0.2); // 1M x $0.20
  assert.equal(cost.searchUsd, 0.1); // 10 x $0.01
  assert.ok(Math.abs(cost.totalUsd - 11.3) < 1e-9);
  assert.equal(cost.isEstimate, true);
});

test("an unknown model gets no invented price", () => {
  assert.equal(estimateCost(sumUsage("some-other-model", [])), null);
});
