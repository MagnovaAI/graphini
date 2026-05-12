<script lang="ts">
  import * as Sidebar from '$lib/client/ui/sidebar';
  import { tooltip } from '$lib/client/ui/tooltip/tooltipAction';
  import { useSidebar } from '$lib/client/ui/sidebar/context.svelte';
  import * as DropdownMenu from '$lib/client/ui/dropdown-menu';
  import { Avatar, AvatarFallback, AvatarImage } from '$lib/client/ui/avatar';
  import { authStore } from '$lib/client/stores/auth.svelte';
  import { conversationsStore } from '$lib/client/stores/conversations.svelte';
  import { filesStore, buildFileTree, type WorkspaceFile } from '$lib/client/stores/files.svelte';
  import { localBridgeStore } from '$lib/client/stores/localBridge.svelte';
  import { panels, type PanelId } from '$lib/client/stores/panels.svelte';
  import {
    Cloud,
    Code2,
    FileText,
    FolderTree,
    HardDrive,
    Layers,
    LogOut,
    MessageSquare,
    Plus,
    Settings,
    Trash2,
    UserCircle
  } from 'lucide-svelte';
  import FileTree from './FileTree.svelte';
  import type { EditingToken } from './fileTreeEditing';
  import { revealFileChannel } from './revealFile.svelte';
  import { onMount } from 'svelte';

  const sidebar = useSidebar();
  const isIconCollapsed = $derived(sidebar.state === 'collapsed' && !sidebar.isMobile);
  const bridge = $derived(localBridgeStore.state);
  onMount(() => {
    if (authStore.hasSession) void localBridgeStore.load();
  });
  async function switchWorkspaceSource(target: 'cloud' | 'local') {
    if (bridge.source === target) return;
    if (target === 'local' && !bridge.hasUrl) return;
    await localBridgeStore.setSource(target);
  }

  interface Props {
    onNewChat: () => void | Promise<void>;
    onSelectConversation: (id: string) => void | Promise<void>;
    onDeleteConversation: (id: string) => void | Promise<void>;
    onPrefetchConversation?: (id: string) => void;
    onTogglePanel: (panel: PanelId) => void;
    onOpenSettings: () => void;
    onSelectFile?: (id: string) => void | Promise<void>;
  }

  let {
    onNewChat,
    onSelectConversation,
    onDeleteConversation,
    onPrefetchConversation,
    onTogglePanel,
    onOpenSettings,
    onSelectFile
  }: Props = $props();

  type SidebarMode = 'chats' | 'files';
  let mode = $state<SidebarMode>('chats');

  // Folder open/close state for the file tree.
  let expandedFolders = $state<Set<string>>(new Set());
  // Which row is currently in edit mode. Null means nothing is being edited.
  let editing = $state<EditingToken>(null);
  // Whether the model wants to insert a new file at the *root* of the tree.
  // Drives the placeholder row above the tree (parallel to `editing.kind`
  // === 'newFile' inside folders).
  let creatingRoot = $state<string | null>(null); // initial filename or null
  let rootInputEl = $state<HTMLInputElement | null>(null);
  let fileNotice = $state<{
    action?: { label: string; onClick: () => void | Promise<void> };
    kind: 'error' | 'success';
    text: string;
  } | null>(null);
  let fileNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (creatingRoot !== null && rootInputEl) {
      rootInputEl.focus();
      const v = rootInputEl.value;
      const dot = v.lastIndexOf('.');
      if (dot > 0) rootInputEl.setSelectionRange(0, dot);
      else rootInputEl.select();
    }
  });

  const fileTree = $derived(buildFileTree(filesStore.list));

  function showFileNotice(
    text: string,
    kind: 'error' | 'success' = 'error',
    action?: { label: string; onClick: () => void | Promise<void> }
  ) {
    if (fileNoticeTimer) clearTimeout(fileNoticeTimer);
    fileNotice = { action, kind, text };
    fileNoticeTimer = setTimeout(() => {
      fileNotice = null;
      fileNoticeTimer = null;
    }, 3000);
  }

  onMount(() => {
    // Lazy-load files when the user first switches to Files mode.
  });

  // Lazy-load files when the user first switches to Files mode. Track which
  // mode we last fetched for so we don't re-fire on every store-state change.
  // (Reading filesStore.list / .loading inside this effect would create a
  // dependency that re-runs on empty responses → 429 loop.)
  let lastFetchedMode = $state<string | null>(null);
  $effect(() => {
    if (mode === 'files' && lastFetchedMode !== 'files') {
      lastFetchedMode = 'files';
      filesStore.fetchAllVisible();
    } else if (mode !== 'files' && lastFetchedMode === 'files') {
      lastFetchedMode = null;
    }
  });

  function expandAllAncestors(filePath: string) {
    const parts = filePath.split('/');
    parts.pop();
    let cursor = '';
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(expandedFolders);
    for (const seg of parts) {
      cursor = cursor ? `${cursor}/${seg}` : seg;
      next.add(cursor);
    }
    expandedFolders = next;
  }

  // Reveal-in-tree pulse: chat artifact filename clicks publish a
  // `{ path, token }` to revealFileChannel. We switch the sidebar to Files
  // mode, expand all ancestor folders so the file is visible, and select
  // it. The token guards against the effect re-firing on unrelated state
  // changes — only acts when a fresh pulse comes in.
  let lastRevealToken = $state(0);
  $effect(() => {
    const pulse = revealFileChannel.current;
    if (!pulse || pulse.token === lastRevealToken) return;
    lastRevealToken = pulse.token;
    mode = 'files';
    expandAllAncestors(pulse.path);
    const f = filesStore.list.find((x) => x.path === pulse.path);
    if (f) {
      filesStore.setActive(f.id);
      onSelectFile?.(f.id);
    }
  });

  function startNewFileAtRoot() {
    if (filesStore.quota.used >= filesStore.quota.total) {
      showFileNotice(
        `File quota reached (${filesStore.quota.used}/${filesStore.quota.total}). Delete a file to make room.`
      );
      return;
    }
    editing = null;
    creatingRoot = 'Untitled.mermaid';
  }

  function cancelEdit() {
    editing = null;
    creatingRoot = null;
  }

  async function commitNewFile(folderPath: string, name: string) {
    const path = folderPath ? `${folderPath}/${name}` : name;
    creatingRoot = null;
    editing = null;
    const result = await filesStore.create(path, '');
    if ('error' in result) {
      showFileNotice(result.error);
      return;
    }
    expandAllAncestors(result.path);
    filesStore.setActive(result.id);
    onSelectFile?.(result.id);
  }

  function handleToggleFolder(path: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(expandedFolders);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expandedFolders = next;
  }

  function startRenameFile(file: WorkspaceFile) {
    creatingRoot = null;
    editing = { kind: 'file', id: file.id };
  }

  function startRenameFolder(path: string) {
    creatingRoot = null;
    editing = { kind: 'folder', path };
  }

  function startNewFileInFolder(folderPath: string) {
    if (filesStore.quota.used >= filesStore.quota.total) {
      showFileNotice(
        `File quota reached (${filesStore.quota.used}/${filesStore.quota.total}). Delete a file to make room.`
      );
      return;
    }
    creatingRoot = null;
    editing = { kind: 'newFile', folderPath };
  }

  async function commitRenameFile(file: WorkspaceFile, newName: string) {
    editing = null;
    const parts = file.path.split('/');
    parts.pop();
    const newPath = parts.length ? `${parts.join('/')}/${newName}` : newName;
    if (newPath === file.path) return;
    const result = await filesStore.update(file.id, { path: newPath });
    if ('error' in result) showFileNotice(result.error);
  }

  async function commitRenameFolder(folderPath: string, newName: string) {
    editing = null;
    const parts = folderPath.split('/');
    parts.pop();
    const newFolder = parts.length ? `${parts.join('/')}/${newName}` : newName;
    if (newFolder === folderPath) return;
    const result = await filesStore.moveFolder(folderPath, newFolder);
    if (result.error) showFileNotice(result.error);
  }

  async function handleDeleteFile(file: WorkspaceFile) {
    // Optimistic delete with undo. The store's `remove` is hard delete;
    // for undo we restore by re-creating with the same path/content.
    const snapshot = { path: file.path, content: file.content };
    const ok = await filesStore.remove(file.id);
    if (!ok) {
      showFileNotice(`Failed to delete ${file.path}`);
      return;
    }
    showFileNotice(`Deleted ${file.path}`, 'success', {
      label: 'Undo',
      onClick: async () => {
        const r = await filesStore.create(snapshot.path, snapshot.content);
        if ('error' in r) showFileNotice(r.error);
      }
    });
  }

  async function handleDeleteFolder(path: string) {
    // Snapshot every file under the prefix so Undo can restore them.
    const prefix = `${path}/`;
    const snapshot = filesStore.list
      .filter((f) => f.path.startsWith(prefix))
      .map((f) => ({ path: f.path, content: f.content }));
    if (snapshot.length === 0) return;
    const result = await filesStore.deleteFolder(path);
    if (result.error) {
      showFileNotice(result.error);
      return;
    }
    showFileNotice(`Deleted folder ${path} (${result.deleted} files)`, 'success', {
      label: 'Undo',
      onClick: async () => {
        for (const f of snapshot) {
          const r = await filesStore.create(f.path, f.content);
          if ('error' in r) {
            showFileNotice(`Failed to restore ${f.path}: ${r.error}`);
            break;
          }
        }
      }
    });
  }

  // Active-file-aware viewer buttons. Keep the switcher stable in scratch
  // mode, then swap Canvas for Document only when a markdown file is active.
  const activeMode = $derived<null | 'mermaid' | 'json' | 'yaml' | 'md'>(
    filesStore.activeFile?.kind ?? null
  );

  // Chat is an independent toggle. Two-window rule: at most one viewer panel
  // is visible at a time; the sidebar's viewer switcher is a single-select
  // group, so flipping between Canvas/Document/Code keeps panel count fixed.
  interface ViewerOption {
    id: 'canvas' | 'document' | 'code';
    label: string;
    icon: typeof Layers;
  }
  const viewerButtons = $derived.by((): ViewerOption[] => {
    const opts: ViewerOption[] = [];
    if (activeMode === 'md') {
      opts.push({ id: 'document', label: 'Document', icon: FileText });
    } else {
      opts.push({ id: 'canvas', label: 'Canvas', icon: Layers });
    }
    opts.push({ id: 'code', label: 'Code', icon: Code2 });
    return opts;
  });

  const initials = $derived.by(() => {
    const src = authStore.user?.display_name || authStore.user?.email || 'U';
    return src
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  });

  const guestDisplayName = $derived(
    authStore.user?.is_guest === true && authStore.user.display_name
      ? authStore.user.display_name
      : 'Guest'
  );

  function conversationPreview(title: string | null | undefined): string {
    const text = title?.trim();
    if (!text) return 'Untitled chat';
    return text.length > 42 ? `${text.slice(0, 42).trim()}…` : text;
  }
