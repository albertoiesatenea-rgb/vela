/**
 * VELA — AI Monitor Panel
 * Tactical cost/token monitor. Pinnable. KPIs-first. Alerts on anomalies.
 * Toggle: "AI $" button (bottom-right) or Ctrl+Shift+D.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Pin, PinOff, X, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface RouteStats {
  route: string; calls: number; totalTokens: number; totalCostUsd: number;
  avgLatencyMs: number; avgPromptTokens: number; avgCompletionTokens: number;
}
interface SessionStats {
  sessionId: string; mode: string; calls: number;
  totalPromptTokens: number; totalCompletionTokens: number;
  totalTokens: number; totalCostUsd: number; avgLatencyMs: number;
  createdAt: string; lastCallAt: string;
}
interface RecentCall {
  callId: string; timestamp: string; route: string; endpoint: string;
  mode: string; sessionId?: string; model: string;
  promptTokens: number; completionTokens: number; totalTokens: number;
  estimatedCostUsd: number | null; latencyMs: number; status: string; notes?: string;
}
interface UsageSnapshot {
  serverStartedAt: string;
  global: { calls: number; totalTokens: number; totalCostUsd: number };
  routes: RouteStats[];
  sessions: SessionStats[];
  recentCalls: RecentCall[];
}

// ── Formatters ────────────────────────────────────────────────────────────────
const USD_TO_EUR = 0.92;

// European-format euros: comma decimal, € suffix, fixed decimals to avoid width shifts.
function fmtEur(usd: number | null): string {
  if (usd === null)   return "—";
  const v = usd * USD_TO_EUR;
  if (v === 0)        return "0,00 €";
  // Always 4 decimal places for sub-cent amounts so the string width stays constant
  if (v < 0.01)       return `${v.toFixed(4).replace(".", ",")} €`;
  if (v < 0.10)       return `${v.toFixed(3).replace(".", ",")} €`;
  if (v < 1)          return `${v.toFixed(2).replace(".", ",")} €`;
  return `${v.toFixed(2).replace(".", ",")} €`;
}

// Internal dollar formatter used inside the detail panel tables.
function fmt$(v: number | null): string {
  if (v === null)    return "?";
  if (v === 0)       return "$0.00";
  if (v < 0.00005)   return "<$0.0001";
  if (v < 0.01)      return `$${v.toFixed(4)}`;
  if (v < 0.10)      return `$${v.toFixed(3)}`;
  if (v < 1)         return `$${v.toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}
function fmtK(v: number): string {
  if (v >= 100_000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 10_000)  return `${(v / 1000).toFixed(1)}k`;
  if (v >= 1_000)   return `${(v / 1000).toFixed(2)}k`;
  return String(v);
}
function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
function shortId(id: string): string { return id.slice(0, 7); }
function routeLabel(route: string): string { return route.split("/").pop() ?? route; }

// ── Alert logic ───────────────────────────────────────────────────────────────
type AlertLevel = "NORMAL" | "VIGILAR" | "CARA" | "LATENCIA ALTA";
interface AlertInfo { level: AlertLevel; cls: string; bg: string }

function getAlert(s: SessionStats): AlertInfo {
  if (s.avgLatencyMs > 2000)
    return { level: "LATENCIA ALTA", cls: "text-sky-400",  bg: "bg-sky-900/25 border-sky-800/40" };
  if (s.totalCostUsd > 0.05)
    return { level: "CARA",          cls: "text-amber-300", bg: "bg-amber-800/30 border-amber-700/40" };
  if (s.totalCostUsd > 0.015 || s.avgLatencyMs > 1400 || s.calls > 25)
    return { level: "VIGILAR",       cls: "text-amber-400", bg: "bg-amber-900/20 border-amber-800/40" };
  return   { level: "NORMAL",        cls: "text-zinc-500",  bg: "bg-zinc-800/30 border-zinc-700/40" };
}

function getDominantRoute(routes: RouteStats[]): string | null {
  if (routes.length < 2) return null;
  const total = routes.reduce((a, r) => a + r.totalCostUsd, 0);
  if (total === 0) return null;
  if (routes[0].totalCostUsd / total > 0.70) return routeLabel(routes[0].route);
  return null;
}

// ── localStorage ──────────────────────────────────────────────────────────────
const LS_PINNED = "cwiz-debug-pinned";
const LS_OPEN   = "cwiz-debug-open";
const LS_DETAIL = "cwiz-debug-detail";

function getLS(key: string, def: boolean): boolean {
  try { return localStorage.getItem(key) === "true"; } catch { return def; }
}
function setLS(key: string, val: boolean): void {
  try { localStorage.setItem(key, String(val)); } catch { /* noop */ }
}

