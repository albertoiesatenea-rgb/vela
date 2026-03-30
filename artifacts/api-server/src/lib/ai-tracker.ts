/**
 * Closer Wizard — AI Usage Tracker v2
 * Centralized observability layer for every OpenAI call.
 * Records tokens, cost, latency. Aggregates by session and route.
 * No DB — in-memory only, with ring buffer for recent calls.
 */

import { logger } from "./logger";
import { randomUUID } from "crypto";

// ── Pricing table — USD per 1K tokens ────────────────────────────────────────
// Add models here; unknown models get null cost.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00015,  output: 0.0006  }, // $0.15 / $0.60 per 1M
  "gpt-4o":      { input: 0.0025,   output: 0.01    }, // $2.50 / $10 per 1M
  "gpt-4":       { input: 0.03,     output: 0.06    },
  "gpt-4-turbo": { input: 0.01,     output: 0.03    },
};

// ── Types ─────────────────────────────────────────────────────────────────────
export type UsageStatus = "ok" | "error" | "partial";
export type UsageMode   = "copilot" | "arena";

export interface AiUsageRecord {
  callId:               string;    // unique per call
  timestamp:            string;
  route:                string;    // HTTP route, e.g. "copilot/analyze"
  endpoint:             string;    // logical name, e.g. "analyze" | "terminal_state"
  mode:                 UsageMode;
  sessionId?:           string;
  model:                string;
  maxTokensConfigured:  number;
  promptTokens:         number;
  completionTokens:     number;
  totalTokens:          number;
  estimatedCostUsd:     number | null;  // null if model not in pricing table
  latencyMs:            number;
  status:               UsageStatus;
  notes?:               string;         // parse errors, fallbacks, retries
}

export interface SessionUsageSummary {
  sessionId:            string;
  mode:                 UsageMode;
  calls:                number;
  totalPromptTokens:    number;
  totalCompletionTokens: number;
  totalTokens:          number;
  totalCostUsd:         number;
  avgLatencyMs:         number;
  createdAt:            string;
  lastCallAt:           string;
}

export interface RouteUsageSummary {
  route:                string;
  calls:                number;
  totalTokens:          number;
  totalCostUsd:         number;
  avgLatencyMs:         number;
  avgPromptTokens:      number;
  avgCompletionTokens:  number;
}

interface GlobalTotals {
  calls:        number;
  totalTokens:  number;
  totalCostUsd: number;
}

// ── In-memory store ───────────────────────────────────────────────────────────
const RECENT_CALLS_LIMIT = 200;
const recentCalls:    AiUsageRecord[]                     = [];
const sessionStore  = new Map<string, SessionUsageSummary>();
const routeStore    = new Map<string, RouteUsageSummary>();
const global: GlobalTotals = { calls: 0, totalTokens: 0, totalCostUsd: 0 };
const serverStartedAt = new Date().toISOString();

// ── Cost calculation ──────────────────────────────────────────────────────────
export function estimateModelCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return (promptTokens    / 1000) * pricing.input
       + (completionTokens / 1000) * pricing.output;
}

// ── Core registration ─────────────────────────────────────────────────────────
export interface LogAICallParams {
  route:               string;
  endpoint:            string;
  mode:                UsageMode;
  sessionId?:          string;
  model:               string;
  maxTokensConfigured: number;
  promptTokens:        number;
  completionTokens:    number;
  totalTokens:         number;
  latencyMs:           number;
  status:              UsageStatus;
  notes?:              string;
}

