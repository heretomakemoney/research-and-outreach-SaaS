// Tests for usage summing and cost estimation. Run with: npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost, sumUsage, totalCost } from "./pricing.ts";

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

// Calibration against the first real run (NTT Australia, Opus 5.5, one API request).
// The numbers are the ones Anthropic's usage object reported; the dollar figures are the
// estimate the app showed for that run.
test("the real NTT run is priced exactly as it was shown ($0.4144)", () => {
  const usage = sumUsage("claude-opus-5-5", [
    {
      input_tokens: 183,
      output_tokens: 5158,
      cache_creation_input_tokens: 38012,
      cache_read_input_tokens: 352049,
      server_tool_use: { web_search_requests: 5, web_fetch_requests: 4 },
    },
  ]);
  const cost = estimateCost(usage)!;
  assert.equal(cost.inputUsd.toFixed(4), "0.0007");
  assert.equal(cost.outputUsd.toFixed(4), "0.1032");
  assert.equal(cost.cacheWriteUsd.toFixed(4), "0.1901");
  assert.equal(cost.cacheReadUsd.toFixed(4), "0.0704");
  assert.equal(cost.searchUsd.toFixed(2), "0.05");
  assert.equal(cost.totalUsd.toFixed(4), "0.4144");
});

test("the same tokens on Sonnet 5.5 (what the Q1 discover stage would cost if usage were identical)", () => {
  const usage = sumUsage("claude-sonnet-5-5", [
    { input_tokens: 183, output_tokens: 5158, cache_creation_input_tokens: 38012, cache_read_input_tokens: 352049, server_tool_use: { web_search_requests: 5 } },
  ]);
  assert.equal(estimateCost(usage)!.totalUsd.toFixed(4), "0.2674");
});

test("totals add up across stage logs", () => {
  const log = (usd: number, searches: number) =>
    ({ cost: { totalUsd: usd }, usage: { searchRequests: searches, fetchRequests: 1 }, durationMs: 1000 }) as never;
  const t = totalCost([log(0.27, 5), log(0.17, 0), log(0.02, 0)]);
  assert.equal(t.totalUsd.toFixed(2), "0.46");
  assert.equal(t.searches, 5);
  assert.equal(t.fetches, 3);
  assert.equal(t.durationMs, 3000);
});
