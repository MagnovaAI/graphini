export { createAskQuestionsTool } from './askQuestions';
export { createAutoStylerTool } from './autoStyler';
export { createDataAnalyzerTool } from './dataAnalyzer';
export { createErrorCheckerTool } from './errorChecker';
export { createFileSystemTool } from './fileSystem';
export { createIconSearchTool } from './iconSearch';
export { createStyleSearchTool } from './styleSearch';
export { createThinkingTool } from './thinking';
export { createUseSkillTool } from './useSkill';
export { createWebSearchTool } from './webSearch';

import { createAskQuestionsTool } from './askQuestions';
import { createAutoStylerTool } from './autoStyler';
import { createDataAnalyzerTool } from './dataAnalyzer';
import { createErrorCheckerTool } from './errorChecker';
import { createFileSystemTool } from './fileSystem';
import { createIconSearchTool } from './iconSearch';
import { createStyleSearchTool } from './styleSearch';
import { createThinkingTool } from './thinking';
import { createUseSkillTool } from './useSkill';
import { createWebSearchTool } from './webSearch';
import type { FileSystemTurnGuard, ToolContext, WorkspaceToolTarget } from './context';
import type { ProviderKeys } from '$lib/server/auth/provider-keys';
import type { PersonalizationSkillContext } from '$lib/server/chat/harness/types';

export function createDiagramTools(
  sessionId: string,
  modelId: string | undefined,
  target: WorkspaceToolTarget | undefined,
  userId: string | undefined,
  fileSystemGuard: FileSystemTurnGuard | undefined,
  keys: ProviderKeys,
  skills: PersonalizationSkillContext[] = []
) {
  const context: ToolContext = {
    keys,
    modelId,
    sessionId,
    skills,
    target,
    userId,
    workspaceFilesGuard: fileSystemGuard
  };
  return {
    askQuestions: createAskQuestionsTool(context),
    autoStyler: createAutoStylerTool(context),
    dataAnalyzer: createDataAnalyzerTool(context),
    errorChecker: createErrorCheckerTool(context),
    fileSystem: createFileSystemTool(context),
    iconSearch: createIconSearchTool(context),
    styleSearch: createStyleSearchTool(context),
    thinking: createThinkingTool(),
    useSkill: createUseSkillTool(context),
    webSearch: createWebSearchTool(context)
  };
}
