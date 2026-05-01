# Prompt para Replit Agent — Business Brain Immvest

En el archivo `lib/sales-brain/src/index.ts`, reemplaza el bloque `immvest` dentro de `PRESET_SYSTEM_DESC` (desde la línea que empieza con `immvest: {` hasta la siguiente clave del objeto) con este contenido exacto:

```typescript
  immvest: {
    es: `BUSINESS BRAIN — IMMVEST (inversión inmobiliaria en Alemania)

═══ PROCESO COMERCIAL (10 fases) ═══
Fase 1 Cualificación: filtrar turistas, medir intención real, pedir finance check o agendar asesoría.
Fase 2 Asesoría: descubrir motivación, posicionar Immvest, decidir si merece la pena seguir.
Fase 3 Follow-up: recuperar contexto, aislar freno vivo, confirmar intención.
Fase 4 Propuesta real: presentar activo con orden obligatorio (macro ciudad → micro zona → edificio → vivienda → alquiler → números → encaje), resolver objeciones del activo.
Fase 5 Reserva 1.500€: aislar objeción final y decidir. Depósito devuelto íntegro en notaría.
Fase 6-7 Financiación: sostener confianza, equipo financiero compara 600+ bancos alemanes.
Fase 8 Visita: validar coherencia entre expectativa y realidad.
Fase 9-10 Notaría y Postventa: cierre formal y relación futura.

Outcome válido por fase: no siempre es cierre. En cualificación: filtrar o agendar. En asesoría: confirmar encaje o pasar a propuesta. En propuesta: reserva o follow-up corto. En financiación: continuidad o caída legítima.

═══ PERFIL DEL CLIENTE TÍPICO ═══
Inversor español, 35-60 años, 150K-500K€ líquidos. Motivaciones: construir patrimonio, optimización fiscal, diversificación. Miedos: desconocer Alemania, cashflow negativo, tipos de interés, confiar en empresa española para activo en el extranjero. Alternativas que considera: depósitos bancarios, SOCIMIs, inmueble en España, fondos de inversión.

═══ LÓGICA FINANCIERA CLAVE ═══
Cashflow negativo NO es invalidador automático: es aportación mensual controlada para construir patrimonio vs inmovilizar capital de golpe. Financiación posible hasta 100% del valor del inmueble (gastos de compra aparte, no financiados). Fiscalidad AfA, intereses y gastos deducibles: argumento comercial real, no promesa garantizada.

═══ MAPA DE OBJECIONES (lectura en 4 capas) ═══
Para cada objeción detectar: [aparente] frase visible | [real] lo que frena de verdad | [motivación] qué protege | [movimiento] qué toca hacer.

PRECIO/RENTABILIDAD: aparente="la rentabilidad es baja" | real=no entiende la lógica patrimonial vs yield puro | motivación=seguridad, no perder | movimiento=reencuadrar: no compra yield, compra patrimonio financiado con renta.
CASHFLOW NEGATIVO: aparente="tengo que poner dinero cada mes" | real=miedo a descapitalizarse | motivación=control financiero | movimiento=cuantificar: ¿cuánto es? ¿vs qué alternativa? ¿qué patrimonio construye?
FINANCIACIÓN/INTERESES: aparente="los tipos están muy altos" | real=no ve que el diferencial sigue siendo positivo | motivación=no endeudarse en mal momento | movimiento=comparar con alternativa real, no con tipos históricos.
FISCALIDAD: aparente="no estoy seguro de la ventaja fiscal" | real=miedo a promesa vacía | motivación=no quiere sorpresas | movimiento=separar lógica real (AfA existe, deducibles existen) de promesa garantizada.
ZONA/CIUDAD: aparente="no conozco esa zona" | real=no confía en el criterio de selección | motivación=control, no comprar a ciegas | movimiento=explicar el filtro: por qué esa ciudad, esa zona, ese edificio.
ALQUILER/INQUILINO: aparente="¿y si no pagan o se van?" | real=miedo a gestión y vacío de renta | motivación=tranquilidad operativa | movimiento=empresa de gestión se encarga, riesgo de vacío es bajo en mercado alemán tensionado.
MOMENTO/INDECISIÓN: aparente="tengo que pensarlo" | real=objeción no verbalizada todavía | motivación=evitar error | movimiento=aislar: ¿qué es exactamente lo que falta resolver? Si resolvemos eso, ¿el resto encaja?
TERCEROS: aparente="tengo que hablarlo con mi pareja/socio" | real=puede ser real o excusa | motivación=compartir responsabilidad de decisión | movimiento=agendar siguiente reunión con tercero presente, o aislar si es excusa.
COMPARACIÓN ESPAÑA: aparente="prefiero invertir en España" | real=sesgo de familiaridad | motivación=control, lo que conoce | movimiento=no atacar España. Reencuadrar: ¿para qué invertiría? ¿eso lo consigue mejor aquí o allá?
CONFIANZA: aparente="no os conozco" | real=riesgo percibido alto | motivación=seguridad | movimiento=proceso, referencias, reserva devuelta, equipo financiero independiente.

═══ CRITERIOS DE CIERRE ═══
Una conversación buena termina en: CIERRE | SIGUIENTE PASO CONCRETO | DESCARTE CLARO.
Nunca en: "ya me dices" / "lo pensamos" / "hablamos" / "te lo mando y me cuentas".
El siguiente paso concreto mínimo es: fecha de próxima reunión + qué se decide en ella.
El paso máximo es: reserva de 1.500€.

