export { createActionItemExtractorTool } from './actionItemExtractor';
export { createAskQuestionsTool } from './askQuestions';
export { createAutoStylerTool } from './autoStyler';
export { createCodePatchTool } from './codePatch';
export { createCodeReadTool } from './codeRead';
export { createCodeWriteTool } from './codeWrite';
export { createDataAnalyzerTool } from './dataAnalyzer';
export { createDiagramDeleteTool } from './diagramDelete';
export { createDiagramPatchTool } from './diagramPatch';
export { createDiagramReadTool } from './diagramRead';
export { createDiagramWriteTool } from './diagramWrite';
export { createErrorCheckerTool } from './errorChecker';
export { createFileManagerTool } from './fileManager';
export { createGitGuardTool } from './gitGuard';
export { createIconifierTool } from './iconifier';
export { createLongTermMemoryTool } from './longTermMemory';
export { createMarkdownReadTool } from './markdownRead';
export { createMarkdownWriteTool } from './markdownWrite';
export { createPlanWithProgressTool } from './planWithProgress';
export { createPlannerTool } from './planner';
export { createSelfCritiqueTool } from './selfCritique';
export { createSequentialThinkingTool } from './sequentialThinking';
export { createSubagentAssembleTool } from './subagentAssemble';
export { createSubagentFanoutTool } from './subagentFanout';
export { createTableAnalyticsTool } from './tableAnalytics';
export { createWebSearchTool } from './webSearch';

import { createActionItemExtractorTool } from './actionItemExtractor';
import { createAskQuestionsTool } from './askQuestions';
import { createAutoStylerTool } from './autoStyler';
import { createCodePatchTool } from './codePatch';
import { createCodeReadTool } from './codeRead';
import { createCodeWriteTool } from './codeWrite';
import { createDataAnalyzerTool } from './dataAnalyzer';
import { createDiagramDeleteTool } from './diagramDelete';
import { createDiagramPatchTool } from './diagramPatch';
import { createDiagramReadTool } from './diagramRead';
import { createDiagramWriteTool } from './diagramWrite';
import { createErrorCheckerTool } from './errorChecker';
import { createFileManagerTool } from './fileManager';
import { createGitGuardTool } from './gitGuard';
import { createIconifierTool } from './iconifier';
import { createLongTermMemoryTool } from './longTermMemory';
import { createMarkdownReadTool } from './markdownRead';
import { createMarkdownWriteTool } from './markdownWrite';
import { createPlanWithProgressTool } from './planWithProgress';
import { createPlannerTool } from './planner';
import { createSelfCritiqueTool } from './selfCritique';
import { createSequentialThinkingTool } from './sequentialThinking';
import { createSubagentAssembleTool } from './subagentAssemble';
import { createSubagentFanoutTool } from './subagentFanout';
import { createTableAnalyticsTool } from './tableAnalytics';
import { createWebSearchTool } from './webSearch';

export function createDiagramTools(sessionId: string, modelId?: string) {
  const context = { modelId, sessionId };
  return {
    actionItemExtractor: createActionItemExtractorTool(context),
    askQuestions: createAskQuestionsTool(context),
    autoStyler: createAutoStylerTool(context),
    codePatch: createCodePatchTool(context),
    codeRead: createCodeReadTool(context),
    codeWrite: createCodeWriteTool(context),
    dataAnalyzer: createDataAnalyzerTool(context),
    diagramDelete: createDiagramDeleteTool(context),
    diagramPatch: createDiagramPatchTool(context),
    diagramRead: createDiagramReadTool(context),
    diagramWrite: createDiagramWriteTool(context),
    errorChecker: createErrorCheckerTool(context),
    fileManager: createFileManagerTool(context),
    gitGuard: createGitGuardTool(context),
    iconifier: createIconifierTool(context),
    longTermMemory: createLongTermMemoryTool(context),
    markdownRead: createMarkdownReadTool(context),
    markdownWrite: createMarkdownWriteTool(context),
    planWithProgress: createPlanWithProgressTool(context),
    planner: createPlannerTool(context),
    selfCritique: createSelfCritiqueTool(context),
    sequentialThinking: createSequentialThinkingTool(context),
    subagentAssemble: createSubagentAssembleTool(context),
    subagentFanout: createSubagentFanoutTool(context),
    tableAnalytics: createTableAnalyticsTool(context),
    webSearch: createWebSearchTool(context)
  };
}
