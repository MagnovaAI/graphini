#!/usr/bin/env node
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, stepCountIs, tool } from 'ai';
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';

const defaultDatasetUrl =
  'https://huggingface.co/datasets/ibm-research/MermaidSeqBench/resolve/main/data.csv';
const defaultOpenRouterDiagramModel = 'nvidia/nemotron-3-super-120b-a12b:free';
const defaultJudgeModel = 'openrouter:openai/gpt-oss-120b';
const criteria = [
  'syntax',
  'mermaidOnly',
  'logic',
  'completeness',
  'activationHandling',
  'errorStatusTracking'
];
const generationModes = ['auto', 'text', 'tool'];

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const generatorModel =
    options.model ?? process.env.MERMAID_SEQ_BENCH_MODEL ?? `openrouter:${defaultOpenRouterDiagramModel}`;
  const judgeModel =
    options.judgeModel ?? process.env.MERMAID_SEQ_BENCH_JUDGE_MODEL ?? defaultJudgeModel;
  const dataset = await loadDataset(options.dataset ?? defaultDatasetUrl);
  const selectedCases = selectCases(dataset, options);
  if (selectedCases.length === 0) {
    throw new Error('No benchmark cases selected. Check --offset and --limit.');
  }
  if (options.validateDataset) {
    console.info(
      JSON.stringify(
        {
          dataset: options.dataset ?? defaultDatasetUrl,
          firstCase: selectedCases[0]?.id ?? null,
          selectedCases: selectedCases.length,
          totalCases: dataset.length
        },
        null,
        2
      )
    );
    return;
  }
  const startedAt = new Date();
  const run = {
    aggregate: {},
    cases: [],
    config: {
      dataset: options.dataset ?? defaultDatasetUrl,
      generatorModel,
      generationMode: resolveGenerationMode(options.generationMode, generatorModel),
      judgeModel: options.noJudge ? null : judgeModel,
      limit: options.limit ?? null,
      offset: options.offset,
      temperature: options.temperature
    },
    startedAt: startedAt.toISOString()
  };

  for (const [index, sample] of selectedCases.entries()) {
    const caseStarted = performance.now();
    console.info(
      `MERMAID_SEQ_BENCH_CASE ${index + 1}/${selectedCases.length} ${sample.id} ${sample.title}`
    );

    try {
      const generation = await generateDiagram({
        modelId: generatorModel,
        mode: resolveGenerationMode(options.generationMode, generatorModel),
        sample,
        temperature: options.temperature
      });
      const localChecks = inspectMermaid(generation.diagram);
      const judgements = options.noJudge
        ? {}
        : await judgeDiagram({
            candidate: generation.diagram,
            judgeModel,
            prompt: sample.prompt,
            reference: sample.expectedOutput
          });

      run.cases.push({
        elapsedMs: Math.round(performance.now() - caseStarted),
        generation,
        id: sample.id,
        judgements,
        localChecks,
        prompt: sample.prompt,
        reference: sample.expectedOutput,
        status: 'passed',
        title: sample.title
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`MERMAID_SEQ_BENCH_CASE_ERROR ${sample.id} ${message}`);
      run.cases.push({
        elapsedMs: Math.round(performance.now() - caseStarted),
        error: message,
        id: sample.id,
        prompt: sample.prompt,
        reference: sample.expectedOutput,
        status: 'failed',
        title: sample.title
      });
      if (options.failFast) throw error;
    }
  }

  run.aggregate = aggregateScores(run.cases);
  run.completedAt = new Date().toISOString();
  run.elapsedMs = Date.now() - startedAt.getTime();

  const outputPath = await writeRun(run, options.output);
  console.info(`MERMAID_SEQ_BENCH_RESULT ${outputPath}`);
  console.info(JSON.stringify(run.aggregate, null, 2));
}

