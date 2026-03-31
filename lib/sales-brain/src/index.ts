/**
 * @workspace/sales-brain
 *
 * Fuente de verdad comercial compartida entre Copilot y Arena.
 * Centraliza taxonomías, perfiles, journey, criterios de cierre,
 * anti-patrones y heurísticas de venta.
 *
 * REGLA: centralizar definiciones, no instrucciones.
 * Los prompts completos siguen siendo locales en cada ruta.
 * Este módulo exporta las piezas que se inyectan en ellos.
 *
 * ─────────────────────────────────────────────────────────────
 * CHANGELOG COMERCIAL — mini-formaciones acumulativas
 * ─────────────────────────────────────────────────────────────
 * v1.0 — 2025-03 — Migración inicial. Extraídos de arena.ts y copilot.ts:
 *   perfiles de cliente/vendedor, dificultad, presets, taxonomía de
 *   objeciones, etapas de journey, criterios de cierre, anti-patrones
 *   y heurísticas de decisión.
 * ─────────────────────────────────────────────────────────────
 *
 * Para añadir una mini-formación futura:
 *   1. Añadir/editar la regla en la sección correspondiente abajo.
 *   2. Añadir entrada en el CHANGELOG con fecha y descripción.
 *   3. Si afecta a un bloque inyectado, el cambio se propaga
 *      automáticamente a todas las superficies que lo usan.
 */

// ── Tipos base ────────────────────────────────────────────────────────────────

export type Lang = "es" | "en";

// ── Perfiles de cliente ───────────────────────────────────────────────────────
// Usados en Arena para que la IA juegue el rol del cliente con esta personalidad.

export const CLIENT_PROFILE_DESC: Record<string, string> = {
  analytical:  "Analítico: necesitas datos, precisión, proceso y evidencia antes de decidir. Haces preguntas técnicas. Rechazas vaguedades y argumentos emocionales.",
  emotional:   "Emocional: decides por confianza, conexión y sensación personal. Te influyen historias reales y la empatía del vendedor.",
  skeptical:   "Escéptico: desconfías por defecto. Cuestionas promesas, testimonios genéricos y claims inflados. Solo te convencen pruebas concretas y consistencia entre lo que se dice y lo que se demuestra.",
  cautious:    "Cauto: temes equivocarte. Buscas seguridad, validación externa y pasos reversibles. Pospones si percibes riesgo alto. La presión te aleja.",
  dominant:    "Dominante: quieres control, velocidad y autoridad. Interrumpes, marcas el ritmo y castigas la debilidad o la indecisión.",
  indecisive:  "Indeciso: te cuesta comprometerte. Das vueltas, cambias de opinión y necesitas guía clara para decidir.",
  negotiator:  "Negociador: presionas en precio, comparas alternativas, pides concesiones y usas la negociación como palanca principal.",
};

// ── Criterios de debrief por perfil ──────────────────────────────────────────
// Descripciones orientadas al coach/evaluador: qué penalizar si el vendedor
// no respondió correctamente al perfil de comprador en esta conversación.