// ── KPI card ──────────────────────────────────────────────────────────────────
// Each KPI is a row: label on the left, value on the right — no truncation risk.
function Kpi({
  label, value, sub, hi = false,
}: { label: string; value: string; sub?: string; hi?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-[7.5px] font-mono tracking-[0.14em] uppercase text-zinc-600 shrink-0">
        {label}
      </span>
      <div className="flex flex-col items-end min-w-0">
        <span className={cn(
          "text-[12px] font-mono font-bold leading-none tabular-nums",
          hi ? "text-white" : "text-zinc-200",
        )}>
          {value}
        </span>
        {sub && (
          <span className="text-[7px] font-mono text-zinc-600 leading-none tabular-nums">{sub}</span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
// ── Heavy-call thresholds ──────────────────────────────────────────────────────
// Fires if single call exceeds ABS tokens OR is MULT times the running session avg
const HEAVY_ABS   = 900;   // tokens — absolute floor
const HEAVY_MULT  = 1.75;  // multiplier over session average
const HEAVY_MIN_N = 3;     // minimum calls before using relative threshold

interface HeavyNotif { tokens: number; cost: number | null; endpoint: string }

export function DebugPanel({ sessionId }: { sessionId?: string | null }) {
  const [open,       rawSetOpen]   = useState(() => getLS(LS_OPEN,   false));
  const [pinned,     rawSetPinned] = useState(() => getLS(LS_PINNED, false));
  const [detailOpen, rawSetDetail] = useState(() => getLS(LS_DETAIL, false));
  const [tab,  setTab]  = useState<"sessions" | "routes" | "calls">("sessions");
  const [mode, setMode] = useState<"all" | "copilot" | "arena">("all");
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [err,  setErr]  = useState<string | null>(null);
  const [heavyNotif, setHeavyNotif] = useState<HeavyNotif | null>(null);
  const [notifVisible, setNotifVisible] = useState(false);

  const lastCallIdRef  = useRef<string | null>(null);
  const notifTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setOpen   = (v: boolean) => { rawSetOpen(v);   setLS(LS_OPEN,   v); };
  const setPinned = (v: boolean) => { rawSetPinned(v); setLS(LS_PINNED, v); };
  const setDetail = (v: boolean) => { rawSetDetail(v); setLS(LS_DETAIL, v); };

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/debug/usage");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as UsageSnapshot);
      setErr(null);
    } catch (e) { setErr(String(e)); }
  }, []);

  // Keyboard shortcut: Ctrl/Cmd+Shift+D
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape" && open && !pinned) setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, pinned]);

  // Always poll every 4s (button needs live cost even when panel is closed)
  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 4000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Heavy-call detection: fires whenever recentCalls updates
  useEffect(() => {
    if (!data?.recentCalls.length) return;
    const latest = data.recentCalls[0];
    if (!latest || latest.callId === lastCallIdRef.current) return;
    lastCallIdRef.current = latest.callId;

    // Compare against session average (excluding the latest call itself)
    const sessionCalls = sessionId
      ? data.recentCalls.filter(c => c.sessionId === sessionId)
      : data.recentCalls;
    const prevCalls = sessionCalls.slice(1);
    const avgTokens = prevCalls.length > 0
      ? prevCalls.reduce((s, c) => s + c.totalTokens, 0) / prevCalls.length
      : null;

    const isHeavyAbsolute = latest.totalTokens >= HEAVY_ABS;
    const isHeavyRelative = avgTokens !== null
      && sessionCalls.length >= HEAVY_MIN_N
      && latest.totalTokens >= avgTokens * HEAVY_MULT;

    if (isHeavyAbsolute || isHeavyRelative) {
      // Cancel any in-flight timers
      if (notifTimerRef.current)  clearTimeout(notifTimerRef.current);
      if (fadeTimerRef.current)   clearTimeout(fadeTimerRef.current);
      // Trigger notification
      setHeavyNotif({ tokens: latest.totalTokens, cost: latest.estimatedCostUsd, endpoint: latest.endpoint });
      setNotifVisible(true);
      // Hide after 3.5s (start fade 400ms before)
      notifTimerRef.current = setTimeout(() => setNotifVisible(false), 3100);
      fadeTimerRef.current  = setTimeout(() => setHeavyNotif(null),    3600);
    }
  }, [data, sessionId]);

  const session  = data?.sessions.find(s => s.sessionId === sessionId) ?? null;
  const alert    = session ? getAlert(session) : null;
  const dominant = data ? getDominantRoute(data.routes) : null;

  const filteredSessions = data?.sessions.filter(s => mode === "all" || s.mode === mode) ?? [];
  const filteredRoutes   = data?.routes.filter(r => mode === "all" || r.route.startsWith(mode)) ?? [];
  const filteredCalls    = data?.recentCalls.filter(c => mode === "all" || c.mode === mode) ?? [];

  // Button label: cost in euros, European format
  const displayCost = session?.totalCostUsd ?? data?.global.totalCostUsd ?? null;
  const buttonCostLabel = fmtEur(displayCost ?? 0);

  return (
    <>
      {/* ── Heavy-call notification chip ─────────────────────────────────── */}
      {heavyNotif && (
        <div
          className={cn(
            "fixed right-3 z-50 pointer-events-none",
            "transition-all duration-300",
            notifVisible
              ? "bottom-11 opacity-100 translate-y-0"
              : "bottom-9 opacity-0 translate-y-1",
          )}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-amber-500/40 shadow-lg shadow-black/60">
            <span className="text-amber-400 text-[13px] leading-none">⚡</span>
            <div className="flex flex-col gap-0">
              <span className="text-[9px] font-mono font-bold text-amber-300 whitespace-nowrap tracking-wide">
                {fmtK(heavyNotif.tokens)} tok
                {heavyNotif.cost !== null ? ` · ${fmt$(heavyNotif.cost)}` : ""}
              </span>
              <span className="text-[7.5px] font-mono text-zinc-500 tracking-widest uppercase whitespace-nowrap">
                {routeLabel(heavyNotif.endpoint)} — heavy
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Trigger button ───────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "fixed bottom-3 right-3 z-40 font-mono text-[9px] tracking-wider",
          "w-[76px] text-center py-1 rounded border select-none tabular-nums",
          "transition-colors duration-150",
          open
            ? "text-white bg-zinc-800 border-zinc-600"
            : "text-zinc-500 border-zinc-800 hover:text-zinc-300 hover:border-zinc-600",
        )}
        title="AI Monitor (Ctrl+Shift+D)"
      >
        {buttonCostLabel}
      </button>

      {/* ── Click-away backdrop (only when not pinned) ───────────────────── */}
      {open && !pinned && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 49 }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Panel ────────────────────────────────────────────────────────── */}
      {open && (
        <div className="fixed bottom-11 right-3 z-50 w-[370px] max-h-[84vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">

          {/* ─ Header ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-3.5 py-2 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono tracking-[0.22em] uppercase text-zinc-300 font-semibold">
                AI Monitor
              </span>
              {pinned && (
                <span className="text-[6.5px] font-mono tracking-widest uppercase text-zinc-700 border border-zinc-800 px-1 py-0.5 rounded">
                  fijado
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setPinned(!pinned)}
                className="p-1 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
                title={pinned ? "Desfijar panel" : "Fijar panel — no se cierra al clicar fuera"}
              >
                {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
                title="Cerrar"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {err && (
            <div className="px-3.5 py-1.5 text-[9px] font-mono text-amber-400 border-b border-zinc-800 shrink-0">
              {err}
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {data ? (
              <div className="flex flex-col">

                {/* ─ SESIÓN ACTUAL ─────────────────────────────────────── */}
                <section className="px-3.5 pt-3 pb-3 border-b border-zinc-800/70">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[7.5px] font-mono tracking-[0.2em] uppercase text-zinc-600">
                        Sesión actual
                      </span>
                      {session && (
                        <span className="text-[7px] font-mono text-zinc-700">
                          {session.mode} · {shortId(session.sessionId)}
                        </span>
                      )}
                    </div>
                    {alert && (
                      <span className={cn(
                        "text-[7.5px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded border font-bold",
                        alert.cls, alert.bg,
                      )}>
                        {alert.level}
                      </span>
                    )}
                  </div>

                  {session ? (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                      <Kpi label="Coste"    value={fmt$(session.totalCostUsd)}         hi />
                      <Kpi label="Tokens"   value={fmtK(session.totalTokens)} />
                      <Kpi label="Llamadas" value={String(session.calls)} />
                      <Kpi label="Latencia" value={fmtMs(session.avgLatencyMs)} />
                    </div>
                  ) : (
                    <p className="text-[9px] font-mono text-zinc-700 italic">Sin sesión activa</p>
                  )}
                </section>

                {/* ─ GLOBAL ────────────────────────────────────────────── */}
                <section className="px-3.5 pt-2.5 pb-3 border-b border-zinc-800/70">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[7.5px] font-mono tracking-[0.2em] uppercase text-zinc-600">
                      Global · desde arranque
                    </span>
                    {dominant && (
                      <span className="text-[7.5px] font-mono tracking-widest text-sky-400 uppercase">
                        ↑ {dominant}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                    <Kpi label="Total $"  value={fmt$(data.global.totalCostUsd)} />
                    <Kpi label="Tokens"   value={fmtK(data.global.totalTokens)} />
                    <Kpi label="Calls"    value={String(data.global.calls)} />
                    <Kpi
                      label="Top ruta"
                      value={data.routes[0] ? routeLabel(data.routes[0].route) : "—"}
                      sub={data.routes[0] ? fmt$(data.routes[0].totalCostUsd) : undefined}
                    />
                  </div>
                </section>

                {/* ─ DETALLE (collapsible) ─────────────────────────────── */}
                <section>
                  <button
                    onClick={() => setDetail(!detailOpen)}
                    className="w-full flex items-center gap-1.5 px-3.5 py-2 text-zinc-600 hover:text-zinc-400 transition-colors border-b border-zinc-800/70 text-left"
                  >
                    {detailOpen
                      ? <ChevronDown className="w-3 h-3 shrink-0" />
                      : <ChevronRight className="w-3 h-3 shrink-0" />
                    }
                    <span className="text-[8px] font-mono tracking-widest uppercase">
                      {detailOpen ? "Ocultar detalle" : "Ver detalle"}
                    </span>
                  </button>

                  {detailOpen && (
                    <>
                      {/* Mode filter */}
                      <div className="flex border-b border-zinc-800/50">
                        {(["all", "copilot", "arena"] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={cn(
                              "flex-1 text-[7.5px] font-mono tracking-widest uppercase py-1.5 transition-colors",
                              mode === m
                                ? "text-zinc-200 bg-zinc-800/50"
                                : "text-zinc-600 hover:text-zinc-400",
                            )}
                          >
                            {m === "all" ? "Todo" : m}
                          </button>
                        ))}
                      </div>

                      {/* Tab selector */}
                      <div className="flex border-b border-zinc-800/50">
                        {(["sessions", "routes", "calls"] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={cn(
                              "flex-1 text-[7.5px] font-mono tracking-widest uppercase py-1.5 transition-colors",
                              tab === t
                                ? "text-white border-b border-zinc-300 -mb-px"
                                : "text-zinc-600 hover:text-zinc-400",
                            )}
                          >
                            {t === "sessions" ? "Sesiones" : t === "routes" ? "Rutas" : "Llamadas"}
                          </button>
                        ))}
                      </div>

                      {/* Sessions table */}
                      {tab === "sessions" && (
                        <table className="w-full text-[9px] font-mono">
                          <thead className="sticky top-0 bg-zinc-950">
                            <tr className="text-zinc-700 text-[7px] uppercase tracking-widest">
                              <th className="px-3 py-1.5 text-left font-normal">ID</th>
                              <th className="px-1 py-1.5 text-left font-normal">Modo</th>
                              <th className="px-1 py-1.5 text-right font-normal">Calls</th>
                              <th className="px-1 py-1.5 text-right font-normal">Tok</th>
                              <th className="px-1 py-1.5 text-right font-normal">$</th>
                              <th className="px-2 py-1.5 text-right font-normal">Lat</th>
                              <th className="px-2 py-1.5 text-right font-normal">Est</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredSessions.length === 0 && (
                              <tr>
                                <td colSpan={7} className="px-3 py-3 text-zinc-700 text-center">
                                  Sin sesiones
                                </td>
                              </tr>
                            )}
                            {filteredSessions.map(s => {
                              const a = getAlert(s);
                              return (
                                <tr
                                  key={s.sessionId}
                                  className={cn(
                                    "border-t border-zinc-800/30",
                                    s.sessionId === sessionId
                                      ? "bg-zinc-900/60"
                                      : "hover:bg-zinc-900/20",
                                  )}
                                >
                                  <td className="px-3 py-1 text-zinc-500">{shortId(s.sessionId)}</td>
                                  <td className="px-1 py-1 text-zinc-500 capitalize">{s.mode}</td>
                                  <td className="px-1 py-1 text-right text-zinc-400">{s.calls}</td>
                                  <td className="px-1 py-1 text-right text-zinc-400">{fmtK(s.totalTokens)}</td>
                                  <td className="px-1 py-1 text-right text-teal-400">{fmt$(s.totalCostUsd)}</td>
                                  <td className="px-2 py-1 text-right text-zinc-500">{fmtMs(s.avgLatencyMs)}</td>
                                  <td className="px-2 py-1 text-right">
                                    <span className={cn("text-[7px] font-bold", a.cls)}>
                                      {a.level === "NORMAL" ? "OK" : a.level.split(" ")[0]}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}

                      {/* Routes table */}
                      {tab === "routes" && (
                        <table className="w-full text-[9px] font-mono">
                          <thead className="sticky top-0 bg-zinc-950">
                            <tr className="text-zinc-700 text-[7px] uppercase tracking-widest">
                              <th className="px-3 py-1.5 text-left font-normal">Endpoint</th>
                              <th className="px-1 py-1.5 text-right font-normal">Calls</th>
                              <th className="px-1 py-1.5 text-right font-normal">In</th>
                              <th className="px-1 py-1.5 text-right font-normal">Out</th>
                              <th className="px-1 py-1.5 text-right font-normal">$</th>
                              <th className="px-2 py-1.5 text-right font-normal">Lat</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRoutes.length === 0 && (
                              <tr>
                                <td colSpan={6} className="px-3 py-3 text-zinc-700 text-center">
                                  Sin rutas
                                </td>
                              </tr>
                            )}
                            {filteredRoutes.map(r => (
                              <tr key={r.route} className="border-t border-zinc-800/30 hover:bg-zinc-900/20">
                                <td className="px-3 py-1 text-zinc-300">{routeLabel(r.route)}</td>
                                <td className="px-1 py-1 text-right text-zinc-500">{r.calls}</td>
                                <td className="px-1 py-1 text-right text-zinc-600">{r.avgPromptTokens}</td>
                                <td className="px-1 py-1 text-right text-zinc-600">{r.avgCompletionTokens}</td>
                                <td className="px-1 py-1 text-right text-teal-400">{fmt$(r.totalCostUsd)}</td>
                                <td className="px-2 py-1 text-right text-zinc-500">{fmtMs(r.avgLatencyMs)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                      {/* Recent calls table */}
                      {tab === "calls" && (
                        <table className="w-full text-[9px] font-mono">
                          <thead className="sticky top-0 bg-zinc-950">
                            <tr className="text-zinc-700 text-[7px] uppercase tracking-widest">
                              <th className="px-3 py-1.5 text-left font-normal">Hora</th>
                              <th className="px-1 py-1.5 text-left font-normal">End.</th>
                              <th className="px-1 py-1.5 text-right font-normal">In</th>
                              <th className="px-1 py-1.5 text-right font-normal">Out</th>
                              <th className="px-1 py-1.5 text-right font-normal">$</th>
                              <th className="px-2 py-1.5 text-right font-normal">ms</th>
                              <th className="px-2 py-1.5 text-right font-normal">st</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredCalls.length === 0 && (
                              <tr>
                                <td colSpan={7} className="px-3 py-3 text-zinc-700 text-center">
                                  Sin llamadas
                                </td>
                              </tr>
                            )}
                            {filteredCalls.map(c => (
                              <tr
                                key={c.callId}
                                title={c.notes ?? undefined}
                                className={cn(
                                  "border-t border-zinc-800/30",
                                  c.status === "error" ? "bg-amber-900/10" : "hover:bg-zinc-900/20",
                                )}
                              >
                                <td className="px-3 py-1 text-zinc-600">{fmtTime(c.timestamp)}</td>
                                <td className="px-1 py-1 text-zinc-300 max-w-[70px] truncate">{c.endpoint}</td>
                                <td className="px-1 py-1 text-right text-zinc-600">{c.promptTokens}</td>
                                <td className="px-1 py-1 text-right text-zinc-600">{c.completionTokens}</td>
                                <td className="px-1 py-1 text-right text-teal-400">{fmt$(c.estimatedCostUsd)}</td>
                                <td className="px-2 py-1 text-right text-zinc-500">{fmtMs(c.latencyMs)}</td>
                                <td className={cn(
                                  "px-2 py-1 text-right text-[8px] font-bold",
                                  c.status === "ok" ? "text-emerald-500" : c.status === "error" ? "text-amber-400" : "text-zinc-600",
                                )}>
                                  {c.status === "ok" ? "OK" : c.status === "error" ? "ERR" : "PAR"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </section>

              </div>
            ) : !err ? (
              <div className="flex items-center justify-center py-10 text-[9px] font-mono text-zinc-700">
                Cargando…
              </div>
            ) : null}
          </div>

          {/* ─ Footer ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-3.5 py-1.5 border-t border-zinc-800 shrink-0">
            <span className="text-[7px] font-mono text-zinc-700">
              {pinned ? "fijado · no se cierra solo" : "ctrl+shift+D"}
            </span>
            <span className="text-[7px] font-mono text-zinc-700">↻ 5s</span>
          </div>

        </div>
      )}
    </>
  );
}
