<script lang="ts">
  import * as Sidebar from '$lib/client/ui/sidebar';
  import { tooltip } from '$lib/client/ui/tooltip/tooltipAction';
  import { useSidebar } from '$lib/client/ui/sidebar/context.svelte';
  import * as DropdownMenu from '$lib/client/ui/dropdown-menu';
  import { Avatar, AvatarFallback, AvatarImage } from '$lib/client/ui/avatar';
  import { authStore } from '$lib/client/stores/auth.svelte';
  import { conversationsStore } from '$lib/client/stores/conversations.svelte';
  import { filesStore, buildFileTree, type WorkspaceFile } from '$lib/client/stores/files.svelte';
  import { panels, type PanelId } from '$lib/client/stores/panels.svelte';
  import {
    Code2,
    FileCode,
    FileText,
    FolderTree,
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
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';

  const sidebar = useSidebar();
  const isIconCollapsed = $derived(sidebar.state === 'collapsed' && !sidebar.isMobile);

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

  onMount(() => {
    // Lazy-load files when the user first switches to Files mode.
  });

  $effect(() => {
    if (mode === 'files' && filesStore.list.length === 0 && !filesStore.loading) {
      filesStore.fetchAll();
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

  function startNewFileAtRoot() {
    if (filesStore.quota.used >= filesStore.quota.total) {
      toast.error(
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
      toast.error(result.error);
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
      toast.error(
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
    if ('error' in result) toast.error(result.error);
  }

  async function commitRenameFolder(folderPath: string, newName: string) {
    editing = null;
    const parts = folderPath.split('/');
    parts.pop();
    const newFolder = parts.length ? `${parts.join('/')}/${newName}` : newName;
    if (newFolder === folderPath) return;
    const result = await filesStore.moveFolder(folderPath, newFolder);
    if (result.error) toast.error(result.error);
  }

  async function handleDeleteFile(file: WorkspaceFile) {
    // Optimistic delete with 5s undo. The store's `remove` is hard delete;
    // for undo we restore by re-creating with the same path/content.
    const snapshot = { path: file.path, content: file.content };
    const ok = await filesStore.remove(file.id);
    if (!ok) {
      toast.error(`Failed to delete ${file.path}`);
      return;
    }
    toast(`Deleted ${file.path}`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: async () => {
          const r = await filesStore.create(snapshot.path, snapshot.content);
          if ('error' in r) toast.error(r.error);
        }
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
      toast.error(result.error);
      return;
    }
    toast(`Deleted folder ${path} (${result.deleted} files)`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: async () => {
          for (const f of snapshot) {
            const r = await filesStore.create(f.path, f.content);
            if ('error' in r) {
              toast.error(`Failed to restore ${f.path}: ${r.error}`);
              break;
            }
          }
        }
      }
    });
  }

  // Active-file-aware panel buttons. With no file selected (scratch mode),
  // only the Chat button shows. Markdown files swap Canvas for Document.
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
    if (activeMode === null) return [];
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
</script>

<Sidebar.Root collapsible="icon" variant="sidebar">
  <Sidebar.Header class="gap-0 border-b border-sidebar-border p-0">
    <div
      class="flex h-9 items-center gap-2 px-3 text-[13px] font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <img src="/brand/logo.png" alt="" class="size-5 shrink-0" />
      <span class="truncate group-data-[collapsible=icon]:hidden">Graphini</span>
    </div>
  </Sidebar.Header>

  <Sidebar.Content>
    <!-- Mode toggle: Chats | Files -->
    <Sidebar.Group class="group-data-[collapsible=icon]:hidden">
      <Sidebar.GroupContent>
        <div
          class="grid grid-cols-2 gap-1 rounded-md bg-sidebar-accent/40 p-0.5 text-[13px]"
          role="tablist"
          aria-label="Sidebar mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'chats'}
            class="flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded text-foreground text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground aria-selected:bg-sidebar aria-selected:font-medium aria-selected:shadow-sm"
            onclick={() => (mode = 'chats')}>
            <MessageSquare class="size-3.5" />
            <span>Chats</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'files'}
            class="flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded text-foreground text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground aria-selected:bg-sidebar aria-selected:font-medium aria-selected:shadow-sm"
            onclick={() => (mode = 'files')}>
            <FolderTree class="size-3.5" />
            <span>Files</span>
          </button>
        </div>
      </Sidebar.GroupContent>
    </Sidebar.Group>

    {#if mode === 'chats'}
      <!-- New chat -->
      <Sidebar.Group>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            <Sidebar.MenuItem>
              <Sidebar.MenuButton tooltipContent="New chat" onclick={() => onNewChat()}>
                <Plus />
                <span>New chat</span>
              </Sidebar.MenuButton>
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
                  <Sidebar.MenuButton
                    {isActive}
                    size="sm"
                    onclick={() => onSelectConversation(conv.id)}
                    onmouseenter={() => onPrefetchConversation?.(conv.id)}
                    onfocus={() => onPrefetchConversation?.(conv.id)}>
                    <span class="truncate">{conv.title || 'Untitled chat'}</span>
                  </Sidebar.MenuButton>
                  <Sidebar.MenuAction
                    showOnHover
                    onclick={() => onDeleteConversation(conv.id)}
                    aria-label="Delete chat">
                    <Trash2 />
                  </Sidebar.MenuAction>
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          {/if}
        </Sidebar.GroupContent>
      </Sidebar.Group>
    {:else}
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
                class={filesStore.quota.used >= filesStore.quota.total
                  ? 'cursor-not-allowed opacity-50'
                  : ''}>
                <Plus />
                <span>New file</span>
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          </Sidebar.Menu>
          <p class="px-2 pt-1 text-[11px] text-muted-foreground">
            {filesStore.quota.used} / {filesStore.quota.total} files
          </p>
        </Sidebar.GroupContent>
      </Sidebar.Group>

      <!-- Files tree -->
      <Sidebar.Group class="group-data-[collapsible=icon]:hidden">
        <Sidebar.GroupContent class="px-1">
          {#if creatingRoot !== null}
            <div class="flex h-7 items-center gap-2 rounded-md px-1" style="padding-left: 18px;">
              <FileCode class="size-3.5 shrink-0 text-muted-foreground/70" />
              <input
                type="text"
                value={creatingRoot}
                bind:this={rootInputEl}
                class="h-5 flex-1 rounded border border-sidebar-border bg-sidebar px-1 text-[13px] outline-none focus:ring-1 focus:ring-sidebar-ring"
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = (e.currentTarget as HTMLInputElement).value.trim();
                    if (v) commitNewFile('', v);
                    else cancelEdit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}
                onblur={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value.trim();
                  if (!v) cancelEdit();
                  else commitNewFile('', v);
                }} />
            </div>
          {/if}
          {#if filesStore.loading}
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
    <!--
      Two switches: Chat (independent toggle) and the viewer group (Canvas /
      Document / Code, single-select). Layout enforces the two-window rule —
      max one viewer visible at any time. The viewer group only renders when
      a workspace file is active; scratch mode shows just the Chat toggle.
    -->
    <div class="flex flex-col gap-1 p-2 group-data-[collapsible=icon]:gap-1">
      <button
        type="button"
        aria-label="Chat"
        aria-pressed={panels.panels.chat.visible}
        use:tooltip={{ text: 'Chat', side: 'top' }}
        onclick={() => onTogglePanel('chat')}
        class="flex h-8 w-full items-center justify-center gap-2 rounded-md text-[13px] text-muted-foreground transition-colors group-data-[collapsible=icon]:size-8 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-pressed:bg-sidebar-accent aria-pressed:font-medium aria-pressed:text-sidebar-accent-foreground">
        <MessageSquare class="size-4 shrink-0" />
        <span class="group-data-[collapsible=icon]:hidden">Chat</span>
      </button>
      {#if viewerButtons.length > 0}
        <div
          class="flex gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1"
          role="tablist"
          aria-label="Viewer">
          {#each viewerButtons as btn (btn.id)}
            {@const Icon = btn.icon}
            {@const isActive = panels.panels[btn.id].visible}
            <button
              type="button"
              role="tab"
              aria-label={btn.label}
              aria-selected={isActive}
              use:tooltip={{ text: btn.label, side: 'top' }}
              onclick={() => onTogglePanel(btn.id)}
              class="flex h-8 flex-1 items-center justify-center gap-2 rounded-md text-[13px] text-muted-foreground transition-colors group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-selected:bg-sidebar-accent aria-selected:font-medium aria-selected:text-sidebar-accent-foreground">
              <Icon class="size-4 shrink-0" />
              <span class="group-data-[collapsible=icon]:hidden">{btn.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <Sidebar.Menu class="border-t border-sidebar-border p-2">
      <Sidebar.MenuItem>
        {#if authStore.isLoggedIn}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Sidebar.MenuButton tooltipContent="Account" {...props}>
                  <Avatar class="size-5 rounded-full">
                    {#if authStore.user?.avatar_url}
                      <AvatarImage
                        src={authStore.user.avatar_url}
                        alt={authStore.user?.display_name || authStore.user?.email || 'User'} />
                    {/if}
                    <AvatarFallback class="rounded-full bg-muted text-[10px] font-medium">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span class="truncate text-[13px] font-medium">
                    {authStore.user?.display_name || authStore.user?.email || 'User'}
                  </span>
                </Sidebar.MenuButton>
              {/snippet}
            </DropdownMenu.Trigger>
            <Sidebar.MenuAction
              onclick={onOpenSettings}
              aria-label="Settings"
              class="group-data-[collapsible=icon]:hidden">
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
                <Sidebar.MenuButton tooltipContent="Account" {...props}>
                  <UserCircle />
                  <span class="truncate text-[13px] font-medium">{guestDisplayName}</span>
                </Sidebar.MenuButton>
              {/snippet}
            </DropdownMenu.Trigger>
            <Sidebar.MenuAction
              onclick={onOpenSettings}
              aria-label="Settings"
              class="group-data-[collapsible=icon]:hidden">
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
