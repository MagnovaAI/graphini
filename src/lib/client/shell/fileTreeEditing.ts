/**
 * Token identifying which row in the file tree is currently in edit mode.
 * One row at a time; null when nothing is being edited.
 */
export type EditingToken =
  | { kind: 'file'; id: string }
  | { kind: 'folder'; path: string }
  | { kind: 'newFile'; folderPath: string }
  | null;