═══ ERRORES DEL VENDEDOR A DETECTAR ═══
Sobreexplicar antes de entender el criterio del cliente.
Responder a objeción aparente sin leer la real.
Aceptar el marco del cliente sin filtrarlo.
Meter 4 argumentos cuando 1 bastaba.
Preguntar "¿qué te parece?" en lugar de leer el valor comprado.
Dejar la llamada flotando sin siguiente paso concreto.
Empujar cierre antes de haber aislado el freno dominante.
Fingir que encaja cuando no encaja.

═══ PREGUNTAS DE AISLAMIENTO QUE FUNCIONAN ═══
"¿Qué es exactamente lo que más duda te genera ahora mismo?"
"Aparte de eso, ¿hay algo más que te esté frenando?"
"Si resolvemos ese punto, ¿el resto te encaja?"
"¿Esto compite contra qué en tu cabeza?"
"¿Qué tendría que ser verdad para que tuviese sentido seguir adelante?"`,

    en: `BUSINESS BRAIN — IMMVEST (real estate investment in Germany)

═══ COMMERCIAL PROCESS (10 phases) ═══
Phase 1 Qualification: filter tourists, gauge real intent, request finance check or schedule advisory.
Phase 2 Advisory: uncover motivation, position Immvest, decide whether to proceed.
Phase 3 Follow-up: recover context, isolate live blocker, confirm intent.
Phase 4 Real Proposal: present asset in mandatory order (macro city → micro area → building → unit → rental → numbers → fit), handle asset objections.
Phase 5 Reservation €1,500: isolate final objection and decide. Deposit fully refunded at notary.
Phases 6-7 Financing: maintain trust, financial team compares 600+ German banks.
Phase 8 Visit: validate alignment between expectation and reality.
Phases 9-10 Notary and Post-sale: formal close and future relationship.

Valid outcome per phase: not always a close. In qualification: filter or schedule. In advisory: confirm fit or advance to proposal. In proposal: reservation or short follow-up. In financing: continuity or legitimate exit.

═══ TYPICAL CLIENT PROFILE ═══
Spanish investor, 35-60 years old, €150K-500K liquid. Motivations: wealth building, tax optimization, diversification. Fears: unfamiliarity with Germany, negative cashflow, interest rates, trusting a Spanish company for an overseas asset. Alternatives considered: bank deposits, REITs, Spanish property, investment funds.

═══ KEY FINANCIAL LOGIC ═══
Negative cashflow is NOT an automatic deal-killer: it is a controlled monthly contribution to build wealth vs tying up capital upfront. Financing possible up to 100% of property value (purchase costs separate, not automatically financed). Tax logic (AfA, interest, deductible costs): real commercial argument, not a guaranteed promise.

═══ OBJECTION MAP (4-layer reading) ═══
For each objection detect: [apparent] visible phrase | [real] what actually blocks | [motivation] what they're protecting | [move] what to do.

PRICE/YIELD: apparent="yield is low" | real=doesn't understand wealth-building vs pure yield | motivation=safety | move=reframe: not buying yield, buying financed wealth.
NEGATIVE CASHFLOW: apparent="I have to put in money monthly" | real=fear of becoming illiquid | motivation=financial control | move=quantify: how much? vs what alternative? what wealth does it build?
FINANCING/RATES: apparent="rates are too high" | real=doesn't see the spread is still positive | motivation=don't borrow in bad timing | move=compare to real alternative, not historical rates.
TAX: apparent="I'm not sure about the tax benefit" | real=fear of empty promises | motivation=no surprises | move=separate real logic (AfA exists, deductibles exist) from guaranteed outcome.
LOCATION: apparent="I don't know that area" | real=doesn't trust the selection criteria | motivation=control | move=explain the filter: why that city, area, building.
RENTAL/TENANT: apparent="what if they don't pay?" | real=fear of management and vacancy | motivation=operational peace of mind | move=management company handles it, vacancy risk low in tight German market.
TIMING/INDECISION: apparent="I need to think about it" | real=unverbalized objection | motivation=avoid mistake | move=isolate: what exactly is missing? If we solve that, does the rest fit?
THIRD PARTIES: apparent="I need to discuss with my partner" | real=may be genuine or excuse | motivation=shared responsibility | move=schedule next meeting with partner present, or isolate if excuse.
SPAIN COMPARISON: apparent="I prefer investing in Spain" | real=familiarity bias | motivation=control | move=don't attack Spain. Reframe: what would you invest for? Does Spain deliver that better?
TRUST: apparent="I don't know you" | real=high perceived risk | motivation=safety | move=process, references, refundable deposit, independent financial team.

═══ CLOSING CRITERIA ═══
A good conversation ends in: CLOSE | CONCRETE NEXT STEP | CLEAR DISCARD.
Never in: "let me know" / "we'll think about it" / "send it over and we'll chat".
Minimum concrete next step: date of next meeting + what gets decided there.
Maximum step: €1,500 reservation.

═══ SELLER ERRORS TO DETECT ═══
Over-explaining before understanding client's criterion.
Responding to apparent objection without reading the real one.
Accepting the client's frame without filtering it.
Giving 4 arguments when 1 would suffice.
Asking "what do you think?" instead of reading value purchased.
Leaving the call floating without a concrete next step.
Pushing close before isolating the dominant blocker.
Pretending it fits when it doesn't.

═══ ISOLATION QUESTIONS THAT WORK ═══
"What exactly is generating the most doubt for you right now?"
"Apart from that, is there anything else holding you back?"
"If we solve that point, does the rest fit?"
"What is this competing against in your head?"
"What would need to be true for this to make sense to move forward?"`,
  },
```

No toques ninguna otra clave del objeto PRESET_SYSTEM_DESC. Solo reemplaza el bloque `immvest`.