export const DEBRIEF_CLIENT_PROFILE: Record<string, { es: string; en: string }> = {
  analytical: {
    es: "Analítico — exige datos, evidencia, metodología y respuestas directas. Penaliza si el vendedor no responde con concreción cuando el cliente pide pruebas o cifras.",
    en: "Analytical — demands data, evidence, methodology, and direct answers. Penalize if the seller fails to respond concretely when the client requests proof or numbers.",
  },
  emotional: {
    es: "Emocional — exige conexión personal, empatía y construcción de confianza. Penaliza argumentos fríos o transaccionales.",
    en: "Emotional — demands personal connection, empathy, and trust-building. Penalize cold or transactional arguments.",
  },
  skeptical: {
    es: "Escéptico — exige pruebas concretas y consistencia entre lo que se promete y lo que se demuestra. Penaliza claims genéricos, testimonios vagos o inconsistencias.",
    en: "Skeptical — demands concrete proof and consistency between claims and demonstrated facts. Penalize generic promises, vague testimonials, or inconsistencies.",
  },
  cautious: {
    es: "Cauto — exige reducción de riesgo percibido, validación externa y pasos reversibles. Penaliza presión o urgencia artificial.",
    en: "Cautious — demands risk reduction, external validation, and reversible steps. Penalize pressure tactics or artificial urgency.",
  },
  dominant: {
    es: "Dominante — exige que el vendedor mantenga el control, sea claro y firme. Penaliza si el vendedor cede la dirección de la conversación.",
    en: "Dominant — demands the seller stays in control, clear and firm. Penalize if the seller cedes the direction of the conversation.",
  },
  indecisive: {
    es: "Indeciso — exige guía clara, pasos simples y reducción de fricción. Penaliza si el vendedor deja opciones abiertas o ambigüedad.",
    en: "Indecisive — demands clear guidance, simple steps, and reduced friction. Penalize open options or ambiguity.",
  },
  negotiator: {
    es: "Negociador — exige que el vendedor ancle valor antes de hablar de precio. Penaliza concesiones tempranas o descuentos sin contraprestación.",
    en: "Negotiator — demands the seller anchors value before discussing price. Penalize early concessions or discounts without a trade-off.",
  },
};

// ── Perfiles de vendedor ──────────────────────────────────────────────────────
// Usados en Arena cuando el usuario juega como cliente y la IA hace de vendedor.

export const SELLER_PROFILE_DESC: Record<string, string> = {
  communicative: "Comunicativo: construyes relación con anécdotas y ejemplos. A veces te extiendes demasiado.",
  authoritative: "Autoritario: directo, asertivo, controlas la conversación, rebates objeciones con firmeza.",
  technical:     "Técnico: hablas de características y datos con detalle. Preciso pero a veces poco emocional.",
  passive:       "Pasivo: escuchas mucho, no presionas, esperas que el cliente llegue a sus conclusiones.",
  aggressive:    "Agresivo: presionas para cerrar, creas urgencia, no aceptas 'no' fácilmente.",
  consultive:    "Consultivo: haces muchas preguntas, entiendes necesidades primero y adaptas tu solución.",
};

// ── Niveles de dificultad ─────────────────────────────────────────────────────

export const DIFFICULTY_DESC: Record<string, string> = {
  easy:   "Pocas objeciones, abierto a escuchar.",
  normal: "Algunas objeciones válidas, necesitas buenos argumentos.",
  hard:   "Muchas objeciones, comparas con competencia, difícil de convencer.",
  brutal: "Escéptico, cuestionas todo, objeciones fuertes, solo cedes ante argumentos muy sólidos.",
};

// ── Presets de contexto de Arena ──────────────────────────────────────────────
// Inyectados en el system prompt de Arena según el preset elegido.

