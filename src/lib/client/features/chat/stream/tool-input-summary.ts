function matchJsonString(json: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const match = json.match(re);
  return match ? match[1].replace(/\\"/g, '"') : null;
}

export interface ToolInputDisplay {
  subtitle?: string;
  details?: string[];
}

export function deriveToolInputDisplay(toolName: string, inputJson: string): ToolInputDisplay {
  if (toolName === 'autoStyler' || toolName === 'styleSearch') {
    const palette = matchJsonString(inputJson, 'palette');
    return palette ? { subtitle: palette } : {};
  }
  if (toolName === 'iconifier' || toolName === 'iconSearch') {
    const query = matchJsonString(inputJson, 'query');
    return query ? { subtitle: query.slice(0, 80) } : {};
  }
  if (toolName === 'webSearch') {
    const query = matchJsonString(inputJson, 'query');
    if (!query) return {};
    const reason = matchJsonString(inputJson, 'reason');
    return {
      subtitle: `"${query}"`,
      details: reason ? [reason] : undefined
    };
  }
  if (toolName === 'thinking') {
    const summary = matchJsonString(inputJson, 'summary');
    if (summary) return { subtitle: summary.slice(0, 80) };
    const focus = matchJsonString(inputJson, 'focus');
    return focus ? { subtitle: focus.slice(0, 80) } : {};
  }
  if (toolName === 'errorChecker') {
    return { subtitle: 'diagram syntax' };
  }
  if (toolName === 'fileManager') {
    const op = matchJsonString(inputJson, 'operation');
    return op ? { subtitle: op } : {};
  }
  return {};
}

export interface PartialQuestionnaire {
  context: string;
  questions: {
    id: string;
    text: string;
    type: 'single' | 'multi';
    options: { id: string; label: string }[];
  }[];
}

export function parsePartialQuestionnaire(inputJson: string): PartialQuestionnaire {
  const ctxMatch = inputJson.match(/"context"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const context = ctxMatch ? ctxMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : '';

  const questions: PartialQuestionnaire['questions'] = [];
  const qArrMatch = inputJson.match(/"questions"\s*:\s*\[([\s\S]*)/);
  if (qArrMatch) {
    const qArrStr = qArrMatch[1];
    const objRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    let match: RegExpExecArray | null;
    while ((match = objRegex.exec(qArrStr)) !== null) {
      try {
        const qObj = JSON.parse(match[0]);
        if (qObj.id && qObj.text) {
          questions.push({
            id: qObj.id,
            text: qObj.text,
            type: qObj.type || 'single',
            options: qObj.options || []
          });
        }
      } catch {
        /* incomplete object */
      }
    }
  }
  return { context, questions };
}

export function parseStreamingContent(inputJson: string): string | null {
  const contentMatch = inputJson.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/);
  if (!contentMatch) return null;
  return contentMatch[1]
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}