function parseArgs(args) {
  const options = {
    generationMode: 'auto',
    offset: 0,
    temperature: 0
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      index += 1;
      if (index >= args.length) throw new Error(`Missing value for ${arg}`);
      return args[index];
    };

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dataset') options.dataset = next();
    else if (arg === '--model') options.model = next();
    else if (arg === '--judge-model') options.judgeModel = next();
    else if (arg === '--generation-mode') options.generationMode = parseGenerationMode(next());
    else if (arg === '--limit') options.limit = parsePositiveInteger(next(), '--limit');
    else if (arg === '--offset') options.offset = parseNonNegativeInteger(next(), '--offset');
    else if (arg === '--output') options.output = next();
    else if (arg === '--temperature') options.temperature = Number(next());
    else if (arg === '--no-judge') options.noJudge = true;
    else if (arg === '--fail-fast') options.failFast = true;
    else if (arg === '--validate-dataset') options.validateDataset = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.temperature) || options.temperature < 0) {
    throw new Error('--temperature must be a non-negative number.');
  }
  return options;
}

function parseGenerationMode(value) {
  if (!generationModes.includes(value)) {
    throw new Error(`--generation-mode must be one of: ${generationModes.join(', ')}.`);
  }
  return value;
}

function resolveGenerationMode(mode, modelId) {
  if (mode === 'text' || mode === 'tool') return mode;
  return parseModelId(modelId).provider === 'claude-cli' ? 'text' : 'tool';
}

function printHelp() {
  console.log(`MermaidSeqBench harness

Usage:
  pnpm bench:mermaid-seq -- --model openrouter:nvidia/nemotron-3-super-120b-a12b:free --limit 3

Options:
  --model <provider:model>        Generator model. Providers: openrouter, openai, anthropic.
                                  Use claude-cli:<model> to reuse Claude Code auth.
  --judge-model <provider:model>  Judge model. Defaults to ${defaultJudgeModel}.
  --generation-mode <mode>        auto, text, or tool. Auto uses tool mode for SDK providers.
  --dataset <path-or-url>         CSV or JSONL dataset. Defaults to MermaidSeqBench data.csv.
  --limit <n>                     Number of samples to run.
  --offset <n>                    Start offset. Defaults to 0.
  --temperature <n>               Generator temperature. Defaults to 0.
  --no-judge                      Generate diagrams and run local checks only.
  --fail-fast                     Stop at the first failed case.
  --validate-dataset              Load the dataset and print its shape without model calls.
  --output <path>                 Output JSON path.
`);
}

async function loadDataset(datasetPath) {
  const text = await readText(datasetPath);
  const records = datasetPath.endsWith('.jsonl')
    ? text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : parseCsv(text);

  return records.map((record, index) => normalizeSample(record, index));
}