export const PRESET_SYSTEM_DESC: Record<string, { es: string; en: string }> = {
  immvest: {
    es: `MARCO DE VENTA — IMMVEST (inversión inmobiliaria en Alemania):
Immvest no vende pisos sueltos: vende oportunidades de inversión ya filtradas, revisadas y estructuradas para el inversor hispanohablante.
El cliente objetivo quiere construir patrimonio, mejorar su situación fiscal y comprar con financiación, sin gestionar por su cuenta la búsqueda, el análisis y la gestión del inmueble.
Activo típico: inmueble en Alemania ya alquilado, con análisis de ubicación, edificio, alquiler y potencial patrimonial.
Lógica financiera: conservar el capital propio al máximo. En perfiles adecuados se puede hablar de financiación del 100% del valor del inmueble (los gastos de compra van aparte y no están financiados automáticamente).
Cashflow negativo: NO es un invalidador automático. Puede equivaler a una aportación mensual controlada para construir patrimonio, versus inmovilizar más capital de golpe y quedarse descapitalizado.
Fiscalidad (AfA, intereses, gastos deducibles): forma parte del argumento comercial, pero no se vende como garantía cerrada ni promesa automática — se presenta como lógica real a validar según el perfil concreto del cliente.
Proceso de cierre: el siguiente paso concreto es una RESERVA con depósito de 1.500€ (se devuelve íntegro al firmar en notaría). El equipo financiero compara después condiciones entre más de 600 bancos alemanes. Si se aprueba financiación, se firma la compra. Una empresa de gestión se encarga del alquiler y la relación con el inquilino.
Objeciones comunes: cashflow negativo, tipos de interés altos, prefiero invertir en España, la ventaja fiscal no es segura, quiero pensarlo, tengo que hablarlo con mi pareja, no conozco la zona, la rentabilidad me parece baja.
Detectar turista vs comprador real: si el cliente solo quiere información sin intención de decidir, el vendedor debe saber cortar con elegancia en lugar de eternizar la videollamada.
La llamada es de tipo consultivo, estructurada, muy orientada al cierre — no una charla abierta. El objetivo es detectar encaje, filtrar intención real y, si encaja, mover hacia la reserva.`,
    en: `SALES FRAME — IMMVEST (real estate investment in Germany):
Immvest doesn't sell individual apartments: it sells pre-vetted, structured investment opportunities for Spanish-speaking investors.
Target client: professional who wants to build wealth, improve their tax situation and buy with financing, without managing the search, analysis and property management themselves.
Typical asset: already-rented apartment in Germany, analyzed for location, building quality, rent level and wealth-building potential.
Financial logic: minimize own capital at entry. For suitable profiles, financing up to 100% of the property value can be discussed (purchase costs are separate and not automatically financed).
Negative cashflow: NOT an automatic deal-killer. It can mean a controlled monthly contribution to build wealth, versus tying up more capital upfront and becoming illiquid.
Tax logic (AfA, interest, deductible costs): part of the commercial argument, but not sold as a guaranteed outcome — presented as real logic to validate per client profile.
Closing process: the concrete next step is a RESERVATION with a €1,500 deposit (fully refunded at notary signing). The financial team then compares offers from 600+ German banks. If financing is approved, the purchase is signed. A management company handles tenant relations.
Common objections: negative cashflow, high interest rates, I prefer Spain, the tax benefit isn't guaranteed, I want to think about it, I need to discuss with my partner, I don't know the area, the yield seems low.
Distinguish tourist vs real buyer: if client only wants information with no intention to decide, the seller should gracefully end the call rather than drag it out.
The call is consultative, structured, very close-oriented — not an open exploration. Goal: detect fit, filter real intent, and if it fits, move toward the reservation.`,
  },
  saas: {
    es: `MARCO DE VENTA — SAAS:
Software como servicio: demo, piloto, ROI, adopción interna, integración con herramientas existentes, proceso de aprobación técnico y directivo.
Objeciones típicas: ya tenemos otra herramienta y funciona suficientemente bien, el precio es alto para el equipo, el tiempo de implementación es un problema, necesito aprobación técnica o del equipo directivo, el cambio genera fricción interna.`,
    en: `SALES FRAME — SAAS:
Software as a service: demo, pilot, ROI, internal adoption, integration with existing tools, technical and executive approval process.
Common objections: we already have a tool that works well enough, the price is high, implementation time is a problem, I need technical or executive approval, switching creates internal friction.`,
  },
  b2b: {
    es: `MARCO DE VENTA — B2B:
Venta a empresa: propuesta formal, proceso interno de compra, múltiples decisores, presupuesto anual, timing y prioridades internas del comprador.
Objeciones típicas: no es el momento, tenemos que evaluarlo internamente con el comité, el precio está fuera del presupuesto actual, ya tenemos proveedor y no veo urgencia de cambiar, necesita aprobación de dirección.`,
    en: `SALES FRAME — B2B:
Business-to-business sale: formal proposal, internal buying process, multiple decision makers, annual budget, timing and internal priorities.
Common objections: it's not the right time, we need to evaluate it internally with the committee, the price is outside current budget, we already have a supplier and see no urgency to change, needs executive approval.`,
  },
  high_ticket: {
    es: `MARCO DE VENTA — HIGH TICKET:
Venta de alto valor personal o empresarial (>5.000€): precio, confianza personal, miedo a equivocarse en una decisión grande, urgencia real vs artificial, cierre más directo.
Objeciones típicas: es mucho dinero para algo que no sé si me va a funcionar, no sé si es para mí, quiero pensarlo más, prefiero esperar, hay opciones más baratas.
El vendedor ancla valor antes de hablar de precio. No hace descuentos. Maneja el miedo a la decisión y la falta de confianza, no solo la objeción de precio. La confianza en el vendedor o en el producto es muchas veces el freno real.`,
    en: `SALES FRAME — HIGH TICKET:
High-value personal or business sale (>€5,000): price, personal trust, fear of making a big wrong decision, real vs artificial urgency, more direct closing.
Common objections: that's a lot of money for something I'm not sure will work for me, I don't know if it's right for me, I want to think about it more, I'd rather wait, there are cheaper alternatives.
The seller anchors value before price. No discounts. Handles fear of commitment and lack of trust — not just the price objection. Trust in the seller or product is often the real blocker.`,
  },
  coaching: {
    es: `MARCO DE VENTA — COACHING / FORMACIÓN:
Venta de formación, mentoría individual o corporativa, coaching: resultados prometidos y demostrables, aplicabilidad real al caso concreto del cliente, desconfianza en el método, el coach o la transferencia real al trabajo.
Objeciones típicas: no tengo tiempo, ya lo intenté antes y no funcionó, ¿cómo sé que funciona para mi caso concreto?, es caro para lo que es, prefiero libros o YouTube, el equipo no va a aplicar lo que aprenda.`,
    en: `SALES FRAME — COACHING / TRAINING:
Sale of individual or corporate training, mentoring, or coaching: demonstrable promised results, real applicability to the client's specific situation, distrust of the method, coach, or real knowledge transfer.
Common objections: I don't have time, I tried it before and it didn't work, how do I know it works for my specific case?, it's expensive for what it is, I prefer books or YouTube, the team won't apply what they learn.`,
  },
  challenge: {
    es: `MARCO DE VENTA — CHALLENGE (venta creativa/imposible):
Escenario de práctica extremo o absurdo: vender algo que el cliente claramente no necesita o que parece imposible de venderle.
Ejemplos: paraguas en el desierto, clases de español a un hispanohablante nativo, bolígrafo a alguien que solo escribe en digital, hielo a un pescador con cámara frigorífica llena.
El vendedor debe encontrar ángulos creativos, inesperados y reales para intentar convencer. El cliente puede ceder si el vendedor encuentra el ángulo correcto. Resistencia inicial alta pero no cierre total si el argumento es realmente bueno.`,
    en: `SALES FRAME — CHALLENGE (creative/impossible sale):
Extreme or absurd practice scenario: selling something the client clearly doesn't need or that seems impossible to sell.
Examples: umbrella in the desert, English lessons to a native speaker, pen to someone who only writes digitally, ice to a fisherman with a full freezer.
The seller must find creative, unexpected and real angles to try to convince. The client can give in if the seller finds the right angle. High initial resistance but not total shutdown if the argument is genuinely good.`,
  },
};

