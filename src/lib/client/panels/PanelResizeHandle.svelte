<script lang="ts">
  interface Props {
    onResize: (deltaX: number) => void;
    position?: 'left' | 'right';
  }

  let { onResize, position = 'right' }: Props = $props();

  let isResizing = $state(false);
  let startX = 0;

  function handleMouseDown(e: MouseEvent) {
    isResizing = true;
    startX = e.clientX;
    e.preventDefault();

    // Add a full-screen overlay to prevent iframes/canvas from stealing mouse events
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:ew-resize;';
    document.body.appendChild(overlay);

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      startX = e.clientX;
      onResize(position === 'right' ? delta : -delta);
    };

    const handleMouseUp = () => {
      isResizing = false;
      overlay.remove();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="group/resize absolute top-0 z-50 h-full w-2 cursor-ew-resize {position === 'right'
    ? 'right-0'
    : 'left-0'}"
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize panel"
  onmousedown={handleMouseDown}>
  <!-- Hover/drag highlight on the inner edge; static line is provided by panel's border-l -->
  <div
    class="pointer-events-none absolute top-0 h-full opacity-0 transition-opacity duration-150 {position ===
    'right'
      ? 'right-0'
      : 'left-0'} group-hover/resize:opacity-100 {isResizing ? 'opacity-100' : ''}"
    style="width: 1px; background-color: var(--foreground);">
  </div>
</div>
