<script lang="ts">
  /**
   * Recursive file tree for the sidebar Files view.
   *
   * Editing model: a single `editing` token identifies the row currently in
   * edit mode (`{ kind: 'file', id }`, `{ kind: 'folder', path }`, or `{ kind:
   * 'newFile', folderPath }`). The parent owns the token; this component
   * commits / cancels by calling back into the parent. No `window.prompt`
   * anywhere — input is an inline `<input>` with Enter/Esc keyboard.
   */
  import * as DropdownMenu from '$lib/client/ui/dropdown-menu';
  import { ChevronRight, FileCode, FileJson, FileText, MoreHorizontal, Plus } from 'lucide-svelte';
  import type { FileTreeNode, WorkspaceFile } from '$lib/client/stores/files.svelte';
  import FileTree from './FileTree.svelte';
  import type { EditingToken } from './fileTreeEditing';

  interface Props {
    nodes: FileTreeNode[];
    activeId: string | null;
    expanded: Set<string>;
    editing: EditingToken;
    depth?: number;
    onToggleFolder: (path: string) => void;
    onSelectFile: (file: WorkspaceFile) => void;
    onStartNewFile: (folderPath: string) => void;
    onStartRenameFile: (file: WorkspaceFile) => void;
    onStartRenameFolder: (folderPath: string) => void;
    onCommitNewFile: (folderPath: string, name: string) => void | Promise<void>;
    onCommitRenameFile: (file: WorkspaceFile, newName: string) => void | Promise<void>;
    onCommitRenameFolder: (folderPath: string, newName: string) => void | Promise<void>;
    onCancelEdit: () => void;
    onDeleteFile: (file: WorkspaceFile) => void;
    onDeleteFolder: (folderPath: string) => void;
  }

  let {
    nodes,
    activeId,
    expanded,
    editing,
    depth = 0,
    onToggleFolder,
    onSelectFile,
    onStartNewFile,
    onStartRenameFile,
    onStartRenameFolder,
    onCommitNewFile,
    onCommitRenameFile,
    onCommitRenameFolder,
    onCancelEdit,
    onDeleteFile,
    onDeleteFolder
  }: Props = $props();

  function fileIcon(kind: WorkspaceFile['kind']) {
    if (kind === 'json' || kind === 'yaml') return FileJson;
    if (kind === 'mermaid') return FileCode;
    return FileText;
  }

  function focusAndSelect(node: HTMLInputElement) {
    node.focus();
    // Select the basename, leaving the extension intact — OS-style.
    const v = node.value;
    const dot = v.lastIndexOf('.');
    if (dot > 0) node.setSelectionRange(0, dot);
    else node.select();
  }

  function commitOnEnterEsc(e: KeyboardEvent, commit: (v: string) => void, cancel: () => void) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = (e.currentTarget as HTMLInputElement).value.trim();
      if (v) commit(v);
      else cancel();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  function commitOnBlur(
    e: FocusEvent,
    initial: string,
    commit: (v: string) => void,
    cancel: () => void
  ) {
    const v = (e.currentTarget as HTMLInputElement).value.trim();
    if (!v || v === initial) cancel();
    else commit(v);
  }
</script>

