export { createAskQuestionsTool } from './askQuestions';
export { createAutoStylerTool } from './autoStyler';
export { createDataAnalyzerTool } from './dataAnalyzer';
export { createDiagramDeleteTool } from './diagramDelete';
export { createDiagramPatchTool } from './diagramPatch';
export { createDiagramReadTool } from './diagramRead';
export { createDiagramWriteTool } from './diagramWrite';
export { createErrorCheckerTool } from './errorChecker';
export { createFileManagerTool } from './fileManager';
export { createIconSearchTool } from './iconSearch';
export { createIconifierTool } from './iconifier';
export { createMarkdownReadTool } from './markdownRead';
export { createMarkdownWriteTool } from './markdownWrite';
export { createStyleSearchTool } from './styleSearch';
export { createThinkingTool } from './thinking';
export { createWebSearchTool } from './webSearch';

import { createAskQuestionsTool } from './askQuestions';
import { createAutoStylerTool } from './autoStyler';
import { createDataAnalyzerTool } from './dataAnalyzer';
import { createDiagramDeleteTool } from './diagramDelete';
import { createDiagramPatchTool } from './diagramPatch';
import { createDiagramReadTool } from './diagramRead';
import { createDiagramWriteTool } from './diagramWrite';
import { createErrorCheckerTool } from './errorChecker';
import { createFileManagerTool } from './fileManager';
import { createIconSearchTool } from './iconSearch';
import { createIconifierTool } from './iconifier';
import { createMarkdownReadTool } from './markdownRead';
import { createMarkdownWriteTool } from './markdownWrite';
import { createStyleSearchTool } from './styleSearch';
import { createThinkingTool } from './thinking';
import { createWebSearchTool } from './webSearch';
import type { WorkspaceToolTarget } from './context';

export function createDiagramTools(
  sessionId: string,
  modelId?: string,
  target?: WorkspaceToolTarget,
  userId?: string
) {
  const context = { modelId, sessionId, target, userId };
  return {
    askQuestions: createAskQuestionsTool(context),
    autoStyler: createAutoStylerTool(context),
    dataAnalyzer: createDataAnalyzerTool(context),
    diagramDelete: createDiagramDeleteTool(context),
    diagramPatch: createDiagramPatchTool(context),
    diagramRead: createDiagramReadTool(context),
    diagramWrite: createDiagramWriteTool(context),
    errorChecker: createErrorCheckerTool(context),
    fileManager: createFileManagerTool(context),
    iconSearch: createIconSearchTool(context),
    iconifier: createIconifierTool(context),
    markdownRead: createMarkdownReadTool(context),
    markdownWrite: createMarkdownWriteTool(context),
    styleSearch: createStyleSearchTool(context),
    thinking: createThinkingTool(),
    webSearch: createWebSearchTool(context)
  };
}
