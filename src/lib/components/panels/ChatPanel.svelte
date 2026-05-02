<script lang="ts">
  import { authStore } from '$lib/stores/auth.svelte';
  import { conversationsStore } from '$lib/stores/conversations.svelte';
  import { cn } from '$lib/util';
  import { Archive, History, MessageSquare, Pin, Plus, Trash2 } from 'lucide-svelte';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  interface Props {
    children?: Snippet;
    onNewChat?: () => void;
    onClearChat?: () => void;
    onSelectConversation?: (id: string) => void;
  }

  let { children, onNewChat, onClearChat, onSelectConversation }: Props = $props();

  let showHistory = $state(false);

  // Active conversation name
  let activeChatName = $derived.by(() => {
    if (!conversationsStore.activeId) return 'New Chat';
    const conv = conversationsStore.list.find((c) => c.id === conversationsStore.activeId);
    return conv?.title || 'Untitled';
  });

  function formatConvTime(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  }

  function handleSelectConversation(id: string) {
    conversationsStore.setActive(id);
    onSelectConversation?.(id);
    showHistory = false;
  }

  async function handleNewChatFromHistory() {
    conversationsStore.setActive(null);
    onNewChat?.();
    showHistory = false;
  }

  async function handleDeleteConversation(e: MouseEvent, id: string) {
    e.stopPropagation();
    const wasActive = conversationsStore.activeId === id;
    await conversationsStore.delete(id);
    // Notify Chat component to clear KV cache for this conversation
    window.dispatchEvent(new CustomEvent('conversation-deleted', { detail: { id, wasActive } }));
    if (wasActive) {
      onNewChat?.();
    }
  }

  async function handleDeleteAllConversations() {
    if (!conversationsStore.list.length) return;
    for (const conv of [...conversationsStore.list]) {
      await conversationsStore.delete(conv.id);
    }
    window.dispatchEvent(
      new CustomEvent('conversation-deleted', { detail: { id: null, wasActive: true } })
    );
    onNewChat?.();
  }

  onMount(async () => {
    if (authStore.isLoggedIn) {
      await conversationsStore.fetch();
    }
  });
</script>

<div class="flex h-full flex-col bg-background">
  <!-- Header with active chat name and controls -->
  <div class="border-b border-border px-3 py-2">
    <div class="mx-auto flex min-h-6 max-w-3xl items-center gap-2">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <MessageSquare class="size-3.5 flex-shrink-0 text-muted-foreground" />
        <span class="truncate text-xs font-semibold text-foreground">{activeChatName}</span>
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class={cn(
            'flex size-7 items-center justify-center rounded-md transition-colors',
            showHistory
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
          title="Chat History"
          aria-label="Chat history"
          onclick={() => (showHistory = !showHistory)}>
          <History class="size-3.5" />
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          title="New Chat"
          aria-label="New chat"
          onclick={() => onNewChat?.()}>
          <Plus class="size-3.5" />
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="Clear Chat"
          aria-label="Clear chat"
          onclick={() => onClearChat?.()}>
          <Trash2 class="size-3.5" />
        </button>
      </div>
    </div>
  </div>

  <!-- History Panel (slides in from top) -->
  {#if showHistory}
    <div class="border-b border-border bg-muted/10">
      <div class="flex items-center justify-between px-3 py-1.5">
        <span class="text-[10px] font-medium text-muted-foreground">History</span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            aria-label="New chat"
            onclick={handleNewChatFromHistory}>
            <Plus class="size-3" />
            New
          </button>
          <button
            type="button"
            class="flex size-5 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
            title="Delete all"
            aria-label="Delete all conversations"
            onclick={handleDeleteAllConversations}>
            <Trash2 class="size-3" />
          </button>
        </div>
      </div>
      <div class="scrollbar-thin max-h-60 overflow-y-auto">
        {#if conversationsStore.isLoading}
          <div class="flex items-center justify-center p-4">
            <span
              class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            ></span>
          </div>
        {:else if !authStore.isLoggedIn}
          <div class="px-3 py-3 text-center">
            <p class="text-[10px] text-muted-foreground">Sign in to save conversations</p>
          </div>
        {:else if conversationsStore.list.length === 0}
          <div class="px-3 py-3 text-center">
            <p class="text-[10px] text-muted-foreground">No conversations yet</p>
          </div>
        {:else}
          {#each conversationsStore.list as conv (conv.id)}
            <div
              class={cn(
                'group flex w-full items-center gap-1 px-3 py-1.5 transition-colors hover:bg-muted/40',
                conv.id === conversationsStore.activeId && 'bg-accent'
              )}>
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 text-left"
                onclick={() => handleSelectConversation(conv.id)}>
                <MessageSquare class="size-3 flex-shrink-0 text-muted-foreground" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1">
                    <span class="truncate text-[11px] font-medium text-foreground"
                      >{conv.title || 'Untitled'}</span>
                    {#if conv.is_pinned}<Pin class="size-2.5 flex-shrink-0 text-primary" />{/if}
                    {#if conv.is_archived}<Archive
                        class="size-2.5 flex-shrink-0 text-muted-foreground" />{/if}
                  </div>
                  <span class="text-[9px] text-muted-foreground"
                    >{formatConvTime(conv.updated_at)}</span>
                </div>
              </button>
              <button
                type="button"
                class="flex size-5 items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-[background-color,color,opacity] duration-150 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none"
                title="Delete"
                aria-label="Delete conversation"
                onclick={(e) => handleDeleteConversation(e, conv.id)}>
                <Trash2 class="size-2.5" />
              </button>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- Chat Content -->
  <div class="flex-1 overflow-hidden">
    {#if children}
      {@render children()}
    {:else}
      <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div class="flex size-12 items-center justify-center rounded-xl bg-muted">
          <img src="/brand/logo.png" alt="Graphini" class="size-6" />
        </div>
        <div>
          <p class="font-medium text-foreground">Graphini AI Assistant</p>
          <p class="text-sm text-muted-foreground">
            Create and edit diagrams with natural language.
          </p>
        </div>
      </div>
    {/if}
  </div>
</div>