// ── Taxonomía de objeciones y señales ─────────────────────────────────────────
// Fuente de verdad para clasificar cualquier momento de la conversación.
// Usada en Copilot (campo signal) y como referencia en Arena (debrief).

export interface ObjecionDef {
  label: string;
  description: string;
}

export const OBJECTION_TAXONOMY: Record<string, { es: ObjecionDef; en: ObjecionDef }> = {
  // ── Señales de duda inicial (antes de objeción formada) ──────────────────
  falta_familiaridad: {
    es: { label: "falta familiaridad",       description: "No conoce el activo, ciudad o marca. No rechaza, simplemente no conoce. Nunca es objeción reputacional automática." },
    en: { label: "lack of familiarity",      description: "Doesn't know the asset, city or brand. Not rejecting — just unfamiliar. Never auto-classify as reputational objection." },
  },
  duda_abierta: {
    es: { label: "duda abierta",             description: "Preocupación vaga, criterio no articulado todavía." },
    en: { label: "open doubt",               description: "Vague concern, criterion not yet articulated." },
  },
  necesita_criterio: {
    es: { label: "necesita criterio",        description: "No tiene marco para decidir. El trabajo es construirlo, no argumentar." },
    en: { label: "needs a framework",        description: "No decision framework. The job is to build it, not argue." },
  },
  falta_confianza: {
    es: { label: "falta confianza inicial",  description: "Escepticismo de entrada, no rechazo activo. Requiere construir credibilidad antes de argumentar." },
    en: { label: "initial distrust",         description: "Entry-level skepticism, not active rejection. Credibility must be built before arguing." },
  },
  objecion_incipiente: {
    es: { label: "objeción incipiente",      description: "Freno que empieza a surgir, no consolidado. Intervenir antes de que cristalice." },
    en: { label: "emerging objection",       description: "Barrier starting to form, not consolidated. Intervene before it crystallizes." },
  },
  // ── Objeciones formadas ───────────────────────────────────────────────────
  real: {
    es: { label: "objeción real",            description: "Freno genuino basado en criterio concreto. Hay que resolverla, no rodearla." },
    en: { label: "real objection",           description: "Genuine barrier based on concrete criterion. Must be resolved, not bypassed." },
  },
  superficial: {
    es: { label: "objeción superficial",     description: "Duda que se disipa con información o reencuadre. No requiere negociación." },
    en: { label: "superficial objection",    description: "Doubt that dissolves with information or reframing. No negotiation needed." },
  },
  falsa: {
    es: { label: "objeción falsa",           description: "Excusa que esconde otra objeción o falta de interés real. Detectar lo que hay detrás." },
    en: { label: "false objection",          description: "Excuse hiding another objection or lack of real interest. Uncover what's behind it." },
  },
  precio: {
    es: { label: "objeción de precio",       description: "El coste es el freno o el pretexto. Anclar valor antes de hablar de precio." },
    en: { label: "price objection",          description: "Cost is the barrier or pretext. Anchor value before discussing price." },
  },
  liquidez: {
    es: { label: "objeción de liquidez",     description: "Preocupación por poder deshacer la posición o acceder al capital. Distinta de precio." },
    en: { label: "liquidity objection",      description: "Concern about exiting the position or accessing capital. Different from price." },
  },
  timing: {
    es: { label: "objeción de timing",       description: "Dilación sin razón clara. Evaluar si hay razón real o si es evitación." },
    en: { label: "timing objection",         description: "Delay without clear reason. Evaluate if there's a real reason or avoidance." },
  },
  miedo_equivocarse: {
    es: { label: "miedo a equivocarse",      description: "Riesgo percibido alto, falta de confianza en la decisión, no en el producto." },
    en: { label: "fear of making wrong call",description: "High perceived risk, lack of confidence in the decision, not the product." },
  },
  desconfianza: {
    es: { label: "desconfianza activa",      description: "Escepticismo activo, posible experiencia previa negativa. Reconstruir desde datos concretos." },
    en: { label: "active distrust",          description: "Active skepticism, possible negative prior experience. Rebuild with concrete evidence." },
  },
  resistencia_emocional: {
    es: { label: "resistencia emocional",    description: "Rechazo no basado en criterio racional. Cambiar de eje antes de argumentar." },
    en: { label: "emotional resistance",     description: "Non-rational rejection. Change axis before arguing." },
  },
  reputacion: {
    es: { label: "objeción reputacional",    description: "Solo cuando la crítica al proveedor/zona ya está articulada explícitamente. No inferir." },
    en: { label: "reputational objection",   description: "Only when the criticism is explicitly articulated. Do not infer." },
  },
  cierre_con_resistencia: {
    es: { label: "interés real, frena cierre", description: "Le interesa pero no da el paso. El freno es el compromiso, no el producto." },
    en: { label: "real interest, stalls close", description: "Genuine interest but won't commit. Barrier is the step, not the product." },
  },
};

