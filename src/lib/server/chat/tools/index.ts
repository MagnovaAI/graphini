export { createAskQuestionsTool } from './askQuestions';
export { createAutoStylerTool } from './autoStyler';
export { createDataAnalyzerTool } from './dataAnalyzer';
export { createErrorCheckerTool } from './errorChecker';
export { createFileManagerTool } from './fileManager';
export { createFileSystemTool } from './fileSystem';
export { createIconSearchTool } from './iconSearch';
export { createStyleSearchTool } from './styleSearch';
export { createThinkingTool } from './thinking';
export { createWebSearchTool } from './webSearch';

import { createAskQuestionsTool } from './askQuestions';
import { createAutoStylerTool } from './autoStyler';
import { createDataAnalyzerTool } from './dataAnalyzer';
import { createErrorCheckerTool } from './errorChecker';
import { createFileManagerTool } from './fileManager';
import { createFileSystemTool } from './fileSystem';
import { createIconSearchTool } from './iconSearch';
import { createStyleSearchTool } from './styleSearch';
import { createThinkingTool } from './thinking';
import { createWebSearchTool } from './webSearch';
import type { FileSystemTurnGuard, WorkspaceToolTarget } from './context';

export function createDiagramTools(
  sessionId: string,
  modelId?: string,
  target?: WorkspaceToolTarget,
  userId?: string,
  fileSystemGuard?: FileSystemTurnGuard
) {
  const context = { fileSystemGuard, modelId, sessionId, target, userId };
  return {
    askQuestions: createAskQuestionsTool(context),
    autoStyler: createAutoStylerTool(context),
    dataAnalyzer: createDataAnalyzerTool(context),
    errorChecker: createErrorCheckerTool(context),
    fileManager: createFileManagerTool(context),
    fileSystem: createFileSystemTool(context),
    iconSearch: createIconSearchTool(context),
    styleSearch: createStyleSearchTool(context),
    thinking: createThinkingTool(),
    webSearch: createWebSearchTool(context)
  };
}
