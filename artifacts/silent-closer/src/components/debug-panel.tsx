/**
 * Closer Wizard — AI Usage Debug Panel
 * Hidden panel: click the ⚙ button bottom-right or press Ctrl+Shift+D.
 * Shows live token/cost/latency data from the API server.
 */

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

// ── Types (mirror api-tracker shapes) ────────────────────────────────────────
interface RouteStats {
  route: string;
  calls: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
}
interface SessionStats {
  sessionId: string;
  mode: string;
  calls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  createdAt: string;
  lastCallAt: string;
}
interface RecentCall {
  callId: string;
  timestamp: string;
  route: string;
  endpoint: string;
  mode: string;
  sessionId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  latencyMs: number;
  status: string;
  notes?: string;
}
interface UsageSnapshot {
  serverStartedAt: string;
  global: { calls: number; totalTokens: number; totalCostUsd: number };
  routes: RouteStats[];
  sessions: SessionStats[];
  recentCalls: RecentCall[];
}

function fmt$(v: number | null): string {
  if (v === null) return "?";
  if (v < 0.0001) return `$${(v * 1000).toFixed(4)}m`;
  return `$${v.toFixed(4)}`;
}
function fmtK(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DebugPanel({ sessionId }: { sessionId?: string | null }) {
  const [open, setOpen]         = useState(false);
  const [data, setData]         = useState<UsageSnapshot | null>(null);
  const [tab,  setTab]          = useState<"global" | "routes" | "calls">("global");
  const [err,  setErr]          = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/debug/usage");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as UsageSnapshot);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  // Keyboard shortcut: Ctrl+Shift+D
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Poll while open
  useEffect(() => {
    if (!open) return;
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [open, fetchData]);

  const session = data?.sessions.find(s => s.sessionId === sessionId);

  return (
    <>
      {/* Trigger button — bottom-right */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "fixed bottom-3 right-3 z-40 text-[9px] font-mono tracking-widest uppercase px-2 py-1 rounded",
          "text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all select-none border border-transparent hover:border-zinc-700",
          open && "text-white bg-zinc-800 border-zinc-700",
        )}
        title="Panel de uso AI (Ctrl+Shift+D)"
      >
        AI $
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end pointer-events-none">
          {/* Backdrop — click to close */}
          <div
            className="absolute inset-0 pointer-events-auto"
            onClick={() => setOpen(false)}
          />
          <div
            className="relative pointer-events-auto mb-8 mr-3 w-[420px] max-h-[80vh] flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-zinc-400">AI Usage</span>
                {data && (
                  <span className="text-[9px] font-mono text-zinc-600">
                    desde {fmtTime(data.serverStartedAt)}
                  </span>
                )}
              </div>
              <button onClick={() => setOpen(false)} className="text-zinc-600 hover:text-zinc-300 text-xs font-mono">✕</button>
            </div>

            {/* Error */}
            {err && (
              <div className="px-4 py-2 text-[10px] font-mono text-amber-400 border-b border-zinc-800">{err}</div>
            )}

            {data && (
              <>
                {/* Global KPIs */}
                <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800 shrink-0">
                  {[
                    { label: "LLAMADAS",  value: String(data.global.calls) },
                    { label: "TOKENS",    value: fmtK(data.global.totalTokens) },
                    { label: "COSTE",     value: fmt$(data.global.totalCostUsd) },
                  ].map(kpi => (
                    <div key={kpi.label} className="flex flex-col items-center py-2.5 gap-0.5">
                      <p className="text-[8px] font-mono tracking-widest uppercase text-zinc-600">{kpi.label}</p>
                      <p className="text-sm font-mono font-bold text-white">{kpi.value}</p>
                    </div>
                  ))}
                </div>

                {/* Current session — if available */}
                {session && (
                  <div className="px-4 py-2.5 border-b border-zinc-800 shrink-0 bg-zinc-900/50">
                    <p className="text-[8px] font-mono tracking-widest uppercase text-zinc-500 mb-1.5">SESIÓN ACTUAL</p>
                    <div className="grid grid-cols-4 gap-x-3 gap-y-0.5">
                      {[
                        { l: "modo",    v: session.mode },
                        { l: "calls",   v: String(session.calls) },
                        { l: "tokens",  v: fmtK(session.totalTokens) },
                        { l: "coste",   v: fmt$(session.totalCostUsd) },
                        { l: "in",      v: fmtK(session.totalPromptTokens) },
                        { l: "out",     v: fmtK(session.totalCompletionTokens) },
                        { l: "lat avg", v: `${session.avgLatencyMs}ms` },
                        { l: "id",      v: session.sessionId.slice(0, 8) },
                      ].map(item => (
                        <div key={item.l} className="flex flex-col">
                          <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-widest">{item.l}</span>
                          <span className="text-[10px] font-mono text-zinc-300 font-semibold truncate">{item.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tabs */}
                <div className="flex border-b border-zinc-800 shrink-0">
                  {(["global", "routes", "calls"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "flex-1 text-[9px] font-mono tracking-widest uppercase py-2 transition-colors",
                        tab === t ? "text-white border-b border-white -mb-px" : "text-zinc-600 hover:text-zinc-300",
                      )}
                    >
                      {t === "global" ? "Sesiones" : t === "routes" ? "Rutas" : "Llamadas"}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div className="overflow-y-auto flex-1">
                  {/* ── Sessions tab ── */}
                  {tab === "global" && (
                    <table className="w-full text-[10px] font-mono">
                      <thead className="sticky top-0 bg-zinc-950">
                        <tr className="text-zinc-600 text-[8px] uppercase tracking-widest">
                          <td className="px-3 py-1.5">ID</td>
                          <td className="px-3 py-1.5">Modo</td>
                          <td className="px-3 py-1.5 text-right">Calls</td>
                          <td className="px-3 py-1.5 text-right">Tokens</td>
                          <td className="px-3 py-1.5 text-right">Coste</td>
                          <td className="px-3 py-1.5 text-right">Lat</td>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sessions.length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-4 text-zinc-600 text-center">Sin sesiones activas</td></tr>
                        )}
                        {data.sessions.map(s => (
                          <tr key={s.sessionId} className={cn(
                            "border-t border-zinc-800/50 hover:bg-zinc-900/30",
                            s.sessionId === sessionId && "bg-zinc-900/60",
                          )}>
                            <td className="px-3 py-1.5 text-zinc-500">{s.sessionId.slice(0, 8)}</td>
                            <td className="px-3 py-1.5 text-zinc-400">{s.mode}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">{s.calls}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-300">{fmtK(s.totalTokens)}</td>
                            <td className="px-3 py-1.5 text-right text-teal-400">{fmt$(s.totalCostUsd)}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-500">{s.avgLatencyMs}ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* ── Routes tab ── */}
                  {tab === "routes" && (
                    <table className="w-full text-[10px] font-mono">
                      <thead className="sticky top-0 bg-zinc-950">
                        <tr className="text-zinc-600 text-[8px] uppercase tracking-widest">
                          <td className="px-3 py-1.5">Ruta</td>
                          <td className="px-3 py-1.5 text-right">Calls</td>
                          <td className="px-3 py-1.5 text-right">Avg in</td>
                          <td className="px-3 py-1.5 text-right">Avg out</td>
                          <td className="px-3 py-1.5 text-right">Coste total</td>
                          <td className="px-3 py-1.5 text-right">Lat</td>
                        </tr>
                      </thead>
                      <tbody>
                        {data.routes.map(r => (
                          <tr key={r.route} className="border-t border-zinc-800/50 hover:bg-zinc-900/30">
                            <td className="px-3 py-1.5 text-zinc-300 max-w-[120px] truncate">{r.route}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-500">{r.calls}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-500">{r.avgPromptTokens}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-500">{r.avgCompletionTokens}</td>
                            <td className="px-3 py-1.5 text-right text-teal-400">{fmt$(r.totalCostUsd)}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-500">{r.avgLatencyMs}ms</td>
                          </tr>
                        ))}
                        {data.routes.length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-4 text-zinc-600 text-center">Sin llamadas registradas</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}

                  {/* ── Recent calls tab ── */}
                  {tab === "calls" && (
                    <table className="w-full text-[10px] font-mono">
                      <thead className="sticky top-0 bg-zinc-950">
                        <tr className="text-zinc-600 text-[8px] uppercase tracking-widest">
                          <td className="px-3 py-1.5">Hora</td>
                          <td className="px-3 py-1.5">Endpoint</td>
                          <td className="px-3 py-1.5 text-right">In</td>
                          <td className="px-3 py-1.5 text-right">Out</td>
                          <td className="px-3 py-1.5 text-right">Coste</td>
                          <td className="px-3 py-1.5 text-right">ms</td>
                          <td className="px-3 py-1.5 text-right">st</td>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentCalls.map(c => (
                          <tr
                            key={c.callId}
                            title={c.notes ?? ""}
                            className={cn(
                              "border-t border-zinc-800/50 hover:bg-zinc-900/30",
                              c.status === "error" && "bg-amber-900/10",
                            )}
                          >
                            <td className="px-3 py-1.5 text-zinc-600">{fmtTime(c.timestamp)}</td>
                            <td className="px-3 py-1.5 text-zinc-300">{c.endpoint}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-500">{c.promptTokens}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-500">{c.completionTokens}</td>
                            <td className="px-3 py-1.5 text-right text-teal-400">{fmt$(c.estimatedCostUsd)}</td>
                            <td className="px-3 py-1.5 text-right text-zinc-500">{c.latencyMs}</td>
                            <td className={cn(
                              "px-3 py-1.5 text-right",
                              c.status === "ok" ? "text-emerald-500" : c.status === "error" ? "text-amber-400" : "text-zinc-500",
                            )}>{c.status[0]}</td>
                          </tr>
                        ))}
                        {data.recentCalls.length === 0 && (
                          <tr><td colSpan={7} className="px-3 py-4 text-zinc-600 text-center">Sin llamadas</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Footer */}
                <div className="px-4 py-2 border-t border-zinc-800 shrink-0 text-[8px] font-mono text-zinc-700 flex justify-between">
                  <span>Ctrl+Shift+D para cerrar</span>
                  <span>↻ cada 5s</span>
                </div>
              </>
            )}

            {!data && !err && (
              <div className="flex-1 flex items-center justify-center text-[10px] font-mono text-zinc-600">Cargando…</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
