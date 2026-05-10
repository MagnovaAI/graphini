<script lang="ts">
  import { mode } from 'mode-watcher';
  import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';

  let restProps: SonnerProps = $props();
</script>

<Sonner
  theme={$mode}
  position="top-center"
  duration={3000}
  class="toaster group"
  toastOptions={{
    duration: 3000,
    classes: {
      toast:
        'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
      description: 'group-[.toast]:text-muted-foreground',
      actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
      cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground'
    }
  }}
  {...restProps} />
