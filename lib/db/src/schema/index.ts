import { pgTable, text, uuid, timestamp, real, jsonb, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const callSessions = pgTable("call_sessions", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  createdAt:              timestamp("created_at").defaultNow().notNull(),
  endedAt:                timestamp("ended_at"),
  brainId:                text("brain_id"),
  sessionContext:         text("session_context"),
  outcome:                text("outcome"),
  score:                  real("score"),
  durationSeconds:        integer("duration_seconds"),
  clientName:             text("client_name"),
  rawInput:               text("raw_input"),
  callSummary:            jsonb("call_summary"),
  brutalAudit:            jsonb("brutal_audit"),
  whisperTranscript:      text("whisper_transcript"),
  webSpeechTurns:         jsonb("web_speech_turns"),
  totalCostUsd:           real("total_cost_usd"),
  prebriefId:             uuid("prebrief_id"),
  // ── Canonical session fields ────────────────────────────────────────────────
  sourceSessionId:        text("source_session_id"),
  savedAt:                timestamp("saved_at"),
  canonicalLogMd:         text("canonical_log_md"),
  sessionSnapshot:        jsonb("session_snapshot"),
  whisperRawTranscript:   text("whisper_raw_transcript"),
  whisperCleanTranscript: text("whisper_clean_transcript"),
  webSpeechTranscript:    text("web_speech_transcript"),
  velaAudit:              jsonb("vela_audit"),
  costSnapshot:           jsonb("cost_snapshot"),
  timelineSnapshot:       jsonb("timeline_snapshot"),
  savedExplicitly:        boolean("saved_explicitly").default(false),
});

export const prebriefLogs = pgTable("prebrief_logs", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
  brainId:            text("brain_id"),
  rawInput:           text("raw_input"),
  interpretedContext: jsonb("interpreted_context"),
  briefing:           jsonb("briefing"),
});

export const insertCallSessionSchema = createInsertSchema(callSessions);
export const insertPrebriefLogSchema  = createInsertSchema(prebriefLogs);

export type CallSession      = typeof callSessions.$inferSelect;
export type InsertCallSession = (typeof insertCallSessionSchema)["_output"];
export type PrebriefLog      = typeof prebriefLogs.$inferSelect;
export type InsertPrebriefLog = (typeof insertPrebriefLogSchema)["_output"];