// Versión compacta del bloque de taxonomía para inyectar directamente en prompts.
export const OBJECTION_TAXONOMY_BLOCK: Record<Lang, string> = {
  es: `CLASIFICACIÓN — duda inicial: falta_familiaridad | duda_abierta | necesita_criterio | falta_confianza | objeción_incipiente
Objeción formada: real | superficial | falsa | precio | liquidez | timing | cierre_con_resistencia | miedo_equivocarse | desconfianza | resistencia_emocional | reputación(solo si articulada)
Regla: "no conozco/no me suena" sin rechazar = falta_familiaridad, nunca objeción reputacional automática.`,
  en: `CLASSIFICATION — initial doubt: lack_familiarity | open_doubt | needs_framework | initial_distrust | emerging_objection
Formed objection: real | superficial | false | price | liquidity | timing | close_resistance | fear_wrong_call | active_distrust | emotional_resistance | reputational(only if articulated)
Rule: "I don't know it / never heard of it" without rejecting = lack_familiarity, never auto-classify as reputational.`,
};

// ── Etapas del journey comercial ──────────────────────────────────────────────
// Modelo de 6 fases compartido entre Copilot y Arena.
// Copilot usa el vocabulario para journey.now; Arena lo usa en coach-lite.

export type JourneyStageId = "context" | "problem" | "blocker" | "fit" | "advance" | "close";

