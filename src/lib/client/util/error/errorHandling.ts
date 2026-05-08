// Function to find the line number with the most characters in common with the error
export function findMostRelevantLineNumber(errorLineText: string, code: string): number {
  const codeLines = code.split('\n');
  let mostRelevantLineNumber = -1;
  let maxCommonLength = 0;

  for (const [i, line] of codeLines.entries()) {
    let commonLength = 0;
    for (let j = 0; j <= errorLineText.length; j++) {
      for (let k = j + 1; k <= errorLineText.length; k++) {
        const sub = errorLineText.slice(j, k);
        if (line.includes(sub)) {
          commonLength = Math.max(commonLength, sub.length);
        }
      }
    }
    if (commonLength > maxCommonLength) {
      maxCommonLength = commonLength;
      mostRelevantLineNumber = i + 1; // Line numbers start from 1
    }
  }
  return mostRelevantLineNumber;
}

// Function to replace the incorrect line number in the error message
// and simplify it to show only the problematic line
export function replaceLineNumberInErrorMessage(
  errorMessage: string,
  realLineNumber: number
): string {
  const regexParseError = /Parse error on line (\d+):/;
  const regexLexError = /Lexical error on line (\d+)/;

  // Extract only the problematic line information
  const simplifiedMessage = errorMessage
    .replace(regexParseError, `Parse error on line ${realLineNumber}`)
    .replace(regexLexError, `Lexical error on line ${realLineNumber}`);

  // Extract the problematic line text from the error message
  const errorLineMatch = errorMessage.match(/Error: .* on line \d+:\n(.+)\n/);
  if (errorLineMatch && errorLineMatch[1]) {
    const problematicLine = errorLineMatch[1].trim();
    // Return only the line number and the problematic line content
    return `Error on line ${realLineNumber}: ${problematicLine}`;
  }

  return simplifiedMessage;
}

export function extractErrorLineText(errorMessage: string): string {
  const regex = /Error: Parse error on line \d+:\n(.+)\n+/;
  const match = errorMessage.match(regex);
  if (match) {
    return match[1].slice(3);
  }

  const regexLex = /Error: Lexical error on line \d+. Unrecognized text.\n(.+)\n-+/;
  const matchLex = errorMessage.match(regexLex);
  return matchLex ? matchLex[1].slice(3) : '';
}

/**
 * Use LLM backend to analyze error and extract only the problematic line
 */
export async function analyzeErrorWithLLM(
  errorMessage: string,
  code: string
): Promise<{ line_number: number; problematic_line: string; simplified_message: string } | null> {
  try {
    const response = await fetch('/api/diagram/analyze-error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error_message: errorMessage,
        code: code
      }),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      console.warn('LLM error analysis failed, falling back to local analysis');
      return null;
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.warn('LLM error analysis unavailable, falling back to local analysis:', error);
    return null;
  }
}
