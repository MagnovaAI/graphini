import { tool } from 'ai';
import { z } from 'zod';
import type { ToolContext } from './context';

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function createUseSkillTool(context: ToolContext) {
  return tool({
    description:
      'Load one enabled user skill by name and return its instructions for this turn. Use this when the user asks to use a skill, mentions a skill name, or when a skill is clearly relevant. Call this before acting on the skill.',
    execute: async ({ name }) => {
      const requested = normalizeName(name);
      const skills = context.skills ?? [];
      const skill = skills.find(
        (item) =>
          normalizeName(item.name) === requested ||
          normalizeName(item.name).replace(/[-_]+/g, ' ') === requested
      );

      if (!skill) {
        return {
          success: false,
          name,
          availableSkills: skills.map((item) => item.name),
          error: `Skill not found or disabled: ${name}`
        };
      }

      return {
        success: true,
        name: skill.name,
        instructions: skill.description,
        summary: `Loaded ${skill.name}`
      };
    },
    inputSchema: z.object({
      name: z
        .string()
        .min(1)
        .describe('Exact name of the enabled user skill to load, for example "mermaid-expert".')
    })
  });
}