async function readText(datasetPath) {
  if (/^https?:\/\//i.test(datasetPath)) {
    const response = await fetch(datasetPath);
    if (!response.ok) {
      throw new Error(`Failed to download dataset: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }
  return await readFile(datasetPath, 'utf8');
}

function normalizeSample(record, index) {
  const title = stringField(record, ['nl_task_title', 'title', 'name']) || `sample-${index + 1}`;
  const description = stringField(record, ['nl_task_desc', 'description', 'prompt']);
  const inputPrompt = stringField(record, ['input_prompt', 'agent_prompt', 'prompt']);
  const expectedOutput = stringField(record, [
    'expected_output',
    'expected_agent_response',
    'reference',
    'mermaid'
  ]);

  if (!expectedOutput) throw new Error(`Dataset row ${index + 1} is missing expected_output.`);
  return {
    expectedOutput,
    id: slugify(`${index + 1}-${title}`),
    prompt: inputPrompt || buildPrompt(description),
    title
  };
}

function stringField(record, names) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function buildPrompt(description) {
  return `Generate a Mermaid sequence diagram for the following specification.

${description}

Return only Mermaid sequence diagram syntax.`;
}

function selectCases(dataset, options) {
  const start = options.offset;
  const end = options.limit === undefined ? undefined : start + options.limit;
  return dataset.slice(start, end);
}

async function generateDiagram({ mode, modelId, sample, temperature }) {
  const startedAt = performance.now();
  if (mode === 'tool') {
    return {
      ...(await generateDiagramWithTool({
        modelId,
        sample,
        temperature
      })),
      elapsedMs: Math.round(performance.now() - startedAt),
      generationMode: mode
    };
  }

  const result = await generateModelText({
    maxOutputTokens: 1024,
    modelId,
    prompt: sample.prompt,
    system:
      'You generate Mermaid sequence diagrams from natural language software flow descriptions. Return only Mermaid code. The diagram must start with sequenceDiagram.',
    temperature
  });
  const text = result.text.trim();
  return {
    diagram: extractMermaid(text),
    elapsedMs: Math.round(performance.now() - startedAt),
    finishReason: result.finishReason,
    rawText: text,
    totalUsage: result.totalUsage,
    usage: result.usage,
    warnings: result.warnings,
    generationMode: mode,
    toolCalls: [],
    toolResults: []
  };
}

async function generateDiagramWithTool({ modelId, sample, temperature }) {
  const parsed = parseModelId(modelId);
  if (parsed.provider === 'claude-cli') {
    throw new Error('claude-cli provider does not support custom harness tools. Use --generation-mode text.');
  }

  let diagram = '';
  const result = await generateText({
    maxOutputTokens: 1024,
    model: resolveModel(modelId),
    prompt: sample.prompt,
    stopWhen: stepCountIs(2),
    system:
      'You generate Mermaid sequence diagrams from natural language software flow descriptions. Call diagramWrite exactly once with Mermaid code that starts with sequenceDiagram.',
    temperature,
    toolChoice: 'required',
    tools: {
      diagramWrite: tool({
        description:
          'Write the final Mermaid sequence diagram. The content must start with sequenceDiagram and contain only Mermaid syntax.',
        execute: async ({ content, purpose }) => {
          diagram = extractMermaid(content);
          return {
            accepted: /^sequenceDiagram\b/i.test(diagram.trim()),
            lineCount: diagram.split('\n').filter((line) => line.trim()).length,
            purpose
          };
        },
        inputSchema: z.object({
          content: z.string().min(1),
          purpose: z.string().optional()
        })
      })
    }
  });

  const toolDiagram = diagram || extractMermaid(result.text.trim());
  return {
    diagram: toolDiagram,
    finishReason: result.finishReason,
    rawText: result.text.trim(),
    toolCalls: result.toolCalls,
    toolResults: result.toolResults,
    totalUsage: result.totalUsage,
    usage: result.usage,
    warnings: result.warnings
  };
}

async function judgeDiagram({ candidate, judgeModel, prompt, reference }) {
  if (parseModelId(judgeModel).provider === 'claude-cli') {
    return await judgeDiagramCombined({
      candidate,
      judgeModel,
      prompt,
      reference
    });
  }

  const scores = {};
  for (const criterion of criteria) {
    const result = await generateModelText({
      maxOutputTokens: 300,
      modelId: judgeModel,
      prompt: judgePrompt(criterion, {
        candidate,
        prompt,
        reference
      }),
      temperature: 0
    });
    scores[criterion] = parseJudgeResponse(result.text);
  }
  return scores;
}

async function judgeDiagramCombined({ candidate, judgeModel, prompt, reference }) {
  const result = await generateModelText({
    maxOutputTokens: 1200,
    modelId: judgeModel,
    prompt: combinedJudgePrompt({
      candidate,
      prompt,
      reference
    }),
    system:
      'You are a strict Mermaid sequence diagram benchmark judge. Return only valid JSON.',
    temperature: 0
  });
  const parsed = parseCombinedJudgeResponse(result.text);
  return Object.fromEntries(
    criteria.map((criterion) => [
      criterion,
      {
        explanation: parsed[criterion]?.explanation ?? '',
        rawText: result.text,
        score:
          typeof parsed[criterion]?.score === 'number'
            ? clamp(parsed[criterion].score, 0, 1)
            : null
      }
    ])
  );
}

function combinedJudgePrompt({ candidate, prompt, reference }) {
  return `Evaluate this generated Mermaid sequence diagram against the prompt and accepted reference.

Return exactly one JSON object with these keys:
${criteria.map((criterion) => `- ${criterion}: {"score": number from 0.000 to 1.000, "explanation": string}`).join('\n')}

Criterion definitions:
- syntax: MermaidJS syntax and structural correctness. Participants, activation/deactivation balance, and alt/else/end nesting.
- mermaidOnly: Whether the output contains clean Mermaid code only, without narration or unrelated formatting.
- logic: Logical interaction flow, request/response pairing, alternate branches, and nested decisions.
- completeness: Coverage of participants, interactions, decision points, minor flows, and error paths from the prompt.
- activationHandling: Correct and useful activate/deactivate usage.
- errorStatusTracking: Clear success/failure separation, error handling, status updates, and entity state tracking.

Do not require a verbatim match to the reference. Equivalent correct diagrams should score well.

#####
<AGENT_PROMPT>
${prompt}
#####
<AGENT_RESPONSE>
${candidate}
#####
<EXPECTED_AGENT_RESPONSE>
${reference}
#####`;
}

function parseCombinedJudgeResponse(text) {
  const jsonText = extractJsonObject(text);
  const parsed = JSON.parse(jsonText);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`Judge did not return JSON: ${text.slice(0, 500)}`);
  return candidate.slice(start, end + 1);
}

async function generateModelText({ maxOutputTokens, modelId, prompt, system, temperature }) {
  const parsed = parseModelId(modelId);
  if (parsed.provider === 'claude-cli') {
    return await generateClaudeCliText({
      maxOutputTokens,
      model: parsed.model,
      prompt,
      system
    });
  }

  return await generateText({
    maxOutputTokens,
    model: resolveModel(modelId),
    prompt,
    system,
    temperature
  });
}

async function generateClaudeCliText({ maxOutputTokens, model, prompt, system }) {
  const args = [
    '-p',
    '--model',
    model,
    '--output-format',
    'json',
    '--no-session-persistence'
  ];
  if (system) args.push('--system-prompt', system);
  const raw = await runProcess('claude', args, prompt, 240_000);
  const jsonLine = raw
    .trim()
    .split('\n')
    .reverse()
    .find((line) => line.trim().startsWith('{'));
  if (!jsonLine) throw new Error(`Claude CLI did not return JSON: ${raw.slice(0, 500)}`);

  const result = JSON.parse(jsonLine);
  if (result.is_error) {
    throw new Error(result.result || result.api_error_status || 'Claude CLI call failed.');
  }

  return {
    finishReason: result.stop_reason ?? result.terminal_reason ?? null,
    text: String(result.result ?? '').trim(),
    totalUsage: result.usage ?? null,
    usage: result.usage ?? null,
    warnings: maxOutputTokens ? [] : []
  };
}

async function runProcess(command, args, input, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `${command} exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

function judgePrompt(criterion, { candidate, prompt, reference }) {
  const bodies = {
    activationHandling: `Evaluate the use of activation and deactivation in the MermaidJS under <AGENT_RESPONSE> based on the <AGENT_PROMPT>. <EXPECTED_AGENT_RESPONSE> is one accepted solution reference; do not require a verbatim match.

Is it proper MermaidJS syntax?
Does the diagram properly use activate and deactivate to show control of execution?
Are all activated participants deactivated appropriately?
Are there any unnecessary deactivate statements where no activation occurred?
Does this improve the diagram's readability and traceability of actions?`,
    completeness: `Evaluate the MermaidJS output under <AGENT_RESPONSE> based on <AGENT_PROMPT> for completeness. <EXPECTED_AGENT_RESPONSE> is one accepted solution reference; do not require a verbatim match.

Is it proper MermaidJS syntax?
Does the diagram cover all participants, request/response pairs, and decision points described in the prompt?
Are alternate flows and error paths handled as required?
Does the output reflect full coverage of described behavior, including minor flows?`,
    errorStatusTracking: `Evaluate how clearly the MermaidJS under <AGENT_RESPONSE> handles error cases and status updates based on <AGENT_PROMPT>. <EXPECTED_AGENT_RESPONSE> is one accepted solution reference; do not require a verbatim match.

Is it proper MermaidJS syntax?
Does the diagram include explicit status updates?
Does the diagram clearly separate success and failure flows?
Does the diagram represent error-handling cases effectively?
Does the diagram track the state of key entities throughout the sequence?`,
    logic: `Evaluate the MermaidJS output under <AGENT_RESPONSE> based on the task description in <AGENT_PROMPT> and the reference in <EXPECTED_AGENT_RESPONSE> for logic and flow completeness. The expected output is one accepted solution; alternate but logically equivalent flows should not be penalized.

Is it proper MermaidJS syntax?
Does every request have a corresponding response?
Are alternate flows represented completely and clearly?
Are nested decision branches handled as required?
Does the diagram account for every described interaction and path?`,
    mermaidOnly: `Evaluate the agent's output under <AGENT_RESPONSE> to ensure it strictly contains MermaidJS code only. <EXPECTED_AGENT_RESPONSE> is one accepted solution reference; do not require a verbatim match.

Is the output wrapped in a valid Markdown block or clean Mermaid syntax?
Does it avoid extra explanation, narration, or formatting beyond valid Mermaid syntax?
Is the output clean, parsable, and renderable in Mermaid?
Responses with non-code text or mixed formatting should receive a lower score.`,
    syntax: `Evaluate the MermaidJS output under <AGENT_RESPONSE> for syntax and structural correctness based on MermaidJS rules. <EXPECTED_AGENT_RESPONSE> is one accepted solution reference; do not require a verbatim match.

Is it proper MermaidJS syntax?
Are all participants declared using participant ActorName syntax?
Are activation/deactivation statements used and properly balanced?
Are alt, else, and end blocks closed correctly and nested if needed?`
  };

  return `${bodies[criterion]}

#####
<AGENT_PROMPT>
${prompt}
#####
<AGENT_RESPONSE>
${candidate}
#####
<EXPECTED_AGENT_RESPONSE>
${reference}
#####

Provide a numerical score from 0.000 to 1.000 and a concise explanation.
Format the output exactly as: <score>; <explanation>`;
}

function parseJudgeResponse(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/([01](?:\.\d+)?)/);
  const score = match ? clamp(Number(match[1]), 0, 1) : null;
  return {
    explanation: trimmed.replace(/^[\s\d.]+;?\s*/, ''),
    rawText: trimmed,
    score
  };
}

