<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { tooltip } from '$lib/components/ui/tooltip/tooltipAction';
  import { useSidebar } from '$lib/components/ui/sidebar/context.svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
  import { authStore } from '$lib/stores/auth.svelte';
  import { conversationsStore } from '$lib/stores/conversations.svelte';
  import { panels, type PanelId } from '$lib/stores/panels.svelte';
  import {
    Code2,
    Layers,
    LogOut,
    MessageSquare,
    Plus,
    Settings,
    Trash2,
    UserCircle
  } from 'lucide-svelte';

  const sidebar = useSidebar();
  const isIconCollapsed = $derived(sidebar.state === 'collapsed' && !sidebar.isMobile);

  interface Props {
    onNewChat: () => void | Promise<void>;
    onSelectConversation: (id: string) => void | Promise<void>;
    onDeleteConversation: (id: string) => void | Promise<void>;
    onPrefetchConversation?: (id: string) => void;
    onTogglePanel: (panel: PanelId) => void;
    onOpenSettings: () => void;
  }

  let {
    onNewChat,
    onSelectConversation,
    onDeleteConversation,
    onPrefetchConversation,
    onTogglePanel,
    onOpenSettings
  }: Props = $props();

  const panelButtons: { id: PanelId; label: string; icon: typeof Layers }[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'canvas', label: 'Canvas', icon: Layers },
    { id: 'code', label: 'Code', icon: Code2 }
  ];

  const initials = $derived.by(() => {
    const src = authStore.user?.display_name || authStore.user?.email || 'U';
    return src
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  });
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
        {:else if !authStore.isLoggedIn}
          <p class="px-2 py-2 text-[13px] text-muted-foreground">Sign in to save chats</p>
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
  </Sidebar.Content>

  <Sidebar.Footer class="gap-0 border-t border-sidebar-border p-0">
    <div
      class="flex gap-1 p-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1">
      {#each panelButtons as btn (btn.id)}
        {@const Icon = btn.icon}
        {@const isActive = panels.panels[btn.id].visible}
        <button
          type="button"
          aria-label={btn.label}
          aria-pressed={isActive}
          use:tooltip={{ text: btn.label, side: 'top' }}
          onclick={() => onTogglePanel(btn.id)}
          class="flex h-8 flex-1 items-center justify-center gap-2 rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground aria-pressed:font-medium group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none">
          <Icon class="size-4 shrink-0" />
          <span class="group-data-[collapsible=icon]:hidden">{btn.label}</span>
        </button>
      {/each}
    </div>
    <Sidebar.Menu class="border-t border-sidebar-border p-2">
      <Sidebar.MenuItem>
        {#if authStore.isLoggedIn}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Sidebar.MenuButton tooltipContent="Account" {...props}>
                  <Avatar class="size-5 rounded-sm">
                    <AvatarFallback class="rounded-sm bg-muted text-[13px]">
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
              class="w-44 p-1">
              <DropdownMenu.Label
                class="truncate px-2 py-1 text-[13px] font-normal text-muted-foreground">
                {authStore.user?.display_name || authStore.user?.email || 'User'}
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
          <Sidebar.MenuButton tooltipContent="Sign in" onclick={() => authStore.login()}>
            <UserCircle />
            <span>Sign in</span>
          </Sidebar.MenuButton>
        {/if}
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>
</Sidebar.Root>
