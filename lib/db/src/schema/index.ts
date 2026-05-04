import { pgTable, text, uuid, timestamp, real, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const callSessions = pgTable("call_sessions", {
  id:                uuid("id").primaryKey().defaultRandom(),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  endedAt:           timestamp("ended_at"),
  brainId:           text("brain_id"),
  sessionContext:    text("session_context"),
  outcome:           text("outcome"),
  score:             real("score"),
  durationSeconds:   integer("duration_seconds"),
  callSummary:       jsonb("call_summary"),
  brutalAudit:       jsonb("brutal_audit"),
  whisperTranscript: text("whisper_transcript"),
  webSpeechTurns:    jsonb("web_speech_turns"),
  totalCostUsd:      real("total_cost_usd"),
  prebriefId:        uuid("prebrief_id"),
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
export type InsertCallSession = z.infer<typeof insertCallSessionSchema>;
export type PrebriefLog      = typeof prebriefLogs.$inferSelect;
export type InsertPrebriefLog = z.infer<typeof insertPrebriefLogSchema>;
