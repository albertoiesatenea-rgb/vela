# VELA — Architecture

## Overview

VELA es un asistente táctico ultraminimalista para llamadas de ventas. Tiene dos modos principales:

- **Copiloto** — coaching IA en tiempo real durante llamadas de ventas en vivo
- **Arena** — simulación de conversación de ventas para práctica

El sistema es un monorepo (`pnpm` workspaces) con dos servicios principales más una librería de doctrina comercial compartida:

| Servicio / Lib | Package | Tech | Puerto |
|---------|---------|------|--------|
| Frontend | `@workspace/silent-closer` | React + Vite + Tailwind | `$PORT` (env) |
| API | `@workspace/api-server` | Node.js + Express + Pino | `8080` |
| Doctrina comercial | `@workspace/sales-brain` | TypeScript lib, sin runtime | — |
| Schemas API | `@workspace/api-zod` | Zod, mantenido manualmente | — |

Todas las rutas API tienen prefijo `/api/`.

---

## Estructura de directorios

```
workspace/
├── artifacts/
│   ├── silent-closer/          # Frontend React
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── copilot.tsx     # UI modo Copiloto
│   │       │   └── arena.tsx       # UI modo Arena
│   │       ├── hooks/
│   │       │   ├── use-speech.ts   # Web Speech API hook
│   │       │   └── use-theme.ts    # Theme hook
│   │       └── lib/
│   │           ├── audit-log.ts    # Builder + renderer del audit log
│   │           └── speaker-session.ts  # Auto speaker attribution
│   └── api-server/             # API Express
│       └── src/
│           ├── routes/
│           │   ├── index.ts        # Router aggregator
│           │   ├── copilot.ts      # /api/copilot/*
│           │   ├── arena.ts        # /api/arena/*
│           │   ├── debug.ts        # /api/debug/usage
│           │   └── health.ts       # /api/health
│           └── lib/
│               ├── ai-tracker.ts   # Observabilidad centralizada de llamadas IA
│               └── logger.ts       # Pino structured logger
└── lib/
    ├── sales-brain/            # Doctrina comercial compartida
    │   └── src/index.ts        # MASTER_SELLER_BRAIN, perfiles, taxonomías, buildArenaSellerTacticalRules
    ├── api-zod/                # Schemas Zod (mantenido manualmente)
    │   └── src/generated/api.ts
    └── api-client-react/       # Client hooks generados (React Query)
```

---

## Flujo de datos — Copiloto

```
Voz del usuario / Texto pegado
         │
         ▼
Web Speech API (o paste manual)
         │  ← speaker attribution (auto/client/me)
         ▼
Frontend construye conversation_history[]
(últimas 16 de 20+, con resumen si hay más)
         │
         ▼
POST /api/copilot/analyze  ←─ text, context, call_memory (string), conversation_history[],
                               lang, structured_context, speaker_confidence
         │
         ▼ (gpt-4o, max_tokens=900)
JSON: signal, say_now, avoid, detail, journey, call_memory{summary_lines[]}, momentum
         │
         ▼
UI actualiza hero card + memory strip
         │
    (fin de llamada)
         ▼
POST /api/copilot/summarize  ←─ call_memory[], outcome, lang, full_report, speaker_uncertainty
         │
         ▼ (gpt-4o-mini, max_tokens=400 o 1600)
JSON: score, global_state, result_label, strengths, improvements, full_report
         │
         ▼
POST /api/copilot/audit-report  ←─ call_memory[], outcome, context, lang, closing_excerpt,
                                    session_summary, audit_hints_pack, human_notes
         │
         ▼ (gpt-4o-mini, max_tokens=variable)
BrutalAudit JSON
         │
         ▼
Audit log construido en cliente → descarga .md
```

## Flujo de datos — Arena

