# Closer Wizard — Estado Actual del Proyecto

Fecha de referencia: marzo 2026

---

## Features completadas

### Copiloto
- Setup screen con campo de contexto libre
- Auto-generación de context label (POST /api/copilot/context-label, max_tokens=25)
- Modo escucha (Web Speech API) y modo simulación (texto pegado)
- Speaker mode: auto / cliente / yo
- Análisis en tiempo real (POST /api/copilot/analyze, gpt-4o-mini V2 ~700 tokens)
- Hero card: signal + say_now
- Detail expandible: reading, mission, next_move, support
- Journey (past/now/next)
- Call memory strip (hasta 5 ítems)
- Momentum indicator: green / amber / red (colorblind-safe, no rojo de alarma)
- End-of-call: declarar outcome (closed / next_step / lost / unclear)
- Resumen post-llamada con score 1–10, globalState, resultLabel, strengths, improvements
- Full report opcional (max_tokens=1600)
- Descarga de audit log en .md

### Arena
- Setup: role (seller/client), contexto, clientProfile, sellerProfile, difficulty
- Apertura AI generada (max_tokens=150)
- Turnos bidireccionales (max_tokens=300, historial con windowing de 12 turnos)
- Detección terminal condicional: keywords + clasificación IA (max_tokens=5)
- Outcomes: closed / next_step / lost / broken / manual_stop
- Botón ✨ Suggest: genera respuesta ideal y la auto-envía
- Debrief post-sesión: score 1–10 + 3 frases accionables (seller mode only)
- Descarga de audit log en .md

### Debug Panel
- Overlay con z-index correcto (z-49 backdrop, z-50 panel)
- Pin/unpin con Pin/PinOff icons; pin = sin backdrop, clicks pasan al app
- Persistencia en localStorage (cwiz-debug-pinned / cwiz-debug-open / cwiz-debug-detail)
- KPIs de sesión: coste / tokens / llamadas / latencia avg
- KPIs globales: total$ / tokens / llamadas / top ruta
- Alert system: LATENCIA ALTA >2000ms (sky-400) / CARA >$0.05 (amber-300) / VIGILAR >$0.015 o >1400ms o >25 llamadas (amber-400) / NORMAL (zinc-500)
- Badge de ruta dominante si una ruta >70% del gasto
- Detalle colapsable: filtro de modo + tabs Sesiones / Rutas / Llamadas
- Polling cada 5s cuando está abierto
- Presente en los 3 return paths de copilot.tsx y en arena.tsx

### AI Tracker (v2)
- Ring buffer de 200 llamadas
- Agregados por sesión con rolling averages
- Agregados por ruta con rolling averages
- closeSession() mantiene stats 10 min para el debug panel
- Pino structured logging por cada llamada y por sesión

### Audit Log
- buildCopilotAuditLog / buildArenaAuditLog → AuditLog → renderAuditLogMarkdown → .md
- Schema completo: meta, context, config, turns, readable_transcript, summary, audit_hints
- Detección automática de anomalías: parse errors, repetición, momentum, outcomes

---

## Decisiones de diseño clave

- **Paleta colorblind-safe**: sky-blue / amber / teal. Sin rojo para información importante.
- **Minimalismo**: sin etiquetas de sección innecesarias, sin flechas `→`, sin seller hints.
- **No DB**: todo en memoria. Server restart = pérdida de datos de sesión.
- **Un solo modelo**: gpt-4o-mini para todo. Sin mezcla de modelos.
- **Idioma**: ES por defecto, EN disponible. Toggle guardado en localStorage.
- **V2 prompt default**: ~700 tokens vs ~2100 del V1. Feature flag LEGACY_PROMPTS para debug.

---

## Limitaciones conocidas

- La sesión de Copiloto no persiste entre recargas de página (solo React state).
- Las sesiones de Arena son in-memory; un restart del servidor las pierde.
- Arena sessions se eliminan 5 min después de `finish` — no hay histórico permanente.
- El `hidden_reasoning_summary` del audit log de Arena es heurístico (keyword-based), no razonamiento real del modelo.
- `copilot/context-label` no envía `sessionId` (el label se genera antes de iniciar sesión).
- No hay autenticación ni cuentas de usuario.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Node.js + Express + Pino |
| Modelo IA | gpt-4o-mini (OpenAI) |
| Monorepo | pnpm workspaces |
| Estado servidor | In-memory (Map) |
| Estado cliente | React state + localStorage |
| Puerto API | 8080 |
