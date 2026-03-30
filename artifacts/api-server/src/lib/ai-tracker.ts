/**
 * Closer Wizard — AI Usage Tracker
 * Registers tokens, cost, and latency for every OpenAI call.
 * Aggregates per session for end-of-session totals.
 * Pure logging — no DB, no side effects.
 */

import { logger } from "./logger";

// ── gpt-4o-mini pricing (USD per 1K tokens, as of 2024) ──────────────────────
const PRICE_INPUT_PER_1K  = 0.00015;   // $0.15 / 1M input tokens
const PRICE_OUTPUT_PER_1K = 0.0006;    // $0.60 / 1M output tokens

export interface AICallStats {
  route:              string;
  sessionId?:         string;
  mode:               "copilot" | "arena";
  model:              string;
  promptTokens:       number;
  completionTokens:   number;
  totalTokens:        number;
  estimatedCostUsd:   number;
  latencyMs:          number;
  status:             "ok" | "error" | "partial";
}

// ── In-memory session aggregator ──────────────────────────────────────────────
interface SessionAggregate {
  sessionId:        string;
  mode:             "copilot" | "arena";
  calls:            number;
  totalPrompt:      number;
  totalCompletion:  number;
  totalTokens:      number;
  totalCostUsd:     number;
  totalLatencyMs:   number;
  createdAt:        string;
}

const sessionAggregates = new Map<string, SessionAggregate>();

export function estimateCost(promptTokens: number, completionTokens: number): number {
  return (promptTokens / 1000) * PRICE_INPUT_PER_1K
       + (completionTokens / 1000) * PRICE_OUTPUT_PER_1K;
}

export function logAICall(stats: AICallStats): void {
  const cost = Number(stats.estimatedCostUsd.toFixed(7));

  // Aggregate per session
  if (stats.sessionId) {
    const existing = sessionAggregates.get(stats.sessionId);
    if (existing) {
      existing.calls++;
      existing.totalPrompt     += stats.promptTokens;
      existing.totalCompletion += stats.completionTokens;
      existing.totalTokens     += stats.totalTokens;
      existing.totalCostUsd    += stats.estimatedCostUsd;
      existing.totalLatencyMs  += stats.latencyMs;
    } else {
      sessionAggregates.set(stats.sessionId, {
        sessionId:       stats.sessionId,
        mode:            stats.mode,
        calls:           1,
        totalPrompt:     stats.promptTokens,
        totalCompletion: stats.completionTokens,
        totalTokens:     stats.totalTokens,
        totalCostUsd:    stats.estimatedCostUsd,
        totalLatencyMs:  stats.latencyMs,
        createdAt:       new Date().toISOString(),
      });
    }
  }

  logger.info({
    ai_usage:          true,
    route:             stats.route,
    sessionId:         stats.sessionId ?? null,
    mode:              stats.mode,
    model:             stats.model,
    prompt_tokens:     stats.promptTokens,
    completion_tokens: stats.completionTokens,
    total_tokens:      stats.totalTokens,
    cost_usd:          cost,
    latency_ms:        stats.latencyMs,
    status:            stats.status,
  }, `[AI] ${stats.route} | in=${stats.promptTokens} out=${stats.completionTokens} | $${cost} | ${stats.latencyMs}ms`);
}

export function logSessionTotal(sessionId: string): void {
  const agg = sessionAggregates.get(sessionId);
  if (!agg) return;
  logger.info({
    ai_session_total: true,
    sessionId,
    mode:             agg.mode,
    calls:            agg.calls,
    total_prompt:     agg.totalPrompt,
    total_completion: agg.totalCompletion,
    total_tokens:     agg.totalTokens,
    cost_usd:         Number(agg.totalCostUsd.toFixed(6)),
    avg_latency_ms:   Math.round(agg.totalLatencyMs / agg.calls),
  }, `[AI SESSION] ${sessionId} | ${agg.calls} calls | ${agg.totalTokens} tokens total | $${agg.totalCostUsd.toFixed(6)}`);
  sessionAggregates.delete(sessionId);
}

export function getSessionStats(sessionId: string): SessionAggregate | undefined {
  return sessionAggregates.get(sessionId);
}