function inspectMermaid(diagram) {
  const lines = diagram
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const activationBalance = new Map();
  let blockBalance = 0;

  for (const line of lines) {
    const activate = line.match(/^activate\s+(.+)$/i);
    if (activate) {
      const actor = activate[1].trim();
      activationBalance.set(actor, (activationBalance.get(actor) ?? 0) + 1);
    }

    const deactivate = line.match(/^deactivate\s+(.+)$/i);
    if (deactivate) {
      const actor = deactivate[1].trim();
      activationBalance.set(actor, (activationBalance.get(actor) ?? 0) - 1);
    }

    if (/^(alt|opt|loop|par|critical|break)\b/i.test(line)) blockBalance += 1;
    if (/^end\b/i.test(line)) blockBalance -= 1;
  }

  const unbalancedActivations = [...activationBalance.entries()].filter(([, count]) => count !== 0);
  return {
    blockBalance,
    lineCount: lines.length,
    startsWithSequenceDiagram: /^sequenceDiagram\b/i.test(lines[0] ?? ''),
    unbalancedActivations
  };
}

function aggregateScores(cases) {
  const completedCases = cases.filter((item) => item.status !== 'failed');
  const aggregate = {
    caseCount: cases.length,
    failedCaseCount: cases.length - completedCases.length,
    criteria: {},
    local: {
      blockBalanced: ratio(
        completedCases.filter((item) => item.localChecks.blockBalance === 0).length,
        completedCases.length
      ),
      activationBalanced: ratio(
        completedCases.filter((item) => item.localChecks.unbalancedActivations.length === 0).length,
        completedCases.length
      ),
      startsWithSequenceDiagram: ratio(
        completedCases.filter((item) => item.localChecks.startsWithSequenceDiagram).length,
        completedCases.length
      )
    },
    toolUse: {
      diagramWriteAccepted: ratio(
        completedCases.filter((item) => hasAcceptedDiagramWrite(item.generation)).length,
        completedCases.length
      ),
      diagramWriteCalled: ratio(
        completedCases.filter((item) => hasDiagramWriteCall(item.generation)).length,
        completedCases.length
      ),
      toolMode: ratio(
        completedCases.filter((item) => item.generation.generationMode === 'tool').length,
        completedCases.length
      )
    }
  };

  for (const criterion of criteria) {
    const scores = completedCases
      .map((item) => item.judgements?.[criterion]?.score)
      .filter((score) => typeof score === 'number');
    aggregate.criteria[criterion] = scores.length ? average(scores) : null;
  }
  aggregate.overallJudgeScore = average(
    Object.values(aggregate.criteria).filter((score) => typeof score === 'number')
  );
  return aggregate;
}