<ul class="space-y-0.5">
  {#each nodes as node (node.type === 'folder' ? `f:${node.path}` : `${node.file.id}`)}
    {#if node.type === 'folder'}
      {@const isOpen = expanded.has(node.path)}
      {@const isRenaming = editing?.kind === 'folder' && editing.path === node.path}
      {@const newFileHere = editing?.kind === 'newFile' && editing.folderPath === node.path}
      <li>
        {#if isRenaming}
          <div
            class="flex h-7 items-center gap-1 rounded-md px-1"
            style="padding-left: {depth * 12 + 4}px;">
            <ChevronRight class="size-3.5 text-muted-foreground/60" />
            <input
              type="text"
              value={node.name}
              class="h-5 flex-1 rounded border border-sidebar-border bg-sidebar px-1 text-[13px] outline-none focus:ring-1 focus:ring-sidebar-ring"
              use:focusAndSelect
              onkeydown={(e) =>
                commitOnEnterEsc(e, (v) => onCommitRenameFolder(node.path, v), onCancelEdit)}
              onblur={(e) =>
                commitOnBlur(
                  e,
                  node.name,
                  (v) => onCommitRenameFolder(node.path, v),
                  onCancelEdit
                )} />
          </div>
        {:else}
          <div
            class="group/row flex h-7 items-center gap-1 rounded-md px-1 hover:bg-sidebar-accent"
            style="padding-left: {depth * 12 + 4}px;">
            <button
              type="button"
              class="flex flex-1 cursor-pointer items-center gap-1 text-left text-[13px] text-sidebar-foreground/85"
              onclick={() => onToggleFolder(node.path)}>
              <ChevronRight
                class="size-3.5 text-muted-foreground/60 transition-transform {isOpen
                  ? 'rotate-90'
                  : ''}" />
              <span class="truncate">{node.name}</span>
            </button>
            <button
              type="button"
              aria-label="New file in {node.name}"
              title="New file in {node.name}"
              class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/60 opacity-0 group-hover/row:opacity-100 hover:bg-sidebar-accent-foreground/10 hover:text-sidebar-foreground"
              onclick={(e) => {
                e.stopPropagation();
                if (!isOpen) onToggleFolder(node.path);
                onStartNewFile(node.path);
              }}>
              <Plus class="size-3.5" />
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <button
                    type="button"
                    aria-label="Folder menu"
                    class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/60 opacity-0 group-hover/row:opacity-100 hover:bg-sidebar-accent-foreground/10 hover:text-sidebar-foreground"
                    {...props}>
                    <MoreHorizontal class="size-3.5" />
                  </button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content class="w-36 p-1" align="start">
                <DropdownMenu.Item
                  onclick={() => onStartRenameFolder(node.path)}
                  class="cursor-pointer rounded px-2 py-1 text-[13px]">
                  Rename
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onclick={() => onDeleteFolder(node.path)}
                  class="cursor-pointer rounded px-2 py-1 text-[13px] text-destructive focus:text-destructive">
                  Delete folder
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        {/if}
        {#if isOpen}
          {#if newFileHere}
            <div
              class="flex h-7 items-center gap-2 rounded-md px-1"
              style="padding-left: {(depth + 1) * 12 + 18}px;">
              <FileCode class="size-3.5 shrink-0 text-muted-foreground/70" />
              <input
                type="text"
                value="Untitled.mermaid"
                class="h-5 flex-1 rounded border border-sidebar-border bg-sidebar px-1 text-[13px] outline-none focus:ring-1 focus:ring-sidebar-ring"
                use:focusAndSelect
                onkeydown={(e) =>
                  commitOnEnterEsc(e, (v) => onCommitNewFile(node.path, v), onCancelEdit)}
                onblur={(e) =>
                  commitOnBlur(e, '', (v) => onCommitNewFile(node.path, v), onCancelEdit)} />
            </div>
          {/if}
          <FileTree
            nodes={node.children}
            {activeId}
            {expanded}
            {editing}
            depth={depth + 1}
            {onToggleFolder}
            {onSelectFile}
            {onStartNewFile}
            {onStartRenameFile}
            {onStartRenameFolder}
            {onCommitNewFile}
            {onCommitRenameFile}
            {onCommitRenameFolder}
            {onCancelEdit}
            {onDeleteFile}
            {onDeleteFolder} />
        {/if}
      </li>
    {:else}
      {@const Icon = fileIcon(node.file.kind)}
      {@const isActive = node.file.id === activeId}
      {@const isRenaming = editing?.kind === 'file' && editing.id === node.file.id}
      {@const fileName = node.file.path.split('/').pop() ?? node.file.path}
      <li>
        {#if isRenaming}
          <div
            class="flex h-7 items-center gap-2 rounded-md px-1"
            style="padding-left: {depth * 12 + 18}px;">
            <Icon class="size-3.5 shrink-0 text-muted-foreground/70" />
            <input
              type="text"
              value={fileName}
              class="h-5 flex-1 rounded border border-sidebar-border bg-sidebar px-1 text-[13px] outline-none focus:ring-1 focus:ring-sidebar-ring"
              use:focusAndSelect
              onkeydown={(e) =>
                commitOnEnterEsc(e, (v) => onCommitRenameFile(node.file, v), onCancelEdit)}
              onblur={(e) =>
                commitOnBlur(e, fileName, (v) => onCommitRenameFile(node.file, v), onCancelEdit)} />
          </div>
        {:else}
          <div
            class="group/row flex h-7 items-center gap-1 rounded-md px-1 {isActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'hover:bg-sidebar-accent'}"
            style="padding-left: {depth * 12 + 18}px;">
            <button
              type="button"
              class="flex flex-1 cursor-pointer items-center gap-2 truncate text-left text-[13px] {isActive
                ? 'font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/85'}"
              onclick={() => onSelectFile(node.file)}>
              <Icon class="size-3.5 shrink-0 text-muted-foreground/70" />
              <span class="truncate">{fileName}</span>
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <button
                    type="button"
                    aria-label="File menu"
                    class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground/60 opacity-0 group-hover/row:opacity-100 hover:bg-sidebar-accent-foreground/10 hover:text-sidebar-foreground"
                    {...props}>
                    <MoreHorizontal class="size-3.5" />
                  </button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content class="w-36 p-1" align="start">
                <DropdownMenu.Item
                  onclick={() => onStartRenameFile(node.file)}
                  class="cursor-pointer rounded px-2 py-1 text-[13px]">
                  Rename
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onclick={() => onDeleteFile(node.file)}
                  class="cursor-pointer rounded px-2 py-1 text-[13px] text-destructive focus:text-destructive">
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        {/if}
      </li>
    {/if}
  {/each}
</ul>
