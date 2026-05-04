interface PrebriefLogContext {
  detected_phase: string;
  call_type: string;
  today_decision: string;
  what_client_knows: string[];
  main_blocker_probable: string;
  valid_outcome_today: string;
  confidence: string;
  context_for_brief: string;
  special_context_flags?: string[];
  decision_constraints?: string[];
  case_specific_risks?: string[];
}

interface PrebriefLogScript {
  real_call_goal: string;
  must_get_today: string[];
  expected_objections: { objection: string; why_likely: string; how_to_handle: string }[];
  mistakes_to_avoid: string[];
  suggested_call_structure: string[];
  suggested_opening: string;
  suggested_next_step_close: string;
  brief_for_live: string;
}

export interface PrebriefLogInput {
  brainId: string | null;
  rawInput: string;
  interpreted: PrebriefLogContext | null;
  confirmed: PrebriefLogContext | null;
  contextConfirmed: boolean;
  userEditedContext: boolean;
  briefingGenerated: boolean;
  briefing: PrebriefLogScript | null;
}

function listItem(value: string): string {
  return `- ${value}`;
}

function listItems(items: string[]): string {
  if (!items.length) return "- (ninguno)";
  return items.map(listItem).join("\n");
}

function sectionHeader(title: string): string {
  return `\n## ${title}\n`;
}

function subHeader(title: string): string {
  return `\n### ${title}\n`;
}

function renderContext(ctx: PrebriefLogContext): string {
  const knows = Array.isArray(ctx.what_client_knows)
    ? ctx.what_client_knows.join(" / ")
    : String(ctx.what_client_knows);

  return [
    `- **Fase detectada:** ${ctx.detected_phase}`,
    `- **Tipo de llamada:** ${ctx.call_type}`,
    `- **Qué se decide hoy:** ${ctx.today_decision}`,
    `- **Qué sabe el cliente:** ${knows}`,
    `- **Bloqueo probable:** ${ctx.main_blocker_probable}`,
    `- **Outcome válido hoy:** ${ctx.valid_outcome_today}`,
    `- **Confianza:** ${ctx.confidence}`,
    `- **Contexto para VELA:** ${ctx.context_for_brief}`,
  ].join("\n");
}

export function renderPrebriefLogMarkdown(input: PrebriefLogInput): string {
  const now = new Date();
  const isoTimestamp = now.toISOString();

  const lines: string[] = [];

  lines.push("# PREBRIEF LOG — VELA\n");

  lines.push(sectionHeader("META"));
  lines.push(`- **created_at:** ${isoTimestamp}`);
  lines.push(`- **brain_id:** ${input.brainId ?? "desconocido"}`);
  lines.push(`- **mode:** copilot`);
  lines.push(`- **context_confirmed:** ${input.contextConfirmed ? "yes" : "no"}`);
  lines.push(`- **briefing_generated:** ${input.briefingGenerated ? "yes" : "no"}`);
  lines.push(`- **user_edited_context:** ${input.userEditedContext ? "yes" : "no"}`);

  lines.push(sectionHeader("RAW INPUT"));
  lines.push(input.rawInput.trim() || "(vacío)");

  lines.push(sectionHeader("INTERPRETED CONTEXT"));
  if (input.interpreted) {
    lines.push(renderContext(input.interpreted));
  } else {
    lines.push("No interpretado todavía.");
  }

  const hasSignals =
    (input.interpreted?.special_context_flags?.length ?? 0) > 0 ||
    (input.interpreted?.decision_constraints?.length ?? 0) > 0 ||
    (input.interpreted?.case_specific_risks?.length ?? 0) > 0;

  if (hasSignals && input.interpreted) {
    lines.push(sectionHeader("STRUCTURAL SIGNALS"));

    lines.push(subHeader("special_context_flags"));
    lines.push(listItems(input.interpreted.special_context_flags ?? []));

    lines.push(subHeader("decision_constraints"));
    lines.push(listItems(input.interpreted.decision_constraints ?? []));

    lines.push(subHeader("case_specific_risks"));
    lines.push(listItems(input.interpreted.case_specific_risks ?? []));
  }

  lines.push(sectionHeader("CONFIRMED CONTEXT"));
  if (input.contextConfirmed && input.confirmed) {
    lines.push(renderContext(input.confirmed));
  } else if (input.interpreted) {
    lines.push("_(No confirmado todavía — versión interpretada:)_\n");
    lines.push(renderContext(input.interpreted));
  } else {
    lines.push("No confirmado todavía.");
  }

  lines.push(sectionHeader("BRIEFING"));
  if (input.briefing) {
    const b = input.briefing;

    lines.push(`- **Objetivo real de la llamada:** ${b.real_call_goal}`);

    lines.push("\n**Lo que hay que conseguir hoy:**");
    lines.push(listItems(b.must_get_today));

    lines.push("\n**Objeciones esperadas:**");
    if (b.expected_objections.length) {
      b.expected_objections.forEach(obj => {
        lines.push(`- **${obj.objection}**`);
        lines.push(`  - Por qué probable: ${obj.why_likely}`);
        lines.push(`  - Cómo manejar: ${obj.how_to_handle}`);
      });
    } else {
      lines.push("- (ninguna)");
    }

    lines.push("\n**Errores a evitar:**");
    lines.push(listItems(b.mistakes_to_avoid));

    lines.push("\n**Estructura sugerida:**");
    lines.push(listItems(b.suggested_call_structure));

    lines.push(`\n**Apertura sugerida:**\n${b.suggested_opening}`);

    lines.push(`\n**Cierre / siguiente paso:**\n${b.suggested_next_step_close}`);

    lines.push(`\n**Brief para sesión en vivo:**\n${b.brief_for_live}`);
  } else {
    lines.push("No generado todavía.");
  }

  return lines.join("\n");
}

export function triggerPrebriefLogDownload(input: PrebriefLogInput): void {
  const markdown = renderPrebriefLogMarkdown(input);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const filename = [
    "prebrief-log",
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
  ].join("") + ".md";

  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
