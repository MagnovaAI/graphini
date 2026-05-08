function matchJsonString(json: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const match = json.match(re);
  return match ? match[1].replace(/\\"/g, '"') : null;
}

/**
 * Best-effort parse of a streaming `thinking` tool input. The JSON may be
 * unterminated mid-stream, so we walk the `thoughts` array manually and
 * pull out completed `{ label, detail? }` objects plus a partial
 * conclusion when present.
 */
export function parsePartialThoughts(json: string): {
  thoughts: { label: string; detail?: string }[];
  conclusion?: string;
} {
  const thoughts: { label: string; detail?: string }[] = [];

  // Locate the start of the thoughts array, then walk its top-level entries.
  const arrayStart = json.search(/"thoughts"\s*:\s*\[/);
  if (arrayStart >= 0) {
    let i = json.indexOf('[', arrayStart);
    if (i >= 0) {
      i++;
      let depth = 0;
      let inString = false;
      let escape = false;
      let entryStart = -1;
      for (; i < json.length; i++) {
        const ch = json[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === '{') {
          if (depth === 0) entryStart = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && entryStart >= 0) {
            const entry = json.slice(entryStart, i + 1);
            const label = matchJsonString(entry, 'label');
            const detail = matchJsonString(entry, 'detail');
            if (label) thoughts.push(detail ? { label, detail } : { label });
            entryStart = -1;
          }
        } else if (ch === ']' && depth === 0) {
          break;
        }
      }
    }
  }

  const conclusion = matchJsonString(json, 'conclusion') ?? undefined;
  return { thoughts, conclusion };
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
  if (toolName === 'iconSearch') {
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
  // `thinking` is handled as its own chain-of-thought part; it never
  // reaches this generic tool-simple input formatter.
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