export interface JourneyStageDef {
  label: { es: string; en: string };
  description: { es: string; en: string };
}

export const JOURNEY_STAGES: Record<JourneyStageId, JourneyStageDef> = {
  context: {
    label:       { es: "contexto",         en: "context" },
    description: { es: "Entender la situación del cliente, su perfil y sus objetivos antes de diagnosticar.", en: "Understand the client's situation, profile and goals before diagnosing." },
  },
  problem: {
    label:       { es: "problema",         en: "problem" },
    description: { es: "Identificar el dolor, necesidad o objetivo real que motiva la conversación.", en: "Identify the real pain, need or goal driving the conversation." },
  },
  blocker: {
    label:       { es: "bloqueo",          en: "blocker" },
    description: { es: "Detectar y trabajar la objeción, duda o freno principal que impide avanzar.", en: "Detect and work through the main objection, doubt or barrier blocking progress." },
  },
  fit: {
    label:       { es: "encaje",           en: "fit" },
    description: { es: "Conectar la solución con el criterio real del cliente. Validar que hay encaje antes de cerrar.", en: "Connect the solution to the client's real criterion. Validate fit before closing." },
  },
  advance: {
    label:       { es: "avance",           en: "advance" },
    description: { es: "Conseguir un microcompromiso o siguiente paso concreto que mueva la conversación.", en: "Secure a micro-commitment or concrete next step that moves the conversation forward." },
  },
  close: {
    label:       { es: "cierre",           en: "close" },
    description: { es: "Proponer el cierre solo cuando: objeción resuelta, interés real, sin frentes abiertos, conversación madura.", en: "Propose close only when: objection resolved, real interest, no open fronts, conversation mature." },
  },
};

// ── Criterios de cierre ────────────────────────────────────────────────────────
// Cuándo está permitido recomendar o ejecutar un cierre.
// Shared between Copilot (cierre field) and Arena seller (closing logic).

export const CLOSING_CRITERIA_BLOCK: Record<Lang, string> = {
  es: `CIERRE: solo si se cumplen TODAS:
✓ Objeción principal suficientemente resuelta o aclarada
✓ Señales de interés real manifiestas
✓ Sin frentes importantes abiertos
✓ La conversación ha madurado
✓ El siguiente paso natural es un microcompromiso
Con objeción activa, duda difusa, resistencia o falta de criterio: NO cerrar.`,
  en: `CLOSE: only when ALL of these are true:
✓ Main objection sufficiently resolved or clarified
✓ Genuine interest signals present
✓ No significant open fronts
✓ The conversation has matured
✓ The natural next step is a micro-commitment
With active objection, diffuse doubt, resistance or no criterion: do NOT close.`,
};