export function logAICall(params: LogAICallParams): AiUsageRecord {
  const cost = estimateModelCost(params.model, params.promptTokens, params.completionTokens);
  const record: AiUsageRecord = {
    callId:              randomUUID(),
    timestamp:           new Date().toISOString(),
    route:               params.route,
    endpoint:            params.endpoint,
    mode:                params.mode,
    sessionId:           params.sessionId,
    model:               params.model,
    maxTokensConfigured: params.maxTokensConfigured,
    promptTokens:        params.promptTokens,
    completionTokens:    params.completionTokens,
    totalTokens:         params.totalTokens,
    estimatedCostUsd:    cost,
    latencyMs:           params.latencyMs,
    status:              params.status,
    notes:               params.notes,
  };

  // ── Ring buffer ──────────────────────────────────────────────────────────
  recentCalls.push(record);
  if (recentCalls.length > RECENT_CALLS_LIMIT) recentCalls.shift();

  // ── Global totals ────────────────────────────────────────────────────────
  global.calls++;
  global.totalTokens  += params.totalTokens;
  global.totalCostUsd += cost ?? 0;

  // ── Route aggregation ────────────────────────────────────────────────────
  const rk = params.route;
  const rs = routeStore.get(rk) ?? {
    route: rk, calls: 0, totalTokens: 0, totalCostUsd: 0,
    avgLatencyMs: 0, avgPromptTokens: 0, avgCompletionTokens: 0,
  };
  const prevCalls = rs.calls;
  rs.calls++;
  rs.totalTokens    += params.totalTokens;
  rs.totalCostUsd   += cost ?? 0;
  // Rolling average for latency and token split
  rs.avgLatencyMs        = (rs.avgLatencyMs        * prevCalls + params.latencyMs)        / rs.calls;
  rs.avgPromptTokens     = (rs.avgPromptTokens     * prevCalls + params.promptTokens)     / rs.calls;
  rs.avgCompletionTokens = (rs.avgCompletionTokens * prevCalls + params.completionTokens) / rs.calls;
  routeStore.set(rk, rs);

  // ── Session aggregation ──────────────────────────────────────────────────
  if (params.sessionId) {
    const now = new Date().toISOString();
    const ss = sessionStore.get(params.sessionId) ?? {
      sessionId:             params.sessionId,
      mode:                  params.mode,
      calls:                 0,
      totalPromptTokens:     0,
      totalCompletionTokens: 0,
      totalTokens:           0,
      totalCostUsd:          0,
      avgLatencyMs:          0,
      createdAt:             now,
      lastCallAt:            now,
    };
    const prevSessionCalls = ss.calls;
    ss.calls++;
    ss.totalPromptTokens     += params.promptTokens;
    ss.totalCompletionTokens += params.completionTokens;
    ss.totalTokens           += params.totalTokens;
    ss.totalCostUsd          += cost ?? 0;
    ss.avgLatencyMs           = (ss.avgLatencyMs * prevSessionCalls + params.latencyMs) / ss.calls;
    ss.lastCallAt             = now;
    sessionStore.set(params.sessionId, ss);
  }

  // ── Pino log line ────────────────────────────────────────────────────────
  const costStr = cost !== null ? `$${cost.toFixed(6)}` : "$?";
  logger.info({
    ai_usage:          true,
    callId:            record.callId,
    route:             params.route,
    endpoint:          params.endpoint,
    sessionId:         params.sessionId ?? null,
    mode:              params.mode,
    model:             params.model,
    prompt_tokens:     params.promptTokens,
    completion_tokens: params.completionTokens,
    total_tokens:      params.totalTokens,
    cost_usd:          cost,
    latency_ms:        params.latencyMs,
    status:            params.status,
    notes:             params.notes ?? null,
  }, `[AI] ${params.route}:${params.endpoint} | in=${params.promptTokens} out=${params.completionTokens} | ${costStr} | ${params.latencyMs}ms`);

  return record;
}

// ── Session helpers ───────────────────────────────────────────────────────────
export function closeSession(sessionId: string): void {
  const ss = sessionStore.get(sessionId);
  if (!ss) return;
  logger.info({
    ai_session_total: true,
    sessionId,
    mode:             ss.mode,
    calls:            ss.calls,
    total_prompt:     ss.totalPromptTokens,
    total_completion: ss.totalCompletionTokens,
    total_tokens:     ss.totalTokens,
    cost_usd:         Number(ss.totalCostUsd.toFixed(6)),
    avg_latency_ms:   Math.round(ss.avgLatencyMs),
  }, `[AI SESSION END] ${sessionId} | ${ss.calls} calls | ${ss.totalTokens} tok | $${ss.totalCostUsd.toFixed(6)}`);
  // Keep in store for debug panel — remove after 10 min
  setTimeout(() => sessionStore.delete(sessionId), 10 * 60 * 1000);
}

export function getSessionStats(sessionId: string): SessionUsageSummary | undefined {
  return sessionStore.get(sessionId);
}

// ── Debug snapshot ────────────────────────────────────────────────────────────
export function getUsageSnapshot() {
  const routes = Array.from(routeStore.values())
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

  const sessions = Array.from(sessionStore.values())
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    .slice(0, 20);

  return {
    serverStartedAt,
    global: {
      calls:        global.calls,
      totalTokens:  global.totalTokens,
      totalCostUsd: Number(global.totalCostUsd.toFixed(6)),
    },
    routes: routes.map(r => ({
      ...r,
      totalCostUsd:        Number(r.totalCostUsd.toFixed(6)),
      avgLatencyMs:        Math.round(r.avgLatencyMs),
      avgPromptTokens:     Math.round(r.avgPromptTokens),
      avgCompletionTokens: Math.round(r.avgCompletionTokens),
    })),
    sessions: sessions.map(s => ({
      ...s,
      totalCostUsd: Number(s.totalCostUsd.toFixed(6)),
      avgLatencyMs: Math.round(s.avgLatencyMs),
    })),
    recentCalls: recentCalls.slice(-50).reverse().map(c => ({
      ...c,
      estimatedCostUsd: c.estimatedCostUsd !== null
        ? Number(c.estimatedCostUsd.toFixed(6))
        : null,
    })),
  };
}