```
Config (role, context, profiles, difficulty, preset, arenaStructuredContext)
         │
         ▼
POST /api/arena/start  ←─ role, lang, context, clientProfile, sellerProfile,
                           difficulty, randomPreset, arenaStructuredContext
         │
         ▼ (gpt-4o-mini, max_tokens=150)
Mensaje de apertura IA → guardado en Map de sesiones (servidor)
         │
Usuario escribe mensaje (o shortcutDirection=agree/object)
         ▼
POST /api/arena/turn  ←─ arenaSessionId, userMessage, shortcutDirection?
         │
         ├──▶ Respuesta IA del turno (gpt-4o, max_tokens=220-300)
         ├──▶ Detección de estado terminal (gpt-4o-mini, max_tokens=5, condicional)
         ├──▶ CoachLite — solo client mode (gpt-4o-mini, max_tokens=500)
         └──▶ Journey — solo client mode (gpt-4o-mini, max_tokens=400)
              │
              ▼
      { aiMessage, terminalSignal, coachLite?, outcome? }
         │
   [Opcional: usuario inyecta nota]
         ▼
POST /api/arena/note  ←─ arenaSessionId, note
         │
         ▼ (sin llamada IA — añade note a session.sellerNotes[])
POST /api/arena/repitch  ←─ arenaSessionId
         │
         ▼ (gpt-4o-mini — visual only, NO añadido a session.turns)
         │
    (sesión termina)
         ▼
POST /api/arena/finish  ←─ arenaSessionId, outcome
         │
         ▼ (debrief gpt-4o-mini, max_tokens=300 — solo seller mode con turnos)
{ turns, summary { debrief { score, critique } } }
         │
         ▼
POST /api/arena/audit-report  ←─ transcript[], context, outcome, role, profiles, lang
         │
         ▼ (gpt-4o-mini — análisis forense independiente)
         │
         ▼
Audit log construido en cliente → descarga .md
```

---

## Doctrina comercial — @workspace/sales-brain

Fuente de verdad comercial única. No tiene runtime propio — se importa en las rutas de API.

Exports relevantes:

| Export | Tipo | Usado en |
|--------|------|---------|
| `MASTER_SELLER_BRAIN` | `Record<"es"\|"en", string>` | copilot.ts (MODO:CONSEJERO), arena.ts (MODO:EJECUTOR) |
| `OBJECTION_TAXONOMY_BLOCK` | `Record<"es"\|"en", string>` | copilot.ts (clasificación de signal) |
| `buildArenaSellerTacticalRules(lang)` | `function → string` | arena.ts (sistema de decisión táctica arena vendedor) |
| `CLIENT_PROFILE_DESC` | `Record<string, string>` | arena.ts |
| `SELLER_PROFILE_DESC` | `Record<string, string>` | arena.ts |
| `DIFFICULTY_DESC` | `Record<string, string>` | arena.ts |
| `PRESET_SYSTEM_DESC` | `Record<string, {es,en}>` | arena.ts |
| `DEBRIEF_CLIENT_PROFILE` | `Record<string, {es,en}>` | arena.ts (debrief) |

---

## Gestión de estado

### Servidor (solo en memoria, sin DB)

| Store | Ubicación | Lifetime |
|-------|---------|---------|
| Sesiones Arena (`Map<id, ArenaSession>`) | `arena.ts` | Eliminadas 5 min tras `finish` |
| Ring buffer de llamadas IA (200 máx) | `ai-tracker.ts` | Lifetime del proceso |
| Resúmenes de uso por sesión | `ai-tracker.ts` | 10 min tras `closeSession()` |
| Agregados por ruta y totales globales | `ai-tracker.ts` | Lifetime del proceso |

**Server restart = pérdida de todos los datos de sesión y Arena.**

### Cliente (localStorage)

| Clave | Propósito |
|-------|---------|
| `sc_lang` | Preferencia de idioma (es/en) |
| `sc_context_label` | Último context label usado |
| `cwiz-debug-pinned` | Estado de pin del debug panel |
| `cwiz-debug-open` | Estado de apertura del debug panel |
| `cwiz-debug-detail` | Estado del acordeón de detalle |

La sesión de Copiloto (contexto, turn log, call memory, conversation_history) vive en React state y se pierde al recargar la página.

---

## Modelos IA

| Rol | Modelo | Justificación |
|-----|--------|--------------|
| Análisis táctico principal (copilot/analyze) | `gpt-4o` | Requiere razonamiento profundo |
| Turno Arena (arena/turn) | `gpt-4o` | Requiere razonamiento profundo |
| Todo lo demás | `gpt-4o-mini` | Clasificaciones simples, no requieren razonamiento profundo |

Precios (tabla en `ai-tracker.ts`):
- gpt-4o: Input $0.0025/1K, Output $0.01/1K
- gpt-4o-mini: Input $0.00015/1K, Output $0.0006/1K

---

## Soporte de idiomas

Todo el texto de usuario y los prompts soportan **ES** (español, por defecto) y **EN** (inglés). El toggle de idioma se guarda en localStorage y se envía con cada petición API como campo `lang`.

---

## Paleta de accesibilidad

- Paleta colorblind-safe: sky-blue, amber, teal en lugar de rojo/verde para información crítica.
- Alertas del debug panel: sky-400 (latencia), amber-300 (coste), amber-400 (vigilar), zinc-500 (normal).
