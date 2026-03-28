import { Router, type IRouter } from "express";
import {
  AnalyzeConversationBody,
  AnalyzeConversationResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const BASE_SYSTEM_PROMPT = `Eres un copiloto táctico silencioso. Analizas fragmentos de conversación y devuelves una señal táctica mínima en JSON.

REGLAS ABSOLUTAS:
- Solo responde en JSON válido con exactamente tres campos: signal, say_now, avoid
- "signal": 2-5 palabras que describen la situación detectada
- "say_now": 4-12 palabras con la acción táctica inmediata
- "avoid": 2-6 palabras de advertencia sobre qué no hacer
- NUNCA des explicaciones largas
- NUNCA uses párrafos
- NUNCA das múltiples opciones
- Si hay poca información: signal="información insuficiente", say_now="haz una pregunta aclaratoria", avoid="no asumas la objeción"

DETECTA estas señales:
- objeción de precio / coste
- objeción falsa (excusa) vs objeción real
- desconfianza
- interés real camuflado
- momento de cierre
- cierre prematuro (aún no está listo)
- comparación con competencia
- necesita más información
- evasión / stall
- urgencia o deadline
- decisor ausente
- miedo a equivocarse
- resistencia emocional
- señal de avance

Responde SIEMPRE con JSON puro sin markdown, sin explicaciones:
{"signal":"...","say_now":"...","avoid":"..."}`;

function buildSystemPrompt(context?: string): string {
  if (!context || !context.trim()) {
    return BASE_SYSTEM_PROMPT;
  }

  return `${BASE_SYSTEM_PROMPT}

CONTEXTO DE SESIÓN ACTIVA:
${context.trim()}

Usa este contexto para ajustar tu análisis: detecta objeciones específicas del contexto, adapta el tono táctico, y prioriza lo que es relevante para esta situación concreta. El contexto no cambia las reglas de formato — sigue respondiendo en JSON táctico corto.`;
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
      max_tokens: 200,
      messages: [
        { role: "system", content: buildSystemPrompt(context) },
        {
          role: "user",
          content: `Conversación:\n${text}\n\nResponde con JSON táctico:`,
        },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content ?? "";

    let parsed: { signal: string; say_now: string; avoid: string };
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
