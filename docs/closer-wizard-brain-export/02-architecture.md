# VELA — Architecture

## Overview

VELA es un asistente táctico ultraminimalista para llamadas de ventas. Tiene dos modos principales:

- **Copiloto** — coaching IA en tiempo real durante llamadas de ventas en vivo
- **Arena** — simulación de conversación de ventas para práctica

El sistema es un monorepo (`pnpm` workspaces) con dos servicios principales:

| Servicio | Package | Tech | Puerto |
|---------|---------|------|--------|
| Frontend | `@workspace/silent-closer` | React + Vite + Tailwind | `$PORT` (env) |
| API | `@workspace/api-server` | Node.js + Express + Pino | `8080` |

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
│   │       ├── components/
│   │       │   └── debug-panel.tsx # Overlay de debug para developers
│   │       └── lib/
│   │           └── audit-log.ts    # Builder + renderer del audit log
│   └── api-server/             # API Express
│       └── src/
│           ├── routes/
│           │   ├── copilot.ts      # /api/copilot/*
│           │   ├── arena.ts        # /api/arena/*
│           │   └── debug.ts        # /api/debug/usage
│           └── lib/
│               ├── ai-tracker.ts   # Observabilidad centralizada de llamadas IA
│               └── logger.ts       # Pino structured logger
└── docs/                       # Esta documentación
```

---

## Flujo de datos — Copiloto

```
Voz del usuario / Texto pegado
         │
         ▼
Web Speech API (o paste manual)
         │
         ▼
POST /api/copilot/analyze  ←─ contexto de sesión, call memory, lang, speaker_mode
         │
         ▼ (gpt-4o-mini, ~700 tokens prompt)
JSON: signal, say_now, avoid, detail, journey, call_memory, momentum
         │
         ▼
UI actualiza hero card + memory strip
         │
    (fin de llamada)
         ▼
POST /api/copilot/summarize  ←─ turn log completo
         │
         ▼ (gpt-4o-mini, 900–1600 tokens budget)
JSON: score, globalState, resultLabel, strengths, improvements, fullReport
         │
         ▼
Audit log construido en cliente → descarga .md
```

## Flujo de datos — Arena

```
Config (role, context, profiles, difficulty)
         │
         ▼
POST /api/arena/start  ←─ role, lang, context, clientProfile, sellerProfile, difficulty
         │
         ▼ (gpt-4o-mini, max_tokens=150)
Mensaje de apertura IA → guardado en Map de sesiones (servidor)
         │
Usuario escribe mensaje
         ▼
POST /api/arena/turn  ←─ arenaSessionId, userMessage
         │
         ├──▶ Respuesta IA del turno (max_tokens=300)
         └──▶ Detección de estado terminal (condicional, max_tokens=5)
              │
              ▼
      { aiMessage, terminalSignal }
         │
    (sesión termina)
         ▼
POST /api/arena/finish  ←─ arenaSessionId, outcome
         │
         ▼ (debrief gpt-4o-mini, max_tokens=300)
{ turns, summary { debrief { score, critique } } }
         │
         ▼
Audit log construido en cliente → descarga .md
```

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

La sesión de Copiloto (texto de contexto, turn log, call memory) vive en React state y se pierde al recargar la página.

---

## Modelo IA

Todas las llamadas IA usan **gpt-4o-mini** exclusivamente.

Precios:
- Input: $0.00015 por 1K tokens ($0.15 por 1M)
- Output: $0.0006 por 1K tokens ($0.60 por 1M)

---

## Soporte de idiomas

Todo el texto de usuario y los prompts soportan **ES** (español, por defecto) y **EN** (inglés). El toggle de idioma se guarda en localStorage y se envía con cada petición API como campo `lang`.

---

## Paleta de accesibilidad

- Paleta colorblind-safe: sky-blue, amber, teal en lugar de rojo/verde para información crítica.
- Alertas del debug panel: sky-400 (latencia), amber-300 (coste), amber-400 (vigilar), zinc-500 (normal).
