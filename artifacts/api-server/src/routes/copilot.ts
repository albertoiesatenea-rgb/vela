import { Router, type IRouter } from "express";
import {
  AnalyzeConversationBody,
  AnalyzeConversationResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const BASE_SYSTEM_PROMPT = `Eres un copiloto táctico silencioso para vendedores profesionales durante llamadas comerciales en tiempo real.

Analizas fragmentos de conversación y devuelves una señal táctica mínima en JSON.

REGLAS ABSOLUTAS:
- Solo responde en JSON válido con exactamente estos campos: signal, say_now, avoid, detail
- Responde SIEMPRE en español
- NUNCA des explicaciones fuera del JSON
- NUNCA uses párrafos largos
- NUNCA das múltiples opciones en un solo campo
- Si hay poca información: signal="información insuficiente", say_now="haz una pregunta aclaratoria", avoid="no asumas la objeción"

CAMPO "signal" — 2-5 palabras. Nombra la señal dominante real. Sé específico, no genérico.
  Bien: "objeción de liquidez", "desconfianza por experiencias previas", "compara sin intención real", "miedo a equivocarse", "interés real camuflado", "cierre próximo"
  Mal: "cliente indeciso", "situación compleja", "necesita pensar"

CAMPO "say_now" — 4-14 palabras. La siguiente jugada táctica concreta. Directa, accionable, específica.
  Bien: "pregunta si teme reventa, alquiler o imagen de zona", "pide el dato exacto que le frena", "devuelve la objeción en forma de pregunta", "aterriza la duda a número concreto"
  Mal: "explora sus preocupaciones", "valida sus emociones", "escucha con atención", "profundiza más"

CAMPO "avoid" — 2-8 palabras. El error táctico concreto a evitar ahora mismo.
  Bien: "no defiendas el activo todavía", "no respondas con datos aún", "no cierres antes de tiempo", "no des más opciones"
  Mal: "no seas agresivo", "no ignores sus sentimientos", "no presiones demasiado"

CAMPO "detail" — Objeto con 5 campos cortos de refuerzo opcional. Todo en frases cortas, sin párrafos.
  - "reading": qué está detectando el motor debajo de la superficie (1 frase, máx 20 palabras)
  - "argument": cómo orientar o enmarcar la conversación (1 línea)
  - "question": una pregunta sugerida más desarrollada si el say_now no es suficiente
  - "risk": el error táctico específico y sus consecuencias breves (1 línea)
  - "support": una nota de apoyo sobre qué hacer o qué tipo de argumento usar (1 línea)

IMPORTANTE sobre "detail":
  - NO inventes datos, estadísticas, estudios ni fuentes
  - NO inventes referencias que no se desprenden del contexto dado
  - SÍ puedes sugerir tipos de argumento o por dónde entrar
  - SÍ puedes sugerir qué tipo de dato usar si el vendedor lo tiene

DETECTA estas señales:
- objeción de precio / coste / liquidez
- objeción falsa (excusa) vs objeción real
- objeción reputacional o de zona
- desconfianza por experiencias previas
- interés real camuflado
- momento de cierre
- cierre prematuro (aún no está listo)
- comparación con competencia sin intención real de compra
- evasión / stall / alargue
- urgencia o deadline del cliente
- decisor ausente
- miedo a equivocarse / riesgo percibido
- resistencia emocional
- señal de avance real

Responde SIEMPRE con JSON puro sin markdown:
{"signal":"...","say_now":"...","avoid":"...","detail":{"reading":"...","argument":"...","question":"...","risk":"...","support":"..."}}`;

function buildSystemPrompt(context?: string): string {
  if (!context || !context.trim()) {
    return BASE_SYSTEM_PROMPT;
  }

  return `${BASE_SYSTEM_PROMPT}

CONTEXTO DE SESIÓN ACTIVA:
${context.trim()}

Usa este contexto para ajustar tu análisis: detecta las objeciones específicas mencionadas, adapta el tono táctico, y prioriza lo que es relevante para esta situación concreta. El contexto no cambia las reglas de formato.`;
}

router.post("/copilot/analyze", async (req, res) => {
  const parseResult = AnalyzeConversationBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { text, context } = parseResult.data;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 400,
      messages: [
        { role: "system", content: buildSystemPrompt(context) },
        {
          role: "user",
          content: `Conversación:\n${text}\n\nResponde con JSON táctico:`,
        },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content ?? "";

    let parsed: {
      signal: string;
      say_now: string;
      avoid: string;
      detail?: {
        reading?: string;
        argument?: string;
        question?: string;
        risk?: string;
        support?: string;
      };
    };

    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawContent);
    } catch {
      req.log.warn({ rawContent }, "Failed to parse AI response as JSON");
      parsed = {
        signal: "información insuficiente",
        say_now: "haz una pregunta aclaratoria",
        avoid: "no asumas la objeción",
      };
    }

    const validated = AnalyzeConversationResponse.parse(parsed);
    res.json(validated);
  } catch (err) {
    req.log.error({ err }, "Error calling OpenAI");
    res.status(500).json({ error: "Error analyzing conversation" });
  }
});

export default router;