// ── Anti-patrones tácticos ────────────────────────────────────────────────────
// Errores frecuentes que degradan la calidad comercial de una conversación.
// Inyectados en el prompt del vendedor de Arena y referenciados en Copilot.

export const SALES_ANTIPATTERNS_BLOCK: Record<Lang, string> = {
  es: `PROHIBIDO:
— Usar como argumento principal algo que el cliente ya aceptó
— Abrir con "entiendo tu preocupación", "es una pregunta muy válida", "totalmente comprensible" o equivalentes
— Preguntas genéricas de relleno que no diagnostican nada concreto
— Insistir con beneficios laterales cuando el cliente tiene un bloqueo central sin resolver
— Usar "explorar", "optimizar", "maximizar" o "potencial" sin concretar inmediatamente qué cambiaría, en qué cantidad y si es realista
— Proponer cambios que ya dijiste que son imposibles o que el contexto excluye
— Retomar un marco que el cliente rechazó explícitamente (largo plazo, revalorización, ventaja fiscal, etc.) aunque sea con otras palabras
— Repetir en el siguiente turno una conclusión que ya dijiste de forma clara en el anterior
— Cerrar o proponer siguiente paso antes de resolver la objeción principal`,
  en: `FORBIDDEN:
— Using as main argument something the client already accepted
— Opening with "I understand your concern", "that's a great question", "totally understandable" or equivalents
— Generic filler questions that diagnose nothing concrete
— Pushing side benefits when the client has an unresolved central blocker
— Using "explore", "optimize", "maximize" or "potential" without immediately specifying what would change, by how much and if it's realistic
— Proposing changes you already said were impossible or that the context excludes
— Reviving a frame the client explicitly rejected (long term, appreciation, tax benefits, etc.) even with different words
— Repeating in the next turn a conclusion you already stated clearly in the previous one
— Closing or proposing a next step before resolving the main objection`,
};

// ── Regla de comparaciones ────────────────────────────────────────────────────
// Cuando el cliente menciona una alternativa, la alternativa revela el criterio.

export const COMPARISON_RULE_BLOCK: Record<Lang, string> = {
  es: `COMPARACIONES: si mencionan alternativa → identifica primero el CRITERIO que valoran, no entres en comparación directa. Si ya enumeraron atributos de la alternativa → PROHIBIDO preguntar qué valoran de X. Esos atributos son la respuesta. Tradúcelos al activo actual y avanza.`,
  en: `COMPARISONS: if they mention an alternative → first identify the CRITERION they value, don't enter direct comparison. If they already listed attributes of the alternative → FORBIDDEN to ask what they value about X. Those attributes are the answer. Translate them to the current asset and move forward.`,
};

// ── Heurísticas de decisión comercial ────────────────────────────────────────
// Reglas de decisión reutilizables — el núcleo de las "mini-formaciones".
// Cada entrada describe una condición y la acción correcta.
// Para añadir una nueva mini-formación: añadir entrada aquí + entrada en changelog.

export interface SalesHeuristic {
  condition: { es: string; en: string };
  action:    { es: string; en: string };
}