</script>

<Sidebar.Root collapsible="icon" variant="sidebar">
  <Sidebar.Header class="gap-0 border-b border-sidebar-border p-0">
    <div
      class="flex h-9 items-center gap-2 px-3 text-[13px] font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <img src="/brand/logo.png" alt="" class="size-4 shrink-0" />
      <span class="truncate group-data-[collapsible=icon]:hidden">Graphini</span>
    </div>
  </Sidebar.Header>

  <Sidebar.Content>
    <!-- Mode toggle: Chats | Files -->
    <Sidebar.Group class="group-data-[collapsible=icon]:hidden">
      <Sidebar.GroupContent>
        <div
          class="grid grid-cols-2 gap-1 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/15 p-1 text-[13px]"
          role="tablist"
          aria-label="Sidebar mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'chats'}
            class="sb-tab-control flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sidebar-foreground/62"
            onclick={() => (mode = 'chats')}>
            <MessageSquare class="size-3.5" />
            <span>Chats</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'files'}
            class="sb-tab-control flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sidebar-foreground/62"
            onclick={() => (mode = 'files')}>
            <FolderTree class="size-3.5" />
            <span>Files</span>
          </button>
        </div>
      </Sidebar.GroupContent>
    </Sidebar.Group>

    {#if mode === 'chats'}
      <Sidebar.Group>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            <Sidebar.MenuItem>
              <button
                type="button"
                class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border/70 bg-sidebar px-3 text-left text-[13px] text-sidebar-foreground transition-[background-color,border-color,box-shadow,color,transform] duration-150 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:border-sidebar-border/60 group-data-[collapsible=icon]:bg-sidebar-accent/18 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:text-sidebar-foreground/78 hover:border-sidebar-foreground/18 hover:bg-sidebar-accent/28 group-data-[collapsible=icon]:hover:border-sidebar-foreground/20 group-data-[collapsible=icon]:hover:bg-sidebar-accent/45 group-data-[collapsible=icon]:hover:text-sidebar-foreground group-data-[collapsible=icon]:hover:shadow-[0_0_0_1px_hsl(var(--sidebar-foreground)/0.04)] group-data-[collapsible=icon]:active:scale-95"
                onclick={() => onNewChat()}>
                <Plus
                  class="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:size-4 group-data-[collapsible=icon]:text-current" />
                <span class="truncate group-data-[collapsible=icon]:hidden">New chat</span>
              </button>
            </Sidebar.MenuItem>
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>

      <!-- Chats -->
      <Sidebar.Group class="group-data-[collapsible=icon]:hidden">
        <Sidebar.GroupContent>
          {#if conversationsStore.isLoading}
            <p class="px-2 py-2 text-[13px] text-muted-foreground">Loading</p>
          {:else if !authStore.hasSession}
            <p class="px-2 py-2 text-[13px] text-muted-foreground">Open a chat to start saving</p>
          {:else if conversationsStore.list.length === 0}
            <p class="px-2 py-2 text-[13px] text-muted-foreground">No chats yet</p>
          {:else}
            <Sidebar.Menu>
              {#each conversationsStore.list as conv (conv.id)}
                {@const isActive = conv.id === conversationsStore.activeId}
                <Sidebar.MenuItem>
                  <button
                    type="button"
                    data-active={isActive}
                    class="sb-row-control peer/sidebar-row relative flex h-8 w-full cursor-pointer items-center rounded-md px-3 pr-9 text-left text-[13px] text-sidebar-foreground/72 before:absolute before:top-1.5 before:bottom-1.5 before:left-1 before:w-0.5 before:rounded-full before:bg-transparent data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground data-[active=true]:before:bg-[var(--sidebar-ring)]"
                    onclick={() => onSelectConversation(conv.id)}
                    onmouseenter={() => onPrefetchConversation?.(conv.id)}
                    onfocus={() => onPrefetchConversation?.(conv.id)}>
                    <span class="truncate">{conversationPreview(conv.title)}</span>
                  </button>
                  <button
                    type="button"
                    class="absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/65 opacity-0 transition-[background-color,color,opacity] group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-[active=true]/sidebar-row:opacity-100 hover:bg-sidebar-accent/45 hover:text-sidebar-foreground"
                    onclick={() => onDeleteConversation(conv.id)}
                    aria-label="Delete chat">
                    <Trash2 class="size-3.5" />
                  </button>
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          {/if}
        </Sidebar.GroupContent>
      </Sidebar.Group>
    {:else}
      <!-- Workspace source: Cloud (DB) | Local (graphini-bridge) -->
      <Sidebar.Group class="group-data-[collapsible=icon]:hidden">
        <Sidebar.GroupContent>
          <div
            class="grid grid-cols-2 gap-1 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/15 p-1 text-[13px]"
            role="tablist"
            aria-label="Workspace source">
            <button
              type="button"
              role="tab"
              aria-selected={bridge.source === 'cloud'}
              class="sb-tab-control flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sidebar-foreground/62"
              onclick={() => switchWorkspaceSource('cloud')}>
              <Cloud class="size-3.5" />
              <span>Cloud</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={bridge.source === 'local'}
              disabled={!bridge.hasUrl}
              use:tooltip={!bridge.hasUrl
                ? { content: 'Paste a bridge URL in Settings → Local files first.' }
                : undefined}
              class="sb-tab-control flex h-8 items-center justify-center gap-1.5 rounded-md text-sidebar-foreground/62 disabled:cursor-not-allowed disabled:opacity-55 {bridge.hasUrl
                ? 'cursor-pointer'
                : ''}"
              onclick={() => switchWorkspaceSource('local')}>
              <HardDrive class="size-3.5" />
              <span>Local</span>
            </button>
          </div>
        </Sidebar.GroupContent>
      </Sidebar.Group>

      <!-- New file + quota -->
      <Sidebar.Group>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            <Sidebar.MenuItem>
              <Sidebar.MenuButton
                tooltipContent={filesStore.quota.used >= filesStore.quota.total
                  ? `Quota reached (${filesStore.quota.used}/${filesStore.quota.total})`
                  : 'New file'}
                onclick={startNewFileAtRoot}
                class="h-9 border border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent {filesStore
                  .quota.used >= filesStore.quota.total
                  ? 'cursor-not-allowed opacity-50'
                  : ''}">
                <Plus />
                <span>New file</span>
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          </Sidebar.Menu>
          <div class="px-2 pt-2 group-data-[collapsible=icon]:hidden">
            <div class="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Files</span>
              <span>{filesStore.quota.used}/{filesStore.quota.total}</span>
            </div>
            <div class="h-1 overflow-hidden rounded-full bg-sidebar-accent">
              <div
                class="h-full rounded-full bg-sidebar-foreground/35"
                style={`width: ${Math.min(100, Math.round((filesStore.quota.used / Math.max(filesStore.quota.total, 1)) * 100))}%`}>
              </div>
            </div>
          </div>
          {#if fileNotice}
            <div class="px-2 pt-2 group-data-[collapsible=icon]:hidden">
              <div
                role="status"
                class="rounded-md border px-2.5 py-2 text-[12px] leading-4 {fileNotice.kind ===
                'error'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-sidebar-border bg-sidebar-accent/24 text-sidebar-foreground'}">
                <div class="flex items-start justify-between gap-2">
                  <span class="min-w-0 flex-1 break-words">{fileNotice.text}</span>
                  {#if fileNotice.action}
                    <button
                      type="button"
                      class="shrink-0 rounded-sm px-1.5 py-0.5 text-[12px] font-medium text-sidebar-foreground underline-offset-2 hover:bg-sidebar-accent hover:underline focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:outline-none"
                      onclick={async () => {
                        const action = fileNotice?.action;
                        fileNotice = null;
                        if (fileNoticeTimer) {
                          clearTimeout(fileNoticeTimer);
                          fileNoticeTimer = null;
                        }
                        await action?.onClick();
                      }}>
                      {fileNotice.action.label}
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </Sidebar.GroupContent>
      </Sidebar.Group>

      <!-- Files tree -->
      <Sidebar.Group class="group-data-[collapsible=icon]:hidden">
        <Sidebar.GroupContent class="px-1">
          {#if creatingRoot !== null}
            <div class="flex h-7 items-center gap-2 rounded-md px-1" style="padding-left: 18px;">
              <img src="/icons/file-mermaid.svg" alt="" class="size-3.5 shrink-0" />
              <input
                type="text"
                value={creatingRoot}
                bind:this={rootInputEl}
                class="h-5 flex-1 rounded border border-sidebar-border bg-sidebar px-1 text-[13px] outline-none focus:ring-1 focus:ring-sidebar-ring"
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const input = e.currentTarget as HTMLInputElement;
                    if (input.dataset.committed === '1') return;
                    input.dataset.committed = '1';
                    const v = input.value.trim();
                    if (v) commitNewFile('', v);
                    else cancelEdit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    const input = e.currentTarget as HTMLInputElement;
                    if (input.dataset.committed === '1') return;
                    input.dataset.committed = '1';
                    cancelEdit();
                  }
                }}
                onblur={(e) => {
                  const input = e.currentTarget as HTMLInputElement;
                  if (input.dataset.committed === '1') return;
                  input.dataset.committed = '1';
                  const v = input.value.trim();
                  if (!v) cancelEdit();
                  else commitNewFile('', v);
                }} />
            </div>
          {/if}
          {#if filesStore.loading && fileTree.length === 0}
            <p class="px-2 py-2 text-[13px] text-muted-foreground">Loading</p>
          {:else if fileTree.length === 0 && creatingRoot === null}
            <p class="px-2 py-2 text-[13px] text-muted-foreground">
              No files yet. Click + to create one.
            </p>
          {:else}
            <FileTree
              nodes={fileTree}
              activeId={filesStore.activeId}
              expanded={expandedFolders}
              {editing}
              onToggleFolder={handleToggleFolder}
              onSelectFile={(file) => {
                filesStore.setActive(file.id);
                onSelectFile?.(file.id);
              }}
              onStartNewFile={startNewFileInFolder}
              onStartRenameFile={startRenameFile}
              onStartRenameFolder={startRenameFolder}
              onCommitNewFile={commitNewFile}
              onCommitRenameFile={commitRenameFile}
              onCommitRenameFolder={commitRenameFolder}
              onCancelEdit={cancelEdit}
              onDeleteFile={handleDeleteFile}
              onDeleteFolder={handleDeleteFolder} />
          {/if}
        </Sidebar.GroupContent>
      </Sidebar.Group>
    {/if}
  </Sidebar.Content>

  <Sidebar.Footer class="gap-0 border-t border-sidebar-border p-0">
    <!-- Chat is independent; viewer buttons are single-select in the page handler. -->
    <div class="p-2 group-data-[collapsible=icon]:p-1.5">
      <div
        class="grid gap-0.5 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/10 p-0.5 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 {viewerButtons.length >
        0
          ? 'grid-cols-3'
          : 'grid-cols-1'}"
        role="toolbar"
        aria-label="Panel visibility">
        <button
          type="button"
          aria-label="Chat"
          aria-pressed={panels.panels.chat.visible}
          use:tooltip={{ text: 'Chat', side: 'top' }}
          onclick={() => onTogglePanel('chat')}
          class="sb-panel-control flex h-7 w-full items-center justify-center gap-1.5 rounded-sm text-[12px] font-medium text-muted-foreground outline-none group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:rounded-md">
          <MessageSquare class="size-3.5 shrink-0" />
          <span class="group-data-[collapsible=icon]:hidden">Chat</span>
        </button>
        {#if viewerButtons.length > 0}
          {#each viewerButtons as btn (btn.id)}
            {@const Icon = btn.icon}
            {@const isActive = panels.panels[btn.id].visible}
            <button
              type="button"
              aria-label={btn.label}
              aria-pressed={isActive}
              use:tooltip={{ text: btn.label, side: 'top' }}
              onclick={() => onTogglePanel(btn.id)}
              class="sb-panel-control flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-sm text-[12px] font-medium text-muted-foreground outline-none group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:rounded-md">
              <Icon class="size-3.5 shrink-0" />
              <span class="min-w-0 truncate group-data-[collapsible=icon]:hidden">{btn.label}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
    <Sidebar.Menu class="border-t border-sidebar-border p-2">
      <Sidebar.MenuItem>
        {#if authStore.isLoggedIn}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Sidebar.MenuButton
                  tooltipContent="Account"
                  class="h-11 gap-2 rounded-lg pr-9 pl-2 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:p-0! focus-visible:bg-sidebar-accent/28 focus-visible:ring-0"
                  {...props}>
                  <Avatar class="size-7 rounded-full group-data-[collapsible=icon]:size-8">
                    {#if authStore.user?.avatar_url}
                      <AvatarImage
                        src={authStore.user.avatar_url}
                        alt={authStore.user?.display_name || authStore.user?.email || 'User'} />
                    {/if}
                    <AvatarFallback class="rounded-full bg-muted text-[11px] font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span class="flex min-w-0 flex-1 flex-col leading-tight">
                    <span class="block truncate text-[13px] font-medium">
                      {authStore.user?.display_name || authStore.user?.email || 'User'}
                    </span>
                    <span class="block truncate text-[11px] font-normal text-muted-foreground">
                      Account
                    </span>
                  </span>
                </Sidebar.MenuButton>
              {/snippet}
            </DropdownMenu.Trigger>
            <Sidebar.MenuAction
              onclick={onOpenSettings}
              aria-label="Settings"
              class="top-1/2! right-2 size-7 -translate-y-1/2 text-muted-foreground/80 group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent/40 hover:text-sidebar-foreground focus-visible:bg-sidebar-accent/35 focus-visible:ring-0 [&>svg]:size-4">
              <Settings />
            </Sidebar.MenuAction>
            <DropdownMenu.Content
              align={isIconCollapsed ? 'end' : 'start'}
              side={isIconCollapsed ? 'right' : 'top'}
              sideOffset={6}
              class="w-56 p-1">
              <!--
                Account header. Shows the Google avatar (when present), the
                display name, and email — same data shape /api/auth/me hands
                back after the OAuth handshake against auth.magnova.ai.
              -->
              <DropdownMenu.Label class="px-2 py-2">
                <div class="flex items-center gap-2.5">
                  <Avatar class="size-8 rounded-full">
                    {#if authStore.user?.avatar_url}
                      <AvatarImage
                        src={authStore.user.avatar_url}
                        alt={authStore.user?.display_name || authStore.user?.email || 'User'} />
                    {/if}
                    <AvatarFallback class="rounded-full bg-muted text-[12px] font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div class="flex min-w-0 flex-1 flex-col">
                    {#if authStore.user?.display_name}
                      <span class="truncate text-[13px] font-medium text-foreground">
                        {authStore.user.display_name}
                      </span>
                    {/if}
                    {#if authStore.user?.email}
                      <span class="truncate text-[12px] font-normal text-muted-foreground">
                        {authStore.user.email}
                      </span>
                    {:else if !authStore.user?.display_name}
                      <span class="truncate text-[13px] font-medium text-foreground">User</span>
                    {/if}
                  </div>
                </div>
              </DropdownMenu.Label>
              <DropdownMenu.Separator class="my-1" />
              <DropdownMenu.Item
                onclick={onOpenSettings}
                class="cursor-pointer rounded-md px-2 py-1 text-[13px]">
                <Settings class="size-3.5" />
                <span>Settings</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onclick={() => authStore.logout()}
                class="cursor-pointer rounded-md px-2 py-1 text-[13px] text-destructive focus:text-destructive">
                <LogOut class="size-3.5" />
                <span>Sign out</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {:else}
          <!--
            Guest / logged-out state. Same dropdown shape as the signed-in
            footer so guests can reach Settings (their own API keys live in
            localStorage there) and clear their session via Sign out. The
            primary affordance is still "Sign in" — that's the most likely
            action — but Settings is reachable too.
          -->
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Sidebar.MenuButton
                  tooltipContent="Account"
                  class="h-11 gap-2 rounded-lg pr-9 pl-2 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:p-0! focus-visible:bg-sidebar-accent/28 focus-visible:ring-0"
                  {...props}>
                  <Avatar class="size-7 rounded-full group-data-[collapsible=icon]:size-8">
                    <AvatarFallback class="rounded-full bg-muted text-[11px] font-medium">
                      {guestDisplayName.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span class="flex min-w-0 flex-1 flex-col leading-tight">
                    <span class="block truncate text-[13px] font-medium">{guestDisplayName}</span>
                    <span class="block truncate text-[11px] font-normal text-muted-foreground">
                      Local settings
                    </span>
                  </span>
                </Sidebar.MenuButton>
              {/snippet}
            </DropdownMenu.Trigger>
            <Sidebar.MenuAction
              onclick={onOpenSettings}
              aria-label="Settings"
              class="top-1/2! right-2 size-7 -translate-y-1/2 text-muted-foreground/80 group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent/40 hover:text-sidebar-foreground focus-visible:bg-sidebar-accent/35 focus-visible:ring-0 [&>svg]:size-4">
              <Settings />
            </Sidebar.MenuAction>
            <DropdownMenu.Content
              align={isIconCollapsed ? 'end' : 'start'}
              side={isIconCollapsed ? 'right' : 'top'}
              sideOffset={6}
              class="w-56 p-1">
              <DropdownMenu.Label class="px-2 py-2">
                <div class="flex items-center gap-2.5">
                  <Avatar class="size-8 rounded-full">
                    <AvatarFallback class="rounded-full bg-muted text-[12px] font-medium">
                      <UserCircle class="size-4 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-[13px] font-medium text-foreground">
                      {guestDisplayName}
                    </span>
                    <span class="truncate text-[12px] font-normal text-muted-foreground"
                      >Sign in to save your work</span>
                  </div>
                </div>
              </DropdownMenu.Label>
              <DropdownMenu.Separator class="my-1" />
              <DropdownMenu.Item
                onclick={onOpenSettings}
                class="cursor-pointer rounded-md px-2 py-1 text-[13px]">
                <Settings class="size-3.5" />
                <span>Settings</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onclick={() => authStore.login()}
                class="cursor-pointer rounded-md px-2 py-1 text-[13px]">
                <LogOut class="size-3.5 rotate-180" />
                <span>Sign in</span>
              </DropdownMenu.Item>
              {#if authStore.isGuest}
                <DropdownMenu.Item
                  onclick={() => authStore.logout()}
                  class="cursor-pointer rounded-md px-2 py-1 text-[13px] text-destructive focus:text-destructive">
                  <LogOut class="size-3.5" />
                  <span>Sign out</span>
                </DropdownMenu.Item>
              {/if}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>
</Sidebar.Root>

<style>
  /* Sidebar interactive controls share one contrast model:
     in light mode, hover/active darken (foreground tint over white surface);
     in dark mode, hover/active lighten (white tint over near-black surface).
     We avoid blending toward --sidebar-accent because it sits within ~5% L
     of the surface in both modes and produces no visible separation. */

  /* Tabs (Chats / Files) — quieted to match the row-level scale (4% hover,
     6% selected). Selected state stays signaled by font-weight + full-
     contrast foreground color, not by a heavy bg. */
  :global(.sb-tab-control) {
    transition:
      background-color 120ms ease,
      color 120ms ease,
      transform 120ms ease;
  }
  :global(.sb-tab-control:hover) {
    color: var(--sidebar-foreground);
    background: color-mix(in srgb, var(--sidebar-foreground) 4%, transparent);
  }
  :global(.sb-tab-control:active) {
    transform: scale(0.97);
    background: color-mix(in srgb, var(--sidebar-foreground) 8%, transparent);
  }
  :global(.sb-tab-control[aria-selected='true']) {
    color: var(--sidebar-foreground);
    font-weight: 500;
    background: color-mix(in srgb, var(--sidebar-foreground) 6%, transparent);
  }
  :global(.dark .sb-tab-control:hover) {
    background: rgb(255 255 255 / 0.04);
  }
  :global(.dark .sb-tab-control:active) {
    background: rgb(255 255 255 / 0.08);
  }
  :global(.dark .sb-tab-control[aria-selected='true']) {
    background: rgb(255 255 255 / 0.06);
  }

  /* Conversation rows */
  :global(.sb-row-control) {
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  :global(.sb-row-control:hover) {
    color: var(--sidebar-foreground);
    background: color-mix(in srgb, var(--sidebar-foreground) 4%, transparent);
  }
  /* Active row: subtle tint + the left rail (set via ::before in the
     button class) does the actual "this is selected" signaling. Previous
     12% bg was reading as a solid grey button. */
  :global(.sb-row-control[data-active='true']) {
    background: color-mix(in srgb, var(--sidebar-foreground) 6%, transparent);
  }
  :global(.dark .sb-row-control:hover) {
    background: rgb(255 255 255 / 0.04);
  }
  :global(.dark .sb-row-control[data-active='true']) {
    background: rgb(255 255 255 / 0.06);
  }

  /* Panel toggles (Chat / Canvas / Code / Document) — same calmer scale
     as the tab and row controls. */
  :global(.sb-panel-control) {
    transition:
      background-color 120ms ease,
      color 120ms ease,
      transform 120ms ease;
  }
  :global(.sb-panel-control:hover) {
    color: var(--sidebar-foreground);
    background: color-mix(in srgb, var(--sidebar-foreground) 4%, transparent);
  }
  :global(.sb-panel-control:active) {
    transform: scale(0.96);
    background: color-mix(in srgb, var(--sidebar-foreground) 8%, transparent);
  }
  :global(.sb-panel-control:focus-visible) {
    color: var(--sidebar-foreground);
    background: color-mix(in srgb, var(--sidebar-foreground) 5%, transparent);
  }
  :global(.sb-panel-control[aria-pressed='true']) {
    color: var(--sidebar-foreground);
    background: color-mix(in srgb, var(--sidebar-foreground) 6%, transparent);
  }
  :global(.dark .sb-panel-control:hover) {
    background: rgb(255 255 255 / 0.04);
  }
  :global(.dark .sb-panel-control:active) {
    background: rgb(255 255 255 / 0.08);
  }
  :global(.dark .sb-panel-control:focus-visible) {
    background: rgb(255 255 255 / 0.05);
  }
  :global(.dark .sb-panel-control[aria-pressed='true']) {
    background: rgb(255 255 255 / 0.06);
  }
</style>
