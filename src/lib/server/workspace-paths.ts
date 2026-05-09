/**
 * Shared validation for workspace file/folder paths.
 *
 * Allowed: letters, digits, `.`, `-`, `_`, `/`, and single ASCII spaces.
 * Disallowed: leading slash or space, trailing slash or space, double
 * slashes, and spaces adjacent to slashes (which would imply trimmed
 * folder/file names).
 */

export const PATH_RE =
  /^(?!\/)(?! )(?!.*\/\/)(?!.* \/)(?!.*\/ )(?!.*\/$)(?!.* $)[A-Za-z0-9._\- /]{1,200}$/;

export const FOLDER_RE = /^(?! )(?!.* $)(?!.* \/)(?!.*\/ )[A-Za-z0-9._\- /]{1,200}$/;

export const FILE_KIND_BY_EXT: Record<string, 'md' | 'json' | 'yaml' | 'mermaid'> = {
  json: 'json',
  md: 'md',
  mermaid: 'mermaid',
  mmd: 'mermaid',
  yaml: 'yaml',
  yml: 'yaml'
};

export type FileKind = 'md' | 'json' | 'yaml' | 'mermaid';

export function deriveKind(path: string): FileKind | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return FILE_KIND_BY_EXT[ext] ?? null;
}