export const SALES_HEURISTICS: SalesHeuristic[] = [
  {
    condition: { es: "La objeción se repite dos o más veces con la misma estructura", en: "The objection repeats two or more times with the same structure" },
    action:    { es: "Deja de argumentar por los lados. Ve al umbral: pregunta exactamente qué tendría que cambiar para que la operación tuviera sentido.", en: "Stop arguing sideways. Go to the threshold: ask exactly what would need to change for the deal to make sense." },
  },
  {
    condition: { es: "El cliente acepta la tesis general pero rechaza el esfuerzo mensual o el coste recurrente", en: "Client accepts the general thesis but rejects the monthly cost or recurring effort" },
    action:    { es: "El bloqueo es tolerancia de caja, no de valor. Trabaja el umbral de aportación, no la propuesta de valor.", en: "The block is cash tolerance, not value. Work the contribution threshold, not the value proposition." },
  },
  {
    condition: { es: "Aparece pareja, asesor, comité o tercero en la conversación", en: "Partner, advisor, committee or third party appears in the conversation" },
    action:    { es: "Aumenta el riesgo de no-decisión. Propón implicar al tercero lo antes posible o cierra un microcompromiso antes de que se enfríe.", en: "Non-decision risk increases. Propose involving the third party ASAP or close a micro-commitment before it goes cold." },
  },
  {
    condition: { es: "El cliente ya compró el argumento de largo plazo y lo tiene integrado", en: "Client has already bought the long-term argument and integrated it" },
    action:    { es: "No volver a vender largo plazo. Ya está. Cambia al siguiente freno.", en: "Don't resell the long-term angle. It's sold. Move to the next barrier." },
  },
  {
    condition: { es: "No hay encaje real entre lo que el cliente necesita y lo que se ofrece", en: "No real fit between what the client needs and what is offered" },
    action:    { es: "Descarta con autoridad. Una conversación honesta sobre el no-encaje genera más confianza que seguir vendiendo algo que no cuadra.", en: "Disqualify with authority. An honest conversation about misfit builds more trust than continuing to sell something that doesn't fit." },
  },
  {
    condition: { es: "El cliente menciona una alternativa (ciudad, producto, proveedor)", en: "Client mentions an alternative (city, product, competitor)" },
    action:    { es: "La alternativa revela el criterio, no es el problema en sí. Identifica qué valora de ella antes de entrar en comparación directa.", en: "The alternative reveals the criterion, it's not the problem itself. Identify what they value about it before entering direct comparison." },
  },
  {
    condition: { es: "El cliente define un umbral concreto (precio máximo, aportación máxima, condición)", en: "Client defines a concrete threshold (max price, max contribution, condition)" },
    action:    { es: "Ese umbral es ahora el eje de la conversación. No lo ignores, no lo diluyas. Trabaja si el gap es cerrable o reconoce que no lo es.", en: "That threshold is now the axis of the conversation. Don't ignore it or dilute it. Work whether the gap is closeable or acknowledge that it isn't." },
  },
  {
    condition: { es: "El cliente dice 'no conozco la zona / no me suena / no tengo referencias' sin rechazar activamente", en: "Client says 'I don't know the area / never heard of it / no references' without active rejection" },
    action:    { es: "Es falta de familiaridad, no objeción reputacional. No defiendas el activo aún. Concreta el criterio de duda primero.", en: "It's lack of familiarity, not a reputational objection. Don't defend the asset yet. Clarify the doubt criterion first." },
  },
  {
    condition: { es: "El cliente evita responder directamente a una pregunta clave", en: "Client avoids answering a key question directly" },
    action:    { es: "Detecta la evasión. Decide si presionar (objeción oculta) o rodear (falta de criterio). No avances como si hubiera respondido.", en: "Detect the evasion. Decide whether to press (hidden objection) or go around (lack of criterion). Don't proceed as if they answered." },
  },
  {
    condition: { es: "El cliente está cerca del cierre pero pide más tiempo o más información sin razón concreta", en: "Client is close to closing but asks for more time or information without a concrete reason" },
    action:    { es: "El freno es el compromiso, no la información. Propón un microcompromiso reversible para reducir el salto percibido.", en: "The barrier is commitment, not information. Propose a reversible micro-commitment to reduce the perceived leap." },
  },
];

// Versión compacta del bloque de heurísticas para inyectar en prompts si se necesita.
export function buildHeuristicsBlock(lang: Lang): string {
  return SALES_HEURISTICS.map((h, i) =>
    `${i + 1}. SI: ${h.condition[lang]} → ${h.action[lang]}`
  ).join("\n");
}
