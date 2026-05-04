<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar';
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

  interface Props {
    onNewChat: () => void | Promise<void>;
    onSelectConversation: (id: string) => void | Promise<void>;
    onDeleteConversation: (id: string) => void | Promise<void>;
    onTogglePanel: (panel: PanelId) => void;
    onOpenSettings: () => void;
  }

  let {
    onNewChat,
    onSelectConversation,
    onDeleteConversation,
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

<Sidebar.Root
  collapsible="icon"
  variant="sidebar"
  class="[&_[data-sidebar=menu-button]]:bg-transparent [&_[data-sidebar=menu-button]]:hover:bg-sidebar-accent [&_[data-sidebar=menu-button][data-active=true]]:bg-transparent [&_[data-sidebar=menu-button][data-active=true]]:hover:bg-sidebar-accent">
  <Sidebar.Header class="h-12 justify-center border-b border-sidebar-border px-2">
    <div
      class="flex h-9 items-center gap-2 px-2 text-[13px] font-semibold text-sidebar-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
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
      <Sidebar.GroupLabel>Chats</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        {#if conversationsStore.isLoading}
          <p class="px-2 py-1.5 text-[12px] text-muted-foreground">Loading…</p>
        {:else if !authStore.isLoggedIn}
          <p class="px-2 py-1.5 text-[12px] text-muted-foreground">Sign in to save chats</p>
        {:else if conversationsStore.list.length === 0}
          <p class="px-2 py-1.5 text-[12px] text-muted-foreground">No chats yet</p>
        {:else}
          <Sidebar.Menu>
            {#each conversationsStore.list as conv (conv.id)}
              {@const isActive = conv.id === conversationsStore.activeId}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton
                  {isActive}
                  size="sm"
                  class="text-muted-foreground data-[active=true]:text-sidebar-foreground"
                  onclick={() => onSelectConversation(conv.id)}>
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
    <Sidebar.Menu class="p-2">
      {#each panelButtons as btn (btn.id)}
        {@const Icon = btn.icon}
        {@const isActive = panels.panels[btn.id].visible}
        <Sidebar.MenuItem>
          <Sidebar.MenuButton
            {isActive}
            tooltipContent={btn.label}
            onclick={() => onTogglePanel(btn.id)}>
            <Icon />
            <span>{btn.label}</span>
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      {/each}
    </Sidebar.Menu>
    <Sidebar.Menu class="border-t border-sidebar-border p-2">
      <Sidebar.MenuItem>
        {#if authStore.isLoggedIn}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Sidebar.MenuButton size="lg" tooltipContent="Account" {...props}>
                  <Avatar class="size-7 rounded-md">
                    <AvatarFallback class="rounded-md bg-muted text-[10px]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div class="grid flex-1 text-left text-[13px] leading-tight">
                    <span class="truncate font-medium">
                      {authStore.user?.display_name || authStore.user?.email || 'User'}
                    </span>
                    {#if authStore.user?.email && authStore.user?.display_name}
                      <span class="truncate text-[11px] text-muted-foreground">
                        {authStore.user.email}
                      </span>
                    {/if}
                  </div>
                </Sidebar.MenuButton>
              {/snippet}
            </DropdownMenu.Trigger>
            <Sidebar.MenuAction
              onclick={onOpenSettings}
              aria-label="Settings"
              class="!top-1/2 -translate-y-1/2 group-data-[collapsible=icon]:hidden">
              <Settings />
            </Sidebar.MenuAction>
            <DropdownMenu.Content align="start" side="right" sideOffset={6} class="w-56">
              <DropdownMenu.Label class="flex flex-col gap-0.5">
                <span class="text-[13px] font-medium">
                  {authStore.user?.display_name || 'User'}
                </span>
                <span class="text-[11px] font-normal text-muted-foreground">
                  {authStore.user?.email}
                </span>
              </DropdownMenu.Label>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onclick={onOpenSettings}>
                <Settings class="size-4" />
                <span>Settings</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                class="text-red-500 focus:text-red-500"
                onclick={() => authStore.logout()}>
                <LogOut class="size-4" />
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
