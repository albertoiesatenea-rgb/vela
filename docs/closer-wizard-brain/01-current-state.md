# VELA — Estado Actual del Proyecto

Fecha de referencia: abril 2026. Verificado contra código real.

---

## Features completadas

### Copiloto

- Setup screen con campo de contexto libre y contexto estructurado opcional (objetivo, bloqueo previo, entregable)
- Auto-generación de context label (`POST /api/copilot/context-label`, max_tokens=25)
- Modo escucha (Web Speech API) y modo simulación (texto pegado)
- Speaker mode: auto / cliente / yo
- Análisis en tiempo real (`POST /api/copilot/analyze`, **gpt-4o**, V2 ~700 tokens de sistema)
- **Historial real de conversación**: frontend envía `conversation_history[]` (últimas 16 entradas si >20, con resumen de anteriores)
- Hero card: signal + say_now
- Detail expandible: reading, mission, next_move, support
- Journey (past/now/next)
- Call memory strip (hasta 6 ítems — actualizada por el modelo cada turno)
- Momentum indicator: green / amber / red (colorblind-safe)
- End-of-call: declarar outcome (closed / next_step / lost / unclear)
- Resumen post-llamada con score 1–10, globalState, resultLabel, strengths, improvements
- Full report opcional (max_tokens=1600)
- Audit brutal post-sesión (`POST /api/copilot/audit-report`)
- Descarga de audit log en .md (descarga mid-session y descarga final)

### Arena

- Setup: role (seller/client), contexto libre + contexto estructurado opcional, clientProfile, sellerProfile, difficulty, randomPreset
- Generación de contexto desde preset (`POST /api/arena/preset-context`)
- Adaptación de contexto entre roles (`POST /api/arena/adapt-context`)
- Apertura IA generada (max_tokens=150)
- Turnos bidireccionales — seller mode: **gpt-4o** max_tokens=300; client mode: **gpt-4o** max_tokens=220
- Historial con windowing de 12 turnos (ARENA_HISTORY_WINDOW=12)
- Detección terminal condicional: keywords + clasificación IA (max_tokens=5, gpt-4o-mini)
- CoachLite por turno (solo client mode): 7 campos JSON táticos — gpt-4o-mini
- Journey por turno (solo client mode): 6 etapas + premature_close_risk — gpt-4o-mini
- shortcutDirection ("agree"/"object"): IA genera el mensaje del usuario
- sellerNotes: instrucciones inyectadas como restricciones duras en el system prompt (`POST /api/arena/note`)
- repitch: reposicionamiento visual tras nota inyectada, sin añadir a turns (`POST /api/arena/repitch`)
- Outcomes: closed / next_step / lost / broken / manual_stop
- Botón ✨ Suggest: genera respuesta ideal (gpt-4o-mini, `POST /api/arena/suggest`)
- Debrief post-sesión: score 1–10 + 3 frases accionables, solo seller mode (gpt-4o-mini)
- Audit brutal post-sesión (`POST /api/arena/audit-report`)
- Descarga de audit log en .md

### Debug Panel

- Overlay con z-index correcto (z-49 backdrop, z-50 panel)
- Pin/unpin; pin = sin backdrop, clicks pasan al app
- Persistencia en localStorage (cwiz-debug-pinned / cwiz-debug-open / cwiz-debug-detail)
- KPIs de sesión: coste / tokens / llamadas / latencia avg
- KPIs globales: total$ / tokens / llamadas / top ruta
- Alert system: LATENCIA ALTA >2000ms / CARA >$0.05 / VIGILAR >$0.015 o >1400ms o >25 llamadas / NORMAL
- Badge de ruta dominante si una ruta >70% del gasto
- Detalle colapsable: filtro de modo + tabs Sesiones / Rutas / Llamadas
- Polling cada 5s cuando está abierto

### AI Tracker (v2)

- Ring buffer de 200 llamadas
- Agregados por sesión con rolling averages
- Agregados por ruta con rolling averages
- `closeSession()` mantiene stats 10 min para el debug panel
- Pino structured logging por cada llamada y por sesión

### Audit Log

- `buildCopilotAuditLog` / `buildArenaAuditLog` → `AuditLog` → `renderAuditLogMarkdown` → .md
- Schema completo: meta, context, config, turns, readable_transcript, summary, audit_hints
- 9 flags de diagnóstico en audit_hints
- Notas Arena (sellerNotes) aparecen en readable_transcript como `[→ INSTRUCCIÓN AL VENDEDOR]`

### Doctrina comercial centralizada

- `MASTER_SELLER_BRAIN` en `lib/sales-brain/src/index.ts` — fuente de verdad única
- Inyectada en Copiloto (MODO:CONSEJERO) y Arena vendedor (MODO:EJECUTOR)

---

## Decisiones de diseño clave

- **Modelo crítico**: gpt-4o para `copilot/analyze` y `arena/turn` (turno principal). gpt-4o-mini para todas las auxiliares.
- **Historial real en copiloto**: el modelo recibe el historial acumulado de la conversación, no solo la call_memory comprimida.
- **Paleta colorblind-safe**: sky-blue / amber / teal. Sin rojo para información importante.
- **Minimalismo**: sin etiquetas de sección innecesarias.
- **No DB**: todo en memoria. Server restart = pérdida de datos de sesión.
- **Idioma**: ES por defecto, EN disponible. Toggle guardado en localStorage.
- **V2 prompt default**: ~700 tokens vs ~2100 del V1. Feature flag LEGACY_PROMPTS para debug.
- **Doctrina única**: MASTER_SELLER_BRAIN es la única fuente de táctica comercial — copiloto y Arena la comparten.

---

## Limitaciones conocidas

- La sesión de Copiloto no persiste entre recargas de página (solo React state).
- Las sesiones de Arena son in-memory; un restart del servidor las pierde.
- Arena sessions se eliminan 5 min después de `finish` — no hay histórico permanente.
- El `hidden_reasoning_summary` del audit log de Arena es heurístico (keyword-based), no razonamiento real del modelo.
- `copilot/context-label` no envía `sessionId` (el label se genera antes de iniciar sesión).
- No hay autenticación ni cuentas de usuario.
- **Gap conocido**: `buildCopilotAuditLog()` en `audit-log.ts:349` hardcodea `model: "gpt-4o-mini"` en `meta.model`. El modelo real del analyze es ahora gpt-4o. El audit log muestra modelo incorrecto.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Node.js + Express + Pino |
| Modelo crítico (analyze, arena/turn) | gpt-4o |
| Modelos auxiliares | gpt-4o-mini |
| Doctrina comercial | `@workspace/sales-brain` |
| Schemas de API | `@workspace/api-zod` (Zod, mantenido manualmente) |
| Monorepo | pnpm workspaces |
| Estado servidor | In-memory (Map) |
| Estado cliente | React state + localStorage |
| Puerto API | 8080 |