function hasDiagramWriteCall(generation) {
  return (generation.toolCalls ?? []).some((toolCall) => toolCall.toolName === 'diagramWrite');
}

function hasAcceptedDiagramWrite(generation) {
  return (generation.toolResults ?? []).some((toolResult) => {
    if (toolResult.toolName !== 'diagramWrite') return false;
    const output = toolResult.output ?? toolResult.result;
    return output && typeof output === 'object' && output.accepted === true;
  });
}

async function writeRun(run, output) {
  const outputPath =
    output ??
    path.join(
      process.cwd(),
      'tests/logs/mermaid-seq-bench',
      `run-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.json`
    );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return outputPath;
}

function resolveModel(modelId) {
  const parsed = parseModelId(modelId);
  if (parsed.provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
    return createOpenAI({ apiKey })(parsed.model);
  }
  if (parsed.provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_OAUTH_TOKEN;
    if (!apiKey && !authToken) throw new Error('ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is not set.');
    return createAnthropic(authToken ? { authToken } : { apiKey })(parsed.model);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');
  return createOpenRouter({
    apiKey,
    appName: 'Graphini MermaidSeqBench',
    compatibility: 'strict'
  }).chat(parsed.model);
}

function parseModelId(modelId) {
  const match = modelId.match(/^(openrouter|openai|anthropic|claude-cli)[:/](.+)$/i);
  if (match) return { model: match[2], provider: match[1].toLowerCase() };
  return { model: modelId || defaultOpenRouterDiagramModel, provider: 'openrouter' };
}

function extractMermaid(text) {
  const fenced = text.match(/```(?:mermaid|sequenceDiagram)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text.trim();
  const start = body.search(/sequenceDiagram\b/i);
  return start >= 0 ? body.slice(start).trim() : body;
}

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...body] = rows.filter((item) => item.some((fieldValue) => fieldValue !== ''));
  return body.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? '']))
  );
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function parseNonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(value, total) {
  return total === 0 ? null : value / total;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
