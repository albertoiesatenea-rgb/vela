import { Router, type IRouter } from "express";
import {
  AnalyzeConversationBody,
  AnalyzeConversationResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const SYSTEM_PROMPT = `Eres un copiloto táctico de ventas. Tu misión es analizar fragmentos de conversación comercial y devolver una señal táctica mínima.

REGLAS ABSOLUTAS:
- Solo responde en JSON válido con exactamente tres campos: signal, say_now, avoid
- "signal": 2-5 palabras que describen la situación detectada
- "say_now": 4-12 palabras con la acción táctica inmediata
- "avoid": 2-6 palabras de advertencia sobre qué no hacer
- NUNCA des explicaciones largas
- NUNCA uses párrafos
- NUNCA das múltiples opciones
- Si hay poca información: signal="información insuficiente", say_now="haz una pregunta aclaratoria", avoid="no asumas la objeción"

DETECTA estas señales de ventas:
- objeción de precio / coste
- objeción falsa (excusa) vs objeción real
- desconfianza en el producto o en ti
- interés real camuflado
- momento de cierre (señales de compra)
- cierre prematuro (aún no está listo)
- comparación con competencia
- necesita más información
- stall / evasión del prospect
- urgencia o deadline del prospect
- decisor no presente

Responde SIEMPRE con JSON puro sin markdown, sin explicaciones:
{"signal":"...","say_now":"...","avoid":"..."}`;

router.post("/copilot/analyze", async (req, res) => {
  const parseResult = AnalyzeConversationBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { text } = parseResult.data;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
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
